import type { BattleMap } from "./battle.ts";
import { makeRand, subSeed } from "./worldgen.ts";

// Trạm tiếp tế của Sinh tồn / Đồng đội: cửa hàng (B) chỉ mở ở đâu cũng được trong lúc chuẩn bị (pha "prep"); vào trận
// rồi thì phải đứng gần một trạm tiếp tế hay một thùng thính đã chạm đất mới mua được. Có vậy nhặt đồ mới đáng giá,
// và trạm thành chỗ tranh chấp. Kho vũ khí luôn là một trạm; thêm vài trạm ở các khu khác bốc theo seed bản đồ (mọi
// máy cùng seed thấy cùng chỗ: server kiểm tra, client vẽ lên bản đồ). Chiến trường, hải chiến không dùng trạm.

export const SUPPLY = {
  /** Đứng trong bán kính này (m, tính theo mặt phẳng) quanh trạm, hay quanh thùng thính đã chạm đất, thì mua được. */
  radius: 30,
  /** Số trạm thêm ngoài Kho vũ khí (bốc ngẫu nhiên theo seed trong các khu thành phố, cảng, pháo đài, làng). */
  extra: 3,
};

/**
 * Tiền thưởng mỗi mạng hạ gục ở Sinh tồn / Đồng đội (chiến trường giữ KILL_REWARD). Hạ xuống từ 800: mua sắm giờ
 * phải đi tới trạm, nên tiền chỉ để bù đồ — một mạng đủ thay giáp cấp 1 cùng mũ (700$), hai mạng đủ giáp cấp 2 kèm
 * đạn; muốn khẩu súng trường mới (~2700$) phải hạ 5–6 mạng, còn lại thì nhặt đồ của người gục.
 */
export const BR_KILL_REWARD = 500;

export interface SupplyStation {
  id: string;
  name: string;
  x: number;
  z: number;
}

/** Chế độ nào bị giới hạn mua theo trạm tiếp tế. */
export function supplyLimited(mode: string): boolean {
  return mode === "solo" || mode === "squad" || mode === "";
}

const cache = new WeakMap<BattleMap, Map<number, SupplyStation[]>>();

/** Các trạm tiếp tế của bản đồ đảo (bản đồ chiến trường, hải chiến: không có). */
export function supplyStations(map: BattleMap, seed: number): SupplyStation[] {
  if (map.layout === "war" || map.war) return [];
  let bySeed = cache.get(map);
  const hit = bySeed?.get(seed);
  if (hit) return hit;
  const rand = makeRand(subSeed(seed, "supply"));
  const station = (s: { id: string; name: string; x: number; z: number }): SupplyStation => ({ id: s.id, name: `Trạm tiếp tế · ${s.name}`, x: s.x, z: s.z });
  const out: SupplyStation[] = map.sites.filter((s) => s.kind === "armory").map(station);
  const pool = map.sites.filter((s) => s.kind === "city" || s.kind === "port" || s.kind === "fortress" || s.kind === "village");
  for (let k = 0; k < SUPPLY.extra && pool.length; k++) out.push(station(pool.splice(Math.floor(rand() * pool.length), 1)[0]!));
  if (!bySeed) cache.set(map, (bySeed = new Map()));
  bySeed.set(seed, out);
  return out;
}

/** Trạm (hay điểm tiếp tế khác, vd. thùng thính) gần (x, z) nhất và khoảng cách tới nó; null nếu không có điểm nào. */
export function nearestSupply(points: readonly { x: number; z: number }[], x: number, z: number): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (!best || d < best.d) best = { x: p.x, z: p.z, d };
  }
  return best;
}
