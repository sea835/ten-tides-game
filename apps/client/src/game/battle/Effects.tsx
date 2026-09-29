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
  type InstancedMesh,
  type LineLoop,
  type Mesh,
  type PointLight,
} from "three";
import { FRAG, SMOKE, battleMap, type World } from "@tentides/content";
import type { BoomMessage, ProjectileState, ShotMessage, SmokeState } from "@tentides/protocol";
import { Messages } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { localPosition, shake } from "../shared.ts";
import { playExplosion, playGrenadeBounce, playGunshot, playBulletWhiz, playMineBeep, playSmoke, playBolt } from "../sound/guns.ts";
import { WEAPON } from "@tentides/content";
import { effects, getBattleHud, setBattleHud } from "./runtime.ts";

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

interface Puff {
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
      const rate = smoke.timeLeft > 3 ? 14 : 3;
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
      const k = Math.min(1, age / 0.55);
      if (m && n < 32) {
        dummy.position.set(b.x, b.y + 0.8 + age * 2, b.z);
        dummy.scale.setScalar(2 + k * (b.kind === "mine" ? 7 : 6));
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        kAttr.setX(n, k);
        n++;
      }
      const glow = Math.max(0, 1 - age / 0.35);
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
    const offBoom = room.onMessage(Messages.boom, (b: BoomMessage) => {
      const now = performance.now() / 1000;
      effects.blasts.push({ kind: b.kind, x: b.x, y: b.y, z: b.z, born: now });
      const d = Math.hypot(b.x - localPosition.x, b.y - localPosition.y, b.z - localPosition.z);
      if (b.kind === "smoke") {
        playSmoke(b);
        return;
      }
      playExplosion(b, b.kind);
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
            float a = atan(p.y, p.x);
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
      const len = Math.hypot(dx, dy, dz);
      // Viên đạn bay 900 m/s: vệt dài vài mét lướt từ nòng tới đích.
      const travel = age * 900;
      if (travel > len + 6 || age > 0.6) {
        effects.tracers.splice(i, 1);
        continue;
      }
      if (n >= MAX_TRACERS) continue;
      const head = Math.min(len, travel);
      const tail = Math.max(0, head - Math.min(12, len * 0.5));
      const k0 = tail / (len || 1);
      const k1 = head / (len || 1);
      dummy.position.set(t.ox + dx * k0, t.oy + dy * k0, t.oz + dz * k0);
      dummy.lookAt(t.ox + dx * k1, t.oy + dy * k1, t.oz + dz * k1);
      dummy.rotateX(Math.PI / 2);
      // Xoay tấm quanh trục vệt cho quay mặt về camera.
      const toCam = camera.position.clone().sub(dummy.position);
      dummy.updateMatrix();
      const axis = { x: dx / len, y: dy / len, z: dz / len };
      const side = { x: axis.y * toCam.z - axis.z * toCam.y, y: axis.z * toCam.x - axis.x * toCam.z, z: axis.x * toCam.y - axis.y * toCam.x };
      const sl = Math.hypot(side.x, side.y, side.z) || 1;
      const w = t.mine ? 0.035 : 0.05;
      const e = dummy.matrix.elements;
      // Cột 0: bề ngang (vuông góc với vệt và hướng nhìn), cột 1: dọc vệt, cột 2: pháp tuyến.
      e[0] = (side.x / sl) * w;
      e[1] = (side.y / sl) * w;
      e[2] = (side.z / sl) * w;
      e[4] = dx * (k1 - k0);
      e[5] = dy * (k1 - k0);
      e[6] = dz * (k1 - k0);
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
      if (f && fn < 16) {
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

    // Chỗ đạn găm: bụi (hoặc máu) phụt ra.
    for (const imp of effects.impacts.splice(0)) {
      const blood = imp.blood;
      for (let k = 0; k < (blood ? 5 : 4); k++) {
        puffs.push({
          x: imp.x,
          y: imp.y,
          z: imp.z,
          vx: imp.nx * (1 + Math.random() * 2) + (Math.random() - 0.5),
          vy: imp.ny * (1 + Math.random() * 2) + Math.random() * 0.6,
          vz: imp.nz * (1 + Math.random() * 2) + (Math.random() - 0.5),
          size: blood ? 0.25 : 0.3,
          grow: blood ? 0.6 : 1.2,
          life: blood ? 0.5 : 0.9,
          age: 0,
          r: blood ? 0.45 : 0.62,
          g: blood ? 0.03 : 0.57,
          b: blood ? 0.03 : 0.5,
          alpha: blood ? 0.9 : 0.6,
          dense: false,
        });
      }
    }
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, MAX_TRACERS]} frustumCulled={false} renderOrder={8} />
      <instancedMesh ref={flashes} args={[flashGeo, flashMat, 16]} frustumCulled={false} renderOrder={8} />
      <pointLight ref={light} color="#ffc070" distance={12} decay={2} intensity={0} />
    </>
  );
}

/** Phát bắn của người khác: vệt đạn, lửa đầu nòng, tiếng súng, tiếng đạn rít qua đầu nếu sượt gần mình. */
function useShots(room: IslandRoom) {
  useEffect(() => {
    return room.onMessage(Messages.shot, (m: ShotMessage) => {
      const now = performance.now() / 1000;
      const [ox, oy, oz] = m.o;
      effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
      playGunshot(m.w, { x: ox, y: oy, z: oz }, false);
      const def = WEAPON.get(m.w);
      if (def?.class === "sniper") setTimeout(() => playBolt(), 450);
      let whizzed = false;
      for (const [ex, ey, ez] of m.e) {
        effects.tracers.push({ ox, oy, oz, ex, ey, ez, born: now, mine: false });
        effects.impacts.push({ x: ex, y: ey, z: ez, nx: (ox - ex) * 0.05, ny: 0.5, nz: (oz - ez) * 0.05, born: now, blood: false });
        if (whizzed) continue;
        // Điểm gần mình nhất trên đường đạn.
        const dx = ex - ox;
        const dy = ey - oy;
        const dz = ez - oz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const px = localPosition.x - ox;
        const py = localPosition.y + 1.6 - oy;
        const pz = localPosition.z - oz;
        const t = Math.max(0, Math.min(len, (px * dx + py * dy + pz * dz) / len));
        const cx = ox + (dx / len) * t;
        const cy = oy + (dy / len) * t;
        const cz = oz + (dz / len) * t;
        if (t > 3 && Math.hypot(cx - localPosition.x, cy - localPosition.y - 1.6, cz - localPosition.z) < 4) {
          playBulletWhiz({ x: cx, y: cy, z: cz });
          whizzed = true;
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
      <Grenades room={room} />
      <MyMines room={room} />
    </>
  );
}
