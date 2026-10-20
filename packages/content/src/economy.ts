import { GACHA, RARITY, SKIN, SKIN_RARITIES, type PityState, type SkinRarity } from "./skins.ts";

// Kinh tế xu và mảnh dùng chung server, client: mảnh skin (skin trùng đổi ra mảnh, mảnh đổi lấy skin chọn sẵn),
// tỷ lệ gacha thực tế khi tính cả bảo hiểm, giới hạn xu mỗi ngày từ trận đấu, giảm xu phòng một người với máy,
// mốc ngày / tuần (giờ Việt Nam) cho giới hạn xu và thử thách. Toàn hàm thuần để test không cần database.

// ---------------------------------------------------------------------------- mảnh skin

/**
 * Quay ra skin đã có: được chừng này mảnh theo độ hiếm. Đổi một skin chọn sẵn tốn đúng 8 lần số mảnh một bản trùng
 * cùng độ hiếm ("8 bản trùng đổi 1 skin mình thích"), nên mọi độ hiếm cùng một nhịp.
 *
 * Cân đối: một lượt quay (100 xu, quay 10 là 90 xu) khi kho đã đủ hết thì trung bình ra
 * 0,6×5 + 0,28×15 + 0,095×50 + 0,025×150 ≈ 15,7 mảnh. Đổi một Huyền thoại 1200 mảnh ≈ 76 lượt trùng, đắt hơn
 * bảo hiểm 60 lượt: muốn "một Huyền thoại bất kỳ" thì quay vẫn lợi hơn, mảnh chỉ để chọn đúng skin mình muốn
 * (và để trùng không còn vô dụng). Sử thi 400 ≈ 25 lượt, Hiếm 120 ≈ 8 lượt, Thường 40 ≈ 2,5 lượt.
 */
export const SHARDS = {
  dupe: { common: 5, rare: 15, epic: 50, legendary: 150 } satisfies Record<SkinRarity, number>,
  craft: { common: 40, rare: 120, epic: 400, legendary: 1200 } satisfies Record<SkinRarity, number>,
} as const;

/** Số mảnh nhận được khi quay ra một skin. `countAfter`: số bản đang có sau lượt quay này (1 là skin mới, không có mảnh). */
export function dupeShards(rarity: SkinRarity, countAfter: number): number {
  return countAfter > 1 ? SHARDS.dupe[rarity] : 0;
}

/** Giá đổi mảnh của một skin (null nếu không có skin này). */
export function craftCost(skinId: string): number | null {
  const s = SKIN.get(skinId);
  return s ? SHARDS.craft[s.rarity] : null;
}

export type CraftCheck = { ok: true; cost: number } | { ok: false; code: "unknown_skin" | "owned" | "not_enough_shards"; reason: string };

/** Đổi mảnh lấy skin được không: skin phải có thật, chưa có trong kho, đủ mảnh. */
export function checkCraft(skinId: string, ownedCount: number, shards: number): CraftCheck {
  const cost = craftCost(skinId);
  if (cost === null) return { ok: false, code: "unknown_skin", reason: "Không có skin này." };
  if (ownedCount > 0) return { ok: false, code: "owned", reason: "Bạn đã có skin này rồi." };
  if (shards < cost) return { ok: false, code: "not_enough_shards", reason: `Không đủ mảnh (cần ${cost}).` };
  return { ok: true, cost };
}

/** Tổng số mảnh quy đổi từ những bản trùng đang có (count − 1 mỗi skin): dùng một lần lúc chuyển kho cũ sang mảnh. */
export function shardsForDuplicates(skins: readonly { skinId: string; count: number }[]): number {
  let total = 0;
  for (const s of skins) {
    const def = SKIN.get(s.skinId);
    if (def && s.count > 1) total += (s.count - 1) * SHARDS.dupe[def.rarity];
  }
  return total;
}

// ---------------------------------------------------------------------------- tỷ lệ gacha có bảo hiểm

type Odds = Record<SkinRarity, number>;

const BASE_TOTAL = SKIN_RARITIES.reduce((sum, r) => sum + RARITY[r].weight, 0);

/** Tỷ lệ (0–1) từng độ hiếm của lượt quay kế tiếp, với bộ đếm bảo hiểm hiện tại (đúng luật của rollOnce). */
export function nextRollOdds(pity: PityState): Odds {
  const out: Odds = { common: 0, rare: 0, epic: 0, legendary: 0 };
  if (pity.sinceLegendary + 1 >= GACHA.legendaryPity) {
    out.legendary = 1;
    return out;
  }
  if (pity.sinceEpic + 1 >= GACHA.epicPity) {
    const t = RARITY.epic.weight + RARITY.legendary.weight;
    out.epic = RARITY.epic.weight / t;
    out.legendary = RARITY.legendary.weight / t;
    return out;
  }
  for (const r of SKIN_RARITIES) out[r] = RARITY[r].weight / BASE_TOTAL;
  return out;
}

