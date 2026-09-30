import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type InstancedMesh,
} from "three";
import { WATER_LEVEL, type World } from "@tentides/content";
import type { HurtMessage } from "@tentides/protocol";
import { Messages } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { getGraphics } from "../graphics.ts";
import { localPosition } from "../shared.ts";
import { effects, stance } from "./runtime.ts";
import { physicsProbe } from "./surface.ts";

// Máu bắn ra khi trúng đạn: một làn sương máu phụt ra (nở to, tan trong chừng 0,3 giây) và một chùm giọt máu nhỏ
// bay chủ yếu theo hướng đạn (máu phun ra phía sau lưng người trúng), vài giọt bắn ngược về phía người bắn, rơi theo
// trọng lực. Vài giọt rơi chạm đất, sàn, tường thì để lại vết máu nhỏ (dùng chung hệ vết máu của Decals). Trúng đầu
// thì phụt to hơn. Dùng cho mọi phát trúng người mà máy mình biết: của mình (Shooter), của người khác (tin "shot"),
// và khi chính mình bị thương (góc nhìn thứ ba). Số hạt có trần cứng (vòng tròn, hạt cũ nhất bị thay), không cấp
// phát gì trong vòng lặp mỗi khung hình.

/** Tối đa giọt máu và cụm sương cùng lúc. */
const MAX_DROPS = 384;
const MAX_MIST = 96;
/** Hàng chờ phụt máu (đạn chưa bay tới nơi); đầy thì bỏ bớt cái cũ nhất. */
const MAX_PENDING = 64;
const GRAVITY = 9.8;

interface Spray {
  x: number;
  y: number;
  z: number;
  /** Hướng đạn bay (đã chuẩn hoá). */
  dx: number;
  dy: number;
  dz: number;
  head: boolean;
  /** Độ mạnh (1 là phát thường; từng viên shotgun, dao đâm thì nhỏ hơn). */
  strength: number;
  /** Lúc đạn tới nơi (giây, performance.now). */
  at: number;
}

const pending: Spray[] = [];
/** Lần phụt máu gần nhất trên người mình (giây), để tin "hurt" khỏi phụt thêm lần nữa. */
let lastOnMe = 0;

/**
 * Phụt máu ở điểm trúng (x, y, z), đạn bay theo hướng (dx, dy, dz). `at`: lúc đạn tới nơi (giây, performance.now),
 * bắn xa thì máu phụt muộn hơn một chút cho khớp vệt đạn.
 */
export function sprayBlood(x: number, y: number, z: number, dx: number, dy: number, dz: number, opts: { head?: boolean; strength?: number; at?: number } = {}) {
  const l = Math.hypot(dx, dy, dz) || 1;
  if (pending.length >= MAX_PENDING) pending.shift();
  const now = performance.now() / 1000;
  pending.push({ x, y, z, dx: dx / l, dy: dy / l, dz: dz / l, head: !!opts.head, strength: opts.strength ?? 1, at: opts.at ?? now });
  if (Math.hypot(x - localPosition.x, z - localPosition.z) < 1.2 && Math.abs(y - localPosition.y - 1) < 1.3) lastOnMe = now;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Ảnh sương máu: lõi đặc, mép tơi (vài đốm lệch tâm cho khỏi tròn vo). */
function mistTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 14; k++) {
    const x = 32 + rand(-12, 12);
    const y = 32 + rand(-12, 12);
    const r = rand(8, 22);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

/** Sương quay mặt về camera; màu, độ đậm từng cụm theo thuộc tính riêng. */
const mistVertex = /* glsl */ `
  attribute vec4 aTint;
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vTint = aTint;
    vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float size = length(instanceMatrix[0].xyz);
    vec4 mv = viewMatrix * modelMatrix * vec4(center, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    vec4 mvPosition = mv;
    #include <fog_vertex>
  }
`;
const mistFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMap, vUv).a * vTint.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <fog_fragment>
  }
