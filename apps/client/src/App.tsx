import { useState } from "react";
import { Lobby } from "./Lobby.tsx";
import { Game } from "./game/Game.tsx";
import type { IslandRoom } from "./net.ts";

export function App() {
  const [room, setRoom] = useState<IslandRoom | null>(null);

  if (!room) return <Lobby onJoined={setRoom} />;
  return (
    <Game
      room={room}
      onLeave={() => {
        void room.leave();
        setRoom(null);
      }}
    />
  );
}
