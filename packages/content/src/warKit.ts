import type { ZoneId } from "@tentides/rules";
import type { GrassPatch } from "./island.ts";
import { makeRand, subSeed, type Biome, type Surface, type Tree, type World } from "./worldgen.ts";
import {
  Builder,
  buildArmory,
  buildIndex,
  outside,
  registerMap,
  toWorld,
  type BattleBox,
  type BattleMap,
  type BattleSite,
  type BoxMat,
  type FlagSpot,
  type LootSpot,
  type WarBase,
  type WarEmplacement,
  type WarInfo,
} from "./battle.ts";

// Bộ đồ nghề dựng chiến trường 50 vs 50 dùng chung cho mọi bản đồ: công sự quanh cột cờ, tháp canh gỗ, hòm đạn,
// căn cứ (kho vũ khí + bãi xe tăng + sân đỗ trực thăng); chiến hào (khoét địa hình theo đường gấp khúc, kè bao cát,
// ván gỗ hai bên mép), hố bom, dây thép gai, lô cốt bê tông, ụ pháo, tường thành; và hàm ráp một bản đồ từ các khu.

export type Pt = readonly [number, number];

export const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Khoảng cách từ (x, z) tới đoạn thẳng a–b. */
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Khoảng cách tới đường gấp khúc. */
export function polyDist(pts: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(x, z, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]));
  return best;
}

/**
 * Chiến hào kiểu Thế chiến I: đường răng cưa (đoạn thẳng xen đoạn lệch sang bên `amp` mét) từ a tới b, mỗi khúc dài
 * chừng `seg` mét. Răng cưa chặn đạn bắn dọc chiến hào và mảnh lựu đạn.
 */
export function zigzag(a: Pt, b: Pt, amp: number, seg: number): Pt[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / seg));
  const ux = dx / len;
  const uz = dz / len;
  const out: Pt[] = [a];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const off = k % 2 ? amp : -amp;
    out.push([a[0] + dx * t - uz * off, a[1] + dz * t + ux * off]);
  }
  out.push(b);
  return out;
}

/** Một chiến hào: đường đi, nửa bề rộng đáy, sâu (m). */
export interface Trench {
  pts: readonly Pt[];
  /** Nửa bề rộng đáy hào (mặc định 1,6 m). */
  half?: number;
  /** Sâu dưới mặt đất (mặc định 1,5 m). */
  depth?: number;
}

/** Ô lưới tra nhanh các đoạn chiến hào (cạnh ô 24 m). */
export class TrenchField {
  private cells = new Map<number, number[]>();
  private segs: { ax: number; az: number; bx: number; bz: number; half: number; depth: number }[] = [];
  constructor(readonly trenches: readonly Trench[]) {
    for (const t of trenches) {
      for (let i = 1; i < t.pts.length; i++) {
        const [ax, az] = t.pts[i - 1]!;
        const [bx, bz] = t.pts[i]!;
        const k = this.segs.length;
        const half = t.half ?? 1.6;
        this.segs.push({ ax, az, bx, bz, half, depth: t.depth ?? 1.5 });
        const pad = half + 3;
        for (let gx = Math.floor((Math.min(ax, bx) - pad) / 24); gx <= Math.floor((Math.max(ax, bx) + pad) / 24); gx++)
          for (let gz = Math.floor((Math.min(az, bz) - pad) / 24); gz <= Math.floor((Math.max(az, bz) + pad) / 24); gz++) {
            const key = gx * 4096 + gz;
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(k);
          }
      }
    }
  }
  /** Độ sâu khoét xuống ở (x, z): đủ sâu trong lòng hào, thành dốc đứng chừng 1,4 m ra mép. */
  cut(x: number, z: number): number {
    const list = this.cells.get(Math.floor(x / 24) * 4096 + Math.floor(z / 24));
    if (!list) return 0;
    let best = 0;
    for (const k of list) {
      const s = this.segs[k]!;
      const d = segDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (d > s.half + 1.4) continue;
      best = Math.max(best, s.depth * (1 - smooth(s.half, s.half + 1.4, d)));
    }
    return best;
  }
  /** Đang ở trong lòng hào. */
  inside(x: number, z: number): boolean {
    return this.cut(x, z) > 0.8;
  }
}

/** Hố bom, hố đạn pháo: lòng chảo sâu `d`, gờ đất đùn lên quanh miệng. */
export interface Crater {
  x: number;
  z: number;
  r: number;
  d: number;
}

