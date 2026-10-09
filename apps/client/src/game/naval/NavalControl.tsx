import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, Group, MeshBasicMaterial, PlaneGeometry, RingGeometry, Vector3, type PerspectiveCamera } from "three";
import {
  FIRE,
  JET,
  NAVAL_HALF,
  NAVAL_WEAPONS,
  ballisticAt,
  firePointOf,
  jetStep,
  mountCovers,
  navalMissileStep,
  shellElevation,
  shellTime,
  shipClass,
  shipToWorld,
  torpedoStep,
  worldToShip,
  type NavalWeaponId,
  type ShipClass,
  type UnitPose,
} from "@tentides/content";
import { Messages, type NavalUnitState, type ShipState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, keys, look, smoothView, view } from "../input.ts";
import { localPosition, shake } from "../shared.ts";
import { aimZoom, getSettings } from "../settings.ts";
import { menuOpen, seat } from "../battle/runtime.ts";
import { seatOwner } from "../battle/vehicleParts.tsx";
import { puffs } from "../battle/gpuParticles.ts";
import { myUnit, navalLocal, shipPose } from "./navalRuntime.ts";

// Điều khiển hải chiến: F vào / rời vị trí trên tàu, giữ F dập lửa, F leo lên tàu khi đang bơi; khi đứng vị trí thì
// camera, chuột, phím theo vai: lái tàu (W/S tay chuông, A/D bánh lái, C lặn), pháo thủ (ngắm điểm trên mặt biển,
// máy tính góc nâng), phòng không (ngắm theo hướng nhìn, giữ chuột bắn), tên lửa / ngư lôi dẫn đường (nhìn từ đầu
// đạn, rê chuột lái), phi công (bay theo chuột, W/S ga, chuột trái súng, chuột phải bom, F bỏ máy bay).

/** Nấc tay chuông máy (lùi hết … tiến hết). */
const TELEGRAPH = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1] as const;
const UNIT_HZ = 15;
const AIM_HZ = 8;

const _v = new Vector3();
const _d = new Vector3();
const _t = new Vector3();

function seatOf(vehicle: string): { ship: string; station: number } | null {
  if (!vehicle.startsWith("ship:")) return null;
  const [, ship, st] = vehicle.split(":");
  return ship ? { ship, station: Number(st) || 0 } : null;
}

