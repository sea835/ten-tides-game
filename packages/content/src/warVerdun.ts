import type { Builder } from "./battle.ts";
import { tower } from "./battle.ts";
import type { World } from "./worldgen.ts";
import { makeRand } from "./worldgen.ts";
import {
  CraterField,
  TrenchField,
  ammoCrates,
  bastionTower,
  buildHq,
  flattenSites,
  grassPatches,
  groveTrees,
  heavyLoot,
  lineTrench,
  pillbox,
  polyDist,
  rampart,
  ruin,
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

// Verdun (Pháp, 1916): đồi thấp bị đạn pháo cày nát thành "vùng đất không người" chi chít hố bom, rừng cháy trơ
// thân. Mỗi phe một hệ thống chiến hào Thế chiến I: hào tiền tuyến răng cưa, hào yểm trợ phía sau, hào giao thông nối
// hai tuyến, hầm trú ẩn, ổ súng máy; trước hào là các dải dây thép gai. Giữa trận địa là pháo đài Douaumont (A, tường
// bê tông đa giác, hào sâu bao quanh, tháp pháo), pháo đài Vaux (B) và làng Fleury đổ nát (C). Hai bên mỗi phe có
// một đồi (Mort-Homme, đồi 304; rừng Caures, Thiaumont).

const HALF = 330;
const HILLS = [
  { x: -170, z: 120, r: 55, h: 12 },
  { x: -160, z: -130, r: 55, h: 11 },
  { x: 170, z: 125, r: 55, h: 11 },
  { x: 165, z: -125, r: 55, h: 12 },
  { x: 0, z: 150, r: 70, h: 10 },
  { x: 15, z: -150, r: 60, h: 8 },
];

function raw(x: number, z: number): number {
  let h = 4 + 2.6 * Math.sin(x * 0.017 + 0.3) * Math.cos(z * 0.014 + 0.8) + 1.4 * Math.sin((x + z) * 0.029) + 0.7 * Math.cos(x * 0.06 - z * 0.05);
  for (const hl of HILLS) {
    const d = Math.hypot(x - hl.x, z - hl.z);
    if (d < hl.r) h += hl.h * smooth(hl.r, hl.r * 0.2, d);
  }
  // Mép bản đồ cao dần (khỏi lộ chân trời phẳng).
  h += 10 * smooth(HALF - 50, HALF - 5, Math.max(Math.abs(x), Math.abs(z)));
  return h;
}

const S = (o: Parameters<typeof siteOn>[1]) => siteOn(raw, o);

const SITES = [
  S({ id: "hqb", name: "Căn cứ Xanh", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0, build: buildHq }),
  S({ id: "hqr", name: "Căn cứ Đỏ", kind: "armory", ground: "concrete", x: 262, z: 0, rx: 30, rz: 26, rot: Math.PI, build: buildHq }),
  S({ id: "a", name: "Pháo đài Douaumont", kind: "fortress", ground: "stone", x: 0, z: 150, rx: 32, rz: 26, rot: 0, flag: { u: 0, v: 0, r: 16, letter: "A" }, fort: "pole", build: buildDouaumont }),
  S({ id: "b", name: "Pháo đài Vaux", kind: "fortress", ground: "stone", x: 15, z: -150, rx: 24, rz: 20, rot: 0.1, flag: { u: 0, v: 0, r: 15, letter: "B" }, fort: "pole", build: buildVaux }),
  S({ id: "c", name: "Làng Fleury đổ nát", kind: "city", ground: "dirt", x: 0, z: 0, rx: 28, rz: 24, rot: 0, flag: { u: 0, v: 0, r: 16, letter: "C" }, fort: "pole", build: buildFleury }),
  S({ id: "d", name: "Đồi Mort-Homme", x: -170, z: 120, rx: 20, rz: 18, rot: 0.2, flag: { u: 0, v: 0, r: 14, letter: "D" }, build: buildHillPost }),
  S({ id: "e", name: "Đồi 304", x: -160, z: -130, rx: 20, rz: 18, rot: -0.2, flag: { u: 0, v: 0, r: 14, letter: "E" }, build: buildHillPost }),
  S({ id: "f", name: "Rừng Caures", x: 170, z: 125, rx: 20, rz: 18, rot: 0.3, flag: { u: 0, v: 0, r: 14, letter: "F" }, build: buildHillPost }),
  S({ id: "g", name: "Ụ Thiaumont", x: 165, z: -125, rx: 20, rz: 18, rot: -0.3, flag: { u: 0, v: 0, r: 14, letter: "G" }, build: buildHillPost }),
];

/** Tuyến hào chạy bắc nam ở hoành độ x (răng cưa), chừa khoảng trống ở các khu. */
function frontLine(x: number, amp: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 0, z = -300; z <= 300; k++, z += 8) {
    const blocked = SITES.some((s) => Math.abs(s.x - x) < s.rx + 8 && Math.abs(s.z - z) < s.rz + 8);
    if (blocked) {
      if (cur.length > 2) out.push(cur);
      cur = [];
      continue;
    }
    cur.push([x + (k % 2 ? amp : -amp) + 3 * Math.sin(z * 0.02), z]);
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

const TRENCHES: Trench[] = [
  // Tiền tuyến, hào yểm trợ của hai phe.
  ...frontLine(-115, 3).map((pts) => ({ pts })),
  ...frontLine(-200, 2.5).map((pts) => ({ pts, depth: 1.6 })),
  ...frontLine(115, 3).map((pts) => ({ pts })),
  ...frontLine(200, 2.5).map((pts) => ({ pts, depth: 1.6 })),
  // Hào giao thông nối tiền tuyến với hào yểm trợ và căn cứ.
  ...[-90, -30, 40, 100, 170].flatMap((z) => [{ pts: zigzag([-197, z], [-118, z + 6], 2, 7) }, { pts: zigzag([197, z], [118, z - 6], 2, 7) }]),
  { pts: zigzag([-230, 8], [-203, 6], 2, 6) },
  { pts: zigzag([230, -8], [203, -6], 2, 6) },
];
const TF = new TrenchField(TRENCHES);

/** Hào sâu bao quanh pháo đài Douaumont (khoét địa hình). */
const MOAT = { x: 0, z: 150, rx: 40, rz: 33, w: 4, depth: 3 } as const;
function moatCut(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - MOAT.x) - MOAT.rx);
  const dz = Math.max(0, Math.abs(z - MOAT.z) - MOAT.rz);
  const inner = Math.max(Math.abs(x - MOAT.x) - MOAT.rx, Math.abs(z - MOAT.z) - MOAT.rz);
  const d = dx || dz ? Math.hypot(dx, dz) : -Math.min(MOAT.rx - Math.abs(x - MOAT.x), MOAT.rz - Math.abs(z - MOAT.z));
  if (inner < -MOAT.w * 2 || d > MOAT.w) return 0;
  // Lòng hào từ −w..w quanh viền hình chữ nhật, chừa cầu đất phía nam (cổng).
  if (Math.abs(x - MOAT.x) < 4 && z < MOAT.z) return 0;
  return MOAT.depth * (1 - smooth(MOAT.w * 0.4, MOAT.w, Math.abs(d)));
}

