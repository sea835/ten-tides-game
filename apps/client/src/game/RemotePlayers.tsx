import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import type { Group } from "three";
import type { PlayerState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { Character } from "./Character.tsx";
import { useChat } from "./chatStore.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

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

function RemotePlayer({ id, player, carrying }: { id: string; player: PlayerState; carrying: boolean }) {
  const root = useRef<Group>(null);
  const avatar = useRef<Group>(null);
  const [connected, setConnected] = useState(player.connected);
  const [alive, setAlive] = useState(player.alive);
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
  });

  return (
    <group ref={root} position={[player.x, player.y, player.z]}>
      <Character ref={avatar} color={player.color} opacity={alive && connected ? 1 : 0.35} carrying={carrying} />
      {bubble && (
        <Html position={[0, 2.9, 0]} center zIndexRange={[5, 0]} className="bubble">
          {bubble}
        </Html>
      )}
      <Html position={[0, 2.3, 0]} center zIndexRange={[5, 0]} className="nametag">
        {player.name}
        {!alive ? " (đã gục)" : !connected && " (mất kết nối)"}
        {carrying && " · vác rương"}
      </Html>
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
        <RemotePlayer key={id} id={id} player={player} carrying={id === carrier} />
      ))}
    </>
  );
}
