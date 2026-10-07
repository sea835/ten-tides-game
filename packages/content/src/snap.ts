// Dựng nhà kiểu lắp ghép quanh lửa trại: sàn gỗ, vách gỗ, cầu thang, tháp canh khớp vào một lưới ô vuông 3 m lấy
// lửa trại làm gốc (dời trại thì cả khu nhà dời theo), xếp được nhiều tầng. Server dùng các hàm ở đây để kiểm tra
// chỗ đặt (đỡ, chồng lấn, địa hình); client dùng đúng các hàm đó để vẽ bóng xanh/đỏ trước khi gửi lệnh.
//
// Mỗi tầng cao STOREY mét. Ô (i, j) có tâm ở (trại.x + i·G, trại.z + j·G). Ở mỗi ô và mỗi tầng L có hai chỗ:
//   - "mặt sàn" ở độ cao L: sàn gỗ, hoặc nóc của tháp canh tầng L−1;
//   - "thân" từ L tới L+1: cầu thang hoặc tháp canh.
// Vách nằm trên cạnh giữa hai ô: side 0 là cạnh phía bắc ô (giữa (i, j) và (i, j−1)), side 1 là cạnh phía tây
// (giữa (i, j) và (i−1, j)).

export const SNAP_GRID = 3;
export const STOREY = 3;
/** Tầng cao nhất đặt được một mặt sàn. */
export const SNAP_MAX_LEVEL = 3;
/** Số mảnh tối đa của cả trại (giữ state gọn). */
export const SNAP_MAX_PIECES = 96;
/** Nền một ô ở tầng trệt chênh cao quá chừng này thì không dựng được (dốc quá). */
export const SNAP_MAX_SLOPE = 1.6;

export const SNAP_KINDS = ["floor", "wall", "stairs", "tower"] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];

export interface SnapPiece {
  kind: SnapKind;
  i: number;
  j: number;
  level: number;
  /** Vách: 0 cạnh bắc, 1 cạnh tây. */
  side: 0 | 1;
  /** Cầu thang: hướng đi lên (0 bắc −z, 1 đông +x, 2 nam +z, 3 tây −x). */
  dir: 0 | 1 | 2 | 3;
}

/** Hướng đi lên của cầu thang theo `dir` (đơn vị ô). */
export const SNAP_DIRS: readonly { di: number; dj: number }[] = [
  { di: 0, dj: -1 },
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
];

/** Góc xoay (quanh trục y, theo quy ước three.js) để mặt trước mô hình (+z) nhìn theo hướng `dir`. */
export function snapDirRot(dir: number): number {
  // dir 2 (nam, +z) là góc 0; quay ngược chiều kim đồng hồ nhìn từ trên xuống.
  return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][dir & 3]!;
}

/** Hướng `dir` gần nhất với góc nhìn `yaw` (camera nhìn theo −sin, −cos). */
export function dirFromYaw(yaw: number): 0 | 1 | 2 | 3 {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
  return fz > 0 ? 2 : 0;
}

/** Chỉ số ô theo trục (cộng 0 để khỏi ra −0). */
function gridIndex(v: number): number {
  return Math.round(v / SNAP_GRID) + 0;
}

/**
 * Bắt điểm (dx, dz) (tương đối so với lửa trại) vào lưới: ô gần nhất cho sàn, cầu thang, tháp; cạnh gần nhất cho
 * vách. `rot` là góc nhìn lúc đặt (chọn hướng cầu thang).
 */
