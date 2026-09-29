import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import type { Group } from "three";
import type { PlayerState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { currentWorld } from "./world.ts";
import { Character, type Motion } from "./Character.tsx";
import { useChat } from "./chatStore.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { WEAPON } from "@tentides/content";
import { bodies } from "./battle/runtime.ts";
import { physicsProbe } from "./battle/surface.ts";
import { muzzleOffset } from "./GunModel.tsx";
import { localPosition } from "./shared.ts";
import { playFootstep } from "./sound/guns.ts";

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
    // Battleground: ghi chỗ thân người này đang hiện trên màn hình mình, để dò đạn trúng đúng chỗ thấy.
    if (battle) {
      const b = bodies.get(id);
      if (b) {
        b.x = g.position.x;
        b.y = g.position.y;
        b.z = g.position.z;
        b.crouch = player.crouching;
        b.alive = player.alive;
      } else bodies.set(id, { x: g.position.x, y: g.position.y, z: g.position.z, crouch: player.crouching, alive: player.alive });
    }
    if (nextPose !== pose) setPose(nextPose);
  });

  if (battle) return <BattleRemote room={room} player={player} root={root} avatar={avatar} alive={alive} />;
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
function BattleRemote({ room, player, root, avatar, alive }: { room: IslandRoom; player: PlayerState; root: RefObject<Group | null>; avatar: RefObject<Group | null>; alive: boolean }) {
  const look = useRoomSnapshot(room, () => {
    const k = player.kit;
    const slot = k.active;
    return { weapon: slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "", sight: slot === "primary1" ? k.sight1 : slot === "primary2" ? k.sight2 : slot === "pistol" ? k.sightP : "", throwable: ["frag", "smoke", "flash", "mine"].includes(slot) ? slot : "", knife: slot === "", outfit: k.outfit, armor: k.armor, helmet: k.helmet };
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
      const an = anim.current;
      const k = player.kit;
      const def = WEAPON.get(look.weapon);
      if (k.reloading && !an.reloading) an.reloadAt = now;
      an.reloading = k.reloading;
      m.reload = k.reloading && def ? Math.min(0.99, (now - an.reloadAt) / (def.reload * 1000)) : undefined;
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
      m.aiming = player.aiming;
      m.aimPitch = player.aimPitch;
      m.firing = player.shots;
      m.act = player.act;
      m.actN = player.actN;
      return m;
    };
  }, [player, look.weapon]);
  // Tiếng bước chân: nhịp theo tốc độ đi thật (đo từ vị trí), mặt đất bê tông hay cỏ; ngồi xổm thì rón rén.
  const steps = useRef({ acc: 0, x: player.x, z: player.z });
  useFrame((_, dt) => {
    const st = steps.current;
    const speed = Math.hypot(player.x - st.x, player.z - st.z) / Math.max(dt, 1e-3);
    st.x = player.x;
    st.z = player.z;
    if (!player.alive || !player.moving || speed < 0.5 || player.swimming) return;
    const run = speed > 6;
    st.acc += dt;
    const interval = player.crouching ? 0.75 : run ? 0.32 : 0.5;
    if (st.acc < interval) return;
    st.acc = 0;
    if (Math.hypot(player.x - localPosition.x, player.z - localPosition.z) > 60) return;
    const ground = currentWorld(room).surface(player.x, player.z).ground;
    const onDeck = player.y > currentWorld(room).heightAt(player.x, player.z) + 0.8;
    playFootstep({ x: player.x, y: player.y, z: player.z }, onDeck ? "metal" : ground && ground !== "dirt" ? "concrete" : "grass", run && !player.crouching);
  });
  return (
    <group ref={root} position={[player.x, player.y, player.z]} visible={alive}>
      <Character ref={avatar} color={player.color} weapon={look.weapon} sight={look.sight} throwable={look.throwable} knife={look.knife} outfit={look.outfit} armor={look.armor} helmet={look.helmet} motion={motion} />
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
