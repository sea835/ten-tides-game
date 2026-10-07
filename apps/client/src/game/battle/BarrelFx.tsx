import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import {
  DynamicDrawUsage,
  FramebufferTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { DRAW_ON_TOP_GLSL } from "../GunModel.tsx";
import { getGraphics } from "../graphics.ts";
import { localPosition } from "../shared.ts";
import { eject, muzzle } from "./runtime.ts";
import { heatShot, newHeat, shimmerLevel, smokeRate } from "./barrelHeat.ts";

// Nòng súng nóng (súng trước mặt): xả quá 10 viên thì một quầng khí nóng làm méo hình bốc lên từ đầu nòng trong
// 2–3 giây; sau mỗi loạt, vài làn khói mỏng uốn lượn bay ra từ đầu nòng và cửa thoát vỏ, trôi theo quán tính người
// chơi (khói sinh ra trong thế giới, mang theo một phần vận tốc của mình rồi chậm lại, nên đi tới thì khói lùi về sau).
//
// Khí nóng không cần thêm lượt vẽ cả màn hình: ngay trước khi vẽ lớp súng (ViewPass), chép một ô vuông nhỏ của khung
// hình đã xong quanh đầu nòng vào texture (copyFramebufferToTexture, vài trăm điểm ảnh), rồi tấm khí nóng lấy mẫu ô đó
// với toạ độ xô lệch theo nhiễu chạy dọc lên — trông như không khí khúc xạ. Súng vẽ trước, ghi độ sâu, nên phần súng
// nằm trước tấm khí nóng vẫn che nó. Đồ hoạ thấp: tắt khí nóng, ít khói.

/** Số làn khói tối đa theo mức đồ hoạ. */
const SMOKE_CAP = { high: 28, medium: 18, low: 8 } as const;
const SMOKE_MAX = 28;
const SMOKE_LIFE = 2.2;

const VIEW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${DRAW_ON_TOP_GLSL}
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const shimmerFragment = /* glsl */ `
  uniform sampler2D uScene;
  uniform vec4 uRect;
  uniform float uTime;
  uniform float uLevel;
  uniform float uRefract;
  uniform float uPx;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    // Quầng hẹp dần lên trên, đậm ở gần đầu nòng, tan ở ngọn.
    float w = mix(0.55, 1.0, vUv.y);
    float edge = 1.0 - smoothstep(0.15 * w, 0.5 * w, abs(vUv.x - 0.5));
    float fade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
    float mask = edge * fade * uLevel;
    if (mask < 0.004) discard;
    vec2 q = vec2(vUv.x * 5.0, vUv.y * 4.0 - uTime * 2.6);
    vec2 n = vec2(noise(q), noise(q + vec2(7.3, 2.1))) - 0.5;
    n += 0.5 * (vec2(noise(q * 2.3 + 4.0), noise(q * 2.1 + 9.0)) - 0.5);
    if (uRefract > 0.5) {
      vec2 suv = (gl_FragCoord.xy + n * uPx * mask - uRect.xy) / uRect.zw;
      float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
      vec3 c = texture2D(uScene, clamp(suv, 0.002, 0.998)).rgb;
      gl_FragColor = vec4(c, clamp(mask * 2.5, 0.0, 1.0) * inside);
    } else {
      // Không chép được khung hình: chỉ là làn hơi mờ gợn sóng.
      gl_FragColor = vec4(vec3(0.9), mask * (0.05 + 0.08 * n.x));
    }
  }
`;

const smokeVertex = /* glsl */ `
  attribute vec2 aSmoke;
  varying vec2 vUv;
  varying vec2 vSmoke;
  void main() {
    vUv = uv;
    vSmoke = aSmoke;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    ${DRAW_ON_TOP_GLSL}
  }
`;
const smokeFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vSmoke;
  ${NOISE}
  void main() {
    // vSmoke.x: độ đậm (0–1), vSmoke.y: hạt giống. Làn khói mềm, rách theo nhiễu, cuộn chậm.
    vec2 p = vUv - 0.5;
    float r = length(p * vec2(1.6, 1.0)) * 2.0;
    float n = noise(vUv * 3.0 + vec2(vSmoke.y * 17.0, vSmoke.y * 5.0 - uTime * 0.6));
    n = n * 0.65 + 0.35 * noise(vUv * 7.0 + vSmoke.y * 31.0 + uTime * 0.3);
    float a = (1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.6)) * vSmoke.x;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(0.6, 0.61, 0.63) * (0.85 + 0.3 * n), a * 0.5);
  }
