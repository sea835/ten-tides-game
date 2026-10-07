import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { BoxGeometry, CylinderGeometry, Euler, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, type Group, type PerspectiveCamera } from "three";
import { BOAT, HMG, JEEP, MOUNT, RHIB, SEATS, isBoat, isEmplacement, mapForMode, mountMuzzle, rayBody, seatPos, vehicleSpec, vehicleStep, type TankPose, type VehicleKind } from "@tentides/content";
import { Messages, type VehicleFxMessage, type VehicleGunMessage, type VehicleMoveMessage, type VehicleState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, keys, look, smoothView, view } from "../input.ts";
import { aimZoom, getSettings } from "../settings.ts";
import { localPosition, shake } from "../shared.ts";
import { playGunshot } from "../sound/guns.ts";
import { motorEngine, playRicochet, playTrackSnap } from "../sound/motors.ts";
import { bodies, effects, getBattleHud, localBody, menuOpen, seat, setBattleHud } from "./runtime.ts";
import { BULLET_GROUPS } from "./surface.ts";
import { carrierHud, seatOwner, WreckFire } from "./vehicleParts.tsx";
import { sampleTrack, vehicleTracks } from "../netInterp.ts";

// Xe trinh sát bọc thép (4 ghế, đại liên trên thùng xe) và thuyền tuần tra (5 ghế, súng máy mũi): vẽ mô hình khối
// thấp (cùng kiểu xe tăng), người ngồi trên ghế, đại liên xoay theo xạ thủ; hộp va chạm để người, đạn không xuyên.
// Ngồi trên xe: ghế lái thì W/S ga phanh, A/D bẻ lái (máy mình tự lái, khớp va chạm với server, gửi vị trí 15 lần mỗi
// giây); ghế xạ thủ thì chuột xoay đại liên, chuột trái bắn (server dò lại từng phát), chuột phải ngắm gần; ghế khác
// chỉ ngồi nhìn quanh. Phím 1–5 đổi ghế (ghế trống), F xuống xe.
// Xuồng cao tốc (RHIB, 4 ghế, đại liên M2 trên mũi): phao hơi hai bên mạn, máy đuôi; chạy nhanh thì lướt, mũi nảy
// lên xuống theo sóng, tung bọt hai bên mũi.

const SEND_INTERVAL = 1 / 15;
const AIM_INTERVAL = 1 / 10;

type RapierBody = ReturnType<ReturnType<typeof useRapier>["world"]["createRigidBody"]>;
/** Thân vật lý của từng xe chở quân (để tia ngắm, đạn đại liên bỏ qua chính xe mình). */
const carrierBodies = new Map<string, RapierBody>();

// ---------------------------------------------------------------------------- mô hình

const OLIVE = new MeshStandardMaterial({ color: "#5d6644", roughness: 0.75, metalness: 0.25 });
const OLIVE_DARK = new MeshStandardMaterial({ color: "#3d4530", roughness: 0.82, metalness: 0.2 });
const STEEL = new MeshStandardMaterial({ color: "#2a2c2a", roughness: 0.55, metalness: 0.6 });
const TIRE = new MeshStandardMaterial({ color: "#191919", roughness: 0.95 });
const GLASS = new MeshStandardMaterial({ color: "#1d2a33", roughness: 0.2, metalness: 0.5 });
const GREY = new MeshStandardMaterial({ color: "#6f777b", roughness: 0.7, metalness: 0.2 });
const GREY_DARK = new MeshStandardMaterial({ color: "#454b4f", roughness: 0.75, metalness: 0.25 });
const DECK = new MeshStandardMaterial({ color: "#8b8a7c", roughness: 0.9 });
const WRECK = new MeshStandardMaterial({ color: "#1c1a18", roughness: 1 });
const SKIN = new MeshStandardMaterial({ color: "#c9a07a", roughness: 0.8 });
for (const m of [OLIVE, OLIVE_DARK, STEEL, GREY, GREY_DARK, WRECK]) m.userData.detail = "metal";
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
  jChassis: B(2.0, 0.5, 4.5),
  jHood: B(1.9, 0.38, 1.45),
  jWind: B(1.9, 0.62, 0.12),
  jDoor: B(0.08, 0.55, 1.35),
  jBedSide: B(0.08, 0.5, 1.95),
  jGate: B(1.9, 0.5, 0.08),
  jBumper: B(2.05, 0.22, 0.22),
  jRoll: B(1.9, 0.08, 0.08),
  jPost: B(0.08, 0.7, 0.08),
  jStripe: B(1.0, 0.02, 0.4),
  wheel: new CylinderGeometry(0.45, 0.45, 0.34, 14),
  hub: new CylinderGeometry(0.2, 0.2, 0.36, 8),
  bHull: B(2.6, 0.95, 6.6),
  bBow: B(1.86, 0.95, 1.86),
  bDeck: B(2.42, 0.08, 6.4),
  bRail: B(0.1, 0.32, 6.0),
  bCabin: B(1.25, 0.95, 1.05),
  bWind: B(1.3, 0.42, 0.06),
  bMotor: B(0.36, 1.0, 0.42),
  bStripe: B(0.02, 0.28, 0.9),
  rTube: new CylinderGeometry(0.36, 0.36, 5.6, 12),
  rTubeBow: new SphereGeometry(0.36, 12, 8),
  rHull: B(1.7, 0.5, 6.2),
  rDeck: B(1.6, 0.06, 5.4),
  rConsole: B(0.8, 0.85, 0.65),
  rWind: B(0.85, 0.32, 0.05),
  rMotor: B(0.42, 1.0, 0.5),
  rStripe: B(0.02, 0.18, 1.2),
  pedestal: new CylinderGeometry(0.07, 0.1, 1, 8),
  gunBody: B(0.2, 0.22, 0.62),
  gunBarrel: new CylinderGeometry(0.045, 0.05, MOUNT.barrel, 8),
  gunShield: B(0.8, 0.5, 0.04),
  torso: B(0.46, 0.62, 0.3),
  head: new SphereGeometry(0.14, 10, 8),
};
G.wheel.rotateZ(Math.PI / 2);
G.hub.rotateZ(Math.PI / 2);
G.gunBarrel.rotateX(Math.PI / 2);
G.gunBarrel.translate(0, 0, MOUNT.barrel / 2);
G.bBow.rotateY(Math.PI / 4);
G.bBow.scale(0.95, 1, 1.35);
G.rTube.rotateX(Math.PI / 2);