/** Vùng đất không người chi chít hố bom (dày nhất giữa hai tiền tuyến). */
const CRATERS = new CraterField([
  ...scatterCraters(makeRand(1916), 380, -105, -300, 105, 300, 1.4, 5, (x, z) => SITES.some((s) => Math.abs(s.x - x) < s.rx + 4 && Math.abs(s.z - z) < s.rz + 4)),
  ...scatterCraters(makeRand(1917), 160, -240, -300, 240, 300, 1.2, 3.5, (x, z) => TF.cut(x, z) > 0 || SITES.some((s) => Math.abs(s.x - x) < s.rx + 6 && Math.abs(s.z - z) < s.rz + 6) || Math.abs(x) > 228),
]);

function ground(x: number, z: number): number {
  return flattenSites(SITES, x, z, raw(x, z), 16) - moatCut(x, z);
}

function height(x: number, z: number): number {
  return ground(x, z) - TF.cut(x, z) + CRATERS.offset(x, z);
}

// ---------------------------------------------------------------------------- công trình

/**
 * Pháo đài Douaumont: tường bê tông dày bao quanh (đa giác), bốn ụ góc, tháp pháo 155 ly thò lên nóc, doanh trại
 * hai tầng bên trong, hành lang ngầm (cửa xuống), cổng phía nam qua cầu đất bắc qua hào.
 */
