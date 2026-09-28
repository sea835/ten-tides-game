import { useSyncExternalStore } from "react";
import type { ZoneId } from "@tentides/rules";

// Trạng thái nhỏ cho HUD. Vòng lặp 3D chỉ ghi khi giá trị đổi, nên React hiếm khi render lại.

export interface NearTarget {
  id: string;
  kind: "poi" | "creature";
  label: string;
}

interface HudState {
  zone: ZoneId;
  /** Tên nơi đang đứng: vùng của đảo chính, tên đảo nhỏ, tên hang, hầm mỏ, hay biển khơi. */
  region: string;
  /** Đang bơi, và đầu đang ở dưới mặt nước. */
  swimming: boolean;
  underwater: boolean;
  /** Easter egg, điểm bất thường hay sinh vật thân thiện đang ở sát bên, nhấn E để xem xét. */
  nearTarget: NearTarget | null;
  /** Điểm sự kiện đang đứng cạnh, nhấn E để mở. */
  nearAnchor: string | null;
  /** Sức bền để chạy nhanh lúc này (0–100). */
  sprint: number;
  /** Đang đứng ở chỗ đào kho báu. */
  atDigSite: boolean;
  /** Đang ngồi; `hidden` là ngồi trong lõi đám cỏ cao, người khác không thấy tên và chấm trên bản đồ. */
  sitting: boolean;
  hidden: boolean;
}

let state: HudState = {
  zone: "beach",
  region: "",
  swimming: false,
  underwater: false,
  nearTarget: null,
  nearAnchor: null,
  sprint: 100,
  atDigSite: false,
  sitting: false,
  hidden: false,
};
const listeners = new Set<() => void>();

export function getHud(): HudState {
  return state;
}

export function setHud(patch: Partial<HudState>) {
  const next = { ...state, ...patch };
  const same = (k: keyof HudState) => next[k] === state[k] || (k === "nearTarget" && next.nearTarget?.id === state.nearTarget?.id);
  if ((Object.keys(next) as (keyof HudState)[]).every(same)) return;
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
