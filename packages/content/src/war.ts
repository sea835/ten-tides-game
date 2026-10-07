import type { ZoneId } from "@tentides/rules";
import type { GrassPatch } from "./island.ts";
import { makeRand, subSeed, type Surface, type Tree, type World } from "./worldgen.ts";
import { Builder, battleMap as battleMapFor, registerMap, buildArmory, buildFortress, buildIndex, container, outside, toWorld, tower, type BattleMap, type BattleSite, type FlagSpot } from "./battle.ts";

// Bản đồ chiến trường 50 vs 50 (phe Xanh đấu phe Đỏ, chiếm cứ điểm): một vùng đất liền rộng gần gấp ba đảo sinh
// tồn, đồi thoải cho xe tăng chạy, rừng từng cụm; hai căn cứ ở hai đầu tây, đông (chỗ hồi sinh, xe tăng), bảy cứ
// điểm A–G: Làng Thông trên đồi thông, Pháo Đài Đá Cổ tường dày, Kho Quân Nhu (vũ khí nặng, hòm đạn), Thị Trấn
// Trung Tâm nhà 3–5 tầng phố hẹp, Đồn Biên Phòng có tháp canh giữ cây cầu qua sông, Làng Suối Nước Ngọt dưới thung
// lũng dốc có con đường độc đạo, Nhà Máy Xi Măng bên bờ biển có cầu tàu, bãi đổ bộ. Một con sông chảy từ bờ bắc
// xuống bờ nam phía đông thị trấn: sâu phải bơi, xe qua bằng cầu hay hai khúc cạn.
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

/** Hai dãy đồi đối xứng qua tâm (mỗi phe một đồi cao nhìn xuống giữa bản đồ), vài gò thấp, đồi thông A, gò pháo đài B, gò đồn biên phòng E. */
const HILLS = [
  { x: -95, z: 70, r: 80, h: 16 },
  { x: 95, z: -70, r: 80, h: 16 },
  { x: -210, z: -170, r: 60, h: 11 },
  { x: 210, z: 170, r: 60, h: 11 },
  { x: -85, z: 120, r: 50, h: 7 },
  { x: 85, z: -120, r: 50, h: 7 },
  { x: -165, z: -115, r: 75, h: 13 },
  { x: -160, z: 125, r: 58, h: 6 },
  { x: 50, z: 180, r: 46, h: 6 },
];

// ---------------------------------------------------------------------------- sông, cầu, khúc cạn

/**
 * Dòng sông chảy từ bờ bắc xuống bờ nam ngay giữa hai phe (các điểm theo z giảm dần): qua cầu Đồn Biên Phòng, khúc
 * cạn phía bắc, thành kênh đào xuyên giữa thị trấn trung tâm, khúc cạn phía nam rồi ra biển phía đông Kho Quân Nhu.
 */
const RIVER: readonly (readonly [number, number])[] = [
  [-10, 290],
  [0, 215],
  [5, 178],
  [5, 140],
  [-5, 90],
  [0, 45],
  [0, 0],
  [0, -45],
  [10, -100],
  [30, -160],
  [35, -290],
];
/** Dải x có sông (để bỏ qua nhanh phần lớn bản đồ). */
const RIVER_X0 = -40;
const RIVER_X1 = 65;
/** Lòng sông: độ sâu (phải bơi), nửa bề rộng đáy, nửa bề rộng tính cả bờ dốc. Khúc cạn: nước tới gối, bờ thoải. */
const RIVER_DEPTH = 3.6;
const RIVER_BED = 6;
const RIVER_BANK = 18;
const FORD_DEPTH = 0.45;
const FORD_BANK = 26;
/** Cách tim sông quá chừng này (m) là đã lên hẳn một bên bờ (máy tìm đường qua sông). */
const RIVER_ZONE = 21;
/** Điểm lên xuống hai đầu chỗ qua sông, cách tim sông (m). */
const CROSS_REACH = 27;

/** Hoành độ tim sông ở độ z (nội suy theo các điểm; ngoài hai đầu thì lấy điểm đầu, điểm cuối). */
export function riverX(z: number): number {
  if (z >= RIVER[0]![1]) return RIVER[0]![0];
  for (let i = 1; i < RIVER.length; i++) {
    const [x1, z1] = RIVER[i]!;
    if (z >= z1) {
      const [x0, z0] = RIVER[i - 1]!;
      return x0 + ((x1 - x0) * (z0 - z)) / (z0 - z1);
    }
  }
  return RIVER[RIVER.length - 1]![0];
}

