import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { Callbacks } from "@colyseus/sdk";
import { BoxGeometry, CylinderGeometry, Euler, MeshStandardMaterial, Quaternion, Vector3, type Group, type PerspectiveCamera } from "three";
import { TANK, TEAM_COLORS, mapForMode, cannonMuzzle, cannonPitch, vehicleSpec, vehicleStep, type TankPose } from "@tentides/content";
import { Messages, type VehicleMoveMessage, type VehicleState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, keys, look, smoothView, view } from "../input.ts";
import { getSettings, aimZoom } from "../settings.ts";
import { localPosition, shake } from "../shared.ts";
import { playCannon, playCannonReady, tankEngine } from "../sound/guns.ts";
import { effects, getBattleHud, menuOpen, seat, setBattleHud } from "./runtime.ts";
import { Carrier, CarrierSeat, useVehicleFx } from "./Carriers.tsx";
import { nearInfo, seatOwner, WreckFire } from "./vehicleParts.tsx";

// Xe tăng: vẽ thân, xích, tháp pháo quay độc lập, nòng pháo ngẩng hạ; hộp va chạm để người, đạn không xuyên qua.
// Xe mình lái: W/S tiến lùi, A/D bẻ lái (quay tại chỗ được), chuột xoay tháp pháo theo hướng nhìn, chuột trái bắn
// pháo (nạp đạn vài giây), chuột phải nhìn qua kính ngắm pháo thủ, F xuống xe. Máy mình tự lái (khớp va chạm với
// server), gửi vị trí 15 lần mỗi giây; xe người khác (và xe máy lái) nội suy mượt theo server.

const SEND_INTERVAL = 1 / 15;
const CAM_DIST = 11;
const CAM_HEIGHT = 3.1;

/** Trạng thái xe mình đang lái (cho HUD đọc): máu, nạp đạn, tốc độ, điểm nòng pháo đang chĩa tới trên màn hình. */
export const tankHud = { active: false, hp: 0, reload: 1, speed: 0, zoom: false, aimX: 0.5, aimY: 0.5, aimOn: false, tracks: 0 };

/** Thân vật lý của từng xe (để tia ngắm của xe mình bỏ qua chính nó). */
type RapierBody = ReturnType<ReturnType<typeof useRapier>["world"]["createRigidBody"]>;
const tankBodies = new Map<string, RapierBody>();

// ---------------------------------------------------------------------------- mô hình

const OLIVE = new MeshStandardMaterial({ color: "#56603f", roughness: 0.78, metalness: 0.25 });
const OLIVE_DARK = new MeshStandardMaterial({ color: "#3f4730", roughness: 0.82, metalness: 0.2 });
const TRACK = new MeshStandardMaterial({ color: "#1d1d1b", roughness: 0.95 });
const WHEEL = new MeshStandardMaterial({ color: "#2e3226", roughness: 0.8, metalness: 0.3 });
const WRECK = new MeshStandardMaterial({ color: "#1c1a18", roughness: 1 });
for (const m of [OLIVE, OLIVE_DARK, TRACK, WHEEL, WRECK]) m.userData.detail = "metal";
const teamMats = new Map<string, MeshStandardMaterial>();
function teamMat(color: string): MeshStandardMaterial {
  let m = teamMats.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 });
    teamMats.set(color, m);
  }
  return m;
}

const G = {
  hull: new BoxGeometry(2.9, 0.9, 5.8),
  glacis: new BoxGeometry(2.9, 0.7, 1.4),
  track: new BoxGeometry(0.72, 0.95, 6.2),
  wheel: new CylinderGeometry(0.36, 0.36, 0.76, 12),
  turret: new BoxGeometry(2.1, 0.72, 2.7),
  turretTop: new BoxGeometry(1.7, 0.2, 2.1),
  barrel: new CylinderGeometry(0.1, 0.12, TANK.barrel, 10),
  mantlet: new BoxGeometry(0.8, 0.5, 0.5),
  brake: new CylinderGeometry(0.16, 0.16, 0.35, 10),
  hatch: new CylinderGeometry(0.34, 0.34, 0.14, 12),
  stripe: new BoxGeometry(2.14, 0.14, 1.2),
};
G.wheel.rotateZ(Math.PI / 2);
G.barrel.rotateX(Math.PI / 2);
G.barrel.translate(0, 0, TANK.barrel / 2);
G.brake.rotateX(Math.PI / 2);