/** Đại liên trên giá xoay: nhóm `yaw` quay quanh trục đứng, nhóm `pitch` ngẩng nòng. Gốc ở trụ xoay. */
function MountedGun({ yaw, pitch, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; wreck: boolean }) {
  const m = wreck ? WRECK : STEEL;
  return (
    <group ref={yaw}>
      <group ref={pitch}>
        <mesh geometry={G.gunBody} material={m} position={[0, 0, 0.1]} castShadow />
        <mesh geometry={G.gunBarrel} material={m} castShadow />
        <mesh geometry={G.gunShield} material={wreck ? WRECK : OLIVE_DARK} position={[0, 0.05, 0.42]} castShadow />
      </group>
    </group>
  );
}

function JeepModel({ yaw, pitch, wheels, color, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; wheels: React.RefObject<Group | null>; color: string; wreck: boolean }) {
  const body = wreck ? WRECK : OLIVE;
  const dark = wreck ? WRECK : OLIVE_DARK;
  const mount = SEATS.jeep.mount;
  return (
    <group>
      <group ref={wheels}>
        {[
          [0.95, 1.5],
          [-0.95, 1.5],
          [0.95, -1.5],
          [-0.95, -1.5],
        ].map(([x, z]) => (
          <group key={`${x}${z}`} position={[x!, 0.45, z!]}>
            <mesh geometry={G.wheel} material={TIRE} castShadow />
            <mesh geometry={G.hub} material={dark} />
          </group>
        ))}
      </group>
      <mesh geometry={G.jChassis} material={body} position={[0, 0.8, 0]} castShadow receiveShadow />
      <mesh geometry={G.jHood} material={body} position={[0, 1.24, 1.45]} castShadow />
      <mesh geometry={G.jWind} material={dark} position={[0, 1.36, 0.72]} castShadow />
      <mesh geometry={B(1.5, 0.16, 0.13)} material={GLASS} position={[0, 1.42, 0.73]} />
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh geometry={G.jDoor} material={dark} position={[s * 0.98, 1.28, 0.05]} castShadow />
          <mesh geometry={G.jBedSide} material={dark} position={[s * 0.98, 1.3, -1.3]} castShadow />
          <mesh geometry={G.jPost} material={STEEL} position={[s * 0.9, 1.75, -0.35]} />
        </group>
      ))}
      <mesh geometry={G.jRoll} material={STEEL} position={[0, 2.08, -0.35]} />
      <mesh geometry={G.jGate} material={dark} position={[0, 1.3, -2.25]} castShadow />
      <mesh geometry={G.jBumper} material={STEEL} position={[0, 0.72, 2.3]} />
      {!wreck && <mesh geometry={G.jStripe} material={teamMat(color)} position={[0, 1.44, 1.45]} />}
      <mesh geometry={G.pedestal} material={STEEL} position={[0, (mount[1] + 1.05) / 2, mount[2]]} scale={[1, mount[1] - 1.05, 1]} />
      <group position={[mount[0], mount[1], mount[2]]}>
        <MountedGun yaw={yaw} pitch={pitch} wreck={wreck} />
      </group>
    </group>
  );
}

