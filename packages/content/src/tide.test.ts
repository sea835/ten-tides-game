import { describe, expect, it } from "vitest";
import { CAMP, WATER_LEVEL } from "./island.ts";
import { TIDE_HIGH, TIDE_LOW, TIDE_RANGE, dayTime, seaLevel, tidalOpen, tidalSites, tideAt, tideRising } from "./tide.ts";
import { battleMap } from "./battle.ts";
import { worldFor } from "./worldgen.ts";

const clock = (phase: string, timeLeft: number, phaseDuration = 180, mode = "story") => ({ mode, phase, timeLeft, phaseDuration });

describe("thủy triều", () => {
  it("dâng hạ đúng 2,5 m trong một ngày", () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= 1000; k++) {
      const v = tideAt(k / 1000);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeCloseTo(TIDE_RANGE, 3);
    expect(hi).toBeCloseTo(TIDE_HIGH, 3);
    expect(lo).toBeCloseTo(TIDE_LOW, 3);
  });

  it("triều rút giữa buổi khám phá, triều cường ban đêm", () => {
    const midExplore = seaLevel(clock("explore", 90));
    const midNight = seaLevel(clock("night", 30, 60));
    expect(midExplore).toBeLessThan(TIDE_LOW + 0.3);
    expect(midNight).toBeGreaterThan(TIDE_HIGH - 0.3);
    // Triều cường không ngập trại mặc định.
    expect(TIDE_HIGH).toBeLessThan(worldFor(1).heightAt(CAMP.x, CAMP.z) - 0.1);
  });

  it("liền mạch qua các pha (không nhảy cóc khi đổi pha)", () => {
    const pairs: [string, string][] = [
      ["dawn", "explore"],
      ["explore", "dusk"],
      ["dusk", "night"],
    ];
    for (const [a, b] of pairs) {
      expect(seaLevel(clock(a, 0, 30))).toBeCloseTo(seaLevel(clock(b, 30, 30)), 5);
    }
    // Hết đêm sang bình minh hôm sau: chỉ lệch chút ít (bình minh bắt đầu ở 0,02, client làm mượt).
    expect(Math.abs(seaLevel(clock("night", 0, 60)) - seaLevel(clock("dawn", 30, 30)))).toBeLessThan(0.15);
    expect(dayTime("explore", 180, 180)).toBeCloseTo(0.1, 6);
  });

  it("Battleground và sảnh chờ không có triều", () => {
    expect(seaLevel(clock("explore", 90, 180, "battle"))).toBe(WATER_LEVEL);
    expect(seaLevel(clock("lobby", 0, 0))).toBe(WATER_LEVEL);
    expect(seaLevel(clock("pack", 100, 240))).toBe(WATER_LEVEL);
    expect(tideRising(clock("explore", 90, 180, "battle"))).toBe(false);
  });

  it("buổi chiều triều lên, buổi sáng triều xuống", () => {
    expect(tideRising(clock("explore", 170))).toBe(false);
    expect(tideRising(clock("dusk", 15, 30))).toBe(true);
  });
});

describe("những chỗ lộ ra khi triều rút", () => {
  it("có xác tàu, hang ngầm; chỉ với tới khi triều rút", () => {
    for (const seed of [1, 7, 42, 12345, 99999]) {
      const sites = tidalSites(worldFor(seed));
      expect(sites.length).toBeGreaterThanOrEqual(3);
      expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
      for (const s of sites) {
        // Ngập lúc triều trung bình và triều cường, lộ ra lúc triều rút.
        expect(tidalOpen(s, TIDE_HIGH)).toBe(false);
        expect(tidalOpen(s, seaLevel(clock("night", 30, 60)))).toBe(false);
        expect(tidalOpen(s, TIDE_LOW)).toBe(true);
      }
      expect(sites.some((s) => s.kind === "wreck")).toBe(true);
    }
  });

  it("theo seed: hai lần sinh ra giống nhau, bản đồ Battleground không có", () => {
    expect(tidalSites(worldFor(5)).map((s) => [s.id, s.x, s.z])).toEqual(tidalSites(worldFor(5)).map((s) => [s.id, s.x, s.z]));
    expect(tidalSites(battleMap(3).world)).toEqual([]);
  });
});
