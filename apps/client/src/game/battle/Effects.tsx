import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type InstancedMesh,
  type LineLoop,
  type Mesh,
  type PointLight,
} from "three";
import { BULLET_GRAVITY, FRAG, SMOKE, SMOKE_CLEAR, TANK, battleMap, flightDistance, flightTime, type World } from "@tentides/content";
import type { BoomMessage, ProjectileState, ShotMessage, SmokeState } from "@tentides/protocol";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { localPosition, shake, suppression } from "../shared.ts";
import { audio } from "../sound/engine.ts";
import { playExplosion, playGrenadeBounce, playGunshot, playBulletWhiz, playMineBeep, playSmoke, playBolt, playCannon, playSuppressed } from "../sound/guns.ts";
import { closestApproach, flybyTiming, type Approach } from "../sound/acoustics.ts";
import { setAcousticMap } from "../sound/environment.ts";
import { mapForMode } from "@tentides/content";
import { M203, WEAPON } from "@tentides/content";
import { playLauncher } from "../sound/gadgets.ts";
import { bodies, effects, getBattleHud, hitStopScale, setBattleHud, stance } from "./runtime.ts";
import { BulletHoles } from "./Decals.tsx";
import { Casings } from "./Casings.tsx";
import { Blood, sprayBlood } from "./Blood.tsx";
import { pulseNeon } from "../skinMaterials.ts";
import { physicsProbe } from "./surface.ts";
import { windStrength } from "../nature.ts";
import { forEachSmoke, SmokeShells } from "./SmokeShell.tsx";
import { Debris, spawnDebris } from "./Debris.tsx";
import { MuzzleLights } from "./MuzzleLights.tsx";
import { LootModel } from "../GunModel.tsx";

// Hiệu ứng của trận đấu: tường vùng an toàn (màn xanh cao vút, vân chạy), vòng kế tiếp vẽ trên mặt đất,
// bom khói (khối khói đặc hình vòm che kín tầm nhìn — SmokeShell.tsx — cộng hàng chục cụm khói mềm cuộn quanh mép),
// vụ nổ (cầu lửa nhiều tầng, chớp sáng, cột khói đen cao chừng 20 m trôi theo gió, đất đá văng — Debris.tsx — rung
// màn hình), vệt đạn, lửa đầu nòng (kèm đèn chớp soi sáng xung quanh — MuzzleLights.tsx), bụi và tia lửa chỗ đạn găm,
// lựu đạn đang bay và mìn của mình.

/** Hướng gió (đơn vị, trên mặt phẳng ngang) cho khói trôi; độ mạnh lấy theo `windStrength` của thời tiết. */
const WIND_X = 0.86;
const WIND_Z = 0.51;

// ---------------------------------------------------------------------------- vùng an toàn

const zoneVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    // Tường vùng an toàn phải thấy từ xa dù camera chỉ nhìn tới tầm sương mù (camera.far theo sương, DayCycle):
    // phần xa hơn mặt phẳng xa thì ép về sát mặt phẳng xa thay vì bị cắt mất.
    gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
  }
`;
const zoneFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    float stripes = 0.5 + 0.5 * sin((vWorld.y * 0.9 + uTime * 2.0) + atan(vWorld.z, vWorld.x) * 40.0);
    float fadeTop = 1.0 - smoothstep(0.35, 1.0, vUv.y);
    float dist = length(cameraPosition.xz - vWorld.xz);
    float near = 0.35 + 0.65 * smoothstep(120.0, 8.0, dist);
    vec3 col = mix(vec3(0.15, 0.45, 1.0), vec3(0.55, 0.8, 1.0), stripes);
    gl_FragColor = vec4(col * 1.6, (0.16 + 0.14 * stripes) * fadeTop * near);
  }
`;

function ZoneWall({ room }: { room: IslandRoom }) {
  const wall = useRef<Mesh>(null);
  const material = useMemo(
    () => new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: zoneVertex, fragmentShader: zoneFragment, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false }),
    [],
  );
  const geometry = useMemo(() => new CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0), []);
  useFrame(({ clock }) => {
    const z = room.state.zone;
    const m = wall.current;
    if (!m) return;
    // Chiến trường không có vùng bo (server đặt bán kính 2000 m phủ cả bản đồ): không vẽ tường. Trước đây tường
    // vẫn vẽ, bị ép về mặt phẳng xa nên thành mấy vệt sọc ngang tối ở tầm xa.
    const on = room.state.phase === "battle" && room.state.battleMode !== "war" && z.r > 0.5 && z.r < 1000;
    m.visible = on;
    m.position.set(z.x, -20, z.z);
    m.scale.set(z.r, 160, z.r);
    material.uniforms.uTime!.value = clock.elapsedTime;
  });
  return <mesh ref={wall} geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

/** Vòng kế tiếp: đường trắng bám theo mặt đất. */
function NextZone({ room, world }: { room: IslandRoom; world: World }) {
  const line = useRef<LineLoop>(null);
  const key = useRef("");
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(160 * 3), 3));
    return g;
  }, []);
  useFrame(() => {
    const z = room.state.zone;
    const l = line.current;
    if (!l) return;
    l.visible = room.state.phase === "battle" && z.nr > 0.5 && Math.abs(z.nr - z.r) > 0.5;
    const k = `${z.nx.toFixed(1)},${z.nz.toFixed(1)},${z.nr.toFixed(1)}`;
    if (k === key.current) return;
    key.current = k;
    const p = geometry.attributes.position!;
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const x = z.nx + Math.cos(a) * z.nr;
      const zz = z.nz + Math.sin(a) * z.nr;
      p.setXYZ(i, x, Math.max(world.heightAt(x, zz), 0) + 0.6, zz);
    }
    p.needsUpdate = true;
    geometry.computeBoundingSphere();
  });
  return (
    <lineLoop ref={line} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
    </lineLoop>
  );
}

// ---------------------------------------------------------------------------- khói (dùng chung cho bom khói, nổ)

/** Ảnh cụm khói mềm (nhiễu tròn), dùng cho mọi hạt khói. */
let puffTexture: CanvasTexture | null = null;
function puff(): CanvasTexture {
  if (puffTexture) return puffTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 26; k++) {
    const x = 64 + (Math.random() - 0.5) * 50;
    const y = 64 + (Math.random() - 0.5) * 50;
    const r = 18 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  puffTexture = new CanvasTexture(c);
  return puffTexture;
}