/** Màu đội (theo id đội), để phân biệt xe mình với xe địch. */
export function teamColor(team: string): string {
  if (!team) return "#9a9a8a";
  if (team === "blue") return "#2f6bff";
  if (team === "red") return "#e0332b";
  let h = 0;
  for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length]!;
}

/** Hình xe tăng: gốc ở đáy xe giữa thân, mũi theo +z. `turret` và `gun` là nhóm tháp pháo và nòng (xoay mỗi khung). */
function TankModel({ turret, gun, recoil, color, wreck }: { turret: React.RefObject<Group | null>; gun: React.RefObject<Group | null>; recoil: React.RefObject<Group | null>; color: string; wreck: boolean }) {
  const body = wreck ? WRECK : OLIVE;
  const dark = wreck ? WRECK : OLIVE_DARK;
  const wheels = [-2.4, -1.45, -0.5, 0.5, 1.45, 2.4];
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh geometry={G.track} material={TRACK} position={[sx * 1.35, 0.48, 0]} castShadow receiveShadow />
          {wheels.map((z) => (
            <mesh key={z} geometry={G.wheel} material={WHEEL} position={[sx * 1.37, 0.42, z]} />
          ))}
        </group>
      ))}
      <mesh geometry={G.hull} material={body} position={[0, 1.1, -0.1]} castShadow receiveShadow />
      <mesh geometry={G.glacis} material={dark} position={[0, 1.0, 2.9]} rotation-x={-0.5} castShadow />
      <group ref={turret} position={[0, 1.55, -0.3]}>
        <mesh geometry={G.turret} material={body} position={[0, 0.36, 0]} castShadow />
        <mesh geometry={G.turretTop} material={dark} position={[0, 0.8, -0.15]} castShadow />
        <mesh geometry={G.hatch} material={dark} position={[0.45, 0.93, -0.5]} />
        {!wreck && <mesh geometry={G.stripe} material={teamMat(color)} position={[0, 0.3, -0.4]} />}
        <group ref={gun} position={[0, TANK.gunY - 1.55, 1.2]}>
          <mesh geometry={G.mantlet} material={dark} castShadow />
          <group ref={recoil}>
            <mesh geometry={G.barrel} material={dark} castShadow />
            <mesh geometry={G.brake} material={dark} position={[0, 0, TANK.barrel - 0.15]} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------- một chiếc xe

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");

