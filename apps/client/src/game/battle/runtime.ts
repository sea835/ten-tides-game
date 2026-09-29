import { useSyncExternalStore } from "react";

// Trạng thái Battleground chạy trên máy mình, đọc ghi mỗi khung hình (không qua React): vị trí vẽ ra của người khác
// (để dò trúng đạn đúng chỗ mình thấy), tư thế ngắm, giật súng, hiệu ứng cần vẽ (vệt đạn, lửa đầu nòng, nổ).
// Những gì HUD cần hiện (dấu trúng, hướng bị bắn, bảng mua đồ) đi qua một kho nhỏ có đăng ký lắng nghe.

/** Thân người khác đang vẽ ở đâu (nội suy), để dò đạn trúng người ngay trên máy mình. */
export const bodies = new Map<string, { x: number; y: number; z: number; crouch: boolean; alive: boolean }>();

/**
 * Tư thế của mình: ngắm, ngồi xổm, phóng đại đang dùng, độ toả đạn hiện tại (radian).
 * `wall`: nòng súng sát vật cản (0 thoáng, 1 dí sát tường), súng dựng lên cho khỏi xuyên tường.
 * `speed`: tốc độ ngang thật (m/s); `land`: độ nặng cú đáp đất vừa rồi (0–1, giảm dần) để camera, súng nhún theo.
 */
export const stance = { aiming: false, crouching: false, zoom: 1, spread: 0.02, moving: false, sprinting: false, airborne: false, holdFire: false, wall: 0, speed: 0, land: 0 };

/**
 * Giật súng.
 * - `pendPitch`/`pendYaw`: phần giật chưa dồn vào góc nhìn (rải ra vài khung hình cho mượt, không giật cục).
 * - `pitch`/`yaw`: phần đã dồn vào góc nhìn trong loạt bắn này, thả cò thì hồi về (trừ phần người chơi tự ghì).
 * - `punchPitch/Yaw/Roll` và vận tốc `v*`: cú hất màn hình (lò xo), chỉ để nhìn, tự về 0.
 * - `kick`: độ giật của khẩu súng trên tay (lùi báng), `shot`: số phát liên tiếp trong loạt.
 * - `fired`: bộ đếm phát bắn (súng trước mặt bắt lấy để giật), `power`: độ mạnh cú giật của khẩu vừa bắn.
 */
export const recoil = { pitch: 0, yaw: 0, pendPitch: 0, pendYaw: 0, punchPitch: 0, punchYaw: 0, punchRoll: 0, vPitch: 0, vYaw: 0, vRoll: 0, kick: 0, shot: 0, fired: 0, power: 0 };

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
  /** Mặt bị găm (chọn lỗ đạn, bụi hay tia lửa); không có thì chỉ phụt bụi, không để lại lỗ. */
  surface?: import("./surface.ts").HitSurface;
  /** Đạn to (súng bắn tỉa, shotgun gần) thì lỗ to hơn. */
  size?: number;
  /** Không rõ mặt găm (pháp tuyến đoán): chỉ phụt bụi, không để lỗ. */
  noHole?: boolean;
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

/** Vết máu bắn lên tường, sàn phía sau người trúng đạn. */
export interface Splat {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  scale: number;
}

/** Hàng đợi hiệu ứng: bên bắn đẩy vào, bộ vẽ lấy ra. */
export const effects = { tracers: [] as Tracer[], impacts: [] as Impact[], flashes: [] as Flash[], blasts: [] as Blast[], splats: [] as Splat[] };

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