/** Ô lưới tra nhanh hố bom (cạnh ô 32 m). */
export class CraterField {
  private cells = new Map<number, Crater[]>();
  constructor(readonly craters: readonly Crater[]) {
    for (const c of craters) {
      const pad = c.r * 1.4;
      for (let gx = Math.floor((c.x - pad) / 32); gx <= Math.floor((c.x + pad) / 32); gx++)
        for (let gz = Math.floor((c.z - pad) / 32); gz <= Math.floor((c.z + pad) / 32); gz++) {
          const key = gx * 4096 + gz;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(c);
        }
    }
  }
  /** Độ cao cộng thêm (âm trong lòng hố, dương ở gờ). */
  offset(x: number, z: number): number {
    const list = this.cells.get(Math.floor(x / 32) * 4096 + Math.floor(z / 32));
    if (!list) return 0;
    let h = 0;
    for (const c of list) {
      const t = Math.hypot(x - c.x, z - c.z) / c.r;
      if (t >= 1.4) continue;
      if (t < 1) h -= c.d * (1 - t * t) * (1 - t * t * 0.3);
      else h += c.d * 0.3 * Math.sin(((t - 1) / 0.4) * Math.PI) * (t < 1.2 ? 1 : 0.6);
    }
    return h;
  }
}

/** Rải `n` hố bom trong hình chữ nhật (x0, z0)–(x1, z1), bán kính r0–r1, tránh chỗ `avoid` trả true. */
export function scatterCraters(rand: () => number, n: number, x0: number, z0: number, x1: number, z1: number, r0: number, r1: number, avoid: (x: number, z: number, r: number) => boolean = () => false): Crater[] {
  const out: Crater[] = [];
  for (let tries = 0; out.length < n && tries < n * 8; tries++) {
    const r = r0 + (r1 - r0) * rand() * rand();
    const x = x0 + (x1 - x0) * rand();
    const z = z0 + (z1 - z0) * rand();
    if (avoid(x, z, r)) continue;
    out.push({ x, z, r, d: r * (0.28 + rand() * 0.12) });
  }
  return out;
}

// ---------------------------------------------------------------------------- khối dựng theo toạ độ thế giới

/** Khu "tự do" (gốc toạ độ thế giới, không san nền): dựng khối theo toạ độ thế giới, y tuyệt đối. */
export function freeBuilder(rand: () => number): Builder {
  const site: BattleSite = { id: "free", name: "", kind: "village", x: 0, z: 0, rx: 0, rz: 0, rot: 0, h: 0, ground: "dirt" };
  return new Builder(site, rand as ReturnType<typeof makeRand>);
}

/** Gộp khối, đồ rơi của bộ dựng con `sb` vào `b` (đánh lại số toà nhà để không trùng toà của `b`). */
export function adopt(b: Builder, sb: Builder) {
  for (const box of sb.boxes) if (box.building !== undefined) box.building += b.groups;
  b.groups += sb.groups;
  b.boxes.push(...sb.boxes);
  b.loot.push(...sb.loot);
}

