import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { BoxGeometry, CylinderGeometry, Euler, MeshBasicMaterial, MeshStandardMaterial, Quaternion, RingGeometry, SphereGeometry, Vector3, type Group, type Mesh, type PerspectiveCamera } from "three";
import { BULLET_GRAVITY, HMG, MORTAR, MOUNT, NEST, clampElevation, clampTraverse, isEmplacement, mapForMode, mortarImpact, mortarMuzzle, mountMuzzle, seatPos, vehicleSpec } from "@tentides/content";
import { Messages, type MortarFxMessage, type VehicleState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { keys, look, smoothView, view } from "../input.ts";
import { aimZoom, getSettings } from "../settings.ts";
import { localPosition, shake } from "../shared.ts";
import { playMortarFire, playMortarWhistle } from "../sound/mortar.ts";
import { fireMounted } from "./Carriers.tsx";
import { effects, getBattleHud, localBody, menuOpen, seat, setBattleHud } from "./runtime.ts";
import { BULLET_GROUPS } from "./surface.ts";
import { emplacementHud, seatOwner, WreckFire } from "./vehicleParts.tsx";
import { StaticShadowRoot } from "../StaticShadows.tsx";

// Vũ khí cố định (ổ đại liên sau vòng bao cát, cối 82 ly trên giá hai chân): vẽ mô hình khối, hộp va chạm (người,
// đạn không xuyên bao cát); xạ thủ là nhân vật thật (RemotePlayers vẽ, bắn trúng được vì lộ nửa người trên).
// Ngồi ổ đại liên: chuột xoay súng (giá súng chỉ xoay trong cung ~120° trước mặt), chuột trái bắn, chuột phải ngắm gần.
// Ngồi cối: chuột xoay phương vị, W/S hay lăn chuột chỉnh góc ngẩng (45°–85°: ngẩng cao là bắn gần), bảng tầm bắn và
// bản đồ nhỏ có điểm rơi dự đoán, vòng đánh dấu điểm rơi trên mặt đất; chuột trái bắn (nạp 3 giây), giữ chuột phải
// nhìn từ trên cao xuống chỗ rơi. F rời vị trí. Mọi máy: quả đạn cối bay cầu vồng, tiếng rít khi sắp rơi gần mình.

const AIM_INTERVAL = 1 / 10;
/** Lăn chuột một nấc / giữ W·S mỗi giây chỉnh góc ngẩng cối chừng này (rad). */
const ELEV_NOTCH = (0.5 * Math.PI) / 180;
const ELEV_RATE = (12 * Math.PI) / 180;

type RapierBody = ReturnType<ReturnType<typeof useRapier>["world"]["createRigidBody"]>;
/** Thân vật lý từng vũ khí cố định (để tia ngắm, đạn đại liên bỏ qua chính ổ mình). */
const emplacementBodies = new Map<string, RapierBody>();

// ---------------------------------------------------------------------------- mô hình

const SANDBAG = new MeshStandardMaterial({ color: "#a8996f", roughness: 1 });
const SANDBAG_DARK = new MeshStandardMaterial({ color: "#8c7f5a", roughness: 1 });
const STEEL = new MeshStandardMaterial({ color: "#2b2d2b", roughness: 0.5, metalness: 0.6 });
const OLIVE = new MeshStandardMaterial({ color: "#4f5a3a", roughness: 0.75, metalness: 0.25 });
const WRECK = new MeshStandardMaterial({ color: "#1c1a18", roughness: 1 });
for (const m of [STEEL, OLIVE, WRECK]) m.userData.detail = "metal";

const G = {
  bag: new BoxGeometry(0.78, 0.36, 0.44),
  leg: new CylinderGeometry(0.025, 0.03, 1, 6),
  receiver: new BoxGeometry(0.18, 0.2, 0.55),
  barrel: new CylinderGeometry(0.04, 0.05, MOUNT.barrel, 8),
  jacket: new CylinderGeometry(0.065, 0.065, 0.5, 8),
  ammo: new BoxGeometry(0.16, 0.16, 0.26),
  shield: new BoxGeometry(0.62, 0.42, 0.03),
  grip: new BoxGeometry(0.05, 0.14, 0.05),
  plate: new CylinderGeometry(0.34, 0.38, 0.06, 12),
  tube: new CylinderGeometry(0.05, 0.055, MORTAR.tube, 10),
  muzzle: new CylinderGeometry(0.065, 0.06, 0.08, 10),
  bipod: new CylinderGeometry(0.02, 0.022, 1, 6),
  crate: new BoxGeometry(0.5, 0.26, 0.34),
};
G.leg.translate(0, -0.5, 0);
G.bipod.translate(0, -0.5, 0);
G.barrel.rotateX(Math.PI / 2);
G.barrel.translate(0, 0, MOUNT.barrel / 2);
G.jacket.rotateX(Math.PI / 2);
G.jacket.translate(0, 0, 0.45);
G.tube.rotateX(Math.PI / 2);
G.tube.translate(0, 0, MORTAR.tube / 2);
G.muzzle.rotateX(Math.PI / 2);
G.muzzle.translate(0, 0, MORTAR.tube);

/** Bao cát xếp vòng: `r` bán kính, `rows` số lớp, chừa lối vào phía sau (−z) cỡ `gap` rad. */
function Sandbags({ r, rows, gap, wreck, front = 0 }: { r: number; rows: number; gap: number; wreck: boolean; front?: number }) {
  const bags = useMemo(() => {
    const out: { x: number; y: number; z: number; ry: number; dark: boolean }[] = [];
    for (let row = 0; row < rows; row++) {
      const n = Math.max(6, Math.round((Math.PI * 2 * r) / 0.74));
      for (let k = 0; k < n; k++) {
        const a = ((k + (row % 2) * 0.5) / n) * Math.PI * 2;
        // Lối vào phía sau (a quanh π, tính theo hướng +z là trước).
        if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < gap / 2) continue;
        // Lớp trên cùng chỉ xếp phía trước (che xạ thủ khi bắn).
        if (row >= rows - front && Math.cos(a) < 0.3) continue;
        out.push({ x: Math.sin(a) * r, y: 0.18 + row * 0.33, z: Math.cos(a) * r, ry: a, dark: (k + row) % 3 === 0 });
      }
    }
    return out;
  }, [r, rows, gap, front]);
  // Ụ bao cát không bao giờ dịch chuyển: bóng vẽ sẵn vào bản đồ bóng tĩnh (mỗi ụ vài chục khối).
  return (
    <StaticShadowRoot>
      {bags.map((b, i) => (
        <mesh key={i} geometry={G.bag} material={wreck ? WRECK : b.dark ? SANDBAG_DARK : SANDBAG} position={[b.x, b.y, b.z]} rotation-y={b.ry + Math.PI / 2} castShadow receiveShadow />
      ))}
    </StaticShadowRoot>
  );
}

