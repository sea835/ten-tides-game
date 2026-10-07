import { useEffect, useSyncExternalStore } from "react";

// Bảng phủ kín màn hình (Gacha, Gunsmith) báo cho nền 3D trang trí phía sau thôi vẽ. Tách khỏi stageLoop.tsx để các
// bảng nạp cùng sảnh không kéo theo mã three/R3F.

let pauses = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Gọi trong bảng phủ kín màn hình: nền 3D phía sau thôi vẽ trong lúc bảng mở. */
export function useDecorPause(active = true) {
  useEffect(() => {
    if (!active) return;
    pauses++;
    emit();
    return () => {
      pauses--;
      emit();
    };
  }, [active]);
}

/** Có bảng nào đang che nền 3D không. */
export function useDecorPaused(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pauses > 0,
  );
}
