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
    };
    for (const a of ANCHORS) {
      expect(a.zone, a.id).toBe(expected[a.type]);
      expect(a.y, a.id).toBeGreaterThan(0.3);
    }
    expect(new Set(ANCHORS.map((a) => a.id)).size).toBe(ANCHORS.length);
  });
});
