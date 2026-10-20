import { lazy, Suspense, useEffect, useState } from "react";
import { Lobby } from "./Lobby.tsx";
import { canResume, forgetLastRoom, resumeRoom, wasKicked, type IslandRoom } from "./net.ts";
import { GunsmithHost } from "./gunsmith/GunsmithHost.tsx";
import { installUiSounds } from "./game/sound/ui.ts";
import { installA11y } from "./game/a11y.ts";
import { ErrorBoundary, ErrorToast } from "./robust/ErrorBoundary.tsx";
import { installErrorHooks } from "./robust/errorHooks.ts";
import { LoadingScreen, markGameChunkReady } from "./robust/LoadingScreen.tsx";
import { WebglOverlay } from "./robust/WebglGuard.tsx";

// Phần chơi (three.js, vật lý Rapier, hậu kỳ, toàn bộ cảnh và HUD trận) tải riêng: sảnh chờ mở ngay không phải đợi
// mấy MB mã 3D. Tải trước ngầm khi sảnh rảnh, nên lúc vào phòng gần như không phải chờ.
const loadGame = () => import("./game/Game.tsx").then((m) => (markGameChunkReady(), m));
const Game = lazy(() => loadGame().then((m) => ({ default: m.Game })));

export function App() {
  const [room, setRoom] = useState<IslandRoom | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Tải lại trang (F5) giữa trận: thử nối lại phiên cũ trước khi hiện sảnh.
  const [resuming, setResuming] = useState(canResume);
  // Rớt mạng thoáng qua: SDK đang tự nối lại, che màn hình bằng thông báo.
  const [dropped, setDropped] = useState(false);

  useEffect(() => {
    if (!resuming) return;
    let live = true;
    void resumeRoom().then((r) => {
      if (!live) return;
      if (r) {
        setNotice(null);
        setRoom(r);
      }
      setResuming(false);
    });
    return () => {
      live = false;
    };
  }, [resuming]);

  // Tiếng giao diện (rê chuột, bấm nút, lắp trang bị) cho cả sảnh lẫn trong trận.
  useEffect(() => installUiSounds(), []);
  // Cỡ HUD, màu phe cho người mù màu theo Cài đặt; bắt lỗi toàn cục (lỗi lặp thì hiện thông báo nhỏ).
  useEffect(() => installA11y(), []);
  useEffect(() => installErrorHooks(), []);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadGame());
  }, []);

  useEffect(() => {
    if (!room) return;
    setDropped(false);
    // Server đóng kết nối (bị mời ra, hoặc hết thời gian chờ vào lại): quay về sảnh và báo lý do.
    const onLeave = (code: number) => {
      setDropped(false);
      if (wasKicked(code)) {
        forgetLastRoom();
        setNotice("Chủ phòng đã mời bạn ra khỏi phòng.");
      } else if (code !== 1000) {
        setNotice("Mất kết nối với phòng. Vào lại bằng mã phòng để chơi tiếp đúng nhân vật cũ.");
        // Tự nối lại không được (vd. rớt ngay sau khi vào): thử thêm một lần bằng token đã lưu.
        if (canResume()) setResuming(true);
      }
      setRoom(null);
    };
    const onDrop = () => setDropped(true);
    const onReconnect = () => setDropped(false);
    room.onLeave(onLeave);
    room.onDrop(onDrop);
    room.onReconnect(onReconnect);
    return () => {
      room.onLeave.remove(onLeave);
      room.onDrop.remove(onDrop);
      room.onReconnect.remove(onReconnect);
    };
  }, [room]);

  let screen;
  if (resuming && !room) {
    screen = (
      <div className="reconnecting">
        <div className="spinner" aria-hidden />
        Đang vào lại trận…
      </div>
    );
  } else if (!room) {
    screen = (
      <ErrorBoundary scope="lobby">
        <Lobby
          notice={notice}
          onJoined={(r) => {
            setNotice(null);
            setRoom(r);
          }}
        />
        {/* Gunsmith mở bằng openGunsmith() từ sảnh hay bảng tài khoản. */}
        <GunsmithHost />
      </ErrorBoundary>
    );
  } else {
    const leave = () => {
      forgetLastRoom();
      void room.leave();
      setRoom(null);
    };
    screen = (
      <ErrorBoundary scope="game" onBack={leave} resetKey={room}>
        <Suspense fallback={<LoadingScreen room={room} />}>
          <Game room={room} onLeave={leave} />
          {dropped && (
            <div className="reconnecting overlay" role="status">
              <div className="spinner" aria-hidden />
              Mất kết nối, đang nối lại…
            </div>
          )}
        </Suspense>
        <WebglOverlay onLeave={leave} />
      </ErrorBoundary>
    );
  }
  return (
    <>
      {screen}
      <ErrorToast />
    </>
  );
}
