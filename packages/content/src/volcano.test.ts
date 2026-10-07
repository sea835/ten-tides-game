import { describe, expect, it } from "vitest";
import { CAMP, VOLCANO } from "./island.ts";
import {
  BOMB_DAMAGE,
  BOMB_RADIUS,
  ashAmount,
  bombDamage,
  bombInterval,
  flowCount,
  flowProgress,
  lavaFlows,
  onLavaFlow,
  quakeCracks,
  quakeInterval,
  springBoiling,
  volcanoStage,
} from "./volcano.ts";
import { worldFor } from "./worldgen.ts";

/** Mức núi lửa engine luật đặt cho ngày `day` (không có biến cố). */
const levelOn = (day: number) => Math.min(99, day * 10);

describe("lịch leo thang của núi lửa", () => {
  it("ngày 1–4 yên bình, 5–7 rung chuyển, 8–10 phun trào", () => {
    expect([1, 2, 3, 4].map((d) => volcanoStage(levelOn(d)))).toEqual([1, 1, 1, 1]);
    expect([5, 6, 7].map((d) => volcanoStage(levelOn(d)))).toEqual([2, 2, 2]);
    expect([8, 9, 10].map((d) => volcanoStage(levelOn(d)))).toEqual([3, 3, 3]);
    expect(volcanoStage(0)).toBe(0);
  });

  it("biến cố núi lửa tỉnh sớm (+15) đẩy lịch lên sớm hơn", () => {
    expect(volcanoStage(levelOn(4) + 15)).toBe(2);
    expect(volcanoStage(levelOn(6) + 15)).toBe(3);
  });

  it("mưa tro, động đất, suối sôi chỉ có từ ngày 5", () => {
    for (const d of [1, 2, 3, 4]) {
      expect(ashAmount(levelOn(d))).toBe(0);
      expect(quakeInterval(levelOn(d))[0]).toBe(Infinity);
      expect(springBoiling(levelOn(d))).toBe(false);
    }
    for (const d of [5, 6, 7, 8, 9, 10]) {
      expect(ashAmount(levelOn(d))).toBeGreaterThan(0);
      expect(Number.isFinite(quakeInterval(levelOn(d))[0])).toBe(true);
      expect(springBoiling(levelOn(d))).toBe(true);
    }
    // Tro dày dần, động đất dồn dập hơn khi phun trào.
    expect(ashAmount(levelOn(9))).toBeGreaterThan(ashAmount(levelOn(5)));
    expect(quakeInterval(levelOn(8))[1]).toBeLessThan(quakeInterval(levelOn(6))[0]);
  });

  it("bom nham thạch chỉ rơi khi phun trào, dồn dập dần", () => {
    expect(bombInterval(levelOn(7))).toBe(Infinity);
    expect(bombInterval(levelOn(8))).toBeGreaterThan(bombInterval(levelOn(10)));
    expect(bombInterval(99)).toBeGreaterThanOrEqual(3);
    expect(bombDamage(0)).toBe(BOMB_DAMAGE);
    expect(bombDamage(BOMB_RADIUS / 2)).toBeLessThan(BOMB_DAMAGE);
    expect(bombDamage(BOMB_RADIUS)).toBe(0);
  });
});

describe("dòng dung nham", () => {
  const world = worldFor(2024);

  it("ngày 8 một dòng, ngày 10 ba dòng; chưa phun trào thì không có", () => {
    expect(flowCount(7, levelOn(7))).toBe(0);
    expect(lavaFlows(world, 7, levelOn(7))).toEqual([]);
    expect(lavaFlows(world, 8, levelOn(8))).toHaveLength(1);
    expect(lavaFlows(world, 10, levelOn(10))).toHaveLength(3);
  });

  it("chảy xuống dốc từ miệng núi, không tới trại, giống nhau giữa các máy", () => {
    for (const f of lavaFlows(world, 10, levelOn(10))) {
      const first = f.points[0]!;
      const last = f.points[f.points.length - 1]!;
      expect(first.y).toBeGreaterThan(last.y);
      expect(Math.hypot(first.x - VOLCANO.x, first.z - VOLCANO.z)).toBeLessThan(VOLCANO.craterRadius + 3);
      expect(f.points.every((p) => Math.hypot(p.x - CAMP.x, p.z - CAMP.z) > 40)).toBe(true);
    }
    // Dòng của hôm qua vẫn chảy đúng chỗ cũ hôm nay.
    expect(lavaFlows(worldFor(2024), 9, levelOn(9))[0]!.points).toEqual(lavaFlows(world, 10, levelOn(10))[0]!.points);
  });

  it("dài dần trong ngày: đầu dòng luôn nóng, cuối dòng tới chiều mới tràn tới", () => {
    const [flow] = lavaFlows(world, 8, levelOn(8));
    const a = flow!.points[1]!;
    const tail = flow!.points[flow!.points.length - 1]!;
    expect(onLavaFlow([flow!], a.x, a.z, flowProgress(0))).toBe(true);
    expect(onLavaFlow([flow!], tail.x, tail.z, flowProgress(0))).toBe(false);
    expect(onLavaFlow([flow!], tail.x, tail.z, flowProgress(0.8))).toBe(true);
    expect(onLavaFlow([flow!], CAMP.x, CAMP.z, 1)).toBe(false);
  });

  it("vết nứt động đất nằm trên đất liền", () => {
    const cracks = quakeCracks(world);
    expect(cracks.length).toBeGreaterThan(5);
    for (const c of cracks) expect(world.heightAt(c.x, c.z)).toBeGreaterThanOrEqual(1);
  });
});
