import { describe, expect, it } from "vitest";
import { makeRand } from "./worldgen.ts";
import { GACHA, RARITY, SKINS, SKIN_RARITIES, rollSkins, type SkinRarity } from "./skins.ts";
import {
  COIN_RULES,
  SHARDS,
  capDailyCoins,
  checkCraft,
  craftCost,
  dayKey,
  dupeShards,
  effectiveOdds,
  humanFactor,
  nextRollOdds,
  periodEndsAt,
  shardsForDuplicates,
  weekKey,
} from "./economy.ts";

describe("mảnh skin", () => {
  it("skin mới không ra mảnh, skin trùng ra mảnh theo độ hiếm", () => {
    expect(dupeShards("legendary", 1)).toBe(0);
    expect(dupeShards("common", 2)).toBe(SHARDS.dupe.common);
    expect(dupeShards("rare", 5)).toBe(SHARDS.dupe.rare);
    expect(dupeShards("epic", 2)).toBe(50);
    expect(dupeShards("legendary", 3)).toBe(150);
  });

  it("đổi một skin tốn đúng 8 bản trùng cùng độ hiếm, hiếm hơn thì đắt hơn", () => {
    for (const r of SKIN_RARITIES) expect(SHARDS.craft[r]).toBe(SHARDS.dupe[r] * 8);
    for (let i = 1; i < SKIN_RARITIES.length; i++) expect(SHARDS.craft[SKIN_RARITIES[i]!]).toBeGreaterThan(SHARDS.craft[SKIN_RARITIES[i - 1]!]);
    expect(craftCost("gold")).toBe(1200);
    expect(craftCost("tiger-stripe")).toBe(120);
    expect(craftCost("không-có")).toBeNull();
  });

  it("đổi Huyền thoại bằng mảnh đắt hơn quay tới bảo hiểm: mảnh để chọn đúng skin, không thay gacha", () => {
    // Mảnh trung bình mỗi lượt khi kho đã đủ (mọi lượt đều trùng), theo tỷ lệ gốc.
    const perRoll = SKIN_RARITIES.reduce((sum, r) => sum + (RARITY[r].weight / 100) * SHARDS.dupe[r], 0);
    expect(perRoll).toBeCloseTo(15.7, 1);
    expect(SHARDS.craft.legendary / perRoll).toBeGreaterThan(GACHA.legendaryPity);
  });

  it("đổi mảnh: phải có skin thật, chưa có trong kho, đủ mảnh", () => {
    expect(checkCraft("gold", 0, 1200)).toEqual({ ok: true, cost: 1200 });
    expect(checkCraft("gold", 0, 1199)).toMatchObject({ ok: false, code: "not_enough_shards" });
    expect(checkCraft("gold", 1, 99999)).toMatchObject({ ok: false, code: "owned" });
    expect(checkCraft("không-có", 0, 99999)).toMatchObject({ ok: false, code: "unknown_skin" });
    expect(checkCraft("desert-sand", 0, 40)).toEqual({ ok: true, cost: 40 });
  });

  it("đổi kho cũ: mỗi bản trùng (count − 1) ra mảnh theo độ hiếm, skin lạ bỏ qua", () => {
    expect(shardsForDuplicates([])).toBe(0);
    expect(
      shardsForDuplicates([
        { skinId: "gold", count: 3 },
        { skinId: "desert-sand", count: 1 },
        { skinId: "tiger-stripe", count: 2 },
        { skinId: "đã-bỏ", count: 9 },
      ]),
    ).toBe(2 * 150 + 15);
  });
});

