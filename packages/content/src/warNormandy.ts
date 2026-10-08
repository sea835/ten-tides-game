import type { Builder } from "./battle.ts";
import { tower } from "./battle.ts";
import type { World } from "./worldgen.ts";
import { makeRand } from "./worldgen.ts";
import {
  CraterField,
  TrenchField,
  alongRot,
  ammoCrates,
  buildHq,
  flattenSites,
  grassPatches,
  groveTrees,
  heavyLoot,
  lerp,
  lineTrench,
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

// Bãi Omaha (Normandy, Pháp, 6/6/1944): biển phía bắc, bãi cát rộng có chướng ngại chống đổ bộ (nhím thép, cọc gỗ),
// tường chắn sóng, rồi vách đá dựng cao 16 m với ba hẻm (Vierville, Les Moulins, Colleville) thoải cho xe lên. Trên
// cao nguyên là "Bức tường Đại Tây Dương": lô cốt, ụ pháo 88 ly, chiến hào chạy dọc mép vách; phía trong là đồng ruộng
// chia ô bởi bờ giậu (bocage), hai làng Saint-Laurent và Colleville. Phía đông là mũi Hoc: vách đá dựng đứng xuống
// biển, ụ pháo bê tông giữa chi chít hố bom. Phe Xanh đổ bộ từ bãi biển phía tây, phe Đỏ giữ cao nguyên phía đông nam.

const HALF = 336;
const PLATEAU = 18;
/** Ba hẻm (draw) có đường lên cao nguyên. */
const DRAWS = [-180, 0, 170];

/** Mũi Hoc phía đông: 0 ngoài mũi, 1 trên mũi. */
const head = (x: number) => smooth(205, 236, x);
/** Mép nước, chân vách, đỉnh vách (theo z) ở hoành độ x. */
function coastZ(x: number): number {
  return lerp(150 + 6 * Math.sin(x * 0.02) + 3 * Math.sin(x * 0.07), 205, head(x));
}
function footZ(x: number): number {
  return lerp(96, 199, head(x));
}
function topZ(x: number): number {
  return lerp(68, 195, head(x));
}
function drawness(x: number): number {
  let d = 0;
  for (const dx of DRAWS) d = Math.max(d, 1 - smooth(14, 32, Math.abs(x - dx)));
  return d * (1 - head(x));
}

function inland(x: number, z: number): number {
  return coastZ(x) - z;
}

function raw(x: number, z: number): number {
  const off = inland(x, z);
  if (off < 0) return -2.2 * smooth(0, 10, -off) - 9 * smooth(12, 80, -off) - 6 * head(x) * smooth(0, 4, -off);
  const beach = 2.2 * smooth(0, coastZ(x) - footZ(x), off);
  const dw = drawness(x);
  const steep = smooth(footZ(x), topZ(x), z);
  const gentle = smooth(118, 18, z);
  const climb = lerp(steep, gentle, dw);
  const plateau = PLATEAU + 2.2 * Math.sin(x * 0.019 + 0.6) * Math.cos(z * 0.021) + 1.2 * Math.sin((x - z) * 0.033);
  // Vách đá mũi Hoc rơi thẳng xuống biển (không có bãi).
  return lerp(beach, plateau, climb) * (1 - head(x)) + plateau * head(x) * smooth(0, 3, off);
}

const S = (o: Parameters<typeof siteOn>[1]) => siteOn(raw, o);

const SITES = [
  S({ id: "hqb", name: "Căn cứ Xanh (bãi đổ bộ)", kind: "armory", ground: "concrete", x: -262, z: 122, rx: 30, rz: 22, rot: 0, h: 2.5, build: buildHq }),
  S({ id: "hqr", name: "Căn cứ Đỏ", kind: "armory", ground: "concrete", x: 240, z: -205, rx: 30, rz: 26, rot: -2.45, build: buildHq }),
  S({ id: "a", name: "Bãi Dog Green", ground: "dirt", x: -110, z: 122, rx: 22, rz: 16, rot: 0, h: 1.9, flag: { u: 0, v: 0, r: 15, letter: "A" }, fort: "ring", build: buildBeach }),
  S({ id: "b", name: "Hẻm Vierville (WN-72)", ground: "stone", x: -180, z: 58, rx: 20, rz: 16, rot: 0, flag: { u: 0, v: -4, r: 14, letter: "B" }, fort: "pole", build: (b) => buildStrongpoint(b, Math.PI * 0.75) }),
  S({ id: "c", name: "Hẻm Les Moulins (WN-66)", ground: "stone", x: 0, z: 56, rx: 20, rz: 16, rot: 0, flag: { u: 0, v: -4, r: 14, letter: "C" }, fort: "pole", build: (b) => buildStrongpoint(b, Math.PI * 0.25) }),
  S({ id: "d", name: "Làng Saint-Laurent", kind: "city", ground: "asphalt", x: -70, z: -80, rx: 28, rz: 24, rot: 0.1, flag: { u: 0, v: 0, r: 15, letter: "D" }, fort: "pole", build: buildVillage }),
  S({ id: "e", name: "Lô cốt WN-62", ground: "stone", x: 150, z: 52, rx: 20, rz: 16, rot: 0, flag: { u: 0, v: -4, r: 14, letter: "E" }, fort: "pole", build: (b) => buildStrongpoint(b, -Math.PI * 0.15) }),
  S({ id: "f", name: "Mũi Hoc", ground: "stone", x: 268, z: 150, rx: 22, rz: 20, rot: 0, flag: { u: 0, v: 0, r: 15, letter: "F" }, fort: "ring", build: buildPointe }),
  S({ id: "g", name: "Làng Colleville", kind: "city", ground: "asphalt", x: 140, z: -95, rx: 26, rz: 22, rot: -0.2, flag: { u: 0, v: 0, r: 15, letter: "G" }, fort: "pole", build: buildVillage }),
];

/** Đường đất từ ba hẻm lên làng, nối hai làng với căn cứ Đỏ. */
const ROADS: readonly (readonly Pt[])[] = [
  [
    [-180, 110],
    [-182, 40],
    [-120, -40],
    [-70, -80],
  ],
  [
    [0, 110],
    [2, 20],
    [-40, -60],
  ],
  [
    [170, 110],
    [165, 30],
    [140, -95],
    [200, -170],
  ],
  [
    [-70, -80],
    [40, -90],
    [140, -95],
  ],
];
const onRoad = (x: number, z: number, grow = 0) => ROADS.some((r) => polyDist(r, x, z) < 3.5 + grow);

/** Chiến hào dọc mép vách (Bức tường Đại Tây Dương) và hào giao thông vào làng. */
const TRENCHES: Trench[] = [
  { pts: zigzag([-236, 50], [-200, 46], 2.5, 7) },
  { pts: zigzag([-160, 44], [-22, 44], 2.5, 7) },
  { pts: zigzag([22, 42], [128, 40], 2.5, 7) },
  { pts: zigzag([172, 36], [230, 60], 2.5, 7) },
  { pts: zigzag([-110, 40], [-80, -50], 2.5, 7) },
  { pts: zigzag([90, 38], [130, -70], 2.5, 7) },
  { pts: zigzag([250, 130], [285, 130], 2, 6), depth: 1.3 },
];
const TF = new TrenchField(TRENCHES);

/** Hố bom trên mũi Hoc (oanh tạc dữ dội) và rải rác trên cao nguyên. */
const CRATERS = new CraterField([
  ...scatterCraters(makeRand(66), 55, 235, 110, 300, 196, 2, 6, (x, z) => inland(x, z) < 6 || Math.hypot(x - 268, z - 150) < 9),
  ...scatterCraters(makeRand(67), 40, -230, -250, 220, 30, 1.6, 4, (x, z) => onRoad(x, z, 3) || SITES.some((s) => Math.hypot(s.x - x, s.z - z) < Math.max(s.rx, s.rz) + 6)),
]);

function ground(x: number, z: number): number {
  let h = flattenSites(SITES, x, z, raw(x, z), 16);
  // Đường đất phẳng ra chút (bớt gồ ghề).
  if (onRoad(x, z, 2)) h -= 0.15;
  return h;
}

function height(x: number, z: number): number {
  return ground(x, z) - TF.cut(x, z) + CRATERS.offset(x, z);
}

// ---------------------------------------------------------------------------- công trình

/**
 * Cứ điểm "Widerstandsnest" trên mép vách: ụ pháo 88 ly bê tông bắn dọc bãi biển (hướng `fire`), hai lô cốt súng máy,
 * hầm ngầm, tường chống tăng chắn ngang hẻm (chừa lối đi bộ), tháp quan sát.
 */
function buildStrongpoint(b: Builder, fire: number) {
  pillbox(b, -8, 0, 4, fire, true, "#a19e92");
  pillbox(b, 9, 0, 6, 0, false, "#a19e92");
  pillbox(b, 12, 0, -8, Math.PI / 2, false, "#a19e92");
  // Hầm trú ẩn (Tobruk) nửa chìm, cửa xuống phía sau.
  const add = b.local(-8, -9, 0);
  add(0, 0.6, 2.2, 7, 1.2, 0.6, "concrete", { tint: "#9a978b" });
  add(-3.2, 0.6, 0, 0.6, 1.2, 4.4, "concrete", { tint: "#9a978b" });
  add(3.2, 0.6, 0, 0.6, 1.2, 4.4, "concrete", { tint: "#9a978b" });
  add(0, 1.45, 0, 7.4, 0.5, 5, "concrete", { tint: "#8d8a7e" });
  b.lootAt(-8, 0.05, -9, 2);
  heavyLoot(b, 9, 0.05, 6);
  woodTower(b, 0, -13, 5.2, 2);
  ammoCrates(b, 3, -2, 0.3);
}

/** Bãi Dog Green: tường chắn sóng, nhím thép chống tăng, cọc gỗ chống thuyền, xác xuồng đổ bộ, xe tăng chìm. */
function buildBeach(b: Builder) {
  // Tường chắn sóng bê tông thấp chạy dọc bãi (người nấp được), chừa lối.
  for (const u of [-16, -4, 8, 18]) b.add(u, 0.6, -14, 9, 1.2, 0.7, "concrete", { tint: "#a7a49a" });
  // Nhím thép (ba thanh sắt chéo nhau).
  for (let k = 0; k < 9; k++) {
    const u = -18 + (k % 5) * 9 + (k > 4 ? 4 : 0);
    const v = k > 4 ? 10 : 3;
    const hh = b.local(u, v, k * 0.6);
    hh(0, 0.7, 0, 2, 0.22, 0.22, "metal", { tint: "#3a3836", pitch: 0.7 });
    hh(0, 0.7, 0, 0.22, 0.22, 2, "metal", { tint: "#3a3836", pitch: -0.7 });
    hh(0, 0.7, 0, 0.22, 1.5, 0.22, "metal", { tint: "#3a3836" });
  }
  // Xác xuồng đổ bộ LCVP mắc cạn (người nấp sau được).
  const boat = b.local(-12, 9, 0.3);
  boat(0, 1, 0, 3.2, 2, 0.35, "metal", { tint: "#5d6a5a" });
  boat(-1.5, 1, -3.5, 0.3, 2, 7, "metal", { tint: "#5d6a5a" });
  boat(1.5, 1, -3.5, 0.3, 2, 7, "metal", { tint: "#5d6a5a" });
  boat(0, 0.15, -3.5, 3, 0.3, 7, "metal", { tint: "#4f5a4c" });
  // Xe tăng Sherman chìm nửa thân ở mép nước.
  const tank = b.local(14, 12, -0.4);
  tank(0, 0.7, 0, 2.8, 1.4, 5.4, "metal", { tint: "#4d5534" });
  tank(0, 1.85, -0.3, 2, 0.9, 2.4, "metal", { tint: "#555d3a" });
  ammoCrates(b, -2, -10, 0);
  heavyLoot(b, 2, 0.05, -10);
}

/** Làng Pháp: nhà đá hai tầng mái dốc quanh quảng trường, nhà thờ có tháp chuông cao (chỗ bắn tỉa), tường đá thấp. */
function buildVillage(b: Builder) {
  for (const [u, v, rot] of [
    [-18, -14, 0],
    [-4, -16, 0],
    [12, -15, 0],
    [-19, 13, Math.PI],
    [16, 14, Math.PI],
  ] as const)
    tower(b, u, v, rot, { floors: 2, w: 10, d: 8, pitched: true, tier: 1, mat: "stone", tint: "#b8ad98" });
  // Nhà thờ: gian chính đá, tháp chuông bốn tầng.
  tower(b, 0, 14, Math.PI, { floors: 1, w: 10, d: 14, pitched: true, tier: 2, mat: "stone", tint: "#c2b8a3" });
  tower(b, 0, 4, Math.PI, { floors: 4, w: 5, d: 5, mat: "stone", tint: "#bdb39e", tier: 2 });
  for (let k = 0; k < 4; k++) b.add(-24 + k * 4, 0.5, 22, 3.6, 1, 0.6, "stone", { tint: "#9d9483" });
  heavyLoot(b, 22, 0.05, 0);
}

/** Mũi Hoc: ụ pháo bê tông lớn nhìn ra biển (nòng đã bị kéo đi), hầm quan sát, hố bom, mảnh bê tông vỡ. */
function buildPointe(b: Builder) {
  pillbox(b, -10, 0, 8, 0, true, "#a4a194");
  pillbox(b, 10, 0, 10, 0.4, true, "#a4a194");
  pillbox(b, 0, 0, -12, Math.PI, false, "#a4a194");
  // Đài quan sát hình hộp ở mũi đất.
  const obs = b.local(0, 2, 0);
  obs(0, 1.5, 0, 6, 3, 6, "concrete", { tint: "#9b988c" });
  obs(0, 3.2, 0, 7, 0.4, 7, "concrete", { tint: "#8d8a7e" });
  for (let k = 0; k < 6; k++) b.add(-18 + k * 7, 0.5, -4 + (k % 2) * 8, 2.4, 1, 1.8, "concrete", { tint: "#8f8b7f", rot: k * 0.9 });
  heavyLoot(b, -4, 0.05, -5);
  ammoCrates(b, 14, -12, 0);
}

// ---------------------------------------------------------------------------- bờ giậu, chiến hào, dây thép gai

/** Bờ giậu (bocage): ụ đất cao, dày, cây bụi mọc trên — chia đồng ruộng cao nguyên thành từng ô. */
const HEDGES: readonly [Pt, Pt][] = (() => {
  const rand = makeRand(1944);
  const out: [Pt, Pt][] = [];
  for (let gx = -230; gx < 220; gx += 64) {
    for (let gz = -300; gz < 0; gz += 56) {
      const x = gx + (rand() - 0.5) * 14;
      const z = gz + (rand() - 0.5) * 12;
      // Hai cạnh của ô: cạnh đông tây và cạnh bắc nam (chừa cổng giữa).
      out.push([[x + 4, z], [x + 30, z + (rand() - 0.5) * 6]]);
      out.push([[x + 36, z], [x + 60, z + (rand() - 0.5) * 6]]);
      out.push([[x, z + 4], [x + (rand() - 0.5) * 6, z + 26]]);
      out.push([[x, z + 32], [x + (rand() - 0.5) * 6, z + 52]]);
    }
  }
  return out.filter(([a, c]) => {
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2;
    return !onRoad(mx, mz, 6) && !SITES.some((s) => Math.hypot(s.x - mx, s.z - mz) < Math.max(s.rx, s.rz) + 14) && !TF.inside(mx, mz) && Math.abs(mx) < HALF - 20 && mz > -HALF + 20;
  });
})();

function extra(b: Builder) {
  for (const t of TRENCHES) lineTrench(b, t, ground, { mat: "sandbag", sides: [-1] });
  for (const [a, c] of HEDGES) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / len;
    const uz = (c[1] - a[1]) / len;
    const n = Math.ceil(len / 7);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * (len / n);
      const x = a[0] + ux * t;
      const z = a[1] + uz * t;
      b.add(x, ground(x, z) + 0.6, z, len / n + 0.6, 1.6, 1.8, "stone", { rot: alongRot(ux, uz), tint: "#5a5a3a" });
    }
  }
  // Dây thép gai trên bãi biển và dưới chân vách.
  for (let x = -230; x < 200; x += 34) {
    if (drawness(x + 12) > 0.5) continue;
    const z = footZ(x) + 6;
    wireLine(b, [x, z], [x + 24, footZ(x + 24) + 6], ground);
  }
}