/** Ổ đại liên: vòng bao cát ba lớp (lớp trên chỉ phía trước), giá ba chân, đại liên có tấm chắn. Gốc ở mặt đất. */
function NestModel({ yaw, pitch, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; wreck: boolean }) {
  const m = wreck ? WRECK : STEEL;
  const [mx, my, mz] = NEST.mount;
  return (
    <group>
      <Sandbags r={1.2} rows={3} gap={1.1} front={1} wreck={wreck} />
      {/* Giá ba chân. */}
      {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => (
        <mesh key={a} geometry={G.leg} material={m} position={[mx, my - 0.1, mz]} rotation={[Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45]} scale={[1, my - 0.05, 1]} />
      ))}
      <group position={[mx, my, mz]}>
        <group ref={yaw}>
          <group ref={pitch}>
            <mesh geometry={G.receiver} material={m} position={[0, 0.02, 0.05]} castShadow />
            <mesh geometry={G.jacket} material={m} castShadow />
            <mesh geometry={G.barrel} material={m} castShadow />
            <mesh geometry={G.ammo} material={wreck ? WRECK : OLIVE} position={[-0.17, -0.02, 0.05]} castShadow />
            <mesh geometry={G.shield} material={wreck ? WRECK : OLIVE} position={[0, 0.06, 0.42]} castShadow />
            <mesh geometry={G.grip} material={m} position={[0, -0.05, -0.28]} />
          </group>
        </group>
      </group>
    </group>
  );
}

