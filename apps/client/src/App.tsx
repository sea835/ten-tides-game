import { lazy, Suspense, useEffect, useState } from "react";
import { Lobby } from "./Lobby.tsx";
import { forgetLastRoom, wasKicked, type IslandRoom } from "./net.ts";

// Phần chơi (three.js, vật lý Rapier, hậu kỳ, toàn bộ cảnh và HUD trận) tải riêng: sảnh chờ mở ngay không phải đợi
// mấy MB mã 3D. Tải trước ngầm khi sảnh rảnh, nên lúc vào phòng gần như không phải chờ.
const loadGame = () => import("./game/Game.tsx");
const Game = lazy(() => loadGame().then((m) => ({ default: m.Game })));

export function App() {
  const [room, setRoom] = useState<IslandRoom | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadGame());
  }, []);

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
    <Suspense fallback={<div className="game-loading">Đang tải chiến trường…</div>}>
      <Game
        room={room}
        onLeave={() => {
          forgetLastRoom();
          void room.leave();
          setRoom(null);
        }}
      />
    </Suspense>
  );
}
