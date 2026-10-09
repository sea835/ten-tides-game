import { describe, expect, it } from "vitest";
import { SHIPS, deckBelow, firePointOf, insideShip, navalMap, shipToWorld, worldToShip, NAVAL_STARTS } from "./naval.ts";

describe("chiến hạm", () => {
  it("mỗi vị trí điều khiển đứng trên mặt sàn thật, chỗ xuất hiện cạnh đó cũng có sàn, đầu không chui vào khối", () => {
    for (const cls of Object.values(SHIPS)) {
      for (const r of cls.roles) {
        const [x, y, z] = r.station;
        expect(Math.abs(deckBelow(cls, x, y + 0.5, z) - y), `${cls.id} ${r.name}`).toBeLessThan(0.35);
        expect(Math.abs(deckBelow(cls, x, y + 0.5, z - 1.6) - y), `${cls.id} ${r.name} (chỗ xuất hiện)`).toBeLessThan(0.35);
        expect(insideShip(cls, x, y + 1.2, z), `${cls.id} ${r.name} (đầu)`).toBe(false);
      }
    }
  });

  it("các bàn điều khiển trên một tàu cách nhau đủ xa (bấm F không vào nhầm vị trí)", () => {
    for (const cls of Object.values(SHIPS))
      cls.roles.forEach((a, i) =>
        cls.roles.forEach((b, j) => {
          if (j <= i) return;
          const d = Math.hypot(a.station[0] - b.station[0], (a.station[1] - b.station[1]) * 2, a.station[2] - b.station[2]);
          expect(d, `${cls.id} ${a.name} / ${b.name}`).toBeGreaterThan(4);
        }),
      );
  });

  it("đám cháy của mọi bộ phận nằm trên mặt sàn (người đứng tới dập được)", () => {
    for (const cls of Object.values(SHIPS)) {
      for (const p of cls.parts) {
        const [x, y, z] = firePointOf(cls, p.id);
        expect(Number.isFinite(y), `${cls.id} ${p.id}`).toBe(true);
        expect(insideShip(cls, x, y + 1, z), `${cls.id} ${p.id}`).toBe(false);
      }
    }
  });

  it("đổi toạ độ riêng của tàu sang thế giới rồi ngược lại ra đúng điểm cũ", () => {
    const pose = { x: 12, y: -3, z: -40, rotY: 1.1 };
    const w = shipToWorld(pose, 3, 5, -7);
    const back = worldToShip(pose, w[0], w[1], w[2]);
    expect(back[0]).toBeCloseTo(3);
    expect(back[1]).toBeCloseTo(5);
    expect(back[2]).toBeCloseTo(-7);
  });

  it("chỗ xuất phát hai tàu là biển sâu, đủ mớn nước cho mọi lớp tàu", () => {
    const map = navalMap(3);
    for (const at of Object.values(NAVAL_STARTS))
      expect(map.world.heightAt(at.x, at.z)).toBeLessThan(-Math.max(...Object.values(SHIPS).map((c) => c.draft)) - 5);
  });
});
