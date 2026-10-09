import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { BoxGeometry, Color, CylinderGeometry, Euler, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  clampMountYaw,
  firePointOf,
  shellElevation,
  shipClass,
  shipToWorld,
  NAVAL_WEAPONS,
  type ShipBox,
  type ShipClass,
  type ShipPart,
} from "@tentides/content";
import type { ShipState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { localPosition } from "../shared.ts";
import { embers, puffs } from "../battle/gpuParticles.ts";
import { shipPose, updateShips } from "./navalRuntime.ts";

// Vẽ hai chiến hạm: thân, boong, thượng tầng (gộp khối theo vật liệu cho ít lệnh vẽ), tháp pháo, ổ phòng không, ống
// phóng ngư lôi xoay theo hướng ngắm của người đứng vị trí; hộp va chạm động (Rapier) để đi lại trên boong; bộ phận
// hỏng thì cháy đen; đám cháy bốc lửa, khói; vệt sóng sau đuôi, sóng mũi; tàu chìm thì chúi mũi chìm dần. Tàu ngầm
// địch đang lặn ở xa thì không thấy (chỉ thấy khi tới gần hay lúc nó vừa phóng ngư lôi).

const TEAM = { blue: "#2f6bff", red: "#e0332b" } as Record<string, string>;
const MAT_COLOR: Record<ShipBox["mat"], string> = {
  hull: "#555b62",
  deck: "#8d8675",
  steel: "#a3a8ad",
  dark: "#3d4146",
  wood: "#7d6648",
  glass: "#2b4252",
  accent: "#d8d4c4",
  flight: "#4a4d51",
  rail: "#c9ccd0",
};
const STATION_MAT = new MeshBasicMaterial({
  color: new Color("#ffd27a").multiplyScalar(2.2),
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  toneMapped: false,
});
const BURNT = new MeshStandardMaterial({ color: "#1d1b1a", roughness: 1 });
const _q = new Quaternion();
const _e = new Euler();

interface MountView {
  part: ShipPart;
  group: Group;
  barrels: Group;
}

/** Hình khối gộp theo (vật liệu, bộ phận): mỗi nhóm một mesh. */
function buildHull(cls: ShipClass): { key: string; mat: ShipBox["mat"]; part: string; geometry: BufferGeometry }[] {
  const groups = new Map<string, BufferGeometry[]>();
  for (const b of cls.boxes) {
    const g = new BoxGeometry(b.w, b.h, b.d);
    if (b.pitch) g.rotateX(b.pitch);
    g.translate(b.x, b.y, b.z);
    const key = `${b.mat}|${b.part ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(g);
    groups.set(key, list);
  }
  return [...groups].map(([key, list]) => {
    const [mat, part] = key.split("|") as [ShipBox["mat"], string];
    return { key, mat, part, geometry: mergeGeometries(list)! };
  });
}

export function Ships({ room }: { room: IslandRoom }) {
  const list = useRoomSnapshot(room, (s) => [...(s.naval?.ships.entries() ?? [])].map(([id, sh]) => `${id}:${sh.cls}`).join(","));
  return (
    <>
      {list
        .split(",")
        .filter(Boolean)
        .map((k) => {
          const [id, cls] = k.split(":") as [string, string];
          return <ShipView key={k} room={room} id={id} cls={shipClass(cls)} />;
        })}
    </>
  );
}

function ShipView({ room, id, cls }: { room: IslandRoom; id: string; cls: ShipClass }) {
  const { world: physics, rapier } = useRapier();
  const root = useRef<Group>(null);
  const mounts = useRef<MountView[]>([]);
  const meshes = useRef(new Map<string, Mesh[]>());
  const anim = useRef({ shots: -1, aaShots: -1, kick: 0, emit: 0, partsKey: "" });
  const team = room.state.naval.ships.get(id)?.team ?? id;
  const accent = TEAM[team] ?? "#cccccc";
  const hull = useMemo(() => buildHull(cls), [cls]);
  const mats = useMemo(() => {
    const out = {} as Record<ShipBox["mat"], MeshStandardMaterial>;
    for (const k of Object.keys(MAT_COLOR) as ShipBox["mat"][]) {
      out[k] = new MeshStandardMaterial({
        color: k === "accent" ? accent : MAT_COLOR[k],
        roughness: k === "glass" ? 0.25 : 0.8,
        metalness: k === "steel" || k === "hull" || k === "dark" ? 0.35 : 0.05,
        emissive: k === "glass" ? new Color("#18303d") : new Color(0),
      });
    }
    return out;
  }, [accent]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const stripe = useMemo(() => new MeshStandardMaterial({ color: accent, roughness: 0.6 }), [accent]);

  // Hộp va chạm theo khối đặc (đi lại trên boong, lên dốc, nấp sau thượng tầng).
  useEffect(() => {
    const s = room.state.naval.ships.get(id);
    const body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(s?.x ?? 0, s?.y ?? 0, s?.z ?? 0));
    for (const b of cls.boxes) {
      if (!b.solid) continue;
      const desc = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.y, b.z);
      if (b.pitch) {
        _q.setFromEuler(_e.set(b.pitch, 0, 0));
        desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      }
      physics.createCollider(desc, body);
    }
    bodies.set(id, body);
    return () => {
      bodies.delete(id);
      if (physics.getRigidBody(body.handle)) physics.removeRigidBody(body);
    };
  }, [physics, rapier, cls, id, room]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = root.current;
    const s = room.state.naval.ships.get(id);
    if (!g || !s) return;
    updateShips(room, state.clock.elapsedTime);
    const pose = shipPose(id);
    if (!pose) return;
    // Tàu chìm: chúi mũi, nghiêng dần theo độ chìm.
    const sink = s.sunk ? Math.min(1, -s.y / (cls.deck + cls.draft)) : 0;
    g.position.set(pose.x, pose.y, pose.z);
    g.rotation.set(sink * 0.22, pose.rotY, sink * 0.12);
    const body = bodies.get(id);
    if (body) {
      body.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z });
      _q.setFromEuler(_e.set(0, pose.rotY, 0));
      body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
    // Tàu ngầm địch đang lặn ở xa: ẩn hẳn.
    const me = room.state.players.get(myId(room));
    const enemy = !!me?.team && me.team !== s.team;
    const dist = Math.hypot(pose.x - localPosition.x, pose.z - localPosition.z);
    g.visible = !(enemy && cls.id === "submarine" && s.y < -4 && dist > 260);

    // Hướng ngắm từng ụ.
    const a = anim.current;
    if (a.shots !== s.shots) {
      if (a.shots >= 0) a.kick = 1;
      a.shots = s.shots;
    }
    a.kick = Math.max(0, a.kick - dt * 2.5);
    for (const m of mounts.current) aimMount(m, s, pose, cls, a.kick);

    // Bộ phận hỏng: đen sạm (đổi vật liệu khi danh sách bộ phận hỏng thay đổi).
    const key = [...s.parts.entries()]
      .filter(([, v]) => v === 0)
      .map(([k]) => k)
      .join(",");
    if (key !== a.partsKey) {
      a.partsKey = key;
      const dead = new Set(key.split(","));
      for (const [part, list] of meshes.current)
        for (const mesh of list) mesh.material = dead.has(part) ? BURNT : mats[(mesh.userData.mat as ShipBox["mat"]) ?? "steel"];
      for (const m of mounts.current)
        m.group.traverse((o) =>
          (o as Mesh).isMesh ? ((o as Mesh).material = dead.has(m.part.id) ? BURNT : o.userData.mat === "accent" ? stripe : mats.dark) : null,
        );
    }

    // Lửa, khói, sóng.
    a.emit += dt;
    if (a.emit < 0.05) return;
    const step = a.emit;
    a.emit = 0;
    if (!g.visible) return;
    const near = dist < 900;
    if (near) emitFires(s, cls, pose, step);
    if (!s.sunk) emitWake(s, cls, pose, step, dist);
    else if (Math.random() < step * 6) {
      const [x, y, z] = shipToWorld(pose, (Math.random() - 0.5) * cls.beam, cls.deck, (Math.random() - 0.5) * cls.length);
      puffs.push({
        x,
        y: Math.max(0.5, y),
        z,
        vx: 0,
        vy: 2.5,
        vz: 0,
        size: 3,
        grow: 2.2,
        life: 6,
        age: 0,
        r: 0.12,
        g: 0.12,
        b: 0.12,
        alpha: 0.55,
        dense: false,
      });
    }
  }, -2);

  const parts = useMemo(() => cls.parts.filter((p) => p.mount), [cls]);
  return (
    <group ref={root}>
      {hull.map((h) => (
        <mesh
          key={h.key}
          geometry={h.geometry}
          material={mats[h.mat]}
          castShadow
          receiveShadow
          userData={{ mat: h.mat }}
          ref={(m) => {
            if (!m) return;
            const list = meshes.current.get(h.part) ?? [];
            if (!list.includes(m)) list.push(m);
            meshes.current.set(h.part, list);
          }}
        />
      ))}
      {/* Sọc màu phe dọc thân (gần mép nước) và lá cờ phe trên cột. */}
      <mesh position={[0, 0.6, 0]} material={stripe}>
        <boxGeometry args={[cls.id === "carrier" ? 18.2 : cls.beam + 0.15, 0.5, cls.length * 0.62]} />
      </mesh>
      <mesh position={[0, cls.deck + (cls.id === "submarine" ? 9 : 16), cls.id === "carrier" ? -6 : 3]} material={stripe}>
        <boxGeometry args={[0.05, 1.4, 2.4]} />
      </mesh>
      {/* Vòng sáng đánh dấu bàn điều khiển các vị trí (đứng vào rồi bấm F). */}
      {cls.roles.map((r, k) => (
        <mesh key={`st${k}`} position={[r.station[0], r.station[1] + 0.06, r.station[2]]} rotation-x={-Math.PI / 2} material={STATION_MAT}>
          <ringGeometry args={[0.75, 0.95, 28]} />
        </mesh>
      ))}
      {parts.map((p) => (
        <Mount
          key={p.id}
          part={p}
          stripe={stripe}
          dark={mats.dark}
          onMount={(m) => {
            mounts.current = [...mounts.current.filter((x) => x.part.id !== p.id), m];
          }}
        />
      ))}
    </group>
  );
}

/** Thân rắn của các tàu (khoá là phe), để camera, đạn ngắm biết. */
export const bodies = new Map<string, RapierBody>();
type RapierBody = ReturnType<ReturnType<typeof useRapier>["world"]["createRigidBody"]>;

/** Một ụ vũ khí: bệ xoay (yaw) và cụm nòng (pitch). */
function Mount({ part, stripe, dark, onMount }: { part: ShipPart; stripe: MeshStandardMaterial; dark: MeshStandardMaterial; onMount: (m: MountView) => void }) {
  const group = useRef<Group>(null);
  const barrels = useRef<Group>(null);
  const m = part.mount!;
  useEffect(() => {
    if (group.current && barrels.current) onMount({ part, group: group.current, barrels: barrels.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);
  const shape = useMemo(() => {
    switch (m.weapon) {
      case "bbGun":
        return { house: [7.2, 2.8, 8.4] as const, barrel: [0.38, 0.5] as const, len: m.barrel, spread: 1.6, y: 0.4 };
      case "ddGun":
        return { house: [3.6, 2, 4.2] as const, barrel: [0.16, 0.22] as const, len: m.barrel, spread: 0.7, y: 0.3 };
      case "aa":
        return { house: [1.6, 0.9, 1.4] as const, barrel: [0.06, 0.08] as const, len: m.barrel, spread: 0.35, y: 0.2 };
      case "torpedo":
      case "gtorpedo":
        return { house: [1.2, 0.5, 1.2] as const, barrel: [0.3, 0.32] as const, len: m.barrel, spread: 0.65, y: 0.1 };
      default:
        return null;
    }
  }, [m]);
  const barrelGeo = useMemo(
    () => (shape ? new CylinderGeometry(shape.barrel[0], shape.barrel[1], shape.len, 10).rotateX(Math.PI / 2).translate(0, 0, shape.len / 2) : null),
    [shape],
  );
  if (!shape || !barrelGeo)
    return (
      <group ref={group} position={[m.pivot[0], m.pivot[1], m.pivot[2]]}>
        <group ref={barrels} />
      </group>
    );
  const [w, h, d] = shape.house;
  return (
    <group ref={group} position={[m.pivot[0], m.pivot[1], m.pivot[2]]} rotation-y={m.rest}>
      <mesh position={[0, -h / 2 + shape.y, -d * 0.1]} material={dark} castShadow userData={{ mat: "dark" }}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {m.weapon === "bbGun" && (
        <mesh position={[0, shape.y + 0.05, -d * 0.1]} material={stripe} userData={{ mat: "accent" }}>
          <boxGeometry args={[w * 0.6, 0.1, d * 0.5]} />
        </mesh>
      )}
      <group ref={barrels} position={[0, shape.y - h * 0.15, d * 0.3]}>
        {Array.from({ length: m.barrels }, (_, k) => (
          <mesh
            key={k}
            geometry={barrelGeo}
            material={dark}
            position={[(k - (m.barrels - 1) / 2) * shape.spread, 0, 0]}
            castShadow
            userData={{ mat: "dark" }}
          />
        ))}
      </group>
    </group>
  );
}

/** Quay ụ theo hướng ngắm của người đứng vị trí (pháo chính: điểm ngắm trên biển; phòng không: hướng ngắm). */
function aimMount(m: MountView, s: ShipState, pose: { x: number; y: number; z: number; rotY: number }, cls: ShipClass, kick: number) {
  const mt = m.part.mount!;
  const ok = (s.parts.get(m.part.id) ?? 100) > 0;
  if (!ok) {
    // Hỏng: nòng chúc xuống, tháp xệ.
    m.barrels.rotation.x = 0.25;
    return;
  }
  let yaw = pose.rotY + mt.rest;
  let pitch = 0;
  if (mt.weapon === "bbGun" || mt.weapon === "ddGun") {
    const pv = shipToWorld(pose, mt.pivot[0], mt.pivot[1], mt.pivot[2]);
    if (s.aimX || s.aimZ) {
      yaw = clampMountYaw(pose, mt, Math.atan2(s.aimX - pv[0], s.aimZ - pv[2]));
      const e = shellElevation(NAVAL_WEAPONS[mt.weapon].speed, Math.hypot(s.aimX - pv[0], s.aimZ - pv[2]), -pv[1]);
      pitch = Number.isFinite(e) ? e : 0.6;
    }
  } else if (mt.weapon === "aa") {
    yaw = clampMountYaw(pose, mt, s.aaYaw || yaw);
    pitch = Math.max(-0.1, s.aaPitch);
  }
  void cls;
  const local = yaw - pose.rotY;
  const cur = m.group.rotation.y;
  m.group.rotation.y = cur + Math.atan2(Math.sin(local - cur), Math.cos(local - cur)) * 0.15;
  m.barrels.rotation.x += (-pitch - m.barrels.rotation.x) * 0.15;
  // Giật nòng khi bắn loạt.
  m.barrels.position.z = (mt.weapon === "bbGun" || mt.weapon === "ddGun" ? -kick * 1.2 : 0) + (m.barrels.userData.z0 ??= m.barrels.position.z);
}

/** Lửa (ngọn lửa cam, tàn lửa) và khói đen cuồn cuộn ở các đám cháy; bộ phận hỏng hẳn bốc khói mỏng. */
function emitFires(s: ShipState, cls: ShipClass, pose: { x: number; y: number; z: number; rotY: number }, dt: number) {
  for (const [pid, v] of s.fires) {
    const [lx, ly, lz] = firePointOf(cls, pid);
    const [x, y, z] = shipToWorld(pose, lx, ly, lz);
    const k = v / 100;
    const n = Math.min(4, Math.round((4 + 10 * k) * dt * 3));
    for (let i = 0; i < n; i++)
      puffs.push({
        x: x + (Math.random() - 0.5) * 1.6,
        y: y + 0.3,
        z: z + (Math.random() - 0.5) * 1.6,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 2.2 + k * 2.5,
        vz: (Math.random() - 0.5) * 0.6,
        size: 0.7 + k * 1.1,
        grow: 0.5,
        life: 0.55 + Math.random() * 0.3,
        age: 0,
        r: 1,
        g: 0.42 + Math.random() * 0.2,
        b: 0.08,
        alpha: 0.85,
        dense: false,
      });
    if (Math.random() < dt * (3 + 5 * k))
      puffs.push({
        x,
        y: y + 1.2,
        z,
        vx: 0,
        vy: 2.6 + k * 2,
        vz: 0,
        size: 1.6 + k * 1.6,
        grow: 1.8 + k,
        life: 5 + k * 3,
        age: 0,
        r: 0.1,
        g: 0.09,
        b: 0.08,
        alpha: 0.6,
        dense: false,
      });
    if (Math.random() < dt * 4 * k)
      embers.push({
        x,
        y: y + 0.8,
        z,
        vx: (Math.random() - 0.5) * 3,
        vy: 3 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 3,
        age: 0,
        life: 1 + Math.random(),
        size: 0.12,
      });
  }
  for (const [pid, v] of s.parts) {
    if (v > 0 || s.fires.has(pid) || Math.random() > dt * 1.2) continue;
    const [lx, ly, lz] = firePointOf(cls, pid);
    const [x, y, z] = shipToWorld(pose, lx, ly, lz);
    puffs.push({ x, y: y + 0.6, z, vx: 0, vy: 1.4, vz: 0, size: 1, grow: 1.2, life: 3.5, age: 0, r: 0.18, g: 0.17, b: 0.16, alpha: 0.35, dense: false });
  }
}

/** Vệt bọt trắng sau đuôi, sóng rẽ hai bên mũi (dày theo tốc độ), bọt nước tàu ngầm đang lặn (vệt mờ). */
function emitWake(s: ShipState, cls: ShipClass, pose: { x: number; y: number; z: number; rotY: number }, dt: number, dist: number) {
  const speed = Math.abs(s.speed);
  if (speed < 0.8 || dist > 700) return;
  const k = Math.min(1, speed / cls.speed);
  const under = cls.id === "submarine" && s.y < -4;
  const n = Math.max(1, Math.round(dt * (dist < 300 ? 14 : 6) * k));
  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const [sx, , sz] = shipToWorld({ ...pose, y: 0 }, side * (Math.random() * cls.beam * 0.4), 0, -cls.length / 2);
    puffs.push({
      x: sx,
      y: 0.15,
      z: sz,
      vx: Math.cos(pose.rotY) * side * 0.6,
      vy: 0,
      vz: -Math.sin(pose.rotY) * side * 0.6,
      size: 1.6 + k * 1.4,
      grow: 1.4,
      life: 4 + k * 3,
      age: 0,
      r: 0.93,
      g: 0.96,
      b: 1,
      alpha: (under ? 0.18 : 0.42) * k,
      dense: false,
    });
    if (!under && Math.random() < 0.6) {
      const [bx, , bz] = shipToWorld({ ...pose, y: 0 }, side * cls.beam * 0.42, 0, cls.length * 0.38);
      puffs.push({
        x: bx,
        y: 0.3,
        z: bz,
        vx: Math.cos(pose.rotY) * side * (1.5 + k * 2),
        vy: 0.6,
        vz: -Math.sin(pose.rotY) * side * (1.5 + k * 2),
        size: 0.9,
        grow: 1.6,
        life: 1.6,
        age: 0,
        r: 0.95,
        g: 0.97,
        b: 1,
        alpha: 0.5 * k,
        dense: false,
      });
    }
  }
}
