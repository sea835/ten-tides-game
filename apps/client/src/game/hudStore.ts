import { useSyncExternalStore } from "react";
import type { ZoneId } from "@tentides/rules";

// Trạng thái nhỏ cho HUD. Vòng lặp 3D chỉ ghi khi giá trị đổi, nên React hiếm khi render lại.

interface HudState {
  zone: ZoneId;
  deepWater: boolean;
  /** Điểm sự kiện đang đứng cạnh, nhấn E để mở. */
  nearAnchor: string | null;
}

let state: HudState = { zone: "beach", deepWater: false, nearAnchor: null };
const listeners = new Set<() => void>();

export function getHud(): HudState {
  return state;
}

export function setHud(patch: Partial<HudState>) {
  const next = { ...state, ...patch };
  if (next.zone === state.zone && next.deepWater === state.deepWater && next.nearAnchor === state.nearAnchor) return;
  state = next;
  listeners.forEach((l) => l());
}

export function useHud(): HudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
