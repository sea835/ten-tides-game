import { describe, expect, it } from "vitest";
import { content, loadContent } from "./content.ts";
import cardsJson from "./data/cards.json" with { type: "json" };
import itemsJson from "./data/items.json" with { type: "json" };

type RawCard = { id: string; anchorType: string; choices: { check: { stat: string; itemBonus?: object }; onSuccess: object }[] };
const caveCollapse = () => structuredClone(cardsJson.find((c) => c.id === "cave_collapse_01")) as RawCard;

describe("content", () => {
  it("nạp được đủ đồ và thẻ, có thẻ mẫu trong PROJECT.md", () => {
    expect(content.items.size).toBe(38);
    expect(content.items.get("shovel")?.size).toEqual({ w: 1, h: 6 });
    expect(content.cards.size).toBeGreaterThanOrEqual(12);
    expect(content.cards.get("cave_collapse_01")?.requires?.weather).toEqual(["storm", "quake"]);
  });

  it("báo lỗi khi thẻ cộng điểm cho món đồ không tồn tại", () => {
    const broken = caveCollapse();
    broken.choices[0]!.check.itemBonus = { golden_shovel: 3 };
    expect(() => loadContent({ items: itemsJson, cards: [broken] })).toThrow(/golden_shovel/);
  });

  it("báo lỗi khi thẻ cho món đồ không tồn tại", () => {
    const broken = caveCollapse();
    broken.choices[0]!.onSuccess = { gainItem: "jetpack" };
    expect(() => loadContent({ items: itemsJson, cards: [broken] })).toThrow(/jetpack/);
  });

  it("báo lỗi khi thẻ dùng thuộc tính không có hoặc loại điểm không có trên map", () => {
    const badStat = caveCollapse();
    badStat.choices[0]!.check.stat = "luck";
    expect(() => loadContent({ items: itemsJson, cards: [badStat] })).toThrow();
    const badAnchor = caveCollapse();
    badAnchor.anchorType = "moon_base";
    expect(() => loadContent({ items: itemsJson, cards: [badAnchor] })).toThrow(/moon_base/);
  });

  it("mỗi loại điểm trên map có ít nhất một thẻ cho hồi 1", () => {
    const types = new Set([...content.cards.values()].filter((c) => c.acts.includes(1)).map((c) => c.anchorType));
    for (const type of ["coconut_grove", "shore_drift", "lake_shore", "cave_mouth", "cave_tunnel", "volcano_slope"]) {
      expect(types).toContain(type);
    }
  });
});
