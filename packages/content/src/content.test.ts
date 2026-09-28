import { describe, expect, it } from "vitest";
import { content, loadContent } from "./content.ts";
import caveCollapse01 from "./data/events/cave_collapse_01.json" with { type: "json" };

describe("content", () => {
  it("nạp được đủ 11 món đồ và thẻ mẫu", () => {
    expect(content.items.size).toBe(11);
    expect(content.items.get("shovel")?.size).toEqual({ w: 1, h: 6 });
    expect(content.events.has("cave_collapse_01")).toBe(true);
  });

  it("báo lỗi khi thẻ cộng điểm cho món đồ không tồn tại", () => {
    const broken = structuredClone(caveCollapse01) as { choices: { check: { itemBonus: object } }[] };
    broken.choices[0]!.check.itemBonus = { golden_shovel: 3 };
    expect(() => loadContent({ items: [], events: [broken] })).toThrow(/golden_shovel/);
  });

  it("báo lỗi khi thẻ dùng thuộc tính không có", () => {
    const broken = structuredClone(caveCollapse01) as { choices: { check: { stat: string } }[] };
    broken.choices[0]!.check.stat = "luck";
    expect(() => loadContent({ items: [], events: [broken] })).toThrow();
  });
});
