import { useSyncExternalStore } from "react";
import type { BattleModeId } from "../controlsMap.ts";

// Bảng nổi dùng chung giữa sảnh và trong trận: Cài đặt, Phím điều khiển; yêu cầu mở lại bài hướng dẫn (nút "Hướng
// dẫn" trong Cài đặt, bài hướng dẫn trong trận nghe theo). Giữ ở module để nút ở chỗ này mở được bảng ở chỗ khác.

export interface MenuState {
  settings: boolean;
  controls: boolean;
  /** Tăng mỗi lần bấm "Hướng dẫn": bài hướng dẫn trong trận thấy số đổi thì chạy lại từ đầu. */
  tutorial: number;
  /**
   * Chế độ trận đang chơi (bài hướng dẫn trong trận ghi; null ở sảnh, chế độ cốt truyện): nút "Hướng dẫn" chỉ hiện khi
   * có, màn Phím điều khiển mở sẵn đúng nhóm phím của chế độ.
   */
  mode: BattleModeId | null;
}

let state: MenuState = { settings: false, controls: false, tutorial: 0, mode: null };
const listeners = new Set<() => void>();

export function getMenu(): MenuState {
  return state;
}

export function setMenu(patch: Partial<MenuState>) {
  if ((Object.keys(patch) as (keyof MenuState)[]).every((k) => Object.is(state[k], patch[k]))) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeMenu(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMenu(): MenuState {
  return useSyncExternalStore(subscribeMenu, () => state);
}

/** Mở bảng (thả chuột ra để bấm được nút). */
export function openMenu(which: "settings" | "controls") {
  // Một bảng một lúc: mở bảng này thì đóng bảng kia.
  setMenu({ settings: which === "settings", controls: which === "controls" });
  document.exitPointerLock?.();
}

export function requestTutorial() {
  setMenu({ settings: false, controls: false, tutorial: state.tutorial + 1 });
}