/** Hạt khói quay mặt về camera; màu, độ đậm từng hạt theo thuộc tính riêng. */
const puffVertex = /* glsl */ `
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
const puffFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_fragment>
  void main() {
    // Mờ dần về mép tấm (ảnh khói chạm mép thì thấy góc vuông khi đè lên khối khói đặc).
    float a = texture2D(uMap, vUv).a * vTint.a * (1.0 - smoothstep(0.32, 0.5, length(vUv - 0.5)));
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <fog_fragment>
  }
`;

const MAX_PUFFS = 900;

export interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  life: number;
  age: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** Khói dày (bom khói): không mờ dần theo tuổi cho tới gần cuối. */
  dense: boolean;
}

export const puffs: Puff[] = [];

function Puffs() {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const tint = useMemo(() => new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4), []);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    g.setAttribute("aTint", tint);
    return g;
  }, [tint]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uMap: { value: puff() }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
        vertexShader: puffVertex,
        fragmentShader: puffFragment,
        transparent: true,
        depthWrite: false,
        fog: true,
      }),
    [],
  );
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05) * hitStopScale();
    const m = mesh.current;
    if (!m) return;
    // Gió thổi khói nổ, khói đạn trôi đi (bão thì trôi nhanh). Khói của bom khói đứng yên tại chỗ để khớp với
    // vùng che tầm nhìn của server.
    const drift = 0.9 * windStrength.value * dt;
    let n = 0;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        puffs.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (!p.dense) {
        // Càng lên cao gió càng mạnh (cột khói nghiêng dần theo chiều gió).
        const lift = Math.min(2, 0.5 + p.age * 0.3);
        p.x += WIND_X * drift * lift;
        p.z += WIND_Z * drift * lift;
      }
      // Chậm dần theo thời gian (không theo số khung hình).
      const drag = Math.exp(-dt * (p.dense ? 0.55 : 1.2));
      p.vx *= drag;
      p.vz *= drag;
      if (p.dense) p.vy *= drag;
      p.size += p.grow * dt;
      // Quá hạn mức thì bỏ hẳn cụm cũ, không chỉ bỏ qua phần vẽ: trước đây mảng phình vô hạn
      // nên mọi cụm vẫn được tích phân mỗi khung hình dù không hiện, và hiệu ứng mới bị đẩy ra.
      if (n >= MAX_PUFFS) {
        puffs.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      const alpha = p.dense ? p.alpha * Math.min(1, p.age * 1.5) * (1 - Math.max(0, k - 0.8) / 0.2) : p.alpha * (1 - k);
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      tint.setXYZW(n, p.r, p.g, p.b, alpha);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    tint.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, MAX_PUFFS]} frustumCulled={false} renderOrder={6} />;
}

/** Bom khói trong state: thả thêm cụm khói liên tục cho tới khi hết giờ. */
function SmokeEmitters({ room }: { room: IslandRoom }) {
  const acc = useRef(new Map<string, number>());
  useFrame((_, dt) => {
    forEachSmoke(room, (key, smoke) => {
      let a = (acc.current.get(key) ?? 0) + dt;
      // Vừa bị lựu đạn thổi thủng: khoảng trống quanh chỗ nổ, khói bị đẩy ra mép, co dần rồi khói lấp lại.
      if (smoke.clear > 0) {
        const r = SMOKE_CLEAR.radius * Math.min(1, smoke.clear / (SMOKE_CLEAR.seconds * 0.6));
        for (const p of puffs) {
          if (!p.dense) continue;
          const dx = p.x - smoke.cx;
          const dz = p.z - smoke.cz;
          const dd = Math.hypot(dx, dz) || 1;
          if (dd >= r) continue;
          p.vx += (dx / dd) * 10 * dt;
          p.vz += (dz / dd) * 10 * dt;
          p.alpha = Math.max(0.05, p.alpha - dt * 0.8);
        }
      }
      const rate = (smoke.timeLeft > 3 ? 14 : 3) * (smoke.clear > 0 ? 0.25 : 1);
      while (a > 1 / rate) {
        a -= 1 / rate;
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * SMOKE.radius * 0.8;
        const grey = 0.78 + Math.random() * 0.15;
        puffs.push({
          x: smoke.x + Math.cos(ang) * r * 0.3,
          y: smoke.y + 0.4,
          z: smoke.z + Math.sin(ang) * r * 0.3,
          vx: Math.cos(ang) * (1.5 + Math.random() * 2.5),
          vy: 0.25 + Math.random() * 0.45,
          vz: Math.sin(ang) * (1.5 + Math.random() * 2.5),
          size: 2.2,
          grow: 0.75,
          life: Math.min(9, smoke.timeLeft + 2),
          age: 0,
          r: grey,
          g: grey,
          b: grey * 1.02,
          alpha: 0.7,
          dense: true,
        });
      }
      acc.current.set(key, a);
    });
  });
  return null;
}

// ---------------------------------------------------------------------------- nổ

/** Tia lửa, mảnh vụn nóng đỏ văng ra từ vụ nổ (rơi theo trọng lực, tắt dần). */
export interface Ember {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}
export const embers: Ember[] = [];
export const MAX_EMBERS = 360;
/** Mỗi vụ nổ vẽ chừng này cầu lửa con (lệch nhau, nở trễ nhau) cho cầu lửa cuồn cuộn, không tròn trịa. */
const FIREBALLS = 7;
/** Tầng lửa thứ hai: vài cuộn lửa đỏ sẫm bốc lên sau (như nấm lửa), nguội dần thành khói đen của cột khói. */
const RISERS = 4;
const MAX_FIRE = 16 * (FIREBALLS + RISERS);

