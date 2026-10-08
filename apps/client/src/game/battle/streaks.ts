import { MINIGUN, TOW, minigunRpm, type WeaponDef } from "@tentides/content";
import type { IslandState } from "@tentides/protocol";
import { playMinigunSpin } from "../sound/streaks.ts";

// Chi viện chiến thuật trên máy mình: nhịp quay nòng Minigun (Shooter hỏi tốc độ bắn mỗi khung hình), lúc vừa phóng
// tên lửa TOW (StreakWorld gửi lệnh lái khi còn giữ chuột), UAV phe mình có đang bay không (bản đồ nhỏ hiện địch).

/** Phím mở bảng chi viện (K: trong trận không dùng; chế độ cốt truyện dùng K cho việc khác nhưng không chạy cùng lúc). */
export const STREAK_KEY = "KeyK";
export const STREAK_KEY_LABEL = "K";

const spin = { last: -Infinity, start: 0, burst: 0 };

/**
 * Tốc độ bắn (phát/phút) của khẩu đang cầm ở khung hình này: súng thường giữ nguyên; Minigun phải quay nòng
 * MINIGUN.spinup ms (trả về 0: chưa bắn được), rồi bắn chậm và tăng dần như server kiểm tra (minigunRpm). Shooter chỉ
 * gọi khi đang giữ cò, nên ngừng gọi lâu hơn ngưỡng là nòng đã dừng.
 */
export function streakRpm(def: WeaponDef, now: number): number {
  if (def.id !== "minigun") return def.rpm;
  // Ngưỡng dừng nòng ở máy mình ngắn hơn server một chút: lệch thì máy mình bắn chậm hơn chứ không bị server từ chối.
  if (now - spin.last > MINIGUN.idle * 0.8) {
    spin.start = now;
    spin.burst = 0;
    playMinigunSpin(MINIGUN.spinup);
  }
  spin.last = now;
  if (now - spin.start < MINIGUN.spinup) return 0;
  return minigunRpm(def.rpm, spin.burst ? now - spin.burst : 0);
}

/** Lúc mình vừa phóng tên lửa TOW (performance.now, ms); 0 là chưa. */
export const towLaunch = { at: 0 };

/** Shooter báo vừa bắn một phát: ghi đầu loạt Minigun, lúc phóng TOW. */
export function noteStreakShot(def: WeaponDef, now: number) {
  if (def.id === "minigun" && !spin.burst) spin.burst = now;
  if (def.id === "tow") towLaunch.at = now;
}

/** Tên lửa TOW của mình có thể còn đang bay không (để gửi lệnh lái). */
export function towFlying(now: number): boolean {
  return towLaunch.at > 0 && now - towLaunch.at < TOW.life * 1000 + 200;
}

/** Phe (hay đội) của người `me` theo cách server tính UAV: đội, không đội thì chính mình. */
export function sideOf(s: IslandState, me: string): string {
  return s.players.get(me)?.team || me;
}

/** UAV của phe mình đang bay: còn bao nhiêu giây (0 là không có). */
export function uavLeft(s: IslandState, me: string): number {
  const side = sideOf(s, me);
  let left = 0;
  for (const t of s.traps.values()) if (t.defId === "uav" && t.team === side) left = Math.max(left, t.hp);
  return left;
}
