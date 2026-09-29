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
import { BULLET_GRAVITY, FRAG, SMOKE, SMOKE_CLEAR, TANK, battleMap, type World } from "@tentides/content";
import type { BoomMessage, ProjectileState, ShotMessage, SmokeState } from "@tentides/protocol";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { localPosition, shake } from "../shared.ts";
import { audio } from "../sound/engine.ts";
import { playExplosion, playGrenadeBounce, playGunshot, playBulletWhiz, playMineBeep, playSmoke, playBolt, playCannon } from "../sound/guns.ts";
import { WEAPON } from "@tentides/content";
import { bodies, effects, getBattleHud, setBattleHud, stance } from "./runtime.ts";
import { BulletHoles } from "./Decals.tsx";
import { Casings } from "./Casings.tsx";
import { physicsProbe } from "./surface.ts";

// Hiệu ứng của trận đấu: tường vùng an toàn (màn xanh cao vút, vân chạy), vòng kế tiếp vẽ trên mặt đất,
// bom khói (hàng chục cụm khói mềm che tầm nhìn), vụ nổ (quả cầu lửa, chớp sáng, khói đen, mảnh văng, rung màn hình),
// vệt đạn, lửa đầu nòng, bụi và tia lửa chỗ đạn găm, lựu đạn đang bay và mìn của mình.

// ---------------------------------------------------------------------------- vùng an toàn

const zoneVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
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
    const on = room.state.phase === "battle" && z.r > 0.5;
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
    float a = texture2D(uMap, vUv).a * vTint.a;
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
    const dt = Math.min(rawDt, 0.05);
    const m = mesh.current;
    if (!m) return;
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
      // Chậm dần theo thời gian (không theo số khung hình).
      const drag = Math.exp(-dt * (p.dense ? 0.55 : 1.2));
      p.vx *= drag;
      p.vz *= drag;
      if (p.dense) p.vy *= drag;
      p.size += p.grow * dt;
      if (n >= MAX_PUFFS) continue;
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
    for (const [key, smoke] of room.state.smokes as unknown as Map<string, SmokeState>) {
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
    }
  });
  return null;
}

// ---------------------------------------------------------------------------- nổ

function Blasts() {
  const light = useRef<PointLight>(null);
  const fire = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const fireMat = useMemo(
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
            vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float size = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(center, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vK;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float core = 1.0 - smoothstep(0.0, 1.0, d);
            vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.6, vK + d * 0.4));
            gl_FragColor = vec4(col * 4.0 * core * (1.0 - vK), core * (1.0 - vK));
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const kAttr = useMemo(() => new InstancedBufferAttribute(new Float32Array(32), 1), []);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    g.setAttribute("aK", kAttr);
    return g;
  }, [kAttr]);
  useFrame(() => {
    const now = performance.now() / 1000;
    let brightest = 0;
    let n = 0;
    const m = fire.current;
    for (let i = effects.blasts.length - 1; i >= 0; i--) {
      const b = effects.blasts[i]!;
      const age = now - b.born;
      if (age > 1.2) {
        effects.blasts.splice(i, 1);
        continue;
      }
      if (b.kind === "smoke") continue;
      const flash = b.kind === "flash";
      // Bom choáng: chớp trắng rất ngắn, không có cầu lửa.
      if (flash && age > 0.25) continue;
      const k = Math.min(1, age / (flash ? 0.25 : 0.55));
      if (m && n < 32) {
        dummy.position.set(b.x, b.y + (flash ? 0.3 : 0.8 + age * 2), b.z);
        dummy.scale.setScalar(flash ? 3 + k * 2 : 2 + k * (b.kind === "mine" ? 7 : 6));
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        kAttr.setX(n, k);
        n++;
      }
      const glow = Math.max(0, 1 - age / (flash ? 0.18 : 0.35)) * (flash ? 2.5 : 1);
      if (glow > brightest && light.current) {
        brightest = glow;
        light.current.position.set(b.x, b.y + 1.5, b.z);
      }
    }
    if (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      kAttr.needsUpdate = true;
    }
    if (light.current) light.current.intensity = brightest * 400;
  });
  return (
    <>
      <pointLight ref={light} color="#ffb060" distance={40} decay={1.6} intensity={0} />
      <instancedMesh ref={fire} args={[geometry, fireMat, 32]} frustumCulled={false} renderOrder={7} />
    </>
  );
}

