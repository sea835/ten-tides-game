import { describe, expect, it } from "vitest";
import { MAP_HALF_SIZE, mapForMode } from "@tentides/content";
import { fieldHeight, terrainField, terrainGrids } from "./terrainField.ts";

describe("terrainField", () => {
  for (const mode of ["war", "solo"]) {
    it(`heightfield trùng khít lưới vẽ (${mode})`, () => {
      const map = mapForMode(mode, 4242);
      const half = map.world.half ?? map.half ?? MAP_HALF_SIZE;
      const grids = terrainGrids(map.world);
      const field = terrainField(grids, half);
      expect(field.heights.length).toBe((field.nrows + 1) * (field.ncols + 1));
      let worst = 0;
      for (const g of grids) {
        const row = g.cells + 1;
        for (let j = 0; j < g.cells; j += 3) {
          for (let i = 0; i < g.cells; i += 3) {
            const v = (k: number, l: number) => g.verts[(l * row + k) * 3 + 1]!;
            const x = g.x0 + i * g.step;
            const z = g.z0 + j * g.step;
            // Đỉnh lưới, và trung điểm đường chéo (x+1, z)–(x, z+1) của ô con — cùng phép chia tam giác.
            worst = Math.max(worst, Math.abs(fieldHeight(field, x, z) - v(i, j)));
            const mid = (v(i + 1, j) + v(i, j + 1)) / 2;
            worst = Math.max(worst, Math.abs(fieldHeight(field, x + g.step / 2, z + g.step / 2) - mid));
          }
        }
      }
      expect(worst).toBeLessThan(0.002);
    });
  }
});
