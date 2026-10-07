import { MAP_HALF_SIZE, type World } from "@tentides/content";

/**
 * Lưới độ cao của địa hình — phần thuần số (không đụng three/React) để vừa dựng hình vẽ vừa dựng
 * va chạm, và để kiểm thử được trong Node.
 */

/** Địa hình chia thành từng ô vuông cạnh chừng này mét (để camera cắt bớt phần ngoài tầm nhìn). */
export const CHUNK = 48;
/** Độ mịn: ô có đất liền hay đáy nông thì 2 m một đỉnh; ô toàn biển sâu thì 6 m (6 chia hết cho 2 nên mép khớp nhau). */
export const FINE = 2;
export const COARSE = 6;

/** Một ô địa hình: lưới đỉnh (x, y, z) đều nhau và tam giác (đường chéo nối góc (i+1, j) với (i, j+1)). */
export interface TerrainGrid {
  cx: number;
  cz: number;
  /** Khoảng cách giữa hai đỉnh (FINE hoặc COARSE). */
  step: number;
  /** Số ô con theo mỗi cạnh. */
  cells: number;
  x0: number;
  z0: number;
  verts: Float32Array;
  indices: Uint32Array;
}

/**
 * Đỉnh từng ô địa hình lấy từ world.heightAt(): ô có đất hay đáy nông dùng lưới mịn, ô toàn biển
 * sâu dùng lưới thưa. Mép ô mịn giáp ô thưa được nắn thẳng theo ô thưa để không hở khe.
 */
export function terrainGrids(world: World): TerrainGrid[] {
  const half = world.half ?? MAP_HALF_SIZE;
  const count = Math.round((half * 2) / CHUNK);
  const origin = -half;
  // Ô nào toàn biển sâu (lấy mẫu dày theo lưới thưa, cả mép).
  const coarse: boolean[][] = [];
  for (let cx = 0; cx < count; cx++) {
    coarse.push([]);
    for (let cz = 0; cz < count; cz++) {
      let deep = true;
      for (let i = 0; i <= CHUNK / FINE && deep; i += 1) {
        for (let j = 0; j <= CHUNK / FINE && deep; j += 1) {
          if (world.heightAt(origin + cx * CHUNK + i * FINE, origin + cz * CHUNK + j * FINE) > -7) deep = false;
        }
      }
      coarse[cx]!.push(deep);
    }
  }
  const isCoarse = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < count && cz < count && coarse[cx]![cz]!;

  const grids: TerrainGrid[] = [];
  for (let cx = 0; cx < count; cx++) {
    for (let cz = 0; cz < count; cz++) {
      const step = coarse[cx]![cz] ? COARSE : FINE;
      const cells = CHUNK / step;
      const x0 = origin + cx * CHUNK;
      const z0 = origin + cz * CHUNK;
      const verts = new Float32Array((cells + 1) * (cells + 1) * 3);
      const heightOn = (x: number, z: number) => world.heightAt(x, z);
      for (let j = 0; j <= cells; j++) {
        for (let i = 0; i <= cells; i++) {
          const x = x0 + i * step;
          const z = z0 + j * step;
          let y = heightOn(x, z);
          // Mép giáp ô thưa: lấy nội suy giữa hai đỉnh của ô thưa để hai bên khớp nhau.
          if (step === FINE) {
            const snap = (t: number, a: [number, number], b: [number, number]) => {
              const k = (t % COARSE) / COARSE;
              return k === 0 ? heightOn(...a) : heightOn(...a) * (1 - k) + heightOn(...b) * k;
            };
            const tx = i * FINE;
            const tz = j * FINE;
            const floorX = x0 + Math.floor(tx / COARSE) * COARSE;
            const floorZ = z0 + Math.floor(tz / COARSE) * COARSE;
            if ((i === 0 && isCoarse(cx - 1, cz)) || (i === cells && isCoarse(cx + 1, cz))) y = snap(tz, [x, floorZ], [x, floorZ + COARSE]);
            else if ((j === 0 && isCoarse(cx, cz - 1)) || (j === cells && isCoarse(cx, cz + 1))) y = snap(tx, [floorX, z], [floorX + COARSE, z]);
          }
          verts.set([x, y, z], (j * (cells + 1) + i) * 3);
        }
      }
      const indices = new Uint32Array(cells * cells * 6);
      let k = 0;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const a = j * (cells + 1) + i;
          const b = a + 1;
          const c = a + (cells + 1);
          const d = c + 1;
          indices.set([a, c, b, b, c, d], k);
          k += 6;
        }
      }
      grids.push({ cx, cz, step, cells, x0, z0, verts, indices });
    }
  }
  return grids;
}

