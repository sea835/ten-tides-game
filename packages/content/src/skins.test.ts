import { describe, expect, it } from "vitest";
import { makeRand } from "./worldgen.ts";
import { GACHA, RARITY, SKIN, SKINS, SKIN_RARITIES, SKIN_WEAPON_IDS, rarityRank, rollOnce, rollSkins, skinFitsWeapon, type SkinRarity } from "./skins.ts";

describe("danh mục skin", () => {
  it("id không trùng, đủ mọi độ hiếm, súng riêng đều có thật", () => {
    expect(SKIN.size).toBe(SKINS.length);
    expect(SKINS.length).toBeGreaterThanOrEqual(28);
    for (const r of SKIN_RARITIES) expect(SKINS.some((s) => s.rarity === r)).toBe(true);
    for (const s of SKINS) if (s.weapon) expect(SKIN_WEAPON_IDS).toContain(s.weapon);
    const total = SKIN_RARITIES.reduce((sum, r) => sum + RARITY[r].weight, 0);
    expect(total).toBeCloseTo(100);
  });

  it("skin riêng chỉ lắp đúng khẩu, skin chung lắp mọi khẩu", () => {
    expect(skinFitsWeapon("awm-dragon", "awm")).toBe(true);
    expect(skinFitsWeapon("awm-dragon", "akm")).toBe(false);
    expect(skinFitsWeapon("gold", "p92")).toBe(true);
    expect(skinFitsWeapon("gold", "không-có")).toBe(false);
    expect(skinFitsWeapon("không-có", "p92")).toBe(false);
  });
});

describe("gacha", () => {
  it("tỷ lệ rơi gần với trọng số (khi chưa chạm bảo hiểm)", () => {
    const rng = makeRand(12345);
    const counts: Record<SkinRarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const n = 200_000;
    for (let i = 0; i < n; i++) counts[rollOnce({ sinceEpic: 0, sinceLegendary: 0 }, rng).result.rarity]++;
    for (const r of SKIN_RARITIES) expect(counts[r] / n).toBeCloseTo(RARITY[r].weight / 100, 2);
  });

  it("bảo hiểm: mỗi 10 lượt có sử thi+, mỗi 60 lượt có huyền thoại", () => {
    // Hàm ngẫu nhiên tệ nhất: luôn ra số nhỏ nhất (luôn là thường nếu không có bảo hiểm).
    const worst = () => 0;
    const { results, pity } = rollSkins(120, { sinceEpic: 0, sinceLegendary: 0 }, worst);
    results.forEach((r, i) => {
      if ((i + 1) % 60 === 0) expect(r.rarity).toBe("legendary");
      else if ((i + 1) % 10 === 0) expect(rarityRank(r.rarity)).toBeGreaterThanOrEqual(rarityRank("epic"));
      else expect(r.rarity).toBe("common");
    });
    expect(pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });

    // Với ngẫu nhiên thật: không bao giờ có 10 lượt liền thiếu sử thi+, hay 60 lượt liền thiếu huyền thoại.
    const rng = makeRand(99);
    const many = rollSkins(20_000, { sinceEpic: 0, sinceLegendary: 0 }, rng).results;
    let sinceEpic = 0;
    let sinceLeg = 0;
    for (const r of many) {
      sinceEpic = rarityRank(r.rarity) >= rarityRank("epic") ? 0 : sinceEpic + 1;
      sinceLeg = r.rarity === "legendary" ? 0 : sinceLeg + 1;
      expect(sinceEpic).toBeLessThan(GACHA.epicPity);
      expect(sinceLeg).toBeLessThan(GACHA.legendaryPity);
    }
  });

  it("bộ đếm bảo hiểm tiếp nối giữa các lần quay", () => {
    const worst = () => 0;
    const first = rollSkins(9, { sinceEpic: 0, sinceLegendary: 0 }, worst);
    expect(first.pity).toEqual({ sinceEpic: 9, sinceLegendary: 9 });
    const next = rollSkins(1, first.pity, worst);
    expect(rarityRank(next.results[0]!.rarity)).toBeGreaterThanOrEqual(rarityRank("epic"));
    const nearLeg = rollSkins(1, { sinceEpic: 3, sinceLegendary: 59 }, worst);
    expect(nearLeg.results[0]!.rarity).toBe("legendary");
    expect(nearLeg.pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
  });

  it("chỉ ra skin có trong danh mục, đúng độ hiếm", () => {
    const rng = makeRand(7);
    for (const r of rollSkins(500, { sinceEpic: 0, sinceLegendary: 0 }, rng).results) expect(SKIN.get(r.skinId)?.rarity).toBe(r.rarity);
  });
});
