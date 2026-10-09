import type { Builder } from "./battle.ts";
import { tower } from "./battle.ts";
import type { World } from "./worldgen.ts";
import {
  CraterField,
  TrenchField,
  ammoCrates,
  buildHq,
  flattenSites,
  grassPatches,
  groveTrees,
  heavyLoot,
  lineTrench,
  markDeck,
  pillbox,
  polyDist,
  scatterCraters,
  siteOn,
  smooth,
  wireLine,
  woodTower,
  zigzag,
  type Pt,
  type Trench,
  type WarMapDef,
} from "./warKit.ts";
import { makeRand } from "./worldgen.ts";

// Lòng chảo Điện Biên (Điện Biên Phủ, Việt Nam): thung lũng Mường Thanh phẳng rộng giữa vòng núi rừng rậm, sông Nậm
// Rốm cạn chảy từ bắc xuống nam (lội qua được), cầu thép Mường Thanh. Các cứ điểm trên đồi: Him Lam (A), Độc Lập (B),
// đồi A1 (C, hố bộc phá trên đỉnh), hầm chỉ huy Đờ Cát giữa lòng chảo (D), sân bay Mường Thanh (E), Hồng Cúm (F),
// Bản Kéo (G). Hệ thống chiến hào răng cưa bao vây, nối các cứ điểm; lô cốt, ụ pháo trên đồi; dây thép gai.

const HALF = 336;
/** Lòng chảo: elip bán trục 300 × 168 m, đáy cao 2,2 m. */
const BASIN = { ax: 300, az: 168 } as const;

const HILLS = [
  { x: 175, z: 120, r: 46, h: 13 },
  { x: -60, z: 150, r: 42, h: 14 },
  { x: 70, z: -15, r: 38, h: 11 },
  { x: 78, z: 42, r: 24, h: 6 },
  { x: 112, z: -62, r: 24, h: 6 },
  { x: -150, z: -120, r: 42, h: 10 },
  { x: 60, z: -155, r: 36, h: 9 },
  { x: -200, z: 110, r: 40, h: 7 },
  { x: 200, z: -115, r: 38, h: 7 },
];

/** Sông Nậm Rốm: chảy bắc → nam, lòng cạn (lội được), bờ thoải. */
const RIVER: readonly Pt[] = [
  [40, 340],
  [30, 165],
  [14, 62],
  [24, 0],
  [10, -82],
  [26, -172],
  [16, -340],
];
const RIVER_BED = 5;
const RIVER_BANK = 13;
const RIVER_FLOOR = -0.7;

/** Đường băng sân bay Mường Thanh (bắc nam). */
const RUNWAY = { x: -120, z0: -140, z1: 100, half: 14 } as const;

function basinE(x: number, z: number): number {
  return Math.hypot(x / BASIN.ax, z / BASIN.az);
}

function raw(x: number, z: number): number {
  const e = basinE(x, z);
  let h = 2.2 + 0.35 * Math.sin(x * 0.03 + 0.4) * Math.cos(z * 0.027);
  // Vòng núi quanh lòng chảo: dốc dần rồi dựng đứng, sống núi lượn sóng.
  const up = smooth(0.96, 1.5, e);
  h += up * (30 + 7 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + 4 * Math.sin((x + z) * 0.04));
  for (const hl of HILLS) {
    const d = Math.hypot(x - hl.x, z - hl.z);
    if (d < hl.r) h += hl.h * smooth(hl.r, hl.r * 0.18, d) * (0.9 + 0.1 * Math.sin(x * 0.2 + z * 0.15));
  }
  return h;
}

const S = (o: Parameters<typeof siteOn>[1]) => siteOn(raw, o);

