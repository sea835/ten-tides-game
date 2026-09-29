import { useSyncExternalStore } from "react";

// Hai góc nhìn: "third" là camera sau lưng nhân vật (mặc định), "first" là nhìn bằng mắt nhân vật.
// Phím T (hay nút "Góc nhìn" trên điện thoại) để đổi, nhớ theo trình duyệt.

export type CameraView = "third" | "first";
const KEY = "tentides.camera";

function initial(): CameraView {
  try {
    return localStorage.getItem(KEY) === "first" ? "first" : "third";
  } catch {
    return "third";
  }
}

let view: CameraView = initial();
const listeners = new Set<() => void>();

export function getCameraView(): CameraView {
  return view;
}

export function toggleCameraView() {
  view = view === "third" ? "first" : "third";
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  listeners.forEach((l) => l());
}

export function useCameraView(): CameraView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
  );
}

/**
 * Giới hạn góc ngẩng cúi. Góc thứ ba: pitch là độ cao camera sau lưng (không chui xuống đất).
 * Góc thứ nhất: pitch là góc cúi đầu, ngẩng lên nhìn trời được.
 */
export function clampPitch(pitch: number): number {
  if (view === "first" || cameraMode.battle) return Math.min(1.35, Math.max(-1.35, pitch));
  return Math.min(1.2, Math.max(-0.2, pitch));
}

/**
 * Battleground: camera góc thứ ba đặt qua vai, ngắm được cả lên trời lẫn xuống đất (pitch âm là camera hạ thấp,
 * nhìn lên). Game.tsx bật tắt theo chế độ phòng.
 */
export const cameraMode = { battle: false };

/** Góc ngắm lên xuống cho đòn đánh, cú ném: góc thứ ba ngắm ngang ở pitch 0,35; góc thứ nhất ngắm đúng chỗ đang nhìn. */
export function aimPitchFrom(pitch: number): number {
  return Math.max(-0.6, Math.min(0.9, view === "first" ? -pitch : 0.35 - pitch));
}
