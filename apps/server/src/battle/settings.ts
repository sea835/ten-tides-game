import {
  MAX_BATTLE_BOTS,
  MIN_BATTLE_BOTS,
  WAR_MAX_PER_SIDE,
  WAR_TICKETS_DEFAULT,
  WAR_TICKETS_MAX,
  WAR_TICKETS_MIN,
  type BattleSettingsMessage,
  type IslandState,
} from "@tentides/protocol";
import { warMapId } from "@tentides/content";

// Bảng cài đặt phòng (Trung tâm chỉ huy ở sảnh): kẹp số máy theo chế độ, vé quân, bật / tắt xe cơ giới, thời tiết.
// Chỉ chủ phòng gửi được và chỉ khi còn ở sảnh (BattleRoom kiểm tra); ở đây chỉ lo đưa giá trị về khoảng hợp lệ.

export type BattleMode = "solo" | "squad" | "war";

/** Khoảng số máy hợp lệ của mỗi chế độ (chiến trường tính mỗi phe: 5–50, tức 10–100 quân trên sân). */
export function botRange(mode: string): { min: number; max: number } {
  if (mode === "war") return { min: MIN_BATTLE_BOTS / 2, max: WAR_MAX_PER_SIDE };
  return { min: MIN_BATTLE_BOTS, max: MAX_BATTLE_BOTS };
}

export function clampBots(mode: string, n: number): number {
  const { min, max } = botRange(mode);
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));
}

export function clampTickets(n: number): number {
  if (!Number.isFinite(n)) return WAR_TICKETS_DEFAULT;
  return Math.max(WAR_TICKETS_MIN, Math.min(WAR_TICKETS_MAX, Math.round(n)));
}

/** Số máy mặc định của sinh tồn / đồng đội (phòng mới tạo, hay vừa rời chiến trường). */
export const DEFAULT_BOTS = 20;

/**
 * Đổi chế độ thì số máy về mặc định của chế độ mới: vào chiến trường là đủ 50 vs 50 (chủ phòng hạ xuống được), rời
 * chiến trường thì về 20 máy (mỗi phe 50 mà nhân đôi thành 100 máy trên đảo sinh tồn thì quá đông). Giữa sinh tồn và
 * đồng đội thì giữ nguyên.
 */
export function convertBots(from: string, to: string, n: number): number {
  if (from === to) return clampBots(to, n);
  if (to === "war") return WAR_MAX_PER_SIDE;
  if (from === "war") return clampBots(to, DEFAULT_BOTS);
  return clampBots(to, n);
}

/**
 * Áp các cài đặt (trừ đổi chế độ: BattleRoom dựng lại bản đồ, chia phe rồi gọi `onModeChanged`). Trả về chế độ mới
 * nếu chủ phòng đổi chế độ.
 */
export function applyBattleSettings(state: IslandState, s: BattleSettingsMessage): BattleMode | null {
  let changed: BattleMode | null = null;
  if (s.mode !== undefined && s.mode !== state.battleMode) {
    state.bots = convertBots(state.battleMode, s.mode, state.bots);
    state.battleMode = s.mode;
    changed = s.mode;
  }
  if (s.bots !== undefined) state.bots = clampBots(state.battleMode, s.bots);
  if (s.tickets !== undefined) state.settings.warTickets = clampTickets(s.tickets);
  if (s.vehicles !== undefined) state.settings.vehiclesEnabled = s.vehicles;
  if (s.weather !== undefined) state.settings.weatherPick = s.weather;
  if (s.time !== undefined) state.settings.timePick = s.time;
  if (s.map !== undefined) state.settings.warMap = warMapId(s.map);
  return changed;
}