const SITES = [
  S({ id: "hqb", name: "Căn cứ Xanh", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0, build: buildHq }),
  S({ id: "hqr", name: "Căn cứ Đỏ", kind: "armory", ground: "concrete", x: 262, z: 0, rx: 30, rz: 26, rot: Math.PI, build: buildHq }),
  S({ id: "a", name: "Đồi Him Lam", x: 175, z: 120, rx: 20, rz: 18, rot: 0.4, flag: { u: 0, v: 0, r: 14, letter: "A" }, fort: "ring", build: hillFort }),
  S({ id: "b", name: "Đồi Độc Lập", x: -60, z: 150, rx: 20, rz: 18, rot: -0.3, flag: { u: 0, v: 0, r: 14, letter: "B" }, fort: "ring", build: hillFort }),
  S({ id: "c", name: "Đồi A1", ground: "dirt", x: 70, z: -15, rx: 22, rz: 20, rot: 0.15, flag: { u: 0, v: -4, r: 15, letter: "C" }, fort: "ring", build: buildA1 }),
  S({ id: "d", name: "Hầm chỉ huy Đờ Cát", ground: "dirt", x: -30, z: 10, rx: 22, rz: 20, rot: 0, flag: { u: 0, v: -11, r: 15, letter: "D" }, fort: "pole", build: buildCommand, supplies: [[14, 12]] }),
  S({ id: "e", name: "Sân bay Mường Thanh", kind: "armory", ground: "concrete", x: RUNWAY.x, z: -30, rx: 18, rz: 34, rot: 0, flag: { u: 0, v: 0, r: 16, letter: "E" }, fort: "ring", build: buildAirfield }),
  S({ id: "f", name: "Cứ điểm Hồng Cúm", x: 60, z: -155, rx: 20, rz: 18, rot: 0.2, flag: { u: 0, v: 0, r: 14, letter: "F" }, build: hamletFort }),
  S({ id: "g", name: "Đồi Bản Kéo", x: -150, z: -120, rx: 20, rz: 18, rot: -0.5, flag: { u: 0, v: 0, r: 14, letter: "G" }, build: hamletFort }),
];

/** Chiến hào: bao quanh các cứ điểm, đường tiến từ hai căn cứ, đường giao thông hào nối cứ điểm. */
function ring(cx: number, cz: number, r: number, n: number, zig: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r + (k % 2 ? zig : -zig);
    pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  pts.push(pts[0]!);
  return pts;
}

const TRENCHES: Trench[] = [
  { pts: ring(-30, 10, 34, 16, 2.2) },
  { pts: ring(70, -15, 27, 14, 2), depth: 1.4 },
  { pts: ring(175, 120, 23, 12, 1.8), depth: 1.3 },
  { pts: ring(-150, -120, 23, 12, 1.8), depth: 1.3 },
  { pts: zigzag([-226, 22], [-140, 34], 3, 7) },
  { pts: zigzag([-98, 26], [-64, 16], 2.5, 6) },
  { pts: zigzag([226, -22], [150, -34], 3, 7) },
  { pts: zigzag([150, -34], [97, -22], 2.5, 6) },
  { pts: zigzag([-58, 128], [-36, 46], 2.5, 7) },
  { pts: zigzag([62, -135], [70, -43], 2.5, 7) },
  { pts: zigzag([-170, -100], [-170, 90], 3, 8) },
  { pts: zigzag([170, -100], [182, 96], 3, 8) },
  { pts: zigzag([-200, -40], [-150, -100], 2.5, 7) },
  { pts: zigzag([195, 40], [175, 96], 2.5, 7) },
];
const TF = new TrenchField(TRENCHES);

/** Hố đạn pháo quanh đồi A1, hầm Đờ Cát và sân bay. */
const CRATERS = new CraterField(
  scatterCraters(makeRand(1954), 70, -110, -90, 140, 80, 1.6, 4.2, (x, z) => polyDist(RIVER, x, z) < RIVER_BANK + 4 || Math.abs(x - RUNWAY.x) < RUNWAY.half + 4 || SITES.some((s) => Math.hypot(s.x - x, s.z - z) < 14)),
);

/** Độ cao trước khi khoét chiến hào (để đặt bao cát trên mép hào). */
function ground(x: number, z: number): number {
  let h = flattenSites(SITES, x, z, raw(x, z));
  // Sông: lòng cạn bờ thoải; ra xa hẳn thì thôi.
  if (x > -40 && x < 90) {
    const d = polyDist(RIVER, x, z);
    if (d < RIVER_BANK) h = Math.min(h, RIVER_FLOOR + (h - RIVER_FLOOR) * smooth(RIVER_BED, RIVER_BANK, d));
  }
  return h;
}

function height(x: number, z: number): number {
  return ground(x, z) - TF.cut(x, z) + CRATERS.offset(x, z);
}

// ---------------------------------------------------------------------------- công trình

