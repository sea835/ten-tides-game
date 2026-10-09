import { Builder, container, tower } from "./battle.ts";
import type { World } from "./worldgen.ts";
import { makeRand } from "./worldgen.ts";
import {
  CraterField,
  adopt,
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

// Stalingrad (Liên Xô, mùa đông 1942): thành phố đổ nát phủ tuyết bên bờ tây sông Volga. Phe Đỏ bám bờ sông (căn cứ
// sát bến phà), phe Xanh tiến từ thảo nguyên phía tây. Đồi Mamayev Kurgan (A) nhìn xuống cả thành phố, nhà máy Tháng
// Mười Đỏ (B) với xưởng lớn, ống khói; ga Stalingrad-1 (C) trên tuyến đường sắt đắp cao; Nhà Pavlov (D) bốn tầng có
// bao cát, chiến hào; kho thóc khổng lồ (E); nhà máy máy kéo (F); sân bay Gumrak trên thảo nguyên (G). Một khe núi
// (balka) cắt ngang thành phố. Khắp nơi là nhà sập, đống gạch, xác toa tàu.

const HALF = 336;
/** Bờ sông Volga: đông hơn x này là nước. */
const BANK = 268;
const KURGAN = { x: -10, z: 170, r: 78, h: 24 } as const;
/** Khe núi Tsaritsa: chạy đông tây ở z ≈ −110, sâu 6 m, thành thoải (xe tăng qua được ở hai chỗ lấp). */
const BALKA: readonly Pt[] = [
  [-120, -100],
  [-40, -112],
  [40, -104],
  [130, -116],
  [210, -108],
  [BANK + 10, -112],
];
const BALKA_FILLS = [-40, 130];
const RAIL_X = -50;

function inland(x: number, z: number): number {
  return BANK - x + 3 * Math.sin(z * 0.03);
}

function raw(x: number, z: number): number {
  const off = inland(x, z);
  if (off < 0) return -1.5 * smooth(0, 6, -off) - 7 * smooth(6, 40, -off);
  // Bờ sông dốc đứng cao 6 m (vách đất sét), thành phố trên cao.
  let h = 4 + 4 * smooth(2, 16, off) + 1.2 * Math.sin(x * 0.021) * Math.cos(z * 0.018) + 0.6 * Math.sin((x - z) * 0.05);
  const dk = Math.hypot(x - KURGAN.x, z - KURGAN.z);
  if (dk < KURGAN.r) h += KURGAN.h * smooth(KURGAN.r, 12, dk);
  // Thảo nguyên phía tây gợn sóng thoải.
  h += 2.5 * smooth(-120, -220, x) * Math.sin(z * 0.012 + x * 0.01);
  return h;
}

function balkaCut(x: number, z: number): number {
  if (z < -150 || z > -70 || x < -130) return 0;
  const d = polyDist(BALKA, x, z);
  if (d > 16) return 0;
  const fill = BALKA_FILLS.some((fx) => Math.abs(x - fx) < 7) ? 0.85 : 0;
  return 6 * (1 - smooth(4, 16, d)) * (1 - fill) * smooth(-130, -110, x);
}

const S = (o: Parameters<typeof siteOn>[1]) => siteOn(raw, o);

const SITES = [
  S({ id: "hqb", name: "Căn cứ Xanh (thảo nguyên)", kind: "armory", ground: "concrete", x: -262, z: 0, rx: 30, rz: 26, rot: 0, build: buildHq }),
  S({ id: "hqr", name: "Căn cứ Đỏ (bến phà Volga)", kind: "armory", ground: "concrete", x: 228, z: 0, rx: 30, rz: 26, rot: Math.PI, build: buildHq }),
  S({ id: "a", name: "Đồi Mamayev Kurgan", x: KURGAN.x, z: KURGAN.z, rx: 18, rz: 16, rot: 0, flag: { u: 0, v: 0, r: 15, letter: "A" }, fort: "ring", build: buildKurgan }),
  S({ id: "b", name: "Nhà máy Tháng Mười Đỏ", kind: "city", ground: "concrete", x: 160, z: 205, rx: 40, rz: 30, rot: 0, flag: { u: 0, v: -18, r: 15, letter: "B" }, fort: "pole", build: buildFactory }),
  S({ id: "c", name: "Ga Stalingrad-1", kind: "city", ground: "asphalt", x: RAIL_X + 22, z: 10, rx: 22, rz: 26, rot: 0, flag: { u: 2, v: -14, r: 15, letter: "C" }, fort: "pole", build: buildStation }),
  S({ id: "d", name: "Nhà Pavlov", kind: "city", ground: "asphalt", x: 105, z: 30, rx: 26, rz: 24, rot: 0, flag: { u: 0, v: -14, r: 15, letter: "D" }, fort: "pole", build: buildPavlov }),
  S({ id: "e", name: "Kho thóc khổng lồ", kind: "city", ground: "concrete", x: 70, z: -175, rx: 26, rz: 22, rot: 0, flag: { u: -12, v: -10, r: 15, letter: "E" }, fort: "pole", build: buildElevator }),
  S({ id: "f", name: "Nhà máy Máy kéo", kind: "city", ground: "concrete", x: -165, z: 165, rx: 30, rz: 24, rot: 0.15, flag: { u: 0, v: -12, r: 15, letter: "F" }, fort: "pole", build: buildTractor }),
  S({ id: "g", name: "Sân bay Gumrak", kind: "armory", ground: "concrete", x: -165, z: -160, rx: 26, rz: 22, rot: -0.2, flag: { u: 0, v: 0, r: 15, letter: "G" }, build: buildGumrak }),
];

const TRENCHES: Trench[] = [
  // Vòng hào trên đỉnh và sườn Mamayev Kurgan.
  { pts: ringPts(KURGAN.x, KURGAN.z, 26, 14, 2) },
  { pts: ringPts(KURGAN.x, KURGAN.z, 46, 20, 2.5), depth: 1.4 },
  // Tuyến hào thảo nguyên của phe Xanh, tuyến hào bờ sông của phe Đỏ.
  { pts: zigzag([-205, -250], [-205, -40], 3, 8) },
  { pts: zigzag([-205, 40], [-205, 250], 3, 8) },
  { pts: zigzag([205, -250], [205, -40], 3, 8) },
  { pts: zigzag([205, 40], [205, 250], 3, 8) },
  // Hào quanh Nhà Pavlov.
  { pts: zigzag([75, 4], [75, 56], 2, 6) },
  { pts: zigzag([136, 4], [136, 56], 2, 6) },
];
const TF = new TrenchField(TRENCHES);

function ringPts(cx: number, cz: number, r: number, n: number, zig: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r + (k % 2 ? zig : -zig);
    pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  pts.push(pts[0]!);
  return pts;
}

/** Ô phố: lưới đường 50 m, mỗi ô vài nhà đổ nát (trừ chỗ có khu, đồi, khe, đường sắt). */
const BLOCKS: readonly { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  for (let x = -110; x <= 220; x += 50)
    for (let z = -280; z <= 280; z += 50) {
      if (Math.abs(x - RAIL_X) < 22) continue;
      if (Math.hypot(x - KURGAN.x, z - KURGAN.z) < KURGAN.r - 6) continue;
      if (polyDist(BALKA, x, z) < 26) continue;
      if (SITES.some((s) => Math.abs(s.x - x) < s.rx + 22 && Math.abs(s.z - z) < s.rz + 22)) continue;
      out.push({ x, z });
    }
  return out;
})();
/** Đường phố (giữa các ô) trải nhựa. */
function onStreet(x: number, z: number): boolean {
  if (x < -135 || x > BANK - 10) return false;
  const mx = (((x + 135) % 50) + 50) % 50;
  const mz = (((z + 305) % 50) + 50) % 50;
  return mx < 4 || mx > 46 || mz < 4 || mz > 46;
}

