import { describe, expect, it } from "vitest";
import { BULLET_GRAVITY, MORTAR, NEST, WEAPON, battleMap, clampElevation, clampTraverse, emplacementFits, emplacementSpots, inTraverse, insideBox, mortarDir, mortarElevationFor, mortarFlightTime, mortarImpact, mortarRange, vehicleSpec, warMap } from "./index.ts";

describe("cối 82mm: đạn đạo", () => {
  it("tầm bắn trên đất bằng đúng công thức v²·sin2θ/g, xa nhất ở 45°, giảm dần khi ngẩng lên", () => {
    const v = MORTAR.velocity;
    expect(mortarRange(Math.PI / 4)).toBeCloseTo((v * v) / BULLET_GRAVITY, 3);
    expect(mortarRange(MORTAR.elevMin)).toBeGreaterThan(280);
    expect(mortarRange(MORTAR.elevMax)).toBeLessThan(60);
    let prev = Infinity;
    for (let e = MORTAR.elevMin; e <= MORTAR.elevMax; e += 0.05) {
      const r = mortarRange(e);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("bắn xuống thấp thì xa hơn, lên cao thì gần hơn; cao quá thì không với tới", () => {
    const e = (60 * Math.PI) / 180;
    expect(mortarRange(e, 20)).toBeGreaterThan(mortarRange(e));
    expect(mortarRange(e, -20)).toBeLessThan(mortarRange(e));
    expect(mortarRange(e, -1000)).toBe(0);
    expect(mortarFlightTime(e)).toBeCloseTo((2 * MORTAR.velocity * Math.sin(e)) / BULLET_GRAVITY, 3);
  });

  it("góc ngẩng theo tầm là nghịch đảo của tầm theo góc ngẩng; ngoài tầm thì null", () => {
    for (const r of [80, 150, 220, 280]) {
      const e = mortarElevationFor(r)!;
      expect(e).toBeGreaterThanOrEqual(MORTAR.elevMin);
      expect(e).toBeLessThanOrEqual(MORTAR.elevMax);
      expect(mortarRange(e)).toBeCloseTo(r, 1);
    }
    expect(mortarElevationFor(1000)).toBeNull();
    expect(mortarElevationFor(5)).toBeNull();
  });

  it("góc ngẩng bị kẹp trong [45°, 85°]", () => {
    expect(clampElevation(0.2)).toBe(MORTAR.elevMin);
    expect(clampElevation(1.6)).toBe(MORTAR.elevMax);
    expect(clampElevation(1.2)).toBe(1.2);
  });

  it("điểm rơi dự đoán theo địa hình khớp tầm bắn tính tay", () => {
    const map = warMap(5);
    const spot = emplacementSpots(map).find((s) => s.kind === "mortar")!;
    const y = map.world.heightAt(spot.x, spot.z) + MORTAR.mount[1];
    const e = (70 * Math.PI) / 180;
    const d = mortarDir(spot.rotY, e);
    const hit = mortarImpact(map, [spot.x, y, spot.z], d);
    const dist = Math.hypot(hit.x - spot.x, hit.z - spot.z);
    const drop = y - hit.y;
    expect(Math.abs(dist - mortarRange(e, drop))).toBeLessThan(3);
  });
});

describe("ổ đại liên: cung xoay", () => {
  it("kẹp hướng súng trong cung 120° quanh hướng đặt (kể cả quanh ±π)", () => {
    const half = NEST.arc / 2;
    expect(clampTraverse("hmg_nest", 0, 0.5)).toBeCloseTo(0.5);
    expect(clampTraverse("hmg_nest", 0, 2)).toBeCloseTo(half);
    expect(clampTraverse("hmg_nest", 0, -2)).toBeCloseTo(-half);
    // Đặt quay về −z (rotY = π): hướng 3.0 và −3.0 đều ở ngay trước mặt.
    expect(Math.cos(clampTraverse("hmg_nest", Math.PI, -3.0) + 3.0)).toBeCloseTo(1);
    expect(inTraverse("hmg_nest", Math.PI, 3.0)).toBe(true);
    expect(inTraverse("hmg_nest", Math.PI, 0)).toBe(false);
    // Cối xoay đủ vòng.
    expect(clampTraverse("mortar", 0, 3)).toBe(3);
  });
});

describe("chỗ đặt vũ khí cố định", () => {
  it("chiến trường: ổ đại liên, cối ở mọi cứ điểm và hai căn cứ; tất cả trên đất liền, không chồng lên nhà", () => {
    const map = warMap(7);
    const spots = emplacementSpots(map);
    const nests = spots.filter((s) => s.kind === "hmg_nest");
    const mortars = spots.filter((s) => s.kind === "mortar");
    expect(nests.length).toBeGreaterThanOrEqual(8);
    expect(mortars.length).toBeGreaterThanOrEqual(10);
    for (const letter of ["A", "B", "C", "E", "F", "G"]) {
      const f = map.flags!.find((x) => x.id === letter)!;
      expect(mortars.some((m) => Math.hypot(m.x - f.x, m.z - f.z) < f.r + 10)).toBe(true);
    }
    for (const s of spots) {
      const h = map.world.heightAt(s.x, s.z);
      expect(h).toBeGreaterThan(0.8);
      expect(insideBox(map.index, s.x, h + 0.8, s.z, 0.5)).toBe(false);
      expect(emplacementFits(map, s.kind, s.x, s.z)).toBe(true);
    }
  });

  it("đảo sinh tồn: vài ổ đại liên rải ở rìa các khu", () => {
    const map = battleMap(11);
    const spots = emplacementSpots(map);
    expect(spots.filter((s) => s.kind === "hmg_nest").length).toBeGreaterThanOrEqual(2);
    for (const s of spots) expect(map.world.heightAt(s.x, s.z)).toBeGreaterThan(0.8);
  });

  it("thông số chung qua vehicleSpec, đạn cối có trong bảng súng", () => {
    expect(vehicleSpec("hmg_nest").seats).toBe(1);
    expect(vehicleSpec("mortar").hp).toBe(MORTAR.hp);
    expect(WEAPON.get("mortar")?.price).toBe(0);
  });
});