export function snapPiece(kind: SnapKind, dx: number, dz: number, level: number, rot: number): SnapPiece {
  const lv = Math.max(0, Math.min(SNAP_MAX_LEVEL, Math.round(level)));
  if (kind === "wall") {
    // Cạnh gần nhất: so điểm với tâm ô chứa nó.
    const i = gridIndex(dx);
    const j = gridIndex(dz);
    const ox = dx / SNAP_GRID - i;
    const oz = dz / SNAP_GRID - j;
    if (Math.abs(ox) > Math.abs(oz)) return { kind, i: ox > 0 ? i + 1 : i, j, level: lv, side: 1, dir: 0 };
    return { kind, i, j: oz > 0 ? j + 1 : j, level: lv, side: 0, dir: 0 };
  }
  return { kind, i: gridIndex(dx), j: gridIndex(dz), level: lv, side: 0, dir: dirFromYaw(rot) };
}

/** Vị trí lưu trong state (dx, dz so với lửa trại, góc xoay) của một mảnh đã bắt lưới. */
export function snapOffset(p: SnapPiece): { dx: number; dz: number; rot: number } {
  if (p.kind === "wall") {
    return p.side === 0 ? { dx: p.i * SNAP_GRID, dz: (p.j - 0.5) * SNAP_GRID, rot: 0 } : { dx: (p.i - 0.5) * SNAP_GRID, dz: p.j * SNAP_GRID, rot: Math.PI / 2 };
  }
  return { dx: p.i * SNAP_GRID, dz: p.j * SNAP_GRID, rot: p.kind === "stairs" ? snapDirRot(p.dir) : 0 };
}

/** Dựng lại mảnh từ bản ghi trong state (kind lưới, dx, dz, góc, tầng). */
export function snapFromRecord(kind: SnapKind, dx: number, dz: number, rot: number, level: number): SnapPiece {
  if (kind === "wall") {
    const vertical = Math.abs(Math.sin(rot)) > 0.5;
    return vertical
      ? { kind, i: gridIndex(dx + SNAP_GRID / 2), j: gridIndex(dz), level, side: 1, dir: 0 }
      : { kind, i: gridIndex(dx), j: gridIndex(dz + SNAP_GRID / 2), level, side: 0, dir: 0 };
  }
  // Cầu thang: hướng có góc xoay gần `rot` nhất.
  const diff = (d: number) => Math.abs(Math.atan2(Math.sin(snapDirRot(d) - rot), Math.cos(snapDirRot(d) - rot)));
  const dir = kind === "stairs" ? ([0, 1, 2, 3] as const).reduce<0 | 1 | 2 | 3>((b, d) => (diff(d) < diff(b) ? d : b), 0) : 0;
  return { kind, i: gridIndex(dx), j: gridIndex(dz), level, side: 0, dir };
}

/** Hai ô hai bên một vách. */
export function wallCells(p: SnapPiece): [{ i: number; j: number }, { i: number; j: number }] {
  return p.side === 0 ? [{ i: p.i, j: p.j }, { i: p.i, j: p.j - 1 }] : [{ i: p.i, j: p.j }, { i: p.i - 1, j: p.j }];
}

/** Ô (i, j) ở tầng L có mặt sàn không: sàn gỗ, hay nóc tháp canh của tầng dưới. */
export function hasDeck(pieces: readonly SnapPiece[], i: number, j: number, level: number): boolean {
  return pieces.some((p) => p.i === i && p.j === j && ((p.kind === "floor" && p.level === level) || (p.kind === "tower" && p.level + 1 === level)));
}

/** Mặt sàn được đỡ trực tiếp: tầng trệt, nóc tháp, hay có ít nhất hai vách tầng dưới bao quanh ô. */
function propped(pieces: readonly SnapPiece[], i: number, j: number, level: number): boolean {
  if (level === 0) return true;
  if (pieces.some((p) => p.kind === "tower" && p.i === i && p.j === j && p.level + 1 === level)) return true;
  const walls = pieces.filter((p) => p.kind === "wall" && p.level === level - 1 && wallCells(p).some((c) => c.i === i && c.j === j));
  return walls.length >= 2;
}

