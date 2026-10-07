import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from "three";
import {
  DOOR_PITCH,
  HELI,
  HELI_PODS,
  HMG,
  MOUNT,
  SEATS,
  clampDoor,
  heliGround,
  clampRocketAim,
  heliRocketAim,
  heliRocketMuzzle,
  heliStep,
  mapForMode,
  mountMuzzle,
  seatPos,
  type HeliMotion,
  type HeliPose,
} from "@tentides/content";
import { Messages, type AirFxMessage, type VehicleMoveMessage, type VehicleState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, keys, look, smoothView, view } from "../input.ts";
import { aimZoom, getSettings } from "../settings.ts";
import { localPosition, shake } from "../shared.ts";
import { playCockpitWarning, playFlares, playMissileLaunch, rotorSound } from "../sound/air.ts";
import { effects, getBattleHud, localBody, menuOpen, seat, setBattleHud } from "./runtime.ts";
import { BULLET_GROUPS } from "./surface.ts";
import { fireMounted } from "./Carriers.tsx";
import { seatOwner, WreckFire } from "./vehicleParts.tsx";

// Trực thăng vũ trang hạng nhẹ: mô hình khối thấp (thân trứng, kính buồng lái, đuôi dài, càng đáp, hai ống rocket, hai
// súng máy cửa hông), cánh quạt chính và cánh đuôi quay theo vòng tua, bụi / bọt nước bốc lên khi bay sát mặt đất.
// Ngồi trên trực thăng: phi công tự bay trên máy mình (heliStep, gửi vị trí 15 lần mỗi giây): W/S chúc mũi / ngóc
// mũi, A/D quay đầu, Q/E nghiêng cánh trượt ngang, Space kéo cần lên, Shift (hay Ctrl) hạ cần; chuột trái bắn rocket
// mũi về tâm màn hình (trong nón quanh mũi; thân tự quay đầu theo chuột, giữ Alt để nhìn tự do), X thả pháo sáng, C đổi
// camera buồng lái / sau đuôi. Xạ thủ cửa hông: chuột xoay súng (trong cung cửa), chuột
// trái bắn, chuột phải ngắm gần. Ghế phụ chỉ ngồi nhìn. Phím 1–4 đổi ghế, F nhảy ra. Cảnh báo bị khoá: còi trong
// buồng lái + chữ trên HUD (heliHud). Tên lửa IGLA bay (đoạn khói theo gói server) và pháo sáng vẽ ở đây luôn.

const SEND_INTERVAL = 1 / 15;
const AIM_INTERVAL = 1 / 10;

type RapierBody = ReturnType<ReturnType<typeof useRapier>["world"]["createRigidBody"]>;
const heliBodies = new Map<string, RapierBody>();

/** Bảng điều khiển trực thăng cho HUD đọc mỗi khung hình (HeliHud.tsx). */
export const heliHud = {
  active: false,
  seat: 0,
  hp: 0,
  speed: 0,
  climb: 0,
  alt: 0,
  rockets: 0,
  flares: 0,
  flareReady: true,
  alert: 0,
  gunner: false,
  zoom: false,
  cockpit: false,
  aimX: 0.5,
  aimY: 0.5,
  aimOn: false,
  rocketX: 0.5,
  rocketY: 0.5,
  rocketOn: false,
  seats: [] as { name: string; who: string; mine: boolean }[],
  seatsKey: "",
};

// ---------------------------------------------------------------------------- mô hình

const BODY = new MeshStandardMaterial({ color: "#4c5640", roughness: 0.6, metalness: 0.35 });
const BODY_DARK = new MeshStandardMaterial({ color: "#2f352a", roughness: 0.7, metalness: 0.3 });
const STEEL = new MeshStandardMaterial({ color: "#26282a", roughness: 0.5, metalness: 0.7 });
const GLASS = new MeshStandardMaterial({ color: "#20323d", roughness: 0.12, metalness: 0.6, transparent: true, opacity: 0.82 });
const WRECK = new MeshStandardMaterial({ color: "#1c1a18", roughness: 1 });
const SKIN = new MeshStandardMaterial({ color: "#c9a07a", roughness: 0.8 });
for (const m of [BODY, BODY_DARK, STEEL, WRECK]) m.userData.detail = "metal";
const teamMats = new Map<string, MeshStandardMaterial>();
function teamMat(color: string): MeshStandardMaterial {
  let m = teamMats.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 });
    teamMats.set(color, m);
  }
  return m;
}

