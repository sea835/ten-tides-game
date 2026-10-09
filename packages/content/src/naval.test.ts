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

  it("từ boong chính đi bộ (lên cầu thang, vòng qua thượng tầng, lan can) tới được mọi bàn điều khiển", () => {
    const STEP = 0.5;
    const R = 0.38;
    const C = 0.5;
    for (const cls of Object.values(SHIPS)) {
      const wall = (x: number, y: number, z: number) =>
        cls.boxes.some((b) => {
          if (!b.solid || b.pitch || b.y + b.h / 2 <= y + STEP || b.y - b.h / 2 >= y + 1.75) return false;
          const r = b.y + b.h / 2 - y > 1 ? R : 0.05;
          return Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r;
        });
      const start = cls.id === "carrier" ? [10, cls.deck, -20] : cls.id === "submarine" ? [0, cls.deck, -30] : [0, cls.hull.deck, -cls.length * 0.3];
      const y0 = deckBelow(cls, start[0]!, start[1]! + 0.5, start[2]!);
      const seen = new Set<string>();
      const queue: [number, number, number][] = [[start[0]!, y0, start[2]!]];
      const key = (x: number, y: number, z: number) => `${Math.round(x / C)},${Math.round(y * 2)},${Math.round(z / C)}`;
      seen.add(key(...queue[0]!));
      const reached: [number, number, number][] = [];
      while (queue.length) {
        const [x, y, z] = queue.pop()!;
        reached.push([x, y, z]);
        for (const [dx, dz] of [
          [C, 0],
          [-C, 0],
          [0, C],
          [0, -C],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (Math.abs(nz) > cls.length / 2 || Math.abs(nx) > cls.beam / 2) continue;
          const floor = deckBelow(cls, nx, y + STEP - 0.6, nz);
          if (wall(nx, Number.isFinite(floor) ? Math.max(y, floor) : y, nz)) continue;
          if (!Number.isFinite(floor) || floor < y - 3) continue;
          const k = key(nx, floor, nz);
          if (seen.has(k)) continue;
          seen.add(k);
          queue.push([nx, floor, nz]);
        }
      }
      for (const r of cls.roles) {
        const ok = reached.some(([x, y, z]) => Math.hypot(x - r.station[0], z - r.station[2]) < 1.2 && Math.abs(y - r.station[1]) < 0.6);
        expect(ok, `${cls.id} ${r.name}`).toBe(true);
      }
    }
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
