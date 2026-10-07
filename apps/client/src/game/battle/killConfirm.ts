import type { HitMessage } from "@tentides/protocol";
import { playKillConfirm, playStreakStinger } from "../sound/guns.ts";
import { newStreak, registerKill, resetLife, type Callout } from "./killStreak.ts";
import { SNIPER_KILL_STOP, gun, stopHit } from "./runtime.ts";

// Phản hồi hạ gục ở máy người bắn: tiếng xác nhận (chuông kim loại khi trúng đầu), đầu lâu nảy dưới tâm ngắm,
// thông báo chuỗi hạ (DOUBLE KILL...) và cú khựng hình cho phát hạ của súng khóa nòng. Chỉ chạy khi server báo
// Messages.hit kind "kill" (server quyết định có hạ hay không), nên không bao giờ kêu nhầm.

/** Đầu lâu còn hiện chừng này (ms) sau lần hạ cuối; hạ liên tiếp thì cả dãy ở lại lâu hơn. */
export const SKULL_MS = 1600;
/** Thông báo chuỗi hạ hiện chừng này (ms). */
export const SHOUT_MS = 2300;
/** Số đầu lâu tối đa trong dãy. */
const MAX_SKULLS = 5;

export interface Skull {
  id: number;
  head: boolean;
}

export interface KillFeedback {
  /** Dãy đầu lâu đang hiện và mốc lần hạ cuối (ms). */
  skulls: Skull[];
  lastAt: number;
  shout: { id: number; at: number; callout: Callout } | null;
}

let feedback: KillFeedback = { skulls: [], lastAt: 0, shout: null };
let streak = newStreak();
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function getKillFeedback(): KillFeedback {
  return feedback;
}

export function subscribeKillFeedback(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  listeners.forEach((l) => l());
}

/** Hẹn dọn dãy đầu lâu / thông báo khi hết giờ (một hẹn giờ duy nhất). */
function scheduleClear() {
  if (timer) clearTimeout(timer);
  const now = performance.now();
  const ends = [feedback.skulls.length ? feedback.lastAt + SKULL_MS : Infinity, feedback.shout ? feedback.shout.at + SHOUT_MS : Infinity];
  const next = Math.min(...ends);
  if (next === Infinity) return;
  timer = setTimeout(() => {
    timer = null;
    const t = performance.now();
    const skulls = feedback.skulls.length && t - feedback.lastAt >= SKULL_MS ? [] : feedback.skulls;
    const shout = feedback.shout && t - feedback.shout.at >= SHOUT_MS ? null : feedback.shout;
    if (skulls !== feedback.skulls || shout !== feedback.shout) {
      feedback = { ...feedback, skulls, shout };
      emit();
    }
    scheduleClear();
  }, Math.max(16, next - now + 5));
}

/** Server xác nhận hạ gục (Messages.hit kind "kill"). */
export function confirmKill(h: HitMessage) {
  const now = performance.now();
  playKillConfirm(h.head === 1);
  // Phá nổ xe: `crew` là số người chết theo (xe trống thì không tính mạng, chỉ có tiếng).
  const n = h.crew ?? 1;
  // Khựng hình chỉ cho phát hạ của súng khóa nòng vừa bắn (không phải lựu đạn ném khi đang cầm súng tỉa).
  if (h.crew === undefined && SNIPER_KILL_STOP.weapons.includes(gun.weapon) && now - gun.lastShot < 1500) stopHit(SNIPER_KILL_STOP.ms, SNIPER_KILL_STOP.scale);
  if (n <= 0) return;
  const r = registerKill(streak, now, n);
  streak = r.state;
  // Dãy đầu lâu: hạ tiếp khi dãy cũ còn hiện thì xếp thêm, không thì bắt đầu dãy mới.
  const keep = now - feedback.lastAt < SKULL_MS ? feedback.skulls : [];
  const added: Skull[] = [];
  for (let i = 0; i < Math.min(n, MAX_SKULLS); i++) added.push({ id: nextId++, head: h.head === 1 });
  const skulls = [...keep, ...added].slice(-MAX_SKULLS);
  let shout = feedback.shout;
  if (r.callout) {
    shout = { id: nextId++, at: now, callout: r.callout };
    playStreakStinger(r.callout.tier);
  }
  feedback = { skulls, lastAt: now, shout };
  emit();
  scheduleClear();
}

/** Mình gục (hay rời trận): mất chuỗi hạ trong mạng, dọn màn hình. */
export function resetKillStreak() {
  streak = resetLife(streak);
  if (!feedback.skulls.length && !feedback.shout) return;
  feedback = { skulls: [], lastAt: 0, shout: null };
  emit();
}