const B = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const G = {
  cabin: new SphereGeometry(1, 16, 12),
  nose: new SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  hump: B(1.1, 0.55, 1.9),
  boom: new CylinderGeometry(0.11, 0.24, 3.8, 10),
  fin: B(0.08, 1.1, 0.7),
  stab: B(1.5, 0.06, 0.4),
  skid: new CylinderGeometry(0.05, 0.05, 3.4, 8),
  strut: B(0.07, 0.75, 0.07),
  mast: new CylinderGeometry(0.08, 0.1, 0.5, 8),
  hub: new CylinderGeometry(0.22, 0.22, 0.16, 10),
  blade: B(0.26, 0.04, HELI.rotor),
  tailBlade: B(0.08, 1.1, 0.12),
  disc: new CircleGeometry(HELI.rotor, 32),
  tailDisc: new CircleGeometry(0.58, 16),
  pod: new CylinderGeometry(0.17, 0.17, 1.2, 10),
  podFront: new CylinderGeometry(0.17, 0.12, 0.12, 10),
  gunBody: B(0.18, 0.2, 0.55),
  gunBarrel: new CylinderGeometry(0.04, 0.045, MOUNT.barrel, 8),
  arm: B(0.5, 0.06, 0.06),
  torso: B(0.46, 0.62, 0.3),
  head: new SphereGeometry(0.14, 10, 8),
  stripe: B(0.02, 0.3, 1.1),
};
G.boom.rotateX(Math.PI / 2);
G.skid.rotateX(Math.PI / 2);
G.pod.rotateX(Math.PI / 2);
G.podFront.rotateX(Math.PI / 2);
G.blade.translate(0, 0, HELI.rotor / 2);
G.tailBlade.translate(0, 0.55, 0);
G.disc.rotateX(-Math.PI / 2);
G.tailDisc.rotateY(Math.PI / 2);
G.gunBarrel.rotateX(Math.PI / 2);
G.gunBarrel.translate(0, 0, MOUNT.barrel / 2);

/** Súng máy cửa hông trên cần treo: nhóm `yaw` quay quanh trục đứng, nhóm `pitch` ngẩng nòng. */
function DoorGun({ yaw, pitch, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; wreck: boolean }) {
  const m = wreck ? WRECK : STEEL;
  return (
    <group ref={yaw}>
      <group ref={pitch}>
        <mesh geometry={G.gunBody} material={m} position={[0, 0, 0.08]} castShadow />
        <mesh geometry={G.gunBarrel} material={m} castShadow />
      </group>
    </group>
  );
}

function HeliModel({ rotor, tail, discMat, gun1, gun1p, gun2, gun2p, color, wreck }: { rotor: React.RefObject<Group | null>; tail: React.RefObject<Group | null>; discMat: MeshBasicMaterial; gun1: React.RefObject<Group | null>; gun1p: React.RefObject<Group | null>; gun2: React.RefObject<Group | null>; gun2p: React.RefObject<Group | null>; color: string; wreck: boolean }) {
  const body = wreck ? WRECK : BODY;
  const dark = wreck ? WRECK : BODY_DARK;
  const m1 = SEATS.heli.mount;
  const m2 = SEATS.heli.mount2!;
  return (
    <group>
      {/* Càng đáp. */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh geometry={G.skid} material={STEEL} position={[s * 0.95, 0.06, 0.3]} castShadow />
          <mesh geometry={G.strut} material={STEEL} position={[s * 0.8, 0.42, 1.0]} rotation-z={s * 0.35} />
          <mesh geometry={G.strut} material={STEEL} position={[s * 0.8, 0.42, -0.6]} rotation-z={s * 0.35} />
        </group>
      ))}
      {/* Thân trứng, kính mũi, gù động cơ, đuôi. */}
      <mesh geometry={G.cabin} material={body} position={[0, 1.35, 0.2]} scale={[1.05, 0.92, 1.75]} castShadow receiveShadow />
      <mesh geometry={G.nose} material={wreck ? WRECK : GLASS} position={[0, 1.35, 0.95]} scale={[0.98, 0.86, 1.05]} rotation-x={Math.PI / 2} />
      <mesh geometry={G.hump} material={dark} position={[0, 2.15, -0.45]} castShadow />
      <mesh geometry={G.boom} material={body} position={[0, 1.6, -3.1]} castShadow />
      <mesh geometry={G.fin} material={dark} position={[0, 2.05, -4.95]} rotation-x={-0.35} castShadow />
      <mesh geometry={G.stab} material={dark} position={[0, 1.62, -4.55]} />
      {!wreck && [1, -1].map((s) => <mesh key={s} geometry={G.stripe} material={teamMat(color)} position={[s * 1.06, 1.4, -0.4]} />)}
      {/* Ống rocket hai bên. */}
      {HELI_PODS.map((p, i) => (
        <group key={i} position={[p[0], p[1], p[2]]}>
          <mesh geometry={G.pod} material={dark} castShadow />
          <mesh geometry={G.podFront} material={STEEL} position={[0, 0, 0.62]} />
          <mesh geometry={G.arm} material={STEEL} position={[-Math.sign(p[0]) * 0.3, 0.12, 0]} />
        </group>
      ))}
      {/* Súng máy cửa hông. */}
      <group position={[m1[0], m1[1], m1[2]]}>
        <DoorGun yaw={gun1} pitch={gun1p} wreck={wreck} />
      </group>
      <group position={[m2[0], m2[1], m2[2]]}>
        <DoorGun yaw={gun2} pitch={gun2p} wreck={wreck} />
      </group>
      {/* Cánh quạt chính: bốn lá + đĩa mờ khi quay nhanh. */}
      <mesh geometry={G.mast} material={STEEL} position={[0, 2.6, -0.15]} />
      <group ref={rotor} position={[0, 2.85, -0.15]}>
        <mesh geometry={G.hub} material={STEEL} />
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} geometry={G.blade} material={wreck ? WRECK : STEEL} rotation-y={(k * Math.PI) / 2} castShadow />
        ))}
      </group>
      {!wreck && <mesh geometry={G.disc} material={discMat} position={[0, 2.86, -0.15]} />}
      {/* Cánh đuôi (bên trái đuôi). */}
      <group ref={tail} position={[0.2, 2.0, -4.9]}>
        <mesh geometry={G.tailBlade} material={STEEL} />
        <mesh geometry={G.tailBlade} material={STEEL} rotation-x={Math.PI} />
      </group>
    </group>
  );
}