/** Cứ điểm trên đồi: lô cốt quay ra bốn phía, ụ súng cối bao cát, hầm ngầm mái gỗ phủ đất, dây thép gai. */
function hillFort(b: Builder) {
  for (const [u, v, rot] of [
    [-12, -9, Math.PI],
    [12, 9, 0],
    [12, -9, Math.PI / 2],
  ] as const)
    pillbox(b, u, 0, v, rot, false, "#8f8a78");
  dugout(b, -10, 8);
  // Ụ súng cối tròn bao cát.
  const pit = b.local(4, -12, 0);
  for (let k = 0; k < 7; k++) {
    const a = (k / 8) * Math.PI * 2;
    pit(Math.cos(a) * 2.4, 0.45, Math.sin(a) * 2.4, 1.9, 0.9, 0.8, "sandbag", { pitch: 0 });
  }
  b.lootAt(4, 0.05, -12, 2);
  woodTower(b, -15, -4, 5.5, 2);
}

/** Hầm ngầm kiểu Pháp: tường gỗ, mái gỗ phủ bao cát dày, cửa xuống phía sau. */
function dugout(b: Builder, u: number, v: number) {
  const add = b.local(u, v, 0);
  add(0, 0.9, 2.6, 7, 1.8, 0.4, "wood", { tint: "#5d4a34" });
  add(-3.4, 0.9, 0, 0.4, 1.8, 5.2, "wood", { tint: "#5d4a34" });
  add(3.4, 0.9, 0, 0.4, 1.8, 5.2, "wood", { tint: "#5d4a34" });
  add(-2, 0.9, -2.6, 3, 1.8, 0.4, "wood", { tint: "#5d4a34" });
  add(0, 2, 0, 7.6, 0.4, 5.8, "wood", { tint: "#6a5238" });
  add(0, 2.55, 0, 7.2, 0.7, 5.4, "sandbag");
  b.lootAt(u, 0.05, v, 2);
}

/** Đồi A1: hầm ngầm lớn, lô cốt, nhà chỉ huy đổ nát, hố bộc phá khổng lồ trên đỉnh (cạnh cột cờ). */
function buildA1(b: Builder) {
  hillFort(b);
  // Hầm Pháp xây bê tông dưới đỉnh đồi (hố bộc phá 1 000 kg nổ ngay trên nóc).
  const bunker = b.local(-6, 10, 0);
  bunker(0, 1.3, 3, 10, 2.6, 0.7, "concrete", { tint: "#8f8a78" });
  bunker(-5, 1.3, 0, 0.7, 2.6, 6.6, "concrete", { tint: "#8f8a78" });
  bunker(5, 1.3, 0, 0.7, 2.6, 6.6, "concrete", { tint: "#8f8a78" });
  bunker(0, 2.95, 0, 11, 0.7, 7, "concrete", { tint: "#7d7868" });
  // Tường đá đổ dựng quanh hố bộc phá.
  for (let k = 0; k < 6; k++) b.add(10 + Math.cos(k) * 7, 0.5, 6 + Math.sin(k) * 7, 2.4, 1, 1.4, "stone", { tint: "#6d6152", rot: k });
  heavyLoot(b, -6, 0.05, 10);
  ammoCrates(b, 14, -6, 0);
}

/** Hầm chỉ huy Đờ Cát: hầm lớn mái vòm (khối chồng bao cát), giao thông hào, xe tăng M24 hỏng, đài quan sát. */
function buildCommand(b: Builder) {
  const add = b.local(0, 3, 0);
  // Hầm: tường bê tông, nóc thép phủ ba lớp bao cát, hai cửa xuống.
  add(0, 1.5, 6, 18, 3, 0.8, "concrete", { tint: "#8b8676" });
  add(-9, 1.5, 0, 0.8, 3, 12.8, "concrete", { tint: "#8b8676" });
  add(9, 1.5, 0, 0.8, 3, 12.8, "concrete", { tint: "#8b8676" });
  add(-5.5, 1.5, -6, 7, 3, 0.8, "concrete", { tint: "#8b8676" });
  add(5.5, 1.5, -6, 7, 3, 0.8, "concrete", { tint: "#8b8676" });
  add(0, 3.3, 0, 19, 0.6, 13.6, "metal", { tint: "#4e4f48" });
  add(0, 3.95, 0, 18, 0.7, 12.6, "sandbag");
  add(0, 4.6, 0, 14, 0.6, 9, "sandbag");
  // Bên trong: bàn bản đồ, giường, hòm đồ hiếm.
  add(-3, 0.45, 2, 3, 0.9, 1.6, "wood", { tint: "#5e4a32" });
  b.lootAt(-3, 0.05, 6.5, 3);
  b.lootAt(4, 0.05, 1, 3);
  // Xe tăng M24 Chaffee hỏng (thân, tháp, nòng).
  const tank = b.local(-14, -10, 0.6);
  tank(0, 0.8, 0, 3, 1.4, 5.2, "metal", { tint: "#4b5032" });
  tank(0, 1.95, -0.2, 2, 0.9, 2.4, "metal", { tint: "#545a38" });
  tank(0, 2, 2.4, 0.22, 0.22, 3, "metal", { tint: "#3a3d2b" });
  // Bao cát quanh sân, hòm đạn.
  for (let k = 0; k < 6; k++) b.add(-16 + k * 6.4, 0.45, 15, 3.2, 0.9, 0.9, "sandbag");
  ammoCrates(b, 14, 12, 0);
  woodTower(b, 15, -12, 6, 2);
}