/** Góc quay khối để trục dài (w) chạy theo hướng (dx, dz). */
export function alongRot(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/**
 * Kè hai mép chiến hào: bao cát (mặt trận) hay ván gỗ, đặt trên mặt đất `ground` (độ cao trước khi khoét) chạy dọc
 * đường song song với tim hào (nối góc kiểu vát: ở góc răng cưa hai đoạn kè gặp nhau chứ không đâm chéo qua nhau),
 * chia đoạn ≤ 6 m để bám theo dốc. `sides`: mép nào có kè (1 trái, −1 phải theo chiều đi).
 */
export function lineTrench(b: Builder, t: Trench, ground: (x: number, z: number) => number, o: { mat?: "sandbag" | "wood"; sides?: readonly number[]; height?: number } = {}) {
  const half = t.half ?? 1.6;
  const mat = o.mat ?? "sandbag";
  const H = o.height ?? 0.75;
  const off = half + 1.7;
  const pts = t.pts;
  const n = pts.length;
  if (n < 2) return;
  const closed = Math.hypot(pts[0]![0] - pts[n - 1]![0], pts[0]![1] - pts[n - 1]![1]) < 0.01;
  // Pháp tuyến trái của từng đoạn.
  const segN: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i]![0] - pts[i - 1]![0];
    const dz = pts[i]![1] - pts[i - 1]![1];
    const l = Math.hypot(dx, dz) || 1;
    segN.push([-dz / l, dx / l]);
  }
  for (const side of o.sides ?? [1, -1]) {
    // Đỉnh của đường kè: dời theo trung bình pháp tuyến hai đoạn kề (vát góc, giới hạn để góc nhọn khỏi vọt xa).
    const line: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? segN[i - 1] : closed ? segN[n - 2] : undefined;
      const c = i < n - 1 ? segN[i] : closed ? segN[0] : undefined;
      const na = a ?? c!;
      const nc = c ?? a!;
      let mx = na[0] + nc[0];
      let mz = na[1] + nc[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const k = Math.min(1.8, 1 / Math.max(0.3, mx * nc[0] + mz * nc[1]));
      line.push([pts[i]![0] + mx * off * k * side, pts[i]![1] + mz * off * k * side]);
    }
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1]!;
      const [bx, bz] = line[i]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.4) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const pieces = Math.ceil(len / 6);
      for (let k = 0; k < pieces; k++) {
        const piece = len / pieces;
        const px = ax + ux * piece * (k + 0.5);
        const pz = az + uz * piece * (k + 0.5);
        const g = ground(px, pz);
        if (mat === "sandbag") b.add(px, g + H / 2 - 0.1, pz, piece + 0.25, H, 0.9, "sandbag", { rot: alongRot(ux, uz) });
        else b.add(px, g + H / 2 - 0.1, pz, piece + 0.15, H, 0.25, "wood", { rot: alongRot(ux, uz), tint: "#5d4a34" });
      }
    }
  }
}

/** Hàng dây thép gai dọc đường a–b: cọc sắt chéo, cuộn dây thấp (chặn người đi, đạn bay qua). */
export function wireLine(b: Builder, a: Pt, c: Pt, ground: (x: number, z: number) => number) {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (len < 1) return;
  const ux = (c[0] - a[0]) / len;
  const uz = (c[1] - a[1]) / len;
  const n = Math.ceil(len / 5);
  for (let k = 0; k < n; k++) {
    const piece = len / n;
    const mx = a[0] + ux * (k + 0.5) * piece;
    const mz = a[1] + uz * (k + 0.5) * piece;
    const g = ground(mx, mz);
    b.add(mx, g + 0.5, mz, piece, 1, 0.7, "fence", { rot: alongRot(ux, uz), tint: "#59524a" });
    b.add(mx - ux * piece * 0.5, g + 0.6, mz - uz * piece * 0.5, 0.1, 1.2, 0.1, "metal", { tint: "#3b3632", solid: false });
  }
}

/**
 * Lô cốt bê tông (pillbox) tại (x, z) theo toạ độ của bộ dựng `b` (khu: toạ độ riêng, y tính từ nền khu; bộ dựng tự
 * do: toạ độ thế giới), quay mặt bắn về hướng `face`: tường dày, mái dày, khe bắn ngang ngực ở mặt trước, cửa sau.
 * `big`: ụ pháo (casemate) lớn có nòng pháo thò ra khe.
 */
export function pillbox(b: Builder, x: number, y: number, z: number, face: number, big = false, tint = "#9c998a") {
  const W = big ? 9 : 6;
  const D = big ? 7 : 4.6;
  const H = big ? 3.2 : 2.6;
  const T = big ? 0.9 : 0.6;
  const c = Math.cos(face);
  const s = Math.sin(face);
  // Khung riêng: u ngang, v theo hướng bắn (v dương là mặt trước).
  const add = (u: number, yy: number, v: number, w: number, h: number, d: number, mat: BoxMat = "concrete", t = tint) =>
    b.add(x + u * c + v * s, y + yy, z - u * s + v * c, w, h, d, mat, { rot: face, tint: t });
  // Mặt trước: chân tường, khe bắn, đỉnh tường.
  add(0, 0.55, D / 2, W, 1.1, T);
  add(0, H - 0.4, D / 2, W, 0.8, T);
  add(-W / 2 + 0.4, 1.45, D / 2, 0.8, 0.7, T);
  add(W / 2 - 0.4, 1.45, D / 2, 0.8, 0.7, T);
  add(-W / 2, H / 2, 0, T, H, D);
  add(W / 2, H / 2, 0, T, H, D);
  // Mặt sau chừa cửa.
  add(-W / 4 - 0.6, H / 2, -D / 2, W / 2 - 1.2, H, T);
  add(W / 4 + 0.6, H / 2, -D / 2, W / 2 - 1.2, H, T);
  add(0, H + 0.35, 0, W + 0.8, 0.7, D + 0.8, "concrete", tint);
  if (big) add(0, 1.45, D / 2 + 1.6, 0.35, 0.35, 3.4, "metal", "#3e423c");
}

