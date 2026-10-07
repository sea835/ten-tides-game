import { describe, expect, it } from "vitest";
import { SHIN, THIGH, ankleAt, approach, jumpCurve, landCurve, landImpact, smooth01, solveLeg } from "./locomotion.ts";

describe("IK chân hai khúc", () => {
  it("giải ngược đúng dáng ngồi xổm, dáng đi (gối gập ra sau)", () => {
    const ank = { z: 0, y: 0 };
    const leg = { thigh: 0, knee: 0 };
    for (const [thigh, knee] of [
      [-1.08, 2.16],
      [0.4, 0.3],
      [-0.6, 1.2],
      [-1.3, 2.05],
    ] as const) {
      ankleAt(thigh, knee, ank);
      solveLeg(ank.z, ank.y, leg);
      expect(leg.thigh).toBeCloseTo(thigh, 4);
      expect(leg.knee).toBeCloseTo(knee, 4);
    }
  });

  it("nâng cổ chân lên dốc thì gối gập thêm, cổ chân tới đúng chỗ", () => {
    const ank = ankleAt(0, 0, { z: 0, y: 0 });
    expect(ank.y).toBeCloseTo(-(THIGH + SHIN), 5);
    const leg = solveLeg(0.05, ank.y + 0.2, { thigh: 0, knee: 0 });
    expect(leg.knee).toBeGreaterThan(0.5);
    const back = ankleAt(leg.thigh, leg.knee, { z: 0, y: 0 });
    expect(back.z).toBeCloseTo(0.05, 4);
    expect(back.y).toBeCloseTo(ank.y + 0.2, 4);
  });

  it("xa quá tầm thì duỗi thẳng chĩa về phía đó", () => {
    const leg = solveLeg(0, -2, { thigh: 1, knee: 1 });
    expect(leg.knee).toBeCloseTo(0, 1);
    expect(leg.thigh).toBeCloseTo(0, 1);
  });
});

describe("nhịp nhảy, đáp đất, đổi tư thế", () => {
  it("nhún lấy đà 50 ms rồi bật duỗi người", () => {
    expect(jumpCurve(0).wind).toBe(0);
    expect(jumpCurve(0.05).wind).toBeCloseTo(1, 5);
    expect(jumpCurve(0.2).wind).toBe(0);
    expect(jumpCurve(0.175).ext).toBeCloseTo(1, 5);
    expect(jumpCurve(0.4).ext).toBe(0);
  });

  it("đáp đất nhún theo tốc độ rơi rồi hồi lại", () => {
    expect(landImpact(1.5)).toBe(0);
    expect(landImpact(7)).toBeGreaterThan(landImpact(4));
    expect(landImpact(40)).toBe(1);
    expect(landCurve(0.06)).toBeCloseTo(1, 5);
    expect(landCurve(0.8)).toBeLessThan(0.05);
  });

  it("chuyển tư thế đều rồi êm hai đầu", () => {
    let v = 0;
    for (let k = 0; k < 10; k++) v = approach(v, 1, 0.05 / 0.55);
    expect(v).toBeGreaterThan(0.8);
    expect(v).toBeLessThan(1);
    expect(approach(0.98, 1, 0.1)).toBe(1);
    expect(smooth01(0)).toBe(0);
    expect(smooth01(0.5)).toBeCloseTo(0.5, 5);
    expect(smooth01(2)).toBe(1);
  });
});
