import { describe, expect, it } from "vitest";
import { BATTLE_SITES, battleMap, battleSpawn, insideBox, raycastBoxes, raycastTerrain } from "./battle.ts";
import { WEAPONS, falloff } from "./battleItems.ts";

describe("bản đồ Battleground", () => {
  const map = battleMap(12345);

  it("mọi khu nằm trên đất liền, san phẳng đúng độ cao", () => {
    for (const site of BATTLE_SITES) {
      expect(map.world.heightAt(site.x, site.z)).toBeCloseTo(site.h, 1);
      expect(map.world.surface(site.x, site.z).pad).toBe(true);
    }
  });

  it("có đủ nhà cửa, đồ rơi, cây cối và mìn", () => {
    expect(map.boxes.length).toBeGreaterThan(1500);
    expect(map.loot.length).toBeGreaterThan(80);
    expect(map.loot.some((l) => l.tier === 3)).toBe(true);
    expect(map.world.trees.length).toBeGreaterThan(300);
    expect(map.mines.length).toBeGreaterThan(20);
  });

  it("chỗ xuất phát ở trên cạn, không kẹt trong tường", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 30; k++) {
      const s = battleSpawn(map, rand);
      expect(s.y).toBeGreaterThan(0.9);
      expect(insideBox(map.index, s.x, s.y + 1, s.z)).toBe(false);
    }
  });

  it("đạn bị tường chặn, bắn ra biển thì không trúng gì", () => {
    const city = BATTLE_SITES.find((s) => s.kind === "city")!;
    // Từ ngoài thành phố bắn ngang vào giữa: gặp nhà trước khi tới tâm.
    const o: [number, number, number] = [city.x - city.rx - 20, city.h + 1.5, city.z];
    const hit = raycastBoxes(map.index, o, [1, 0, 0], city.rx * 2 + 40);
    expect(hit).toBeLessThan(city.rx * 2 + 40);
    expect(raycastBoxes(map.index, [0, 30, 230], [0, 0, 1], 50)).toBe(Infinity);
    // Bắn chúc xuống thì gặp đất.
    expect(raycastTerrain(map.world, [city.x, city.h + 10, city.z], [0, -1, 0], 50)).toBeCloseTo(10, 0);
  });

  it("sát thương giảm theo khoảng cách nhưng không dưới một nửa", () => {
    for (const w of WEAPONS) {
      expect(falloff(w, w.range)).toBe(1);
      expect(falloff(w, w.range * 10)).toBe(0.5);
    }
  });
});
