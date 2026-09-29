import { useSyncExternalStore } from "react";

// Trạng thái Battleground chạy trên máy mình, đọc ghi mỗi khung hình (không qua React): vị trí vẽ ra của người khác
// (để dò trúng đạn đúng chỗ mình thấy), tư thế ngắm, giật súng, hiệu ứng cần vẽ (vệt đạn, lửa đầu nòng, nổ).
// Những gì HUD cần hiện (dấu trúng, hướng bị bắn, bảng mua đồ) đi qua một kho nhỏ có đăng ký lắng nghe.

/** Thân người khác đang vẽ ở đâu (nội suy), để dò đạn trúng người ngay trên máy mình. */
export const bodies = new Map<string, { x: number; y: number; z: number; crouch: boolean; alive: boolean }>();

/** Tư thế của mình: ngắm, ngồi xổm, phóng đại đang dùng, độ toả đạn hiện tại (radian). */
export const stance = { aiming: false, crouching: false, zoom: 1, spread: 0.02, moving: false, sprinting: false, airborne: false, holdFire: false };

/** Giật súng dồn lại (cộng vào góc nhìn rồi hồi dần), rung tay. */
export const recoil = { pitch: 0, yaw: 0, kick: 0 };

/** Thân vật lý của mình (LocalPlayer ghi), để tia đạn bỏ qua chính mình. */
export const localBody: { current: import("@react-three/rapier").RapierRigidBody | null } = { current: null };

/** Nhân vật của mình (để lấy đúng đầu nòng khẩu súng đang cầm trên tay). */
export const localAvatar: { current: import("three").Object3D | null } = { current: null };

/** Đầu nòng súng của mình trong thế giới (ViewModel hoặc nhân vật ghi), để vệt đạn xuất phát đúng chỗ. */
export const muzzle = { x: 0, y: 0, z: 0, valid: false };

export interface Tracer {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  born: number;
  /** Vệt của mình thì sáng hơn. */
  mine: boolean;
}
export interface Impact {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  born: number;
  blood: boolean;
}
export interface Flash {
  x: number;
  y: number;
  z: number;
  born: number;
}
export interface Blast {
  kind: "frag" | "mine" | "smoke";
  x: number;
  y: number;
  z: number;
  born: number;
}

/** Hàng đợi hiệu ứng: bên bắn đẩy vào, bộ vẽ lấy ra. */
export const effects = { tracers: [] as Tracer[], impacts: [] as Impact[], flashes: [] as Flash[], blasts: [] as Blast[] };

// ---------------------------------------------------------------------------- kho cho HUD

export interface HudState {
  buyOpen: boolean;
  scoreboard: boolean;
  settingsOpen: boolean;
  /** Dấu trúng gần nhất (thời điểm, loại) để vẽ dấu X ở tâm ngắm. */
  hit: { at: number; kind: "body" | "head" | "kill"; armor: boolean } | null;
  /** Các lần bị bắn gần đây: hướng (radian, theo thế giới) và thời điểm. */
  hurts: { at: number; angle: number; amount: number }[];
  /** Đồ gần nhất nhặt được (key trong groundItems, id đồ). */
  nearItem: { key: string; itemId: string } | null;
  /** Đang theo dõi ai sau khi gục. */
  spectating: string;
  /** Mìn của mình (server báo). */
  myMines: { x: number; y: number; z: number }[];
  /** Thông báo ngắn (hết tiền, không mang thêm được...). */
  toast: { at: number; text: string } | null;
}

let hud: HudState = { buyOpen: false, scoreboard: false, settingsOpen: false, hit: null, hurts: [], nearItem: null, spectating: "", myMines: [], toast: null };
const listeners = new Set<() => void>();

export function getBattleHud(): HudState {
  return hud;
}

export function setBattleHud(patch: Partial<HudState>) {
  hud = { ...hud, ...patch };
  listeners.forEach((l) => l());
}

export function useBattleHud(): HudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hud,
  );
}

/** Có bảng nào đang mở (mua đồ, cài đặt) thì thôi điều khiển nhân vật. */
export function menuOpen(): boolean {
  return hud.buyOpen || hud.settingsOpen;
}
