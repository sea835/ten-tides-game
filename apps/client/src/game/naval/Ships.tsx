import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildShipModel, type ModelMat } from "./shipModel.ts";
import {
  clampMountYaw,
  firePointOf,
  shellElevation,
  shipClass,
  shipToWorld,
  NAVAL_WEAPONS,
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
const MAT_COLOR: Record<ModelMat, string> = {
  hull: "#4f565d",
  deck: "#6f7378",
  steel: "#9aa0a6",
  dark: "#3a3e43",
  wood: "#b39570",
  glass: "#22394a",
  accent: "#d9d6cc",
  flight: "#3d4045",
  rail: "#c4c8cc",
  loft: "#ffffff",
  boat: "#ede7d8",
  marking: "#ecebe4",
  bronze: "#a8834d",
  funnelCap: "#1a1b1d",
  team: "#cccccc",
};

/** Vân ván gỗ boong (thiết giáp hạm) và thép chống trượt (tàu khác): vẽ một lần, lặp theo mét. */
let deckTextures: { wood: CanvasTexture; steel: CanvasTexture } | null = null;
function deckTexture(kind: "wood" | "steel"): CanvasTexture {
  if (!deckTextures) {
    const make = (draw: (c: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      draw(canvas.getContext("2d")!);
      const t = new CanvasTexture(canvas);
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const wood = make((c) => {
      // 15 tấm ván dọc thân, mỗi tấm một tông, mối nối so le.
      for (let i = 0; i < 15; i++) {
        const tone = 0.85 + rnd() * 0.25;
        c.fillStyle = `rgb(${Math.round(176 * tone)},${Math.round(146 * tone)},${Math.round(108 * tone)})`;
        c.fillRect((i * 256) / 15, 0, 256 / 15, 256);
        c.fillStyle = "rgba(40,28,18,0.55)";
        c.fillRect((i * 256) / 15, 0, 1.2, 256);
        c.fillRect((i * 256) / 15, ((i * 97) % 256) | 0, 256 / 15, 1.2);
      }
      for (let k = 0; k < 400; k++) {
        c.fillStyle = `rgba(60,40,20,${rnd() * 0.12})`;
        c.fillRect(rnd() * 256, rnd() * 256, 1, 6 + rnd() * 20);
      }
    });
    const steel = make((c) => {
      c.fillStyle = "#73777c";
      c.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 2500; k++) {
        const g = 90 + rnd() * 50;
        c.fillStyle = `rgba(${g},${g + 2},${g + 5},0.35)`;
        c.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
      }
      c.strokeStyle = "rgba(30,32,35,0.5)";
      c.lineWidth = 1;
      c.strokeRect(0.5, 0.5, 255, 127);
      c.strokeRect(0.5, 128.5, 255, 127);
    });
    deckTextures = { wood, steel };
  }
  return deckTextures[kind];
}
const STATION_MAT = new MeshBasicMaterial({
  color: new Color("#ffd27a").multiplyScalar(2.2),
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  toneMapped: false,
});
const BURNT = new MeshStandardMaterial({ color: "#1d1b1a", roughness: 1 });
BURNT.userData.detail = "rock";
BURNT.userData.detailSpace = "object";
const _q = new Quaternion();
const _e = new Euler();

interface MountView {
  part: ShipPart;
  group: Group;
  barrels: Group;
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
  const hull = useMemo(() => buildShipModel(cls, new Color(accent)), [cls, accent]);
  useEffect(() => () => hull.forEach((h) => h.geometry.dispose()), [hull]);
  const mats = useMemo(() => {
    const out = {} as Record<ModelMat, MeshStandardMaterial>;
    for (const k of Object.keys(MAT_COLOR) as ModelMat[]) {
      out[k] = new MeshStandardMaterial({
        color: k === "team" ? accent : MAT_COLOR[k],
        roughness: k === "glass" ? 0.2 : k === "loft" ? 0.62 : k === "marking" ? 0.9 : 0.78,
        metalness: k === "steel" || k === "hull" || k === "dark" || k === "loft" ? 0.15 : k === "glass" ? 0.5 : 0.05,
        emissive: k === "glass" ? new Color("#10222e") : new Color(0),
        vertexColors: k === "loft",
        side: k === "team" || k === "loft" || k === "marking" ? DoubleSide : undefined,
        map: k === "wood" ? deckTexture("wood") : k === "deck" ? deckTexture("steel") : null,
        polygonOffset: k === "marking",
        polygonOffsetFactor: k === "marking" ? -2 : 0,
      });
    }
    // Vân bề mặt (textures.ts): thép theo toạ độ của tàu (tàu chạy thì vân đi theo), kính, sơn, cờ thì để trơn.
    for (const [k, m] of Object.entries(out) as [ModelMat, MeshStandardMaterial][]) {
      m.userData.detail = k === "glass" || k === "marking" || k === "team" || k === "boat" || k === "accent" ? "none" : "metal";
      m.userData.detailSpace = "object";
      m.userData.detailStrength = 0.45;
    }
    return out;
  }, [accent]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const stripe = useMemo(() => {
    const m = new MeshStandardMaterial({ color: accent, roughness: 0.6 });
    m.userData.detail = "none";
    return m;
  }, [accent]);
  const turretMat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#6b737b", roughness: 0.7, metalness: 0.3 });
    m.userData.detail = "metal";
    m.userData.detailSpace = "object";
    m.userData.detailStrength = 0.45;
    return m;
  }, []);

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
        for (const mesh of list) mesh.material = dead.has(part) ? BURNT : mats[(mesh.userData.mat as ModelMat) ?? "steel"];
      for (const m of mounts.current)
        m.group.traverse((o) =>
          (o as Mesh).isMesh ? ((o as Mesh).material = dead.has(m.part.id) ? BURNT : o.userData.mat === "accent" ? stripe : o.userData.mat === "turret" ? turretMat : mats.dark) : null,
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
          house={turretMat}
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

/** Hộp có mặt trước vát lên (tháp pháo): đỉnh trên phía trước lùi lại `slope` mét, phía sau lùi `back`. */
function slopedBox(w: number, h: number, d: number, slope: number, back = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) <= 0) continue;
    if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) - slope);
    else p.setZ(i, p.getZ(i) + back);
  }
  g.computeVertexNormals();
  return g;
}