/** Nhận tin nổ, khói từ server: thêm hiệu ứng, tiếng, rung màn hình. */
function useBooms(room: IslandRoom) {
  useEffect(() => {
    const offBoom = room.onMessage(Messages.boom, (raw: BoomMessage) => {
      const now = performance.now() / 1000;
      // Đạn pháo xe tăng nổ (hay xe nổ tung): vẽ và phát tiếng như mìn (to hơn lựu đạn).
      const b = { ...raw, kind: raw.kind === "shell" ? ("mine" as const) : raw.kind };
      effects.blasts.push({ kind: b.kind, x: b.x, y: b.y, z: b.z, born: now });
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
      // Khói đen bốc lên, bụi toả ra quanh chân.
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * Math.PI * 2;
        const up = k < 12;
        const dark = 0.12 + Math.random() * 0.12;
        puffs.push({
          x: b.x,
          y: b.y + (up ? 0.8 : 0.3),
          z: b.z,
          vx: Math.cos(a) * (up ? 1.5 : 6 + Math.random() * 4),
          vy: up ? 2.5 + Math.random() * 2 : 0.3,
          vz: Math.sin(a) * (up ? 1.5 : 6 + Math.random() * 4),
          size: up ? 2 : 1.5,
          grow: up ? 1.8 : 2.4,
          life: 3 + Math.random() * 2,
          age: 0,
          r: up ? dark : 0.55,
          g: up ? dark : 0.5,
          b: up ? dark : 0.42,
          alpha: up ? 0.7 : 0.45,
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
  const light = useRef<PointLight>(null);
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
      const flight = len / speed;
      const streak = Math.min(len, Math.max(4, Math.min(14, speed * 0.016)));
      const lag = streak / speed;
      if (age > flight + lag || age > 3) {
        effects.tracers.splice(i, 1);
        continue;
      }
      if (n >= MAX_TRACERS) continue;
      const at = (tau: number, out: Vector3) => {
        const k = Math.max(0, Math.min(1, tau / flight));
        const tt = Math.max(0, Math.min(flight, tau));
        return out.set(t.ox + dx * k, t.oy + dy * k + 0.5 * BULLET_GRAVITY * tt * (flight - tt), t.oz + dz * k);
      };
      at(age, headV);
      at(age - lag, tailV);
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
      const w = (t.mine ? 0.03 : 0.045) * Math.max(1, dist / 45);
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
    let lit = 0;
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
      if (light.current && lit === 0) {
        light.current.position.set(fl.x, fl.y, fl.z);
        lit = 1;
      }
    }
    if (f) {
      f.count = fn;
      f.instanceMatrix.needsUpdate = true;
    }
    if (light.current) light.current.intensity = lit ? 25 : 0;
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, MAX_TRACERS]} frustumCulled={false} renderOrder={8} />
      <instancedMesh ref={flashes} args={[flashGeo, flashMat, 16]} frustumCulled={false} renderOrder={8} />
      <pointLight ref={light} color="#ffc070" distance={12} decay={2} intensity={0} />
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
function useShots(room: IslandRoom) {
  useEffect(() => {
    return room.onMessage(Messages.shot, (m: ShotMessage) => {
      const now = performance.now() / 1000;
      const [ox, oy, oz] = m.o;
      const alive = room.state.players.get(myId(room))?.alive ?? false;
      if (m.w === "tank") {
        // Pháo xe tăng: vệt đạn to bay chậm (nổ do tin "boom" lo), lửa đầu nòng do xe tăng tự vẽ.
        const [ex, ey, ez] = m.e[0] ?? m.o;
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: m.id === myId(room), speed: TANK.velocity });
        if (m.id !== myId(room)) playCannon({ x: ox, y: oy, z: oz }, false);
        return;
      }
      effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
      playGunshot(m.w, { x: ox, y: oy, z: oz }, false);
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
        const dx = ex - ox;
        const dy = ey - oy;
        const dz = ez - oz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const t = Math.max(0, Math.min(len, ((lx - ox) * dx + (ly - oy) * dy + (lz - oz) * dz) / len));
        const cx = ox + (dx / len) * t;
        const cy = oy + (dy / len) * t;
        const cz = oz + (dz / len) * t;
        const miss = Math.hypot(cx - lx, cy - ly, cz - lz);
        // Đạn găm vào chính mình (điểm cuối sát người) thì đã có tiếng trúng đạn.
        const intoMe = Math.hypot(ex - lx, ey - ly, ez - lz) < 0.9;
        if (t > 4 && miss < 7 && !intoMe) {
          playBulletWhiz({ x: cx, y: cy, z: cz }, miss, t / (def?.velocity ?? 900), def?.velocity ?? 900);
          whizzed = true;
          // Đạn sượt sát đầu: giật mình (rung nhẹ màn hình).
          if (miss < 1.5 && alive) shake.amount = Math.min(0.4, shake.amount + 0.08);
        }
      }
    });
  }, [room]);
}

// ---------------------------------------------------------------------------- lựu đạn đang bay, mìn của mình

function Grenades({ room }: { room: IslandRoom }) {
  const [list, setList] = useState<[string, ProjectileState][]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () => setList([...(room.state.projectiles as unknown as Map<string, ProjectileState>).entries()]);
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
  const [mines, setMines] = useState<{ x: number; y: number; z: number }[]>([]);
  useEffect(
    () =>
      room.onMessage(Messages.myMines, (list: { x: number; y: number; z: number }[]) => {
        setMines(list);
        setBattleHud({ myMines: list });
      }),
    [room],
  );
  void getBattleHud;
  return (
    <>
      {mines.map((m, i) => (
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
      ))}
    </>
  );
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
      <Puffs />
      <SmokeEmitters room={room} />
      <Blasts />
      <Tracers />
      <BulletHoles world={world} />
      <Casings world={world} />
      <Grenades room={room} />
      <MyMines room={room} />
    </>
  );
}