export interface SnapTerrain {
  /** Độ cao nền và độ chênh của ô (i, j) theo vị trí trại hiện tại. */
  cell(i: number, j: number): { base: number; slope: number };
  /** Ô vướng thứ gì (cây, nhà kiểu cũ, công trình của bản đồ, dưới mặt nước lúc triều cường). */
  blocked(i: number, j: number): boolean;
}

/** Bán kính lưới (số ô) quanh lửa trại. */
export function snapReach(buildRadius: number): number {
  return Math.floor(buildRadius / SNAP_GRID);
}

/**
 * Kiểm tra đặt mảnh `p` vào trại đang có `pieces`. Trả về lý do (tiếng Việt) nếu không được, null nếu được.
 * Hàm thuần: server và client cùng dùng.
 */
export function snapProblem(pieces: readonly SnapPiece[], p: SnapPiece, terrain: SnapTerrain, reach: number): string | null {
  if (pieces.length >= SNAP_MAX_PIECES) return "Trại đã quá nhiều công trình.";
  if (p.level < 0 || p.level > SNAP_MAX_LEVEL) return "Cao quá rồi.";
  if ((p.kind === "stairs" || p.kind === "tower") && p.level >= SNAP_MAX_LEVEL) return "Cao quá rồi.";
  const cells = p.kind === "wall" ? wallCells(p) : [{ i: p.i, j: p.j }];
  if (cells.some((c) => Math.max(Math.abs(c.i), Math.abs(c.j)) > reach)) return "Quá xa lửa trại.";
  // Ô lửa trại: tầng trệt để trống (cả các vách bao quanh), trên cao thì được (mái che lửa).
  if (p.level === 0 && cells.some((c) => c.i === 0 && c.j === 0) && p.kind !== "wall") return "Sát đống lửa quá, cháy nhà mất.";
  if (p.level === 0 && p.kind === "wall" && cells.every((c) => c.i === 0 && c.j === 0)) return "Sát đống lửa quá, cháy nhà mất.";

  const deckAt = (i: number, j: number, l: number) => hasDeck(pieces, i, j, l);
  const bodyAt = (i: number, j: number, l: number) => pieces.some((q) => (q.kind === "stairs" || q.kind === "tower") && q.i === i && q.j === j && q.level === l);

  // Tầng trệt: nền phải khô, tương đối bằng.
  const groundOk = (i: number, j: number) => {
    if (terrain.blocked(i, j)) return "Vướng cây, nhà hay nước. Dọn chỗ đã.";
    if (terrain.cell(i, j).slope > SNAP_MAX_SLOPE) return "Đất dốc quá.";
    return null;
  };

  switch (p.kind) {
    case "floor": {
      if (deckAt(p.i, p.j, p.level)) return "Đã có sàn ở đây.";
      if (p.level === 0) return groundOk(p.i, p.j);
      if (bodyAt(p.i, p.j, p.level - 1) && !pieces.some((q) => q.kind === "tower" && q.i === p.i && q.j === p.j && q.level === p.level - 1)) {
        // Sàn đè lên đầu cầu thang thì bịt lối lên.
        return "Vướng cầu thang bên dưới.";
      }
      if (propped(pieces, p.i, p.j, p.level)) return null;
      // Chìa ra một ô từ sàn kề bên đã được đỡ chắc.
      for (const d of SNAP_DIRS) {
        if (deckAt(p.i + d.di, p.j + d.dj, p.level) && propped(pieces, p.i + d.di, p.j + d.dj, p.level)) return null;
      }
      return "Không có gì đỡ: cần tháp canh, hai vách bên dưới, hay sàn kề bên.";
    }
    case "wall": {
      if (pieces.some((q) => q.kind === "wall" && q.i === p.i && q.j === p.j && q.side === p.side && q.level === p.level)) return "Đã có vách ở đây.";
      const [a, b] = cells as [{ i: number; j: number }, { i: number; j: number }];
      // Tầng trệt: chỉ cần một bên vách là đất dựng được.
      if (p.level === 0) return groundOk(a.i, a.j) === null || groundOk(b.i, b.j) === null ? null : "Vướng cây, nhà hay nước. Dọn chỗ đã.";
      if (!deckAt(a.i, a.j, p.level) && !deckAt(b.i, b.j, p.level)) return "Vách phải dựng trên sàn.";
      return null;
    }
    case "stairs":
    case "tower": {
      if (bodyAt(p.i, p.j, p.level)) return "Chỗ này đã có cầu thang hay tháp.";
      if (p.kind === "tower" && deckAt(p.i, p.j, p.level + 1)) return "Đã có sàn ở tầng trên.";
      if (p.level === 0) return groundOk(p.i, p.j);
      if (!deckAt(p.i, p.j, p.level)) return "Phải đặt trên sàn.";
      return null;
    }
  }
}

