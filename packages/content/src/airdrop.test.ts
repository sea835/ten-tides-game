import { describe, expect, it } from "vitest";
import { AIRDROP, airdropAltitude, airdropClear, airdropLoot, airdropSpot } from "./airdrop.ts";
import { battleMap, insideBox } from "./battle.ts";
import { WEAPON, attachmentFits, sightFits } from "./battleItems.ts";

function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe("thùng thính", () => {
  const map = battleMap(4242);

  it("rơi trên cạn, trong vùng an toàn, không kẹt trong nhà hay dưới mái", () => {
    const rand = seeded(7);
    const zones = [
      { x: 0, z: 0, r: 260 },
      { x: 40, z: -30, r: 80 },
      { x: -60, z: 50, r: 45 },
    ];
    for (const zone of zones)
      for (let k = 0; k < 10; k++) {
        const s = airdropSpot(map, zone, rand);
        expect(s).not.toBeNull();
        expect(Math.hypot(s!.x - zone.x, s!.z - zone.z)).toBeLessThanOrEqual(zone.r);
        expect(s!.y).toBeGreaterThan(1);
        expect(insideBox(map.index, s!.x, s!.y + 1, s!.z)).toBe(false);
        expect(airdropClear(map, s!.x, s!.z)).toBe(true);
      }
  });

  it("không bao giờ chọn chỗ ngoài biển", () => {
    expect(airdropClear(map, 0, 235)).toBe(false);
    expect(airdropSpot(map, { x: 0, z: 400, r: 20 }, seeded(3))).toBeNull();
  });

  it("đồ trong thùng là hàng xịn và lắp vừa súng đi kèm", () => {
    const rand = seeded(11);
    const guns = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const items = airdropLoot(rand);
      expect(items).toContain("armor:3");
      expect(items).toContain("helmet:3");
      expect(items).toContain("medkit");
      const gun = items.map((i) => WEAPON.get(i)).find((w) => w);
      expect(gun?.rare).toBe(true);
      guns.add(gun!.id);
      expect(items).toContain(`ammo:${gun!.ammo}`);
      const sight = items.find((i) => i.startsWith("sight:"))!.slice(6);
      expect(sightFits(sight, gun!)).toBe(true);
      // Phụ kiện đi theo súng (không kể món thêm ngẫu nhiên cho súng trường).
      for (const a of items.filter((i) => i.startsWith("att:") && i !== "att:comp" && i !== "att:vgrip")) expect(attachmentFits(a.slice(4), gun!)).toBe(true);
    }
    expect(guns.size).toBe(2);
  });

  it("rơi từ trên cao xuống đều, chạm đất đúng lúc hết giờ", () => {
    expect(airdropAltitude(0)).toBe(AIRDROP.height);
    expect(airdropAltitude(1)).toBe(0);
    let last = Infinity;
    for (let k = 0; k <= 10; k++) {
      const h = airdropAltitude(k / 10);
      expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });
});
