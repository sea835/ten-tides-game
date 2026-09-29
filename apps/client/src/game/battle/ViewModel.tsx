import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  CircleGeometry,
  ShaderMaterial,
  Vector3,
  type Group,
  type Mesh,
} from "three";
import { SIGHTS, WEAPON, type SightId } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { camoTexture } from "../camo.ts";
import { DRAW_ON_TOP_GLSL, GunModel, aimLineHeight, drawOnTop, muzzleOffset, opticHeight, railMount, supportOffset, viewMaterial } from "../GunModel.tsx";
import { view } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun } from "./Shooter.tsx";
import { effects, muzzle, recoil, stance } from "./runtime.ts";

// Súng trước mặt khi nhìn bằng mắt (góc thứ nhất): cầm thấp bên phải, lắc theo bước chân, trễ theo cú xoay chuột,
// giật như lò xo khi bắn (báng lùi vào vai, nòng hất lên, lệch ngang, nghiêng), nhún khi đáp đất; ngắm thì nâng
// lên giữa mắt cho thước ngắm trùng tâm màn hình; thay đạn thì hạ nòng xuống; dí sát tường thì dựng nòng lên, kéo
// súng về ngực. Vật liệu vẽ đè lên cảnh (viewMaterial) nên không bao giờ xuyên qua tường. Nhìn qua ống ngắm thì ẩn.
// Hai bàn tay đeo găng nắm tay cầm và ốp lót tay, cẳng tay mặc vải rằn ri đúng bộ đang mặc; ống ngắm lắp trên ray,
// kính phản xạ có chấm đỏ / vòng holo sáng; bắn thì lửa loé ở đầu nòng (sao lửa trước mặt, lưỡi lửa hai bên).

const HIP = new Vector3(0.24, -0.25, -0.5);
const flashPos = new Vector3();
const offset = new Vector3();
const q = new Quaternion();
const tilt = new Quaternion();
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const axisZ = new Vector3(0, 0, 1);

/** Lò xo tắt dần (gần tới hạn) cho từng trục giật. */
interface Spring {
  x: number;
  v: number;
}
function step(sp: Spring, dt: number, k: number, c: number) {
  sp.v += (-k * sp.x - c * sp.v) * dt;
  sp.x += sp.v * dt;
}

