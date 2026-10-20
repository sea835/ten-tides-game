import { useSyncExternalStore } from "react";

// Cài đặt điều khiển của người chơi, nhớ theo trình duyệt: độ nhạy chuột (thường, khi ngắm, khi dùng ống ngắm),
// đảo trục dọc, giữ hay bấm để ngắm, góc nhìn rộng; hỗ trợ dễ nhìn (cỡ HUD, màu phe cho người mù màu, giảm rung).
// Đổi trong bảng Cài đặt (phím O hoặc nút bánh răng, ở sảnh cũng có).

export interface Settings {
  /** Độ nhạy chuột (1 là mặc định). */
  sensitivity: number;
  /** Nhân thêm khi ngắm thường (không ống) và khi nhìn qua ống ngắm. */
  adsSensitivity: number;
  scopeSensitivity: number;
  invertY: boolean;
  /** true: bấm chuột phải một lần để ngắm, bấm lần nữa thôi ngắm. false: giữ để ngắm. */
  toggleAim: boolean;
  /** Góc nhìn ngang (độ). */
  fov: number;
  /** Làm mượt chuột (0 tắt, 1 mượt nhất): camera đuổi theo góc chuột trong vài phần trăm giây, khỏi giật cục. */
  smoothing: number;
  /** Camera nhún theo bước chân, cú đáp đất (0 tắt, 1 đầy đủ). */
  headBob: number;
  /** Cỡ các khung HUD (0,8–1,3): a11y.ts đặt biến CSS --hud-scale trên gốc trang. */
  hudScale: number;
  /** Màu phe dễ phân biệt cho người mù màu đỏ - lục: xanh dương / cam thay vì xanh / đỏ (teamColors.ts). */
  colorblind: boolean;
  /** Giảm rung camera (nổ, trúng đòn, bắn pháo): mỗi cú rung chỉ còn một phần nhỏ (shared.ts). */
  reduceShake: boolean;
}

const KEY = "tentides.settings";
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, adsSensitivity: 0.75, scopeSensitivity: 0.55, invertY: false, toggleAim: false, fov: 70, smoothing: 0.35, headBob: 1, hudScale: 1, colorblind: false, reduceShake: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Không đọc được thì dùng mặc định.
  }
  return { ...DEFAULT_SETTINGS };
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  listeners.forEach((l) => l());
}

/** Nghe cài đặt đổi (ngoài React); trả về hàm gỡ. */
export function subscribeSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, () => current);
}

/** Mức phóng đại đang ngắm (1 là không ngắm), LocalPlayer và bộ bắn súng ghi; input đọc để giảm độ nhạy. */
export const aimZoom = { value: 1 };