function buildDouaumont(b: Builder) {
  const W = 28;
  const D = 22;
  const wall = "#8f8c80";
  const ring: Pt[] = [
    [-W, -D + 6],
    [-W + 6, -D],
    [W - 6, -D],
    [W, -D + 6],
    [W, D - 6],
    [W - 6, D],
    [-W + 6, D],
    [-W, D - 6],
  ];
  // Rampart dựng theo toạ độ khu (b là bộ dựng của khu nên toạ độ là toạ độ riêng).
  rampart(b, ring, 0, 3.2, 1.6, "concrete", wall, [1]);
  for (const [u, v] of [
    [-W, -D],
    [W, -D],
    [W, D],
    [-W, D],
  ] as const)
    bastionTower(b, u * 0.92, 0, v * 0.92, 3.2, 3.8, "concrete", "#86837a");
  // Doanh trại bên trong (bê tông, hai tầng, mái phủ đất).
  tower(b, 0, 8, Math.PI, { floors: 2, w: 24, d: 9, mat: "concrete", tint: "#9c998d", tier: 2 });
  // Tháp pháo thép (vòm thấp) và đài quan sát trên nóc doanh trại.
  b.add(-8, 7.4, 8, 3.6, 1.2, 3.6, "metal", { tint: "#4b4e48" });
  b.add(-8, 7.6, 10.2, 0.4, 0.4, 3, "metal", { tint: "#393b36" });
  b.add(8, 7.3, 8, 2.4, 1, 2.4, "metal", { tint: "#4b4e48" });
  // Lô cốt góc nhìn ra hào.
  pillbox(b, -16, 0, -12, Math.PI, false, wall);
  pillbox(b, 16, 0, -12, Math.PI, false, wall);
  heavyLoot(b, 0, 0.05, -6);
  ammoCrates(b, 12, -4, 0);
}

/** Pháo đài Vaux: nhỏ hơn, tường đá bê tông, một tháp pháo, hầm trú ẩn, lối vào qua hào. */
function buildVaux(b: Builder) {
  const W = 20;
  const D = 15;
  const ring: Pt[] = [
    [-W, -D],
    [W, -D],
    [W, D],
    [-W, D],
  ];
  rampart(b, ring, 0, 3, 1.4, "stone", "#8a8476", [0, 2]);
  tower(b, 0, 4, 0, { floors: 2, w: 16, d: 8, mat: "stone", tint: "#958e7f", tier: 2 });
  b.add(6, 7, 4, 3, 1.1, 3, "metal", { tint: "#4b4e48" });
  for (const [u, v] of [
    [-W, -D],
    [W, D],
  ] as const)
    bastionTower(b, u, 0, v, 2.8, 3.6, "stone", "#827c6e");
  heavyLoot(b, 0, 0.05, -8);
}

/** Làng Fleury đổ nát: nhà đá sập gần hết, nhà thờ còn trơ tháp, đống gạch vụn, hầm rượu. */
function buildFleury(b: Builder) {
  for (const [u, v, rot] of [
    [-18, -14, 0],
    [-2, -16, 0],
    [16, -14, 0],
    [-18, 14, Math.PI],
    [2, 15, Math.PI],
    [18, 12, Math.PI],
  ] as const)
    ruin(b, () => tower(b, u, v, rot, { floors: 2, w: 9, d: 8, mat: "stone", tint: "#a59a86", tier: 1 }), 0.35);
  ruin(b, () => tower(b, -6, 0, 0, { floors: 3, w: 5, d: 5, mat: "stone", tint: "#b3a893", tier: 2 }), 0.6);
  for (let k = 0; k < 8; k++) b.add(-22 + k * 6, 0.45, -3 + (k % 3) * 3, 2.6, 0.9, 0.9, "sandbag");
  heavyLoot(b, 10, 0.05, 2);
}

/** Đồi: hầm trú ẩn gỗ, ổ súng máy bê tông, đài quan sát pháo binh, dây thép gai. */
function buildHillPost(b: Builder) {
  pillbox(b, 10, 0, 8, b.site.x < 0 ? Math.PI / 2 : -Math.PI / 2, false, "#8c887b");
  const add = b.local(-10, -8, 0);
  add(0, 0.9, 2.4, 7, 1.8, 0.4, "wood", { tint: "#5d4a34" });
  add(-3.4, 0.9, 0, 0.4, 1.8, 4.8, "wood", { tint: "#5d4a34" });
  add(3.4, 0.9, 0, 0.4, 1.8, 4.8, "wood", { tint: "#5d4a34" });
  add(0, 2, 0, 7.6, 0.4, 5.4, "wood", { tint: "#6a5238" });
  add(0, 2.5, 0, 7.2, 0.6, 5, "sandbag");
  b.lootAt(-10, 0.05, -8, 2);
  woodTower(b, -14, 10, 5.5, 2);
}