/**
 * Tường thành (đá, bê tông) chạy theo đường gấp khúc kín `ring` (toạ độ thế giới), dày `T`, cao `H`, chừa cổng ở
 * những đoạn có chỉ số trong `gates`; lối đi trên mặt thành (sàn gỗ phía trong) và lỗ châu mai trên đỉnh.
 */
export function rampart(b: Builder, ring: readonly Pt[], y: number, H: number, T: number, mat: BoxMat, tint: string, gates: readonly number[] = []) {
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const rot = alongRot(ux, uz);
    const mid = (t0: number, t1: number) => [ax + ux * ((t0 + t1) / 2), az + uz * ((t0 + t1) / 2)] as const;
    const pieces: [number, number][] = gates.includes(i) ? [[0, len / 2 - 2.6], [len / 2 + 2.6, len]] : [[0, len]];
    for (const [t0, t1] of pieces) {
      if (t1 - t0 < 0.5) continue;
      const [mx, mz] = mid(t0, t1);
      b.add(mx, y + H / 2, mz, t1 - t0 + T, H, T, mat, { rot, tint });
      // Răng cưa trên đỉnh thành (lỗ châu mai giữa các răng).
      for (let t = t0 + 1; t < t1 - 0.8; t += 2.2) b.add(ax + ux * t, y + H + 0.45, az + uz * t, 1.1, 0.9, T, mat, { rot, tint });
    }
  }
}

