import { describe, expect, it } from "vitest";
import { BOT_DIFFICULTIES, DEFAULT_DIFFICULTY, DIFFICULTY, botHitChance, difficultyOf, isBotDifficulty, type DifficultyTuning } from "./difficulty.ts";

const at = (k: keyof DifficultyTuning) => BOT_DIFFICULTIES.map((d) => DIFFICULTY[d][k]);
const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);
const decreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x < xs[i - 1]!);

describe("độ khó của máy: bảng hệ số", () => {
  it("mặc định là Thường, giá trị lạ về mặc định", () => {
    expect(DEFAULT_DIFFICULTY).toBe("normal");
    expect(difficultyOf("lava")).toBe(DIFFICULTY.normal);
    expect(isBotDifficulty("veteran")).toBe(true);
    expect(isBotDifficulty("god")).toBe(false);
  });

  it("đơn điệu: càng khó máy càng trúng, càng nhanh tay, càng nhìn xa, càng ném nhiều", () => {
    for (const k of ["hit", "cap", "capSniper", "head", "burst", "sight"] as const) expect(increasing(at(k)), k).toBe(true);
    for (const k of ["react", "pause", "nade", "spread", "naval"] as const) expect(decreasing(at(k)), k).toBe(true);
  });

  it("xác suất trúng tăng theo độ khó ở mọi tầm và giảm theo khoảng cách", () => {
    for (const cls of ["ar", "smg", "dmr", "sniper"]) {
      for (const d of [5, 20, 60, 120]) {
        const chances = BOT_DIFFICULTIES.map((x) => botHitChance(cls, d, DIFFICULTY[x]));
        expect(
          chances.every((c, i) => i === 0 || c >= chances[i - 1]!),
          `${cls}@${d}`,
        ).toBe(true);
        if (d <= 20) expect(chances[0]!).toBeLessThan(chances[3]!);
      }
      for (const x of BOT_DIFFICULTIES) expect(botHitChance(cls, 100, DIFFICULTY[x])).toBeLessThanOrEqual(botHitChance(cls, 10, DIFFICULTY[x]));
    }
  });

  it("Khó giữ mốc cách bắn cũ (trần 42% / 55%), Dễ trúng chưa tới nửa", () => {
    expect(botHitChance("ar", 0, DIFFICULTY.hard)).toBeCloseTo(0.42);
    expect(botHitChance("sniper", 0, DIFFICULTY.hard)).toBeCloseTo(0.5);
    expect(botHitChance("ar", 20, DIFFICULTY.easy)).toBeLessThan(botHitChance("ar", 20, DIFFICULTY.hard) / 2);
  });
});
