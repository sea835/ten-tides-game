import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Texture,
  Vector2,
  Vector3,
  WebGPUCoordinateSystem,
  type Camera,
  type PerspectiveCamera,
} from "three";
import { NodeMaterial, type WebGPURenderer } from "three/webgpu";
import { Discard, Fn, attribute, cameraProjectionMatrix, float, length, mix, modelViewMatrix, positionLocal, screenSize, screenUV, select, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { getGraphics } from "../graphics.ts";
import { localPosition } from "../shared.ts";
import { eject, muzzle } from "./runtime.ts";
import { heatShot, newHeat, shimmerLevel, smokeRate } from "./barrelHeat.ts";
import { noise2 } from "./gpuParticles.ts";
import type { F, V2, V4 } from "../gpu/slots.ts";

// Nòng súng nóng (súng trước mặt): xả quá 10 viên thì một quầng khí nóng làm méo hình bốc lên từ đầu nòng trong
// 2–3 giây; sau mỗi loạt, vài làn khói mỏng uốn lượn bay ra từ đầu nòng và cửa thoát vỏ, trôi theo quán tính người
// chơi (khói sinh ra trong thế giới, mang theo một phần vận tốc của mình rồi chậm lại, nên đi tới thì khói lùi về sau).
//
// Khí nóng không cần thêm lượt vẽ cả màn hình: lớp súng (ViewPass) vẽ riêng ra một ảnh trong suốt đè lên cảnh đã hậu
// kỳ; tấm khí nóng lấy mẫu ẢNH CỦA LƯỢT VẼ CẢNH (`barrelFxScene.texture`, do postFx.ts đặt) tại toạ độ màn hình xô
// lệch theo nhiễu chạy dọc lên — trông như không khí khúc xạ. Súng vẽ trước, ghi độ sâu, nên phần súng nằm trước tấm
// khí nóng vẫn che nó. Khác bản WebGL cũ: ảnh cảnh này chưa tone map, chấm màu (lớp súng ghép sau, tone map riêng),
// nên chỗ bị méo hơi khác màu xung quanh một chút; nên độ đục của tấm khí nóng để nhẹ. Không có hậu kỳ (đồ hoạ thấp)
// hay không lấy được ảnh cảnh thì chỉ còn làn hơi mờ gợn sóng. Đồ hoạ thấp: tắt khí nóng, ít khói.

/** Số làn khói tối đa theo mức đồ hoạ. */
const SMOKE_CAP = { high: 28, medium: 18, low: 8 } as const;
const SMOKE_MAX = 28;
const SMOKE_LIFE = 2.2;

/**
 * Ảnh của lượt vẽ cảnh (trước hậu kỳ) cho khí nóng lấy mẫu: postFx.ts đặt khi dựng chuỗi hậu kỳ và gỡ khi huỷ. Đã bị
 * rỗng thì khí nóng lùi về làn hơi mờ.
 */
export const barrelFxScene: { texture: Texture | null } = { texture: null };

/**
 * Nén độ sâu về sát mặt kính camera cho mọi thứ của súng trước mặt (như `drawOnTop` của GunModel, `drawOnTopClip` của
 * ViewModel): trong clip space, chuẩn độ sâu khác nhau giữa nền WebGPU (0..1) và WebGL 2 (-1..1).
 */
const drawOnTopClip = Fn((builder) => {
  const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
  const z = (builder.renderer as { coordinateSystem: number }).coordinateSystem === WebGPUCoordinateSystem ? clip.z.mul(0.05) : clip.z.mul(0.05).sub(clip.w.mul(0.95));
  return vec4(clip.x, clip.y, z, clip.w);
});

const placeholder = new Texture();

function shimmerUniforms() {
  return {
    uScene: texture(placeholder),
    uTime: uniform(0),
    uLevel: uniform(0),
    uRefract: uniform(0),
    uPx: uniform(6),
  };
}
type ShimmerUniforms = ReturnType<typeof shimmerUniforms>;

/** Tấm khí nóng: quầng hẹp dần lên trên, đậm gần đầu nòng, tan ở ngọn; lấy mẫu ảnh cảnh xô lệch theo nhiễu. */
function shimmerMaterial(u: ShimmerUniforms) {
  const m = new NodeMaterial();
  m.vertexNode = drawOnTopClip();
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const w = mix(float(0.55), float(1), vUv.y);
    const edge = float(1).sub(smoothstep(w.mul(0.15), w.mul(0.5), vUv.x.sub(0.5).abs()));
    const fade = smoothstep(0, 0.1, vUv.y).mul(float(1).sub(smoothstep(0.45, 1.0, vUv.y)));
    const mask = edge.mul(fade).mul(u.uLevel);
    Discard(mask.lessThan(0.004));
    const q = vec2(vUv.x.mul(5), vUv.y.mul(4).sub(u.uTime.mul(2.6)));
    const n0 = vec2(noise2(q), noise2(q.add(vec2(7.3, 2.1)))).sub(0.5);
    const n = n0.add(vec2(noise2(q.mul(2.3).add(4)), noise2(q.mul(2.1).add(9))).sub(0.5).mul(0.5));
    // Độ lệch theo điểm ảnh (toạ độ màn hình tính từ trên xuống, nhiễu tính từ dưới lên: đảo trục y).
    const suv = screenUV.add(vec2(n.x, n.y.negate()).mul(u.uPx).mul(mask).div(screenSize));
    const c = u.uScene.sample(suv).rgb;
    const refracted = vec4(c, mask.mul(1.6).clamp(0, 1));
    // Không lấy được ảnh cảnh: chỉ là làn hơi mờ gợn sóng.
    const haze = vec4(vec3(0.9), mask.mul(float(0.05).add(n.x.mul(0.08))));
    return select(u.uRefract.greaterThan(0.5), refracted, haze);
  })();
  m.transparent = true;
  m.depthWrite = false;
  m.toneMapped = false;
  m.fog = false;
  return m;
}