let effective: Odds | null = null;

/**
 * Tỷ lệ thực tế lâu dài (0–1) khi tính cả bảo hiểm: trung bình mỗi lượt trên rất nhiều lượt quay. Tính đúng (không
 * mô phỏng) theo chu kỳ: mỗi lần ra Huyền thoại thì bộ đếm về đầu, nên lượt quay chia thành các chu kỳ giống hệt nhau,
 * dài tối đa 60 lượt. Tỷ lệ mỗi độ hiếm = số lần ra trung bình trong một chu kỳ / độ dài trung bình của chu kỳ.
 * Tính một lần rồi nhớ.
 */
export function effectiveOdds(): Odds {
  if (effective) return effective;
  const E = GACHA.epicPity;
  // Lượt thứ l của chu kỳ (bộ đếm huyền thoại = l): xác suất đang ở từng giá trị bộ đếm sử thi.
  let dist = new Float64Array(E);
  dist[0] = 1;
  const acc: Odds = { common: 0, rare: 0, epic: 0, legendary: 0 };
  let rolls = 0;
  for (let l = 0; l < GACHA.legendaryPity; l++) {
    const next = new Float64Array(E);
    for (let e = 0; e < E; e++) {
      const p = dist[e]!;
      if (!p) continue;
      const o = nextRollOdds({ sinceEpic: e, sinceLegendary: l });
      rolls += p;
      for (const r of SKIN_RARITIES) acc[r] += p * o[r];
      // Thường, Hiếm: bộ đếm sử thi tăng; Sử thi: về 0; Huyền thoại: hết chu kỳ.
      if (e + 1 < E) next[e + 1] = next[e + 1]! + p * (o.common + o.rare);
      next[0] = next[0]! + p * o.epic;
    }
    dist = next;
  }
  effective = { common: acc.common / rolls, rare: acc.rare / rolls, epic: acc.epic / rolls, legendary: acc.legendary / rolls };
  return effective;
}

// ---------------------------------------------------------------------------- xu sau trận

export const COIN_RULES = {
  /** Xu tối đa nhận từ trận đấu mỗi ngày (giờ Việt Nam). Thưởng thử thách không tính vào đây. */
  dailyCap: 1500,
  /** Phòng chỉ có một người thật (còn lại là máy): nhận chừng này phần xu trận. */
  soloFactor: 0.6,
} as const;

/** Hệ số xu theo số người thật trong trận: một mình với máy thì giảm (chống cày xu phòng riêng), từ hai người là đủ. */
export function humanFactor(humans: number): number {
  return humans <= 1 ? COIN_RULES.soloFactor : 1;
}

/**
 * Áp giới hạn xu mỗi ngày: `earned` xu của trận này, `today` xu từ trận đã nhận hôm nay. Trả về số xu thực nhận và
 * có chạm trần không (đã chạm trần từ trước cũng tính là chạm).
 */
export function capDailyCoins(earned: number, today: number, cap: number = COIN_RULES.dailyCap): { granted: number; capped: boolean } {
  const want = Math.max(0, Math.floor(earned));
  const room = Math.max(0, cap - Math.max(0, Math.floor(today)));
  const granted = Math.min(want, room);
  return { granted, capped: want > granted || room === 0 };
}

// ---------------------------------------------------------------------------- mốc ngày, tuần (giờ Việt Nam)

/** Ngày, tuần mới bắt đầu lúc 0 giờ giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export const RESET_TZ_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Mã ngày "YYYY-MM-DD" theo giờ Việt Nam. */
export function dayKey(now: number = Date.now()): string {
  return ymd(now + RESET_TZ_OFFSET_MS);
}

/** Mã tuần: ngày thứ Hai đầu tuần "YYYY-MM-DD" theo giờ Việt Nam (tuần từ thứ Hai tới Chủ nhật). */
export function weekKey(now: number = Date.now()): string {
  const local = now + RESET_TZ_OFFSET_MS;
  const dow = (new Date(local).getUTCDay() + 6) % 7; // 0 = thứ Hai
  return ymd(local - dow * DAY_MS);
}

/** Thời điểm (ms, UTC) ngày / tuần hiện tại kết thúc. */
export function periodEndsAt(period: "daily" | "weekly", now: number = Date.now()): number {
  const key = period === "daily" ? dayKey(now) : weekKey(now);
  const start = Date.parse(`${key}T00:00:00Z`) - RESET_TZ_OFFSET_MS;
  return start + (period === "daily" ? DAY_MS : 7 * DAY_MS);
}
