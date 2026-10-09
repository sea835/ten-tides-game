import type { Builder } from "./battle.ts";
import { tower } from "./battle.ts";
import type { World } from "./worldgen.ts";
import { makeRand } from "./worldgen.ts";
import {
  TrenchField,
  ammoCrates,
  bastionTower,
  buildHq,
  flattenSites,
  grassPatches,
  groveTrees,
  heavyLoot,
  lineTrench,
  markDeck,
  pillbox,
  polyDist,
  rampart,
  siteOn,
  smooth,
  wireLine,
  woodTower,
  zigzag,
  type Pt,
  type Trench,
  type WarMapDef,
} from "./warKit.ts";

// El Alamein (Ai Cập, 1942): sa mạc ven Địa Trung Hải. Bờ biển phía bắc có đường ven biển và đường sắt chạy đông
// tây, ga El Alamein (A), đồi Tel el Eisa (B), cảng Mersa (G). Vào sâu là biển cát gợn sóng, sống núi đá Ruweisat (C)
// chạy ngang giữa trận địa, đồi Kidney (F), ốc đảo và pháo đài Bir Hakeim (D), pháo đài sa mạc tường đá có bốn tháp
// góc (E). Hai "Vườn Quỷ" — dải bãi mìn chạy bắc nam — chặn đường xe tăng, chỉ chừa vài lối mở có cắm cọc rào.

const HALF = 336;
const RIDGE: readonly Pt[] = [
  [-130, -50],
  [-40, -64],
  [40, -56],
  [150, -66],
];
const KIDNEY = { x: 120, z: 50, r: 34, h: 6 } as const;
const EISA = { x: -180, z: 185, r: 36, h: 9 } as const;
const OASIS = { x: -112, z: -136, r: 16 } as const;
const ROAD_Z = 158;
const RAIL_Z = 168;
/** Bãi mìn: hai dải bắc nam; lối mở (z) qua mỗi dải. */
const MINEBELTS = [
  { x: -75, gaps: [-170, -20, 110] },
  { x: 75, gaps: [-120, 20, 120] },
];
const BELT_HALF = 9;

function coastZ(x: number): number {
  return 222 + 5 * Math.sin(x * 0.025) + 2 * Math.sin(x * 0.09);
}
function inland(x: number, z: number): number {
  const sea = coastZ(x) - z;
  return Math.min(sea, Math.hypot(x - OASIS.x, z - OASIS.z) - OASIS.r * 0.55);
}

function raw(x: number, z: number): number {
  const off = coastZ(x) - z;
  if (off < 0) return -1.6 * smooth(0, 10, -off) - 8 * smooth(10, 70, -off);
  let h = 1.6 * smooth(0, 30, off) + 2.2 * smooth(30, 90, off);
  // Đụn cát gợn sóng chạy chéo đông bắc – tây nam (đỉnh tròn, chân thoải).
  const dune = Math.sin((x * 0.55 + z) * 0.034 + 0.8 * Math.sin(x * 0.011));
  h += 3.4 * Math.pow(Math.max(0, dune), 1.6) * smooth(40, 110, off);
  h += 0.9 * Math.sin(x * 0.05 + z * 0.02) * smooth(20, 60, off);
  // Sống núi đá Ruweisat, đồi Kidney, đồi Tel el Eisa.
  const dr = polyDist(RIDGE, x, z);
  if (dr < 40) h += 11 * smooth(40, 8, dr) * smooth(-150, -110, x) * (1 - smooth(150, 175, x));
  for (const hl of [KIDNEY, EISA]) {
    const d = Math.hypot(x - hl.x, z - hl.z);
    if (d < hl.r) h += hl.h * smooth(hl.r, hl.r * 0.2, d);
  }
  // Ốc đảo: lòng chảo nông có hồ nước.
  const dO = Math.hypot(x - OASIS.x, z - OASIS.z);
  if (dO < OASIS.r * 2.2) h = Math.min(h, -0.8 + (h + 0.8) * smooth(OASIS.r * 0.5, OASIS.r * 2.2, dO));
  return h;
}

const S = (o: Parameters<typeof siteOn>[1]) => siteOn(raw, o);