const CRATERS = new CraterField(
  scatterCraters(makeRand(1942), 140, -240, -300, 250, 300, 1.4, 4, (x, z, r) => BLOCKS.some((b) => Math.abs(b.x - x) < 20 + r && Math.abs(b.z - z) < 20 + r) || SITES.some((s) => Math.abs(s.x - x) < s.rx + 6 && Math.abs(s.z - z) < s.rz + 6) || Math.abs(x - RAIL_X) < 8),
);

function ground(x: number, z: number): number {
  let h = flattenSites(SITES, x, z, raw(x, z), 14);
  h -= balkaCut(x, z);
  // Đường sắt đắp cao 1,2 m.
  if (Math.abs(x - RAIL_X) < 9) h += 1.2 * (1 - smooth(4, 9, Math.abs(x - RAIL_X)));
  return h;
}

function height(x: number, z: number): number {
  return ground(x, z) - TF.cut(x, z) + CRATERS.offset(x, z);
}

// ---------------------------------------------------------------------------- công trình

/** Đỉnh Mamayev Kurgan: tháp nước đổ, ụ súng cối, hầm trú ẩn. */
function buildKurgan(b: Builder) {
  ruin(b, () => tower(b, -8, 6, 0, { floors: 3, w: 5, d: 5, mat: "brick", tint: "#9a5a46", tier: 2 }), 0.55);
  pillbox(b, 10, 0, -6, Math.PI / 2, false, "#9a978c");
  pillbox(b, -10, 0, -8, -Math.PI / 2, false, "#9a978c");
  heavyLoot(b, 4, 0.05, 8);
}