/** Tháp tròn góc thành (khối tám cạnh chồng hai hộp xoay 45°), cao H, có sàn bắn trên đỉnh. */
export function bastionTower(b: Builder, x: number, y: number, z: number, r: number, H: number, mat: BoxMat, tint: string) {
  b.add(x, y + H / 2, z, r * 1.6, H, r * 1.6, mat, { tint });
  b.add(x, y + H / 2, z, r * 1.6, H, r * 1.6, mat, { tint, rot: Math.PI / 4 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(x + Math.cos(a) * r * 0.85, y + H + 0.5, z + Math.sin(a) * r * 0.85, 1.2, 1, 0.6, mat, { tint, rot: -a + Math.PI / 2 });
  }
}

/** Nhà đổ nát: một toà nhà mà nhiều mảng tường, sàn đã sập (bỏ ngẫu nhiên phần lớn khối phía trên). */
export function ruin(b: Builder, build: () => void, keep: number) {
  const before = b.boxes.length;
  build();
  const kept: BattleBox[] = [];
  for (let i = before; i < b.boxes.length; i++) {
    const box = b.boxes[i]!;
    const low = box.y - b.site.h < 3.4 || box.part === "base";
    if (low || b.rand() < keep) kept.push(box);
    else if (b.rand() < 0.35 && box.part !== "floor" && box.part !== "roof") {
      // Mảng tường gãy còn trơ một nửa.
      kept.push({ ...box, h: box.h * 0.5, y: box.y - box.h * 0.25 });
    }
  }
  b.boxes.length = before;
  b.boxes.push(...kept);
  // Đống gạch vụn dưới chân.
  for (let k = 0; k < 4; k++) b.add((b.rand() - 0.5) * 10, 0.4, (b.rand() - 0.5) * 10, 2 + b.rand() * 2, 0.8, 1.5 + b.rand() * 2, "brick", { tint: "#8a6a58", rot: b.rand() * 3 });
}

// ---------------------------------------------------------------------------- công sự, căn cứ

/** Đánh dấu khối vừa thêm là mặt cầu (xe tăng chạy trên được). */
export function markDeck(b: Builder) {
  b.boxes[b.boxes.length - 1]!.deck = true;
}

/** Chỗ rơi vũ khí hạng nặng (súng máy, RPG, súng bắn tỉa hiếm). */
export function heavyLoot(b: Builder, u: number, y: number, v: number) {
  b.lootAt(u, y, v, 3);
  b.loot[b.loot.length - 1]!.kind = "heavy";
}

/** Chồng hòm đạn dã chiến (thùng gỗ sơn xanh quân đội). */
export function ammoCrates(b: Builder, u: number, v: number, rot: number) {
  const add = b.local(u, v, rot);
  add(-0.85, 0.4, 0, 1.6, 0.8, 1.0, "wood", { tint: "#4f5a32" });
  add(0.85, 0.4, 0, 1.6, 0.8, 1.0, "wood", { tint: "#55603a" });
  add(0, 1.2, 0, 1.6, 0.8, 1.0, "wood", { tint: "#4a5530" });
}

/** Công sự quanh cột cờ: vòng bao cát có lối vào, hai lô cốt bê tông có lỗ châu mai (tuỳ), tháp canh gỗ (tuỳ), cột cờ. */
export function stronghold(b: Builder, u0: number, v0: number, r: number, o: { tower?: boolean; bunkers?: boolean } = {}) {
  const add = b.local(u0, v0, 0);
  // Cột cờ (mảnh, không chặn đạn) và bệ.
  add(0, 0.25, 0, 1.6, 0.5, 1.6, "concrete", { tint: "#a8a596" });
  add(0, 4.5, 0, 0.12, 8, 0.12, "metal", { tint: "#d8d8d0", solid: false });
  // Vòng bao cát bán kính ~r/2, chừa bốn lối.
  const ring = r * 0.55;
  const segs = 16;
  for (let k = 0; k < segs; k++) {
    if (k % 4 === 0) continue;
    const a = (k / segs) * Math.PI * 2;
    const len = ((2 * Math.PI * ring) / segs) * 0.95;
    const au = Math.cos(a) * ring;
    const av = Math.sin(a) * ring;
    const piece = b.local(u0 + au, v0 + av, -a + Math.PI / 2);
    piece(0, 0.45, 0, len, 0.9, 0.9, "sandbag");
    piece(0, 1.15, 0, len * 0.9, 0.5, 0.8, "sandbag");
  }
  // Hai lô cốt đối diện nhau ở mép vùng chiếm.
  for (const side of o.bunkers === false ? [] : [-1, 1]) {
    const bk = b.local(u0 + side * r * 0.85, v0 + side * r * 0.25, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const W = 6;
    const D = 4.5;
    const H = 2.6;
    bk(0, H / 2, D / 2, W, H, 0.5, "concrete", { tint: "#9c998a" });
    bk(-W / 2, H / 2, 0, 0.5, H, D, "concrete", { tint: "#9c998a" });
    bk(W / 2, H / 2, 0, 0.5, H, D, "concrete", { tint: "#9c998a" });
    // Mặt trước có khe bắn ngang tầm ngực.
    bk(0, 0.55, -D / 2, W, 1.1, 0.5, "concrete", { tint: "#9c998a" });
    bk(0, H - 0.35, -D / 2, W, 0.7, 0.5, "concrete", { tint: "#9c998a" });
    bk(0, H + 0.25, 0, W + 0.6, 0.5, D + 0.6, "concrete", { tint: "#8b887a" });
    b.lootLocal(u0 + side * r * 0.85, v0 + side * r * 0.25, 0, 0, 0.05, 0, 2);
  }
  if (o.tower !== false) woodTower(b, u0 - r * 0.2, v0 + r * 0.9, 5.3);
}

/** Cột cờ trơn (khu đã có sẵn tường, nhà). */
export function flagPole(b: Builder, u0: number, v0: number) {
  const add = b.local(u0, v0, 0);
  add(0, 0.25, 0, 1.6, 0.5, 1.6, "concrete", { tint: "#a8a596" });
  add(0, 4.5, 0, 0.12, 8, 0.12, "metal", { tint: "#d8d8d0", solid: false });
}

/** Tháp canh gỗ bốn chân cao `H` mét, sàn có lan can, dốc gỗ lên (về phía −u). */
export function woodTower(b: Builder, tu: number, tv: number, H: number, tier?: 1 | 2 | 3) {
  const tw = b.local(tu, tv, 0);
  for (const lu of [-1.6, 1.6]) for (const lv of [-1.6, 1.6]) tw(lu, H / 2 - 0.05, lv, 0.3, H - 0.1, 0.3, "wood", { tint: "#6a5238" });
  tw(0, H, 0, 4, 0.25, 4, "wood", { tint: "#7a6040" });
  for (const [du, dv, w, d] of [
    [0, -1.9, 4, 0.15],
    [0, 1.9, 4, 0.15],
    [1.9, 0, 0.15, 4],
    [-1.9, 0, 0.15, 4],
  ] as const)
    tw(du, H + 0.6, dv, w, 0.9, d, "wood", { tint: "#7a6040" });
  const run = H * 1.5;
  const slope = Math.atan2(H, run);
  const ramp = b.local(tu - 2 - run / 2, tv, Math.PI / 2);
  ramp(0, H / 2, 0, 1.2, 0.2, Math.hypot(H, run), "wood", { tint: "#7a6040", pitch: slope });
  if (tier) b.lootAt(tu, H + 0.15, tv, tier);
}

/** Hòm đạn tiếp tế trước cổng căn cứ (toạ độ riêng của khu). */
export const SUPPLY_HQ = [31.5, -8] as const;
/** Sân đỗ trực thăng trong căn cứ (toạ độ riêng của khu; góc sân sau, xa bãi xe tăng). */
export const HELIPAD_HQ = [14, -18] as const;

/** Căn cứ: kho vũ khí có hàng rào, bãi đậu xe tăng bê tông, lều trại, hòm đạn tiếp tế, sân đỗ trực thăng. */
export function buildHq(b: Builder) {
  buildArmory(b);
  // Bãi đậu xe tăng trước căn cứ (phía trận địa).
  b.add(b.site.rx + 12, 0.03, 0, 18, 0.06, 30, "road", { solid: false, tint: "#6d6d68" });
  for (const v of [-9, 0, 9]) b.add(b.site.rx + 12, 0.035, v + 4.5, 17, 0.02, 0.2, "road", { solid: false, tint: "#e8e0c0" });
  ammoCrates(b, SUPPLY_HQ[0], SUPPLY_HQ[1], Math.PI / 2);
  // Sân đỗ trực thăng góc sân sau: bệ bê tông tròn (vẽ bằng tấm mỏng không chắn), vòng sơn vàng, chữ H.
  const [hu, hv] = HELIPAD_HQ;
  b.add(hu, 0.04, hv, 13, 0.08, 13, "road", { solid: false, tint: "#7b7b74" });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.add(hu + Math.cos(a) * 5.4, 0.085, hv + Math.sin(a) * 5.4, 0.35, 0.02, 2.6, "road", { solid: false, tint: "#e2c23a", rot: -a });
  }
  b.add(hu - 1.3, 0.09, hv, 0.5, 0.02, 4, "road", { solid: false, tint: "#f2f0e6" });
  b.add(hu + 1.3, 0.09, hv, 0.5, 0.02, 4, "road", { solid: false, tint: "#f2f0e6" });
  b.add(hu, 0.09, hv, 2.1, 0.02, 0.5, "road", { solid: false, tint: "#f2f0e6" });
}

/** Sân đỗ trực thăng của căn cứ (toạ độ thế giới, độ cao mặt sân). */
export function helipadOf(site: BattleSite) {
  return { ...toWorld(site, HELIPAD_HQ[0], HELIPAD_HQ[1]), y: site.h, rotY: site.rot + Math.PI / 2 };
}

/** Căn cứ phe: tâm khu, hướng ra mặt trận là trục +u của khu (bãi xe tăng ở phía +u). */
export function baseOf(site: BattleSite): WarBase {
  return { x: site.x, z: site.z, face: site.rot + Math.PI / 2 };
}

// ---------------------------------------------------------------------------- ráp bản đồ

/** Một khu trên chiến trường: cột cờ (nếu là cứ điểm), cách dựng, công sự quanh cột cờ. */
export interface WarSiteDef extends BattleSite {
  flag?: { u: number; v: number; r: number; letter: string };
  build: (b: Builder) => void;
  /** Quanh cột cờ: "stronghold" (bao cát, lô cốt, tháp canh), "pole" (chỉ cột cờ: khu đã có tường), mặc định stronghold. */
  fort?: "stronghold" | "pole" | "ring";
  /** Hòm đạn dã chiến (toạ độ riêng của khu). */
  supplies?: readonly (readonly [number, number])[];
}

export interface WarMapDef {
  id: string;
  half: number;
  extent: number;
  biome: Biome;
  /** Seed bố cục (cố định theo bản đồ). */
  layoutSeed: number;
  sites: readonly WarSiteDef[];
  /** Độ cao cuối cùng (đã san nền khu, khoét hào, hố bom). */
  height: (x: number, z: number) => number;
  /** Số mét vào sâu trong đất liền (âm là biển / sông lớn). */
  inland: (x: number, z: number) => number;
  /** Nền đường, sân khu khác: trả về loại nền (hay undefined). */
  ground?: (x: number, z: number) => Surface["ground"] | undefined;
  /** Dựng thêm khối theo toạ độ thế giới (chiến hào, dây thép gai, cầu...). */
  extra?: (b: Builder) => void;
  trees: (rand: () => number, world: World) => Tree[];
  grass: (rand: () => number, world: World) => GrassPatch[];
  /** Tên vùng ngoài các khu. */
  region: (x: number, z: number) => string;
  harbors?: readonly { x: number; z: number }[];
  emplacements?: readonly WarEmplacement[];
  route?: WarInfo["route"];
  /** Mìn chôn sẵn (bãi mìn). */
  mines?: (rand: () => number) => { x: number; z: number }[];
}

const assembled = new Map<string, BattleMap>();

/** Ráp bản đồ chiến trường từ định nghĩa: dựng các khu (căn cứ là hai khu đầu), cột cờ, công sự, cây cỏ. */
export function assembleWarMap(def: WarMapDef, seed: number): BattleMap {
  const key = `${def.id}:${seed}`;
  const hit = assembled.get(key);
  if (hit) return hit;
  const boxes: BattleBox[] = [];
  const loot: LootSpot[] = [];
  const supplies: { x: number; y: number; z: number }[] = [];
  const flags: FlagSpot[] = [];
  const layoutRand = makeRand(def.layoutSeed);
  let buildings = 0;
  for (const s of def.sites) {
    const b = new Builder(s, layoutRand);
    s.build(b);
    if (s.flag) {
      if (s.fort === "pole") flagPole(b, s.flag.u, s.flag.v);
      else stronghold(b, s.flag.u, s.flag.v, s.flag.r, { tower: s.fort !== "ring", bunkers: s.fort !== "ring" });
      const p = toWorld(s, s.flag.u, s.flag.v);
      flags.push({ id: s.flag.letter, name: s.name, x: p.x, z: p.z, y: s.h, r: s.flag.r });
    }
    for (const [u, v] of s.supplies ?? []) supplies.push({ ...toWorld(s, u, v), y: s.h });
    buildings = b.numberBuildings(buildings);
    boxes.push(...b.boxes);
    loot.push(...b.loot);
  }
  if (def.extra) {
    const b = freeBuilder(layoutRand);
    def.extra(b);
    buildings = b.numberBuildings(buildings);
    boxes.push(...b.boxes);
    loot.push(...b.loot);
  }
  const [hqb, hqr] = def.sites;
  for (const hq of [hqb!, hqr!]) supplies.push({ ...toWorld(hq, SUPPLY_HQ[0], SUPPLY_HQ[1]), y: hq.h });
  flags.sort((a, b) => (a.id < b.id ? -1 : 1));

  const inSite = (x: number, z: number, grow: number) => def.sites.find((s) => outside(s, x, z, grow) === 0) ?? null;
  const surface = (x: number, z: number): Surface => {
    const inland = def.inland(x, z);
    const st = inSite(x, z, 1);
    const road = !st ? def.ground?.(x, z) : undefined;
    return { island: inland < 0 && !st ? "sea" : "main", inland, islet: null, reef: false, pad: !!st || !!road, ground: st ? st.ground : road };
  };
  const world: World = {
    seed,
    kind: "battle",
    extent: def.extent,
    half: def.half,
    biome: def.biome,
    islets: [],
    reefs: [],
    structures: [],
    pois: [],
    pages: [],
    spawns: [],
    palms: [],
    trees: [],
    tallGrass: [],
    inTallGrass: (x, z) => world.tallGrass.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius * 0.85),
    heightAt: def.height,
    surface,
    zoneAt: (): ZoneId => "beach",
    regionAt: (x, z) => inSite(x, z, 10)?.name ?? def.region(x, z),
    structureAt: () => null,
    isClear: (x, z, margin) => !inSite(x, z, margin),
  };
  const rand = makeRand(subSeed(seed, def.id));
  // Đánh số lại cây cho chắc không trùng id giữa các cụm (server giữ cây đã đốn theo id).
  let palms = 0;
  let broad = 0;
  world.trees = def.trees(rand, world).map((t) => ({ ...t, id: t.kind === "palm" ? `p${palms++}` : `b${broad++}` }));
  world.palms = world.trees.filter((t) => t.kind === "palm").map((t) => ({ x: t.x, z: t.z, height: t.height, lean: t.lean }));
  world.tallGrass = def.grass(rand, world);
  const war: WarInfo = {
    id: def.id,
    bases: { blue: baseOf(hqb!), red: baseOf(hqr!) },
    helipads: { blue: helipadOf(hqb!), red: helipadOf(hqr!) },
    harbors: def.harbors ?? [],
    emplacements: def.emplacements ?? [],
    route: def.route,
  };
  const mines = def.mines ? def.mines(makeRand(subSeed(seed, `${def.id}:mines`))) : [];
  const map: BattleMap = { layout: "war", war, half: def.half, flags, world, sites: def.sites, boxes, loot, mines, supplies, index: buildIndex(boxes) };
  assembled.set(key, map);
  registerMap(map);
  return map;
}