/** Hướng nhìn camera (đơn vị) theo `view`: yaw thế giới = view.yaw + π, ngẩng = −view.pitch. */
function viewDir(out: Vector3): Vector3 {
  const cp = Math.cos(view.pitch);
  return out.set(-Math.sin(view.yaw) * cp, -Math.sin(view.pitch), -Math.cos(view.yaw) * cp);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ụ còn tốt, đã nạp xong của tàu cho vũ khí này; và bao nhiêu ụ quay tới được hướng `yaw`. */
export function mountsReady(
  s: ShipState,
  cls: ShipClass,
  weapon: NavalWeaponId,
  yaw?: number,
): { total: number; alive: number; ready: number; cover: number; next: number } {
  const pose = shipPose(s.team) ?? { x: s.x, y: s.y, z: s.z, rotY: s.rotY };
  let total = 0;
  let alive = 0;
  let ready = 0;
  let cover = 0;
  let next = Infinity;
  for (const p of cls.parts) {
    if (p.mount?.weapon !== weapon) continue;
    total++;
    if ((s.parts.get(p.id) ?? 100) <= 0) continue;
    alive++;
    const cool = s.cool.get(p.id) ?? 0;
    next = Math.min(next, cool);
    if (cool > 0) continue;
    ready++;
    if (yaw === undefined || mountCovers(pose, p.mount, yaw, weapon === "gtorpedo" ? Math.PI : 0)) cover++;
  }
  return { total, alive, ready, cover, next: Number.isFinite(next) ? next : 0 };
}

export function NavalControl({ room }: { room: IslandRoom }) {
  const ring = useRef<Group>(null);
  const line = useRef<Group>(null);
  const ctl = useRef({
    fireHeld: false,
    fireClick: false,
    altHeld: false,
    altClick: false,
    fHeld: false,
    douseAt: 0,
    helmAt: 0,
    lastHelm: "",
    aimAt: 0,
    lastAim: "",
    unitAt: 0,
    gunAt: 0,
    aaAt: 0,
    station: -1,
    fov: 0,
  });
  const ringGeo = useMemo(() => new RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), []);
  const ringMat = useMemo(
    () => new MeshBasicMaterial({ color: "#ff7a45", transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide, toneMapped: false }),
    [],
  );
  const lineGeo = useMemo(() => new PlaneGeometry(1.2, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2), []);
  const lineMat = useMemo(
    () => new MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide, toneMapped: false }),
    [],
  );

  // Phím, chuột.
  useEffect(() => {
    const me = () => room.state.players.get(myId(room));
    const mine = () => {
      const p = me();
      const st = p?.alive ? seatOf(p.vehicle) : null;
      const ship = st ? room.state.naval.ships.get(st.ship) : undefined;
      return st && ship ? { st, ship, cls: shipClass(ship.cls) } : null;
    };
    const sendHelm = (dive?: boolean) => {
      const msg: { throttle: number; rudder: number; dive?: boolean } = { throttle: navalLocal.throttle, rudder: navalLocal.rudder };
      if (dive !== undefined) msg.dive = dive;
      room.send(Messages.navalHelm, msg);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || room.state.battleMode !== "naval" || room.state.mode !== "battle" || menuOpen()) return;
      if (e.code === "KeyF") {
        if (e.repeat) return;
        ctl.current.fHeld = true;
        const p = me();
        if (!p?.alive || room.state.phase !== "battle") return;
        const m = mine();
        if (m) {
          // Đang lái máy bay: F bỏ máy bay (về tàu); không thì rời vị trí.
          if (myUnit.id && room.state.naval.units.get(myUnit.id)?.kind === "plane") room.send(Messages.navalAct, { act: "eject" });
          else room.send(Messages.navalStation, { station: -1 });
          return;
        }
        if (navalLocal.near.kind === "station") room.send(Messages.navalStation, { station: navalLocal.near.station });
        else if (navalLocal.near.kind === "board") room.send(Messages.navalAct, { act: "board" });
        return;
      }
      const m = mine();
      if (!m || e.repeat) return;
      const role = m.cls.roles[m.st.station]!;
      if (!role.helm || myUnit.id) return;
      if (e.code === "KeyW" || e.code === "KeyS") {
        const i = TELEGRAPH.findIndex((t) => t >= navalLocal.throttle - 1e-3);
        const k = Math.max(0, Math.min(TELEGRAPH.length - 1, (i < 0 ? TELEGRAPH.length - 1 : i) + (e.code === "KeyW" ? 1 : -1)));
        navalLocal.throttle = TELEGRAPH[k]!;
        sendHelm();
      } else if (e.code === "KeyX") {
        navalLocal.throttle = 0;
        sendHelm();
      } else if (e.code === "KeyC" && m.cls.id === "submarine") sendHelm(!m.ship.dive);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyF") ctl.current.fHeld = false;
    };
    const onDown = (e: MouseEvent) => {
      if (!document.pointerLockElement || menuOpen() || navalLocal.station < 0) return;
      if (e.button === 0) {
        ctl.current.fireHeld = true;
        ctl.current.fireClick = true;
      }
      if (e.button === 2) {
        ctl.current.altHeld = true;
        ctl.current.altClick = true;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) ctl.current.fireHeld = false;
      if (e.button === 2) ctl.current.altHeld = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [room]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const c = ctl.current;
    const cam = state.camera as PerspectiveCamera;
    const mid = myId(room);
    const me = room.state.players.get(mid);
    if (ring.current) ring.current.visible = false;
    if (line.current) line.current.visible = false;
    navalLocal.leads.length = 0;
    navalLocal.enemy.on = false;
    if (room.state.battleMode !== "naval" || !me) return;
    const own = room.state.naval.ships.get(me.team);
    const enemyShip = [...room.state.naval.ships.values()].find((s) => s.team !== me.team);
    const now = performance.now() / 1000;
    const battle = room.state.phase === "battle";

    const st = me.alive ? seatOf(me.vehicle) : null;
    const ship = st ? room.state.naval.ships.get(st.ship) : undefined;
    const pose = st ? shipPose(st.ship) : undefined;
    if (!st || !ship || !pose) {
      // Đi bộ trên boong (hay bơi): dòng nhắc, dập lửa.
      if (seatOwner.kind === "naval") {
        seatOwner.kind = "";
        seat.id = "";
        aimZoom.value = 1;
        cam.fov = getSettings().fov;
        cam.updateProjectionMatrix();
        c.station = -1;
      }
      navalLocal.station = -1;
      myUnit.id = "";
      navalLocal.near = { kind: "", station: -1, label: "" };
      if (me.alive && own && !own.sunk) onFoot(room, own, c, now);
      markEnemy(cam, me.team, enemyShip, own);
      return;
    }

    // ------------------------------------------------------------------ đang đứng vị trí
    const cls = shipClass(ship.cls);
    const role = cls.roles[st.station]!;
    seatOwner.kind = "naval";
    seat.id = me.vehicle;
    const [sx, sy, sz] = shipToWorld(pose, role.station[0], role.station[1], role.station[2]);
    seat.x = sx;
    seat.y = sy;
    seat.z = sz;
    if (c.station !== st.station) {
      // Vừa vào vị trí: nhìn theo hướng mặc định của vị trí, lệnh máy theo tàu đang chạy.
      c.station = st.station;
      look.yaw = pose.rotY + role.face + Math.PI;
      look.pitch = role.role === "aa" ? -0.25 : 0.06;
      navalLocal.throttle = ship.throttle;
      navalLocal.rudder = 0;
      c.lastHelm = "";
    }
    navalLocal.station = st.station;
    navalLocal.near = { kind: "", station: -1, label: "" };
    smoothView(dt);
    const typing = menuOpen();

    // Đơn vị mình đang lái.
    let unit: NavalUnitState | undefined;
    let uid = "";
    room.state.naval.units.forEach((u, id) => {
      if (!unit && u.owner === mid && (u.kind === "missile" || u.kind === "gtorpedo" || u.kind === "plane")) {
        unit = u;
        uid = id;
      }
    });
    if (!unit) myUnit.id = "";
    else if (myUnit.id !== uid) {
      myUnit.id = uid;
      Object.assign(myUnit, { x: unit.x, y: unit.y, z: unit.z, yaw: unit.yaw, pitch: unit.pitch, roll: unit.roll, speed: unit.speed });
      look.yaw = unit.yaw + Math.PI;
      look.pitch = unit.kind === "missile" ? -0.1 : 0;
      smoothView(0, true);
    }

    viewDir(_d);
    const aimYaw = view.yaw + Math.PI;
    const aimPitch = -view.pitch;
    let zoom = 1;

    if (unit) {
      // ---------------------------------------------------------------- lái đơn vị (nhìn từ đầu đạn / sau máy bay)
      const kind = unit.kind;
      const cur: UnitPose = { ...myUnit };
      const wantPitch = Math.max(-1.1, Math.min(1, aimPitch));
      const throttle = typing ? 0 : (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      // Ra sát mép bản đồ: tự quay đầu về giữa biển.
      const edge = Math.max(Math.abs(myUnit.x), Math.abs(myUnit.z)) > NAVAL_HALF - 60;
      const wantYaw = edge ? Math.atan2(-myUnit.x, -myUnit.z) : aimYaw;
      const next =
        kind === "missile"
          ? navalMissileStep(cur, wantYaw, wantPitch, dt)
          : kind === "gtorpedo"
            ? torpedoStep(cur, wantYaw, true, dt)
            : jetStep(cur, wantYaw, wantPitch, throttle, dt);
      Object.assign(myUnit, next);
      c.unitAt += dt;
      if (c.unitAt >= 1 / UNIT_HZ) {
        c.unitAt = 0;
        room.send(Messages.navalUnit, {
          id: uid,
          x: myUnit.x,
          y: myUnit.y,
          z: myUnit.z,
          yaw: myUnit.yaw,
          pitch: Math.max(-1.6, Math.min(1.6, myUnit.pitch)),
          roll: Math.max(-3.2, Math.min(3.2, myUnit.roll)),
          speed: Math.max(0, Math.min(400, myUnit.speed)),
        });
      }
      const back = kind === "plane" ? 20 : kind === "missile" ? 8 : 16;
      const up = kind === "plane" ? 4.5 : kind === "missile" ? 2.6 : 7;
      cam.position.set(myUnit.x - _d.x * back, myUnit.y - _d.y * back + up, myUnit.z - _d.z * back);
      if (kind === "gtorpedo") cam.position.y = Math.max(3, cam.position.y);
      else cam.position.y = Math.max(0.8, cam.position.y);
      cam.lookAt(_t.set(myUnit.x + _d.x * 60, myUnit.y + _d.y * 60 + (kind === "gtorpedo" ? 0 : up * 0.5), myUnit.z + _d.z * 60));
      if (kind === "plane") {
        cam.rotateZ(-myUnit.roll * 0.25);
        // Súng, bom.
        if (c.fireHeld && battle && now - c.gunAt > 0.075) {
          c.gunAt = now;
          room.send(Messages.navalFire, { weapon: "jetGun", yaw: myUnit.yaw, pitch: Math.max(-1.6, Math.min(1.6, myUnit.pitch)) });
          shake.amount = Math.min(0.25, shake.amount + 0.03);
        }
        if (c.altClick && battle) room.send(Messages.navalAct, { act: "bomb" });
        // Điểm bom rơi dự đoán.
        const cp = Math.cos(myUnit.pitch);
        const v = [Math.sin(myUnit.yaw) * cp * myUnit.speed, Math.sin(myUnit.pitch) * myUnit.speed, Math.cos(myUnit.yaw) * cp * myUnit.speed] as const;
        const o = [myUnit.x, myUnit.y - 1.6, myUnit.z] as const;
        const disc = v[1] * v[1] + 2 * 9.81 * o[1];
        const tHit = (v[1] + Math.sqrt(Math.max(0, disc))) / 9.81;
        const p = ballisticAt(o, v, tHit);
        showRing(ring.current, p[0], p[2], NAVAL_WEAPONS.bomb.splash);
        navalLocal.bombT = tHit;
      }
    } else {
      // ---------------------------------------------------------------- ở vị trí trên tàu
      const target = role.role === "aa" ? null : _t.set(pose.x, pose.y + cls.deck + 6, pose.z);
      if (role.role === "aa") {
        // Sau vai pháo thủ phòng không, nhìn theo hướng ngắm.
        cam.position.set(sx - _d.x * 3, sy + 2.3 - _d.y * 3, sz - _d.z * 3);
        cam.lookAt(_v.set(cam.position.x + _d.x, cam.position.y + _d.y, cam.position.z + _d.z));
        zoom = c.altHeld ? 2.5 : 1;
      } else if (cls.id === "submarine" && role.helm && c.altHeld) {
        // Kính tiềm vọng: mắt ở đỉnh kính, phóng to.
        const [px, py, pz] = shipToWorld(pose, 0, cls.deck + 8.6, 9.5);
        cam.position.set(px, Math.max(py, 1.2), pz);
        cam.lookAt(_v.set(px + _d.x, Math.max(py, 1.2) + _d.y, pz + _d.z));
        zoom = 4;
      } else {
        // Camera sau và trên tàu, nhìn theo hướng chuột (ngắm xa qua đầu tàu).
        const dist = cls.length * (role.role === "gunner" ? 0.7 : 0.6) + 20;
        const h = cls.deck + (role.role === "gunner" ? 34 : 22);
        const bx = Math.sin(view.yaw);
        const bz = Math.cos(view.yaw);
        cam.position.set(target!.x + bx * dist, Math.max(4, pose.y + h + Math.sin(view.pitch) * 12), target!.z + bz * dist);
        cam.lookAt(_v.set(cam.position.x + _d.x, cam.position.y + _d.y, cam.position.z + _d.z));
        zoom = c.altHeld && (role.role === "gunner" || (role.helm && cls.id !== "destroyer" && cls.id !== "cruiser")) ? 3 : 1;
      }
      cam.getWorldDirection(_d);

      if (role.weapons.includes("bbGun") || role.weapons.includes("ddGun")) {
        // Pháo thủ: điểm ngắm là chỗ tia nhìn chạm mặt biển (xa nhất tầm pháo).
        const weapon: NavalWeaponId = role.weapons.includes("bbGun") ? "bbGun" : "ddGun";
        const w = NAVAL_WEAPONS[weapon];
        let t = _d.y < -1e-3 ? -cam.position.y / _d.y : Infinity;
        const flat = Math.hypot(_d.x, _d.z) || 1;
        const cx = cam.position.x;
        const cz = cam.position.z;
        let ax = cx + _d.x * t;
        let az = cz + _d.z * t;
        const range = Math.hypot(ax - pose.x, az - pose.z);
        if (!Number.isFinite(t) || range > w.range) {
          // Nhìn quá tầm (hay lên trời): đặt điểm ngắm ở tầm xa nhất theo hướng nhìn.
          t = w.range;
          ax = pose.x + (_d.x / flat) * w.range;
          az = pose.z + (_d.z / flat) * w.range;
        }
        navalLocal.aimX = ax;
        navalLocal.aimZ = az;
        navalLocal.aimRange = Math.hypot(ax - pose.x, az - pose.z);
        const yawToAim = Math.atan2(ax - pose.x, az - pose.z);
        const elev = shellElevation(w.speed, navalLocal.aimRange, -(pose.y + cls.deck + 2));
        navalLocal.flight = Number.isFinite(elev) ? shellTime(w.speed, elev, navalLocal.aimRange) : 0;
        navalLocal.aimYaw = yawToAim;
        showRing(ring.current, ax, az, w.splash * 1.4);
        c.aimAt += dt;
        if (c.aimAt >= 1 / AIM_HZ) {
          c.aimAt = 0;
          const key = `${ax.toFixed(0)},${az.toFixed(0)}`;
          if (key !== c.lastAim) {
            c.lastAim = key;
            room.send(Messages.navalAim, { yaw: yawToAim, pitch: 0, x: ax, z: az });
          }
        }
        if (c.fireClick && battle) room.send(Messages.navalFire, { weapon, yaw: yawToAim, pitch: 0, x: ax, z: az });
      } else if (role.weapons.includes("aa")) {
        // Phòng không: ngắm theo hướng nhìn, giữ chuột trái bắn liên tục; dấu ngắm đón đầu máy bay, tên lửa địch.
        c.aimAt += dt;
        if (c.aimAt >= 1 / AIM_HZ) {
          c.aimAt = 0;
          room.send(Messages.navalAim, { yaw: aimYaw, pitch: Math.max(-1.6, Math.min(1.6, aimPitch)) });
        }
        if (c.fireHeld && battle && now - c.aaAt >= NAVAL_WEAPONS.aa.reload) {
          c.aaAt = now;
          room.send(Messages.navalFire, { weapon: "aa", yaw: aimYaw, pitch: Math.max(-1.6, Math.min(1.6, aimPitch)) });
          shake.amount = Math.min(0.2, shake.amount + 0.015);
        }
        leads(room, cam, me.team, sx, sy, sz);
      } else {
        // Lái tàu, phóng ngư lôi / tên lửa / máy bay.
        if (role.helm && !typing) {
          const rudder = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
          navalLocal.rudder = rudder;
          c.helmAt += dt;
          const key = `${navalLocal.throttle},${rudder}`;
          if (key !== c.lastHelm || c.helmAt > 1) {
            c.lastHelm = key;
            c.helmAt = 0;
            room.send(Messages.navalHelm, { throttle: navalLocal.throttle, rudder });
          }
        }
        if (role.weapons.includes("torpedo")) {
          const r = mountsReady(ship, cls, "torpedo", aimYaw);
          showLine(line.current, pose.x, pose.z, aimYaw, r.cover > 0);
          if (c.fireClick && battle) room.send(Messages.navalFire, { weapon: "torpedo", yaw: aimYaw, pitch: 0 });
        }
        if (role.weapons.includes("gtorpedo") && c.fireClick && battle) room.send(Messages.navalFire, { weapon: "gtorpedo", yaw: aimYaw, pitch: 0 });
        if (role.weapons.includes("missile") && c.fireClick && battle) room.send(Messages.navalFire, { weapon: "missile", yaw: aimYaw, pitch: 0 });
        if (role.role === "pilot" && c.fireClick && battle) room.send(Messages.navalFire, { weapon: "jet", yaw: aimYaw, pitch: 0 });
        if (c.altClick && battle) {
          if (role.weapons.includes("depth")) room.send(Messages.navalFire, { weapon: "depth", yaw: 0, pitch: 0 });
          if (role.weapons.includes("decoy")) room.send(Messages.navalFire, { weapon: "decoy", yaw: 0, pitch: 0 });
        }
      }
    }
    c.fireClick = false;
    c.altClick = false;
    markEnemy(cam, me.team, enemyShip, own);

    // Ống nhòm / kính tiềm vọng: thu hẹp góc nhìn.
    const baseFov = getSettings().fov;
    const wantFov = zoom > 1 ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI : baseFov;
    aimZoom.value = zoom;
    navalLocal.zoom = zoom > 1;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 12);
      cam.updateProjectionMatrix();
    }
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.3;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      shake.amount *= Math.exp(-dt * 7);
    }
  });

  return (
    <>
      <group ref={ring} visible={false}>
        <mesh geometry={ringGeo} material={ringMat} />
      </group>
      <group ref={line} visible={false}>
        <mesh geometry={lineGeo} material={lineMat} scale={[1, 1, 260]} />
      </group>
    </>
  );
}