/** Làn khói mỏng quanh nòng: mềm, rách theo nhiễu, cuộn chậm (aSmoke.x: độ đậm 0–1, aSmoke.y: hạt giống). */
function smokeMaterial(uTime: F) {
  const m = new NodeMaterial();
  m.vertexNode = drawOnTopClip();
  m.fragmentNode = Fn(() => {
    const vSmoke = attribute("aSmoke", "vec2") as V2;
    const vUv = uv();
    const p = vUv.sub(0.5);
    const r = length(p.mul(vec2(1.6, 1.0))).mul(2);
    const n0 = noise2(vUv.mul(3).add(vec2(vSmoke.y.mul(17), vSmoke.y.mul(5).sub(uTime.mul(0.6)))));
    const n = n0.mul(0.65).add(noise2(vUv.mul(7).add(vSmoke.y.mul(31)).add(uTime.mul(0.3))).mul(0.35));
    const a = float(1).sub(smoothstep(0.25, 1.0, r.add(n.sub(0.5).mul(0.6)))).mul(vSmoke.x);
    Discard(a.lessThan(0.003));
    return vec4(vec3(0.6, 0.61, 0.63).mul(float(0.85).add(n.mul(0.3))), a.mul(0.5));
  })();
  m.transparent = true;
  m.depthWrite = false;
  m.toneMapped = false;
  m.fog = false;
  return m;
}

/** Bộ điều khiển hiệu ứng nòng, ViewModel gọi cuối mỗi khung hình (sau khi đã đặt đầu nòng, cửa thoát vỏ). */
export interface BarrelFxApi {
  /** `n` phát mới; `heavy`: súng phát to. */
  shot(nowS: number, n: number, heavy: boolean): void;
  /** `visible`: súng trước mặt đang hiện. */
  update(dt: number, nowS: number, camera: Camera, visible: boolean): void;
}

/** Móc ViewPass gọi ngay trước khi vẽ lớp súng: chọn nền (ảnh cảnh) cho khí nóng khúc xạ. */
export const barrelFxHook: {
  beforeView: ((gl: WebGPURenderer, camera: PerspectiveCamera) => void) | null;
} = { beforeView: null };

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _up = new Vector3();
const _c = new Vector3();
const _lastPos = new Vector3();
const _size = new Vector2();
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
    const u = shimmerUniforms();
    const shimmerMat = shimmerMaterial(u);
    // Tấm khí nóng: gốc ở đáy (đầu nòng), dựng lên trên.
    const shimmerGeo = new PlaneGeometry(0.1, 0.26).translate(0, 0.13, 0);
    const uSmokeTime = uniform(0);
    const smokeMat = smokeMaterial(uSmokeTime);
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
      u,
      uSmokeTime,
      shimmerMat,
      shimmerGeo,
      smokeMat,
      smokeGeo,
      smokeAttr,
      wisps,
      heat: newHeat(),
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
      barrelFxHook.beforeView = null;
    },
    [res],
  );

  // Cùng lớp với súng trước mặt: chỉ ViewPass vẽ.
  useEffect(() => {
    shimmerRef.current?.layers.set(layer);
    smokeRef.current?.layers.set(layer);
  }, [layer]);

  // Ngay trước lượt vẽ súng (chỉ khi khí nóng đang bốc): chọn ảnh cảnh làm nền khúc xạ.
  useEffect(() => {
    barrelFxHook.beforeView = (gl) => {
      const sm = shimmerRef.current;
      const u = res.u;
      if (!sm || !sm.visible) return;
      const scene = barrelFxScene.texture;
      if (!scene) {
        u.uRefract.value = 0;
        return;
      }
      u.uScene.value = scene;
      u.uRefract.value = 1;
      // Độ xô lệch theo điểm ảnh: màn hình to thì lệch nhiều hơn cho cùng một cảm giác.
      gl.getDrawingBufferSize(_size);
      u.uPx.value = 11 * (_size.y / 900);
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
        const u = res.u;
        if (sm.visible) {
          u.uTime.value = nowS;
          u.uLevel.value = res.level;
          // Đứng thẳng theo phương thẳng đứng của thế giới, mặt quay về camera.
          _p.set(muzzle.x, muzzle.y + 0.012, muzzle.z);
          _up.set(0, 1, 0);
          _c.subVectors(camera.position, _p);
          _c.y = 0;
          if (_c.lengthSq() < 1e-6) _c.set(0, 0, 1);
          sm.position.copy(_p);
          sm.rotation.set(0, Math.atan2(_c.x, _c.z), 0);
          sm.updateMatrixWorld();
        } else u.uRefract.value = 0;

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
          res.uSmokeTime.value = nowS;
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