/** Số giả ngẫu nhiên cố định theo hạt giống vụ nổ và thứ tự quả cầu (hình dạng mỗi vụ một khác, không nhảy mỗi khung). */
function rnd(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Vụ nổ: chớp trắng lúc đầu, cụm cầu lửa cuồn cuộn (vân lửa sinh bằng nhiễu, lõi trắng vàng, rìa cam đỏ rồi tối
 * thành khói), vòng sóng xung kích lan trên mặt đất, tia lửa văng theo đường cong, đèn chớp soi sáng xung quanh.
 * Khói đen, bụi do useBooms thả vào hệ khói chung.
 */
function Blasts() {
  const light = useRef<PointLight>(null);
  const fire = useRef<InstancedMesh>(null);
  const ring = useRef<InstancedMesh>(null);
  const sparks = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const fireMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vK;
          varying float vSeed;
          attribute float aK;
          attribute float aSeed;
          void main() {
            vUv = uv;
            vK = aK;
            vSeed = aSeed;
            vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float size = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(center, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vK;
          varying float vSeed;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int k = 0; k < 4; k++) { v += a * n(p); p *= 2.03; a *= 0.5; }
            return v;
          }
          void main() {
            vec2 p = vUv - 0.5;
            float d = length(p) * 2.0;
            // Vân lửa cuộn: nhiễu trôi lên theo tuổi, mép quả cầu lởm chởm.
            float turb = fbm(p * 3.5 + vec2(vSeed * 7.0, -vK * 2.5 + vSeed));
            float edge = 0.62 + 0.38 * turb;
            float body = 1.0 - smoothstep(edge * 0.55, edge, d);
            if (body <= 0.001) discard;
            float heat = clamp((1.0 - vK * 1.25) * (1.15 - d * 0.7) + (turb - 0.5) * 0.5, 0.0, 1.0);
            vec3 col = mix(vec3(0.12, 0.05, 0.02), vec3(1.0, 0.32, 0.04), smoothstep(0.05, 0.4, heat));
            col = mix(col, vec3(1.0, 0.78, 0.3), smoothstep(0.45, 0.75, heat));
            col = mix(col, vec3(1.0, 0.98, 0.85), smoothstep(0.8, 1.0, heat));
            float glow = 1.5 + 5.0 * heat * heat;
            float alpha = body * (1.0 - smoothstep(0.55, 1.0, vK));
            gl_FragColor = vec4(col * glow * alpha, alpha);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const ringMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vK;
          attribute float aK;
          void main() {
            vUv = uv;
            vK = aK;
            gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vK;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float band = smoothstep(0.7, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));
            float a = band * (1.0 - vK) * 0.55;
            gl_FragColor = vec4(vec3(1.0, 0.85, 0.65) * a * 1.6, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const sparkMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float size = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(center, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = 1.0 - smoothstep(0.0, 1.0, d);
            gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * 5.0 * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const kAttr = useMemo(() => new InstancedBufferAttribute(new Float32Array(MAX_FIRE), 1), []);
  const seedAttr = useMemo(() => new InstancedBufferAttribute(new Float32Array(MAX_FIRE), 1), []);
  const ringK = useMemo(() => new InstancedBufferAttribute(new Float32Array(16), 1), []);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    g.setAttribute("aK", kAttr);
    g.setAttribute("aSeed", seedAttr);
    return g;
  }, [kAttr, seedAttr]);
  const ringGeo = useMemo(() => {
    const g = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    g.setAttribute("aK", ringK);
    return g;
  }, [ringK]);
  const sparkGeo = useMemo(() => new PlaneGeometry(1, 1), []);
  const seen = useRef(new WeakSet<object>());
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05) * hitStopScale();
    const now = performance.now() / 1000;
    let brightest = 0;
    let n = 0;
    let rn = 0;
    const m = fire.current;
    const rm = ring.current;
    for (let i = effects.blasts.length - 1; i >= 0; i--) {
      const b = effects.blasts[i]!;
      const age = now - b.born;
      if (age > 2.2) {
        effects.blasts.splice(i, 1);
        continue;
      }
      if (b.kind === "smoke") continue;
      const flash = b.kind === "flash";
      const big = !!b.big || b.kind === "mine";
      const seed = b.seed ?? 0.5;
      const scale = big ? 1.35 : 1;
      // Vụ nổ mới: tia lửa văng ra.
      if (!seen.current.has(b)) {
        seen.current.add(b);
        const count = flash ? 10 : big ? 46 : 30;
        for (let k = 0; k < count && embers.length < MAX_EMBERS; k++) {
          const a = Math.random() * Math.PI * 2;
          const up = 0.3 + Math.random() * 0.9;
          const sp = (flash ? 5 : 9 + Math.random() * 14) * scale;
          embers.push({ x: b.x, y: b.y + 0.4, z: b.z, vx: Math.cos(a) * sp * (1 - up * 0.5), vy: sp * up, vz: Math.sin(a) * sp * (1 - up * 0.5), age: 0, life: 0.5 + Math.random() * 0.9, size: 0.08 + Math.random() * 0.1 });
        }
      }
      // Bom choáng: chớp trắng rất ngắn, không có cầu lửa.
      if (flash) {
        if (age < 0.25 && m && n < MAX_FIRE) {
          dummy.position.set(b.x, b.y + 0.3, b.z);
          dummy.scale.setScalar(3 + (age / 0.25) * 3);
          dummy.updateMatrix();
          m.setMatrixAt(n, dummy.matrix);
          kAttr.setX(n, Math.min(1, age / 0.25) * 0.4);
          seedAttr.setX(n, seed);
          n++;
        }
      } else if (m) {
        // Cầu lửa: vài quả con lệch nhau quanh tâm, nở trễ nhau, bốc lên và nguội dần thành khói.
        for (let j = 0; j < FIREBALLS && n < MAX_FIRE; j++) {
          const delay = j === 0 ? 0 : 0.02 + rnd(seed, j) * 0.12;
          const life = (big ? 1.25 : 0.95) * (0.75 + rnd(seed, j + 11) * 0.5);
          const t = age - delay;
          if (t < 0 || t > life) continue;
          const k = t / life;
          const a = rnd(seed, j + 23) * Math.PI * 2;
          const spread = j === 0 ? 0 : (0.6 + rnd(seed, j + 31) * 1.4) * scale;
          const grow = 1 - Math.pow(1 - Math.min(1, k * 2.2), 3);
          dummy.position.set(b.x + Math.cos(a) * spread * grow, b.y + 0.6 + (0.4 + rnd(seed, j + 41)) * 2.2 * k * scale + spread * 0.3, b.z + Math.sin(a) * spread * grow);
          dummy.scale.setScalar((j === 0 ? 3.2 : 2 + rnd(seed, j + 51) * 1.8) * scale * (0.35 + grow * 0.9));
          dummy.updateMatrix();
          m.setMatrixAt(n, dummy.matrix);
          kAttr.setX(n, k);
          seedAttr.setX(n, seed + j * 0.37);
          n++;
        }
        // Tầng hai: cuộn lửa bốc cao, nở trễ, nguội sớm (đỏ cam sẫm), nối cầu lửa với cột khói.
        for (let j = 0; j < RISERS && n < MAX_FIRE; j++) {
          const delay = 0.1 + rnd(seed, j + 61) * 0.22;
          const life = (big ? 1.5 : 1.15) * (0.8 + rnd(seed, j + 67) * 0.4);
          const t = age - delay;
          if (t < 0 || t > life) continue;
          const k = t / life;
          const a = rnd(seed, j + 71) * Math.PI * 2;
          const spread = (0.3 + rnd(seed, j + 73) * 0.9) * scale;
          const rise = 1 - Math.pow(1 - k, 2);
          dummy.position.set(b.x + Math.cos(a) * spread, b.y + 1.8 * scale + rise * (3.5 + rnd(seed, j + 79) * 3) * scale, b.z + Math.sin(a) * spread);
          dummy.scale.setScalar((1.6 + rnd(seed, j + 83) * 1.2) * scale * (0.6 + rise * 0.8));
          dummy.updateMatrix();
          m.setMatrixAt(n, dummy.matrix);
          kAttr.setX(n, 0.28 + k * 0.72);
          seedAttr.setX(n, seed + 3.1 + j * 0.53);
          n++;
        }
        // Sóng xung kích: vòng sáng loang trên mặt đất trong 0,4 giây đầu.
        if (rm && age < 0.4 && rn < 16) {
          const k = age / 0.4;
          dummy.position.set(b.x, b.y + 0.15, b.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar((2 + k * (big ? 13 : 9)) * 1);
          dummy.updateMatrix();
          rm.setMatrixAt(rn, dummy.matrix);
          ringK.setX(rn, k);
          rn++;
        }
      }
      const glow = Math.max(0, 1 - age / (flash ? 0.18 : 0.45)) * (flash ? 2.5 : big ? 1.6 : 1);
      if (glow > brightest && light.current) {
        brightest = glow;
        light.current.position.set(b.x, b.y + 2, b.z);
      }
    }
    if (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      kAttr.needsUpdate = true;
      seedAttr.needsUpdate = true;
    }
    if (rm) {
      rm.count = rn;
      rm.instanceMatrix.needsUpdate = true;
      ringK.needsUpdate = true;
    }
    // Tia lửa: bay theo trọng lực, chạm đất thì nảy nhẹ, tắt dần.
    const sm = sparks.current;
    let sn = 0;
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]!;
      e.age += dt;
      if (e.age >= e.life) {
        embers.splice(i, 1);
        continue;
      }
      e.vy -= 9.8 * dt;
      const drag = Math.exp(-dt * 1.2);
      e.vx *= drag;
      e.vz *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      if (sm && sn < MAX_EMBERS) {
        dummy.position.set(e.x, e.y, e.z);
        dummy.scale.setScalar(e.size * (1 - e.age / e.life) * 2.2);
        dummy.updateMatrix();
        sm.setMatrixAt(sn, dummy.matrix);
        sn++;
      }
    }
    if (sm) {
      sm.count = sn;
      sm.instanceMatrix.needsUpdate = true;
    }
    if (light.current) light.current.intensity = brightest * 520;
  });
  return (
    <>
      <pointLight ref={light} color="#ffa24a" distance={55} decay={1.5} intensity={0} />
      <instancedMesh ref={fire} args={[geometry, fireMat, MAX_FIRE]} frustumCulled={false} renderOrder={7} />
      <instancedMesh ref={ring} args={[ringGeo, ringMat, 16]} frustumCulled={false} renderOrder={6} />
      <instancedMesh ref={sparks} args={[sparkGeo, sparkMat, MAX_EMBERS]} frustumCulled={false} renderOrder={8} />
    </>
  );
}