const SITES = [
  S({ id: "hqb", name: "Căn cứ Xanh", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0, build: buildHq }),
  S({ id: "hqr", name: "Căn cứ Đỏ", kind: "armory", ground: "concrete", x: 262, z: 0, rx: 30, rz: 26, rot: Math.PI, build: buildHq }),
  S({ id: "a", name: "Ga El Alamein", kind: "city", ground: "concrete", x: -40, z: 176, rx: 26, rz: 18, rot: 0, flag: { u: 0, v: -8, r: 15, letter: "A" }, fort: "pole", build: buildStation }),
  S({ id: "b", name: "Đồi Tel el Eisa", ground: "stone", x: EISA.x, z: EISA.z, rx: 20, rz: 18, rot: 0.3, flag: { u: 0, v: 0, r: 14, letter: "B" }, fort: "ring", build: buildSangars }),
  S({ id: "c", name: "Sống núi Ruweisat", ground: "stone", x: 0, z: -60, rx: 22, rz: 16, rot: -0.1, flag: { u: 0, v: 0, r: 15, letter: "C" }, fort: "ring", build: buildSangars }),
  S({ id: "d", name: "Pháo đài Bir Hakeim", kind: "fortress", ground: "stone", x: -150, z: -172, rx: 24, rz: 22, rot: 0.1, flag: { u: 0, v: 0, r: 15, letter: "D" }, fort: "pole", build: (b) => buildDesertFort(b, 16) }),
  S({ id: "e", name: "Pháo đài Sa mạc", kind: "fortress", ground: "stone", x: 160, z: -170, rx: 26, rz: 24, rot: -0.15, flag: { u: 0, v: 0, r: 15, letter: "E" }, fort: "pole", build: (b) => buildDesertFort(b, 19) }),
  S({ id: "f", name: "Đồi Kidney", ground: "dirt", x: KIDNEY.x, z: KIDNEY.z, rx: 20, rz: 16, rot: 0.4, flag: { u: 0, v: 0, r: 14, letter: "F" }, build: buildSangars }),
  S({ id: "g", name: "Cảng Mersa", kind: "port", ground: "concrete", x: 170, z: 196, rx: 28, rz: 18, rot: 0, flag: { u: -6, v: -6, r: 15, letter: "G" }, fort: "pole", build: buildHarbour }),
];

const TRENCHES: Trench[] = [
  { pts: zigzag([-30, -40], [30, -38], 2.5, 7) },
  { pts: zigzag([-30, -82], [30, -78], 2.5, 7) },
  { pts: zigzag([92, 78], [150, 78], 2, 6) },
  { pts: zigzag([-208, 160], [-208, 212], 2, 6) },
  // Tuyến phòng thủ hai phe ngay sau bãi mìn.
  { pts: zigzag([-100, -240], [-100, 140], 3, 8) },
  { pts: zigzag([100, -240], [100, 140], 3, 8) },
  // Vòng hào "hộp phòng thủ" quanh hai pháo đài.
  { pts: boxRing(-150, -172, 36, 32) },
  { pts: boxRing(160, -170, 38, 34) },
];
function boxRing(cx: number, cz: number, rx: number, rz: number): Pt[] {
  return [...zigzag([cx - rx, cz - rz], [cx + rx, cz - rz], 2, 7), ...zigzag([cx + rx, cz - rz], [cx + rx, cz + rz], 2, 7).slice(1), ...zigzag([cx + rx, cz + rz], [cx - rx, cz + rz], 2, 7).slice(1), ...zigzag([cx - rx, cz + rz], [cx - rx, cz - rz], 2, 7).slice(1)];
}
const TF = new TrenchField(TRENCHES);

function inBelt(x: number, z: number): boolean {
  for (const belt of MINEBELTS) {
    if (Math.abs(x - belt.x) > BELT_HALF || z > 145 || z < -260) continue;
    if (belt.gaps.some((g) => Math.abs(z - g) < 8)) return false;
    return true;
  }
  return false;
}

function ground(x: number, z: number): number {
  let h = flattenSites(SITES, x, z, raw(x, z), 16);
  // Nền đường ven biển, đường sắt.
  const dz = Math.abs(z - (ROAD_Z + RAIL_Z) / 2);
  if (dz < 14 && coastZ(x) - z > 20) h = h + (2.2 - h) * (1 - smooth(9, 14, dz));
  return h;
}

function height(x: number, z: number): number {
  return ground(x, z) - TF.cut(x, z);
}

// ---------------------------------------------------------------------------- công trình

/** Ga El Alamein: nhà ga đá trắng một tầng, tháp nước, sân ga, toa hàng. */
function buildStation(b: Builder) {
  tower(b, 0, 2, Math.PI, { floors: 1, w: 16, d: 8, mat: "plaster", tint: "#e2d6bc", tier: 2 });
  woodTower(b, 18, -6, 6.5, 2);
  b.add(0, 0.4, -10, 44, 0.8, 4, "concrete", { tint: "#b8b0a0" });
  for (const u of [-18, 10]) b.add(u, 1.6, -15, 10, 2.6, 2.8, "wood", { tint: "#7a5a3a" });
  heavyLoot(b, -8, 0.05, 6);
}

