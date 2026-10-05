import { useSyncExternalStore } from "react";

// Cài đặt giọng nói, nhớ theo trình duyệt: bật/tắt, giữ phím để nói hay mở micro luôn, phím nói thường và phím bộ
// đàm (đổi được trong bảng Cài đặt), âm lượng giọng người khác, danh sách người đã tắt tiếng.

export interface VoiceSettings {
  /** Tắt hẳn: không nối với ai, không nghe ai. */
  enabled: boolean;
  /** Mở micro luôn (tự phát khi có tiếng nói); tắt thì phải giữ phím để nói. */
  openMic: boolean;
  /** Mã phím (KeyboardEvent.code) giữ để nói với người xung quanh. */
  pttKey: string;
  /** Mã phím giữ để nói qua bộ đàm với đồng đội (nghe được ở mọi nơi). */
  radioKey: string;
  /** Âm lượng giọng người khác (0–1.5). */
  volume: number;
  /** Id những người đã tắt tiếng. */
  muted: string[];
}

const KEY = "tentides.voice";
// T là đổi góc nhìn, B là cửa hàng, V đâm dao: dùng ` (dưới Esc) để nói và U cho bộ đàm, đều chưa phím nào dùng.
export const DEFAULT_VOICE: VoiceSettings = { enabled: true, openMic: false, pttKey: "KeyL", radioKey: "KeyU", volume: 1, muted: [] };

function load(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<VoiceSettings>;
      return { ...DEFAULT_VOICE, ...saved, muted: Array.isArray(saved.muted) ? saved.muted.filter((m) => typeof m === "string").slice(0, 200) : [] };
    }
  } catch {
    // Không đọc được thì dùng mặc định.
  }
  return { ...DEFAULT_VOICE };
}

let current: VoiceSettings = load();
const listeners = new Set<() => void>();

export function getVoiceSettings(): VoiceSettings {
  return current;
}

export function setVoiceSettings(patch: Partial<VoiceSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  listeners.forEach((l) => l());
}

export function subscribeVoiceSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribeVoiceSettings, () => current);
}

export function toggleMuted(id: string) {
  const muted = current.muted.includes(id) ? current.muted.filter((m) => m !== id) : [...current.muted, id];
  setVoiceSettings({ muted });
}

/** Tên phím dễ đọc từ KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = { Backquote: "`", CapsLock: "Caps Lock", AltLeft: "Alt trái", AltRight: "Alt phải", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" };
  return named[code] ?? code;
}