function BoatModel({ yaw, pitch, color, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; color: string; wreck: boolean }) {
  const hull = wreck ? WRECK : GREY;
  const dark = wreck ? WRECK : GREY_DARK;
  const mount = SEATS.boat.mount;
  return (
    <group>
      <mesh geometry={G.bHull} material={hull} position={[0, 0.15, -0.4]} castShadow receiveShadow />
      <mesh geometry={G.bBow} material={hull} position={[0, 0.15, 2.9]} castShadow />
      <mesh geometry={G.bDeck} material={wreck ? WRECK : DECK} position={[0, 0.65, -0.3]} receiveShadow />
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh geometry={G.bRail} material={dark} position={[s * 1.26, 0.82, -0.6]} castShadow />
          <mesh geometry={G.bMotor} material={STEEL} position={[s * 0.5, 0.25, -3.85]} castShadow />
          {!wreck && <mesh geometry={G.bStripe} material={teamMat(color)} position={[s * 0.64, 1.15, -1.8]} />}
        </group>
      ))}
      <mesh geometry={G.bCabin} material={dark} position={[0, 1.15, -1.8]} castShadow />
      <mesh geometry={G.bWind} material={GLASS} position={[0, 1.78, -1.32]} rotation-x={-0.5} />
      <mesh geometry={G.pedestal} material={STEEL} position={[0, (mount[1] + 0.7) / 2, mount[2]]} scale={[1, mount[1] - 0.7, 1]} />
      <group position={[mount[0], mount[1], mount[2]]}>
        <MountedGun yaw={yaw} pitch={pitch} wreck={wreck} />
      </group>
    </group>
  );
}

const TUBE = new MeshStandardMaterial({ color: "#2c2f30", roughness: 0.85 });

function RhibModel({ yaw, pitch, color, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; color: string; wreck: boolean }) {
  const hull = wreck ? WRECK : GREY_DARK;
  const tube = wreck ? WRECK : TUBE;
  const mount = SEATS.rhib.mount;
  return (
    <group>
      <mesh geometry={G.rHull} material={hull} position={[0, 0.05, -0.1]} castShadow receiveShadow />
      <mesh geometry={G.rDeck} material={wreck ? WRECK : DECK} position={[0, 0.36, -0.3]} receiveShadow />
      {[1, -1].map((s) => (
        <group key={s}>
          {/* Phao hơi chạy dọc mạn, mũi bo tròn khép vào nhau. */}
          <mesh geometry={G.rTube} material={tube} position={[s * 0.95, 0.42, -0.4]} castShadow />
          <mesh geometry={G.rTubeBow} material={tube} position={[s * 0.62, 0.48, 2.55]} scale={[1, 1, 1.6]} castShadow />
          {!wreck && <mesh geometry={G.rStripe} material={teamMat(color)} position={[s * 1.32, 0.5, 0.4]} />}
        </group>
      ))}
      <mesh geometry={G.rConsole} material={hull} position={[0, 0.8, -1.05]} castShadow />
      <mesh geometry={G.rWind} material={GLASS} position={[0, 1.36, -0.78]} rotation-x={-0.45} />
      <mesh geometry={G.rMotor} material={STEEL} position={[0, 0.35, -3.35]} castShadow />
      <mesh geometry={G.pedestal} material={STEEL} position={[0, (mount[1] + 0.4) / 2, mount[2]]} scale={[1, mount[1] - 0.4, 1]} />
      <group position={[mount[0], mount[1], mount[2]]}>
        <MountedGun yaw={yaw} pitch={pitch} wreck={wreck} />
      </group>
    </group>
  );
}

/** Người ngồi trên xe: khối thân và đầu, áo theo màu đội. */
function Rider({ at, color }: { at: readonly [number, number, number]; color: string }) {
  return (
    <group position={[at[0], at[1], at[2]]}>
      <mesh geometry={G.torso} material={teamMat(color)} position={[0, 0.3, 0]} castShadow />
      <mesh geometry={G.head} material={SKIN} position={[0, 0.76, 0]} castShadow />
    </group>
  );
}

// ---------------------------------------------------------------------------- một chiếc xe chở quân

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");
const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));