/** Tiện ích rải cây theo cụm: `groves` tâm cụm, mỗi cụm rộng `spread`, tổng `n` cây, điều kiện `ok`. */
export function groveTrees(
  rand: () => number,
  world: World,
  o: { n: number; groves: number; spread: number; x0: number; z0: number; x1: number; z1: number; kind: Tree["kind"]; height: [number, number]; lean: [number, number]; gap: number; ok: (x: number, z: number) => boolean; idFrom?: number },
): Tree[] {
  const trees: Tree[] = [];
  const centers: Pt[] = [];
  for (let k = 0; k < o.groves; k++) centers.push([o.x0 + (o.x1 - o.x0) * rand(), o.z0 + (o.z1 - o.z0) * rand()]);
  const near = (x: number, z: number) => trees.some((t) => Math.abs(t.x - x) < o.gap && Math.abs(t.z - z) < o.gap && Math.hypot(t.x - x, t.z - z) < o.gap);
  for (let tries = 0; trees.length < o.n && tries < o.n * 20; tries++) {
    const g = centers[Math.floor(rand() * centers.length)]!;
    const x = g[0] + (rand() - 0.5) * o.spread;
    const z = g[1] + (rand() - 0.5) * o.spread;
    if (!o.ok(x, z) || !world.isClear(x, z, 6) || near(x, z)) continue;
    const id = `${o.kind === "palm" ? "p" : "b"}${(o.idFrom ?? 0) + trees.length}`;
    trees.push({ id, kind: o.kind, x, z, height: o.height[0] + rand() * (o.height[1] - o.height[0]), lean: o.lean[0] + rand() * (o.lean[1] - o.lean[0]) });
  }
  return trees;
}