/** Cối 82 ly: đế tì tròn, ống cối xoay theo phương vị, ngẩng theo góc; giá hai chân chống xuống đất; hòm đạn, nửa vòng bao cát. */
function MortarModel({ yaw, pitch, bipod, recoil, wreck }: { yaw: React.RefObject<Group | null>; pitch: React.RefObject<Group | null>; bipod: React.RefObject<Group | null>; recoil: React.RefObject<Group | null>; wreck: boolean }) {
  const m = wreck ? WRECK : STEEL;
  const [, my] = MORTAR.mount;
  return (
    <group>
      <Sandbags r={1.05} rows={2} gap={2.2} wreck={wreck} />
      <mesh geometry={G.crate} material={wreck ? WRECK : OLIVE} position={[0.75, 0.13, -0.55]} rotation-y={0.4} castShadow />
      <mesh geometry={G.plate} material={m} position={[0, 0.03, 0]} receiveShadow />
      <group ref={yaw} position={[0, my, 0]}>
        <group ref={pitch}>
          <group ref={recoil}>
            <mesh geometry={G.tube} material={m} castShadow />
            <mesh geometry={G.muzzle} material={m} />
          </group>
          {/* Giá hai chân gắn ở 2/3 ống, chân chống thẳng xuống đất (xoay ngược góc ngẩng mỗi khung). */}
          <group ref={bipod} position={[0, 0, MORTAR.tube * 0.62]}>
            <mesh geometry={G.bipod} material={m} position={[0.02, 0, 0]} rotation-z={0.32} />
            <mesh geometry={G.bipod} material={m} position={[-0.02, 0, 0]} rotation-z={-0.32} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------- một vũ khí cố định

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");
const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));

export function Emplacement({ id, v }: { id: string; v: VehicleState }) {
  const kind = v.kind === "mortar" ? "mortar" : "hmg_nest";
  const spec = vehicleSpec(kind);
  const { world: physics, rapier } = useRapier();
  const yaw = useRef<Group>(null);
  const pitch = useRef<Group>(null);
  const bipod = useRef<Group>(null);
  const recoil = useRef<Group>(null);
  const [wreck, setWreck] = useState(v.hp <= 0);
  const anim = useRef({ turret: v.turret, pitch: v.pitch, shots: v.shots, kick: 0 });

  useEffect(() => {
    const body = physics.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(v.x, v.y, v.z));
    _q.setFromEuler(_e.set(0, v.rotY, 0));
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, false);
    const [hw, hh, hl] = spec.half;
    physics.createCollider(rapier.ColliderDesc.cuboid(hw - 0.05, hh, hl - 0.05).setTranslation(0, hh, 0), body);
    emplacementBodies.set(id, body);
    return () => {
      emplacementBodies.delete(id);
      if (physics.getRigidBody(body.handle)) physics.removeRigidBody(body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, rapier, id]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = anim.current;
    const mine = es.vid === id;
    const wantYaw = mine ? es.yaw : v.turret;
    const wantPitch = mine ? es.pitch : v.pitch;
    const k = mine ? 1 : Math.min(1, dt * 12);
    a.turret += wrap(wantYaw - a.turret) * k;
    a.pitch += (wantPitch - a.pitch) * k;
    if (v.shots !== a.shots) {
      a.shots = v.shots;
      a.kick = 1;
    }
    a.kick = Math.max(0, a.kick - dt * 5);
    if (v.hp <= 0 !== wreck) setWreck(v.hp <= 0);
    if (yaw.current) yaw.current.rotation.y = a.turret - v.rotY;
    if (pitch.current) pitch.current.rotation.x = -a.pitch;
    // Cối: chân giá luôn chống thẳng đứng, dài theo độ cao chỗ gắn; ống giật lùi khi bắn.
    if (bipod.current) {
      bipod.current.rotation.x = a.pitch;
      bipod.current.scale.y = MORTAR.mount[1] + Math.sin(a.pitch) * MORTAR.tube * 0.62;
    }
    if (recoil.current) recoil.current.position.z = -a.kick * 0.12;
  });

  return (
    <group position={[v.x, v.y, v.z]} rotation-y={v.rotY}>
      {kind === "mortar" ? <MortarModel yaw={yaw} pitch={pitch} bipod={bipod} recoil={recoil} wreck={wreck} /> : <NestModel yaw={yaw} pitch={pitch} wreck={wreck} />}
      <WreckFire wreck={wreck} size={0.5} top={kind === "mortar" ? 0.6 : 1} />
    </group>
  );
}