/** Cột khói đen sau vụ nổ: chân cột tiếp tục nhả khói vài giây, khói bốc thẳng lên chừng 20 m rồi nghiêng theo gió. */
interface Plume {
  x: number;
  y: number;
  z: number;
  born: number;
  until: number;
  acc: number;
  big: boolean;
}
const plumes: Plume[] = [];

function Plumes() {
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05) * hitStopScale();
    const now = performance.now() / 1000;
    for (let i = plumes.length - 1; i >= 0; i--) {
      const p = plumes[i]!;
      if (now > p.until) {
        plumes[i] = plumes[plumes.length - 1]!;
        plumes.pop();
        continue;
      }
      // Nhả dày lúc đầu, thưa dần.
      const k = (now - p.born) / (p.until - p.born);
      const rate = (p.big ? 18 : 13) * (1 - k * 0.6);
      p.acc += dt * rate;
      while (p.acc >= 1 && puffs.length < 880) {
        p.acc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * (p.big ? 1.2 : 0.8);
        const dark = 0.05 + Math.random() * 0.08 + k * 0.08;
        const rise = (3.6 + Math.random() * 1.4) * (p.big ? 1.1 : 1);
        puffs.push({
          x: p.x + Math.cos(a) * r,
          y: p.y + 1 + Math.random() * 1.5,
          z: p.z + Math.sin(a) * r,
          vx: Math.cos(a) * 0.4,
          vy: rise,
          vz: Math.sin(a) * 0.4,
          size: (1.6 + Math.random() * 0.8) * (p.big ? 1.25 : 1),
          grow: 1.1 + Math.random() * 0.6,
          // Khói bốc 3,6–5 m/s trong 4,5–5,5 giây: đỉnh cột chừng 20 m.
          life: 4.5 + Math.random(),
          age: 0,
          r: dark,
          g: dark,
          b: dark * 0.96,
          alpha: 0.72,
          dense: false,
        });
      }
      if (p.acc >= 1) p.acc = 0;
    }
  });
  return null;
}

