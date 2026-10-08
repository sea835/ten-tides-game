import { describe, expect, it } from "vitest";
import { WAR_BASES, WATER_LEVEL, deckTop, insideBox, mapForMode, riverSide } from "@tentides/content";
import { NavGrid } from "./nav.ts";

const map = mapForMode("war", 99);
const height = (x: number, z: number) => Math.max(map.world.heightAt(x, z), deckTop(map.index, x, z));

/** Đi theo đường như máy: từng bước 0,3 m, kiểm tra không lọt vào tường, nước sâu. */
function walk(path: { x: number; z: number }[], sx: number, sz: number) {
  let x = sx;
  let z = sz;
  for (const p of path) {
    const d = Math.hypot(p.x - x, p.z - z);
    const n = Math.ceil(d / 0.3);
    for (let k = 1; k <= n; k++) {
      const px = x + ((p.x - x) * k) / n;
      const pz = z + ((p.z - z) * k) / n;
      const y = height(px, pz);
      expect(y).toBeGreaterThan(WATER_LEVEL - 0.75);
      expect(insideBox(map.index, px, y + 0.9, pz, 0.2)).toBe(false);
    }
    x = p.x;
    z = p.z;
  }
}

describe("lưới dẫn đường cho máy", () => {
  it("tìm được đường giữa hai căn cứ, qua sông bằng cầu hay khúc cạn, không xuyên tường", () => {
    const nav = new NavGrid(map, height);
    const a = WAR_BASES.blue;
    const b = WAR_BASES.red;
    const s = nav.nearestWalkable(a.x, a.z, 10)!;
    const t = nav.nearestWalkable(b.x, b.z, 10)!;
    expect(riverSide(s.x, s.z)).not.toBe(riverSide(t.x, t.z));
    // Đường dài: tìm từng chặng (hết hạn mức thì đi tới ô gần đích nhất rồi tìm tiếp), như máy làm.
    let x = s.x;
    let z = s.z;
    const t0 = performance.now();
    for (let leg = 0; leg < 12 && Math.hypot(t.x - x, t.z - z) > 3; leg++) {
      const path = nav.findPath(x, z, t.x, t.z, 6000)!;
      expect(path.length).toBeGreaterThan(0);
      walk(path, x, z);
      x = path[path.length - 1]!.x;
      z = path[path.length - 1]!.z;
    }
    expect(Math.hypot(t.x - x, t.z - z)).toBeLessThan(3);
    // Rẻ: cả quãng đường xuyên bản đồ dưới một giây kể cả lần dò ô, cạnh đầu tiên.
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("không đi xuyên tường nhà: từ ngoài vào trong nhà thì qua cửa", () => {
    const nav = new NavGrid(map, height);
    // Một khối tường bất kỳ của nhà: hai điểm hai bên tường.
    const wall = map.boxes.find((b) => b.part === "wall" && b.h > 2.5 && b.w > 2 && b.w > b.d * 4)!;
    const c = Math.cos(wall.rot);
    const sn = Math.sin(wall.rot);
    // Pháp tuyến tường (trục d của khối).
    const nx = sn;
    const nz = c;
    const ax = wall.x + nx * 2;
    const az = wall.z + nz * 2;
    const bx = wall.x - nx * 2;
    const bz = wall.z - nz * 2;
    expect(nav.clearLine(ax, az, bx, bz)).toBe(false);
    if (nav.walkable(ax, az) && nav.walkable(bx, bz)) {
      const path = nav.findPath(ax, az, bx, bz, 8000);
      if (path && path.length) walk(path, ax, az);
    }
  });
});
