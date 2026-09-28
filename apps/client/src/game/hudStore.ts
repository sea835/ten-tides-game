import { useSyncExternalStore } from "react";
import type { ZoneId } from "@tentides/rules";

// Trạng thái nhỏ cho HUD. Vòng lặp 3D chỉ ghi khi giá trị đổi, nên React hiếm khi render lại.

interface HudState {
  zone: ZoneId;
  deepWater: boolean;
  /** Điểm sự kiện đang đứng cạnh, nhấn E để mở. */
  nearAnchor: string | null;
  /** Sức bền để chạy nhanh lúc này (0–100). */
  sprint: number;
  /** Đang đứng ở chỗ đào kho báu. */
  atDigSite: boolean;
}

let state: HudState = { zone: "beach", deepWater: false, nearAnchor: null, sprint: 100, atDigSite: false };
const listeners = new Set<() => void>();

export function getHud(): HudState {
  return state;
}

export function setHud(patch: Partial<HudState>) {
  const next = { ...state, ...patch };
  if ((Object.keys(next) as (keyof HudState)[]).every((k) => next[k] === state[k])) return;
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
