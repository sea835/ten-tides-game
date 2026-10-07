import { MAP_HALF_SIZE, heightAt as islandHeightAt } from "@tentides/content";
import { GAIT, MAX_RUN_SPEED, MAX_SPEED_BOOST, type MoveMessage } from "@tentides/protocol";

export interface Position {
  x: number;
  y: number;
  z: number;
}

/** Sai số cho phép: độ trễ mạng làm các gói đến dồn cục. */
const SPEED_TOLERANCE = 1.5;
const MIN_WINDOW_MS = 100;

/**
 * Server không chạy vật lý; client tự di chuyển rồi báo vị trí.
 * Server chỉ nhận vị trí nếu nó hợp lý: không vượt tốc độ chạy (tính cả đà trượt và nhảy thỏ), không ra ngoài map,
 * không chui xuống dưới mặt đất (hay đáy biển) quá sâu.
 * `ground` là độ cao địa hình của thế giới đang chơi (có đảo nhỏ, hang, hầm theo seed).
 * `boost`: hệ số tốc độ thêm (bơm Adrenaline của lính Đột Kích: 1,25).
 */
export function isPlausibleMove(
  from: Position,
  to: MoveMessage,
  elapsedMs: number,
  ground: (x: number, z: number) => number = islandHeightAt,
  half: number = MAP_HALF_SIZE,
  boost = 1,
): boolean {
  if (Math.abs(to.x) > half || Math.abs(to.z) > half) return false;
  if (to.y < ground(to.x, to.z) - 2) return false;

  const seconds = Math.max(elapsedMs, MIN_WINDOW_MS) / 1000;
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z);
  return horizontal <= MAX_RUN_SPEED * MAX_SPEED_BOOST * SPEED_TOLERANCE * Math.max(1, boost) * seconds;
}

/**
 * Dáng di chuyển nhất thời client báo lên (trượt, lao người, trên không — chỉ để máy khác diễn lại): bỏ bit lạ, lao
 * người mà không nằm sấp thì không tính (lao người luôn kết thúc ở tư thế nằm, hộp trúng đạn là hộp nằm).
 */
export function sanitizeGait(gait: number, prone: boolean): number {
  const g = gait & (GAIT.kind | GAIT.air);
  const kind = g & GAIT.kind;
  if (kind === GAIT.kind || (kind === GAIT.dive && !prone)) return g & GAIT.air;
  return g;
}
