import { describe, expect, it } from "vitest";
import { WAR_MAP_LIST, mapForMode, warMapById, warMapId } from "./warMaps.ts";
import { emplacementFits, emplacementSpots } from "./emplacements.ts";
import { baseAhead, floorBelow, insideBox } from "./battle.ts";
import { tankFits } from "./squad.ts";

describe("danh mục bản đồ chiến trường", () => {
  it("mã lạ về bản đồ gốc; chế độ khác không dùng mã bản đồ", () => {
    expect(warMapId("xyz")).toBe("frontier");
    expect(warMapId(undefined)).toBe("frontier");
    expect(warMapId("verdun")).toBe("verdun");
    expect(mapForMode("war", 3, "alamein").war?.id).toBe("alamein");
    expect(mapForMode("solo", 3, "alamein").layout).toBe("island");
  });

  for (const info of WAR_MAP_LIST) {
    describe(info.name, () => {
      const map = warMapById(info.id, 7);
      const w = map.world;

      it("7 cứ điểm A–G trên đất liền, không kẹt trong khối; độ cao hữu hạn khắp bản đồ", () => {
        expect(map.flags!.map((f) => f.id).join("")).toBe("ABCDEFG");
        for (const f of map.flags!) {
          // Mặt đứng dưới cột cờ (mặt đất hay mặt cầu, quảng trường bắc qua kênh) khớp độ cao cứ điểm.
          const floor = floorBelow(map, f.x, f.y + 1, f.z);
          expect(floor).toBeGreaterThan(0.8);
          expect(Math.abs(floor - f.y)).toBeLessThan(1.5);
        }
        expect(new Set(w.trees.map((t) => t.id)).size).toBe(w.trees.length);
        const half = map.half!;
        for (let x = -half; x <= half; x += 16) for (let z = -half; z <= half; z += 16) expect(Number.isFinite(w.heightAt(x, z))).toBe(true);
      });

      it("căn cứ phẳng, trên cạn; bãi xe tăng trước căn cứ đặt được xe tăng; sân đỗ trực thăng trên cạn", () => {
        for (const side of ["blue", "red"] as const) {
          const base = map.war!.bases[side];
          expect(w.heightAt(base.x, base.z)).toBeGreaterThan(1);
          const park = baseAhead(base, 44);
          let fits = false;
          for (let r = 0; r <= 22 && !fits; r += 2)
            for (let k = 0; k < 12 && !fits; k++) fits = tankFits(map, park.x + Math.cos(k) * r, park.z + Math.sin(k) * r, base.face);
          expect(fits).toBe(true);
          const pad = map.war!.helipads[side];
          expect(w.heightAt(pad.x, pad.z)).toBeGreaterThan(0.8);
        }
      });

      it("chỗ thả thuyền gần nước sâu", () => {
        for (const h of map.war!.harbors) {
          let deep = false;
          for (let r = 0; r < 220 && !deep; r += 4) for (let k = 0; k < 16 && !deep; k++) deep = w.heightAt(h.x + Math.cos(k) * r, h.z + Math.sin(k) * r) < -2.5;
          expect(deep).toBe(true);
        }
      });

      it("nhiều cối: mỗi cứ điểm, mỗi căn cứ; mọi vũ khí cố định trên đất liền, không chồng lên nhà", () => {
        const spots = emplacementSpots(map);
        expect(spots.filter((s) => s.kind === "mortar").length).toBeGreaterThanOrEqual(10);
        expect(spots.filter((s) => s.kind === "hmg_nest").length).toBeGreaterThanOrEqual(8);
        for (const s of spots) {
          const h = w.heightAt(s.x, s.z);
          expect(insideBox(map.index, s.x, h + 0.8, s.z, 0.5)).toBe(false);
          expect(emplacementFits(map, s.kind, s.x, s.z)).toBe(true);
        }
      });

      if (info.id !== "frontier") {
        it("có chiến hào khoét sâu xuống đất và công sự (bao cát, bê tông)", () => {
          expect(map.boxes.some((b) => b.mat === "sandbag")).toBe(true);
          expect(map.boxes.some((b) => b.mat === "concrete" || b.mat === "stone")).toBe(true);
          expect(w.regionAt).toBeTypeOf("function");
          // Dò quanh các cứ điểm tìm chỗ tên vùng là "Chiến hào" (lòng hào thấp hơn mặt đất xung quanh).
          let found = false;
          const half = map.half!;
          for (let x = -half + 20; x < half - 20 && !found; x += 3)
            for (let z = -half + 20; z < half - 20 && !found; z += 3) found = w.regionAt(x, z) === "Chiến hào" && w.heightAt(x, z) < w.heightAt(x + 6, z) - 0.6;
          expect(found).toBe(true);
        });
      }
    });
  }
});