/** Người ngồi trên trực thăng: khối thân và đầu, áo theo màu đội. */
function Rider({ at, color }: { at: readonly [number, number, number]; color: string }) {
  return (
    <group position={[at[0], at[1], at[2]]}>
      <mesh geometry={G.torso} material={teamMat(color)} position={[0, 0.3, 0]} castShadow />
      <mesh geometry={G.head} material={SKIN} position={[0, 0.76, 0]} castShadow />
    </group>
  );
}

// ---------------------------------------------------------------------------- một chiếc trực thăng

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");
const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));

export function Heli({ room, id, v, teamColor }: { room: IslandRoom; id: string; v: VehicleState; teamColor: (team: string) => string }) {
  const { world: physics, rapier } = useRapier();
  const root = useRef<Group>(null);
  const rotor = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const gun1 = useRef<Group>(null);
  const gun1p = useRef<Group>(null);
  const gun2 = useRef<Group>(null);
  const gun2p = useRef<Group>(null);
  const riders = useRef<Group>(null);
  const [wreck, setWreck] = useState(v.hp <= 0);
  const [color, setColor] = useState(teamColor(v.team));
  const discMat = useMemo(() => new MeshBasicMaterial({ color: "#1b1d1c", transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }), []);
  const anim = useRef({ x: v.x, y: v.y, z: v.z, rotY: v.rotY, tilt: v.tilt, roll: v.roll, g1: v.turret, p1: v.pitch, g2: v.turret2, p2: v.pitch2, spin: v.driver ? 1 : 0, angle: 0, dust: 0, px: v.x, pz: v.z, speed: 0 });
  const sound = useRef<ReturnType<typeof rotorSound> | null>(null);

  useEffect(() => {
    const body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, v.y, v.z));
    physics.createCollider(rapier.ColliderDesc.cuboid(1.0, 0.85, 2.0).setTranslation(0, 1.3, 0.2), body);
    physics.createCollider(rapier.ColliderDesc.cuboid(0.2, 0.25, 1.9).setTranslation(0, 1.6, -3.1), body);
    heliBodies.set(id, body);
    return () => {
      heliBodies.delete(id);
      if (physics.getRigidBody(body.handle)) physics.removeRigidBody(body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, rapier, id]);

  useEffect(
    () => () => {
      sound.current?.stop();
      sound.current = null;
      discMat.dispose();
    },
    [discMat],
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = anim.current;
    const mine = hdrive.vid === id;
    // Trực thăng mình đang ngồi: lấy tư thế bộ điều khiển (phi công thì dự đoán, ngồi thì nội suy); khác thì nội suy.
    const src = mine ? hdrive.pose : v;
    const k = mine ? 1 : Math.min(1, dt * 10);
    a.x += (src.x - a.x) * k;
    a.y += (src.y - a.y) * k;
    a.z += (src.z - a.z) * k;
    a.rotY += wrap(src.rotY - a.rotY) * k;
    a.tilt += (src.tilt - a.tilt) * k;
    a.roll += (src.roll - a.roll) * k;
    const kg = Math.min(1, mine ? 1 : dt * 12);
    const own1 = mine && hdrive.seat === 1;
    const own2 = mine && hdrive.seat === 2;
    a.g1 += wrap((own1 ? hdrive.gunYaw : v.turret) - a.g1) * kg;
    a.p1 += ((own1 ? hdrive.gunPitch : v.pitch) - a.p1) * kg;
    a.g2 += wrap((own2 ? hdrive.gunYaw : v.turret2) - a.g2) * kg;
    a.p2 += ((own2 ? hdrive.gunPitch : v.pitch2) - a.p2) * kg;
    a.speed += ((dt > 0 ? Math.hypot(a.x - a.px, a.z - a.pz) / dt : 0) - a.speed) * Math.min(1, dt * 4);
    a.px = a.x;
    a.pz = a.z;
    if (v.hp <= 0 !== wreck) setWreck(v.hp <= 0);
    const c = teamColor(v.team);
    if (c !== color) setColor(c);
    const map = mapForMode(room.state.battleMode, room.state.worldSeed);
    const ground = heliGround(map, a.x, a.z);
    const alt = a.y - ground;
    // Vòng tua cánh: có phi công (hay đang trên không) thì quay lên dần, bỏ trống dưới đất thì chậm dần rồi dừng.
    const want = !wreck && (v.driver || alt > 0.5) ? 1 : 0;
    a.spin += Math.max(-0.25 * dt, Math.min(0.4 * dt, want - a.spin));
    a.angle += a.spin * dt * 34;
    if (rotor.current) rotor.current.rotation.y = a.angle;
    if (tail.current) tail.current.rotation.x = a.angle * 3.2;
    discMat.opacity = Math.max(0, a.spin - 0.45) * 0.45;
    const g = root.current;
    if (g) {
      g.position.set(a.x, a.y, a.z);
      // Nghiêng thân: chúc mũi (tilt dương) là quay quanh trục ngang về phía trước; nghiêng phải (roll dương).
      g.rotation.set(a.tilt, a.rotY, a.roll, "YXZ");
    }
    // Súng cửa: hướng theo thân (bỏ qua nghiêng nhỏ của thân).
    if (gun1.current) gun1.current.rotation.y = a.g1 - a.rotY;
    if (gun1p.current) gun1p.current.rotation.x = -a.p1;
    if (gun2.current) gun2.current.rotation.y = a.g2 - a.rotY;
    if (gun2p.current) gun2p.current.rotation.x = -a.p2;
    if (riders.current) {
      const list = riders.current.children;
      // Ngồi buồng lái nhìn từ trong (hay ngồi ghế súng) thì giấu thân mình.
      for (let i = 0; i < list.length; i++) list[i]!.visible = !wreck && !!(i === 0 ? v.driver : v.seats.get(String(i))) && !(mine && i === hdrive.seat && (hdrive.cockpit || hdrive.seat !== 0));
    }
    const body = heliBodies.get(id);
    if (body) {
      body.setNextKinematicTranslation({ x: a.x, y: a.y, z: a.z });
      _q.setFromEuler(_e.set(a.tilt, a.rotY, a.roll, "YXZ"));
      body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    // Gió cánh quạt: bụi (hay bọt nước) bốc lên quanh chỗ bay sát mặt đất.
    if (a.spin > 0.6 && alt < 14 && !wreck) {
      a.dust -= dt * (1 - alt / 14) * 14;
      const water = ground <= 0.01 && map.world.heightAt(a.x, a.z) < -0.2;
      while (a.dust < 0) {
        a.dust += 1;
        const ang = Math.random() * Math.PI * 2;
        const r = 2.5 + Math.random() * 5;
        const px = a.x + Math.cos(ang) * r;
        const pz = a.z + Math.sin(ang) * r;
        effects.impacts.push({ x: px, y: heliGround(map, px, pz) + 0.05, z: pz, nx: Math.cos(ang) * 0.8, ny: 0.5, nz: Math.sin(ang) * 0.8, born: performance.now() / 1000, blood: false, noHole: true, surface: water ? "water" : "dirt" });
      }
    }
    // Tiếng cánh quạt.
    const d = camera.position.distanceTo(g?.position ?? camera.position);
    if (a.spin > 0.02 && d < 330) {
      sound.current ??= rotorSound();
      const load = mine && hdrive.seat === 0 ? Math.min(1, Math.abs(hdrive.lift) * 0.7 + Math.abs(hdrive.pose.tilt) * 1.5) : Math.min(1, a.speed / HELI.maxSpeed);
      sound.current.update({ x: a.x, y: a.y + 2, z: a.z }, a.spin, load, mine);
    } else if (sound.current) {
      sound.current.stop();
      sound.current = null;
    }
  });

  const seats = SEATS.heli.seats;
  return (
    <group ref={root}>
      <HeliModel rotor={rotor} tail={tail} discMat={discMat} gun1={gun1} gun1p={gun1p} gun2={gun2} gun2p={gun2p} color={color} wreck={wreck} />
      <group ref={riders}>
        {seats.map((at, i) => (
          <Rider key={i} at={[at[0], at[1] - 0.35, at[2]]} color={color} />
        ))}
      </group>
      <WreckFire wreck={wreck} size={0.8} top={2.2} />
    </group>
  );
}