/** Khoảng cách tới tim sông (đường gấp khúc). */
function riverDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < RIVER.length; i++) {
    const [ax, az] = RIVER[i - 1]!;
    const [bx, bz] = RIVER[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Hai khúc cạn trên sông: xe tăng, xe jeep, bộ binh lội qua được (ngoài cây cầu ở Đồn Biên Phòng). */
export const WAR_FORDS: readonly { x: number; z: number }[] = [90, -100].map((z) => ({ x: riverX(z), z }));

/** Cây cầu bê tông dầm thép bắc qua sông ở Đồn Biên Phòng (E): tâm, dài theo trục x, rộng theo trục z. */
export const WAR_BRIDGE = { x: riverX(178), z: 178, len: 40, width: 8 } as const;

/** Mức khúc cạn ở (x, z): 1 giữa khúc cạn, 0 ở xa. */
function fordness(x: number, z: number): number {
  let f = 0;
  for (const fd of WAR_FORDS) f = Math.max(f, 1 - smooth(10, 26, Math.hypot(x - fd.x, z - fd.z)));
  return f;
}

/** Khoét lòng sông vào độ cao `h`. */
function riverCut(x: number, z: number, h: number): number {
  if (x < RIVER_X0 || x > RIVER_X1) return h;
  const d = riverDist(x, z);
  if (d >= FORD_BANK) return h;
  const ford = fordness(x, z);
  // Qua thị trấn: kênh đào bờ kè đứng (không lấn vào phố), ra khỏi thị trấn bờ thoải dần.
  const canal = 1 - smooth(0, 15, outside(SITE_D, x, z));
  const bank = lerp(lerp(RIVER_BANK, FORD_BANK, ford), RIVER_BED + 1, canal);
  if (d >= bank) return h;
  const bed = -lerp(RIVER_DEPTH, FORD_DEPTH, ford);
  return Math.min(h, lerp(bed, Math.max(h, bed), smooth(RIVER_BED, bank, d)));
}

/** Đang ở lòng sông (cho HUD). */
function inRiver(x: number, z: number): boolean {
  return x > RIVER_X0 && x < RIVER_X1 && riverDist(x, z) < RIVER_BED + 3;
}

// ---------------------------------------------------------------------------- thung lũng Làng Suối (F)

/** Thung lũng dốc của Làng Suối: trục chạy tây tây nam ↔ đông đông bắc qua làng, hai sườn núi dựng đứng. */
const VALLEY = { x: 165, z: 115, ax: -2 / Math.sqrt(5), az: -1 / Math.sqrt(5) };

/** Toạ độ theo thung lũng: dọc trục (s), ngang trục (p). */
function valleyCoords(x: number, z: number): { s: number; p: number } {
  const dx = x - VALLEY.x;
  const dz = z - VALLEY.z;
  return { s: dx * VALLEY.ax + dz * VALLEY.az, p: -dx * VALLEY.az + dz * VALLEY.ax };
}

/** Nửa bề rộng lòng thung lũng: rộng chỗ làng, hai đầu hẹp lại thành con đường độc đạo vừa một xe tăng. */
function valleyFloor(s: number): number {
  return lerp(27, 5, smooth(30, 44, Math.abs(s)));
}

/** Hai sườn núi dốc đứng của thung lũng (xe tăng không leo được, phải theo đường đáy thung lũng). */
function valleyRidge(x: number, z: number): number {
  if (Math.abs(x - VALLEY.x) > 110 || Math.abs(z - VALLEY.z) > 110) return 0;
  const { s, p } = valleyCoords(x, z);
  const as = Math.abs(s);
  const ap = Math.abs(p);
  if (as > 85 || ap > 90) return 0;
  const w = valleyFloor(s);
  return 15 * smooth(w, w + 12, ap) * (1 - smooth(60, 85, as)) * (1 - smooth(60, 90, ap));
}

/** Con đường đất dưới đáy thung lũng, nới thêm `grow` mét hai bên. */
function onValleyRoad(x: number, z: number, grow = 0): boolean {
  if (Math.abs(x - VALLEY.x) > 90 || Math.abs(z - VALLEY.z) > 90) return false;
  const { s, p } = valleyCoords(x, z);
  return Math.abs(s) < 78 && Math.abs(p) < 3.5 + grow;
}

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
  h += valleyRidge(x, z);
  // Trong đất liền không có vũng trũng dưới mực nước (xe tăng khỏi sa lầy giữa đồng).
  return inland > 30 ? Math.max(h, 1.2 + 0.02 * Math.min(40, inland - 30)) : h;
}

interface WarSite extends BattleSite {
  /** Cột cờ, tính theo toạ độ riêng của khu (không có: không phải cứ điểm, vd. căn cứ). */
  flag?: { u: number; v: number; r: number; letter: string };
  /** Kiểu dựng riêng của chiến trường (ngoài các kiểu của đảo sinh tồn). */
  build: "hq" | "hamlet" | "pines" | "fortress" | "depot" | "town" | "factory" | "outpost";
}

function site(o: Omit<WarSite, "h" | "ground" | "kind"> & { ground?: BattleSite["ground"]; kind?: BattleSite["kind"] }): WarSite {
  // Nền khu san phẳng theo độ cao địa hình ở tâm (làm tròn nửa mét).
  return { kind: "village", ground: "dirt", ...o, h: Math.max(2, Math.round(rawWarHeight(o.x, o.z) * 2) / 2) };
}

export const WAR_SITES: readonly WarSite[] = [
  site({ id: "hqb", name: "Căn cứ Xanh", build: "hq", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0 }),
  site({ id: "hqr", name: "Căn cứ Đỏ", build: "hq", kind: "armory", ground: "concrete", x: 262, z: 0, rx: 30, rz: 26, rot: Math.PI }),
  site({ id: "a", name: "Làng Thông", build: "pines", x: -165, z: -115, rx: 26, rz: 22, rot: 0.3, flag: { u: 0, v: 0, r: 14, letter: "A" } }),
  site({ id: "b", name: "Pháo Đài Đá Cổ", build: "fortress", kind: "fortress", ground: "stone", x: -160, z: 125, rx: 27, rz: 27, rot: -0.2, flag: { u: 0, v: -12, r: 15, letter: "B" } }),
  site({ id: "c", name: "Kho Quân Nhu", build: "depot", kind: "armory", ground: "concrete", x: -62, z: -168, rx: 28, rz: 20, rot: 0.1, flag: { u: 0, v: -12, r: 15, letter: "C" } }),
  site({ id: "d", name: "Thị Trấn Trung Tâm", build: "town", kind: "city", ground: "asphalt", x: 0, z: 0, rx: 50, rz: 42, rot: 0, flag: { u: 0, v: 0, r: 16, letter: "D" } }),
  site({ id: "e", name: "Đồn Biên Phòng", build: "outpost", ground: "stone", x: 52, z: 178, rx: 24, rz: 20, rot: 0, flag: { u: 2, v: 0, r: 14, letter: "E" } }),
  site({ id: "f", name: "Làng Suối Nước Ngọt", build: "hamlet", x: VALLEY.x, z: VALLEY.z, rx: 26, rz: 20, rot: Math.atan2(-VALLEY.az, VALLEY.ax), flag: { u: 0, v: 0, r: 14, letter: "F" } }),
  site({ id: "g", name: "Nhà Máy Xi Măng", build: "factory", ground: "concrete", x: 200, z: -207, rx: 38, rz: 26, rot: 0, flag: { u: 4, v: -4, r: 15, letter: "G" } }),
];

/** Chỗ căn cứ hai phe (hồi sinh, xe tăng đậu). */
export const WAR_BASES = {
  blue: { x: -262, z: 0, face: Math.PI / 2 },
  red: { x: 262, z: 0, face: -Math.PI / 2 },
} as const;

const SITE_D = WAR_SITES.find((s) => s.id === "d")!;
const SITE_E = WAR_SITES.find((s) => s.id === "e")!;
const SITE_G = WAR_SITES.find((s) => s.id === "g")!;
/** Mặt cầu ngang mặt sân đồn biên phòng (hai đầu cầu san phẳng bằng mặt cầu). */
const BRIDGE_TOP = SITE_E.h;
/** Cảng nhỏ của nhà máy xi măng (toạ độ riêng của khu G): vũng nước sâu sát kè cho thuyền cập, cầu tàu chìa ra. */
const HARBOUR = { u0: -SITE_G.rx - 6, u1: 2, v0: -SITE_G.rz - 48, v1: -SITE_G.rz };

function toLocal(s: BattleSite, x: number, z: number): { u: number; v: number } {
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  return { u: dx * c - dz * sn, v: dx * sn + dz * c };
}

function warHeight(x: number, z: number): number {
  let h = rawWarHeight(x, z);
  for (const s of WAR_SITES) {
    const out = outside(s, x, z);
    if (out > 18) continue;
    h = lerp(h, s.h, 1 - smooth(0, 18, out));
    if (s === SITE_G && out > 0) {
      // Phía biển của nhà máy: kè đứng, vũng nước sâu cho thuyền cập (phía tây); phía đông là bãi cát thoải (bãi đổ bộ).
      const { u, v } = toLocal(s, x, z);
      if (v < HARBOUR.v1) {
        const du = Math.max(0, HARBOUR.u0 - u, u - HARBOUR.u1);
        const dv = Math.max(0, HARBOUR.v0 - v);
        const basin = Math.hypot(du, dv);
        if (basin < 8) h = Math.min(h, lerp(-4.5, h, smooth(0, 8, basin)));
      }
    }
  }
  // Hai đầu cầu: đường dẫn san phẳng ngang mặt cầu.
  const bx = Math.abs(x - WAR_BRIDGE.x);
  const bz = Math.abs(z - WAR_BRIDGE.z);
  if (bx < 50 && bz < 18) h = lerp(h, BRIDGE_TOP, (1 - smooth(6, 16, bz)) * (1 - smooth(36, 50, bx)));
  return riverCut(x, z, h);
}

/** Đường dẫn lên cầu (trải nhựa). */
function onBridgeRoad(x: number, z: number, grow = 0): boolean {
  return Math.abs(z - WAR_BRIDGE.z) < 4.5 + grow && Math.abs(x - WAR_BRIDGE.x) < 42 + grow;
}

// ---------------------------------------------------------------------------- công trình

/** Đánh dấu khối vừa thêm là mặt cầu (xe tăng chạy trên được). */
function markDeck(b: Builder) {
  b.boxes[b.boxes.length - 1]!.deck = true;
}

/** Chỗ rơi vũ khí hạng nặng (súng máy, RPG, súng bắn tỉa hiếm). */
function heavyLoot(b: Builder, u: number, y: number, v: number) {
  b.lootAt(u, y, v, 3);
  b.loot[b.loot.length - 1]!.kind = "heavy";
}

/** Chồng hòm đạn dã chiến (thùng gỗ sơn xanh quân đội). */
function ammoCrates(b: Builder, u: number, v: number, rot: number) {
  const add = b.local(u, v, rot);
  add(-0.85, 0.4, 0, 1.6, 0.8, 1.0, "wood", { tint: "#4f5a32" });
  add(0.85, 0.4, 0, 1.6, 0.8, 1.0, "wood", { tint: "#55603a" });
  add(0, 1.2, 0, 1.6, 0.8, 1.0, "wood", { tint: "#4a5530" });
}

/** Công sự quanh cột cờ: vòng bao cát có lối vào, hai lô cốt bê tông có lỗ châu mai (tuỳ), tháp canh gỗ (tuỳ), cột cờ. */
function stronghold(b: Builder, u0: number, v0: number, r: number, o: { tower?: boolean; bunkers?: boolean } = {}) {
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

/** Tháp canh gỗ bốn chân cao `H` mét, sàn có lan can, dốc gỗ lên (về phía −u). */
function woodTower(b: Builder, tu: number, tv: number, H: number, tier?: 1 | 2 | 3) {
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

/** Làng lớn: sáu nhà một, hai tầng quanh bãi đất giữa làng, hàng rào gỗ, đống củi. */
function buildHamlet(b: Builder) {
  const spots: [number, number][] = [
    [-17, -13],
    [0, -14],
    [17, -12],
    [-18, 12],
    [2, 14],
    [18, 12],
  ];
  for (const [u, v] of spots) {
    tower(b, u + (b.rand() - 0.5) * 2, v, (Math.floor(b.rand() * 4) * Math.PI) / 2, { floors: 1 + (b.rand() < 0.5 ? 1 : 0), w: 9, d: 9, pitched: true, tier: 1, mat: b.rand() < 0.5 ? "wood" : "plaster" });
  }
  for (let k = 0; k < 5; k++) b.add(-24 + k * 12, 0.5, b.site.rz + 1.5, 5, 1, 0.15, "wood", { tint: "#6a5238" });
  b.add(-8, 0.6, 5, 2.5, 1.2, 1.2, "wood", { tint: "#7a5a3a" });
}

/**
 * Làng Thông trên đỉnh đồi: làng gỗ, bốn ổ bắn tỉa bao cát ở bốn góc nhìn xuống sườn đồi (đồ khá, hay ra ống ngắm xa),
 * một tháp canh gỗ cao. Rừng thông dày quanh đồi dựng ở `warTrees`.
 */
function buildPines(b: Builder) {
  buildHamlet(b);
  const s = b.site;
  for (const [su, sv] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const u = su * (s.rx - 1.8);
    const v = sv * (s.rz - 1.8);
    // Ổ bắn tỉa hình chữ U quay ra ngoài: bao cát thấp (nằm bắn), gỗ che đầu.
    const nest = b.local(u, v, Math.atan2(su, sv));
    nest(0, 0.35, 1.3, 3.4, 0.7, 0.8, "sandbag");
    nest(-1.6, 0.35, 0, 0.8, 0.7, 2.4, "sandbag");
    nest(1.6, 0.35, 0, 0.8, 0.7, 2.4, "sandbag");
    b.lootAt(u - su * 1.2, 0.05, v - sv * 1.2, 2);
  }
  woodTower(b, 22, -3, 7.5, 2);
}

/** Pháo đài đá cổ: tường thành dày (không phá được bằng đạn thường), thêm tiền đồn đá có lỗ châu mai trước cổng. */
function buildOldFort(b: Builder) {
  buildFortress(b);
  const stone = "#857f73";
  for (const side of [-1, 1]) {
    // Hai ụ đá dày trước cổng nam (tường dày 1,6 m: chỉ nổ lớn mới hề hấn).
    b.add(side * 9, 1.6, -26, 7, 3.2, 1.6, "stone", { tint: stone });
    b.add(side * 12.7, 1.6, -23.5, 1.6, 3.2, 5, "stone", { tint: stone });
    b.lootAt(side * 9, 0.05, -24, 1);
  }
}

/** Kho quân nhu: kho vũ khí (boongke, hòm đồ hiếm), dãy container, xe tải hỏng, hòm đạn dã chiến và vũ khí hạng nặng. */
function buildDepot(b: Builder) {
  buildArmory(b, false);
  const add = b.local(0, 14, 0);
  for (let k = 0; k < 4; k++) container(add, -18 + k * 7, 0, 0, b.rand);
  // Xe tải quân sự hỏng (cabin, thùng sau phủ bạt).
  const truck = b.local(-23, 14.5, Math.PI / 2);
  truck(0, 0.9, 2.4, 2.4, 1.8, 2, "metal", { tint: "#4b5530" });
  truck(0, 1.3, -1.4, 2.4, 2.6, 5, "metal", { tint: "#5a6438" });
  for (const [u, v] of SUPPLY_C) {
    ammoCrates(b, u, v, 0);
    heavyLoot(b, u + 2.4, 0.05, v);
  }
}
/** Chỗ hòm đạn dã chiến ở Kho Quân Nhu (toạ độ riêng của khu). */
const SUPPLY_C: readonly (readonly [number, number])[] = [
  [-22, -16],
  [11, -17],
  [24, -10],
];

/**
 * Thị trấn trung tâm hai bên kênh đào (sông chảy xuyên giữa thị trấn): lưới nhà 3–5 tầng sát nhau (phố hẹp 4–7 m để
 * đánh cận chiến), bờ kè bê tông có lan can; quảng trường lát bê tông bắc ngang kênh (cột cờ ở giữa) và hai cầu nhỏ.
 */
function buildTown(b: Builder) {
  const s = b.site;
  const cols = [-38, -19, 19, 38];
  const rows = [-30, -10, 10, 30];
  // Vạch kẻ giữa các con phố dọc, phố ngang.
  for (const u of [-28.5, -9.5, 9.5, 28.5]) b.add(u, 0.03, 0, 0.2, 0.04, s.rz * 2, "road", { solid: false, tint: "#e8e0c0" });
  for (const v of [-20, 20]) for (const side of [-1, 1]) b.add(side * 29, 0.03, v, 42, 0.04, 0.2, "road", { solid: false, tint: "#e8e0c0" });
  for (const u of cols)
    for (const v of rows) {
      const floors = 3 + Math.floor(b.rand() * 3);
      const w = 12 + Math.floor(b.rand() * 3);
      const d = 11 + Math.floor(b.rand() * 3);
      // Mặt trước (cửa ra vào) quay ra phố gần nhất.
      const rot = v < 0 ? 0 : Math.PI;
      tower(b, u + (b.rand() - 0.5), v + (b.rand() - 0.5), rot, { floors, w, d, tier: floors >= 5 ? 2 : 1, mat: b.rand() < 0.35 ? "brick" : "plaster" });
    }
  // Kênh: bờ kè bê tông đứng hai bên (dày, không phá được), lan can thấp trừ chỗ cầu.
  const wallH = s.h + RIVER_DEPTH + 1;
  const decks: [number, number][] = [
    [0, 26],
    [-31, 7],
    [31, 7],
  ];
  for (const side of [-1, 1]) {
    b.add(side * (RIVER_BED + 0.8), -wallH / 2, 0, 1.2, wallH, s.rz * 2 + 8, "concrete", { tint: "#9c998e", part: "base" });
    const cuts = [-s.rz - 4, ...decks.flatMap(([v, len]) => [v - len / 2, v + len / 2]).sort((x, y) => x - y), s.rz + 4];
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const v0 = cuts[k]!;
      const v1 = cuts[k + 1]!;
      if (v1 - v0 > 0.5) b.add(side * (RIVER_BED + 0.8), 0.5, (v0 + v1) / 2, 0.4, 1.0, v1 - v0, "concrete", { tint: "#b8b4aa" });
    }
  }
  // Quảng trường bắc ngang kênh và hai cầu nhỏ: mặt bê tông (xe tăng chạy được), lan can hai đầu nhìn xuống kênh.
  for (const [v, len] of decks) {
    b.add(0, -0.56, v, 2 * RIVER_BED + 4, 1.2, len, "concrete", { tint: "#a7a49a", part: "floor" });
    markDeck(b);
    for (const end of [-1, 1]) b.add(0, 0.6, v + end * (len / 2 - 0.2), 2 * RIVER_BED + 0.8, 1.1, 0.35, "concrete", { tint: "#b8b4aa" });
  }
  // Bao cát chống giữ quanh quảng trường hai bên bờ.
  for (const [u, v] of [
    [-10.5, -7],
    [10.5, 7],
    [-10.5, 8],
    [10.5, -8],
  ] as const)
    b.add(u, 0.45, v, 0.9, 0.9, 3.4, "sandbag");
  // Xe hỏng, rào chắn bê tông giữa phố hẹp làm chỗ nấp.
  for (let k = 0; k < 16; k++) {
    const alongU = k % 2 === 0;
    const lane = alongU ? [-20, 0, 20][k % 3]! : [-28.5, -9.5, 9.5, 28.5][k % 4]!;
    const along = (b.rand() - 0.5) * (alongU ? 80 : 70);
    const [u, v] = alongU ? [along, lane + (b.rand() - 0.5) * 1.5] : [lane + (b.rand() - 0.5) * 1.5, along];
    // Không đặt xuống kênh, bờ kè.
    if (Math.abs(u) < 12) continue;
    if (b.rand() < 0.45) {
      const car = b.local(u, v, (alongU ? 0 : Math.PI / 2) + (b.rand() - 0.5) * 0.3);
      const tint = ["#7a2c24", "#2d4a6b", "#d8d8d0", "#3a3a3a", "#6b6b2f"][Math.floor(b.rand() * 5)]!;
      car(0, 0.55, 0, 4.2, 0.9, 1.8, "metal", { tint });
      car(-0.2, 1.3, 0, 2.2, 0.7, 1.6, "metal", { tint });
    } else b.add(u, 0.5, v, alongU ? 3 : 0.7, 1, alongU ? 0.7 : 3, "concrete", { tint: "#b8b4aa" });
  }
}

/**
 * Nhà máy xi măng bên bờ biển: xưởng nung lớn, bốn xi lô bê tông cao, băng chuyền trên cao, ống khói, văn phòng,
 * kè bê tông, cầu tàu chìa ra vũng nước sâu cho thuyền cập; phía đông là bãi cát thoải làm bãi đổ bộ.
 */
function buildFactory(b: Builder) {
  const s = b.site;
  const grey = "#b3b0a6";
  // Xưởng nung hai tầng, nhà kho một tầng.
  tower(b, -27, 9, Math.PI, { floors: 2, w: 18, d: 15, mat: "concrete", tint: "#a9a69c", tier: 2 });
  tower(b, -28, -12, 0, { floors: 1, w: 13, d: 10, mat: "concrete", tint: "#a39f94", tier: 1 });
  // Văn phòng ba tầng.
  tower(b, 28, -12, 0, { floors: 3, w: 10, d: 9, mat: "plaster", tier: 1 });
  // Bốn xi lô (hai khối vuông xoay 45° chồng nhau thành tháp tám cạnh), mái phễu, cầu thang thép.
  for (const u of [23, 31])
    for (const v of [12, 20]) {
      const silo = b.local(u, v, 0);
      silo(0, 10, 0, 5.4, 20, 5.4, "concrete", { tint: grey });
      const rot = b.local(u, v, Math.PI / 4);
      rot(0, 10, 0, 5.4, 20, 5.4, "concrete", { tint: grey });
      silo(0, 20.4, 0, 3, 0.8, 3, "metal", { tint: "#8d8a82" });
    }
  // Băng chuyền trên cao nối xưởng với xi lô (đi bên dưới được), cột thép đỡ.
  b.add(1, 12, 16, 38, 0.9, 1.6, "metal", { tint: "#7d7a70" });
  for (const u of [-14, 0, 14]) b.add(u, 5.8, 16, 0.5, 11.5, 0.5, "metal", { tint: "#6c6a62" });
  // Ống khói gạch cao.
  b.add(-10, 14, 21, 3.2, 28, 3.2, "brick", { tint: "#9b4a36" });
  // Đống bao xi măng, container cạnh cầu tàu.
  for (let k = 0; k < 4; k++) b.add(-10 + (k % 2) * 3, 0.5, -20 + Math.floor(k / 2) * 2.2, 2.4, 1, 1.6, "sandbag", { tint: "#cfcabc" });
  const cy = b.local(-30, -21, 0);
  container(cy, 0, 0, 0, b.rand);
  container(cy, 0, 2.6, 0, b.rand);
  container(cy, 7, 0, 0, b.rand);
  // Kè bê tông dọc mép cảng (bờ đứng xuống vũng nước sâu).
  const kw = HARBOUR.u1 - HARBOUR.u0;
  b.add((HARBOUR.u0 + HARBOUR.u1) / 2, -3.275, HARBOUR.v1 - 0.5, kw, 6.45, 1.2, "concrete", { tint: "#9c998e", part: "base" });
  // Cầu tàu: mặt bê tông (xe chạy lên được), cọc thép, cọc buộc thuyền.
  const pu = -18;
  const plen = 30;
  const pv = HARBOUR.v1 + 0.5 - plen / 2;
  b.add(pu, -0.4, pv, 7, 0.8, plen, "concrete", { tint: "#a7a49a", part: "floor" });
  markDeck(b);
  for (let k = 0; k < 4; k++)
    for (const side of [-1, 1]) {
      const v = HARBOUR.v1 - 6 - k * 8;
      b.add(pu + side * 3, -0.8 - (s.h + 4) / 2, v, 0.6, s.h + 4, 0.6, "metal", { tint: "#4a4842", part: "base" });
      b.add(pu + side * 3.2, 0.3, v + 2, 0.4, 0.6, 0.4, "metal", { tint: "#2a2a2a" });
    }
  b.lootAt(pu, 0.05, pv - 8, 2);
  // Bãi đổ bộ phía đông: vài chông sắt (thấp, xe tăng cán qua được) trên bãi cát.
  for (let k = 0; k < 5; k++) {
    const hh = b.local(14 + k * 5, -s.rz - 9 - (k % 2) * 4, k * 0.7);
    hh(0, 0.55, 0, 1.8, 0.25, 0.25, "metal", { tint: "#3a3a36", pitch: 0.6 });
    hh(0, 0.55, 0, 0.25, 0.25, 1.8, "metal", { tint: "#3a3a36" });
  }
}

/**
 * Đồn biên phòng bên bờ đông: tường đá thấp bao quanh, hai nhà lính, cổng tây mở ra cây cầu; tháp canh bê tông năm
 * tầng ở góc tây nam nhìn thẳng xuống cầu và sông.
 */
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
  tower(b, 12, -13, 0, { floors: 1, w: 10, d: 7, mat: "stone", tier: 2 });
  tower(b, 12, 13, Math.PI, { floors: 2, w: 10, d: 7, mat: "plaster", tier: 1 });
  // Tháp canh cao (năm tầng, sân thượng có lan can) ở góc tây nam: chỗ bắn tỉa giữ cầu.
  tower(b, -15, -11, -Math.PI / 2, { floors: 5, w: 7, d: 7, mat: "concrete", tint: "#a7a59b", tier: 2 });
  // Trạm gác cổng cầu: bao cát hai bên.
  for (const side of [-1, 1]) b.add(-W - 2.5, 0.45, side * 5.5, 0.9, 0.9, 3, "sandbag");
}

/** Cây cầu: mặt bê tông (xe tăng chạy được), lan can bê tông, dàn thép hai bên, trụ cầu dưới sông. */
function buildBridge(b: Builder) {
  const L = WAR_BRIDGE.len;
  const Wd = WAR_BRIDGE.width;
  const top = 0.04;
  b.add(0, top - 0.6, 0, L, 1.2, Wd, "concrete", { tint: "#9f9c93", part: "floor" });
  markDeck(b);
  b.add(0, top + 0.01, 0, L - 2, 0.02, 0.2, "road", { solid: false, tint: "#e8e0c0" });
  for (const side of [-1, 1]) {
    // Lan can bê tông cao hơn gầm xe: xe tăng không lao xuống sông được.
    b.add(0, top + 0.7, side * (Wd / 2 - 0.25), L, 1.4, 0.5, "concrete", { tint: "#b3b0a6" });
    // Dàn thép: cột đứng, thanh biên trên, thanh chéo.
    const sv = side * (Wd / 2 + 0.25);
    for (let u = -L / 2 + 2; u <= L / 2 - 2 + 0.01; u += 6) b.add(u, top + 2.6, sv, 0.4, 5.2, 0.4, "metal", { tint: "#5d6a72" });
    b.add(0, top + 5.3, sv, L - 3.6, 0.45, 0.45, "metal", { tint: "#5d6a72" });
    const slope = Math.atan2(5, 6);
    for (let u = -L / 2 + 5; u <= L / 2 - 4.99; u += 6) {
      const diag = b.local(u, sv, Math.PI / 2);
      diag(0, top + 2.6, 0, 0.25, 0.25, Math.hypot(5, 6) - 0.3, "metal", { tint: "#56626a", pitch: (Math.round((u + L / 2) / 6) % 2 ? 1 : -1) * slope });
    }
  }
  // Dầm ngang trên đầu (xe chui qua được).
  for (let u = -L / 2 + 2; u <= L / 2 - 2 + 0.01; u += 12) b.add(u, top + 5.3, 0, 0.35, 0.35, Wd + 0.9, "metal", { tint: "#5d6a72" });
  // Trụ cầu từ đáy sông lên tới mặt cầu.
  const bottom = -RIVER_DEPTH - 1 - BRIDGE_TOP;
  const pierTop = top - 1.2;
  for (const u of [-8, 8]) b.add(u, (bottom + pierTop) / 2, 0, 2.4, pierTop - bottom, Wd - 1, "concrete", { tint: "#8f8c83", part: "base" });
}

/** Căn cứ: kho vũ khí có hàng rào, bãi đậu xe tăng bê tông, lều trại, hòm đạn tiếp tế. */
function buildHq(b: Builder) {
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
/** Hòm đạn tiếp tế trước cổng căn cứ (toạ độ riêng của khu). */
const SUPPLY_HQ = [31.5, -8] as const;
/** Sân đỗ trực thăng trong căn cứ (toạ độ riêng của khu; góc sân sau, xa bãi xe tăng). */
const HELIPAD_HQ = [14, -18] as const;
/** Sân đỗ trực thăng của hai phe (toạ độ thế giới, độ cao mặt sân). */
export const WAR_HELIPADS = {
  blue: { ...toWorld(WAR_SITES[0]!, HELIPAD_HQ[0], HELIPAD_HQ[1]), y: WAR_SITES[0]!.h, rotY: WAR_SITES[0]!.rot + Math.PI / 2 },
  red: { ...toWorld(WAR_SITES[1]!, HELIPAD_HQ[0], HELIPAD_HQ[1]), y: WAR_SITES[1]!.h, rotY: WAR_SITES[1]!.rot + Math.PI / 2 },
} as const;

// ---------------------------------------------------------------------------- cây cỏ

/** Chỗ không trồng cây: lòng sông, đường dẫn lên cầu, quanh khúc cạn, đường thung lũng, bãi đổ bộ và cảng nhà máy. */
function treeFree(world: World, x: number, z: number): boolean {
  if (world.heightAt(x, z) < 0.8) return false;
  if (onBridgeRoad(x, z, 8) || onValleyRoad(x, z, 4)) return false;
  for (const f of WAR_FORDS) if (Math.hypot(x - f.x, z - f.z) < 34) return false;
  return outside(SITE_G, x, z, 32) > 0;
}

function warTrees(rand: () => number, world: World): Tree[] {
  const trees: Tree[] = [];
  const near = (x: number, z: number, r: number) => trees.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
  // Dừa ven biển.
  for (let tries = 0; trees.length < 180 && tries < 5000; tries++) {
    const x = (rand() * 2 - 1) * LAND_X;
    const z = (rand() * 2 - 1) * LAND_Z;
    const inland = warInland(x, z);
    if (inland < 4 || inland > 26 || world.heightAt(x, z) < 0.7 || !world.isClear(x, z, 5) || !treeFree(world, x, z) || near(x, z, 5)) continue;
    trees.push({ id: `p${trees.length}`, kind: "palm", x, z, height: 6 + rand() * 3, lean: (rand() - 0.5) * 0.4 });
  }
  // Rừng thông dày quanh đồi Làng Thông (thân cao, tán hẹp): chỗ nấp cho xạ thủ bắn tỉa.
  const pines = WAR_SITES.find((s) => s.id === "a")!;
  const start = trees.length;
  for (let tries = 0; trees.length - start < 260 && tries < 6000; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 34 + Math.sqrt(rand()) * 55;
    const x = pines.x + Math.cos(a) * r;
    const z = pines.z + Math.sin(a) * r;
    if (warInland(x, z) < 26 || !world.isClear(x, z, 6) || !treeFree(world, x, z) || near(x, z, 3.4)) continue;
    trees.push({ id: `b${trees.length}`, kind: "broadleaf", x, z, height: 8 + rand() * 4, lean: 0.7 + rand() * 0.25 });
  }
  // Rừng từng cụm giữa các cứ điểm (chừa đường xe tăng).
  const before = trees.length;
  const groves: { x: number; z: number }[] = [];
  for (let k = 0; k < 40; k++) groves.push({ x: (rand() * 2 - 1) * (LAND_X - 50), z: (rand() * 2 - 1) * (LAND_Z - 40) });
  for (let tries = 0; trees.length - before < 640 && tries < 14000; tries++) {
    const g = groves[Math.floor(rand() * groves.length)]!;
    const x = g.x + (rand() - 0.5) * 50;
    const z = g.z + (rand() - 0.5) * 50;
    if (warInland(x, z) < 26 || !world.isClear(x, z, 8) || !treeFree(world, x, z) || near(x, z, 4.5)) continue;
    trees.push({ id: `b${trees.length}`, kind: "broadleaf", x, z, height: 5 + rand() * 4, lean: 0.85 + rand() * 0.45 });
  }
  return trees;
}

function warGrass(rand: () => number, world: World): GrassPatch[] {
  const out: GrassPatch[] = [];
  for (let tries = 0; out.length < 70 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * (LAND_X - 40);
    const z = (rand() * 2 - 1) * (LAND_Z - 30);
    if (warInland(x, z) < 20 || !world.isClear(x, z, 10) || !treeFree(world, x, z)) continue;
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
  const supplies: { x: number; y: number; z: number }[] = [];
  const flags: FlagSpot[] = [];
  const layoutRand = makeRand(20261101);
  let buildings = 0;
  for (const s of WAR_SITES) {
    const b = new Builder(s, layoutRand);
    if (s.build === "hq") buildHq(b);
    else if (s.build === "hamlet") buildHamlet(b);
    else if (s.build === "pines") buildPines(b);
    else if (s.build === "fortress") buildOldFort(b);
    else if (s.build === "depot") buildDepot(b);
    else if (s.build === "town") buildTown(b);
    else if (s.build === "factory") buildFactory(b);
    else buildOutpost(b);
    if (s.flag) {
      // Pháo đài, thị trấn đã có sẵn tường, nhà: chỉ thêm cột cờ; nơi khác dựng công sự quanh cột cờ.
      if (s.build === "fortress" || s.build === "town") {
        const add = b.local(s.flag.u, s.flag.v, 0);
        add(0, 0.25, 0, 1.6, 0.5, 1.6, "concrete", { tint: "#a8a596" });
        add(0, 4.5, 0, 0.12, 8, 0.12, "metal", { tint: "#d8d8d0", solid: false });
      } else stronghold(b, s.flag.u, s.flag.v, s.flag.r, { tower: s.build !== "depot" && s.build !== "pines", bunkers: s.build !== "depot" });
      const p = toWorld(s, s.flag.u, s.flag.v);
      flags.push({ id: s.flag.letter, name: s.name, x: p.x, z: p.z, y: s.h, r: s.flag.r });
    }
    const spots = s.build === "depot" ? SUPPLY_C : s.build === "hq" ? [SUPPLY_HQ] : [];
    for (const [u, v] of spots) supplies.push({ ...toWorld(s, u, v), y: s.h });
    buildings = b.numberBuildings(buildings);
    boxes.push(...b.boxes);
    loot.push(...b.loot);
  }
  // Cây cầu qua sông ở Đồn Biên Phòng (khu riêng, không san nền).
  const bridgeSite: BattleSite = { id: "bridge", name: "Cầu", kind: "village", x: WAR_BRIDGE.x, z: WAR_BRIDGE.z, rx: WAR_BRIDGE.len / 2, rz: WAR_BRIDGE.width / 2, rot: 0, h: BRIDGE_TOP, ground: "concrete" };
  const bridge = new Builder(bridgeSite, layoutRand);
  buildBridge(bridge);
  boxes.push(...bridge.boxes);

  const inSite = (x: number, z: number, grow: number) => WAR_SITES.find((s) => outside(s, x, z, grow) === 0) ?? null;
  const surface = (x: number, z: number): Surface => {
    const inland = warInland(x, z);
    const st = inSite(x, z, 1);
    const road = !st && (onBridgeRoad(x, z) ? "asphalt" : onValleyRoad(x, z) ? "dirt" : null);
    return { island: inland < 0 && !st ? "sea" : "main", inland, islet: null, reef: false, pad: !!st || !!road, ground: st ? st.ground : road || undefined };
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
      if (Math.abs(x - WAR_BRIDGE.x) < WAR_BRIDGE.len / 2 && Math.abs(z - WAR_BRIDGE.z) < 6) return "Cầu Biên Phòng";
      const inland = warInland(x, z);
      if (inland < -3) return "Biển";
      if (inRiver(x, z)) return fordness(x, z) > 0.3 ? "Khúc cạn" : "Sông";
      if (onValleyRoad(x, z, 6)) return "Thung lũng Suối";
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

  const map: BattleMap = { layout: "war", half: WAR_HALF, flags, world, sites: WAR_SITES, boxes, loot, mines: [], supplies, index: buildIndex(boxes) };
  cache.set(seed, map);
  registerMap(map);
  return map;
}

/** Bản đồ theo chế độ trận: chiến trường 50 vs 50 hay đảo sinh tồn / đồng đội. */
export function mapForMode(mode: string, seed: number): BattleMap {
  return mode === "war" ? warMap(seed || 1) : battleMapFor(seed || 1);
}

// ---------------------------------------------------------------------------- tìm đường qua sông, tiểu đội

/** Bên nào của sông: −1 phía tây, 1 phía đông, 0 đang ở lòng sông, bờ sông. */
export function riverSide(x: number, z: number): number {
  const d = x - riverX(z);
  return Math.abs(d) < RIVER_ZONE ? 0 : Math.sign(d);
}

/** Các chỗ qua sông (cầu, hai khúc cạn) theo độ z. */
const CROSSINGS: readonly number[] = [WAR_BRIDGE.z, SITE_D.z, ...WAR_FORDS.map((f) => f.z)];

/**
 * Điểm cần đi tới trước trên đường từ (x, z) tới (tx, tz) trên chiến trường: khác bờ sông thì vòng qua cầu hay khúc
 * cạn gần nhất (tới đầu bên này, rồi sang đầu bên kia); cùng bờ thì đi thẳng tới đích.
 */
export function warRoute(x: number, z: number, tx: number, tz: number): { x: number; z: number } {
  const to = riverSide(tx, tz);
  const from = riverSide(x, z);
  if (to === 0 || from === to) return { x: tx, z: tz };
  const end = (cz: number, side: number) => ({ x: riverX(cz) + side * CROSS_REACH, z: cz });
  if (from === 0) {
    // Đang ở giữa sông: lên đầu bên kia của chỗ qua sông gần nhất (không ở chỗ qua sông thì bơi thẳng sang).
    let best = CROSSINGS[0]!;
    for (const cz of CROSSINGS) if (Math.abs(cz - z) < Math.abs(best - z)) best = cz;
    return Math.abs(best - z) < 14 ? end(best, to) : { x: riverX(z) + to * CROSS_REACH, z };
  }
  let best = CROSSINGS[0]!;
  let bestD = Infinity;
  for (const cz of CROSSINGS) {
    const a = end(cz, from);
    const c = end(cz, to);
    const d = Math.hypot(a.x - x, a.z - z) + Math.hypot(tx - c.x, tz - c.z);
    if (d < bestD) {
      bestD = d;
      best = cz;
    }
  }
  // Tới gần đầu bên này (hay đã đi quá về phía sông) thì sang đầu bên kia.
  const entry = end(best, from);
  const onWay = Math.abs(z - best) < 8 && Math.abs(x - riverX(best)) < CROSS_REACH + 1;
  return onWay || Math.hypot(entry.x - x, entry.z - z) < 8 ? end(best, to) : entry;
}

/** Số người mỗi tổ (tiểu đội) trên chiến trường. */
export const WAR_SQUAD = 5;

/**
 * Đội trưởng tổ của người `id` trên chiến trường: mỗi phe xếp người chơi trước (theo id), máy sau (theo số), chia
 * thành từng tổ năm người; người đầu tổ là đội trưởng. Server và client tính như nhau từ danh sách người trong phòng.
 */
export function warSquadLeader(players: Iterable<readonly [string, { team: string; bot: boolean }]>, id: string): string {
  const list = [...players];
  const side = list.find(([pid]) => pid === id)?.[1].team;
  if (!side) return "";
  const humans: string[] = [];
  const bots: string[] = [];
  for (const [pid, p] of list) if (p.team === side) (p.bot ? bots : humans).push(pid);
  const num = (s: string) => Number(s.replace(/\D/g, "")) || 0;
  humans.sort();
  bots.sort((a, b) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0));
  const order = [...humans, ...bots];
  const k = order.indexOf(id);
  return order[Math.floor(k / WAR_SQUAD) * WAR_SQUAD] ?? "";
}
