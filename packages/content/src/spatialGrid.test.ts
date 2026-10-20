import { describe, expect, it } from "vitest";
import { SpatialGrid } from "./spatialGrid.ts";

describe("SpatialGrid", () => {
  it("chỉ trả về vật trong bán kính, kể cả vật nằm ở ô âm", () => {
    const grid = new SpatialGrid<{ x: number; z: number; id: string }>(16);
    const items = [
      { x: 0, z: 0, id: "a" },
      { x: 10, z: 10, id: "b" },
      { x: -20, z: -5, id: "c" },
      { x: 100, z: 100, id: "d" },
    ];
    items.forEach((i) => grid.upsert(i));
    const found: string[] = [];
    grid.query(0, 0, 25, (i) => found.push(i.id));
    expect(found.sort()).toEqual(["a", "b", "c"]);
  });

  it("khớp với cách duyệt hết từng vật", () => {
    const grid = new SpatialGrid<{ x: number; z: number }>(24);
    const items = Array.from({ length: 500 }, (_, k) => ({ x: Math.sin(k * 12.9898) * 400, z: Math.cos(k * 78.233) * 400 }));
    items.forEach((i) => grid.upsert(i));
    for (const [px, pz, r] of [[0, 0, 70], [150, -90, 40], [-399, 399, 120]] as const) {
      const fast = new Set<object>();
      grid.query(px, pz, r, (i) => fast.add(i));
      const slow = items.filter((i) => Math.hypot(i.x - px, i.z - pz) <= r);
      expect(fast.size).toBe(slow.length);
      slow.forEach((i) => expect(fast.has(i)).toBe(true));
    }
  });

  it("dời và gỡ vật", () => {
    const grid = new SpatialGrid<{ x: number; z: number }>(10);
    const item = { x: 1, z: 1 };
    grid.upsert(item);
    item.x = 55;
    grid.upsert(item);
    let n = 0;
    grid.query(0, 0, 5, () => n++);
    expect(n).toBe(0);
    grid.query(55, 1, 5, () => n++);
    expect(n).toBe(1);
    grid.remove(item);
    expect(grid.size).toBe(0);
  });
});