export function Carrier({ room, id, v, teamColor }: { room: IslandRoom; id: string; v: VehicleState; teamColor: (team: string) => string }) {
  const kind = (v.kind === "boat" || v.kind === "rhib" ? v.kind : "jeep") as Exclude<VehicleKind, "tank">;
  const spec = vehicleSpec(kind);
  const { world: physics, rapier } = useRapier();
  const root = useRef<Group>(null);
  const yaw = useRef<Group>(null);
  const pitch = useRef<Group>(null);
  const wheels = useRef<Group>(null);
  const riders = useRef<Group>(null);
  const [wreck, setWreck] = useState(v.hp <= 0);
  const [color, setColor] = useState(teamColor(v.team));
  const anim = useRef({ x: v.x, y: v.y, z: v.z, rotY: v.rotY, turret: v.turret, pitch: v.pitch, tiltX: 0, tiltZ: 0, bounce: 0, roll: 0, px: v.x, pz: v.z, speed: 0, spray: 0 });
  const interp = useRef({ x: v.x, y: v.y, z: v.z, rotY: v.rotY });
  const engine = useRef<ReturnType<typeof motorEngine> | null>(null);

  useEffect(() => {
    const body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, v.y, v.z));
    const [hw, hh, hl] = spec.half;
    physics.createCollider(rapier.ColliderDesc.cuboid(hw - 0.05, hh * 0.8, hl - 0.1).setTranslation(0, hh * 0.8 + (isBoat(kind) ? 0 : 0.25), 0), body);
    carrierBodies.set(id, body);
    return () => {
      carrierBodies.delete(id);
      if (physics.getRigidBody(body.handle)) physics.removeRigidBody(body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, rapier, id]);

  useEffect(
    () => () => {
      engine.current?.stop();
      engine.current = null;
    },
    [],
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = anim.current;
    const mine = cdrive.vid === id;
    // Xe mình đang ngồi: lấy tư thế bộ điều khiển đã tính (lái thì dự đoán, ngồi thì nội suy); xe khác nội suy Hermite
    // giữa các gói server (netInterp.ts), chưa có băng thì kéo dần về trạng thái mới nhất.
    const smooth = !mine && sampleTrack(vehicleTracks, id, interp.current);
    const src = mine ? cdrive.pose : smooth ? interp.current : v;
    const k = mine || smooth ? 1 : Math.min(1, dt * 10);
    a.x += (src.x - a.x) * k;
    a.y += (src.y - a.y) * k;
    a.z += (src.z - a.z) * k;
    a.rotY += wrap(src.rotY - a.rotY) * k;
    const gunYaw = mine && cdrive.gunner ? cdrive.gunYaw : v.turret;
    const gunPitch = mine && cdrive.gunner ? cdrive.gunPitch : v.pitch;
    a.turret += wrap(gunYaw - a.turret) * Math.min(1, mine ? 1 : dt * 12);
    a.pitch += (gunPitch - a.pitch) * Math.min(1, mine ? 1 : dt * 12);
    const moved = Math.hypot(a.x - a.px, a.z - a.pz);
    const fwd = (a.x - a.px) * Math.sin(a.rotY) + (a.z - a.pz) * Math.cos(a.rotY);
    a.speed += ((dt > 0 ? fwd / dt : 0) - a.speed) * Math.min(1, dt * 5);
    a.px = a.x;
    a.pz = a.z;
    if (v.hp <= 0 !== wreck) setWreck(v.hp <= 0);
    const c = teamColor(v.team);
    if (c !== color) setColor(c);
    const t = performance.now() / 1000;
    const world = mapForMode(room.state.battleMode, room.state.worldSeed).world;
    const s = Math.sin(a.rotY);
    const co = Math.cos(a.rotY);
    let y = a.y;
    if (kind === "jeep") {
      // Nhún theo mặt đất: nghiêng theo dốc (trước sau, trái phải), lò xo nhún nhẹ khi chạy nhanh trên đất gồ ghề.
      const hf = world.heightAt(a.x + s * 1.5, a.z + co * 1.5);
      const hb = world.heightAt(a.x - s * 1.5, a.z - co * 1.5);
      const hr = world.heightAt(a.x + co * 0.95, a.z - s * 0.95);
      const hl = world.heightAt(a.x - co * 0.95, a.z + s * 0.95);
      a.tiltX += (Math.atan2(hb - hf, 3) - a.tiltX) * Math.min(1, dt * 9);
      a.tiltZ += (Math.atan2(hr - hl, 1.9) - a.tiltZ) * Math.min(1, dt * 9);
      const rough = Math.min(1, Math.abs(a.speed) / JEEP.forward);
      a.bounce = Math.sin(t * 13 + a.x * 0.7) * 0.035 * rough + Math.sin(t * 7.3 + a.z) * 0.02 * rough;
      y += a.bounce;
      if (wheels.current && !wreck) {
        a.roll += (Math.sign(fwd) * moved) / 0.45;
        for (const w of wheels.current.children) w.rotation.x = a.roll;
      }
    } else if (kind === "rhib") {
      // Xuồng cao tốc: chạy nhanh thì lướt (mũi ngóc lên, thân nhô khỏi nước), nảy lên đập xuống theo từng ngọn sóng.
      const plane = Math.min(1, Math.abs(a.speed) / RHIB.forward);
      const slam = Math.abs(Math.sin(t * 4.2 + a.x * 0.13 + a.z * 0.07));
      a.tiltX += (-0.11 * plane + (slam - 0.6) * 0.09 * plane + Math.sin(t * 1.5 + a.x * 0.05) * 0.03 - a.tiltX) * Math.min(1, dt * 6);
      a.tiltZ = Math.sin(t * 1.3 + a.z * 0.05) * 0.04 * (wreck ? 2.5 : 1);
      y = (wreck ? -0.5 : 0) + Math.sin(t * 1.9 + a.x * 0.1) * 0.07 + plane * 0.18 + slam * slam * 0.22 * plane;
      // Bọt nước tung hai bên mũi khi lướt nhanh.
      if (plane > 0.4 && !wreck) {
        a.spray -= dt * plane * 18;
        while (a.spray < 0) {
          a.spray += 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          const bx = a.x + s * 2.2 + co * side * 1.1;
          const bz = a.z + co * 2.2 - s * side * 1.1;
          effects.impacts.push({ x: bx, y: 0.05, z: bz, nx: co * side * 0.6, ny: 0.7, nz: -s * side * 0.6, born: t, blood: false, noHole: true, surface: "water" });
        }
      }
    } else {
      // Thuyền: dập dềnh theo sóng, chạy nhanh thì mũi ngóc lên.
      const plane = Math.min(1, Math.abs(a.speed) / BOAT.forward);
      a.tiltX += (-0.07 * plane + Math.sin(t * 1.3 + a.x * 0.05) * 0.025 - a.tiltX) * Math.min(1, dt * 4);
      a.tiltZ = Math.sin(t * 1.1 + a.z * 0.05) * 0.035 * (wreck ? 2.5 : 1);
      y = (wreck ? -0.55 : 0) + Math.sin(t * 1.7 + a.x * 0.1) * 0.08 + plane * 0.12;
    }
    const g = root.current;
    if (g) {
      g.position.set(a.x, y, a.z);
      g.rotation.set(a.tiltX, a.rotY, a.tiltZ, "YXZ");
    }
    if (yaw.current) yaw.current.rotation.y = a.turret - a.rotY;
    if (pitch.current) pitch.current.rotation.x = -a.pitch;
    // Người ngồi: hiện đúng ghế có người.
    if (riders.current) {
      const list = riders.current.children;
      // Ngồi ghế xạ thủ thì giấu thân mình (camera ngay sau vai, thân che mất tầm ngắm).
      for (let i = 0; i < list.length; i++) list[i]!.visible = !wreck && !!(i === 0 ? v.driver : v.seats.get(String(i))) && !(mine && cdrive.gunner && i === cdrive.seat);
    }
    const body = carrierBodies.get(id);
    if (body) {
      body.setNextKinematicTranslation({ x: a.x, y: isBoat(kind) ? 0 : a.y, z: a.z });
      _q.setFromEuler(_e.set(0, a.rotY, 0));
      body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    // Tiếng máy: xe còn chạy, có người ngồi, trong tầm nghe.
    const d = camera.position.distanceTo(g?.position ?? camera.position);
    if (!wreck && d < 90 && (v.driver || mine)) {
      engine.current ??= motorEngine(kind);
      engine.current.update({ x: a.x, y: a.y + 1, z: a.z }, mine ? cdrive.speed : a.speed, mine);
    } else if (engine.current) {
      engine.current.stop();
      engine.current = null;
    }
  });

  const seats = SEATS[kind].seats;
  return (
    <group ref={root}>
      {kind === "jeep" ? <JeepModel yaw={yaw} pitch={pitch} wheels={wheels} color={color} wreck={wreck} /> : kind === "rhib" ? <RhibModel yaw={yaw} pitch={pitch} color={color} wreck={wreck} /> : <BoatModel yaw={yaw} pitch={pitch} color={color} wreck={wreck} />}
      <group ref={riders}>
        {seats.map((at, i) => (
          <Rider key={i} at={[at[0], at[1] - 0.35, at[2]]} color={color} />
        ))}
      </group>
      <WreckFire wreck={wreck} size={kind === "jeep" ? 0.7 : 0.8} top={kind === "jeep" ? 1.4 : 0.9} />
    </group>
  );
}

