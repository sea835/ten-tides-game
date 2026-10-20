import { useSyncExternalStore } from "react";

// Bắt lỗi toàn cục (window.onerror, unhandledrejection): ghi ra console, và khi lỗi lặp đi lặp lại thì hiện một thông
// báo nhỏ không chặn thao tác (ErrorToast). Một lỗi lẻ không làm phiền người chơi.

/** Số lỗi trong cửa sổ thời gian thì coi là lặp lại. */
export const REPEAT_COUNT = 3;
export const REPEAT_WINDOW_MS = 15_000;
/** Báo xong thì im lặng chừng này, khỏi báo liên tục khi lỗi lặp mỗi khung hình. */
export const TOAST_COOLDOWN_MS = 30_000;

/** Thêm một lỗi vào danh sách thời điểm, bỏ các lỗi quá cũ. */
export function pushError(times: readonly number[], now: number, windowMs = REPEAT_WINDOW_MS): number[] {
  return [...times.filter((t) => now - t <= windowMs), now];
}

/** Lỗi có lặp lại đủ để báo người chơi không. */
export function isRepeated(times: readonly number[], min = REPEAT_COUNT): boolean {
  return times.length >= min;
}

/** Lỗi vô hại của trình duyệt, không đáng báo. */
export function isBenign(message: string): boolean {
  return /ResizeObserver loop|Script error\.?$|AbortError|The play\(\) request was interrupted/i.test(message);
}

export interface ErrorToastState {
  text: string;
  at: number;
}

let toast: ErrorToastState | null = null;
const listeners = new Set<() => void>();

function setToast(t: ErrorToastState | null) {
  toast = t;
  listeners.forEach((l) => l());
}

export function dismissErrorToast() {
  setToast(null);
}

export function useErrorToast(): ErrorToastState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toast,
  );
}

let times: number[] = [];
let lastToastAt = -Infinity;

/** Ghi nhận một lỗi (từ hook toàn cục hay ErrorBoundary). Trả về true nếu vừa hiện thông báo. */
export function reportError(kind: string, error: unknown, now = Date.now()): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (isBenign(message)) return false;
  console.error(`[${kind}]`, error);
  times = pushError(times, now);
  if (isRepeated(times) && now - lastToastAt > TOAST_COOLDOWN_MS) {
    lastToastAt = now;
    setToast({ text: "Game gặp lỗi lặp lại. Nếu hình đứng hay điều khiển lạ, hãy tải lại trang.", at: now });
    return true;
  }
  return false;
}

/** Gắn hook lỗi toàn cục một lần; trả về hàm gỡ. */
export function installErrorHooks(): () => void {
  const onError = (e: ErrorEvent) => void reportError("error", e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => void reportError("unhandledrejection", e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Chỉ để kiểm thử: xoá bộ nhớ lỗi. */
export function resetErrorState() {
  times = [];
  lastToastAt = -Infinity;
  setToast(null);
}