/** Ụ đá (sangar): tường đá xếp hình chữ U quanh đỉnh đồi, lô cốt, hầm, cọc rào. */
function buildSangars(b: Builder) {
  for (const [u, v, rot] of [
    [-12, -6, 0.3],
    [12, -6, -0.3],
    [0, 10, Math.PI],
    [-14, 8, 2.4],
  ] as const) {
    const s = b.local(u, v, rot);
    s(0, 0.5, 1.4, 4, 1, 0.9, "stone", { tint: "#a58f6c" });
    s(-1.8, 0.5, 0, 0.9, 1, 3, "stone", { tint: "#a58f6c" });
    s(1.8, 0.5, 0, 0.9, 1, 3, "stone", { tint: "#a58f6c" });
  }
  pillbox(b, 14, 0, 8, 0, false, "#b9a988");
  b.lootAt(-12, 0.05, -6, 2);
  ammoCrates(b, 4, -10, 0.2);
}

/**
 * Pháo đài sa mạc tường đá trát vôi kiểu Lê dương: tường cao có lỗ châu mai, bốn tháp góc, cổng nam, sân trong có
 * giếng, doanh trại hai tầng.
 */
function buildDesertFort(b: Builder, s: number) {
  const ring: Pt[] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  rampart(b, ring, 0, 4, 1, "stone", "#d8c9a6", [0, 2]);
  for (const [u, v] of ring) bastionTower(b, u, 0, v, 2.6, 6, "stone", "#cfbf9a");
  tower(b, 0, s - 7, Math.PI, { floors: 2, w: s * 1.2, d: 6, mat: "plaster", tint: "#e3d7bb", tier: 2 });
  b.add(0, 0.5, -2, 2.4, 1, 2.4, "stone", { tint: "#9c8d70" });
  heavyLoot(b, -s / 2, 0.05, -s / 2);
  ammoCrates(b, s / 2, -s / 2, 0);
}

/** Cảng Mersa: cầu tàu bê tông chìa ra biển, kho hàng, cần cẩu, thùng phuy dầu. */
function buildHarbour(b: Builder) {
  tower(b, -12, 8, Math.PI, { floors: 2, w: 16, d: 10, mat: "plaster", tint: "#dccfb0", tier: 2 });
  tower(b, 14, 8, Math.PI, { floors: 1, w: 12, d: 9, mat: "metal", tint: "#8a8b84", tier: 1 });
  b.add(10, -0.4, 34, 8, 0.8, 34, "concrete", { tint: "#a7a49a" });
  markDeck(b);
  for (let k = 0; k < 6; k++) b.add(-20 + k * 2.4, 0.6, -10, 1.1, 1.2, 1.1, "metal", { tint: "#5d5446" });
  heavyLoot(b, 14, 0.05, 8);
}

// ---------------------------------------------------------------------------- đường ray, bãi mìn, hào

function extra(b: Builder) {
  // Đường ray ven biển (không chắn), cọc điện báo.
  for (let x = -320; x < 320; x += 8) {
    if (coastZ(x) - RAIL_Z < 14) continue;
    for (const s of [-0.75, 0.75]) b.add(x, ground(x, RAIL_Z + s) + 0.1, RAIL_Z + s, 8, 0.12, 0.12, "metal", { tint: "#6b665c", solid: false });
    if (Math.round(x / 8) % 6 === 0) b.add(x, ground(x, RAIL_Z + 5) + 2.5, RAIL_Z + 5, 0.2, 5, 0.2, "wood", { tint: "#6a5238", solid: false });
  }
  // Cọc rào đánh dấu hai mép bãi mìn (lối mở có cọc hai bên).
  for (const belt of MINEBELTS) {
    for (let z = -256; z < 140; z += 12) {
      if (belt.gaps.some((g) => Math.abs(z - g) < 10)) continue;
      for (const side of [-1, 1]) {
        const x = belt.x + side * (BELT_HALF + 1);
        b.add(x, ground(x, z) + 0.5, z, 0.15, 1, 0.15, "wood", { tint: "#5c4a33", solid: false });
      }
    }
    // Dây thép gai dọc mép phía sau bãi mìn (phía mỗi phe).
    for (let z = -250; z < 130; z += 26) {
      if (belt.gaps.some((g) => Math.abs(z + 12 - g) < 14)) continue;
      const x = belt.x + (belt.x < 0 ? -1 : 1) * (BELT_HALF + 4);
      wireLine(b, [x, z], [x, z + 22], ground);
    }
  }
  for (const t of TRENCHES) lineTrench(b, t, ground, { mat: "sandbag", sides: [1] });
  // Xác xe tăng cháy rải rác (chỗ nấp giữa sa mạc).
  const rand = makeRand(1942);
  for (let k = 0; k < 14; k++) {
    const x = -200 + rand() * 400;
    const z = -230 + rand() * 340;
    if (inBelt(x, z) || SITES.some((s) => Math.hypot(s.x - x, s.z - z) < 40) || TF.inside(x, z)) continue;
    const r = rand() * Math.PI;
    const g = ground(x, z);
    b.add(x, g + 0.75, z, 3, 1.4, 5.6, "rust", { rot: r });
    b.add(x, g + 1.85, z, 2, 0.9, 2.4, "rust", { rot: r + 0.3 });
  }
}

