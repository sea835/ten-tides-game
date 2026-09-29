import { MAP_HALF_SIZE, heightAt as islandHeightAt } from "@tentides/content";
import { MAX_RUN_SPEED, MAX_SPEED_BOOST, type MoveMessage } from "@tentides/protocol";

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
 */
export function isPlausibleMove(
  from: Position,
  to: MoveMessage,
  elapsedMs: number,
  ground: (x: number, z: number) => number = islandHeightAt,
): boolean {
  if (Math.abs(to.x) > MAP_HALF_SIZE || Math.abs(to.z) > MAP_HALF_SIZE) return false;
  if (to.y < ground(to.x, to.z) - 2) return false;

  const seconds = Math.max(elapsedMs, MIN_WINDOW_MS) / 1000;
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z);
  return horizontal <= MAX_RUN_SPEED * MAX_SPEED_BOOST * SPEED_TOLERANCE * seconds;
}