interface TurretShape {
  /** Rộng, cao, dài thân tháp; vát trước. */
  w: number;
  h: number;
  d: number;
  slope: number;
  /** Nòng: bán kính gốc, đầu, khoảng cách giữa các nòng, độ cao trục nòng (phần thân tháp). */
  r0: number;
  r1: number;
  spread: number;
  axis: number;
  /** Kính đo xa hai bên (thiết giáp hạm), tấm chắn (phòng không), ống phóng. */
  kind: "turret" | "aa" | "tubes";
}

const SHAPES: Partial<Record<string, TurretShape>> = {
  bbGun: { w: 10.5, h: 3.6, d: 12.5, slope: 2.6, r0: 0.55, r1: 0.36, spread: 2.7, axis: 0.42, kind: "turret" },
  ddGun: { w: 4.2, h: 2.5, d: 5.4, slope: 1.1, r0: 0.22, r1: 0.15, spread: 1.05, axis: 0.42, kind: "turret" },
  aa: { w: 2.6, h: 1, d: 2.4, slope: 0, r0: 0.09, r1: 0.07, spread: 0.42, axis: 0.85, kind: "aa" },
  torpedo: { w: 2.4, h: 0.35, d: 2.4, slope: 0, r0: 0.3, r1: 0.3, spread: 0.68, axis: 0.6, kind: "tubes" },
  gtorpedo: { w: 2.4, h: 0.35, d: 2.4, slope: 0, r0: 0.3, r1: 0.3, spread: 0.68, axis: 0.6, kind: "tubes" },
};

