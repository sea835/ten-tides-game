import { describe, expect, it } from "vitest";
import { paceInterval } from "./pacing.ts";

describe("paceInterval", () => {
  const hz = (f: number) => 1000 / f;
  it("vẽ cách đều theo bội nguyên chu kỳ màn hình", () => {
    expect(1000 / paceInterval(60, hz(60))).toBeCloseTo(60);
    expect(1000 / paceInterval(60, hz(120))).toBeCloseTo(60);
    // 144 Hz: cách 2 nhịp (72 khung đều) thay vì 60 khung lệch nhịp.
    expect(1000 / paceInterval(60, hz(144))).toBeCloseTo(72);
    expect(1000 / paceInterval(60, hz(165))).toBeCloseTo(55);
    expect(1000 / paceInterval(30, hz(144))).toBeCloseTo(28.8);
  });
  it("không vượt giới hạn quá 25%", () => {
    expect(1000 / paceInterval(60, hz(240))).toBeCloseTo(60);
    expect(1000 / paceInterval(100, hz(144))).toBeCloseTo(72);
  });
  it("chưa đo được màn hình thì dùng đúng giới hạn; 0 là không giới hạn", () => {
    expect(paceInterval(60, 0)).toBeCloseTo(1000 / 60);
    expect(paceInterval(0, hz(60))).toBe(0);
  });
});
