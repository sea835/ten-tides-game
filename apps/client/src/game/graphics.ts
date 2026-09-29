import { useSyncExternalStore } from "react";

// Chất lượng đồ hoạ:
//   high   — đủ sức: hậu kỳ đầy đủ, bóng đổ nét, cỏ dày.
//   medium — mặc định cho máy tính: giữ hình ảnh và cỏ nhưng bỏ AO, giảm bóng và độ phân giải.
//   low    — máy yếu / điện thoại: tắt hậu kỳ, tắt vân chất liệu, thưa cây.
// Phím P để đổi, nhớ theo trình duyệt. Ngoài ra còn tự hạ cấp khi khung hình tụt (xem `degrade`).

export type Quality = "high" | "medium" | "low";
const KEY = "tentides.quality";

function initial(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "high" || saved === "medium" || saved === "low") return saved;
  } catch {
    // Không đọc được thì đoán theo máy.
  }
  // Máy ít nhân hoặc màn hình cảm ứng (thường là điện thoại) thì mặc định chạy nhẹ.
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
  if (weak) return "low";
  // Máy tính để mặc định "medium": trước đây mọi laptop iGPU (Iris Xe…) chạy "high" với
  // dpr 2 + 7 lớp hậu kỳ + bóng đổ 4096², tức gần như chắc chắn tụt khung hình.
  // "high" giờ là lựa chọn có chủ đích (phím P) thay vì mặc định.
  return "medium";
}

let quality: Quality = initial();
let locked = false;
const listeners = new Set<() => void>();

export function setQuality(next: Quality) {
  if (next === quality) return;
  quality = next;
  // Người chơi tự bấm đổi thì không còn tự hạ cấp nữa, tránh cưỡng chế họ.
  locked = true;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  listeners.forEach((l) => l());
}

export function toggleQuality() {
  setQuality(quality === "high" ? "medium" : quality === "medium" ? "low" : "high");
}

/**
 * Hạ một bậc khi khung hình tụt kéo dài. Chỉ xuống, không lên, và dừng hẳn nếu người chơi đã
 * tự chọn mức (xem `locked`).
 */
export function degrade() {
  if (locked) return;
  if (quality === "high") setQuality("medium");
  else if (quality === "medium") setQuality("low");
  else locked = true;
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
