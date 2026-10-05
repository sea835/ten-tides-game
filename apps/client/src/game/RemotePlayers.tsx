import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import { MeshBasicMaterial, OctahedronGeometry, type Group } from "three";
import type { PlayerState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { currentWorld } from "./world.ts";
import { Character, type Motion } from "./Character.tsx";
import { useChat } from "./chatStore.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { WEAPON, isEmplacement, withAttachments } from "@tentides/content";
import { bodies } from "./battle/runtime.ts";
import { physicsProbe } from "./battle/surface.ts";
import { muzzleOffset } from "./GunModel.tsx";
import { localPosition } from "./shared.ts";
import { playFootstep } from "./sound/guns.ts";
import { FarSoldier } from "./battle/FarSoldier.tsx";

/** Dấu đồng đội (chiến trường): hình thoi xanh sáng, không bị sương mù làm mờ. */
const MATE_GEO = new OctahedronGeometry(0.16, 0);
const MATE_MAT = new MeshBasicMaterial({ color: "#6fb0ff", fog: false, depthTest: false, transparent: true, opacity: 0.9 });

/** Nhãn vai trò trên đầu đồng đội. */
const ROLE_TAG: Record<string, string> = { rifle: "súng trường", sniper: "bắn tỉa", support: "súng máy", tanker: "lái tăng", antitank: "chống tăng" };

const BUBBLE_MS = 6000;

/** Câu nói gần nhất của một người, còn hiện trong vài giây. */
function useBubble(playerId: string): string | null {
  const lines = useChat();
  const [, rerender] = useState(0);
  const last = lines.findLast((l) => l.from === playerId);
  const age = last ? performance.now() - last.at : Infinity;
  useEffect(() => {
    if (age >= BUBBLE_MS) return;
    const timer = setTimeout(() => rerender((n) => n + 1), BUBBLE_MS - age);
    return () => clearTimeout(timer);
  }, [last?.id, age]);
  return age < BUBBLE_MS ? last!.text : null;
}

/** Ngồi trong xe (không thấy thân, không bắn trúng được); xạ thủ vũ khí cố định (ổ đại liên, cối) thì lộ người ra ngoài. */
function hiddenInVehicle(room: IslandRoom, player: PlayerState): boolean {
  if (!player.vehicle) return false;
  const v = room.state.vehicles.get(player.vehicle);
  return !v || !isEmplacement(v.kind);
}

function RemotePlayer({ room, id, player, carrying }: { room: IslandRoom; id: string; player: PlayerState; carrying: boolean }) {
  const world = currentWorld(room);
  const battle = room.state.mode === "battle";
  useEffect(() => () => void bodies.delete(id), [id]);
  const root = useRef<Group>(null);
  const avatar = useRef<Group>(null);
  const [connected, setConnected] = useState(player.connected);
  const [alive, setAlive] = useState(player.alive);
  const [held, setHeld] = useState(player.held);
  // Ngồi trong lõi đám cỏ cao là đang nấp: giấu bảng tên (bản đồ nhỏ cũng giấu chấm).
  const [pose, setPose] = useState<"stand" | "sit" | "hidden">("stand");
  const bubble = useBubble(id);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    // Nội suy về vị trí mới nhất từ server để chuyển động mượt dù chỉ nhận 15 gói/giây.
    const t = Math.min(1, dt * 12);
    g.position.x += (player.x - g.position.x) * t;
    g.position.y += (player.y - g.position.y) * t;
    g.position.z += (player.z - g.position.z) * t;
    if (avatar.current) {
      const current = avatar.current.rotation.y;
      const diff = Math.atan2(Math.sin(player.rotY - current), Math.cos(player.rotY - current));
      avatar.current.rotation.y = current + diff * t;
    }
    if (player.connected !== connected) setConnected(player.connected);
    if (player.alive !== alive) setAlive(player.alive);
    if (player.held !== held) setHeld(player.held);
    const nextPose = !player.sitting ? "stand" : world.inTallGrass(player.x, player.z) ? "hidden" : "sit";
    // Battleground: ghi chỗ thân người này đang hiện trên màn hình mình, để dò đạn trúng đúng chỗ thấy. Ngồi trong xe
    // tăng thì không có thân để bắn.
    if (battle) {
      let b = bodies.get(id);
      if (!b) {
        b = { x: 0, y: 0, z: 0, crouch: false, prone: false, rotY: 0, lean: 0, alive: false, team: "" };
        bodies.set(id, b);
      }
      b.x = g.position.x;
      b.y = g.position.y;
      b.z = g.position.z;
      b.crouch = player.crouching;
      b.prone = player.prone;
      b.lean = player.lean;
      b.rotY = avatar.current ? avatar.current.rotation.y : player.rotY;
      b.alive = player.alive && !hiddenInVehicle(room, player);
      b.team = player.team;
    }
    if (nextPose !== pose) setPose(nextPose);
  });

  if (battle) return <BattleRemote room={room} id={id} player={player} root={root} avatar={avatar} alive={alive} />;
  return (
    <group ref={root} position={[player.x, player.y, player.z]}>
      <Character ref={avatar} color={player.color} opacity={alive && connected ? 1 : 0.35} carrying={carrying} held={alive ? held : ""} motion={() => player} />
      {bubble && (
        <Html position={[0, 2.9, 0]} center zIndexRange={[5, 0]} className="bubble" style={{ "--c": player.color } as CSSProperties}>
          {bubble}
        </Html>
      )}
      {pose !== "hidden" && (
        <Html position={[0, pose === "sit" ? 1.75 : 2.3, 0]} center zIndexRange={[5, 0]} className="nametag" style={{ "--c": player.color } as CSSProperties}>
          {player.name}
          {!alive ? " (đã gục)" : !connected && " (mất kết nối)"}
          {carrying && " · vác rương"}
        </Html>
      )}
    </group>
  );
}