function trees(rand: () => number, world: World) {
  const ok = (x: number, z: number) => inland(x, z) > 70 && !onRoad(x, z, 3) && !TF.inside(x, z) && head(x) < 0.5;
  // Cây trên bờ giậu (thành hàng) và các lùm cây trong ruộng.
  const hedge: World["trees"][number][] = [];
  for (const [a, c] of HEDGES) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    for (let t = 5; t < len - 3; t += 9 + rand() * 6) {
      const x = a[0] + ((c[0] - a[0]) * t) / len + (rand() - 0.5);
      const z = a[1] + ((c[1] - a[1]) * t) / len + (rand() - 0.5);
      hedge.push({ id: `b${hedge.length}`, kind: "broadleaf", x, z, height: 5 + rand() * 3, lean: 0.8 + rand() * 0.35 });
    }
  }
  const woods = groveTrees(rand, world, { n: 260, groves: 22, spread: 46, x0: -300, z0: -320, x1: 300, z1: 20, kind: "broadleaf", height: [6, 10], lean: [0.9, 1.3], gap: 4.5, ok, idFrom: hedge.length });
  return [...hedge, ...woods];
}

export const NORMANDY: WarMapDef = {
  id: "normandy",
  half: HALF,
  extent: 300,
  biome: "temperate",
  layoutSeed: 19440606,
  sites: SITES,
  height,
  inland,
  ground: (x, z) => (onRoad(x, z) ? "dirt" : TF.inside(x, z) ? "dirt" : undefined),
  extra,
  trees,
  grass: (rand, world) => grassPatches(rand, world, 80, -300, -310, 300, 30, (x, z) => inland(x, z) > 80 && !onRoad(x, z, 4) && !TF.inside(x, z)),
  region: (x, z) => {
    const off = inland(x, z);
    if (off < -3) return "Eo biển Manche";
    if (TF.inside(x, z)) return "Chiến hào";
    if (head(x) > 0.5) return "Mũi Hoc";
    if (z > footZ(x) - 2) return "Bãi Omaha";
    if (z > topZ(x) - 10 && drawness(x) < 0.4) return "Vách đá";
    if (drawness(x) > 0.4 && z > 0) return "Hẻm lên cao nguyên";
    return "Đồng ruộng bocage";
  },
  harbors: [
    { x: -150, z: 175 },
    { x: 0, z: 178 },
    { x: 120, z: 176 },
  ],
  emplacements: [
    { kind: "mortar", x: -150, z: 20, rotY: 0.2 },
    { kind: "mortar", x: -20, z: 18, rotY: -0.1 },
    { kind: "mortar", x: 120, z: 14, rotY: -0.3 },
    { kind: "mortar", x: 250, z: 120, rotY: -0.6 },
    { kind: "mortar", x: -230, z: 105, rotY: 1.3 },
    { kind: "hmg_nest", x: -200, z: 50, rotY: 0.6 },
    { kind: "hmg_nest", x: 40, z: 48, rotY: -0.3 },
    { kind: "hmg_nest", x: 200, z: 52, rotY: 0.2 },
  ],
};