function showRing(g: Group | null, x: number, z: number, r: number) {
  if (!g) return;
  g.visible = true;
  g.position.set(x, 0.4, z);
  g.scale.setScalar(r);
}

function showLine(g: Group | null, x: number, z: number, yaw: number, ok: boolean) {
  if (!g) return;
  g.visible = true;
  g.position.set(x + Math.sin(yaw) * 10, 0.35, z + Math.cos(yaw) * 10);
  g.rotation.set(0, yaw + Math.PI, 0);
  const m = (g.children[0] as unknown as { material: MeshBasicMaterial }).material;
  m.color.set(ok ? "#ffd166" : "#ff5a4a");
}

/** Đi bộ trên boong / bơi: vị trí điều khiển gần, đám cháy gần (giữ F dập), mạn tàu gần (F leo lên). */
function onFoot(room: IslandRoom, own: ShipState, c: { fHeld: boolean; douseAt: number }, now: number) {
  const pose = shipPose(own.team);
  if (!pose) return;
  const cls = shipClass(own.cls);
  const [lx, ly, lz] = worldToShip(pose, localPosition.x, localPosition.y, localPosition.z);
  // Đám cháy gần nhất.
  let fire = "";
  let best: number = FIRE.reach;
  for (const pid of own.fires.keys()) {
    const [fx, fy, fz] = firePointOf(cls, pid);
    const d = Math.hypot(lx - fx, (ly - fy) * 0.6, lz - fz);
    if (d < best) {
      best = d;
      fire = pid;
    }
  }
  if (fire) {
    const part = cls.parts.find((p) => p.id === fire);
    navalLocal.near = { kind: "fire", station: -1, label: `Giữ F: dập lửa (${part?.name ?? fire})` };
    if (c.fHeld && room.state.phase === "battle") {
      if (now - c.douseAt > 0.2) {
        c.douseAt = now;
        room.send(Messages.navalAct, { act: "extinguish" });
      }
      // Vòi nước phun về đám cháy.
      const [fx, fy, fz] = shipToWorld(pose, ...firePointOf(cls, fire));
      const dx = fx - localPosition.x;
      const dz = fz - localPosition.z;
      for (let k = 0; k < 2; k++)
        puffs.push({
          x: localPosition.x,
          y: localPosition.y + 1.2,
          z: localPosition.z,
          vx: dx * 1.6 + (Math.random() - 0.5),
          vy: (fy - localPosition.y) * 1.2 + 1.5,
          vz: dz * 1.6 + (Math.random() - 0.5),
          size: 0.35,
          grow: 1.4,
          life: 0.7,
          age: 0,
          r: 0.85,
          g: 0.92,
          b: 1,
          alpha: 0.6,
          dense: false,
        });
    }
    navalLocal.dousing = c.fHeld;
    return;
  }
  navalLocal.dousing = false;
  // Bàn điều khiển gần nhất.
  let pick = -1;
  let pickD = 3.5;
  for (const [k, r] of cls.roles.entries()) {
    const d = Math.hypot(lx - r.station[0], lz - r.station[2]);
    if (d < pickD && Math.abs(ly - r.station[1]) <= 2.2) {
      pickD = d;
      pick = k;
    }
  }
  if (pick >= 0) {
    const r = cls.roles[pick]!;
    const who = own.crew.get(String(pick));
    const occ = who ? room.state.players.get(who) : undefined;
    if (occ && !occ.bot && occ.alive) navalLocal.near = { kind: "", station: -1, label: `${r.name}: ${occ.name} đang giữ` };
    else navalLocal.near = { kind: "station", station: pick, label: `F: vào vị trí ${r.name}${occ?.alive ? " (máy nhường chỗ)" : ""}` };
    return;
  }
  // Đang bơi cạnh tàu mình.
  if (localPosition.y < 1 && !own.dive && Math.abs(lx) < cls.beam / 2 + 10 && Math.abs(lz) < cls.length / 2 + 10) {
    navalLocal.near = { kind: "board", station: -1, label: "F: leo lưới lên tàu" };
    return;
  }
  navalLocal.near = { kind: "", station: -1, label: "" };
}

