import { useEffect, useState, useSyncExternalStore } from "react";
import { MODE_NAMES, isBattleMode, type BattleModeId } from "../game/controlsMap.ts";
import type { IslandRoom } from "../net.ts";
import { loadProgress, loadStage, tipAt } from "./loading.ts";
import "./robust.css";

// Màn tải ván chơi (thay dòng chữ trần "Đang tải chiến trường…" ở App.tsx): tên chế độ, thanh tiến độ, giai đoạn và mẹo
// chơi xoay vòng. Mã game tải bằng nhập khẩu động nên không có phần trăm thật: thanh chạy ước lượng rồi đầy khi mã đã về.

let chunkReady = false;
const listeners = new Set<() => void>();

/** App gọi khi mã game (chunk Game.tsx) đã tải xong. */
export function markGameChunkReady() {
  chunkReady = true;
  listeners.forEach((l) => l());
}

function useChunkReady() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chunkReady,
  );
}

const TIP_MS = 4500;

/** Chế độ của phòng nếu đã biết (phòng sinh tồn cũ / chưa đồng bộ thì null). */
export function modeOfRoom(room: IslandRoom | null): BattleModeId | null {
  try {
    const s = room?.state;
    return s && s.mode === "battle" && isBattleMode(s.battleMode) ? s.battleMode : null;
  } catch {
    return null;
  }
}

export function LoadingScreen({ room }: { room: IslandRoom | null }) {
  const ready = useChunkReady();
  const mode = modeOfRoom(room);
  const [elapsed, setElapsed] = useState(0);
  const [tip, setTip] = useState(0);
  // Mỗi lần tải bắt đầu ở một mẹo khác.
  const [offset] = useState(() => Math.floor(Math.random() * 1000));
  useEffect(() => {
    const t0 = performance.now();
    const a = window.setInterval(() => setElapsed(performance.now() - t0), 200);
    const b = window.setInterval(() => setTip((n) => n + 1), TIP_MS);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);
  const p = loadProgress(elapsed, ready);
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-kicker">Ten Tides · Frontline</div>
        <h1>{mode ? MODE_NAMES[mode] : "Chiến trường"}</h1>
        <div className="loading-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <i style={{ width: `${p * 100}%` }} />
        </div>
        <div className="loading-stage">
          <span>{loadStage(ready)}</span>
          <span>{Math.round(p * 100)}%</span>
        </div>
        <p className="loading-tip">
          <small>Mẹo</small>
          {tipAt(mode, tip, offset)}
        </p>
      </div>
    </div>
  );
}