function Tank({ room, id, v }: { room: IslandRoom; id: string; v: VehicleState }) {
  const { world: physics, rapier } = useRapier();
  const root = useRef<Group>(null);
  const turret = useRef<Group>(null);
  const gun = useRef<Group>(null);
  const recoil = useRef<Group>(null);
  const [wreck, setWreck] = useState(v.hp <= 0);
  const [color, setColor] = useState(teamColor(v.team));
  const anim = useRef({ x: v.x, y: v.y, z: v.z, rotY: v.rotY, turret: v.turret, pitch: v.pitch, shots: v.shots, kick: 0, tiltX: 0, tiltZ: 0 });
  const engine = useRef<ReturnType<typeof tankEngine> | null>(null);

  // Hộp va chạm: người đi bộ không xuyên qua xe, đạn găm vào vỏ thép.
  useEffect(() => {
    const body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, v.y, v.z));
    physics.createCollider(rapier.ColliderDesc.cuboid(TANK.half[0] - 0.1, 0.95, TANK.half[2] - 0.1).setTranslation(0, 1.0, 0), body);
    physics.createCollider(rapier.ColliderDesc.cuboid(1.0, 0.4, 1.3).setTranslation(0, 2.3, -0.3), body);
    tankBodies.set(id, body);
    return () => {
      tankBodies.delete(id);
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
    const mine = seat.id === id;
    // Xe mình: lấy đúng tư thế máy mình đang lái; xe khác: nội suy theo server.
    const src = mine ? drive.pose : v;
    const k = mine ? 1 : Math.min(1, dt * 10);
    a.x += (src.x - a.x) * k;
    a.y += (src.y - a.y) * k;
    a.z += (src.z - a.z) * k;
    const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));
    a.rotY += wrap(src.rotY - a.rotY) * k;
    const tTurret = mine ? drive.turret : v.turret;
    const tPitch = mine ? drive.pitch : v.pitch;
    a.turret += wrap(tTurret - a.turret) * (mine ? 1 : Math.min(1, dt * 12));
    a.pitch += (tPitch - a.pitch) * (mine ? 1 : Math.min(1, dt * 12));
    if (v.hp <= 0 !== wreck) setWreck(v.hp <= 0);
    const c = teamColor(v.team);
    if (c !== color) setColor(c);
    // Nghiêng theo mặt đất (dốc trước sau, trái phải).
    const world = mapForMode(room.state.battleMode, room.state.worldSeed).world;
    const s = Math.sin(a.rotY);
    const co = Math.cos(a.rotY);
    const hf = world.heightAt(a.x + s * 2.6, a.z + co * 2.6);
    const hb = world.heightAt(a.x - s * 2.6, a.z - co * 2.6);
    const hr = world.heightAt(a.x + co * 1.4, a.z - s * 1.4);
    const hl = world.heightAt(a.x - co * 1.4, a.z + s * 1.4);
    a.tiltX += (Math.atan2(hb - hf, 5.2) - a.tiltX) * Math.min(1, dt * 6);
    a.tiltZ += (Math.atan2(hr - hl, 2.8) - a.tiltZ) * Math.min(1, dt * 6);
    const g = root.current;
    if (g) {
      g.position.set(a.x, a.y, a.z);
      g.rotation.set(a.tiltX, a.rotY, a.tiltZ, "YXZ");
    }
    if (turret.current) turret.current.rotation.y = a.turret - a.rotY;
    if (gun.current) gun.current.rotation.x = -a.pitch;
    // Phát pháo mới: nòng giật lùi, lửa đầu nòng.
    if (v.shots !== a.shots) {
      a.shots = v.shots;
      a.kick = 1;
      const m = cannonMuzzle(a, a.turret, a.pitch);
      effects.flashes.push({ x: m.o[0], y: m.o[1], z: m.o[2], born: performance.now() / 1000 });
    }
    a.kick = Math.max(0, a.kick - dt * 2.5);
    if (recoil.current) recoil.current.position.z = -0.55 * Math.sin(Math.min(1, a.kick) * Math.PI * 0.5) * a.kick;
    const body = tankBodies.get(id);
    if (body) {
      body.setNextKinematicTranslation({ x: a.x, y: a.y, z: a.z });
      _q.setFromEuler(_e.set(0, a.rotY, 0));
      body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    // Tiếng máy: chỉ xe còn chạy, trong tầm nghe.
    const d = camera.position.distanceTo(g?.position ?? camera.position);
    if (!wreck && d < 110) {
      engine.current ??= tankEngine();
      const speed = mine ? drive.speed : v.moving ? 5 : 0;
      engine.current.update({ x: a.x, y: a.y + 1, z: a.z }, speed, mine);
    } else if (engine.current) {
      engine.current.stop();
      engine.current = null;
    }
  });

  return (
    <group ref={root}>
      <TankModel turret={turret} gun={gun} recoil={recoil} color={color} wreck={wreck} />
      {/* Xác xe: khói đen đặc bốc cao, lửa liếm trên thân. */}
      <WreckFire wreck={wreck} top={2.2} />
    </group>
  );
}

// ---------------------------------------------------------------------------- lái xe của mình

