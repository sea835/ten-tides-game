import { describe, expect, it } from "vitest";
import { CAMP, LAKE, PALMS, VOLCANO, WATER_LEVEL, heightAt, spawnPoint, zoneAt } from "./island.ts";

describe("island", () => {
  it("trại nằm trên cạn, hồ nằm dưới mực nước, đỉnh núi lửa cao nhất", () => {
    expect(heightAt(CAMP.x, CAMP.z)).toBeGreaterThan(WATER_LEVEL);
    expect(heightAt(LAKE.x, LAKE.z)).toBeLessThan(WATER_LEVEL);
    expect(heightAt(VOLCANO.x, VOLCANO.z + VOLCANO.craterRadius)).toBeGreaterThan(15);
    expect(heightAt(0, 140)).toBeLessThan(WATER_LEVEL);
  });

  it("phân vùng đúng các mốc", () => {
    expect(zoneAt(CAMP.x, CAMP.z)).toBe("beach");
    expect(zoneAt(LAKE.x, LAKE.z)).toBe("lake");
    expect(zoneAt(VOLCANO.x, VOLCANO.z)).toBe("volcano");
  });

  it("điểm xuất phát đứng trên mặt đất và rừng dừa đủ cây", () => {
    for (let i = 0; i < 6; i++) {
      const p = spawnPoint(i);
      expect(p.y).toBeGreaterThan(heightAt(p.x, p.z));
    }
    expect(PALMS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("anchors", () => {
  it("mỗi điểm sự kiện nằm đúng vùng dự kiến và trên mặt nước", async () => {
    const { ANCHORS } = await import("./island.ts");
    const expected: Record<string, string> = {
      coconut_grove: "beach",
      shore_drift: "beach",
      lake_shore: "lake",
      cave_mouth: "cave",
      cave_tunnel: "cave",
      volcano_slope: "volcano",
      crater_rim: "volcano",
      shipwreck: "beach",
      jungle_ruin: "beach",
      cliff_nest: "beach",
      hot_spring: "volcano",
      camp_edge: "beach",
    };
    for (const a of ANCHORS) {
      expect(a.zone, a.id).toBe(expected[a.type]);
      expect(a.y, a.id).toBeGreaterThan(0.3);
    }
    expect(new Set(ANCHORS.map((a) => a.id)).size).toBe(ANCHORS.length);
  });
});

describe("treasure sites", () => {
  it("mọi chỗ giấu kho báu đều trên cạn, trong đảo, và không trùng id", async () => {
    const { TREASURE_SITES, zoneAt, heightAt } = await import("./island.ts");
    expect(TREASURE_SITES.length).toBeGreaterThanOrEqual(6);
    for (const s of TREASURE_SITES) {
      expect(heightAt(s.x, s.z), s.id).toBeGreaterThan(0.3);
      expect(zoneAt(s.x, s.z), s.id).toBeTruthy();
    }
    expect(new Set(TREASURE_SITES.map((s) => s.id)).size).toBe(TREASURE_SITES.length);
  });
});