/** Nhận tin nổ, khói từ server: thêm hiệu ứng, tiếng, rung màn hình. */
function useBooms(room: IslandRoom) {
  useEffect(() => {
    const offBoom = room.onMessage(Messages.boom, (raw: BoomMessage) => {
      const now = performance.now() / 1000;
      // Đạn pháo xe tăng nổ (hay xe nổ tung): vẽ và phát tiếng như mìn (to hơn lựu đạn).
      const big = raw.kind === "shell" || raw.kind === "mine";
      const b = { ...raw, kind: raw.kind === "shell" ? ("mine" as const) : raw.kind };
      effects.blasts.push({ kind: b.kind, x: b.x, y: b.y, z: b.z, born: now, big, seed: Math.random() * 10 });
      const d = Math.hypot(b.x - localPosition.x, b.y - localPosition.y, b.z - localPosition.z);
      if (b.kind === "smoke") {
        playSmoke(b);
        return;
      }
      playExplosion(b, b.kind);
      if (b.kind === "flash") {
        // Bom choáng: vài cụm khói trắng mỏng; loá mắt, ù tai do BattleHud đọc từ trạng thái của mình.
        for (let k = 0; k < 6; k++)
          puffs.push({ x: b.x, y: b.y + 0.3, z: b.z, vx: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 2, size: 0.8, grow: 1.2, life: 2.5, age: 0, r: 0.85, g: 0.85, b: 0.85, alpha: 0.35, dense: false });
        return;
      }
      // Sức ép thổi bạt khói gần đó ra xung quanh (server giữ khoảng trống một lúc, SmokeEmitters lo phần còn lại).
      for (const p of puffs) {
        if (!p.dense) continue;
        const dx = p.x - b.x;
        const dz = p.z - b.z;
        const dd = Math.hypot(dx, dz) || 1;
        if (dd > SMOKE_CLEAR.radius * 1.6) continue;
        const push = 14 * (1 - dd / (SMOKE_CLEAR.radius * 1.6));
        p.vx += (dx / dd) * push;
        p.vz += (dz / dd) * push;
        p.vy += push * 0.3;
      }
      shake.amount = Math.min(1.4, shake.amount + Math.max(0, 1.3 - d / 30));
      // Đất đá văng tung toé, cột khói đen tiếp tục bốc lên vài giây sau (cao chừng 20 m, trôi theo gió).
      spawnDebris(b.x, b.y, b.z, big);
      if (plumes.length < 12) plumes.push({ x: b.x, y: b.y, z: b.z, born: now, until: now + (big ? 3.6 : 2.4), acc: 0, big });
      // Cột khói đen cuồn cuộn bốc cao (nở to dần), vòng bụi đất toả sát mặt đất, đất đá tung lên.
      const scale = big ? 1.4 : 1;
      for (let k = 0; k < (big ? 44 : 32); k++) {
        const a = Math.random() * Math.PI * 2;
        const kind = k < 18 ? "column" : k < 34 ? "dust" : "dirt";
        const dark = 0.07 + Math.random() * 0.1;
        const lift = kind === "column" ? (2.5 + Math.random() * 3.5) * scale : kind === "dust" ? 0.25 : 5 + Math.random() * 5;
        const out = kind === "column" ? 0.8 + Math.random() * 1.2 : kind === "dust" ? (7 + Math.random() * 6) * scale : 2 + Math.random() * 3;
        puffs.push({
          x: b.x + Math.cos(a) * 0.4,
          y: b.y + (kind === "column" ? 0.8 + Math.random() * 1.5 : 0.3),
          z: b.z + Math.sin(a) * 0.4,
          vx: Math.cos(a) * out,
          vy: lift,
          vz: Math.sin(a) * out,
          size: (kind === "column" ? 1.8 + Math.random() : kind === "dust" ? 1.4 : 0.6) * scale,
          grow: kind === "column" ? 1.6 + Math.random() : kind === "dust" ? 2.6 : 0.6,
          life: kind === "column" ? 4.5 + Math.random() * 3 : kind === "dust" ? 3 + Math.random() * 1.5 : 1.4,
          age: 0,
          r: kind === "column" ? dark : kind === "dust" ? 0.55 : 0.32,
          g: kind === "column" ? dark : kind === "dust" ? 0.49 : 0.26,
          b: kind === "column" ? dark * 0.95 : kind === "dust" ? 0.4 : 0.2,
          alpha: kind === "column" ? 0.75 : kind === "dust" ? 0.5 : 0.8,
          dense: false,
        });
      }
    });
    const offClick = room.onMessage(Messages.mineClick, (p: { x: number; y: number; z: number }) => playMineBeep(p));
    return () => {
      offBoom();
      offClick();
    };
  }, [room]);
}

// ---------------------------------------------------------------------------- vệt đạn, lửa đầu nòng, chỗ đạn găm

const MAX_TRACERS = 64;

const headV = new Vector3();
const tailV = new Vector3();
const axisV = new Vector3();
const sideV = new Vector3();
const toCam = new Vector3();

