import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import type { Group } from "three";
import type { PlayerState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { Character } from "./Character.tsx";

function RemotePlayer({ player }: { player: PlayerState }) {
  const root = useRef<Group>(null);
  const avatar = useRef<Group>(null);
  const [connected, setConnected] = useState(player.connected);

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
  });

  return (
    <group ref={root} position={[player.x, player.y, player.z]}>
      <Character ref={avatar} color={player.color} opacity={connected ? 1 : 0.4} />
      <Html position={[0, 2.3, 0]} center zIndexRange={[5, 0]} className="nametag">
        {player.name}
        {!connected && " (mất kết nối)"}
      </Html>
    </group>
  );
}

export function RemotePlayers({ room }: { room: IslandRoom }) {
  const [others, setOthers] = useState<[string, PlayerState][]>([]);

  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () =>
      setOthers([...room.state.players.entries()].filter(([id]) => id !== room.sessionId));
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
        <RemotePlayer key={id} player={player} />
      ))}
    </>
  );
}