// ---------------------------------------------------------------------------- ngồi vũ khí cố định

/** Trạng thái vũ khí cố định mình đang ngồi: hướng súng / phương vị, góc nòng / góc ngẩng, bắn, nạp đạn. */
const es = {
  vid: "",
  kind: "" as "" | "hmg_nest" | "mortar",
  yaw: 0,
  pitch: 0,
  fireHeld: false,
  fireClick: false,
  zoom: false,
  nextShot: 0,
  readyAt: 0,
  aimAt: 0,
  lastAim: "",
  /** Lăn chuột chưa xử lý (nấc, dương là ngẩng thấp xuống — bắn xa hơn). */
  wheel: 0,
  /** Điểm rơi dự đoán, và góc đã tính cho nó (đổi góc mới tính lại). */
  impact: { x: 0, y: 0, z: 0, t: 0 },
  impactKey: "",
  flagsAt: 0,
};

/** Vòng đánh dấu điểm rơi dự đoán trên mặt đất (chỉ pháo thủ cối thấy). */
const MARK_RING = new RingGeometry(MORTAR.radius - 0.35, MORTAR.radius, 40);
MARK_RING.rotateX(-Math.PI / 2);
const MARK_DOT = new RingGeometry(0, 0.5, 12);
MARK_DOT.rotateX(-Math.PI / 2);
const MARK_MAT = new MeshBasicMaterial({ color: "#ff5a3c", transparent: true, opacity: 0.75, depthWrite: false });

const _tmp = { target: new Vector3(), pos: new Vector3(), dir: new Vector3(), aim: new Vector3(), o: new Vector3(), up: new Vector3() };