/** Sân bay Mường Thanh: đường băng bê tông (nền khu), máy bay vận tải C-47 bị bắn hỏng, ụ đất che máy bay, nhà kho. */
function buildAirfield(b: Builder) {
  // Máy bay vận tải hỏng nằm nghiêng (thân, cánh, đuôi).
  for (const [u, v, rot] of [
    [-7, 16, 0.3],
    [8, -18, -2.6],
  ] as const) {
    const p = b.local(u, v, rot);
    p(0, 1.4, 0, 2.6, 2.4, 19, "metal", { tint: "#7a7d72" });
    p(0, 1.6, 2, 28, 0.35, 3.4, "metal", { tint: "#6f7268" });
    p(0, 3.1, -8.6, 0.3, 3, 2.6, "metal", { tint: "#6f7268" });
    p(0, 1.8, -8.6, 9, 0.3, 2, "metal", { tint: "#6f7268" });
  }
  // Ụ đất hình chữ U che máy bay (bao cát).
  for (const side of [-1, 1]) {
    const rv = b.local(side * 14, 0, 0);
    rv(0, 0.9, -6, 0.9, 1.8, 10, "sandbag");
    rv(0, 0.9, 6, 0.9, 1.8, 10, "sandbag");
    rv(side * 4, 0.9, 0, 8, 1.8, 0.9, "sandbag");
  }
  // Nhà kho mái tôn, tháp chỉ huy bay gỗ.
  tower(b, -12, -26, Math.PI / 2, { floors: 1, w: 12, d: 9, mat: "metal", tint: "#7b7f74", tier: 2 });
  woodTower(b, 12, 26, 7, 2);
  heavyLoot(b, 0, 0.05, -4);
}

/** Cứ điểm làng bản: nhà sàn gỗ, hàng rào tre, lô cốt bao cát. */
function hamletFort(b: Builder) {
  for (const [u, v] of [
    [-12, -8],
    [12, -10],
    [-12, 10],
  ] as const)
    tower(b, u, v, (Math.floor(b.rand() * 4) * Math.PI) / 2, { floors: 1, w: 8, d: 7, pitched: true, tier: 1, mat: "wood" });
  dugout(b, 13, 10);
}

// ---------------------------------------------------------------------------- chiến hào, cầu, dây thép gai

function extra(b: Builder) {
  for (const t of TRENCHES) lineTrench(b, t, ground, { mat: "sandbag", sides: [1] });
  // Dây thép gai trước các cứ điểm trên đồi và quanh sân bay.
  for (const [cx, cz, r] of [
    [175, 120, 30],
    [70, -15, 33],
    [-60, 150, 28],
    [-150, -120, 28],
  ] as const) {
    for (let k = 0; k < 10; k++) {
      if (k % 3 === 0) continue;
      const a0 = (k / 10) * Math.PI * 2;
      const a1 = ((k + 1) / 10) * Math.PI * 2;
      wireLine(b, [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r], ground);
    }
  }
  // Cầu thép Mường Thanh qua sông Nậm Rốm (mặt cầu ngang bờ, xe tăng chạy được).
  const bz = -40;
  const bx = riverX(bz);
  const top = 2.4;
  b.add(bx, top - 0.3, bz, 34, 0.6, 7, "concrete", { tint: "#8e8b82" });
  markDeck(b);
  for (const side of [-1, 1]) {
    b.add(bx, top + 0.55, bz + side * 3.3, 34, 1.1, 0.35, "metal", { tint: "#55605c" });
    for (let k = -2; k <= 2; k++) b.add(bx + k * 7, top + 2.2, bz + side * 3.3, 0.35, 4.4, 0.35, "metal", { tint: "#55605c" });
    b.add(bx, top + 4.3, bz + side * 3.3, 30, 0.35, 0.35, "metal", { tint: "#55605c" });
  }
}