/** Độ cao của tầng `level` trên ô có nền `base`. Sàn tầng trệt nhô lên một chút cho khỏi lấp vào cỏ. */
export const SNAP_FLOOR_LIFT = 0.25;
export function snapY(base: number, level: number): number {
  return base + SNAP_FLOOR_LIFT + level * STOREY;
}

/**
 * Nền và độ chênh của ô (i, j) quanh trại ở (cx, cz): lấy chỗ cao nhất trong năm điểm dò (tâm và bốn góc) làm nền,
 * làm tròn lên 0,25 m cho các ô kề nhau dễ bằng mặt.
 */
export function snapCell(heightAt: (x: number, z: number) => number, cx: number, cz: number, i: number, j: number): { base: number; slope: number } {
  const x = cx + i * SNAP_GRID;
  const z = cz + j * SNAP_GRID;
  const r = SNAP_GRID / 2 - 0.1;
  const hs = [heightAt(x, z), heightAt(x - r, z - r), heightAt(x + r, z - r), heightAt(x - r, z + r), heightAt(x + r, z + r)];
  const hi = Math.max(...hs);
  const lo = Math.min(...hs);
  return { base: Math.ceil(hi * 4) / 4, slope: hi - lo };
}

/** Nền của một mảnh: vách lấy nền cao hơn của hai ô hai bên. */
export function snapBase(heightAt: (x: number, z: number) => number, cx: number, cz: number, p: SnapPiece): number {
  if (p.kind !== "wall") return snapCell(heightAt, cx, cz, p.i, p.j).base;
  const [a, b] = wallCells(p);
  return Math.max(snapCell(heightAt, cx, cz, a.i, a.j).base, snapCell(heightAt, cx, cz, b.i, b.j).base);
}

/** Vật cản trên mặt đất quanh trại (cây, nhà kiểu cũ): tâm và bán kính. */
export interface SnapObstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Địa hình lưới quanh trại ở (cx, cz) cho `snapProblem`: nền và độ dốc từng ô, ô nào vướng công trình của bản đồ, vật
 * cản, hay thấp hơn `waterline` (dưới nước lúc triều lên). Server và client dựng giống nhau.
 */
export function snapTerrain(
  world: { heightAt(x: number, z: number): number; structureAt(x: number, z: number): unknown },
  cx: number,
  cz: number,
  obstacles: readonly SnapObstacle[],
  waterline: number,
): SnapTerrain {
  const cell = (i: number, j: number) => snapCell(world.heightAt, cx, cz, i, j);
  return {
    cell,
    blocked(i, j) {
      const x = cx + i * SNAP_GRID;
      const z = cz + j * SNAP_GRID;
      const c = cell(i, j);
      if (c.base - c.slope < waterline || world.structureAt(x, z)) return true;
      const half = SNAP_GRID / 2;
      // Vật cản chạm vào ô (hộp vuông nới theo bán kính vật cản).
      return obstacles.some((o) => Math.abs(o.x - x) < half + o.r && Math.abs(o.z - z) < half + o.r);
    },
  };
}