function Tracers() {
  const mesh = useRef<InstancedMesh>(null);
  const flashes = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float along = smoothstep(0.0, 0.5, vUv.y);
            gl_FragColor = vec4(vec3(1.0, 0.85, 0.5) * 6.0 * across * along, across * along);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const flashMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float size = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(center, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            // atan(0, 0) không xác định (ra NaN trên vài GPU, NaN qua bloom thành mảng đen nhấp nháy): lệch một chút.
            float a = atan(p.y, p.x + 1e-5);
            float star = 0.55 + 0.45 * pow(abs(cos(a * 3.0)), 6.0);
            float core = 1.0 - smoothstep(0.0, star, r);
            gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * 8.0 * core, core);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const geometry = useMemo(() => new PlaneGeometry(1, 1).translate(0, 0.5, 0), []);
  const flashGeo = useMemo(() => new PlaneGeometry(1, 1), []);
  useFrame(({ camera }) => {
    const now = performance.now() / 1000;
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    for (let i = effects.tracers.length - 1; i >= 0; i--) {
      const t = effects.tracers[i]!;
      const age = now - t.born;
      const dx = t.ex - t.ox;
      const dy = t.ey - t.oy;
      const dz = t.ez - t.oz;
      const len = Math.hypot(dx, dy, dz) || 1;
      // Viên đạn bay đúng sơ tốc của súng, theo đường cong rơi dần (parabol qua nòng và chỗ găm):
      // vệt sáng dài vài mét lướt đi, bắn xa thì thấy rõ đạn võng lên rồi cắm xuống.
      const speed = t.speed ?? 900;
      // Rocket có động cơ (RPG-7): rời ống chậm rồi tăng tốc, cùng công thức với server (flightTime).
      const flight = t.boost ? flightTime(speed, len, t.boost) : len / speed;
      const streak = Math.min(len, Math.max(4, Math.min(14, speed * 0.016)));
      const lag = streak / speed;
      if (age > flight + lag || age > 3) {
        effects.tracers.splice(i, 1);
        continue;
      }
      if (n >= MAX_TRACERS) continue;
      const at = (tau: number, out: Vector3) => {
        const tt = Math.max(0, Math.min(flight, tau));
        const k = t.boost ? Math.min(1, flightDistance(speed, tt, t.boost) / len) : Math.max(0, Math.min(1, tau / flight));
        return out.set(t.ox + dx * k, t.oy + dy * k + 0.5 * BULLET_GRAVITY * tt * (flight - tt), t.oz + dz * k);
      };
      at(age, headV);
      at(age - lag, tailV);
      // Đạn nổ nhả khói dọc đường bay (RPG dày, pháo mỏng).
      if (t.trail && age < flight) {
        const flown = Math.min(len, t.boost ? flightDistance(speed, age, t.boost) : age * speed);
        const gap = t.trail === "rocket" ? 0.9 : 3;
        let sd = t.smoked ?? 0;
        for (; sd < flown && puffs.length < 880; sd += gap) {
          at(t.boost ? flightTime(speed, sd, t.boost) : sd / speed, sideV);
          const grey = t.trail === "rocket" ? 0.72 + Math.random() * 0.1 : 0.8;
          puffs.push({ x: sideV.x, y: sideV.y, z: sideV.z, vx: (Math.random() - 0.5) * 0.4, vy: 0.2 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, size: t.trail === "rocket" ? 0.45 : 0.3, grow: t.trail === "rocket" ? 0.9 : 0.5, life: t.trail === "rocket" ? 2.5 + Math.random() : 1.2, age: 0, r: grey, g: grey, b: grey, alpha: t.trail === "rocket" ? 0.55 : 0.25, dense: false });
        }
        t.smoked = sd;
      }
      axisV.subVectors(headV, tailV);
      const segLen = axisV.length();
      if (segLen < 1e-3) continue;
      axisV.divideScalar(segLen);
      dummy.position.copy(tailV);
      dummy.updateMatrix();
      toCam.subVectors(camera.position, tailV);
      const dist = toCam.length();
      sideV.crossVectors(axisV, toCam).normalize();
      // Xa thì vệt to ra một chút cho còn thấy được (như mắt thấy vệt sáng chói).
      const w = (t.trail === "rocket" ? 0.22 : t.trail === "shell" ? 0.12 : t.mine ? 0.03 : 0.045) * Math.max(1, dist / 45);
      const e = dummy.matrix.elements;
      // Cột 0: bề ngang (vuông góc với vệt và hướng nhìn), cột 1: dọc vệt, cột 2: pháp tuyến.
      e[0] = sideV.x * w;
      e[1] = sideV.y * w;
      e[2] = sideV.z * w;
      e[4] = axisV.x * segLen;
      e[5] = axisV.y * segLen;
      e[6] = axisV.z * segLen;
      m.setMatrixAt(n, dummy.matrix);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;

    const f = flashes.current;
    let fn = 0;
    for (let i = effects.flashes.length - 1; i >= 0; i--) {
      const fl = effects.flashes[i]!;
      const age = now - fl.born;
      if (age > 0.06) {
        effects.flashes.splice(i, 1);
        continue;
      }
      if (f && fn < 16 && !fl.lightOnly) {
        dummy.position.set(fl.x, fl.y, fl.z);
        dummy.scale.setScalar(0.18 + Math.random() * 0.14);
        dummy.rotation.set(0, 0, Math.random() * 6);
        dummy.updateMatrix();
        f.setMatrixAt(fn++, dummy.matrix);
      }
    }
    if (f) {
      f.count = fn;
      f.instanceMatrix.needsUpdate = true;
    }
    // Đèn chớp đầu nòng: MuzzleLights đọc cùng hàng đợi `effects.flashes`.
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, MAX_TRACERS]} frustumCulled={false} renderOrder={8} />
      <instancedMesh ref={flashes} args={[flashGeo, flashMat, 16]} frustumCulled={false} renderOrder={8} />
    </>
  );
}

/**
 * Chỗ đạn của người khác găm vào: server chỉ gửi điểm cuối, nên dò lại tia trên máy mình để biết mặt nào (pháp tuyến,
 * chất liệu, để lỗ đạn nằm áp đúng mặt tường). Trúng người thì phụt máu; bay ra ngoài xa thì thôi.
 */
function remoteImpact(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, now: number, speed: number) {
  const dx = ex - ox;
  const dy = ey - oy;
  const dz = ez - oz;
  const len = Math.hypot(dx, dy, dz) || 1;
  // Đạn tới nơi sau chừng này giây (bụi, lỗ đạn hiện đúng lúc vệt đạn cắm tới).
  const flight = len / speed;
  const at = now + flight;
  for (const b of [...bodies.values(), { x: localPosition.x, y: localPosition.y, z: localPosition.z, crouch: stance.crouching, prone: stance.prone, alive: true }]) {
    if (!b.alive) continue;
    const top = b.y + (b.prone ? 0.6 : b.crouch ? 1.3 : 1.8);
    if (Math.hypot(ex - b.x, ez - b.z) < (b.prone ? 1.1 : 0.45) && ey > b.y - 0.1 && ey < top) {
      effects.impacts.push({ x: ex, y: ey, z: ez, nx: (ox - ex) * 0.02, ny: 0.2, nz: (oz - ez) * 0.02, born: now, blood: true, at });
      // Máu phụt theo hướng đạn; điểm cuối cao ngang đầu (đứng thẳng, ngồi xổm) thì là trúng đầu.
      sprayBlood(ex, ey, ez, dx, dy, dz, { head: !b.prone && ey > b.y + (b.crouch ? 1.04 : 1.5), at });
      return;
    }
  }
  // Hướng bay lúc cắm xuống (tiếp tuyến cuối đường cong: ngang theo dây cung, dọc chúi xuống do rơi).
  let tx = dx / flight;
  let ty = dy / flight - 0.5 * BULLET_GRAVITY * flight;
  let tz = dz / flight;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  // Xa quá thì khỏi dò (không thấy rõ lỗ đạn), chỉ phụt bụi.
  const far = Math.hypot(ex - localPosition.x, ez - localPosition.z) > 160;
  const back = Math.min(2, len);
  const hit = far ? null : physicsProbe.cast?.(ex - tx * back, ey - ty * back, ez - tz * back, tx, ty, tz, back + 1);
  if (hit && Math.abs(hit.t - back) < 0.8) {
    const t = hit.t - back;
    effects.impacts.push({ x: ex + tx * t, y: ey + ty * t, z: ez + tz * t, nx: hit.nx, ny: hit.ny, nz: hit.nz, born: now, blood: false, at });
    return;
  }
  // Không rõ mặt (ngoài tầm dò, hay đạn bay mất hút): chỉ phụt bụi ngược về phía người bắn, không để lỗ.
  if (len > 590) return;
  effects.impacts.push({ x: ex, y: ey, z: ez, nx: -tx, ny: -ty, nz: -tz, born: now, blood: false, noHole: true, at });
}