`;

/** Ô chép khung hình và cờ cho phép chép (ngữ cảnh có kênh alpha thì mới chép vào texture RGBA được). */
interface Grab {
  tex: FramebufferTexture | null;
  size: number;
  ok: boolean | null;
}

/** Bộ điều khiển hiệu ứng nòng, ViewModel gọi cuối mỗi khung hình (sau khi đã đặt đầu nòng, cửa thoát vỏ). */
export interface BarrelFxApi {
  /** `n` phát mới; `heavy`: súng phát to. */
  shot(nowS: number, n: number, heavy: boolean): void;
  /** `visible`: súng trước mặt đang hiện. */
  update(dt: number, nowS: number, camera: Camera, visible: boolean): void;
}

/** Móc ViewPass gọi ngay trước khi vẽ lớp súng: chép nền quanh đầu nòng cho khí nóng. */
export const barrelFxHook: {
  beforeView: ((gl: WebGLRenderer, camera: PerspectiveCamera) => void) | null;
} = { beforeView: null };

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _up = new Vector3();
const _c = new Vector3();
const _grabAt = new Vector2();
const _lastPos = new Vector3();
const _vel = new Vector3();

interface Wisp {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  seed: number;
  size: number;
}

export function BarrelFx({ api, layer }: { api: Ref<BarrelFxApi>; layer: number }) {
  const shimmerRef = useRef<Mesh>(null);
  const smokeRef = useRef<InstancedMesh>(null);
  const res = useMemo(() => {
    const shimmerMat = new ShaderMaterial({
      vertexShader: VIEW_VERTEX,
      fragmentShader: shimmerFragment,
      uniforms: {
        uScene: { value: null },
        uRect: { value: new Vector4(0, 0, 1, 1) },
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uRefract: { value: 0 },
        uPx: { value: 6 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    // Tấm khí nóng: gốc ở đáy (đầu nòng), dựng lên trên.
    const shimmerGeo = new PlaneGeometry(0.1, 0.26).translate(0, 0.13, 0);
    const smokeMat = new ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const smokeGeo = new PlaneGeometry(1, 1);
    const smokeAttr = new InstancedBufferAttribute(new Float32Array(SMOKE_MAX * 2), 2);
    smokeAttr.setUsage(DynamicDrawUsage);
    smokeGeo.setAttribute("aSmoke", smokeAttr);
    const wisps: Wisp[] = [];
    for (let i = 0; i < SMOKE_MAX; i++)
      wisps.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 1,
        life: 0,
        seed: Math.random(),
        size: 0,
      });
    return {
      shimmerMat,
      shimmerGeo,
      smokeMat,
      smokeGeo,
      smokeAttr,
      wisps,
      heat: newHeat(),
      grab: { tex: null, size: 0, ok: null } as Grab,
      emit: 0,
      next: 0,
      level: 0,
      hadPos: false,
    };
  }, []);

  useEffect(
    () => () => {
      res.shimmerMat.dispose();
      res.shimmerGeo.dispose();
      res.smokeMat.dispose();
      res.smokeGeo.dispose();
      res.grab.tex?.dispose();
      barrelFxHook.beforeView = null;
    },
    [res],
  );

  // Cùng lớp với súng trước mặt: chỉ ViewPass vẽ.
  useEffect(() => {
    shimmerRef.current?.layers.set(layer);
    smokeRef.current?.layers.set(layer);
  }, [layer]);

  // Chép nền quanh đầu nòng ngay trước lượt vẽ súng (chỉ khi khí nóng đang bốc).
  useEffect(() => {
    barrelFxHook.beforeView = (gl, camera) => {
      const sm = shimmerRef.current;
      const u = res.shimmerMat.uniforms;
      if (!sm || !sm.visible) return;
      const grab = res.grab;
      if (grab.ok === null) grab.ok = !!gl.getContext().getContextAttributes()?.alpha;
      if (!grab.ok) {
        u.uRefract!.value = 0;
        return;
      }
      gl.getDrawingBufferSize(_grabAt);
      const bw = _grabAt.x;
      const bh = _grabAt.y;
      const size = bh > 1300 ? 512 : 256;
      if (!grab.tex || grab.size !== size) {
        grab.tex?.dispose();
        grab.tex = new FramebufferTexture(size, size);
        grab.size = size;
      }
      // Tâm ô chép: giữa tấm khí nóng (trên đầu nòng một đoạn), chiếu ra điểm ảnh.
      _c.set(0, 0.11, 0).applyMatrix4(sm.matrixWorld).project(camera);
      if (_c.z > 1 || _c.z < -1) {
        u.uRefract!.value = 0;
        return;
      }
      const cx = (_c.x * 0.5 + 0.5) * bw;
      const cy = (_c.y * 0.5 + 0.5) * bh;
      const x = Math.round(Math.min(Math.max(cx - size / 2, 0), Math.max(0, bw - size)));
      const y = Math.round(Math.min(Math.max(cy - size / 2, 0), Math.max(0, bh - size)));
      if (bw < size || bh < size) {
        u.uRefract!.value = 0;
        return;
      }
      _grabAt.set(x, y);
      gl.copyFramebufferToTexture(grab.tex, _grabAt);
      // Gốc và cỡ ô chép (điểm ảnh của bộ đệm vẽ).
      (u.uRect!.value as Vector4).set(x, y, size, size);
      u.uScene!.value = grab.tex;
      u.uRefract!.value = 1;
      // Độ xô lệch theo điểm ảnh: màn hình to thì lệch nhiều hơn cho cùng một cảm giác.
      u.uPx!.value = 11 * (bh / 900);
    };
    return () => {
      barrelFxHook.beforeView = null;
    };
  }, [res]);

  useImperativeHandle(
    api,
    () => ({
      shot(nowS, n, heavy) {
        heatShot(res.heat, nowS, n, heavy);
      },
      update(dt, nowS, camera, visible) {
        const sm = shimmerRef.current;
        const smoke = smokeRef.current;
        if (!sm || !smoke) return;
        const quality = getGraphics().quality;
        // Vận tốc của mình (để khói mang theo quán tính).
        if (res.hadPos && dt > 1e-4) {
          _vel.subVectors(localPosition, _lastPos).divideScalar(dt);
          // Dịch chuyển tức thời (hồi sinh, teleport): bỏ qua.
          if (_vel.lengthSq() > 400) _vel.set(0, 0, 0);
        } else _vel.set(0, 0, 0);
        _lastPos.copy(localPosition);
        res.hadPos = true;

        // ---------------------------------------------------------------- khí nóng
        const want = visible && muzzle.valid && quality !== "low" ? shimmerLevel(res.heat, nowS) : 0;
        res.level += (want - res.level) * Math.min(1, dt * 6);
        sm.visible = res.level > 0.01;
        const u = res.shimmerMat.uniforms;
        if (sm.visible) {
          u.uTime!.value = nowS;
          u.uLevel!.value = res.level;
          // Đứng thẳng theo phương thẳng đứng của thế giới, mặt quay về camera.
          _p.set(muzzle.x, muzzle.y + 0.012, muzzle.z);
          _up.set(0, 1, 0);
          _c.subVectors(camera.position, _p);
          _c.y = 0;
          if (_c.lengthSq() < 1e-6) _c.set(0, 0, 1);
          sm.position.copy(_p);
          sm.rotation.set(0, Math.atan2(_c.x, _c.z), 0);
          sm.updateMatrixWorld();
        } else u.uRefract!.value = 0;

        // ---------------------------------------------------------------- khói
        const cap = SMOKE_CAP[quality];
        const rate = visible && muzzle.valid ? smokeRate(res.heat, nowS) * (quality === "low" ? 0.45 : quality === "medium" ? 0.75 : 1) : 0;
        res.emit += rate * dt;
        const ws = res.wisps;
        while (res.emit >= 1) {
          res.emit -= 1;
          let w: Wisp | null = null;
          for (let k = 0; k < cap; k++) {
            const c = ws[(res.next + k) % cap]!;
            if (c.age >= c.life) {
              w = c;
              res.next = (res.next + k + 1) % cap;
              break;
            }
          }
          if (!w) break;
          // Bảy phần từ đầu nòng, ba phần từ cửa thoát vỏ.
          const fromPort = eject.valid && Math.random() < 0.3;
          w.x = fromPort ? eject.x : muzzle.x;
          w.y = fromPort ? eject.y : muzzle.y;
          w.z = fromPort ? eject.z : muzzle.z;
          w.vx = _vel.x * 0.75 + (Math.random() - 0.5) * 0.04 + (fromPort ? eject.rx * 0.03 : 0);
          w.vy = _vel.y * 0.5 + 0.05 + Math.random() * 0.05;
          w.vz = _vel.z * 0.75 + (Math.random() - 0.5) * 0.04 + (fromPort ? eject.rz * 0.03 : 0);
          w.age = 0;
          w.life = SMOKE_LIFE * (0.7 + Math.random() * 0.5);
          w.seed = Math.random();
          w.size = fromPort ? 0.035 : 0.045;
        }
        if (rate === 0) res.emit = 0;
        const attr = res.smokeAttr;
        const arr = attr.array as Float32Array;
        let live = 0;
        _q.copy(camera.quaternion);
        const drag = Math.exp(-dt * 1.8);
        for (let k = 0; k < SMOKE_MAX; k++) {
          const w = ws[k]!;
          if (w.age >= w.life) continue;
          w.age += dt;
          if (w.age >= w.life) continue;
          const t = w.age / w.life;
          // Lực nổi kéo khói lên, sức cản làm chậm dần (mất quán tính người chơi), gió xoáy nhẹ cho uốn lượn.
          const swirl = Math.sin(nowS * 2.3 + w.seed * 40) * 0.07;
          w.vx = w.vx * drag + swirl * dt * 3;
          w.vz = w.vz * drag + Math.cos(nowS * 1.9 + w.seed * 25) * 0.07 * dt * 3;
          w.vy = w.vy * drag + 0.11 * dt;
          w.x += w.vx * dt;
          w.y += w.vy * dt;
          w.z += w.vz * dt;
          const sz = w.size * (1 + t * 3.2);
          _p.set(w.x, w.y, w.z);
          _s.set(sz, sz * 1.5, sz);
          _m.compose(_p, _q, _s);
          smoke.setMatrixAt(live, _m);
          // Hiện nhanh, tan chậm.
          arr[live * 2] = Math.min(1, t * 8) * (1 - t) * (1 - t);
          arr[live * 2 + 1] = w.seed;
          live++;
        }
        smoke.count = live;
        smoke.visible = live > 0;
        if (live > 0) {
          smoke.instanceMatrix.needsUpdate = true;
          attr.needsUpdate = true;
          res.smokeMat.uniforms.uTime!.value = nowS;
        }
      },
    }),
    [res],
  );

  // Nhóm neo ở gốc thế giới (không nhận ma trận của nhóm súng đi theo camera): khí nóng, khói đặt theo toạ độ thế giới.
  return (
    <group matrixAutoUpdate={false} matrixWorldAutoUpdate={false}>
      <mesh ref={shimmerRef} geometry={res.shimmerGeo} material={res.shimmerMat} visible={false} renderOrder={22} frustumCulled={false} />
      <instancedMesh ref={smokeRef} args={[res.smokeGeo, res.smokeMat, SMOKE_MAX]} visible={false} renderOrder={23} frustumCulled={false} />
    </group>
  );
}