/** Battleground: người khác mang súng, giáp, mũ, áo ngụy trang; gục thì biến mất (đồ rơi lại); không hiện tên. */
/** Xa hơn chừng này (m) thì vẽ hình người rút gọn; gần lại dưới mức kia thì vẽ lại đầy đủ (hai mức để khỏi chập chờn). */
const LOD_FAR = 55;
const LOD_NEAR = 47;
/** Xa hơn chừng này thì thôi đổ bóng (bóng người ở xa gần như không thấy mà tốn gấp đôi lệnh vẽ). */
const SHADOW_FAR = 32;
/** Xa hơn chừng này thì ẩn chi tiết nhỏ trên mặt. */
const DETAIL_FAR = 16;

function BattleRemote({ room, id, player, root, avatar, alive }: { room: IslandRoom; id: string; player: PlayerState; root: RefObject<Group | null>; avatar: RefObject<Group | null>; alive: boolean }) {
  // Ở xa: hình người rút gọn; ngồi trong xe tăng: không vẽ người.
  const [far, setFar] = useState(false);
  const [inTank, setInTank] = useState(hiddenInVehicle(room, player));
  const [pose, setPose] = useState<"stand" | "crouch" | "prone">("stand");
  const shadow = useRef({ on: true, detail: true, at: 0 });
  const war = useRoomSnapshot(room, (s) => s.battleMode === "war");
  const mate = useRoomSnapshot(room, (s) => {
    const me = s.players.get(myId(room));
    return !!me?.team && me.team === player.team;
  });
  const look = useRoomSnapshot(room, () => {
    const k = player.kit;
    const slot = k.active;
    const weapon = slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "";
    return {
      weapon,
      atts: slot === "primary1" ? k.att1 : slot === "primary2" ? k.att2 : slot === "pistol" ? k.attP : "",
      skin: weapon ? (player.skins.get(weapon) ?? "") : "",
      sight: slot === "primary1" ? k.sight1 : slot === "primary2" ? k.sight2 : slot === "pistol" ? k.sightP : "", throwable: ["frag", "smoke", "flash", "mine"].includes(slot) ? slot : "", knife: slot === "", outfit: k.outfit, armor: k.armor, helmet: k.helmet };
  });
  // Súng người khác chạm tường: dò tia từ ngực theo hướng họ ngắm (vài lần mỗi giây, chỉ khi ở gần).
  const wall = useRef({ value: 0, at: 0 });
  // Thay đạn, rút súng của người khác: server chỉ báo cờ đang thay đạn và món đang cầm, máy mình tự đếm thời gian.
  const anim = useRef({ reloadAt: 0, reloading: false, weapon: "", swapAt: 0 });
  const motion = useMemo(() => {
    const m: Motion = { moving: false };
    return () => {
      const w = wall.current;
      const now = performance.now();
      if (now - w.at > 120) {
        w.at = now;
        w.value = 0;
        const def = WEAPON.get(look.weapon);
        if (def && player.alive && physicsProbe.cast && Math.hypot(player.x - localPosition.x, player.z - localPosition.z) < 60) {
          const reach = def.class === "pistol" ? 0.62 : 0.4 + muzzleOffset(def.id)[2];
          const yaw = player.rotY;
          const cp = Math.cos(player.aimPitch);
          const hit = physicsProbe.cast(player.x, player.y + (player.crouching ? 1.05 : 1.42), player.z, Math.sin(yaw) * cp, Math.sin(player.aimPitch), Math.cos(yaw) * cp, reach + 0.15);
          if (hit && hit.t > 0.2 && Math.abs(hit.ny) < 0.6) w.value = Math.min(1, Math.max(0, (reach + 0.15 - hit.t) / (reach * 0.55)));
        }
      }
      m.wall = w.value;
      m.speed = speedNow.current;
      const an = anim.current;
      const k = player.kit;
      const def = WEAPON.get(look.weapon);
      if (k.reloading && !an.reloading) an.reloadAt = now;
      an.reloading = k.reloading;
      const reloadDur = def ? withAttachments(def, k.active === "primary1" ? k.att1 : k.active === "primary2" ? k.att2 : k.attP).reload : 1;
      m.reload = k.reloading && def ? Math.min(0.99, (now - an.reloadAt) / (reloadDur * 1000)) : undefined;
      const current = `${k.active}|${look.weapon}`;
      if (current !== an.weapon) {
        if (an.weapon) an.swapAt = now;
        an.weapon = current;
      }
      const sk = Math.min(1, (now - an.swapAt) / 500);
      m.swap = 1 - sk * sk * (3 - 2 * sk);
      m.moving = player.moving;
      m.swimming = player.swimming;
      m.crouching = player.crouching;
      m.prone = player.prone;
      m.aiming = player.aiming;
      m.aimPitch = player.aimPitch;
      m.lean = player.lean;
      m.firing = player.shots;
      m.act = player.act;
      m.actN = player.actN;
      return m;
    };
  }, [player, look.weapon]);
  // Tiếng bước chân: nhịp theo tốc độ đi thật (đo từ vị trí), mặt đất bê tông hay cỏ; ngồi xổm thì rón rén.
  const steps = useRef({ acc: 0, x: player.x, z: player.z });
  // Tốc độ thật (đo từ vị trí đang vẽ, làm mượt) để chân bước khớp tốc độ, không lướt.
  const speedNow = useRef(0);
  const lastPos = useRef<{ x: number; z: number } | null>(null);
  useFrame(({ camera }, dt) => {
    const r = root.current;
    // Mức chi tiết theo khoảng cách tới camera.
    if (r) {
      const d = camera.position.distanceTo(r.position);
      // Trận đông (chiến trường 100 người): vẽ đầy đủ ở gần hơn.
      const crowd = room.state.players.size > 60 ? 0.65 : 1;
      if (!far && d > LOD_FAR * crowd) setFar(true);
      else if (far && d < LOD_NEAR * crowd) setFar(false);
      const now = performance.now();
      const sh = shadow.current;
      if (!far && avatar.current && now - sh.at > 400) {
        sh.at = now;
        const want = d < SHADOW_FAR;
        const detail = d < DETAIL_FAR;
        if (want !== sh.on || detail !== sh.detail) {
          sh.on = want;
          sh.detail = detail;
          avatar.current.traverse((o) => {
            if (!(o as { isMesh?: boolean }).isMesh) return;
            // Chi tiết nhỏ trên mặt: ở xa thì ẩn hẳn (không thấy được mà mỗi cái một lệnh vẽ).
            if (o.userData.tiny) o.visible = detail;
            else o.castShadow = want;
          });
        }
      }
    }
    const hidden = hiddenInVehicle(room, player);
    if (hidden !== inTank) setInTank(hidden);
    const nextPose = player.prone ? "prone" : player.crouching ? "crouch" : "stand";
    if (nextPose !== pose) setPose(nextPose);
    if (r && dt > 0) {
      const lp = lastPos.current;
      if (lp) {
        const v = Math.hypot(r.position.x - lp.x, r.position.z - lp.z) / dt;
        speedNow.current += (Math.min(15, v) - speedNow.current) * Math.min(1, dt * 8);
      }
      lastPos.current = { x: r.position.x, z: r.position.z };
    }
    const st = steps.current;
    const speed = Math.hypot(player.x - st.x, player.z - st.z) / Math.max(dt, 1e-3);
    st.x = player.x;
    st.z = player.z;
    if (!player.alive || !player.moving || speed < 0.5 || player.swimming || player.vehicle) return;
    const run = speed > 6;
    st.acc += dt;
    const interval = player.prone ? 0.9 : player.crouching ? 0.75 : run ? 0.32 : 0.5;
    if (st.acc < interval) return;
    st.acc = 0;
    if (Math.hypot(player.x - localPosition.x, player.z - localPosition.z) > 60) return;
    const ground = currentWorld(room).surface(player.x, player.z).ground;
    const onDeck = player.y > currentWorld(room).heightAt(player.x, player.z) + 0.8;
    playFootstep({ x: player.x, y: player.y, z: player.z }, onDeck ? "metal" : ground && ground !== "dirt" ? "concrete" : "grass", run && !player.crouching && !player.prone);
  });
  return (
    <group ref={root} position={[player.x, player.y, player.z]} visible={alive && !inTank}>
      {far ? (
        <FarSoldier ref={avatar} outfit={look.outfit} pose={pose} gun={!!look.weapon} band={player.team === "blue" || player.team === "red" ? player.color : undefined} />
      ) : (
        <Character ref={avatar} color={player.color} weapon={look.weapon} sight={look.sight} atts={look.atts} gunSkin={look.skin} throwable={look.throwable} knife={look.knife} outfit={look.outfit} armor={look.armor} helmet={look.helmet} motion={motion} />
      )}
      {/* Đồng đội: dấu tên trên đầu (luôn thấy, để biết ai là người mình). */}
      {/* Chiến trường (49 đồng đội): dấu hình thoi trên đầu vẽ bằng một khối nhỏ, nhẹ hơn nhãn chữ. */}
      {mate && alive && !inTank && war && <mesh geometry={MATE_GEO} material={MATE_MAT} position-y={pose === "prone" ? 1.0 : 2.3} />}
      {mate && alive && !inTank && !war && (
        <Html position={[0, pose === "prone" ? 1.1 : 2.25, 0]} center zIndexRange={[4, 0]} className="b-mate">
          <i />
          {player.name.replace("🤖 ", "")}
          {player.role && player.role !== "leader" ? <em>{ROLE_TAG[player.role] ?? ""}</em> : null}
        </Html>
      )}
    </group>
  );
}

export function RemotePlayers({ room }: { room: IslandRoom }) {
  const [others, setOthers] = useState<[string, PlayerState][]>([]);
  const carrier = useRoomSnapshot(room, (s) => (s.treasureSafe ? "" : s.treasureCarrier));

  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () =>
      setOthers([...room.state.players.entries()].filter(([id]) => id !== myId(room)));
    const offAdd = callbacks.onAdd("players", refresh);
    const offRemove = callbacks.onRemove("players", refresh);
    refresh();
    return () => {
      offAdd();
      offRemove();
    };
  }, [room]);

  return (
    <>
      {others.map(([id, player]) => (
        <RemotePlayer key={id} room={room} id={id} player={player} carrying={id === carrier} />
      ))}
    </>
  );
}
