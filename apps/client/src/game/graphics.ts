import { useSyncExternalStore } from "react";

// Chất lượng đồ hoạ: "high" có hậu kỳ (bloom, vignette), bóng đổ nét hơn và nhiều cây cỏ hơn;
// "low" cho máy yếu (tắt cả vân chất liệu). Phím P để đổi, nhớ theo trình duyệt.

export type Quality = "high" | "low";
const KEY = "tentides.quality";

function initial(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "high" || saved === "low") return saved;
  } catch {
    // Không đọc được thì đoán theo máy.
  }
  // Máy ít nhân hoặc màn hình cảm ứng (thường là điện thoại) thì mặc định chạy nhẹ.
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
  return weak ? "low" : "high";
}

let quality: Quality = initial();
const listeners = new Set<() => void>();

export function setQuality(next: Quality) {
  if (next === quality) return;
  quality = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  listeners.forEach((l) => l());
}

export function toggleQuality() {
  setQuality(quality === "high" ? "low" : "high");
}

export function useQuality(): Quality {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => quality,
  );
}
