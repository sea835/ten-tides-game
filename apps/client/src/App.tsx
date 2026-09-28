import { useEffect, useState } from "react";
import { Lobby } from "./Lobby.tsx";
import { Game } from "./game/Game.tsx";
import { forgetLastRoom, wasKicked, type IslandRoom } from "./net.ts";

export function App() {
  const [room, setRoom] = useState<IslandRoom | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;
    // Server đóng kết nối (bị mời ra, hoặc hết thời gian chờ vào lại): quay về sảnh và báo lý do.
    const onLeave = (code: number) => {
      if (wasKicked(code)) {
        forgetLastRoom();
        setNotice("Chủ phòng đã mời bạn ra khỏi phòng.");
      } else if (code !== 1000) {
        setNotice("Mất kết nối với phòng. Vào lại bằng mã phòng để chơi tiếp đúng nhân vật cũ.");
      }
      setRoom(null);
    };
    room.onLeave(onLeave);
    return () => room.onLeave.remove(onLeave);
  }, [room]);

  if (!room) {
    return (
      <Lobby
        notice={notice}
        onJoined={(r) => {
          setNotice(null);
          setRoom(r);
        }}
      />
    );
  }
  return (
    <Game
      room={room}
      onLeave={() => {
        forgetLastRoom();
        void room.leave();
        setRoom(null);
      }}
    />
  );
}