export function ViewModel({ room }: { room: IslandRoom }) {
  const g = useRef<Group>(null);
  const s = useRef({
    aim: 0,
    bob: 0,
    drop: 0,
    wall: 0,
    sprint: 0,
    yawLag: 0,
    pitchLag: 0,
    lastYaw: 0,
    lastPitch: 0,
    fired: 0,
    back: { x: 0, v: 0 } as Spring,
    rise: { x: 0, v: 0 } as Spring,
    side: { x: 0, v: 0 } as Spring,
    roll: { x: 0, v: 0 } as Spring,
    land: { x: 0, v: 0 } as Spring,
    lastLand: 0,
  });
  const held = useRoomSnapshot(room, (st) => {
    const p = st.players.get(myId(room));
    const k = p?.kit;
    if (!k || !p.alive) return "";
    const slot = k.active;
    const w = slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "";
    const sg = slot === "primary1" ? k.sight1 : slot === "primary2" ? k.sight2 : slot === "pistol" ? k.sightP : "";
    return w ? `${w}|${sg}|${k.outfit}` : "";
  });
  const [weapon = "", sightId = "", outfit = "woodland"] = held.split("|");
  const def = WEAPON.get(weapon);
  const sight = def ? aimLineHeight(weapon, sightId) : 0;
  const flash = useRef<Group>(null);
  const flashState = useRef({ fired: 0, until: 0 });

  useFrame(({ camera }, rawDt) => {
    const m = g.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    const scoped = stance.aiming && stance.scoped;
    const show = !!def && stance.firstPerson && !scoped;
    m.visible = show;
    if (!show) muzzle.valid = false;
    if (!show) {
      st.fired = recoil.fired;
      st.lastYaw = view.yaw;
      st.lastPitch = view.pitch;
      return;
    }
    const ease = (rate: number) => Math.min(1, dt * rate);
    st.wall += (stance.wall - st.wall) * ease(12);
    const aimTarget = stance.aiming ? 1 - st.wall : 0;
    st.aim += (aimTarget - st.aim) * ease(14);
    st.sprint += ((stance.sprinting && !stance.aiming ? 1 : 0) - st.sprint) * ease(8);
    if (stance.moving && !stance.airborne) st.bob += dt * (4 + stance.speed * 1.25);
    const reloading = gun.reloadUntil > performance.now();
    st.drop += ((reloading ? 1 : 0) - st.drop) * ease(8);

    // Phát bắn mới: đá lò xo. Ngắm thì giật gọn hơn (tì vai chắc).
    if (recoil.fired !== st.fired) {
      const n = recoil.fired - st.fired;
      st.fired = recoil.fired;
      const p = recoil.power * n * (1 - st.aim * 0.35);
      st.back.v += 1.6 * p;
      st.rise.v += 3.2 * p;
      st.side.v += (Math.random() - 0.5) * 1.6 * p;
      st.roll.v += (Math.random() - 0.5) * 4 * p;
    }
    // Đáp đất: súng trĩu xuống rồi bật về.
    if (stance.land > st.lastLand + 0.05) st.land.v -= stance.land * 2.2;
    st.lastLand = stance.land;
    step(st.back, dt, 320, 26);
    step(st.rise, dt, 240, 22);
    step(st.side, dt, 200, 20);
    step(st.roll, dt, 180, 18);
    step(st.land, dt, 140, 14);

    // Súng trễ theo cú xoay chuột một chút rồi đuổi kịp.
    st.yawLag += (view.yaw - st.lastYaw) * 0.6;
    st.pitchLag += (view.pitch - st.lastPitch) * 0.6;
    st.lastYaw = view.yaw;
    st.lastPitch = view.pitch;
    st.yawLag = Math.max(-0.3, Math.min(0.3, st.yawLag)) * Math.exp(-dt * 12);
    st.pitchLag = Math.max(-0.3, Math.min(0.3, st.pitchLag)) * Math.exp(-dt * 12);
    const bobAmt = (0.008 + Math.min(1, stance.speed / 7) * 0.02) * (1 - st.aim * 0.85) * (stance.moving && !stance.airborne ? 1 : 0.15);
    const hip = 1 - st.aim;
    // Hông → ngắm: đưa thước ngắm về giữa mắt. Sát tường: kéo súng về ngực, hạ thấp.
    offset.set(
      HIP.x * hip + Math.sin(st.bob) * bobAmt + st.yawLag * 0.3 * hip + st.side.x * 0.02 - st.wall * 0.06 - st.sprint * 0.06,
      HIP.y * hip - sight * st.aim + (Math.abs(Math.cos(st.bob)) - 0.5) * bobAmt - st.drop * 0.12 + st.pitchLag * 0.2 * hip + st.land.x * 0.05 - st.wall * 0.06 - st.sprint * 0.03,
      HIP.z * hip - 0.3 * st.aim + st.back.x * 0.05 + st.wall * 0.24 + st.sprint * 0.06,
    );
    offset.applyQuaternion(camera.quaternion);
    m.position.copy(camera.position).add(offset);
    // Nòng quay theo camera; súng GunModel chĩa +z nên xoay nửa vòng.
    // Giật: hất nòng lên, lệch, nghiêng. Chạy: ôm chéo. Sát tường: dựng nòng lên trời.
    q.copy(camera.quaternion);
    tilt.setFromAxisAngle(axisX, st.rise.x * 0.08 - st.drop * 0.6 + st.wall * 1.05 + st.land.x * -0.08);
    q.multiply(tilt);
    tilt.setFromAxisAngle(axisY, st.side.x * 0.04 + st.sprint * 0.55 + st.wall * 0.25);
    q.multiply(tilt);
    tilt.setFromAxisAngle(axisZ, st.roll.x * 0.05 + st.sprint * 0.25 + st.wall * 0.35);
    q.multiply(tilt);
    m.quaternion.copy(q);
    m.rotateY(Math.PI);

    // Lửa đầu nòng: loé chừng 1–2 khung hình sau mỗi phát, to nhỏ, xoay ngẫu nhiên; chiếu sáng xung quanh.
    const f = flash.current;
    if (f) {
      const now = performance.now();
      const fs = flashState.current;
      if (recoil.fired !== fs.fired) {
        fs.fired = recoil.fired;
        fs.until = now + 45;
        const big = def && (def.class === "sniper" || def.class === "shotgun" || def.class === "dmr") ? 1.5 : def?.class === "pistol" || def?.class === "smg" ? 0.8 : 1;
        f.scale.setScalar(big * (0.8 + Math.random() * 0.45));
        f.rotation.z = Math.random() * Math.PI;
      }
      f.visible = now < fs.until;
      m.updateMatrixWorld();
      f.getWorldPosition(flashPos);
      muzzle.x = flashPos.x;
      muzzle.y = flashPos.y;
      muzzle.z = flashPos.z;
      muzzle.valid = true;
      if (f.visible && fs.until - now > 30) effects.flashes.push({ x: flashPos.x, y: flashPos.y, z: flashPos.z, born: now / 1000, lightOnly: true });
    }
  });

  return (
    <group ref={g}>
      {def && (
        <>
          <GunModel weaponId={weapon} sight={sightId} scale={1} view />
          {sightId && <Reticle weapon={weapon} sight={sightId} />}
          <Hands weapon={weapon} outfit={outfit} pistol={def.class === "pistol"} />
          <group position={muzzleOffset(weapon)}>
            <group ref={flash} visible={false}>
              <MuzzleFlash />
            </group>
          </group>
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------- lửa đầu nòng

const flashVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${DRAW_ON_TOP_GLSL}
  }
`;
/** Sao lửa nhìn thẳng từ phía sau súng: lõi trắng, 5 cánh vàng cam. */
const starFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float petals = 0.45 + 0.55 * pow(abs(cos(a * 2.5)), 3.0);
    float glow = 1.0 - smoothstep(0.0, petals, r);
    float core = 1.0 - smoothstep(0.0, 0.35, r);
    vec3 c = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.55), glow) + core * 2.0;
    gl_FragColor = vec4(c * 5.0 * glow, glow);
  }
`;
/** Lưỡi lửa dọc nòng (nhìn ngang): đậm ở gốc, nhọn và tắt dần về phía trước. */
const tongueFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float along = vUv.y;
    float width = (1.0 - along) * 0.5;
    float d = abs(vUv.x - 0.5);
    float a = (1.0 - smoothstep(width * 0.3, width, d)) * (1.0 - along * 0.85);
    vec3 c = mix(vec3(1.0, 0.8, 0.45), vec3(1.0, 0.35, 0.05), along);
    gl_FragColor = vec4(c * 4.0 * a, a);
  }
`;

function MuzzleFlash() {
  const res = useMemo(() => {
    const mk = (fragmentShader: string) =>
      new ShaderMaterial({ vertexShader: flashVertex, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
    // Lưỡi lửa: tấm dài theo +z (hướng nòng), gốc ở đầu nòng.
    const tongue = new PlaneGeometry(0.07, 0.2).translate(0, 0.1, 0).rotateX(Math.PI / 2);
    return { star: mk(starFragment), tongue: mk(tongueFragment), starGeo: new PlaneGeometry(0.16, 0.16), tongueGeo: tongue };
  }, []);
  useEffect(
    () => () => {
      res.star.dispose();
      res.tongue.dispose();
      res.starGeo.dispose();
      res.tongueGeo.dispose();
    },
    [res],
  );
  return (
    <>
      <mesh geometry={res.starGeo} material={res.star} position-z={0.02} renderOrder={20} />
      <mesh geometry={res.tongueGeo} material={res.tongue} renderOrder={20} />
      <mesh geometry={res.tongueGeo} material={res.tongue} rotation-z={Math.PI / 2} renderOrder={20} />
    </>
  );
}

// ---------------------------------------------------------------------------- tâm trên kính phản xạ

/** Chấm đỏ (red dot) hay vòng holo sáng trên kính: ngắm thì nằm đúng giữa màn hình. Ống kính thì tâm vẽ ở HUD. */
function Reticle({ weapon, sight }: { weapon: string; sight: string }) {
  const def = SIGHTS[sight as SightId];
  const res = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: flashVertex,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(3.0, 0.15, 0.1, 1.0); }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    return { m, dot: new CircleGeometry(0.0009, 12), ring: new RingGeometry(0.0055, 0.0064, 32) };
  }, []);
  useEffect(
    () => () => {
      res.m.dispose();
      res.dot.dispose();
      res.ring.dispose();
    },
    [res],
  );
  if (!def || def.scope) return null;
  const [x, y, z] = railMount(weapon);
  const lensZ = z + (sight === "holo" ? 0.03 : 0.018) + 0.002;
  return (
    <group position={[x, y + opticHeight(sight), lensZ]} rotation-y={Math.PI}>
      <mesh geometry={res.dot} material={res.m} renderOrder={21} />
      {sight === "holo" && <mesh geometry={res.ring} material={res.m} renderOrder={21} />}
    </group>
  );
}

// ---------------------------------------------------------------------------- hai bàn tay

const sleeveCache = new Map<string, MeshStandardMaterial>();
/** Vải ống tay áo theo bộ rằn ri đang mặc, vẽ đè lên cảnh như súng. */
function sleeveMaterial(outfit: string): MeshStandardMaterial {
  let m = sleeveCache.get(outfit);
  if (m) return m;
  const map = camoTexture(outfit).clone();
  map.repeat.set(0.35, 0.6);
  map.needsUpdate = true;
  m = drawOnTop(new MeshStandardMaterial({ map, roughness: 0.92 }));
  m.userData.detail = "none";
  sleeveCache.set(outfit, m);
  return m;
}

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Đoạn ống (cẳng tay) nối hai điểm trong toạ độ súng. */
function Segment({ from, to, r1, r2, material }: { from: [number, number, number]; to: [number, number, number]; r1: number; r2: number; material: MeshStandardMaterial }) {
  const { geo, pos, quat } = useMemo(() => {
    _a.set(...from);
    _b.set(...to);
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    const g = new CylinderGeometry(r2, r1, len, 10, 1);
    return { geo: g, pos: _a.clone().add(_b).multiplyScalar(0.5), quat: new Quaternion().setFromUnitVectors(_up, _dir.normalize()) };
  }, [from, to, r1, r2]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} position={pos} quaternion={quat} renderOrder={1} />;
}

/**
 * Bàn tay đeo găng (lòng bàn tay, bốn ngón quặp, ngón cái, đốt tay) và cẳng tay. Toạ độ súng: gốc ở tay cầm, nòng +z,
 * bên phải khẩu súng là -x. Tay phải nắm tay cầm, ngón trỏ đặt cò; tay trái đỡ dưới ốp lót tay (súng lục thì ôm tay phải).
 */
function Hands({ weapon, outfit, pistol }: { weapon: string; outfit: string; pistol: boolean }) {
  const glove = viewMaterial("glove");
  const knuckle = viewMaterial("knuckle");
  const sleeve = sleeveMaterial(outfit);
  const support = useMemo(() => supportOffset(weapon), [weapon]);
  const right = useMemo(
    () => ({
      wrist: [-0.004, -0.07, -0.055] as [number, number, number],
      elbow: [-0.13, -0.24, -0.36] as [number, number, number],
    }),
    [],
  );
  const left = useMemo(() => {
    const [sx, sy, sz] = support;
    return pistol
      ? { wrist: [sx + 0.03, sy - 0.06, sz - 0.05] as [number, number, number], elbow: [sx + 0.16, sy - 0.25, sz - 0.34] as [number, number, number] }
      : { wrist: [sx + 0.045, sy - 0.05, sz - 0.05] as [number, number, number], elbow: [sx + 0.2, sy - 0.22, sz - 0.36] as [number, number, number] };
  }, [support, pistol]);
  return (
    <>
      {/* Tay phải: lòng bàn tay ôm sau tay cầm, bốn ngón quặp phía trước, ngón trỏ trên cò, ngón cái vắt sang trái. */}
      <group rotation-x={0.28}>
        <mesh material={glove} position={[-0.004, -0.035, -0.022]} renderOrder={1}>
          <boxGeometry args={[0.05, 0.085, 0.04]} />
        </mesh>
        <mesh material={glove} position={[-0.004, -0.045, 0.022]} renderOrder={1}>
          <boxGeometry args={[0.048, 0.06, 0.022]} />
        </mesh>
        <mesh material={knuckle} position={[-0.026, -0.045, 0.0]} renderOrder={1}>
          <boxGeometry args={[0.006, 0.06, 0.03]} />
        </mesh>
        <mesh material={glove} position={[0.0, 0.002, 0.03]} rotation-x={-0.25} renderOrder={1}>
          <boxGeometry args={[0.014, 0.014, 0.05]} />
        </mesh>
        <mesh material={glove} position={[0.024, 0.012, 0.0]} rotation-y={-0.3} renderOrder={1}>
          <capsuleGeometry args={[0.009, 0.04, 4, 8]} />
        </mesh>
      </group>
      <Segment from={right.wrist} to={[-0.004, -0.06, -0.045]} r1={0.026} r2={0.028} material={knuckle} />
      <Segment from={right.wrist} to={right.elbow} r1={0.03} r2={0.042} material={sleeve} />
      {/* Tay trái: lòng tay đỡ dưới, ngón quặp lên sườn phải, ngón cái sườn trái. */}
      <group position={support}>
        <mesh material={glove} position={[0.0, -0.028, 0]} renderOrder={1}>
          <boxGeometry args={[0.05, 0.022, 0.085]} />
        </mesh>
        <mesh material={glove} position={[-0.026, -0.008, 0.005]} renderOrder={1}>
          <boxGeometry args={[0.014, 0.04, 0.075]} />
        </mesh>
        <mesh material={glove} position={[0.026, -0.006, 0.02]} rotation-x={0.3} renderOrder={1}>
          <capsuleGeometry args={[0.008, 0.035, 4, 8]} />
        </mesh>
      </group>
      <Segment from={left.wrist} to={left.elbow} r1={0.03} r2={0.042} material={sleeve} />
      <Segment from={left.wrist} to={[support[0] + 0.02, support[1] - 0.035, support[2] - 0.035]} r1={0.025} r2={0.027} material={knuckle} />
    </>
  );
}
