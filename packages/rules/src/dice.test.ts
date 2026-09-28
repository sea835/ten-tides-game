import { describe, expect, it } from "vitest";
import { rollCheck } from "./dice.ts";
import type { Stats } from "./stats.ts";

const stats: Stats = { strength: 4, dexterity: 2, intellect: 3, charisma: 3, nerve: 3 };

describe("rollCheck", () => {
  it("tổng = xúc xắc + thuộc tính + các khoản cộng, kèm bảng cộng để hiện công khai", () => {
    const { result } = rollCheck(123, {
      stat: "strength",
      dc: 12,
      stats,
      modifiers: [{ label: "Xẻng", value: 3 }],
    });
    expect(result.modifiers).toEqual([
      { label: "Thể lực", value: 4 },
      { label: "Xẻng", value: 3 },
    ]);
    expect(result.total).toBe(result.roll + 7);
    expect(result.success).toBe(result.total >= 12);
  });

  it("có tính xác định theo seed", () => {
    const a = rollCheck(99, { stat: "intellect", dc: 11, stats });
    const b = rollCheck(99, { stat: "intellect", dc: 11, stats });
    expect(a).toEqual(b);
  });
});