/** Phát bắn của người khác: vệt đạn, lửa đầu nòng, tiếng súng, tiếng đạn rít qua đầu nếu sượt gần mình. */
/** Dùng lại cho mỗi phát (khỏi tạo đối tượng mới). */
const approach: Approach = { t: 0, miss: 0, x: 0, y: 0, z: 0, len: 0 };

function useShots(room: IslandRoom) {
  useEffect(() => {
    // Âm thanh dò môi trường (phố, đồi, rừng, trong nhà) trên bản đồ trận đang chơi.
    setAcousticMap(() => mapForMode(room.state.battleMode, room.state.worldSeed));
    const off = room.onMessage(Messages.shot, (m: ShotMessage) => {
      const now = performance.now() / 1000;
      const [ox, oy, oz] = m.o;
      const alive = room.state.players.get(myId(room))?.alive ?? false;
      if (m.w === "tank") {
        // Pháo xe tăng: vệt đạn to bay chậm (nổ do tin "boom" lo), lửa đầu nòng do xe tăng tự vẽ.
        const [ex, ey, ez] = m.e[0] ?? m.o;
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: m.id === myId(room), speed: TANK.velocity, trail: "shell" });
        if (m.id !== myId(room)) playCannon({ x: ox, y: oy, z: oz }, false);
        return;
      }
      if (m.w === "m203") {
        // Phóng lựu M203 (lính Đột Kích): quả 40 mm bay chậm theo đường cong, tiếng "bụp" trầm (nổ do tin "boom" lo).
        const [ex, ey, ez] = m.e[0] ?? m.o;
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: m.id === myId(room), speed: M203.velocity, trail: "shell" });
        if (m.id !== myId(room)) {
          effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
          playLauncher({ x: ox, y: oy, z: oz });
        }
        return;
      }
      const launcher = WEAPON.get(m.w);
      if (launcher?.explosive) {
        // RPG: quả đạn có lửa đuôi và vệt khói dài; khói phụt ngược ra sau ống phóng.
        const [ex, ey, ez] = m.e[0] ?? m.o;
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: m.id === myId(room), speed: launcher.velocity, boost: launcher.boost, trail: "rocket" });
        effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
        const l = Math.hypot(ex - ox, ez - oz) || 1;
        for (let k = 0; k < 10; k++)
          puffs.push({ x: ox - ((ex - ox) / l) * 1.2, y: oy, z: oz - ((ez - oz) / l) * 1.2, vx: (-(ex - ox) / l) * (3 + Math.random() * 4) + (Math.random() - 0.5), vy: Math.random() * 0.8, vz: (-(ez - oz) / l) * (3 + Math.random() * 4) + (Math.random() - 0.5), size: 0.6, grow: 1.4, life: 2 + Math.random(), age: 0, r: 0.8, g: 0.8, b: 0.78, alpha: 0.5, dense: false });
        if (m.id !== myId(room)) playGunshot(m.w, { x: ox, y: oy, z: oz }, false);
        return;
      }
      // Giảm thanh: không loé lửa, tiếng đục nhỏ (ở xa không nghe thấy).
      if (!m.s) effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
      playGunshot(m.w, { x: ox, y: oy, z: oz }, false, !!m.s);
      const def = WEAPON.get(m.w);
      if (def?.class === "sniper") setTimeout(() => playBolt(), 450);
      // Vỏ đạn của người bắn gần mình: văng ra bên phải người bắn, sau đầu nòng chừng nửa mét.
      if (def && def.class !== "shotgun" && m.e[0] && Math.hypot(ox - localPosition.x, oz - localPosition.z) < 25) {
        const [ex, , ez] = m.e[0];
        const l = Math.hypot(ex - ox, ez - oz) || 1;
        const fx = (ex - ox) / l;
        const fz = (ez - oz) / l;
        const sp = 1.6 + Math.random();
        effects.casings.push({
          x: ox - fx * 0.5,
          y: oy - 0.03,
          z: oz - fz * 0.5,
          vx: -fz * sp,
          vy: 1.3 + Math.random(),
          vz: fx * sp,
          at: now + (def.class === "sniper" ? 0.55 : 0),
          kind: "brass",
          size: def.class === "pistol" || def.class === "smg" ? 0.75 : def.class === "sniper" || def.class === "dmr" ? 1.3 : 1,
        });
      }
      // Đạn sượt qua đầu mình: tìm điểm gần tai nhất trên đường đạn (người đang xem, nếu mình đã gục).
      const ear = audio.listener;
      const eyeX = localPosition.x;
      const eyeY = localPosition.y + (stance.prone ? 0.35 : stance.crouching ? 1.1 : 1.6);
      const eyeZ = localPosition.z;
      const lx = alive ? eyeX : ear.x;
      const ly = alive ? eyeY : ear.y;
      const lz = alive ? eyeZ : ear.z;
      let whizzed = false;
      // Bắn nhau ở rất xa (ngoài tầm sương mù): chỉ còn tiếng, khỏi vẽ vệt đạn, dò lỗ đạn.
      const farFrom = (x: number, z: number) => Math.hypot(x - localPosition.x, z - localPosition.z) > 260;
      if (farFrom(ox, oz) && m.e.every(([ex, , ez]) => farFrom(ex, ez))) return;
      for (const [ex, ey, ez] of m.e) {
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: false, speed: def?.velocity });
        remoteImpact(ox, oy, oz, ex, ey, ez, now, def?.velocity ?? 900);
        if (whizzed || m.id === myId(room)) continue;
        const a = closestApproach(ox, oy, oz, ex, ey, ez, lx, ly, lz, approach);
        // Đạn găm vào chính mình (điểm cuối sát người) thì đã có tiếng trúng đạn.
        const intoMe = Math.hypot(ex - lx, ey - ly, ez - lz) < 0.9;
        if (intoMe) continue;
        // Đạn siêu thanh: tiếng nứt "CHÁT!" tới lúc đạn bay ngang, tiếng nổ đầu nòng (playGunshot ở trên) tới sau theo
        // khoảng cách / 343. Đạn cận âm hay giảm thanh: chỉ rít khi sượt gần.
        const velocity = def?.velocity ?? 900;
        const fb = flybyTiming(a.t, a.miss, a.t < a.len - 0.5, Math.hypot(ox - lx, oy - ly, oz - lz), velocity, !!m.s);
        if (fb.zone === "none") continue;
        playBulletWhiz({ x: a.x, y: a.y, z: a.z }, a.miss, fb.crackDelay, velocity, fb.supersonic);
        whizzed = true;
        if (!alive) continue;
        if (fb.zone === "snap") {
          // Đạn sượt sát đầu (dưới 1 m): giật thót, rung nhẹ màn hình, bị áp chế một thoáng (tối mép, tiếng hụt đi).
          const hit = () => {
            shake.amount = Math.min(0.5, shake.amount + 0.16);
            suppression.amount = Math.min(1, suppression.amount + 0.55);
            playSuppressed(0.8);
          };
          if (fb.crackDelay > 0.03) setTimeout(hit, fb.crackDelay * 1000);
          else hit();
        } else if (fb.zone === "whiz" && a.miss < 2) shake.amount = Math.min(0.4, shake.amount + 0.04);
      }
    });
    return () => {
      off();
      setAcousticMap(null);
    };
  }, [room]);
}