`;

const Z = new Vector3(0, 0, 1);
const _v = new Vector3();
const dummy = new Object3D();

export function Blood({ room, world }: { room: IslandRoom; world: World }) {
  const dropMesh = useRef<InstancedMesh>(null);
  const mistMesh = useRef<InstancedMesh>(null);

  // Giọt máu: mảng phẳng theo từng thuộc tính (vòng tròn), `life` 0 là ô trống.
  const drops = useMemo(
    () => ({
      x: new Float32Array(MAX_DROPS),
      y: new Float32Array(MAX_DROPS),
      z: new Float32Array(MAX_DROPS),
      vx: new Float32Array(MAX_DROPS),
      vy: new Float32Array(MAX_DROPS),
      vz: new Float32Array(MAX_DROPS),
      age: new Float32Array(MAX_DROPS),
      life: new Float32Array(MAX_DROPS),
      size: new Float32Array(MAX_DROPS),
      /** Giọt này chạm mặt thì để lại vết máu (chỉ vài giọt mỗi phát, mới dò tia vật lý). */
      splat: new Uint8Array(MAX_DROPS),
      next: 0,
    }),
    [],
  );
  const mist = useMemo(
    () => ({
      x: new Float32Array(MAX_MIST),
      y: new Float32Array(MAX_MIST),
      z: new Float32Array(MAX_MIST),
      vx: new Float32Array(MAX_MIST),
      vy: new Float32Array(MAX_MIST),
      vz: new Float32Array(MAX_MIST),
      age: new Float32Array(MAX_MIST),
      life: new Float32Array(MAX_MIST),
      size: new Float32Array(MAX_MIST),
      grow: new Float32Array(MAX_MIST),
      alpha: new Float32Array(MAX_MIST),
      shade: new Float32Array(MAX_MIST),
      next: 0,
    }),
    [],
  );

  const tint = useMemo(() => new InstancedBufferAttribute(new Float32Array(MAX_MIST * 4), 4), []);
  const res = useMemo(() => {
    const mistGeo = new PlaneGeometry(1, 1);
    mistGeo.setAttribute("aTint", tint);
    const mistMat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uMap: { value: null } }]),
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const dropGeo = new IcosahedronGeometry(1, 0);
    // Máu ướt: đỏ sẫm, hơi bóng.
    const dropMat = new MeshStandardMaterial({ color: new Color(0.32, 0.01, 0.01), roughness: 0.25, metalness: 0 });
    dropMat.userData.detail = "none";
    return { mistGeo, mistMat, dropGeo, dropMat };
  }, [tint]);
  useEffect(() => {
    const map = mistTexture();
    res.mistMat.uniforms.uMap!.value = map;
    return () => {
      map.dispose();
      res.mistGeo.dispose();
      res.mistMat.dispose();
      res.dropGeo.dispose();
      res.dropMat.dispose();
    };
  }, [res]);

  // Mình bị thương (góc nhìn thứ ba): phụt máu nhỏ ở ngực, theo hướng từ chỗ kẻ bắn tới. Phát đạn của người khác
  // trúng mình thường đã phụt qua tin "shot" rồi thì thôi; không rõ hướng (vùng độc, rơi) thì cũng thôi.
  useEffect(
    () =>
      room.onMessage(Messages.hurt, (h: HurtMessage) => {
        if (stance.firstPerson || h.amount <= 0) return;
        const now = performance.now() / 1000;
        if (now - lastOnMe < 0.5) return;
        const dx = localPosition.x - h.x;
        const dz = localPosition.z - h.z;
        if (Math.hypot(dx, dz) < 0.3) return;
        const chest = stance.prone ? 0.3 : stance.crouching ? 0.85 : 1.25;
        sprayBlood(localPosition.x, localPosition.y + chest, localPosition.z, dx, 0, dz, { strength: Math.min(1, 0.4 + h.amount / 60) });
      }),
    [room],
  );

  const addDrop = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, splat: boolean) => {
    const i = drops.next;
    drops.next = (i + 1) % MAX_DROPS;
    drops.x[i] = x;
    drops.y[i] = y;
    drops.z[i] = z;
    drops.vx[i] = vx;
    drops.vy[i] = vy;
    drops.vz[i] = vz;
    drops.age[i] = 0;
    drops.life[i] = rand(0.7, 1.2);
    drops.size[i] = size;
    drops.splat[i] = splat ? 1 : 0;
  };

  const addMist = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, alpha: number) => {
    const i = mist.next;
    mist.next = (i + 1) % MAX_MIST;
    mist.x[i] = x;
    mist.y[i] = y;
    mist.z[i] = z;
    mist.vx[i] = vx;
    mist.vy[i] = vy;
    mist.vz[i] = vz;
    mist.age[i] = 0;
    mist.life[i] = life;
    mist.size[i] = size;
    mist.grow[i] = grow;
    mist.alpha[i] = alpha;
    mist.shade[i] = rand(0.75, 1.1);
  };

  const burst = (s: Spray, camDist: number) => {
    if (camDist > 250) return;
    const low = getGraphics().quality === "low";
    const q = low ? 0.5 : 1;
    const { x, y, z, dx, dy, dz, head, strength } = s;
    // Sương: lõi to ở chỗ trúng, vài cụm nhỏ lệch theo hướng đạn. Sát ngay camera (góc nhất bị bắn) thì bỏ, khỏi che mắt.
    if (camDist > 1.2) {
      const big = (head ? 1.5 : 1) * (0.6 + 0.4 * strength);
      const n = Math.max(1, Math.round((head ? 4 : 3) * q * (0.5 + 0.5 * strength)));
      for (let k = 0; k < n; k++) {
        const out = k === 0 ? 0 : rand(0.05, 0.25);
        const sp = k === 0 ? rand(0.4, 1) : rand(1.2, 3);
        addMist(
          x + dx * out,
          y + dy * out,
          z + dz * out,
          dx * sp + rand(-0.4, 0.4),
          dy * sp + rand(-0.2, 0.5),
          dz * sp + rand(-0.4, 0.4),
          (k === 0 ? 0.16 : 0.1) * big,
          (k === 0 ? 1.6 : 1.1) * big,
          rand(0.25, 0.38) * (head ? 1.2 : 1),
          k === 0 ? 0.9 : 0.7,
        );
      }
    }
    // Giọt: xa quá thì không thấy, khỏi tốn.
    if (camDist > 150) return;
    const base = head ? rand(14, 20) : rand(8, 14);
    const count = Math.max(2, Math.round(base * q * strength));
    // Vài giọt đầu (phun ra sau) được phép để vết máu, có hạn mỗi phát cho khỏi ngập.
    let splats = camDist < 70 ? Math.max(strength < 0.7 ? 1 : 0, Math.round((head ? 4 : 3) * (low ? 0.6 : 1) * Math.min(1, strength))) : 0;
    for (let k = 0; k < count; k++) {
      const back = Math.random() < 0.22;
      const size = rand(0.01, 0.024) * (head ? 1.25 : 1);
      if (back) {
        // Bắn ngược về phía người bắn, ít và chậm.
        const sp = rand(0.8, 2.6);
        addDrop(x, y, z, -dx * sp + rand(-1, 1), -dy * sp + rand(0.4, 2), -dz * sp + rand(-1, 1), size * 0.8, false);
      } else {
        // Phun ra sau lưng theo hướng đạn, toả hình nón.
        const sp = rand(2.2, 6.5) * (head ? 1.15 : 1);
        const cone = rand(0.6, 1.8);
        const splat = splats > 0;
        if (splat) splats--;
        addDrop(x + dx * 0.08, y + dy * 0.08, z + dz * 0.08, dx * sp + rand(-cone, cone), dy * sp + rand(-0.4, 1.4), dz * sp + rand(-cone, cone), size, splat);
      }
    }
  };

  /** Giọt chạm mặt: để vết máu nhỏ, áp theo pháp tuyến. */
  const land = (x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number) => {
    if (y < WATER_LEVEL + 0.05) return;
    effects.splats.push({ x, y, z, nx, ny, nz, scale: rand(0.14, 0.3) * (size / 0.017) });
  };

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = camera.position;
    const nowS = performance.now() / 1000;
    for (let i = pending.length - 1; i >= 0; i--) {
      const s = pending[i]!;
      if (s.at > nowS) continue;
      pending.splice(i, 1);
      burst(s, Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z));
    }

    const dm = dropMesh.current;
    const mm = mistMesh.current;
    if (!dm || !mm) return;
    // Giọt máu: bay, rơi, chạm đất (hay tường, sàn với giọt để vết) thì tắt.
    let nd = 0;
    const drag = Math.exp(-dt * 0.6);
    for (let i = 0; i < MAX_DROPS; i++) {
      const life = drops.life[i]!;
      if (life <= 0) continue;
      const age = drops.age[i]! + dt;
      if (age >= life) {
        drops.life[i] = 0;
        continue;
      }
      drops.age[i] = age;
      let vx = drops.vx[i]! * drag;
      let vy = drops.vy[i]! - GRAVITY * dt;
      let vz = drops.vz[i]! * drag;
      const x = drops.x[i]!;
      const y = drops.y[i]!;
      const z = drops.z[i]!;
      if (drops.splat[i]) {
        // Dò đoạn đường đi trong khung hình này: găm vào tường, sàn nhà, bậc thang...
        const step = Math.hypot(vx, vy, vz) * dt;
        const hit = step > 1e-4 ? physicsProbe.cast?.(x, y, z, vx * dt / step, vy * dt / step, vz * dt / step, step) : null;
        if (hit) {
          const t = hit.t / step;
          land(x + vx * dt * t, y + vy * dt * t, z + vz * dt * t, hit.nx, hit.ny, hit.nz, drops.size[i]!);
          drops.life[i] = 0;
          continue;
        }
      }
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const nz = z + vz * dt;
      const ground = world.heightAt(nx, nz);
      if (ny <= ground) {
        if (drops.splat[i]) {
          // Pháp tuyến mặt đất từ độ dốc quanh đó.
          const gx = world.heightAt(nx + 0.3, nz) - world.heightAt(nx - 0.3, nz);
          const gz = world.heightAt(nx, nz + 0.3) - world.heightAt(nx, nz - 0.3);
          _v.set(-gx, 0.6, -gz).normalize();
          land(nx, ground, nz, _v.x, _v.y, _v.z, drops.size[i]!);
        }
        drops.life[i] = 0;
        continue;
      }
      drops.x[i] = nx;
      drops.y[i] = ny;
      drops.z[i] = nz;
      drops.vx[i] = vx;
      drops.vy[i] = vy;
      drops.vz[i] = vz;
      // Giọt dài ra theo hướng bay (nhìn như vệt nhoè khi bay nhanh), co lại lúc sắp tắt.
      const speed = Math.hypot(vx, vy, vz) || 1;
      _v.set(vx / speed, vy / speed, vz / speed);
      dummy.quaternion.setFromUnitVectors(Z, _v);
      dummy.position.set(nx, ny, nz);
      const s = drops.size[i]! * Math.min(1, (1 - age / life) * 4);
      dummy.scale.set(s, s, s * Math.min(4, 1 + speed * 0.35));
      dummy.updateMatrix();
      dm.setMatrixAt(nd++, dummy.matrix);
    }
    dm.count = nd;
    dm.instanceMatrix.needsUpdate = true;

    // Sương: nở nhanh rồi chậm lại, mờ dần.
    let nm = 0;
    const mdrag = Math.exp(-dt * 5);
    for (let i = 0; i < MAX_MIST; i++) {
      const life = mist.life[i]!;
      if (life <= 0) continue;
      const age = mist.age[i]! + dt;
      if (age >= life) {
        mist.life[i] = 0;
        continue;
      }
      mist.age[i] = age;
      mist.vx[i]! *= mdrag;
      mist.vy[i] = mist.vy[i]! * mdrag - 0.6 * dt;
      mist.vz[i]! *= mdrag;
      mist.x[i]! += mist.vx[i]! * dt;
      mist.y[i]! += mist.vy[i]! * dt;
      mist.z[i]! += mist.vz[i]! * dt;
      const k = age / life;
      const ease = 1 - (1 - k) * (1 - k);
      dummy.position.set(mist.x[i]!, mist.y[i]!, mist.z[i]!);
      dummy.quaternion.identity();
      dummy.scale.setScalar(mist.size[i]! + mist.grow[i]! * 0.3 * ease);
      dummy.updateMatrix();
      mm.setMatrixAt(nm, dummy.matrix);
      const shade = mist.shade[i]!;
      tint.setXYZW(nm, 0.42 * shade, 0.02 * shade, 0.02 * shade, mist.alpha[i]! * (1 - k) * (1 - k * 0.3));
      nm++;
    }
    mm.count = nm;
    mm.instanceMatrix.needsUpdate = true;
    tint.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={dropMesh} args={[res.dropGeo, res.dropMat, MAX_DROPS]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={mistMesh} args={[res.mistGeo, res.mistMat, MAX_MIST]} frustumCulled={false} renderOrder={7} />
    </>
  );
}
