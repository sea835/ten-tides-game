import { useSyncExternalStore } from "react";
import type { ZoneId } from "@tentides/rules";

// Trạng thái nhỏ cho HUD. Vòng lặp 3D chỉ ghi khi giá trị đổi, nên React hiếm khi render lại.

export interface NearTarget {
  id: string;
  /**
   * poi: easter egg, điểm bất thường · creature: thú thân thiện · item: đồ dưới đất · tree: leo cây · camp: nhổ trại ·
   * page: trang nhật ký · campfire: nướng hay góp món đang cầm vào kho.
   */
  kind: "poi" | "creature" | "item" | "tree" | "camp" | "page" | "campfire";
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
  /** Đang đứng ở chỗ đào kho báu. */
  atDigSite: boolean;
  /** Đang ngồi; `hidden` là ngồi trong lõi đám cỏ cao, người khác không thấy tên và chấm trên bản đồ. */
  sitting: boolean;
  hidden: boolean;
  /** Đang leo cây. */
  climbing: boolean;
  /** Đang chìm khi bơi: hết hơi, kiệt sức hay mang quá nặng. */
  sinking: "" | "breath" | "tired" | "heavy";
  /** Đang cầm đồ và đứng cạnh ai đó: nhấn G để đưa cho người đó. */
  giveTo: { id: string; name: string } | null;
  /** Kẻ phản bội đứng sát sau lưng ai đó: nhấn F để kết liễu. */
  victim: { id: string; name: string } | null;
  /** Chế độ dựng nhà: đang chọn công trình nào (rỗng là không dựng). */
  build: string;
  /** Chỗ dựng hợp lệ không (bóng xanh hay đỏ). */
  buildOk: boolean;
  /** Mảnh lắp ghép: vì sao không dựng được, và đang ngắm tầng mấy. */
  buildReason: string;
  buildLevel: number;
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
  /** Đang đứng ở chỗ đào kho báu. */
  atDigSite: boolean;
  /** Đang ngồi; `hidden` là ngồi trong lõi đám cỏ cao, người khác không thấy tên và chấm trên bản đồ. */
  sitting: boolean;
  hidden: boolean;
  /** Đang leo cây. */
  climbing: boolean;
  /** Đang chìm khi bơi: hết hơi, kiệt sức hay mang quá nặng. */
  sinking: "" | "breath" | "tired" | "heavy";
  /** Đang cầm đồ và đứng cạnh ai đó: nhấn G để đưa cho người đó. */
  giveTo: { id: string; name: string } | null;
  /** Kẻ phản bội đứng sát sau lưng ai đó: nhấn F để kết liễu. */
  victim: { id: string; name: string } | null;
  /** Chế độ dựng nhà: đang chọn công trình nào (rỗng là không dựng). */
  build: string;
  /** Chỗ dựng hợp lệ không (bóng xanh hay đỏ). */
  buildOk: boolean;
  /** Mảnh lắp ghép: vì sao không dựng được, và đang ngắm tầng mấy. */
  buildReason: string;
  buildLevel: number;
}

let state: HudState = {
  zone: "beach",
  region: "",
  swimming: false,
  underwater: false,
  nearTarget: null,
  nearAnchor: null,
  atDigSite: false,
  sitting: false,
  hidden: false,
  climbing: false,
  sinking: "",
  giveTo: null,
  victim: null,
  build: "",
  buildOk: false,
  buildReason: "",
  buildLevel: 0,
};
const listeners = new Set<() => void>();

export function getHud(): HudState {
  return state;
}

export function setHud(patch: Partial<HudState>) {
  const next = { ...state, ...patch };
  const same = (k: keyof HudState) =>
    next[k] === state[k] ||
    (k === "nearTarget" && next.nearTarget?.id === state.nearTarget?.id && next.nearTarget?.label === state.nearTarget?.label) ||
    (k === "victim" && next.victim?.id === state.victim?.id) ||
    (k === "giveTo" && next.giveTo?.id === state.giveTo?.id);
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

/**
 * Sức bền để chạy (0–100), nằm riêng khỏi `HudState` có chủ đích: nó hồi liên tục 12 đơn vị/giây,
 * nên nếu gộp vào store chung thì mọi thành phần `useHud()` render lại ~12 lần/giây vĩnh viễn.
 * Ở đây chỉ thành phần nào `useStamina()` mới chịu render lại, thường là đúng một thanh.
 */
let staminaValue = 100;
const staminaListeners = new Set<() => void>();

export function setStamina(v: number) {
  const n = Math.max(0, Math.min(100, v));
  if (Math.abs(n - staminaValue) < 0.5) return;
  staminaValue = n;
  staminaListeners.forEach((l) => l());
}

export function useStamina(): number {
  return useSyncExternalStore(
    (l) => {
      staminaListeners.add(l);
      return () => staminaListeners.delete(l);
    },
    () => staminaValue,
  );
}
