import { describe, expect, it } from "vitest";
import { nextFloat, nextInt, seedFromString, shuffle } from "./rng.ts";

describe("rng", () => {
  it("cùng seed cho cùng chuỗi số", () => {
    const run = (seed: number) => {
      const out: number[] = [];
      let rng = seed;
      for (let i = 0; i < 5; i++) {
        const r = nextFloat(rng);
        out.push(r.value);
        rng = r.rng;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("nextInt luôn nằm trong khoảng và phủ đủ hai đầu", () => {
    let rng = seedFromString("ABCD");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = nextInt(rng, 1, 20);
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(20);
      seen.add(r.value);
      rng = r.rng;
    }
    expect(seen.size).toBe(20);
  });

  it("shuffle giữ nguyên phần tử và không sửa mảng gốc", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const { value } = shuffle(7, input);
    expect(value.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
