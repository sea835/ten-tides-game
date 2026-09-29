import { useSyncExternalStore } from "react";

// Cài đặt điều khiển của người chơi, nhớ theo trình duyệt: độ nhạy chuột (thường, khi ngắm, khi dùng ống ngắm),
// đảo trục dọc, giữ hay bấm để ngắm, góc nhìn rộng. Đổi trong bảng Cài đặt (phím Esc hoặc nút bánh răng).

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
}

const KEY = "tentides.settings";
export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, adsSensitivity: 0.75, scopeSensitivity: 0.55, invertY: false, toggleAim: false, fov: 70 };

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

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Mức phóng đại đang ngắm (1 là không ngắm), LocalPlayer và bộ bắn súng ghi; input đọc để giảm độ nhạy. */
export const aimZoom = { value: 1 };