describe("tỷ lệ gacha có bảo hiểm", () => {
  it("lượt kế tiếp: chưa chạm bảo hiểm là tỷ lệ gốc, chạm thì đổi đúng như rollOnce", () => {
    const base = nextRollOdds({ sinceEpic: 0, sinceLegendary: 0 });
    for (const r of SKIN_RARITIES) expect(base[r]).toBeCloseTo(RARITY[r].weight / 100, 10);
    const epicPity = nextRollOdds({ sinceEpic: GACHA.epicPity - 1, sinceLegendary: 3 });
    expect(epicPity.common + epicPity.rare).toBe(0);
    expect(epicPity.epic + epicPity.legendary).toBeCloseTo(1, 10);
    expect(epicPity.legendary).toBeCloseTo(2.5 / 12, 10);
    expect(nextRollOdds({ sinceEpic: 0, sinceLegendary: GACHA.legendaryPity - 1 }).legendary).toBe(1);
  });

  it("tỷ lệ thực tế cộng lại 100%, Sử thi+ và Huyền thoại cao hơn tỷ lệ gốc, khớp mô phỏng", () => {
    const odds = effectiveOdds();
    expect(SKIN_RARITIES.reduce((s, r) => s + odds[r], 0)).toBeCloseTo(1, 6);
    expect(odds.legendary).toBeGreaterThan(RARITY.legendary.weight / 100);
    expect(odds.epic + odds.legendary).toBeGreaterThan((RARITY.epic.weight + RARITY.legendary.weight) / 100);
    // Bảo hiểm chỉ đổi tỷ lệ Sử thi / Huyền thoại: Thường : Hiếm vẫn giữ đúng 60 : 28.
    expect(odds.common / odds.rare).toBeCloseTo(60 / 28, 6);
    // Đối chiếu với quay thật 200.000 lượt.
    const n = 200_000;
    const counts: Record<SkinRarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const r of rollSkins(n, { sinceEpic: 0, sinceLegendary: 0 }, makeRand(7)).results) counts[r.rarity]++;
    for (const r of SKIN_RARITIES) expect(counts[r] / n).toBeCloseTo(odds[r], 2);
  });
});

describe("xu sau trận: giới hạn ngày, phòng một người", () => {
  it("dưới giới hạn nhận đủ, chạm giới hạn thì cắt bớt, đã đầy thì không nhận nữa", () => {
    expect(capDailyCoins(300, 0)).toEqual({ granted: 300, capped: false });
    expect(capDailyCoins(300, 1400)).toEqual({ granted: 100, capped: true });
    expect(capDailyCoins(300, 1200)).toEqual({ granted: 300, capped: false });
    expect(capDailyCoins(300, COIN_RULES.dailyCap)).toEqual({ granted: 0, capped: true });
    expect(capDailyCoins(0, COIN_RULES.dailyCap)).toEqual({ granted: 0, capped: true });
    expect(capDailyCoins(50, 9999)).toEqual({ granted: 0, capped: true });
    expect(capDailyCoins(-20, 0)).toEqual({ granted: 0, capped: false });
    expect(capDailyCoins(80.7, 0, 100)).toEqual({ granted: 80, capped: false });
  });

  it("cộng dồn nhiều trận trong ngày không bao giờ vượt giới hạn", () => {
    let today = 0;
    for (let i = 0; i < 40; i++) today += capDailyCoins(170 + (i % 3) * 90, today).granted;
    expect(today).toBe(COIN_RULES.dailyCap);
  });

  it("một mình với máy nhận 60%, từ hai người thật là đủ", () => {
    expect(humanFactor(1)).toBe(0.6);
    expect(humanFactor(0)).toBe(0.6);
    expect(humanFactor(2)).toBe(1);
    expect(humanFactor(6)).toBe(1);
  });
});

describe("mốc ngày, tuần (giờ Việt Nam)", () => {
  it("ngày mới lúc 0 giờ giờ Việt Nam (17 giờ UTC hôm trước)", () => {
    expect(dayKey(Date.parse("2026-10-12T16:59:59Z"))).toBe("2026-10-12");
    expect(dayKey(Date.parse("2026-10-12T17:00:00Z"))).toBe("2026-10-13");
    expect(periodEndsAt("daily", Date.parse("2026-10-12T05:00:00Z"))).toBe(Date.parse("2026-10-12T17:00:00Z"));
  });

  it("tuần bắt đầu thứ Hai", () => {
    // 12/10/2026 là thứ Hai.
    expect(weekKey(Date.parse("2026-10-12T03:00:00Z"))).toBe("2026-10-12");
    expect(weekKey(Date.parse("2026-10-18T16:00:00Z"))).toBe("2026-10-12"); // Chủ nhật 23 giờ giờ VN
    expect(weekKey(Date.parse("2026-10-18T17:00:00Z"))).toBe("2026-10-19"); // thứ Hai 0 giờ giờ VN
    expect(weekKey(Date.parse("2026-10-11T18:00:00Z"))).toBe("2026-10-12"); // thứ Hai 1 giờ sáng giờ VN
    expect(periodEndsAt("weekly", Date.parse("2026-10-14T00:00:00Z"))).toBe(Date.parse("2026-10-18T17:00:00Z"));
  });

  it("mọi skin đều có giá đổi mảnh", () => {
    for (const s of SKINS) expect(craftCost(s.id)).toBe(SHARDS.craft[s.rarity]);
  });
});