/** Tư thế xe mình đang lái (máy mình tự tính). */
const drive = { pose: { x: 0, y: 0, z: 0, rotY: 0 } as TankPose, turret: 0, pitch: 0, speed: 0, readyAt: 0, sendAt: 0, lastSent: "", fireHeld: false, zoom: false, ready: true };

function TankDriver({ room }: { room: IslandRoom }) {
  const { world: physics, rapier } = useRapier();
  const tmp = useMemo(() => ({ target: new Vector3(), pos: new Vector3(), dir: new Vector3(), aim: new Vector3() }), []);

  // Dev: xem trạng thái xe mình đang lái (window.__tentides.drive).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __tentides?: Record<string, unknown> };
    w.__tentides ??= {};
    Object.assign(w.__tentides, { drive, tankHud, seat, keys });
  }, []);

  // Chuột trái bắn, chuột phải kính ngắm pháo thủ (giữ).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!seat.id || !document.pointerLockElement || menuOpen()) return;
      if (e.button === 0) drive.fireHeld = true;
      if (e.button === 2) drive.zoom = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) drive.fireHeld = false;
      if (e.button === 2) drive.zoom = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || !seat.id) return;
      // Chuột phải bật tắt kính ngắm nếu cài đặt "bấm để ngắm".
      if (e.code === "KeyQ") drive.zoom = !drive.zoom;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const me = room.state.players.get(myId(room));
    const vid = me?.alive && me.vehicle ? me.vehicle : "";
    const v = vid ? room.state.vehicles.get(vid) : undefined;
    const driving = !!v && v.hp > 0 && v.kind === "tank" && v.driver === myId(room);
    if (!driving) {
      if (seatOwner.kind === "tank") {
        // Vừa xuống xe (hay xe nổ): trả camera, FOV về cho nhân vật.
        seatOwner.kind = "";
        seat.id = "";
        tankHud.active = false;
        aimZoom.value = 1;
      }
      // Đứng cạnh xe lên được thì báo HUD (cùng luật với server: xe tăng trống hay máy cùng đội lái; xe trinh sát,
      // thuyền còn ghế trống và không có người phe khác).
      let near = "";
      if (me?.alive && !me.vehicle && room.state.phase !== "lobby") {
        let best = Infinity;
        const mode = room.state.battleMode;
        for (const [id, t] of room.state.vehicles) {
          if (t.hp <= 0) continue;
          const d = Math.hypot(t.x - localPosition.x, t.z - localPosition.z);
          const spec = vehicleSpec(t.kind);
          if (d > best || d > spec.enter || Math.abs(t.y - localPosition.y) > 4) continue;
          let free = 0;
          if (t.kind === "tank") {
            const driver = t.driver ? room.state.players.get(t.driver) : undefined;
            if (driver && !(driver.bot && me.team && driver.team === me.team)) continue;
            if (!driver && t.team && me.team && t.team !== me.team && mode !== "solo") continue;
          } else {
            free = -1;
            let crew = 0;
            let foe = false;
            for (let k = 0; k < spec.seats; k++) {
              const q = k === 0 ? t.driver : t.seats.get(String(k));
              if (!q) {
                if (free < 0) free = k;
                continue;
              }
              crew++;
              if (room.state.players.get(q)?.team !== me.team) foe = true;
            }
            if (free < 0) continue;
            if (crew && (mode === "solo" || !me.team || foe)) continue;
            if (!crew && t.team && me.team && t.team !== me.team && mode !== "solo") continue;
          }
          best = d;
          near = id;
          nearInfo.kind = t.kind;
          nearInfo.seat = String(free);
        }
      }
      if (getBattleHud().nearTank !== near) setBattleHud({ nearTank: near });
      return;
    }
    if (seat.id !== vid) {
      // Vừa lên xe: lấy tư thế từ server, nhìn theo hướng tháp pháo.
      seat.id = vid;
      seatOwner.kind = "tank";
      drive.pose = { x: v.x, y: v.y, z: v.z, rotY: v.rotY };
      drive.turret = v.turret;
      drive.pitch = v.pitch;
      drive.speed = 0;
      drive.readyAt = performance.now() + 1500;
      drive.ready = false;
      look.yaw = v.turret + Math.PI;
      look.pitch = 0.25;
      if (getBattleHud().nearTank) setBattleHud({ nearTank: "" });
    }
    const map = mapForMode(room.state.battleMode, room.state.worldSeed);
    const typing = menuOpen();
    const throttle = typing ? 0 : (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const steer = typing ? 0 : (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    // Đứt xích: không tiến lùi được, chỉ quay tại chỗ.
    const step = vehicleStep("tank", map, drive.pose, throttle, steer, drive.speed, dt, v.tracks <= 0);
    // Không chạy xuyên qua xe khác.
    let blocked = false;
    for (const [oid, o] of room.state.vehicles) {
      if (oid === vid) continue;
      if (Math.hypot(o.x - step.pose.x, o.z - step.pose.z) < 6 && Math.hypot(o.x - step.pose.x, o.z - step.pose.z) < Math.hypot(o.x - drive.pose.x, o.z - drive.pose.z)) blocked = true;
    }
    if (blocked) drive.speed = 0;
    else {
      drive.pose = step.pose;
      drive.speed = step.speed;
    }

    // Camera sau lưng xe (hay kính ngắm pháo thủ trên tháp pháo), xoay theo chuột.
    smoothView(dt);
    const cam = state.camera as PerspectiveCamera;
    const zoom = drive.zoom;
    const { target, pos, dir, aim } = tmp;
    const p = drive.pose;
    if (zoom) {
      pos.set(p.x, p.y + TANK.gunY + 0.55, p.z);
      dir.set(-Math.sin(view.yaw) * Math.cos(view.pitch), -Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch));
      cam.position.copy(pos);
      target.copy(pos).add(dir);
      cam.lookAt(target);
    } else {
      target.set(p.x, p.y + CAM_HEIGHT, p.z);
      const horizontal = Math.cos(view.pitch) * CAM_DIST;
      pos.set(target.x + Math.sin(view.yaw) * horizontal, target.y + Math.sin(view.pitch) * CAM_DIST, target.z + Math.cos(view.yaw) * horizontal);
      const ground = map.world.heightAt(pos.x, pos.z) + 0.6;
      if (pos.y < ground) pos.y = ground;
      cam.position.copy(pos);
      cam.lookAt(target);
    }
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.35;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      shake.amount *= Math.exp(-dt * 7);
    }
    const baseFov = getSettings().fov;
    const wantFov = zoom ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / 4) * 180) / Math.PI : baseFov;
    aimZoom.value = zoom ? 4 : 1;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }

    // Điểm ngắm: tia từ camera qua giữa màn hình (bỏ qua chính xe mình); tháp pháo quay dần về đó, nòng ngẩng theo
    // đường đạn cong để rơi đúng điểm ngắm.
    cam.getWorldDirection(dir);
    const own = tankBodies.get(vid);
    const hit = physics.castRay(new rapier.Ray(cam.position, dir), 600, true, undefined, undefined, undefined, own);
    let dist = hit ? hit.timeOfImpact : 400;
    if (!hit) {
      // Trời: nhắm xa theo hướng nhìn.
      dist = 400;
    }
    aim.copy(cam.position).addScaledVector(dir, dist);
    const wantTurret = Math.atan2(aim.x - p.x, aim.z - p.z);
    const diff = Math.atan2(Math.sin(wantTurret - drive.turret), Math.cos(wantTurret - drive.turret));
    const turn = TANK.turret * dt;
    drive.turret += Math.max(-turn, Math.min(turn, diff));
    const flat = Math.hypot(aim.x - p.x, aim.z - p.z);
    const wantPitch = cannonPitch(flat - TANK.barrel, aim.y - (p.y + TANK.gunY));
    drive.pitch += Math.max(-0.5 * dt, Math.min(0.5 * dt, wantPitch - drive.pitch));

    // Nòng đang chĩa tới đâu (vòng tròn trên HUD): điểm cách đầu nòng đúng khoảng ngắm theo hướng nòng.
    const m = cannonMuzzle(p, drive.turret, drive.pitch);
    const reach = Math.max(10, flat);
    tmp.aim.set(m.o[0] + m.d[0] * reach, m.o[1] + m.d[1] * reach - (9.81 * (reach / TANK.velocity) ** 2) / 2, m.o[2] + m.d[2] * reach).project(cam);
    tankHud.aimOn = tmp.aim.z < 1;
    tankHud.aimX = (tmp.aim.x + 1) / 2;
    tankHud.aimY = (1 - tmp.aim.y) / 2;

    // Bắn.
    const now = performance.now();
    tankHud.reload = Math.min(1, 1 - (drive.readyAt - now) / (TANK.reload * 1000));
    if (!drive.ready && now >= drive.readyAt) {
      drive.ready = true;
      playCannonReady();
    }
    if (drive.fireHeld && now >= drive.readyAt && room.state.phase !== "lobby") {
      drive.fireHeld = false;
      drive.readyAt = now + TANK.reload * 1000;
      drive.ready = false;
      room.send(Messages.tankFire, { turret: drive.turret, pitch: drive.pitch });
      playCannon({ x: m.o[0], y: m.o[1], z: m.o[2] }, true);
      shake.amount = Math.min(0.8, shake.amount + 0.45);
      look.pitch -= 0.02;
    }

    seat.x = p.x;
    seat.y = p.y;
    seat.z = p.z;
    tankHud.active = true;
    tankHud.hp = v.hp;
    tankHud.tracks = v.tracks;
    tankHud.speed = drive.speed;
    tankHud.zoom = zoom;

    drive.sendAt += dt;
    if (drive.sendAt >= SEND_INTERVAL) {
      drive.sendAt = 0;
      const msg: VehicleMoveMessage = { x: p.x, y: p.y, z: p.z, rotY: p.rotY, turret: drive.turret, pitch: drive.pitch, moving: Math.abs(drive.speed) > 0.3 };
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.rotY.toFixed(3)},${drive.turret.toFixed(3)},${drive.pitch.toFixed(3)},${msg.moving}`;
      if (key !== drive.lastSent) {
        drive.lastSent = key;
        room.send(Messages.vehicleMove, msg);
      }
    }
  });
  return null;
}

// Server sửa vị trí xe mình (đi quá nhanh, kẹt): nhận lại tư thế server giữ.
function useTankCorrections(room: IslandRoom) {
  useEffect(
    () =>
      room.onMessage(Messages.correct, (at: { x: number; y: number; z: number }) => {
        if (!seat.id || seatOwner.kind !== "tank") return;
        drive.pose ={ ...drive.pose, x: at.x, y: at.y, z: at.z };
        drive.speed = 0;
      }),
    [room],
  );
}

/** Mọi xe tăng trên bản đồ, và phần lái xe của mình. Đặt trong <Physics>. */
export function Vehicles({ room }: { room: IslandRoom }) {
  const [list, setList] = useState<[string, VehicleState][]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () => setList([...(room.state.vehicles as unknown as Map<string, VehicleState>).entries()]);
    const a = callbacks.onAdd("vehicles", refresh);
    const r = callbacks.onRemove("vehicles", refresh);
    refresh();
    return () => {
      a();
      r();
      seat.id = "";
      seatOwner.kind = "";
      tankHud.active = false;
    };
  }, [room]);
  useTankCorrections(room);
  useVehicleFx(room);
  return (
    <>
      {list.map(([id, v]) => (v.kind === "tank" ? <Tank key={id} room={room} id={id} v={v} /> : <Carrier key={id} room={room} id={id} v={v} teamColor={teamColor} />))}
      <TankDriver room={room} />
      <CarrierSeat room={room} />
    </>
  );
}