export function EmplacementSeat({ room, teamColor }: { room: IslandRoom; teamColor: (team: string) => string }) {
  const { world: physics, rapier } = useRapier();
  const mark = useRef<Group>(null);
  // Tia dò dùng lại mỗi khung (không tạo mới): camera lùi vướng tường, điểm ngắm giữa màn hình.
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const castFrom = (o: { x: number; y: number; z: number }, dx: number, dy: number, dz: number) => {
    ray.origin.x = o.x;
    ray.origin.y = o.y;
    ray.origin.z = o.z;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    return ray;
  };

  // Chuột trái bắn, chuột phải ngắm gần (đại liên) / nhìn từ trên cao (cối); lăn chuột chỉnh góc ngẩng cối.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!es.vid || !document.pointerLockElement || menuOpen()) return;
      if (e.button === 0) {
        es.fireHeld = true;
        es.fireClick = true;
      }
      if (e.button === 2) es.zoom = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) es.fireHeld = false;
      if (e.button === 2) es.zoom = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!es.vid || es.kind !== "mortar" || menuOpen()) return;
      es.wheel += Math.sign(e.deltaY);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const mid = myId(room);
    const me = room.state.players.get(mid);
    const vid = me?.alive && me.vehicle ? me.vehicle : "";
    const v = vid ? room.state.vehicles.get(vid) : undefined;
    if (mark.current) mark.current.visible = false;
    if (!v || v.hp <= 0 || !isEmplacement(v.kind) || v.driver !== mid) {
      if (es.vid) {
        // Vừa rời vị trí (hay ổ nổ): trả camera, FOV về cho nhân vật.
        es.vid = "";
        es.kind = "";
        es.fireHeld = es.fireClick = es.zoom = false;
        emplacementHud.active = false;
        if (seatOwner.kind === "emplacement") {
          seatOwner.kind = "";
          seat.id = "";
          aimZoom.value = 1;
        }
      }
      return;
    }
    const kind = v.kind as "hmg_nest" | "mortar";
    if (es.vid !== vid) {
      // Vừa vào vị trí: súng theo hướng server đang giữ, camera sau lưng.
      es.vid = vid;
      es.kind = kind;
      es.yaw = v.turret;
      es.pitch = kind === "mortar" ? clampElevation(v.pitch) : v.pitch;
      es.wheel = 0;
      es.impactKey = "";
      es.readyAt = 0;
      es.fireClick = false;
      look.yaw = v.turret + Math.PI;
      look.pitch = kind === "mortar" ? 0.45 : 0.15;
      if (getBattleHud().nearTank) setBattleHud({ nearTank: "" });
    }
    seatOwner.kind = "emplacement";
    seat.id = vid;
    const at = seatPos(kind, v, 0);
    seat.x = at[0];
    seat.y = at[1] - 0.5;
    seat.z = at[2];

    smoothView(dt);
    const cam = state.camera as PerspectiveCamera;
    const { target, pos, dir, aim } = _tmp;
    const map = mapForMode(room.state.battleMode, room.state.worldSeed);
    const now = performance.now();
    const typing = menuOpen();
    let zoomFov = 1;
    const own = emplacementBodies.get(vid);
    const skipOwn = (c: { parent(): { handle: number } | null }) => {
      const h = c.parent()?.handle;
      return h !== own?.handle && h !== localBody.current?.handle;
    };
    /** Camera lùi ra sau `target` theo hướng (dx, dy, dz) đơn vị, xa nhất `dist`: vướng tường thì dừng trước tường. */
    const placeCam = (dx: number, dy: number, dz: number, dist: number) => {
      const hitWall = dist > 0.5 ? physics.castRay(castFrom(target, dx, dy, dz), dist, true, undefined, undefined, undefined, undefined, skipOwn) : null;
      const d = hitWall ? Math.max(0.2, hitWall.timeOfImpact - 0.3) : dist;
      pos.set(target.x + dx * d, target.y + dy * d, target.z + dz * d);
      const floor = map.world.heightAt(pos.x, pos.z) + 0.5;
      if (pos.y < floor) pos.y = floor;
    };

    if (kind === "hmg_nest") {
      // Camera sau vai xạ thủ; điểm ngắm là tia từ camera qua giữa màn hình, súng quay về đó trong cung xoay.
      const zoom = es.zoom;
      const pivot = mountMuzzle(kind, v, 0, 0).pivot;
      target.set(pivot[0], pivot[1] + 0.75, pivot[2]);
      placeCam(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch), zoom ? 0.01 : 3.2);
      cam.position.copy(pos);
      dir.set(-Math.sin(view.yaw) * Math.cos(view.pitch), -Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch));
      cam.lookAt(aim.copy(pos).add(dir));
      zoomFov = zoom ? 2.2 : 1;
      cam.getWorldDirection(dir);
      const hit = physics.castRay(castFrom(cam.position, dir.x, dir.y, dir.z), 500, true, undefined, BULLET_GROUPS, undefined, undefined, skipOwn);
      aim.copy(cam.position).addScaledVector(dir, hit ? hit.timeOfImpact : 300);
      const rawYaw = Math.atan2(aim.x - pivot[0], aim.z - pivot[2]);
      const wantYaw = clampTraverse(kind, v.rotY, rawYaw);
      const wantPitch = Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, Math.atan2(aim.y - pivot[1], Math.hypot(aim.x - pivot[0], aim.z - pivot[2]))));
      const turn = 3 * dt;
      es.yaw = clampTraverse(kind, v.rotY, es.yaw + Math.max(-turn, Math.min(turn, wrap(wantYaw - es.yaw))));
      es.pitch += Math.max(-turn, Math.min(turn, wantPitch - es.pitch));
      emplacementHud.clamped = Math.abs(wrap(rawYaw - wantYaw)) > 0.02;
      const mz = mountMuzzle(kind, v, es.yaw, es.pitch);
      const reach = Math.max(8, aim.distanceTo(_tmp.o.set(mz.o[0], mz.o[1], mz.o[2])));
      _tmp.up.set(mz.o[0] + mz.d[0] * reach, mz.o[1] + mz.d[1] * reach, mz.o[2] + mz.d[2] * reach).project(cam);
      emplacementHud.aimOn = _tmp.up.z < 1;
      emplacementHud.aimX = (_tmp.up.x + 1) / 2;
      emplacementHud.aimY = (1 - _tmp.up.y) / 2;
      if (es.fireHeld && now >= es.nextShot && room.state.phase === "battle") {
        es.nextShot = Math.max(es.nextShot + 60000 / HMG.rpm, now);
        fireMounted(room, mz, skipOwn, physics, rapier);
        shake.amount = Math.min(0.35, shake.amount + 0.05);
        look.pitch -= 0.003;
      }
      emplacementHud.zoom = zoom;
    } else {
      // Cối: phương vị theo hướng camera, góc ngẩng theo W/S, lăn chuột.
      const elevIn = typing ? 0 : (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
      es.pitch = clampElevation(es.pitch + elevIn * ELEV_RATE * dt + es.wheel * ELEV_NOTCH);
      es.wheel = 0;
      es.yaw = view.yaw + Math.PI;
      const mz = mortarMuzzle(v, es.yaw, es.pitch);
      const key = `${es.yaw.toFixed(3)},${es.pitch.toFixed(4)}`;
      if (key !== es.impactKey) {
        es.impactKey = key;
        es.impact = mortarImpact(map, mz.o, mz.d, MORTAR.velocity, 0.08);
      }
      const im = es.impact;
      if (es.zoom) {
        // Nhìn từ trên cao xuống chỗ rơi (như người quan sát chỉnh bắn).
        target.set(im.x, im.y, im.z);
        pos.set(im.x + Math.sin(view.yaw) * 22, im.y + 48, im.z + Math.cos(view.yaw) * 22);
        cam.position.copy(pos);
        cam.lookAt(target);
      } else {
        // Nhìn cao từ sau lưng cối.
        const p = Math.max(0.25, Math.min(1.25, view.pitch));
        target.set(mz.pivot[0], mz.pivot[1] + 1.4, mz.pivot[2]);
        placeCam(Math.sin(view.yaw) * Math.cos(p), Math.sin(p), Math.cos(view.yaw) * Math.cos(p), 7.5);
        cam.position.copy(pos);
        dir.set(-Math.sin(view.yaw) * Math.cos(p), -Math.sin(p) * 0.6, -Math.cos(view.yaw) * Math.cos(p));
        cam.lookAt(aim.copy(pos).add(dir));
      }
      if (mark.current) {
        mark.current.visible = true;
        mark.current.position.set(im.x, Math.max(0, im.y) + 0.12, im.z);
      }
      if (es.fireClick && now >= es.readyAt && room.state.phase === "battle") {
        es.readyAt = now + MORTAR.reload * 1000;
        room.send(Messages.mortarFire, { turret: es.yaw, elev: es.pitch });
        shake.amount = Math.min(0.5, shake.amount + 0.25);
      }
      emplacementHud.zoom = false;
      emplacementHud.x = v.x;
      emplacementHud.z = v.z;
      emplacementHud.az = es.yaw;
      emplacementHud.elev = es.pitch;
      emplacementHud.range = Math.hypot(im.x - mz.o[0], im.z - mz.o[2]);
      emplacementHud.impactX = im.x;
      emplacementHud.impactZ = im.z;
      emplacementHud.flight = im.t;
      emplacementHud.reload = Math.max(0, Math.min(1, 1 - (es.readyAt - now) / (MORTAR.reload * 1000)));
      // Cứ điểm cho bản đồ nhỏ (vài lần mỗi giây).
      if (now - es.flagsAt > 400) {
        es.flagsAt = now;
        let fk = "";
        const list: typeof emplacementHud.flags = [];
        for (const [fid, f] of room.state.flags) {
          const color = teamColor(f.owner);
          fk += `${fid}${color}`;
          list.push({ id: fid, x: f.x, z: f.z, color });
        }
        if (fk !== emplacementHud.flagsKey) {
          emplacementHud.flagsKey = fk;
          emplacementHud.flags = list;
        }
      }
    }
    es.fireClick = false;

    const baseFov = getSettings().fov;
    const wantFov = zoomFov > 1 ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoomFov) * 180) / Math.PI : baseFov;
    aimZoom.value = zoomFov;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.3;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      shake.amount *= Math.exp(-dt * 7);
    }

    // Báo server hướng súng / ống cối (người khác thấy xoay).
    es.aimAt += dt;
    if (es.aimAt >= AIM_INTERVAL) {
      es.aimAt = 0;
      const key = `${es.yaw.toFixed(2)},${es.pitch.toFixed(3)}`;
      if (key !== es.lastAim) {
        es.lastAim = key;
        room.send(Messages.vehicleAim, { turret: es.yaw, pitch: es.pitch });
      }
    }

    emplacementHud.active = true;
    emplacementHud.kind = kind;
    emplacementHud.hp = v.hp;
    emplacementHud.maxHp = vehicleSpec(kind).hp;
  }, -1);

  return (
    <group ref={mark} visible={false}>
      <mesh geometry={MARK_RING} material={MARK_MAT} renderOrder={5} />
      <mesh geometry={MARK_DOT} material={MARK_MAT} renderOrder={5} />
    </group>
  );
}

