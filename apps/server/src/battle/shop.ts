import { SUPPLY, nearestSupply, supplyLimited, supplyStations, type BattleMap } from "@tentides/content";
import type { IslandState } from "@tentides/protocol";

// Luật cửa hàng theo chỗ đứng (content/supply.ts): Sinh tồn / Đồng đội chỉ mua được ở đâu cũng được lúc chuẩn bị, vào
// trận rồi thì phải đứng gần trạm tiếp tế hay thùng thính đã chạm đất. Sảnh, chiến trường, hải chiến: mua tự do như cũ.

/** Các điểm mua được giữa trận: trạm tiếp tế của bản đồ và thùng thính đã chạm đất. */
export function shopPoints(state: IslandState, map: BattleMap): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = supplyStations(map, state.worldSeed);
  const drops = [...state.airdrops.values()].filter((a) => a.landed).map((a) => ({ x: a.x, z: a.z }));
  return drops.length ? [...pts, ...drops] : pts;
}

/**
 * Người đứng ở (x, z) mua được không. Không được thì kèm lý do (có khoảng cách tới điểm mua gần nhất) để báo lại cho
 * người chơi.
 */
export function shopCheck(state: IslandState, map: BattleMap, x: number, z: number): { ok: true } | { ok: false; reason: string } {
  if (!supplyLimited(state.battleMode) || state.phase !== "battle") return { ok: true };
  const near = nearestSupply(shopPoints(state, map), x, z);
  if (near && near.d <= SUPPLY.radius) return { ok: true };
  return { ok: false, reason: near ? `Đến trạm tiếp tế để mua (gần nhất cách ${Math.round(near.d)} m).` : "Đến trạm tiếp tế để mua." };
}
