import type { ZoneId } from "@tentides/rules";
import type { GrassPatch } from "./island.ts";
import { makeRand, subSeed, type Surface, type Tree, type World } from "./worldgen.ts";
import { Builder, battleMap as battleMapFor, registerMap, buildArmory, buildCity, buildFortress, buildIndex, container, outside, toWorld, tower, type BattleMap, type BattleSite, type FlagSpot } from "./battle.ts";

// Bản đồ chiến trường 50 vs 50 (phe Xanh đấu phe Đỏ, chiếm cứ điểm): một vùng đất liền rộng gần gấp ba đảo sinh
// tồn, đồi thoải cho xe tăng chạy, rừng từng cụm; hai căn cứ ở hai đầu tây, đông (chỗ hồi sinh, xe tăng), bảy cứ
// điểm A–G rải đối xứng giữa hai phe: làng, pháo đài, kho quân nhu, thị trấn ở giữa, nhà máy... Cứ điểm nào cũng
// có công sự quanh cột cờ (vòng bao cát, lô cốt bê tông, tháp canh) để giữ và để công.
// Bố cục cố định; seed chỉ đổi cây cối, cỏ.

/** Nửa cạnh bản đồ chiến trường (m): 672 × 672, đất liền chừng 600 × 500. */
export const WAR_HALF = 336;
/** Nửa bề ngang, bề dọc của khối đất liền (bờ biển hình chữ nhật bo tròn). */
const LAND_X = 300;
const LAND_Z = 252;