/** Hoành độ tim sông ở độ z. */
function riverX(z: number): number {
  for (let i = 1; i < RIVER.length; i++) {
    const [x1, z1] = RIVER[i]!;
    if (z >= z1) {
      const [x0, z0] = RIVER[i - 1]!;
      return x0 + ((x1 - x0) * (z0 - z)) / (z0 - z1);
    }
  }
  return RIVER[RIVER.length - 1]![0];
}

function trees(rand: () => number, world: World) {
  const open = (x: number, z: number) => polyDist(RIVER, x, z) > RIVER_BANK + 3 && !TF.inside(x, z) && Math.abs(x - RUNWAY.x) > RUNWAY.half + 8;
  // Rừng già trên vòng núi và sườn đồi, rừng thưa trong lòng chảo, chuối dừa quanh bản.
  const forest = groveTrees(rand, world, { n: 900, groves: 70, spread: 70, x0: -HALF, z0: -HALF, x1: HALF, z1: HALF, kind: "broadleaf", height: [7, 12], lean: [0.95, 1.4], gap: 4.2, ok: (x, z) => Math.abs(x) < HALF - 6 && Math.abs(z) < HALF - 6 && basinE(x, z) > 0.9 && open(x, z) });
  const valley = groveTrees(rand, world, { n: 220, groves: 30, spread: 40, x0: -240, z0: -140, x1: 240, z1: 140, kind: "broadleaf", height: [5, 9], lean: [0.85, 1.25], gap: 5, ok: (x, z) => basinE(x, z) < 0.92 && open(x, z), idFrom: forest.length });
  const palms = groveTrees(rand, world, { n: 70, groves: 10, spread: 30, x0: -240, z0: -160, x1: 240, z1: 160, kind: "palm", height: [6, 9], lean: [-0.2, 0.2], gap: 4, ok: (x, z) => basinE(x, z) < 0.95 && open(x, z) });
  return [...forest, ...valley, ...palms];
}

export const DIENBIEN: WarMapDef = {
  id: "dienbien",
  half: HALF,
  extent: 300,
  biome: "jungle",
  layoutSeed: 19540507,
  sites: SITES,
  height,
  inland: (x, z) => (polyDist(RIVER, x, z) < RIVER_BED ? -1 : 200),
  ground: (x, z) => (Math.abs(x - RUNWAY.x) < RUNWAY.half && z > RUNWAY.z0 && z < RUNWAY.z1 ? "concrete" : TF.inside(x, z) ? "dirt" : undefined),
  extra,
  trees,
  grass: (rand, world) => grassPatches(rand, world, 90, -250, -150, 250, 150, (x, z) => basinE(x, z) < 0.9 && polyDist(RIVER, x, z) > RIVER_BANK && Math.abs(x - RUNWAY.x) > RUNWAY.half + 6 && !TF.inside(x, z)),
  region: (x, z) => {
    if (polyDist(RIVER, x, z) < RIVER_BANK) return "Sông Nậm Rốm";
    if (TF.inside(x, z)) return "Chiến hào";
    if (Math.abs(x - RUNWAY.x) < RUNWAY.half && z > RUNWAY.z0 && z < RUNWAY.z1) return "Đường băng";
    if (basinE(x, z) > 1.05) return z > 0 ? "Núi phía Bắc" : "Núi phía Nam";
    return "Lòng chảo Mường Thanh";
  },
  emplacements: [
    { kind: "mortar", x: 160, z: 104, rotY: -2.2 },
    { kind: "mortar", x: -46, z: 136, rotY: 2.6 },
    { kind: "mortar", x: 56, z: -30, rotY: -1.6 },
    { kind: "mortar", x: -136, z: -106, rotY: 1.2 },
    { kind: "mortar", x: -48, z: 30, rotY: 1.6 },
    { kind: "hmg_nest", x: 92, z: -14, rotY: -Math.PI / 2 },
    { kind: "hmg_nest", x: -8, z: 30, rotY: Math.PI / 2 },
  ],
};