// ---------------------------------------------------------------------------- ngồi trên xe chở quân

/** Trạng thái xe chở quân mình đang ngồi: tư thế (lái thì tự tính, ngồi thì nội suy), đại liên, bắn. */
const cdrive = {
  vid: "",
  kind: "" as string,
  seat: -1,
  gunner: false,
  pose: { x: 0, y: 0, z: 0, rotY: 0 } as TankPose,
  speed: 0,
  sendAt: 0,
  lastSent: "",
  aimAt: 0,
  lastAim: "",
  gunYaw: 0,
  gunPitch: 0,
  fireHeld: false,
  zoom: false,
  nextShot: 0,
};

const _ray = { o: new Vector3(), d: new Vector3() };
const _tmp = { target: new Vector3(), pos: new Vector3(), dir: new Vector3(), aim: new Vector3(), right: new Vector3(), up: new Vector3() };
const _o: [number, number, number] = [0, 0, 0];
const _d: [number, number, number] = [0, 0, 0];

export function CarrierSeat({ room }: { room: IslandRoom }) {
  const { world: physics, rapier } = useRapier();

  // Chuột trái bắn đại liên, chuột phải ngắm gần; phím 1–5 đổi ghế.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!cdrive.vid || !document.pointerLockElement || menuOpen()) return;
      if (e.button === 0) cdrive.fireHeld = true;
      if (e.button === 2) cdrive.zoom = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) cdrive.fireHeld = false;
      if (e.button === 2) cdrive.zoom = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || !cdrive.vid || menuOpen()) return;
      const m = /^Digit([1-5])$/.exec(e.code);
      if (m) room.send(Messages.vehicleSeat, { seat: Number(m[1]) - 1 });
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

  // Server sửa vị trí xe mình lái (đi quá nhanh, lên cạn): nhận lại tư thế server giữ.
  useEffect(
    () =>
      room.onMessage(Messages.correct, (at: { x: number; y: number; z: number }) => {
        if (!cdrive.vid || cdrive.seat !== 0) return;
        cdrive.pose = { ...cdrive.pose, x: at.x, y: at.y, z: at.z };
        cdrive.speed = 0;
      }),
    [room],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const mid = myId(room);
    const me = room.state.players.get(mid);
    const vid = me?.alive && me.vehicle ? me.vehicle : "";
    const v = vid ? room.state.vehicles.get(vid) : undefined;
    // Xe tăng, vũ khí cố định có bộ điều khiển riêng (Vehicles.tsx, Emplacements.tsx).
    // Trực thăng: Heli.tsx.
    if (!v || v.hp <= 0 || v.kind === "tank" || v.kind === "heli" || isEmplacement(v.kind)) {
      if (cdrive.vid) {
        // Vừa xuống xe (hay xe nổ): trả camera, FOV về cho nhân vật.
        cdrive.vid = "";
        cdrive.fireHeld = cdrive.zoom = false;
        carrierHud.active = false;
        if (seatOwner.kind === "carrier") {
          seatOwner.kind = "";
          seat.id = "";
          aimZoom.value = 1;
        }
      }
      return;
    }
    const kind = v.kind;
    let mySeat = v.driver === mid ? 0 : -1;
    if (mySeat < 0) for (const [k, q] of v.seats) if (q === mid) mySeat = Number(k);
    if (mySeat < 0) return;
    if (cdrive.vid !== vid) {
      // Vừa lên xe: lấy tư thế từ server, nhìn theo mũi xe.
      cdrive.vid = vid;
      cdrive.kind = kind;
      cdrive.pose = { x: v.x, y: v.y, z: v.z, rotY: v.rotY };
      cdrive.speed = 0;
      cdrive.gunYaw = v.turret;
      cdrive.gunPitch = v.pitch;
      look.yaw = v.rotY + Math.PI;
      look.pitch = 0.22;
      if (getBattleHud().nearTank) setBattleHud({ nearTank: "" });
    }
    seatOwner.kind = "carrier";
    seat.id = vid;
    cdrive.seat = mySeat;
    cdrive.gunner = mySeat === SEATS[kind as Exclude<VehicleKind, "tank">].gunner;
    const map = mapForMode(room.state.battleMode, room.state.worldSeed);
    const typing = menuOpen();
    if (mySeat === 0) {
      const throttle = typing ? 0 : (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const steer = typing ? 0 : (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const step = vehicleStep(kind, map, cdrive.pose, throttle, steer, cdrive.speed, dt);
      // Không chạy xuyên qua xe khác.
      let blocked = false;
      for (const [oid, o] of room.state.vehicles) {
        if (oid === vid) continue;
        const reach = (vehicleSpec(o.kind).half[2] + vehicleSpec(kind).half[2]) * 0.8;
        const dNew = Math.hypot(o.x - step.pose.x, o.z - step.pose.z);
        if (dNew < reach && dNew < Math.hypot(o.x - cdrive.pose.x, o.z - cdrive.pose.z)) blocked = true;
      }
      if (blocked) cdrive.speed = 0;
      else {
        cdrive.pose = step.pose;
        cdrive.speed = step.speed;
      }
    } else {
      // Ngồi ghế khác: theo tư thế server (nội suy).
      const k = Math.min(1, dt * 10);
      const p = cdrive.pose;
      const nx = p.x + (v.x - p.x) * k;
      const nz = p.z + (v.z - p.z) * k;
      cdrive.speed += ((dt > 0 ? Math.hypot(nx - p.x, nz - p.z) / dt : 0) - cdrive.speed) * Math.min(1, dt * 4);
      cdrive.pose = { x: nx, y: p.y + (v.y - p.y) * k, z: nz, rotY: p.rotY + wrap(v.rotY - p.rotY) * k };
    }
    const p = cdrive.pose;

    // Camera: sau lưng xe (lái, ngồi), hay sau vai xạ thủ trên giá đại liên; xoay theo chuột.
    smoothView(dt);
    const cam = state.camera as PerspectiveCamera;
    const { target, pos, dir, aim } = _tmp;
    const zoom = cdrive.gunner && cdrive.zoom;
    if (cdrive.gunner) {
      const m = mountMuzzle(kind, p, 0, 0).pivot;
      target.set(m[0], m[1] + 0.85, m[2]);
    } else target.set(p.x, p.y + (isBoat(kind) ? 2.2 : 2.4), p.z);
    const dist = cdrive.gunner ? (zoom ? 0.01 : 3.6) : kind === "boat" ? 10.5 : kind === "rhib" ? 9 : 8.5;
    const horizontal = Math.cos(view.pitch) * dist;
    pos.set(target.x + Math.sin(view.yaw) * horizontal, target.y + Math.sin(view.pitch) * dist, target.z + Math.cos(view.yaw) * horizontal);
    const floor = Math.max(map.world.heightAt(pos.x, pos.z), 0) + 0.5;
    if (pos.y < floor) pos.y = floor;
    cam.position.copy(pos);
    dir.set(-Math.sin(view.yaw) * Math.cos(view.pitch), -Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch));
    cam.lookAt(aim.copy(pos).add(dir));
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.3;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      shake.amount *= Math.exp(-dt * 7);
    }
    const baseFov = getSettings().fov;
    const wantFov = zoom ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / 2.2) * 180) / Math.PI : baseFov;
    aimZoom.value = zoom ? 2.2 : 1;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }

    const own = carrierBodies.get(vid);
    const skipOwn = (c: { parent(): { handle: number } | null }) => {
      const h = c.parent()?.handle;
      return h !== own?.handle && h !== localBody.current?.handle;
    };
    const now = performance.now();
    if (cdrive.gunner) {
      // Điểm ngắm: tia từ camera qua giữa màn hình (bỏ qua chính xe mình); đại liên quay nhanh về đó.
      cam.getWorldDirection(dir);
      const hit = physics.castRay(new rapier.Ray(cam.position, dir), 500, true, undefined, BULLET_GROUPS, undefined, undefined, skipOwn);
      aim.copy(cam.position).addScaledVector(dir, hit ? hit.timeOfImpact : 300);
      const pivot = mountMuzzle(kind, p, 0, 0).pivot;
      const wantYaw = Math.atan2(aim.x - pivot[0], aim.z - pivot[2]);
      const wantPitch = Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, Math.atan2(aim.y - pivot[1], Math.hypot(aim.x - pivot[0], aim.z - pivot[2]))));
      const turn = 3.2 * dt;
      cdrive.gunYaw += Math.max(-turn, Math.min(turn, wrap(wantYaw - cdrive.gunYaw)));
      cdrive.gunPitch += Math.max(-turn, Math.min(turn, wantPitch - cdrive.gunPitch));
      const mz = mountMuzzle(kind, p, cdrive.gunYaw, cdrive.gunPitch);
      const reach = Math.max(8, aim.distanceTo(_ray.o.set(...mz.o)));
      _tmp.up.set(mz.o[0] + mz.d[0] * reach, mz.o[1] + mz.d[1] * reach, mz.o[2] + mz.d[2] * reach).project(cam);
      carrierHud.aimOn = _tmp.up.z < 1;
      carrierHud.aimX = (_tmp.up.x + 1) / 2;
      carrierHud.aimY = (1 - _tmp.up.y) / 2;
      // Báo server hướng súng (người khác thấy súng xoay).
      cdrive.aimAt += dt;
      if (cdrive.aimAt >= AIM_INTERVAL) {
        cdrive.aimAt = 0;
        const key = `${cdrive.gunYaw.toFixed(2)},${cdrive.gunPitch.toFixed(2)}`;
        if (key !== cdrive.lastAim) {
          cdrive.lastAim = key;
          room.send(Messages.vehicleAim, { turret: cdrive.gunYaw, pitch: cdrive.gunPitch });
        }
      }
      // Bắn theo nhịp đại liên.
      if (cdrive.fireHeld && now >= cdrive.nextShot && room.state.phase === "battle") {
        cdrive.nextShot = Math.max(cdrive.nextShot + 60000 / HMG.rpm, now);
        fireMounted(room, mz, skipOwn, physics, rapier);
        shake.amount = Math.min(0.35, shake.amount + 0.06);
        look.pitch -= 0.004;
      }
    } else carrierHud.aimOn = false;

    const at = seatPos(kind, p, mySeat);
    seat.y = at[1] - 0.5;
    seat.x = at[0];
    seat.z = at[2];

    // Bảng điều khiển.
    const spec = vehicleSpec(kind);
    carrierHud.active = true;
    carrierHud.kind = kind;
    carrierHud.seat = mySeat;
    carrierHud.hp = v.hp;
    carrierHud.maxHp = spec.hp;
    carrierHud.speed = cdrive.speed;
    carrierHud.gunner = cdrive.gunner;
    carrierHud.zoom = zoom;
    const names = SEATS[kind as Exclude<VehicleKind, "tank">].names;
    let key = `${kind}|${mySeat}`;
    for (let i = 0; i < names.length; i++) key += `|${i === 0 ? v.driver : (v.seats.get(String(i)) ?? "")}`;
    if (key !== carrierHud.seatsKey) {
      carrierHud.seatsKey = key;
      carrierHud.seats = names.map((name, i) => {
        const pid = i === 0 ? v.driver : (v.seats.get(String(i)) ?? "");
        return { name, who: pid ? (room.state.players.get(pid)?.name ?? "?") : "", mine: pid === mid };
      });
    }

    // Lái: gửi vị trí.
    if (mySeat === 0) {
      cdrive.sendAt += dt;
      if (cdrive.sendAt >= SEND_INTERVAL) {
        cdrive.sendAt = 0;
        const msg: VehicleMoveMessage = { x: p.x, y: p.y, z: p.z, rotY: p.rotY, turret: v.turret, pitch: Math.max(-1, Math.min(1, v.pitch)), moving: Math.abs(cdrive.speed) > 0.3 };
        const k2 = `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.rotY.toFixed(3)},${msg.moving}`;
        if (k2 !== cdrive.lastSent) {
          cdrive.lastSent = k2;
          room.send(Messages.vehicleMove, msg);
        }
      }
    }
  }, -1);
  return null;
}