/** Mìn rải trong hai dải "Vườn Quỷ" (chừa lối mở). */
function mines(rand: () => number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const belt of MINEBELTS)
    for (let tries = 0, n = 0; n < 70 && tries < 900; tries++) {
      const x = belt.x + (rand() * 2 - 1) * (BELT_HALF - 1);
      const z = -250 + rand() * 390;
      if (!inBelt(x, z) || out.some((m) => Math.hypot(m.x - x, m.z - z) < 3)) continue;
      out.push({ x, z });
      n++;
    }
  return out;
}

function trees(rand: () => number, world: World) {
  // Chà là quanh ốc đảo và ven biển, vài bụi keo gai giữa sa mạc.
  const oasis = groveTrees(rand, world, { n: 60, groves: 4, spread: 50, x0: OASIS.x - 20, z0: OASIS.z - 20, x1: OASIS.x + 20, z1: OASIS.z + 20, kind: "palm", height: [6, 10], lean: [-0.25, 0.25], gap: 4, ok: (x, z) => Math.hypot(x - OASIS.x, z - OASIS.z) > OASIS.r * 0.7 });
  const coast = groveTrees(rand, world, { n: 70, groves: 10, spread: 40, x0: -300, z0: 180, x1: 300, z1: 215, kind: "palm", height: [6, 9], lean: [-0.3, 0.3], gap: 5, ok: (x, z) => coastZ(x) - z > 4 && Math.abs(z - ROAD_Z) > 8 && Math.abs(z - RAIL_Z) > 5 });
  const scrub = groveTrees(rand, world, { n: 50, groves: 20, spread: 60, x0: -300, z0: -300, x1: 300, z1: 140, kind: "broadleaf", height: [3, 4.5], lean: [0.7, 1], gap: 8, ok: (x, z) => !inBelt(x, z) && !TF.inside(x, z), idFrom: oasis.length });
  return [...oasis, ...coast, ...scrub];
}

export const ALAMEIN: WarMapDef = {
  id: "alamein",
  half: HALF,
  extent: 300,
  biome: "desert",
  layoutSeed: 19421023,
  sites: SITES,
  height,
  inland,
  ground: (x, z) => (Math.abs(z - ROAD_Z) < 4 && coastZ(x) - z > 20 ? "asphalt" : TF.inside(x, z) ? "dirt" : polyDist(RIDGE, x, z) < 14 ? "stone" : undefined),
  extra,
  trees,
  grass: (rand, world) => grassPatches(rand, world, 14, -260, -260, 260, 150, (x, z) => Math.hypot(x - OASIS.x, z - OASIS.z) < 60 || rand() < 0.15),
  region: (x, z) => {
    if (coastZ(x) - z < -3) return "Địa Trung Hải";
    if (Math.hypot(x - OASIS.x, z - OASIS.z) < OASIS.r * 2) return "Ốc đảo";
    if (inBelt(x, z)) return "Vườn Quỷ (bãi mìn)";
    if (TF.inside(x, z)) return "Chiến hào";
    if (Math.abs(z - ROAD_Z) < 14 && coastZ(x) - z > 20) return "Đường ven biển";
    if (polyDist(RIDGE, x, z) < 24) return "Sống núi Ruweisat";
    return "Sa mạc";
  },
  harbors: [
    { x: 175, z: 250 },
    { x: -175, z: 250 },
  ],
  emplacements: [
    { kind: "mortar", x: -110, z: 60, rotY: Math.PI / 2 },
    { kind: "mortar", x: -110, z: -120, rotY: Math.PI / 2 },
    { kind: "mortar", x: 110, z: 0, rotY: -Math.PI / 2 },
    { kind: "mortar", x: 110, z: -140, rotY: -Math.PI / 2 },
    { kind: "mortar", x: 0, z: -48, rotY: 0 },
    { kind: "hmg_nest", x: -100, z: -20, rotY: Math.PI / 2 },
    { kind: "hmg_nest", x: 100, z: 20, rotY: -Math.PI / 2 },
    { kind: "hmg_nest", x: -20, z: 160, rotY: Math.PI / 2 },
  ],
  mines,
};