// ---------------------------------------------------------------------------- ngồi trên trực thăng

/** Trạng thái trực thăng mình đang ngồi: tư thế (phi công tự bay, ghế khác nội suy), súng cửa, camera. */
const hdrive = {
  vid: "",
  seat: -1,
  pose: { x: 0, y: 0, z: 0, rotY: 0, tilt: 0, roll: 0 } as HeliPose,
  motion: { vx: 0, vy: 0, vz: 0 } as HeliMotion,
  lift: 0,
  impact: 0,
  sendAt: 0,
  lastSent: "",
  aimAt: 0,
  lastAim: "",
  gunYaw: 0,
  gunPitch: 0,
  fireHeld: false,
  zoom: false,
  cockpit: false,
  nextShot: 0,
  nextRocket: 0,
  flareAt: 0,
  warnAt: 0,
  /** Hướng ngắm rocket của phi công (theo tâm màn hình, cập nhật mỗi khung hình). */
  rocketYaw: 0,
  rocketPitch: 0,
};

const _tmp = { target: new Vector3(), pos: new Vector3(), dir: new Vector3(), aim: new Vector3(), up: new Vector3(), o: new Vector3() };
const _seatObj = new Object3D();

export function HeliSeat({ room }: { room: IslandRoom }) {
  const { world: physics, rapier } = useRapier();

  // Dev: window.__tentides.heli là trạng thái trực thăng mình đang ngồi (chỉnh tư thế để thử nhanh).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __tentides?: Record<string, unknown> };
    w.__tentides ??= {};
    w.__tentides.heli = hdrive;
  }, []);

  // Chuột trái: rocket (phi công) / súng cửa (xạ thủ); chuột phải: ngắm gần; X pháo sáng; C đổi camera; 1–4 đổi ghế.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!hdrive.vid || !document.pointerLockElement || menuOpen()) return;
      if (e.button === 0) hdrive.fireHeld = true;
      if (e.button === 2) hdrive.zoom = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) hdrive.fireHeld = false;
      if (e.button === 2) hdrive.zoom = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || !hdrive.vid || menuOpen()) return;
      const m = /^Digit([1-4])$/.exec(e.code);
      if (m) room.send(Messages.vehicleSeat, { seat: Number(m[1]) - 1 });
      if (e.code === "KeyC") hdrive.cockpit = !hdrive.cockpit;
      if (e.code === "KeyX" && hdrive.seat === 0) {
        hdrive.flareAt = performance.now();
        room.send(Messages.heliFlare);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [room]);

  // Server sửa vị trí (bay quá nhanh, chui vào nhà): nhận lại tư thế server giữ, mất đà.
  useEffect(
    () =>
      room.onMessage(Messages.correct, (at: { x: number; y: number; z: number }) => {
        if (!hdrive.vid || hdrive.seat !== 0) return;
        hdrive.pose = { ...hdrive.pose, x: at.x, y: at.y, z: at.z };
        hdrive.motion = { vx: 0, vy: 0, vz: 0 };
      }),
    [room],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const mid = myId(room);
    const me = room.state.players.get(mid);
    const vid = me?.alive && me.vehicle ? me.vehicle : "";
    const v = vid ? room.state.vehicles.get(vid) : undefined;
    if (!v || v.hp <= 0 || v.kind !== "heli") {
      if (hdrive.vid) {
        hdrive.vid = "";
        hdrive.fireHeld = hdrive.zoom = false;
        heliHud.active = false;
        if (seatOwner.kind === "heli") {
          seatOwner.kind = "";
          seat.id = "";
          aimZoom.value = 1;
        }
      }
      return;
    }
    let mySeat = v.driver === mid ? 0 : -1;
    if (mySeat < 0) for (const [k, q] of v.seats) if (q === mid) mySeat = Number(k);
    if (mySeat < 0) return;
    if (hdrive.vid !== vid) {
      // Vừa lên: lấy tư thế server, nhìn theo mũi.
      hdrive.vid = vid;
      hdrive.pose = { x: v.x, y: v.y, z: v.z, rotY: v.rotY, tilt: v.tilt, roll: v.roll };
      hdrive.motion = { vx: 0, vy: 0, vz: 0 };
      hdrive.gunYaw = v.turret;
      hdrive.gunPitch = v.pitch;
      hdrive.cockpit = false;
      look.yaw = v.rotY + Math.PI;
      look.pitch = 0.18;
      if (getBattleHud().nearTank) setBattleHud({ nearTank: "" });
    }
    if (hdrive.seat !== mySeat && mySeat > 0) {
      hdrive.gunYaw = mySeat === 2 ? v.turret2 : v.turret;
      hdrive.gunPitch = mySeat === 2 ? v.pitch2 : v.pitch;
    }
    seatOwner.kind = "heli";
    seat.id = vid;
    hdrive.seat = mySeat;
    const gunner = mySeat === 1 || mySeat === 2;
    const map = mapForMode(room.state.battleMode, room.state.worldSeed);
    const typing = menuOpen();
    const now = performance.now();
    if (mySeat === 0) {
      const k = (code: string) => (!typing && keys.has(code) ? 1 : 0);
      // Lái bằng chuột: không bấm A/D thì thân tự quay đầu về hướng camera (giữ Alt để nhìn quanh tự do).
      let yaw = k("KeyD") - k("KeyA");
      if (!yaw && !k("AltLeft") && !k("AltRight")) {
        const diff = wrap(view.yaw + Math.PI - hdrive.pose.rotY);
        if (Math.abs(diff) > 0.02 && Math.abs(diff) < 2.4) yaw = Math.max(-1, Math.min(1, -diff * 2.2));
      }
      const input = {
        pitch: k("KeyW") - k("KeyS"),
        yaw,
        strafe: k("KeyE") - k("KeyQ"),
        lift: k("Space") - Math.max(k("ShiftLeft"), k("ControlLeft")),
      };
      hdrive.lift = input.lift;
      const step = heliStep(map, hdrive.pose, hdrive.motion, input, dt);
      hdrive.pose = step.pose;
      hdrive.motion = step.motion;
      if (step.impact > 2) shake.amount = Math.min(1, shake.amount + step.impact * 0.04);
      hdrive.impact = Math.max(hdrive.impact, step.impact);
      // Rocket mũi: giữ chuột trái, bắn đều theo nhịp (server chặn bắn dồn, đếm rocket).
      if (hdrive.fireHeld && now >= hdrive.nextRocket && v.rockets > 0 && room.state.phase === "battle") {
        hdrive.nextRocket = now + HELI.rocketGap * 1000;
        room.send(Messages.tankFire, { turret: hdrive.rocketYaw, pitch: Math.max(-1, Math.min(1, hdrive.rocketPitch)) });
        shake.amount = Math.min(0.5, shake.amount + 0.12);
      }
    } else {
      const k = Math.min(1, dt * 10);
      const p = hdrive.pose;
      hdrive.pose = { x: p.x + (v.x - p.x) * k, y: p.y + (v.y - p.y) * k, z: p.z + (v.z - p.z) * k, rotY: p.rotY + wrap(v.rotY - p.rotY) * k, tilt: p.tilt + (v.tilt - p.tilt) * k, roll: p.roll + (v.roll - p.roll) * k };
    }
    const p = hdrive.pose;

    // Camera: phi công (buồng lái hay sau đuôi), xạ thủ sau vai súng cửa, ghế phụ sau đuôi.
    smoothView(dt);
    const cam = state.camera as PerspectiveCamera;
    const { target, pos, dir, aim, up } = _tmp;
    const zoom = gunner && hdrive.zoom;
    if (mySeat === 0 && hdrive.cockpit) {
      _seatObj.position.set(p.x, p.y, p.z);
      _seatObj.rotation.set(p.tilt, p.rotY, p.roll, "YXZ");
      _seatObj.updateMatrixWorld();
      const s0 = SEATS.heli.seats[0]!;
      pos.set(s0[0], s0[1] + 0.85, s0[2] + 0.1).applyMatrix4(_seatObj.matrixWorld);
    } else {
      if (gunner) {
        const m = mountMuzzle("heli", p, 0, 0, mySeat).pivot;
        target.set(m[0], m[1] + 0.7, m[2]);
      } else target.set(p.x, p.y + 2.4, p.z);
      const dist = gunner ? (zoom ? 0.01 : 3.2) : 13;
      const horizontal = Math.cos(view.pitch) * dist;
      pos.set(target.x + Math.sin(view.yaw) * horizontal, target.y + Math.sin(view.pitch) * dist, target.z + Math.cos(view.yaw) * horizontal);
      const floor = Math.max(map.world.heightAt(pos.x, pos.z), 0) + 0.5;
      if (pos.y < floor) pos.y = floor;
    }
    cam.position.copy(pos);
    dir.set(-Math.sin(view.yaw) * Math.cos(view.pitch), -Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch));
    cam.lookAt(aim.copy(pos).add(dir));
    if (shake.amount > 0.005) {
      const s = shake.amount * 0.3;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      shake.amount *= Math.exp(-dt * 7);
    }
    const baseFov = getSettings().fov;
    const wantFov = zoom ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / 2.2) * 180) / Math.PI : baseFov;
    aimZoom.value = zoom ? 2.2 : 1;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }

    const own = heliBodies.get(vid);
    const skipOwn = (c: { parent(): { handle: number } | null }) => {
      const h = c.parent()?.handle;
      return h !== own?.handle && h !== localBody.current?.handle;
    };
    if (gunner) {
      // Điểm ngắm: tia từ camera qua giữa màn hình; súng cửa quay nhanh về đó (trong cung cửa, giới hạn ngẩng / chúc).
      cam.getWorldDirection(dir);
      const hit = physics.castRay(new rapier.Ray(cam.position, dir), 500, true, undefined, BULLET_GROUPS, undefined, undefined, skipOwn);
      aim.copy(cam.position).addScaledVector(dir, hit ? hit.timeOfImpact : 300);
      const pivot = mountMuzzle("heli", p, 0, 0, mySeat).pivot;
      const wantYaw = clampDoor(mySeat, p.rotY, Math.atan2(aim.x - pivot[0], aim.z - pivot[2]));
      const wantPitch = Math.max(DOOR_PITCH.down, Math.min(DOOR_PITCH.up, Math.atan2(aim.y - pivot[1], Math.hypot(aim.x - pivot[0], aim.z - pivot[2]))));
      const turn = 6 * dt;
      hdrive.gunYaw = clampDoor(mySeat, p.rotY, hdrive.gunYaw + Math.max(-turn, Math.min(turn, wrap(wantYaw - hdrive.gunYaw))));
      hdrive.gunPitch += Math.max(-turn, Math.min(turn, wantPitch - hdrive.gunPitch));
      const mz = mountMuzzle("heli", p, hdrive.gunYaw, hdrive.gunPitch, mySeat);
      const reach = Math.max(8, aim.distanceTo(_tmp.o.set(...mz.o)));
      up.set(mz.o[0] + mz.d[0] * reach, mz.o[1] + mz.d[1] * reach, mz.o[2] + mz.d[2] * reach).project(cam);
      heliHud.aimOn = up.z < 1;
      heliHud.aimX = (up.x + 1) / 2;
      heliHud.aimY = (1 - up.y) / 2;
      hdrive.aimAt += dt;
      if (hdrive.aimAt >= AIM_INTERVAL) {
        hdrive.aimAt = 0;
        const key = `${hdrive.gunYaw.toFixed(2)},${hdrive.gunPitch.toFixed(2)}`;
        if (key !== hdrive.lastAim) {
          hdrive.lastAim = key;
          room.send(Messages.vehicleAim, { turret: hdrive.gunYaw, pitch: hdrive.gunPitch });
        }
      }
      if (hdrive.fireHeld && now >= hdrive.nextShot && room.state.phase === "battle") {
        hdrive.nextShot = Math.max(hdrive.nextShot + 60000 / HMG.rpm, now);
        fireMounted(room, mz, skipOwn, physics, rapier);
        shake.amount = Math.min(0.35, shake.amount + 0.05);
        look.pitch -= 0.003;
      }
    } else heliHud.aimOn = false;

    // Phi công ngắm rocket theo tâm màn hình: hướng từ giữa hai ống tới điểm camera nhìn vào, kẹp vào nón quanh mũi;
    // tâm rocket trên màn hình là chỗ rocket sẽ bay tới (trùng tâm màn hình khi mục tiêu nằm trong nón).
    if (mySeat === 0) {
      cam.getWorldDirection(dir);
      const hit = physics.castRay(new rapier.Ray(cam.position, dir), 600, true, undefined, BULLET_GROUPS, undefined, undefined, skipOwn);
      aim.copy(cam.position).addScaledVector(dir, hit ? Math.max(hit.timeOfImpact, 12) : 400);
      const m0 = heliRocketMuzzle(p, 0).o;
      const m1 = heliRocketMuzzle(p, 1).o;
      const ox = (m0[0] + m1[0]) / 2;
      const oy = (m0[1] + m1[1]) / 2;
      const oz = (m0[2] + m1[2]) / 2;
      const want = clampRocketAim(p.rotY, Math.atan2(aim.x - ox, aim.z - oz), Math.atan2(aim.y - oy, Math.hypot(aim.x - ox, aim.z - oz)));
      hdrive.rocketYaw = want.yaw;
      hdrive.rocketPitch = want.pitch;
      const reach = Math.max(20, Math.min(400, aim.distanceTo(_tmp.o.set(ox, oy, oz))));
      const r = heliRocketAim(p, 0, want.yaw, want.pitch);
      up.set(ox + r.d[0] * reach, oy + r.d[1] * reach, oz + r.d[2] * reach).project(cam);
      heliHud.rocketOn = up.z < 1;
      heliHud.rocketX = (up.x + 1) / 2;
      heliHud.rocketY = (1 - up.y) / 2;
    } else heliHud.rocketOn = false;

    const at = seatPos("heli", p, mySeat);
    seat.x = at[0];
    seat.y = at[1] - 0.5;
    seat.z = at[2];

    // Còi cảnh báo bị khoá / tên lửa bay tới (cả tổ lái nghe).
    if (v.alert > 0 && now >= hdrive.warnAt) {
      playCockpitWarning(v.alert);
      hdrive.warnAt = now + (v.alert >= 3 ? 260 : v.alert >= 2 ? 330 : 750);
    }

    // Bảng điều khiển.
    heliHud.active = true;
    heliHud.seat = mySeat;
    heliHud.hp = v.hp;
    heliHud.speed = mySeat === 0 ? Math.hypot(hdrive.motion.vx, hdrive.motion.vz) : 0;
    heliHud.climb = mySeat === 0 ? hdrive.motion.vy : 0;
    heliHud.alt = p.y - heliGround(map, p.x, p.z);
    heliHud.rockets = v.rockets;
    heliHud.flares = v.flares;
    heliHud.flareReady = now - hdrive.flareAt > HELI.flareCooldown * 1000;
    heliHud.alert = v.alert;
    heliHud.gunner = gunner;
    heliHud.zoom = zoom;
    heliHud.cockpit = hdrive.cockpit;
    const names = SEATS.heli.names;
    let key = `${mySeat}`;
    for (let i = 0; i < names.length; i++) key += `|${i === 0 ? v.driver : (v.seats.get(String(i)) ?? "")}`;
    if (key !== heliHud.seatsKey) {
      heliHud.seatsKey = key;
      heliHud.seats = names.map((name, i) => {
        const pid = i === 0 ? v.driver : (v.seats.get(String(i)) ?? "");
        return { name, who: pid ? (room.state.players.get(pid)?.name ?? "?") : "", mine: pid === mid };
      });
    }

    // Phi công: gửi vị trí (kèm góc thân, va chạm mạnh nhất từ gói trước).
    if (mySeat === 0) {
      hdrive.sendAt += dt;
      if (hdrive.sendAt >= SEND_INTERVAL) {
        hdrive.sendAt = 0;
        const moving = Math.hypot(hdrive.motion.vx, hdrive.motion.vy, hdrive.motion.vz) > 0.3;
        const k2 = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${p.rotY.toFixed(3)},${p.tilt.toFixed(2)},${p.roll.toFixed(2)},${moving}`;
        if (k2 !== hdrive.lastSent || hdrive.impact > 0) {
          hdrive.lastSent = k2;
          const msg: VehicleMoveMessage = { x: p.x, y: p.y, z: p.z, rotY: p.rotY, turret: v.turret, pitch: Math.max(-1, Math.min(1, v.pitch)), moving, tilt: p.tilt, roll: p.roll, impact: Math.min(200, hdrive.impact) };
          room.send(Messages.vehicleMove, msg);
          hdrive.impact = 0;
        }
      }
    }
  }, -1);
  return null;
}

// ---------------------------------------------------------------------------- tên lửa, pháo sáng

const FLARE_MAX = 64;
interface Flare {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}
const flares: Flare[] = [];

/** Hiệu ứng trên không do server báo: đoạn khói tên lửa IGLA đang bay, tên lửa nổ, chùm pháo sáng. */
export function useAirFx(room: IslandRoom) {
  useEffect(
    () =>
      room.onMessage(Messages.airFx, (m: AirFxMessage) => {
        const now = performance.now() / 1000;
        if (m.kind === "flare") {
          // Chùm pháo sáng bung ra hai bên, rơi chậm.
          for (let k = 0; k < 10; k++) {
            if (flares.length >= FLARE_MAX) flares.shift();
            const a = (k / 10) * Math.PI * 2 + Math.random() * 0.4;
            // Bung ra từ hai bên dưới bụng (không loé ngay trước mặt phi công).
            flares.push({ x: m.x + Math.cos(a) * 1.8, y: m.y - 1.2, z: m.z + Math.sin(a) * 1.8, vx: Math.cos(a) * (6 + Math.random() * 6), vy: -1 + Math.random() * 2.5, vz: Math.sin(a) * (6 + Math.random() * 6), life: 3 + Math.random() });
          }
          playFlares({ x: m.x, y: m.y, z: m.z });
          return;
        }
        const first = m.px === m.x && m.py === m.y && m.pz === m.z;
        if (first) {
          effects.flashes.push({ x: m.x, y: m.y, z: m.z, born: now });
          playMissileLaunch({ x: m.x, y: m.y, z: m.z });
          return;
        }
        // Đoạn bay từ vị trí báo trước tới vị trí hiện tại: đầu tên lửa sáng, vệt khói dày.
        effects.tracers.push({ ox: m.px, oy: m.py, oz: m.pz, ex: m.x, ey: m.y, ez: m.z, born: now, mine: false, speed: Math.max(60, m.speed), trail: "rocket" });
        if (Math.hypot(m.x - localPosition.x, m.z - localPosition.z) < 30) shake.amount = Math.min(0.5, shake.amount + 0.08);
      }),
    [room],
  );
}

const _flareObj = new Object3D();
const FLARE_GEO = new SphereGeometry(0.35, 8, 6);
const FLARE_MAT = new MeshBasicMaterial({ color: "#fff2c0", transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });

/** Pháo sáng đang cháy: đốm sáng trắng vàng rơi chậm, nhả khói. */
export function Flares() {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(FLARE_GEO, FLARE_MAT, FLARE_MAX);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, []);
  const smokeAt = useRef(0);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    let n = 0;
    smokeAt.current -= dt;
    const puff = smokeAt.current <= 0;
    if (puff) smokeAt.current = 0.12;
    const now = performance.now() / 1000;
    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        flares.splice(i, 1);
        continue;
      }
      f.vx *= 1 - dt * 1.2;
      f.vz *= 1 - dt * 1.2;
      f.vy += (-6 - f.vy) * dt * 0.8;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      if (puff) effects.impacts.push({ x: f.x, y: f.y, z: f.z, nx: 0, ny: 0.2, nz: 0, born: now, blood: false, noHole: true });
    }
    for (const f of flares) {
      if (n >= FLARE_MAX) break;
      _flareObj.position.set(f.x, f.y, f.z);
      const s = 0.6 + Math.min(1, f.life) * 0.8 + Math.random() * 0.3;
      _flareObj.scale.setScalar(s);
      _flareObj.updateMatrix();
      mesh.setMatrixAt(n++, _flareObj.matrix);
    }
    mesh.count = n;
    if (n) mesh.instanceMatrix.needsUpdate = true;
  });
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

/** Dòng nhắc lên trực thăng: ghế sẽ ngồi. */
export function heliPrompt(seatIndex: number): string {
  return `Lên trực thăng · ${SEATS.heli.names[seatIndex] ?? ""}`;
}