type Physics = ReturnType<typeof useRapier>["world"];
type Rapier = ReturnType<typeof useRapier>["rapier"];

/**
 * Một phát đại liên: lệch chút trong nón toả, dò tường / xe bằng tia vật lý (bỏ qua xe mình), dò người máy mình đang
 * vẽ; gửi server kiểm tra lại, tự vẽ vệt đạn, lửa đầu nòng, tiếng súng của mình.
 */
export function fireMounted(room: IslandRoom, mz: { o: [number, number, number]; d: [number, number, number] }, skipOwn: (c: { parent(): { handle: number } | null }) => boolean, physics: Physics, rapier: Rapier) {
  const { right, up } = _tmp;
  const d = _ray.d.set(mz.d[0], mz.d[1], mz.d[2]);
  right.set(d.z, 0, -d.x).normalize();
  up.crossVectors(d, right).normalize();
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * HMG.hipSpread;
  d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  const o = _ray.o.set(mz.o[0], mz.o[1], mz.o[2]);
  const max = Math.min(600, HMG.range * 3);
  const wall = physics.castRay(new rapier.Ray(o, d), max, true, undefined, BULLET_GROUPS, undefined, undefined, skipOwn);
  let tEnd = wall ? wall.timeOfImpact : max;
  let target = "";
  let part: "head" | "body" = "body";
  const mid = myId(room);
  const team = room.state.players.get(mid)?.team ?? "";
  _o[0] = o.x;
  _o[1] = o.y;
  _o[2] = o.z;
  _d[0] = d.x;
  _d[1] = d.y;
  _d[2] = d.z;
  for (const [id, b] of bodies) {
    if (id === mid || !b.alive || (team && b.team === team)) continue;
    const h = rayBody(_o, _d, { x: b.x, y: b.y, z: b.z, rotY: b.rotY, crouch: b.crouch, prone: b.prone, lean: b.lean });
    if (h && h.t < tEnd) {
      tEnd = h.t;
      target = id;
      part = h.part;
    }
  }
  const msg: VehicleGunMessage = { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], hits: target ? [{ target, part, d: tEnd, ray: 0 }] : [] };
  room.send(Messages.vehicleGun, msg);
  const now = performance.now() / 1000;
  effects.tracers.push({ ox: o.x, oy: o.y, oz: o.z, ex: o.x + d.x * tEnd, ey: o.y + d.y * tEnd, ez: o.z + d.z * tEnd, born: now, mine: true, speed: HMG.velocity });
  effects.flashes.push({ x: o.x, y: o.y, z: o.z, born: now });
  if (wall && !target && tEnd < max) effects.impacts.push({ x: o.x + d.x * tEnd, y: o.y + d.y * tEnd, z: o.z + d.z * tEnd, nx: -d.x, ny: -d.y, nz: -d.z, born: now, blood: false, noHole: true });
  playGunshot(HMG.id, { x: o.x, y: o.y, z: o.z }, true);
}