/** Nhà máy Tháng Mười Đỏ: hai xưởng lớn mái sập, ống khói gạch cao, cầu trục, đống thép phế liệu. */
function buildFactory(b: Builder) {
  const brick = "#8a4a3a";
  ruin(b, () => tower(b, -18, 8, 0, { floors: 2, w: 30, d: 20, mat: "brick", tint: brick, tier: 2 }), 0.5);
  ruin(b, () => tower(b, 20, 10, 0, { floors: 2, w: 22, d: 18, mat: "concrete", tint: "#8c8981", tier: 2 }), 0.45);
  for (const u of [-30, 34]) b.add(u, 15, -6, 3, 30, 3, "brick", { tint: "#7d4434" });
  b.add(0, 9, -22, 50, 0.8, 1.2, "metal", { tint: "#5a5650" });
  for (let k = 0; k < 6; k++) b.add(-24 + k * 9, 0.6, -18, 3, 1.2, 1.6, "rust", { rot: k * 0.7 });
  heavyLoot(b, 0, 0.05, 2);
  ammoCrates(b, 32, -16, 0);
}

/** Ga Stalingrad-1: nhà ga hai tầng có cột, sân ga, đường ray, toa tàu trật bánh. */
function buildStation(b: Builder) {
  ruin(b, () => tower(b, 6, 6, Math.PI / 2, { floors: 2, w: 24, d: 12, mat: "plaster", tint: "#c9b998", tier: 2 }), 0.65);
  // Sân ga dọc đường ray (phía tây khu).
  b.add(-14, 0.4, 0, 4, 0.8, 46, "concrete", { tint: "#a39f95" });
  // Toa chở hàng trật bánh.
  for (const [v, rot] of [
    [-12, 0.15],
    [10, -0.25],
  ] as const) {
    const w = b.local(-22, v, rot);
    w(0, 1.6, 0, 2.8, 2.6, 10, "wood", { tint: "#6b3f2c" });
    w(0, 0.4, 0, 2.4, 0.8, 9, "metal", { tint: "#2f2f2c" });
  }
  heavyLoot(b, 8, 0.05, -4);
}

/** Nhà Pavlov: nhà bốn tầng hình chữ L, bao cát bịt cửa sổ tầng trệt, ổ súng máy tầng thượng, quảng trường 9/1. */
function buildPavlov(b: Builder) {
  tower(b, 0, 10, Math.PI, { floors: 4, w: 24, d: 11, mat: "plaster", tint: "#cdbfa7", tier: 2 });
  tower(b, 13, -2, Math.PI / 2, { floors: 4, w: 13, d: 9, mat: "plaster", tint: "#c7b89f", tier: 2 });
  for (let k = 0; k < 6; k++) b.add(-12 + k * 4.6, 0.55, 3.7, 4, 1.1, 0.9, "sandbag");
  // Nhà đổ đối diện bên kia quảng trường.
  ruin(b, () => tower(b, -14, -16, 0, { floors: 3, w: 12, d: 9, mat: "brick", tint: "#94523f", tier: 1 }), 0.4);
  heavyLoot(b, -6, 0.05, 6);
}