/** Dấu ngắm đón đầu (phòng không): chỗ máy bay, tên lửa địch sẽ tới khi đạn bay tới. */
function leads(room: IslandRoom, cam: PerspectiveCamera, team: string, sx: number, sy: number, sz: number) {
  const v = NAVAL_WEAPONS.aa.speed;
  room.state.naval.units.forEach((u) => {
    if (u.team === team || (u.kind !== "missile" && u.kind !== "plane")) return;
    const d = Math.hypot(u.x - sx, u.y - sy, u.z - sz);
    if (d > NAVAL_WEAPONS.aa.range * 1.2) return;
    const t = d / v;
    const cp = Math.cos(u.pitch);
    _v.set(u.x + Math.sin(u.yaw) * cp * u.speed * t, u.y + Math.sin(u.pitch) * u.speed * t, u.z + Math.cos(u.yaw) * cp * u.speed * t).project(cam);
    if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) return;
    navalLocal.leads.push({ x: (_v.x + 1) / 2, y: (1 - _v.y) / 2, kind: u.kind, d });
  });
}

/** Dấu tàu địch trên màn hình (tàu ngầm đang lặn ở xa thì không). */
function markEnemy(cam: PerspectiveCamera, team: string, enemy: ShipState | undefined, own: ShipState | undefined) {
  if (!enemy || enemy.sunk) return;
  const pose = shipPose(enemy.team);
  if (!pose) return;
  const from = own ? (shipPose(own.team) ?? own) : cam.position;
  const dist = Math.hypot(pose.x - from.x, pose.z - from.z);
  if (enemy.cls === "submarine" && enemy.y < -4 && dist > 260) return;
  _v.set(pose.x, pose.y + shipClass(enemy.cls).deck + 8, pose.z).project(cam);
  const on = _v.z < 1;
  navalLocal.enemy.on = true;
  navalLocal.enemy.front = on;
  navalLocal.enemy.x = on ? (_v.x + 1) / 2 : _v.x < 0 ? 1 : 0;
  navalLocal.enemy.y = on ? (1 - _v.y) / 2 : 0.5;
  navalLocal.enemy.dist = dist;
  void team;
}