/** Khoảng cách vào sâu trong đất liền (âm là ngoài biển), bờ lượn sóng nhẹ. */
function warInland(x: number, z: number): number {
  const ex = Math.abs(x) / LAND_X;
  const ez = Math.abs(z) / LAND_Z;
  const edge = Math.pow(ex ** 4 + ez ** 4, 0.25);
  const a = Math.atan2(z, x);
  return (1 - edge) * 250 + 6 * Math.sin(5 * a + 0.7) + 3.5 * Math.sin(11 * a + 2.1);
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Hai dãy đồi đối xứng qua tâm (mỗi phe một đồi cao nhìn xuống giữa bản đồ), vài gò thấp. */
const HILLS = [
  { x: -95, z: 70, r: 80, h: 16 },
  { x: 95, z: -70, r: 80, h: 16 },
  { x: -210, z: -170, r: 60, h: 11 },
  { x: 210, z: 170, r: 60, h: 11 },
  { x: 0, z: 100, r: 50, h: 7 },
  { x: 0, z: -95, r: 50, h: 7 },
];

function rawWarHeight(x: number, z: number): number {
  const inland = warInland(x, z);
  if (inland < 0) {
    const off = -inland;
    return -5 * smooth(0, 18, off) - 10 * smooth(20, 90, off);
  }
  let h = 1.3 * smooth(0, 14, inland) + 2.2 * smooth(14, 60, inland);
  // Đồi thoải (xe tăng leo được), gợn nhẹ.
  h += (2.6 * Math.sin(x * 0.021 + 1.1) * Math.cos(z * 0.018) + 1.4 * Math.sin((x - z) * 0.035) + 0.8 * Math.cos(x * 0.07 + z * 0.05)) * smooth(20, 80, inland);
  for (const hl of HILLS) {
    const d = Math.hypot(x - hl.x, z - hl.z);
    if (d < hl.r) h += hl.h * smooth(hl.r, hl.r * 0.2, d);
  }
  // Trong đất liền không có vũng trũng dưới mực nước (xe tăng khỏi sa lầy giữa đồng).
  return inland > 30 ? Math.max(h, 1.2 + 0.02 * Math.min(40, inland - 30)) : h;
}

interface WarSite extends BattleSite {
  /** Cột cờ, tính theo toạ độ riêng của khu (không có: không phải cứ điểm, vd. căn cứ). */
  flag?: { u: number; v: number; r: number; letter: string };
  /** Kiểu dựng riêng của chiến trường (ngoài các kiểu của đảo sinh tồn). */
  build: "hq" | "hamlet" | "fortress" | "depot" | "city" | "factory" | "outpost";
}

function site(o: Omit<WarSite, "h" | "ground" | "kind"> & { ground?: BattleSite["ground"]; kind?: BattleSite["kind"] }): WarSite {
  // Nền khu san phẳng theo độ cao địa hình ở tâm (làm tròn nửa mét).
  return { kind: "village", ground: "dirt", ...o, h: Math.max(2, Math.round(rawWarHeight(o.x, o.z) * 2) / 2) };
}

export const WAR_SITES: readonly WarSite[] = [
  site({ id: "hqb", name: "Căn cứ Xanh", build: "hq", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0 }),
  site({ id: "hqr", name: "Căn cứ Đỏ", build: "hq", kind: "armory", ground: "concrete", x: 262, z: 0, rx: 30, rz: 26, rot: Math.PI }),
  site({ id: "a", name: "Làng Thông", build: "hamlet", x: -165, z: -115, rx: 26, rz: 22, rot: 0.3, flag: { u: 0, v: 0, r: 14, letter: "A" } }),
  site({ id: "b", name: "Pháo đài Đá", build: "fortress", kind: "fortress", ground: "stone", x: -160, z: 125, rx: 27, rz: 27, rot: -0.2, flag: { u: 0, v: -12, r: 15, letter: "B" } }),
  site({ id: "c", name: "Kho Quân Nhu", build: "depot", kind: "armory", ground: "concrete", x: -10, z: -175, rx: 28, rz: 20, rot: 0.1, flag: { u: 0, v: -6, r: 15, letter: "C" } }),
  site({ id: "d", name: "Thị trấn Trung Tâm", build: "city", kind: "city", ground: "asphalt", x: 0, z: 0, rx: 50, rz: 42, rot: 0, flag: { u: 0, v: 14, r: 16, letter: "D" } }),
  site({ id: "e", name: "Đồn Biên Phòng", build: "outpost", ground: "stone", x: 10, z: 178, rx: 24, rz: 20, rot: -0.1, flag: { u: 0, v: 0, r: 14, letter: "E" } }),
  site({ id: "f", name: "Làng Suối", build: "hamlet", x: 165, z: 115, rx: 26, rz: 22, rot: 0.3 + Math.PI, flag: { u: 0, v: 0, r: 14, letter: "F" } }),
  site({ id: "g", name: "Nhà máy Xi măng", build: "factory", ground: "concrete", x: 160, z: -125, rx: 30, rz: 24, rot: -0.2, flag: { u: -2, v: 10, r: 15, letter: "G" } }),
];

/** Chỗ căn cứ hai phe (hồi sinh, xe tăng đậu). */
export const WAR_BASES = {
  blue: { x: -262, z: 0, face: Math.PI / 2 },
  red: { x: 262, z: 0, face: -Math.PI / 2 },
} as const;

function warHeight(x: number, z: number): number {
  let h = rawWarHeight(x, z);
  for (const s of WAR_SITES) {
    const out = outside(s, x, z);
    if (out > 18) continue;
    h = lerp(h, s.h, 1 - smooth(0, 18, out));
  }
  return h;
}

// ---------------------------------------------------------------------------- công trình

/** Công sự quanh cột cờ: vòng bao cát có lối vào, hai lô cốt bê tông có lỗ châu mai, tháp canh gỗ, cột cờ. */
function stronghold(b: Builder, u0: number, v0: number, r: number) {
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
  for (const side of [-1, 1]) {
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
  // Tháp canh gỗ có dốc lên.
  const tu = u0 - r * 0.2;
  const tv = v0 + r * 0.9;
  const tw = b.local(tu, tv, 0);
  for (const lu of [-1.6, 1.6]) for (const lv of [-1.6, 1.6]) tw(lu, 2.6, lv, 0.3, 5.2, 0.3, "wood", { tint: "#6a5238" });
  tw(0, 5.3, 0, 4, 0.25, 4, "wood", { tint: "#7a6040" });
  for (const [du, dv, w, d] of [
    [0, -1.9, 4, 0.15],
    [0, 1.9, 4, 0.15],
    [1.9, 0, 0.15, 4],
    [-1.9, 0, 0.15, 4],
  ] as const)
    tw(du, 5.9, dv, w, 0.9, d, "wood", { tint: "#7a6040" });
  const slope = Math.atan2(5.3, 8);
  const ramp = b.local(tu - 2 - 4, tv, Math.PI / 2);
  ramp(0, 2.65, 0, 1.2, 0.2, Math.hypot(5.3, 8), "wood", { tint: "#7a6040", pitch: slope });
}

/** Làng lớn: sáu nhà một, hai tầng quanh bãi đất giữa làng, hàng rào gỗ, đống củi. */
function buildHamlet(b: Builder) {
  const spots: [number, number][] = [
    [-17, -13],
    [0, -15],
    [17, -12],
    [-18, 12],
    [2, 16],
    [18, 13],
  ];
  for (const [u, v] of spots) {
    tower(b, u + (b.rand() - 0.5) * 2, v, (Math.floor(b.rand() * 4) * Math.PI) / 2, { floors: 1 + (b.rand() < 0.5 ? 1 : 0), w: 9, d: 9, pitched: true, tier: 1, mat: b.rand() < 0.5 ? "wood" : "plaster" });
  }
  for (let k = 0; k < 5; k++) b.add(-24 + k * 12, 0.5, 24, 5, 1, 0.15, "wood", { tint: "#6a5238" });
  b.add(-8, 0.6, 5, 2.5, 1.2, 1.2, "wood", { tint: "#7a5a3a" });
}

/** Kho quân nhu: như kho vũ khí của đảo, thêm dãy container và xe tải hỏng. */
function buildDepot(b: Builder) {
  buildArmory(b, false);
  const add = b.local(0, 14, 0);
  for (let k = 0; k < 4; k++) container(add, -18 + k * 7, 0, 0, b.rand);
}

/** Nhà máy: xưởng lớn hai tầng, ống khói, bãi container, bể chứa. */
function buildFactory(b: Builder) {
  tower(b, -10, -6, 0, { floors: 2, w: 22, d: 14, mat: "brick", tier: 2 });
  tower(b, 16, -8, Math.PI / 2, { floors: 3, w: 10, d: 10, mat: "plaster", tier: 1 });
  // Ống khói cao (khối vuông chồng), bể chứa.
  b.add(8, 12, -18, 3, 24, 3, "brick", { tint: "#9b4a36" });
  for (const u of [-22, -15]) b.add(u, 3, 16, 5, 6, 5, "metal", { tint: "#b8b8b0" });
  for (let k = 0; k < 5; k++) {
    const add = b.local(4 + (k % 3) * 7, 18 + Math.floor(k / 3) * 3.2, 0);
    container(add, 0, 0, 0, b.rand);
    if (b.rand() < 0.4) container(add, 0, 2.6, 0, b.rand);
  }
}

/** Đồn biên phòng: tường đá thấp bao quanh, hai nhà lính, cổng có chòi gác. */
function buildOutpost(b: Builder) {
  const s = b.site;
  const W = s.rx - 2;
  const D = s.rz - 2;
  for (const [cu, cv, w, d] of [
    [0, -D, 2 * W, 0.8],
    [0, D, 2 * W, 0.8],
    [-W, 0, 0.8, 2 * D],
    [W, 0, 0.8, 2 * D],
  ] as const) {
    // Chừa cổng giữa mỗi bức tường.
    if (w > d) {
      b.add(cu - W / 2 - 2, 1, cv, w / 2 - 4, 2, d, "stone", { tint: "#8d877c" });
      b.add(cu + W / 2 + 2, 1, cv, w / 2 - 4, 2, d, "stone", { tint: "#8d877c" });
    } else {
      b.add(cu, 1, cv - D / 2 - 2, w, 2, d / 2 - 4, "stone", { tint: "#8d877c" });
      b.add(cu, 1, cv + D / 2 + 2, w, 2, d / 2 - 4, "stone", { tint: "#8d877c" });
    }
  }
  tower(b, -12, -9, 0, { floors: 1, w: 10, d: 7, mat: "stone", tier: 2 });
  tower(b, 12, 9, Math.PI, { floors: 2, w: 10, d: 7, mat: "plaster", tier: 1 });
}

/** Căn cứ: kho vũ khí có hàng rào, bãi đậu xe tăng bê tông, lều trại. */
function buildHq(b: Builder) {
  buildArmory(b);
  // Bãi đậu xe tăng trước căn cứ (phía trận địa).
  b.add(b.site.rx + 12, 0.03, 0, 18, 0.06, 30, "road", { solid: false, tint: "#6d6d68" });
  for (const v of [-9, 0, 9]) b.add(b.site.rx + 12, 0.035, v + 4.5, 17, 0.02, 0.2, "road", { solid: false, tint: "#e8e0c0" });
}

// ---------------------------------------------------------------------------- cây cỏ

function warTrees(rand: () => number, world: World): Tree[] {
  const trees: Tree[] = [];
  const near = (x: number, z: number, r: number) => trees.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
  // Dừa ven biển.
  for (let tries = 0; trees.length < 180 && tries < 5000; tries++) {
    const x = (rand() * 2 - 1) * LAND_X;
    const z = (rand() * 2 - 1) * LAND_Z;
    const inland = warInland(x, z);
    if (inland < 4 || inland > 26 || world.heightAt(x, z) < 0.7 || !world.isClear(x, z, 5) || near(x, z, 5)) continue;
    trees.push({ id: `p${trees.length}`, kind: "palm", x, z, height: 6 + rand() * 3, lean: (rand() - 0.5) * 0.4 });
  }
  // Rừng từng cụm giữa các cứ điểm (chừa đường xe tăng).
  const palms = trees.length;
  const groves: { x: number; z: number }[] = [];
  for (let k = 0; k < 40; k++) groves.push({ x: (rand() * 2 - 1) * (LAND_X - 50), z: (rand() * 2 - 1) * (LAND_Z - 40) });
  for (let tries = 0; trees.length - palms < 700 && tries < 14000; tries++) {
    const g = groves[Math.floor(rand() * groves.length)]!;
    const x = g.x + (rand() - 0.5) * 50;
    const z = g.z + (rand() - 0.5) * 50;
    if (warInland(x, z) < 26 || !world.isClear(x, z, 8) || near(x, z, 4.5)) continue;
    trees.push({ id: `b${trees.length}`, kind: "broadleaf", x, z, height: 5 + rand() * 4, lean: 0.85 + rand() * 0.45 });
  }
  return trees;
}

function warGrass(rand: () => number, world: World): GrassPatch[] {
  const out: GrassPatch[] = [];
  for (let tries = 0; out.length < 70 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * (LAND_X - 40);
    const z = (rand() * 2 - 1) * (LAND_Z - 30);
    if (warInland(x, z) < 20 || !world.isClear(x, z, 10)) continue;
    out.push({ x, z, radius: 5 + rand() * 8 });
  }
  return out;
}

// ---------------------------------------------------------------------------- dựng bản đồ

const cache = new Map<number, BattleMap>();

export function warMap(seed: number): BattleMap {
  const hit = cache.get(seed);
  if (hit) return hit;
  const boxes: BattleMap["boxes"][number][] = [];
  const loot: BattleMap["loot"][number][] = [];
  const flags: FlagSpot[] = [];
  const layoutRand = makeRand(20261101);
  for (const s of WAR_SITES) {
    const b = new Builder(s, layoutRand);
    if (s.build === "hq") buildHq(b);
    else if (s.build === "hamlet") buildHamlet(b);
    else if (s.build === "fortress") buildFortress(b);
    else if (s.build === "depot") buildDepot(b);
    else if (s.build === "city") buildCity(b);
    else if (s.build === "factory") buildFactory(b);
    else buildOutpost(b);
    if (s.flag) {
      // Pháo đài, thị trấn đã có sẵn tường, nhà: chỉ thêm cột cờ; nơi khác dựng công sự quanh cột cờ.
      if (s.build === "fortress" || s.build === "city") {
        const add = b.local(s.flag.u, s.flag.v, 0);
        add(0, 0.25, 0, 1.6, 0.5, 1.6, "concrete", { tint: "#a8a596" });
        add(0, 4.5, 0, 0.12, 8, 0.12, "metal", { tint: "#d8d8d0", solid: false });
      } else stronghold(b, s.flag.u, s.flag.v, s.flag.r);
      const p = toWorld(s, s.flag.u, s.flag.v);
      flags.push({ id: s.flag.letter, name: s.name, x: p.x, z: p.z, y: s.h, r: s.flag.r });
    }
    boxes.push(...b.boxes);
    loot.push(...b.loot);
  }

  const inSite = (x: number, z: number, grow: number) => WAR_SITES.find((s) => outside(s, x, z, grow) === 0) ?? null;
  const surface = (x: number, z: number): Surface => {
    const inland = warInland(x, z);
    const st = inSite(x, z, 1);
    return { island: inland < 0 && !st ? "sea" : "main", inland, islet: null, reef: false, pad: !!st, ground: st ? st.ground : undefined };
  };
  const world: World = {
    seed,
    kind: "battle",
    extent: LAND_X,
    half: WAR_HALF,
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
    heightAt: warHeight,
    surface,
    zoneAt: (): ZoneId => "beach",
    regionAt: (x, z) => {
      const st = inSite(x, z, 10);
      if (st) return st.name;
      const inland = warInland(x, z);
      if (inland < -3) return "Biển";
      if (warHeight(x, z) > 11) return "Đồi cao";
      if (inland < 25) return "Bờ biển";
      return x < 0 ? "Vùng phía Tây" : "Vùng phía Đông";
    },
    structureAt: () => null,
    isClear: (x, z, margin) => !inSite(x, z, margin),
  };
  const rand = makeRand(subSeed(seed, "war"));
  world.trees = warTrees(rand, world);
  world.palms = world.trees.filter((t) => t.kind === "palm").map((t) => ({ x: t.x, z: t.z, height: t.height, lean: t.lean }));
  world.tallGrass = warGrass(rand, world);

  const map: BattleMap = { layout: "war", half: WAR_HALF, flags, world, sites: WAR_SITES, boxes, loot, mines: [], index: buildIndex(boxes) };
  cache.set(seed, map);
  registerMap(map);
  return map;
}

/** Bản đồ theo chế độ trận: chiến trường 50 vs 50 hay đảo sinh tồn / đồng đội. */
export function mapForMode(mode: string, seed: number): BattleMap {
  return mode === "war" ? warMap(seed || 1) : battleMapFor(seed || 1);
}