/** Kho thóc: khối bê tông cao 30 m (tháp nâng), dãy xi lô tròn, băng chuyền, toa tàu. */
function buildElevator(b: Builder) {
  const grey = "#b4b0a4";
  tower(b, 8, 6, 0, { floors: 9, w: 12, d: 10, mat: "concrete", tint: grey, tier: 2 });
  for (let k = 0; k < 4; k++) {
    const u = -16 + k * 6;
    b.add(u, 9, 8, 5.4, 18, 5.4, "concrete", { tint: "#aaa69b" });
    b.add(u, 9, 8, 5.4, 18, 5.4, "concrete", { tint: "#aaa69b", rot: Math.PI / 4 });
  }
  b.add(-6, 14, -2, 28, 0.8, 1.4, "metal", { tint: "#6c6a62" });
  const cy = b.local(-12, -14, 0);
  container(cy, 0, 0, 0, b.rand);
  heavyLoot(b, 8, 0.05, -6);
}

/** Nhà máy máy kéo: xưởng lắp ráp mái răng cưa, xe tăng T-34 dở dang, cần trục. */
function buildTractor(b: Builder) {
  ruin(b, () => tower(b, 4, 6, 0, { floors: 2, w: 34, d: 18, mat: "brick", tint: "#8f5040", tier: 2 }), 0.55);
  for (const [u, v] of [
    [-18, -14],
    [16, -16],
  ] as const) {
    const t = b.local(u, v, 0.4);
    t(0, 0.75, 0, 3, 1.3, 5.6, "metal", { tint: "#4a5432" });
    t(0, 1.8, -0.4, 2, 0.8, 2.2, "metal", { tint: "#525c38" });
  }
  b.add(-26, 12, 2, 2.6, 24, 2.6, "brick", { tint: "#7d4434" });
  heavyLoot(b, 6, 0.05, -2);
}

/** Sân bay Gumrak trên thảo nguyên: nhà chỉ huy gỗ, ụ đất che máy bay, máy bay vận tải bỏ lại. */
function buildGumrak(b: Builder) {
  const p = b.local(4, 8, 0.4);
  p(0, 1.4, 0, 2.6, 2.4, 17, "metal", { tint: "#7a7d72" });
  p(0, 1.6, 1.5, 24, 0.35, 3, "metal", { tint: "#6f7268" });
  p(0, 3, -7.6, 0.3, 2.8, 2.4, "metal", { tint: "#6f7268" });
  tower(b, -14, -10, 0, { floors: 1, w: 10, d: 7, pitched: true, mat: "wood", tier: 1 });
  for (const side of [-1, 1]) b.add(side * 16, 0.9, 6, 0.9, 1.8, 12, "sandbag");
  woodTower(b, 16, -12, 6, 2);
}

// ---------------------------------------------------------------------------- thành phố, đường sắt, hào

function extra(b: Builder) {
  const rand = makeRand(1943);
  // Nhà đổ nát trong các ô phố.
  for (const blk of BLOCKS) {
    // Ô trống: chỉ còn đống gạch vụn (nhà đã sập hẳn).
    if (rand() < 0.3) {
      for (let k = 0; k < 5; k++) {
        const x = blk.x + (rand() - 0.5) * 30;
        const z = blk.z + (rand() - 0.5) * 30;
        b.add(x, ground(x, z) + 0.45, z, 2.5 + rand() * 3, 0.9 + rand() * 0.8, 2 + rand() * 3, "brick", { tint: "#8a6a58", rot: rand() * 3 });
      }
      continue;
    }
    const n = rand() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = blk.x + (k ? 10 : -10) + (rand() - 0.5) * 4;
      const z = blk.z + (rand() - 0.5) * 18;
      const site = { id: "blk", name: "", kind: "city" as const, x, z, rx: 8, rz: 8, rot: (Math.floor(rand() * 4) * Math.PI) / 2, h: ground(x, z), ground: "asphalt" as const };
      const sb = new Builder(site, b.rand);
      ruin(sb, () => tower(sb, 0, 0, 0, { floors: 2 + Math.floor(rand() * 2), w: 11 + Math.floor(rand() * 4), d: 9 + Math.floor(rand() * 3), mat: rand() < 0.5 ? "brick" : "plaster", tier: 1 }), 0.4 + rand() * 0.25);
      adopt(b, sb);
    }
  }
  // Đường ray trên nền đắp: hai thanh ray, tà vẹt (không chắn), vài toa tàu trật bánh.
  for (let z = -296; z < 296; z += 8) {
    const g = ground(RAIL_X, z);
    for (const s of [-0.75, 0.75]) b.add(RAIL_X + s, g + 0.1, z, 0.12, 0.12, 8, "metal", { tint: "#55524c", solid: false });
  }
  for (const z of [-220, -60, 120, 250]) {
    const g = ground(RAIL_X, z);
    b.add(RAIL_X + 1, g + 1.6, z, 2.8, 2.6, 11, "wood", { tint: "#6b3f2c", rot: 0.12 });
  }
  // Cầu đường sắt qua khe núi.
  const bz = -110;
  b.add(RAIL_X, ground(RAIL_X, bz - 20) - 0.3, bz, 7, 0.6, 32, "concrete", { tint: "#8c897f" });
  markDeck(b);
  for (const t of TRENCHES) lineTrench(b, t, ground, { mat: "sandbag", sides: [1] });
  // Dây thép gai trước tuyến hào thảo nguyên và bờ sông.
  for (const x of [-185, 185])
    for (let z = -240; z < 240; z += 30) {
      if (Math.abs(z) < 40) continue;
      wireLine(b, [x, z], [x, z + 22], ground);
    }
}