/**
 * Lưới độ cao cho `HeightfieldCollider` của Rapier: một mặt duy nhất phủ cả bản đồ, mỗi FINE mét
 * một đỉnh. Rapier chia mỗi ô theo đường chéo (x+1, z)–(x, z+1), đúng như lưới vẽ, nên ở ô mịn
 * mặt va chạm trùng khít hình vẽ (kể cả nền nhà san phẳng, lòng sông). Ô thưa (biển sâu) được lấy
 * mẫu dày lên từ chính tam giác của ô thưa: cùng chiều đường chéo nên vẫn trùng khít.
 *
 * Thay cho hàng chục `TrimeshCollider`: heightfield tra ô theo toạ độ (O(1)) thay vì duyệt cây BVH.
 */
export interface TerrainField {
  /** Số ô con theo trục z (hàng) và trục x (cột). */
  nrows: number;
  ncols: number;
  /** (nrows+1)×(ncols+1) độ cao, xếp theo cột (column-major): chỉ số = iz + ix*(nrows+1). */
  heights: Float32Array;
  scale: { x: number; y: number; z: number };
}

export function terrainField(grids: readonly TerrainGrid[], half: number): TerrainField {
  const n = Math.round((half * 2) / FINE);
  const heights = new Float32Array((n + 1) * (n + 1));
  const at = (ix: number, iz: number) => iz + ix * (n + 1);
  for (const g of grids) {
    const gx = Math.round((g.x0 + half) / FINE);
    const gz = Math.round((g.z0 + half) / FINE);
    const span = CHUNK / FINE;
    const ratio = g.step / FINE;
    const row = g.cells + 1;
    const h = (i: number, j: number) => g.verts[(j * row + i) * 3 + 1]!;
    for (let jz = 0; jz <= span; jz++) {
      for (let ix = 0; ix <= span; ix++) {
        let y: number;
        if (ratio === 1) y = h(ix, jz);
        else {
          // Nội suy trên tam giác của ô thưa chứa điểm này.
          const ci = Math.min(g.cells - 1, Math.floor(ix / ratio));
          const cj = Math.min(g.cells - 1, Math.floor(jz / ratio));
          const u = ix / ratio - ci;
          const v = jz / ratio - cj;
          const a = h(ci, cj);
          const b = h(ci + 1, cj);
          const c = h(ci, cj + 1);
          const d = h(ci + 1, cj + 1);
          y = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
        }
        heights[at(gx + ix, gz + jz)] = y;
      }
    }
  }
  return { nrows: n, ncols: n, heights, scale: { x: half * 2, y: 1, z: half * 2 } };
}

/** Độ cao mặt va chạm tại (x, z) — cùng phép chia tam giác như Rapier (dùng để kiểm thử). */
export function fieldHeight(f: TerrainField, x: number, z: number): number {
  const fx = ((x / f.scale.x + 0.5) * f.ncols);
  const fz = ((z / f.scale.z + 0.5) * f.nrows);
  const ix = Math.max(0, Math.min(f.ncols - 1, Math.floor(fx)));
  const iz = Math.max(0, Math.min(f.nrows - 1, Math.floor(fz)));
  const u = fx - ix;
  const v = fz - iz;
  const H = (i: number, j: number) => f.heights[j + i * (f.nrows + 1)]! * f.scale.y;
  const a = H(ix, iz);
  const b = H(ix + 1, iz);
  const c = H(ix, iz + 1);
  const d = H(ix + 1, iz + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