/** Đám cỏ cao rải ngẫu nhiên trong vùng (x0, z0)–(x1, z1) chỗ `ok`. */
export function grassPatches(rand: () => number, world: World, n: number, x0: number, z0: number, x1: number, z1: number, ok: (x: number, z: number) => boolean): GrassPatch[] {
  const out: GrassPatch[] = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const x = x0 + (x1 - x0) * rand();
    const z = z0 + (z1 - z0) * rand();
    if (!ok(x, z) || !world.isClear(x, z, 10)) continue;
    out.push({ x, z, radius: 5 + rand() * 8 });
  }
  return out;
}

/** Nền khu: san phẳng theo độ cao `s.h`, chuyển dần trong `blend` mét ngoài mép. */
export function flattenSites(sites: readonly BattleSite[], x: number, z: number, h: number, blend = 18): number {
  for (const s of sites) {
    const out = outside(s, x, z);
    if (out > blend) continue;
    h = lerp(h, s.h, 1 - smooth(0, blend, out));
  }
  return h;
}

/** Tạo khu (độ cao nền lấy theo địa hình thô ở tâm, làm tròn nửa mét, tối thiểu `min`). */
export function siteOn(raw: (x: number, z: number) => number, o: Omit<WarSiteDef, "h" | "ground" | "kind"> & { ground?: BattleSite["ground"]; kind?: BattleSite["kind"]; h?: number }, min = 2): WarSiteDef {
  return { kind: "village", ground: "dirt", ...o, h: o.h ?? Math.max(min, Math.round(raw(o.x, o.z) * 2) / 2) };
}