function trees(rand: () => number, world: World) {
  const ok = (x: number, z: number) => inland(x, z) > 8 && !TF.inside(x, z) && Math.abs(x - RAIL_X) > 12 && !onStreet(x, z) && !BLOCKS.some((b) => Math.abs(b.x - x) < 18 && Math.abs(b.z - z) < 18);
  // Hàng cây trụi lá dọc phố, rừng bạch dương ven thảo nguyên.
  const city = groveTrees(rand, world, { n: 160, groves: 40, spread: 30, x0: -130, z0: -300, x1: 250, z1: 300, kind: "broadleaf", height: [6, 9], lean: [0.6, 0.85], gap: 5, ok });
  const steppe = groveTrees(rand, world, { n: 260, groves: 18, spread: 50, x0: -320, z0: -320, x1: -140, z1: 320, kind: "broadleaf", height: [7, 11], lean: [0.75, 1.05], gap: 4.5, ok, idFrom: city.length });
  return [...city, ...steppe];
}

export const STALINGRAD: WarMapDef = {
  id: "stalingrad",
  half: HALF,
  extent: 300,
  biome: "snow",
  layoutSeed: 19420823,
  sites: SITES,
  height,
  inland,
  ground: (x, z) => (onStreet(x, z) ? "asphalt" : TF.inside(x, z) || balkaCut(x, z) > 1 ? "dirt" : Math.abs(x - RAIL_X) < 4 ? "stone" : undefined),
  extra,
  trees,
  grass: (rand, world) => grassPatches(rand, world, 50, -320, -300, -140, 300, (x, z) => !TF.inside(x, z)),
  region: (x, z) => {
    if (inland(x, z) < -2) return "Sông Volga";
    if (inland(x, z) < 16) return "Bờ sông Volga";
    if (TF.inside(x, z)) return "Chiến hào";
    if (balkaCut(x, z) > 1.5) return "Khe núi Tsaritsa";
    if (Math.hypot(x - KURGAN.x, z - KURGAN.z) < KURGAN.r) return "Sườn đồi Mamayev";
    if (Math.abs(x - RAIL_X) < 8) return "Đường sắt";
    if (x < -135) return "Thảo nguyên";
    return "Thành phố đổ nát";
  },
  harbors: [
    { x: 300, z: 140 },
    { x: 300, z: -140 },
  ],
  emplacements: [
    { kind: "mortar", x: -25, z: 160, rotY: 0 },
    { kind: "mortar", x: 210, z: 70, rotY: -Math.PI / 2 },
    { kind: "mortar", x: 210, z: -70, rotY: -Math.PI / 2 },
    { kind: "mortar", x: -215, z: 70, rotY: Math.PI / 2 },
    { kind: "mortar", x: -215, z: -70, rotY: Math.PI / 2 },
    { kind: "hmg_nest", x: 90, z: 4, rotY: -Math.PI / 2 },
    { kind: "hmg_nest", x: 0, z: 150, rotY: Math.PI / 2 },
    { kind: "hmg_nest", x: 60, z: -150, rotY: Math.PI / 2 },
  ],
};
