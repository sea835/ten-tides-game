import { describe, expect, it } from "vitest";
import {
  SNAP_GRID,
  SNAP_MAX_PIECES,
  dirFromYaw,
  hasDeck,
  snapCell,
  snapFromRecord,
  snapOffset,
  snapPiece,
  snapProblem,
  type SnapPiece,
  type SnapTerrain,
} from "./snap.ts";

const flat: SnapTerrain = { cell: () => ({ base: 1, slope: 0.2 }), blocked: () => false };
const REACH = 9;
const piece = (kind: SnapPiece["kind"], i: number, j: number, level = 0, extra: Partial<SnapPiece> = {}): SnapPiece => ({ kind, i, j, level, side: 0, dir: 0, ...extra });

describe("bắt lưới", () => {
  it("sàn, tháp vào ô gần nhất; vách vào cạnh gần nhất", () => {
    expect(snapPiece("floor", 3.9, -1.2, 0, 0)).toMatchObject({ i: 1, j: 0 });
    // Gần cạnh tây của ô (2, 0): x = 1,5·G.
    expect(snapPiece("wall", 1.4 * SNAP_GRID, 0.1, 0, 0)).toMatchObject({ i: 2, j: 0, side: 1 });
    // Gần cạnh bắc của ô (0, 1): z = 0,5·G.
    expect(snapPiece("wall", 0.2, 0.6 * SNAP_GRID, 0, 0)).toMatchObject({ i: 0, j: 1, side: 0 });
    expect(snapPiece("floor", 0, 0, 7, 0).level).toBe(3);
  });

  it("ghi vào state rồi dựng lại ra đúng mảnh cũ", () => {
    const pieces: SnapPiece[] = [
      piece("floor", 2, -1, 1),
      piece("wall", 2, 3, 0, { side: 1 }),
      piece("wall", -1, 2, 2, { side: 0 }),
      piece("tower", -2, -2, 0),
      ...([0, 1, 2, 3] as const).map((dir) => piece("stairs", 1, 4, 0, { dir })),
    ];
    for (const p of pieces) {
      const o = snapOffset(p);
      expect(snapFromRecord(p.kind, o.dx, o.dz, o.rot, p.level)).toEqual(p);
    }
  });

  it("hướng cầu thang theo hướng nhìn", () => {
    expect(dirFromYaw(0)).toBe(0);
    expect(dirFromYaw(Math.PI)).toBe(2);
    expect(dirFromYaw(-Math.PI / 2)).toBe(1);
    expect(dirFromYaw(Math.PI / 2)).toBe(3);
  });

  it("nền ô lấy chỗ cao nhất, độ chênh theo địa hình", () => {
    const c = snapCell((x) => x * 0.5, 0, 0, 2, 0);
    expect(c.base).toBeGreaterThanOrEqual(3 + 0.7);
    expect(c.slope).toBeCloseTo(1.4, 5);
  });
});

describe("kiểm tra chỗ đặt", () => {
  it("tầng trệt: không đè lửa trại, không quá xa, không vướng, không dốc", () => {
    expect(snapProblem([], piece("floor", 0, 0), flat, REACH)).toMatch(/lửa/);
    expect(snapProblem([], piece("floor", 1, 0), flat, REACH)).toBeNull();
    expect(snapProblem([], piece("floor", REACH + 1, 0), flat, REACH)).toMatch(/xa/);
    expect(snapProblem([], piece("floor", 2, 2), { ...flat, blocked: (i, j) => i === 2 && j === 2 }, REACH)).toMatch(/Vướng/);
    expect(snapProblem([], piece("tower", 2, 2), { ...flat, cell: () => ({ base: 0, slope: 3 }) }, REACH)).toMatch(/dốc/);
    // Vách tầng trệt ở rìa ô lửa trại thì được (một bên là ô thường).
    expect(snapProblem([], piece("wall", 1, 0, 0, { side: 1 }), flat, REACH)).toBeNull();
  });

  it("không chồng lấn", () => {
    const camp = [piece("floor", 1, 0), piece("wall", 1, 0, 0, { side: 0 }), piece("tower", 2, 0)];
    expect(snapProblem(camp, piece("floor", 1, 0), flat, REACH)).toMatch(/Đã có sàn/);
    expect(snapProblem(camp, piece("wall", 1, 0, 0, { side: 0 }), flat, REACH)).toMatch(/Đã có vách/);
    expect(snapProblem(camp, piece("stairs", 2, 0), flat, REACH)).toMatch(/cầu thang hay tháp/);
    // Nóc tháp là mặt sàn tầng 1: không đặt thêm sàn trùng.
    expect(snapProblem(camp, piece("floor", 2, 0, 1), flat, REACH)).toMatch(/Đã có sàn/);
    expect(hasDeck(camp, 2, 0, 1)).toBe(true);
  });

  it("tầng trên phải có thứ đỡ", () => {
    expect(snapProblem([], piece("floor", 2, 2, 1), flat, REACH)).toMatch(/đỡ/);
    // Tháp canh đỡ sàn tầng 1; sàn kề bên chìa ra được một ô, ô thứ hai thì không.
    const tower = [piece("tower", 2, 2)];
    expect(snapProblem(tower, piece("floor", 3, 2, 1), flat, REACH)).toBeNull();
    const cantilever = [...tower, piece("floor", 3, 2, 1)];
    expect(snapProblem(cantilever, piece("floor", 4, 2, 1), flat, REACH)).toMatch(/đỡ/);
    // Hai vách tầng trệt bao quanh ô cũng đỡ được sàn.
    const walls = [piece("wall", 4, 4, 0, { side: 0 }), piece("wall", 4, 4, 0, { side: 1 })];
    expect(snapProblem(walls, piece("floor", 4, 4, 1), flat, REACH)).toBeNull();
    expect(snapProblem(walls.slice(0, 1), piece("floor", 4, 4, 1), flat, REACH)).toMatch(/đỡ/);
  });

  it("vách, cầu thang, tháp trên cao phải đứng trên sàn", () => {
    const deck = [piece("tower", 2, 2), piece("floor", 3, 2, 1)];
    expect(snapProblem(deck, piece("wall", 3, 2, 1, { side: 1 }), flat, REACH)).toBeNull();
    expect(snapProblem(deck, piece("wall", 6, 6, 1, { side: 1 }), flat, REACH)).toMatch(/trên sàn/);
    expect(snapProblem(deck, piece("stairs", 3, 2, 1), flat, REACH)).toBeNull();
    expect(snapProblem(deck, piece("tower", 5, 5, 1), flat, REACH)).toMatch(/trên sàn/);
    expect(snapProblem(deck, piece("tower", 2, 2, 3), flat, REACH)).toMatch(/Cao quá/);
    // Sàn đè lên cầu thang thì bịt lối lên.
    const stairs = [piece("tower", 2, 2), piece("stairs", 3, 2)];
    expect(snapProblem(stairs, piece("floor", 3, 2, 1), flat, REACH)).toMatch(/cầu thang/);
  });

  it("giới hạn số mảnh của trại", () => {
    const many = Array.from({ length: SNAP_MAX_PIECES }, (_, k) => piece("floor", 1 + (k % 8), 1 + Math.floor(k / 8)));
    expect(snapProblem(many, piece("floor", -3, -3), flat, REACH)).toMatch(/quá nhiều/);
  });
});