// ---------------------------------------------------------------------------- dây thép gai, hào

function extra(b: Builder) {
  // Kè hào: tiền tuyến kè bao cát mặt trước, hào yểm trợ, hào giao thông kè ván gỗ.
  for (const t of TRENCHES) lineTrench(b, t, ground, { mat: t.depth ? "wood" : "sandbag", sides: t.depth ? [1, -1] : [1] });
  // Hai dải dây thép gai trước mỗi tiền tuyến (chừa lối đi).
  for (const x of [-98, -88, 98, 88]) {
    for (let z = -290; z < 290; z += 30) {
      if (SITES.some((s) => Math.abs(s.x - x) < s.rx + 10 && Math.abs(s.z - z) < s.rz + 10)) continue;
      if (((z + 300) / 30) % 4 === (x < 0 ? 1 : 3)) continue;
      wireLine(b, [x, z], [x + 2, z + 24], ground);
    }
  }
}

function trees(rand: () => number, world: World) {
  // Rừng cháy: thân cao trơ trụi, tán nhỏ lơ thơ; còn rừng sau hai tuyến hào.
  const ok = (x: number, z: number) => !TF.inside(x, z) && Math.abs(x) < HALF - 6 && Math.abs(z) < HALF - 6;
  const burnt = groveTrees(rand, world, { n: 220, groves: 40, spread: 44, x0: -200, z0: -300, x1: 200, z1: 300, kind: "broadleaf", height: [5, 9], lean: [0.3, 0.55], gap: 5, ok });
  const woods = groveTrees(rand, world, { n: 420, groves: 26, spread: 60, x0: -320, z0: -320, x1: 320, z1: 320, kind: "broadleaf", height: [7, 11], lean: [0.85, 1.2], gap: 4.5, ok: (x, z) => ok(x, z) && Math.abs(x) > 205, idFrom: burnt.length });
  return [...burnt, ...woods];
}

export const VERDUN: WarMapDef = {
  id: "verdun",
  half: HALF,
  extent: 300,
  biome: "mud",
  layoutSeed: 19160221,
  sites: SITES,
  height,
  inland: () => 200,
  ground: (x, z) => (TF.inside(x, z) || moatCut(x, z) > 1 ? "dirt" : undefined),
  extra,
  trees,
  grass: (rand, world) => grassPatches(rand, world, 40, -300, -300, 300, 300, (x, z) => Math.abs(x) > 210 && !TF.inside(x, z)),
  region: (x, z) => {
    if (TF.inside(x, z)) return "Chiến hào";
    if (moatCut(x, z) > 1) return "Hào pháo đài";
    if (Math.abs(x) < 100) return "Vùng đất không người";
    if (polyDist([[x < 0 ? -200 : 200, -300], [x < 0 ? -200 : 200, 300]], x, z) < 30) return "Tuyến yểm trợ";
    return x < 0 ? "Trận địa phía Tây" : "Trận địa phía Đông";
  },
  emplacements: [
    { kind: "mortar", x: -210, z: 60, rotY: Math.PI / 2 },
    { kind: "mortar", x: -210, z: -70, rotY: Math.PI / 2 },
    { kind: "mortar", x: 210, z: 60, rotY: -Math.PI / 2 },
    { kind: "mortar", x: 210, z: -70, rotY: -Math.PI / 2 },
    { kind: "mortar", x: 0, z: 168, rotY: Math.PI },
    { kind: "hmg_nest", x: -122, z: 30, rotY: Math.PI / 2 },
    { kind: "hmg_nest", x: -122, z: -60, rotY: Math.PI / 2 },
    { kind: "hmg_nest", x: 122, z: -30, rotY: -Math.PI / 2 },
    { kind: "hmg_nest", x: 122, z: 60, rotY: -Math.PI / 2 },
  ],
};