/** Tia lửa, tiếng keng khi đạn nảy khỏi giáp; tiếng xích đứt, khói bụi ở xích. */
export function useVehicleFx(room: IslandRoom) {
  useEffect(
    () =>
      room.onMessage(Messages.vehicleFx, (m: VehicleFxMessage) => {
        const now = performance.now() / 1000;
        if (m.kind === "ricochet") {
          effects.flashes.push({ x: m.x, y: m.y, z: m.z, born: now });
          for (let k = 0; k < 3; k++) effects.impacts.push({ x: m.x, y: m.y, z: m.z, nx: Math.random() - 0.5, ny: 0.6, nz: Math.random() - 0.5, born: now, blood: false, surface: "metal", noHole: true });
          playRicochet({ x: m.x, y: m.y, z: m.z });
        } else {
          for (let k = 0; k < 4; k++) effects.impacts.push({ x: m.x + (Math.random() - 0.5) * 3, y: m.y, z: m.z + (Math.random() - 0.5) * 3, nx: 0, ny: 1, nz: 0, born: now, blood: false, noHole: true });
          playTrackSnap({ x: m.x, y: m.y, z: m.z });
        }
        if (Math.hypot(m.x - localPosition.x, m.z - localPosition.z) < 12) shake.amount = Math.min(0.6, shake.amount + 0.2);
      }),
    [room],
  );
}


/** Dòng nhắc lên xe chở quân: loại xe và ghế sẽ ngồi. */
export function carrierPrompt(kind: string, seatIndex: number): string {
  if (isEmplacement(kind)) return kind === "mortar" ? "Vào vị trí cối 82mm" : "Vào ổ đại liên";
  const k = kind === "boat" || kind === "rhib" || kind === "heli" ? kind : "jeep";
  const what = k === "heli" ? "Lên trực thăng" : k === "rhib" ? "Lên xuồng cao tốc" : k === "boat" ? "Lên thuyền" : "Lên xe trinh sát";
  return `${what} · ${SEATS[k].names[seatIndex] ?? ""}`;
}