// ---------------------------------------------------------------------------- đạn cối bay, tiếng rít

const SHELL_MAX = 12;
const SHELL_GEO = new SphereGeometry(0.09, 8, 6);
SHELL_GEO.scale(1, 1, 2.2);
const SHELL_MAT = new MeshStandardMaterial({ color: "#3a3d36", roughness: 0.6, metalness: 0.4 });
/** Quả đạn đang bay (máy mình tự vẽ theo vận tốc ban đầu server báo). */
const shells = Array.from({ length: SHELL_MAX }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, born: 0 }));

/** Hiệu ứng cối: lửa đầu nòng, khói, tiếng bắn; vẽ quả đạn bay cầu vồng; tiếng rít khi đạn sắp rơi. Đặt trong <Physics>. */
export function MortarShells({ room }: { room: IslandRoom }) {
  const group = useRef<Group>(null);
  useEffect(
    () =>
      room.onMessage(Messages.mortarFx, (m: MortarFxMessage) => {
        const at = { x: m.x, y: m.y, z: m.z };
        if (m.kind === "whistle") {
          playMortarWhistle(at, m.t);
          return;
        }
        const now = performance.now() / 1000;
        effects.flashes.push({ x: m.x, y: m.y, z: m.z, born: now });
        for (let k = 0; k < 3; k++) effects.impacts.push({ x: m.x + (Math.random() - 0.5) * 0.6, y: m.y - 0.8, z: m.z + (Math.random() - 0.5) * 0.6, nx: 0, ny: 1, nz: 0, born: now, blood: false, noHole: true });
        const local = m.vid === es.vid;
        playMortarFire(at, local);
        if (!local && Math.hypot(m.x - localPosition.x, m.z - localPosition.z) < 10) shake.amount = Math.min(0.5, shake.amount + 0.15);
        const s = shells.find((x) => !x.on) ?? shells[0]!;
        s.on = true;
        s.x = m.x;
        s.y = m.y;
        s.z = m.z;
        s.vx = m.vx;
        s.vy = m.vy;
        s.vz = m.vz;
        s.born = now;
      }),
    [room],
  );
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const now = performance.now() / 1000;
    const world = mapForMode(room.state.battleMode, room.state.worldSeed).world;
    for (let i = 0; i < SHELL_MAX; i++) {
      const s = shells[i]!;
      const mesh = g.children[i] as Mesh | undefined;
      if (!mesh) continue;
      if (!s.on) {
        mesh.visible = false;
        continue;
      }
      const t = now - s.born;
      const x = s.x + s.vx * t;
      const z = s.z + s.vz * t;
      const vy = s.vy - BULLET_GRAVITY * t;
      const y = s.y + s.vy * t - 0.5 * BULLET_GRAVITY * t * t;
      if (t > MORTAR.maxFlight || (vy < 0 && y < Math.max(0, world.heightAt(x, z)))) {
        s.on = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(x, y, z);
      // Mũi đạn theo hướng bay.
      mesh.rotation.set(-Math.atan2(vy, Math.hypot(s.vx, s.vz)), Math.atan2(s.vx, s.vz), 0, "YXZ");
    }
  });
  return (
    <group ref={group}>
      {shells.map((_, i) => (
        <mesh key={i} geometry={SHELL_GEO} material={SHELL_MAT} visible={false} />
      ))}
    </group>
  );
}