/** Một ụ vũ khí: bệ xoay (yaw) và cụm nòng (pitch). Tàu ngầm (ống trong thân), giếng phóng, máy phóng không vẽ ụ. */
function Mount({
  part,
  stripe,
  dark,
  house,
  onMount,
}: {
  part: ShipPart;
  stripe: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  house: MeshStandardMaterial;
  onMount: (m: MountView) => void;
}) {
  const group = useRef<Group>(null);
  const barrels = useRef<Group>(null);
  const m = part.mount!;
  useEffect(() => {
    if (group.current && barrels.current) onMount({ part, group: group.current, barrels: barrels.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);
  const shape = m.pivot[1] < 0 ? undefined : SHAPES[m.weapon];
  const geo = useMemo(() => {
    if (!shape) return null;
    const len = m.barrel;
    const barrel = new CylinderGeometry(shape.r1, shape.r0, len, 12).rotateX(Math.PI / 2).translate(0, 0, len / 2);
    // Đầu nòng loe (pháo), bao chắn gốc nòng.
    const muzzle = new CylinderGeometry(shape.r1 * 1.25, shape.r1 * 1.1, Math.max(0.2, len * 0.04), 12).rotateX(Math.PI / 2).translate(0, 0, len);
    const bag = new CylinderGeometry(shape.r0 * 1.5, shape.r0 * 1.5, Math.max(0.3, len * 0.07), 12).rotateX(Math.PI / 2).translate(0, 0, Math.max(0.15, len * 0.035));
    const barrelAll = mergeGeometries([barrel.toNonIndexed(), muzzle.toNonIndexed(), bag.toNonIndexed()])!;
    let body: BufferGeometry;
    const extra: BufferGeometry[] = [];
    if (shape.kind === "turret") {
      body = slopedBox(shape.w, shape.h, shape.d, shape.slope, shape.slope * 0.2).translate(0, shape.h / 2, -shape.d * 0.12);
      if (m.weapon === "bbGun") {
        // Kính đo xa hai bên phía sau, nắp quan sát trên nóc.
        extra.push(new BoxGeometry(shape.w + 3.6, 0.9, 1.1).translate(0, shape.h * 0.62, -shape.d * 0.38));
        for (const sx of [-2.6, 2.6]) extra.push(new CylinderGeometry(0.6, 0.7, 0.6, 10).translate(sx, shape.h + 0.3, -shape.d * 0.15));
      }
    } else if (shape.kind === "aa") {
      body = new CylinderGeometry(shape.w * 0.5, shape.w * 0.55, 0.35, 16).translate(0, 0.18, 0);
      // Tấm chắn phía trước, ghế pháo thủ hai bên.
      extra.push(new BoxGeometry(shape.w * 0.95, shape.h, 0.08).translate(0, 0.35 + shape.h / 2, shape.d * 0.28));
      for (const sx of [-0.85, 0.85]) extra.push(new BoxGeometry(0.4, 0.5, 0.4).translate(sx * shape.w * 0.4, 0.6, -0.4));
    } else {
      body = new CylinderGeometry(shape.w * 0.5, shape.w * 0.5, shape.h, 16).translate(0, shape.h / 2, 0);
    }
    const bodyAll = mergeGeometries([body.index ? body.toNonIndexed() : body, ...extra.map((e) => (e.index ? e.toNonIndexed() : e))])!;
    return { barrel: barrelAll, body: bodyAll };
  }, [shape, m]);
  useEffect(() => () => void (geo && (geo.barrel.dispose(), geo.body.dispose())), [geo]);
  if (!shape || !geo)
    return (
      <group ref={group} position={[m.pivot[0], m.pivot[1], m.pivot[2]]}>
        <group ref={barrels} />
      </group>
    );
  const axisY = shape.kind === "turret" ? shape.h * shape.axis : shape.axis;
  const front = shape.kind === "turret" ? shape.d * 0.3 : shape.kind === "aa" ? 0 : -m.barrel * 0.5;
  return (
    <group ref={group} position={[m.pivot[0], m.pivot[1], m.pivot[2]]} rotation-y={m.rest}>
      <mesh geometry={geo.body} material={house} castShadow receiveShadow userData={{ mat: "turret" }} />
      {m.weapon === "bbGun" && (
        <mesh position={[0, shape.h + 0.03, -shape.d * 0.2]} material={stripe} userData={{ mat: "accent" }}>
          <boxGeometry args={[shape.w * 0.55, 0.06, shape.d * 0.4]} />
        </mesh>
      )}
      <group ref={barrels} position={[0, axisY, front]}>
        {Array.from({ length: m.barrels }, (_, k) => (
          <mesh key={k} geometry={geo.barrel} material={dark} position={[(k - (m.barrels - 1) / 2) * shape.spread, 0, 0]} castShadow userData={{ mat: "dark" }} />
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