// ---------------------------------------------------------------------------- lựu đạn đang bay, mìn của mình

function Grenades({ room }: { room: IslandRoom }) {
  const [list, setList] = useState<[string, ProjectileState][]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    // Tên lửa TOW vẽ riêng (StreakWorld.tsx).
    const refresh = () => setList([...(room.state.projectiles as unknown as Map<string, ProjectileState>).entries()].filter(([, p]) => p.itemId !== "tow"));
    const a = callbacks.onAdd("projectiles", refresh);
    const r = callbacks.onRemove("projectiles", refresh);
    refresh();
    return () => {
      a();
      r();
    };
  }, [room]);
  return (
    <>
      {list.map(([key, p]) => (
        <Grenade key={key} p={p} />
      ))}
    </>
  );
}

function Grenade({ p }: { p: ProjectileState }) {
  const g = useRef<Mesh>(null);
  const lastY = useRef(p.y);
  const falling = useRef(false);
  useFrame((_, dt) => {
    const m = g.current;
    if (!m) return;
    const k = Math.min(1, dt * 18);
    m.position.x += (p.x - m.position.x) * k;
    m.position.y += (p.y - m.position.y) * k;
    m.position.z += (p.z - m.position.z) * k;
    m.rotation.x += dt * 9;
    m.rotation.z += dt * 6;
    // Nảy trên đất: đang rơi rồi bật lên thì kêu "cộp".
    if (p.y > lastY.current + 0.01 && falling.current) playGrenadeBounce(p);
    falling.current = p.y < lastY.current - 0.01;
    lastY.current = p.y;
  });
  return (
    <mesh ref={g} position={[p.x, p.y, p.z]} castShadow>
      <sphereGeometry args={[0.07, 10, 8]} />
      <meshStandardMaterial color={p.itemId === "smoke" ? "#6f7d6a" : "#3f4a2c"} roughness={0.6} metalness={0.3} />
    </mesh>
  );
}

function MyMines({ room }: { room: IslandRoom }) {
  const [mines, setMines] = useState<{ x: number; y: number; z: number; at?: boolean }[]>([]);
  useEffect(
    () =>
      room.onMessage(Messages.myMines, (list: { x: number; y: number; z: number; at?: boolean }[]) => {
        setMines(list);
        setBattleHud({ myMines: list });
      }),
    [room],
  );
  void getBattleHud;
  return (
    <>
      {mines.map((m, i) =>
        m.at ? (
          // Mìn chống tăng (lính Kỹ Thuật): đĩa to, chỉ mình thấy.
          <group key={i} position={[m.x, m.y - 0.02, m.z]}>
            <LootModel id="atmine" />
          </group>
        ) : (
        <group key={i} position={[m.x, m.y + 0.03, m.z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.16, 0.18, 0.07, 16]} />
            <meshStandardMaterial color="#3d4630" roughness={0.7} metalness={0.3} />
          </mesh>
          <mesh position-y={0.05}>
            <sphereGeometry args={[0.025, 8, 6]} />
            <meshBasicMaterial color="#ff3020" toneMapped={false} />
          </mesh>
        </group>
        ),
      )}
    </>
  );
}

/** Skin súng neon (gacha huyền thoại): cho vân phát sáng nhịp nhàng. */
function NeonPulse() {
  useFrame(({ clock }) => pulseNeon(clock.elapsedTime));
  return null;
}

export function BattleEffects({ room, world }: { room: IslandRoom; world: World }) {
  useBooms(room);
  useShots(room);
  void FRAG;
  void battleMap;
  return (
    <>
      <ZoneWall room={room} />
      <NextZone room={room} world={world} />
      <SmokeShells room={room} />
      <Puffs />
      <SmokeEmitters room={room} />
      <Blasts />
      <Plumes />
      <Debris world={world} />
      <Tracers />
      <MuzzleLights />
      <BulletHoles world={world} />
      <Casings world={world} />
      <Blood room={room} world={world} />
      <NeonPulse />
      <Grenades room={room} />
      <MyMines room={room} />
    </>
  );
}
