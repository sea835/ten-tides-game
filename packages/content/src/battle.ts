import type { ZoneId } from "@tentides/rules";
import type { GrassPatch } from "./island.ts";
import { makeRand, subSeed, type Surface, type Tree, type World } from "./worldgen.ts";

// Bản đồ Battleground: một hòn đảo lớn khác hẳn đảo cốt truyện, có núi, đồi, rừng, bãi biển, và các khu cho đấu súng:
// thành phố nhà cao tầng, cảng biển lớn (cầu tàu, container, cần cẩu, nhà kho, tàu hàng), pháo đài trên đồi,
// bãi mìn, kho vũ khí quân sự và các làng nhỏ. Mọi công trình là các khối hộp (có thể nghiêng làm dốc cầu thang),
// dùng chung cho client (vẽ, va chạm) và server (đạn bị tường chặn, chỗ xuất phát, chỗ rơi đồ).
// Bố cục cố định để người chơi quen bản đồ; seed chỉ đổi cây cối, đồ rơi và chỗ gài mìn.

export type BoxMat =
  | "concrete"
  | "plaster"
  | "brick"
  | "metal"
  | "container"
  | "wood"
  | "stone"
  | "sandbag"
  | "road"
  | "hull"
  | "rust"
  | "sign"
  | "fence"
  | "roof";

/** Khối hộp: tâm (x, y, z), kích thước đủ (w theo trục u, h đứng, d theo trục v), quay quanh trục đứng `rot`, nghiêng `pitch`. */
export interface BattleBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rot: number;
  /** Nghiêng quanh trục ngang của khối (dốc cầu thang), thứ tự quay YXZ như three.js. */
  pitch: number;
  mat: BoxMat;
  tint?: string;
  /** Có va chạm và chặn đạn không (đường kẻ, biển báo mỏng thì không). */
  solid: boolean;
  /** Thuộc toà nhà nào (số thứ tự trong bản đồ), để sập cả nhà khi tường đổ quá nhiều. */
  building?: number;
  /** Vai trò trong toà nhà: móng, tường, sàn (kể cả cầu thang), mái, đồ đạc. */
  part?: BoxPart;
}

export type BoxPart = "base" | "wall" | "floor" | "roof" | "prop";

export type SiteKind = "city" | "port" | "fortress" | "minefield" | "armory" | "village";

export interface BattleSite {
  id: string;
  name: string;
  kind: SiteKind;
  x: number;
  z: number;
  /** Nửa kích thước khu (theo trục u, v của khu). */
  rx: number;
  rz: number;
  rot: number;
  /** Độ cao mặt nền (địa hình được san phẳng về đây). */
  h: number;
  ground: NonNullable<Surface["ground"]>;
}

/** Cứ điểm (chiến trường): chữ cái, tên, tâm cột cờ, bán kính vùng chiếm. */
export interface FlagSpot {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  r: number;
}

/** Chỗ rơi đồ: cấp 1 thường, 2 khá, 3 hiếm (kho vũ khí). */
export interface LootSpot {
  x: number;
  y: number;
  z: number;
  tier: 1 | 2 | 3;
}

export interface BattleMap {
  /** Đảo sinh tồn (mặc định) hay chiến trường 50 vs 50 (war.ts). */
  layout?: "island" | "war";
  /** Nửa cạnh vùng bản đồ (m); mặc định MAP_HALF_SIZE. */
  half?: number;
  /** Cứ điểm để chiếm (chiến trường). */
  flags?: readonly FlagSpot[];
  world: World;
  sites: readonly BattleSite[];
  boxes: readonly BattleBox[];
  loot: readonly LootSpot[];
  /** Mìn chôn sẵn trong bãi mìn (server giữ bí mật, client không vẽ). */
  mines: readonly { x: number; z: number }[];
  index: BoxIndex;
  /** Cây đã đổ (1) theo thứ tự `world.trees`: đạn, tầm nhìn đi qua chỗ đó. */
  treeDead?: Uint8Array;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Bán kính bờ đảo theo hướng. */
function shoreR(x: number, z: number): number {
  const a = Math.atan2(z, x);
  return 186 + 9 * Math.sin(3 * a + 0.4) + 6 * Math.sin(5 * a + 1.3) + 3 * Math.sin(9 * a + 2.1);
}

export const BATTLE_SITES: readonly BattleSite[] = [
  { id: "city", name: "Thành phố Tân Cảng", kind: "city", x: 35, z: 30, rx: 50, rz: 42, rot: 0, h: 3.5, ground: "asphalt" },
  { id: "port", name: "Cảng biển", kind: "port", x: 158, z: -20, rx: 30, rz: 60, rot: 0, h: 2.2, ground: "concrete" },
  { id: "fortress", name: "Pháo đài Đá", kind: "fortress", x: -110, z: -95, rx: 27, rz: 27, rot: 0.2, h: 14, ground: "stone" },
  { id: "minefield", name: "Bãi mìn", kind: "minefield", x: -105, z: 70, rx: 32, rz: 22, rot: 0.3, h: 2.5, ground: "dirt" },
  { id: "armory", name: "Kho vũ khí", kind: "armory", x: 30, z: -130, rx: 28, rz: 20, rot: -0.15, h: 5, ground: "concrete" },
  { id: "v1", name: "Làng Bến Dừa", kind: "village", x: -40, z: 138, rx: 16, rz: 12, rot: 0.4, h: 2.6, ground: "dirt" },
  { id: "v2", name: "Làng Gió Tây", kind: "village", x: -150, z: -5, rx: 14, rz: 14, rot: -0.3, h: 3, ground: "dirt" },
  { id: "v3", name: "Trạm Hải Đăng", kind: "village", x: 110, z: 108, rx: 14, rz: 12, rot: 0.8, h: 3, ground: "dirt" },
  { id: "v4", name: "Trại Gỗ", kind: "village", x: 95, z: -75, rx: 14, rz: 12, rot: 0.1, h: 3.5, ground: "dirt" },
  { id: "v5", name: "Làng Đá Đen", kind: "village", x: -55, z: -145, rx: 14, rz: 12, rot: -0.6, h: 3, ground: "dirt" },
];

const PORT_QUAY_X = 188;
const MOUNTAIN = { x: -25, z: -40, r: 64, h: 24 };
const FORT_HILL = { x: -110, z: -95, r: 48, h: 12 };

/** Toạ độ riêng (u, v) của khu → thế giới. */
export function toWorld(site: Pick<BattleSite, "x" | "z" | "rot">, u: number, v: number): { x: number; z: number } {
  const c = Math.cos(site.rot);
  const s = Math.sin(site.rot);
  return { x: site.x + u * c + v * s, z: site.z - u * s + v * c };
}
function toLocal(site: Pick<BattleSite, "x" | "z" | "rot">, x: number, z: number): { u: number; v: number } {
  const dx = x - site.x;
  const dz = z - site.z;
  const c = Math.cos(site.rot);
  const s = Math.sin(site.rot);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}
/** Khoảng cách ra ngoài hình chữ nhật của khu (0 là ở trong). */
export function outside(site: BattleSite, x: number, z: number, grow = 0): number {
  const { u, v } = toLocal(site, x, z);
  const du = Math.max(0, Math.abs(u) - site.rx - grow);
  const dv = Math.max(0, Math.abs(v) - site.rz - grow);
  return Math.hypot(du, dv);
}

function rawHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const inland = shoreR(x, z) - r;
  let h: number;
  if (inland < 0) {
    const off = -inland;
    h = -5 * smoothstep(0, 18, off) - 10 * smoothstep(20, 90, off);
    h += 0.7 * Math.sin(x * 0.05 + Math.cos(z * 0.03)) * Math.cos(z * 0.045) * smoothstep(20, 45, off);
  } else {
    h = 1.3 * smoothstep(0, 14, inland) + 2.4 * smoothstep(14, 60, inland);
    h += (3.2 * Math.sin(x * 0.043 + 1.1) * Math.cos(z * 0.051) + 1.8 * Math.sin((x + z) * 0.087) + 1.1 * Math.cos(x * 0.13 - z * 0.07)) * smoothstep(20, 70, inland);
    // Núi giữa đảo (dài theo hướng đông tây) và đồi pháo đài.
    const dm = Math.hypot((x - MOUNTAIN.x) / 1.35, z - MOUNTAIN.z);
    h += MOUNTAIN.h * smoothstep(MOUNTAIN.r, 0, dm) * (0.85 + 0.15 * Math.sin(x * 0.2 + z * 0.13));
    const df = Math.hypot(x - FORT_HILL.x, z - FORT_HILL.z);
    h += FORT_HILL.h * smoothstep(FORT_HILL.r, 18, df);
  }
  return h;
}

function siteHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const site of BATTLE_SITES) {
    const out = outside(site, x, z);
    if (out > 16) continue;
    h = lerp(h, site.h, 1 - smoothstep(0, 16, out));
  }
  // Cảng: bờ kè thẳng đứng, ra khỏi bờ kè là nước sâu.
  const port = BATTLE_SITES[1]!;
  if (z > port.z - port.rz - 4 && z < port.z + port.rz + 4 && x > PORT_QUAY_X) {
    const edge = x - PORT_QUAY_X;
    h = Math.min(h, lerp(port.h, -9, smoothstep(0, 1.2, edge)));
  }
  return h;
}

// ---------------------------------------------------------------------------- dựng công trình

type Rand = ReturnType<typeof makeRand>;

/** Bộ dựng công trình theo toạ độ riêng của một khu (dùng chung cho đảo sinh tồn và chiến trường). */
export class Builder {
  boxes: BattleBox[] = [];
  loot: LootSpot[] = [];
  /** Toà nhà đang dựng (−1: không thuộc toà nào) và số toà đã dựng, xem `tower`. */
  group = -1;
  groups = 0;
  constructor(
    readonly site: BattleSite,
    readonly rand: Rand,
  ) {}

  /** Thêm khối theo toạ độ riêng của khu (y tính từ mặt nền của khu). */
  add(u: number, y: number, v: number, w: number, h: number, d: number, mat: BoxMat, opts: { rot?: number; pitch?: number; tint?: string; solid?: boolean; part?: BoxPart } = {}) {
    if (w <= 0.01 || h <= 0.01 || d <= 0.01) return;
    const p = toWorld(this.site, u, v);
    const box: BattleBox = { x: p.x, y: this.site.h + y, z: p.z, w, h, d, rot: this.site.rot + (opts.rot ?? 0), pitch: opts.pitch ?? 0, mat, tint: opts.tint, solid: opts.solid ?? true };
    if (this.group >= 0) box.building = this.group;
    if (opts.part) box.part = opts.part;
    this.boxes.push(box);
  }

  /** Đánh số toà nhà theo thứ tự trong cả bản đồ (gọi khi gom khối của các khu lại). Trả về số kế tiếp. */
  numberBuildings(base: number): number {
    for (const b of this.boxes) if (b.building !== undefined) b.building += base;
    return base + this.groups;
  }

  /** Như `add` nhưng trong khung riêng của một toà nhà (gốc u0, v0, quay thêm rot). */
  local(u0: number, v0: number, rot: number) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return (u: number, y: number, v: number, w: number, h: number, d: number, mat: BoxMat, opts: { pitch?: number; tint?: string; solid?: boolean; part?: BoxPart } = {}) =>
      this.add(u0 + u * c + v * s, y, v0 - u * s + v * c, w, h, d, mat, { ...opts, rot });
  }

  lootAt(u: number, y: number, v: number, tier: 1 | 2 | 3) {
    const p = toWorld(this.site, u, v);
    this.loot.push({ x: p.x, y: this.site.h + y, z: p.z, tier });
  }

  lootLocal(u0: number, v0: number, rot: number, u: number, y: number, v: number, tier: 1 | 2 | 3) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.lootAt(u0 + u * c + v * s, y, v0 - u * s + v * c, tier);
  }
}

const FLOOR_H = 3.2;
const WALL_T = 0.25;
const SLAB_T = 0.25;
const RUN = 5.2;
const PLASTER = ["#d8d2c4", "#c9b79c", "#b8c4c9", "#d9c3a5", "#a9b3a0", "#cfc7bb", "#bfa89a", "#9fb0bf"];

export interface TowerOpts {
  floors: number;
  w: number;
  d: number;
  mat?: BoxMat;
  tint?: string;
  tier?: 1 | 2 | 3;
  /** Có mái dốc (nhà làng) thay cho sân thượng có lan can. */
  pitched?: boolean;
}

/**
 * Toà nhà nhiều tầng: sàn bê tông, tường có ô cửa sổ trống (bắn qua được), cửa ra vào ở tầng trệt, cầu thang
 * gấp khúc hai vế dọc tường trái lên tới sân thượng, vài vách ngăn và thùng gỗ làm chỗ nấp.
 */
export function tower(b: Builder, u0: number, v0: number, rot: number, o: TowerOpts) {
  // Mọi khối của toà này mang cùng số toà (để sập cả nhà khi tường đổ quá nhiều).
  b.group = b.groups++;
  try {
    towerBody(b, u0, v0, rot, o);
  } finally {
    b.group = -1;
  }
}

function towerBody(b: Builder, u0: number, v0: number, rot: number, o: TowerOpts) {
  const add = b.local(u0, v0, rot);
  const { floors, w: W, d: D } = o;
  const mat = o.mat ?? "plaster";
  // Tường gạch giữ màu gạch của ảnh; tường vữa mỗi nhà một màu sơn.
  const tint = o.tint ?? (mat === "brick" ? "#ffffff" : mat === "stone" ? "#a39d92" : mat === "wood" ? "#9a7a52" : PLASTER[Math.floor(b.rand() * PLASTER.length)]!);
  const hw = FLOOR_H - SLAB_T;
  // Hai vế cầu thang sát tường trái, đi dọc chiều sâu.
  const sA = -W / 2 + WALL_T + 0.75;
  const sB = sA + 1.5;
  const z0 = -D / 2 + WALL_T + 1.3;
  const z1 = z0 + RUN;
  const stairEnd = sB + 0.75;
  const slope = Math.atan2(FLOOR_H, RUN);
  const rampLen = Math.hypot(FLOOR_H, RUN);

  // Móng: khối bê tông chìm xuống đất cho khỏi hở chân trên nền dốc.
  add(0, -0.7, 0, W + 0.4, 1.5, D + 0.4, "concrete", { part: "base" });

  for (let f = 0; f <= floors; f++) {
    const y = f * FLOOR_H + 0.05;
    if (f > 0) {
      // Sàn tầng f, chừa lỗ cầu thang cho vế đi lên tới tầng này.
      const holeU = (f - 1) % 2 === 0 ? sA : sB;
      const hu0 = holeU - 0.75;
      const hu1 = holeU + 0.75;
      const cy = y - SLAB_T / 2;
      add((-W / 2 + hu0) / 2, cy, 0, hu0 + W / 2, SLAB_T, D, "concrete", { part: "floor" });
      add((hu1 + W / 2) / 2, cy, 0, W / 2 - hu1, SLAB_T, D, "concrete", { part: "floor" });
      add(holeU, cy, (-D / 2 + z0) / 2, 1.5, SLAB_T, z0 + D / 2, "concrete", { part: "floor" });
      add(holeU, cy, (z1 + D / 2) / 2, 1.5, SLAB_T, D / 2 - z1, "concrete", { part: "floor" });
    }
    if (f === floors) {
      if (o.pitched) {
        // Mái ngói dốc hai phía (không leo lên được: che lỗ cầu thang luôn).
        const rise = 1.6;
        const half = D / 2 + 0.4;
        const ang = Math.atan2(rise, half);
        const len = Math.hypot(rise, half);
        // Nghiêng dương là hạ đầu +v xuống: tấm phía −v phải ngóc đầu +v lên nóc (nghiêng âm), tấm phía +v ngược lại.
        add(0, y + rise / 2, -half / 2, W + 0.6, 0.18, len, "roof", { pitch: -ang, part: "roof" });
        add(0, y + rise / 2, half / 2, W + 0.6, 0.18, len, "roof", { pitch: ang, part: "roof" });
        add(0, y - SLAB_T / 2, 0, W, SLAB_T, D, "concrete", { part: "floor" });
      } else {
        // Sân thượng: lan can bao quanh.
        add(0, y + 0.55, -D / 2 + WALL_T / 2, W, 1.1, WALL_T, mat, { tint, part: "wall" });
        add(0, y + 0.55, D / 2 - WALL_T / 2, W, 1.1, WALL_T, mat, { tint, part: "wall" });
        add(-W / 2 + WALL_T / 2, y + 0.55, 0, WALL_T, 1.1, D - 2 * WALL_T, mat, { tint, part: "wall" });
        add(W / 2 - WALL_T / 2, y + 0.55, 0, WALL_T, 1.1, D - 2 * WALL_T, mat, { tint, part: "wall" });
        if (o.tier) b.lootLocal(u0, v0, rot, W / 4, y, D / 4, o.tier);
      }
      break;
    }
    // Tường bốn phía, chia ô: góc đặc, xen kẽ cửa sổ.
    const wallY = y + hw / 2;
    const sides: { along: "u" | "v"; at: number; len: number; front: boolean }[] = [
      { along: "u", at: -D / 2 + WALL_T / 2, len: W, front: true },
      { along: "u", at: D / 2 - WALL_T / 2, len: W, front: false },
      { along: "v", at: -W / 2 + WALL_T / 2, len: D - 2 * WALL_T, front: false },
      { along: "v", at: W / 2 - WALL_T / 2, len: D - 2 * WALL_T, front: false },
    ];
    for (const side of sides) {
      const n = Math.max(3, Math.round(side.len / 2.4)) | 1;
      const pw = side.len / n;
      for (let i = 0; i < n; i++) {
        const c = -side.len / 2 + (i + 0.5) * pw;
        const door = f === 0 && side.front && i === (n - 1) / 2;
        const window = !door && i % 2 === 1 && !(side.along === "v" && side.at < 0 && c > z0 - D / 2 && c < z1);
        const piece = (py: number, ph: number) =>
          side.along === "u" ? add(c, py, side.at, pw + 0.01, ph, WALL_T, mat, { tint, part: "wall" }) : add(side.at, py, c, WALL_T, ph, pw + 0.01, mat, { tint, part: "wall" });
        if (door) piece(y + 2.45 + (hw - 2.4) / 2, hw - 2.4);
        else if (window) {
          piece(y + 0.5, 1.0);
          piece(y + 2.15 + (hw - 2.1) / 2, hw - 2.1);
        } else piece(wallY, hw);
      }
    }
    // Vế cầu thang từ tầng f lên f + 1 (vế chẵn đi về phía sau, vế lẻ quay lại).
    const upBack = f % 2 === 0;
    add(upBack ? sA : sB, y + FLOOR_H / 2 - 0.12, (z0 + z1) / 2, 1.45, 0.2, rampLen, "concrete", { pitch: upBack ? -slope : slope, part: "floor" });
    // Vách ngăn có cửa, thùng gỗ làm chỗ nấp, chỗ rơi đồ.
    if (W >= 11) {
      const px = stairEnd + (W / 2 - stairEnd) * (0.35 + b.rand() * 0.3);
      add(px, wallY, -D / 4 - 0.8, 0.15, hw, D / 2 - 1.8, "plaster", { tint: "#e6e1d6", part: "wall" });
      add(px, wallY, D / 4 + 0.8, 0.15, hw, D / 2 - 1.8, "plaster", { tint: "#e6e1d6", part: "wall" });
    }
    const crates = 1 + Math.floor(b.rand() * 2);
    for (let k = 0; k < crates; k++) {
      const cu = stairEnd + 1 + b.rand() * (W / 2 - stairEnd - 2);
      const cv = -D / 2 + 1.2 + b.rand() * (D - 2.4);
      const s = 0.9 + b.rand() * 0.3;
      add(cu, y + s / 2, cv, s, s, s, "wood", { part: "prop" });
    }
    if (o.tier) {
      const lu = stairEnd + 1 + b.rand() * (W / 2 - stairEnd - 2);
      const lv = -D / 2 + 1 + b.rand() * (D - 2);
      b.lootLocal(u0, v0, rot, lu, y, lv, f >= 3 && o.tier < 3 ? ((o.tier + 1) as 2 | 3) : o.tier);
    }
  }
}

export function buildCity(b: Builder) {
  const s = b.site;
  // Đường nhựa kẻ vạch: hai trục chính.
  for (const v of [-14, 14]) b.add(0, 0.03, v, s.rx * 2, 0.04, 0.3, "road", { solid: false, tint: "#e8e0c0" });
  for (const u of [-17, 17]) b.add(u, 0.03, 0, 0.3, 0.04, s.rz * 2, "road", { solid: false, tint: "#e8e0c0" });
  const lots: [number, number][] = [];
  for (const u of [-34, 0, 34]) for (const v of [-28, 0, 28]) lots.push([u, v]);
  lots.forEach(([u, v], i) => {
    const floors = i === 4 ? 8 : 3 + Math.floor(b.rand() * 4);
    const w = 12 + Math.floor(b.rand() * 3) * 2;
    const d = 11 + Math.floor(b.rand() * 2) * 2;
    tower(b, u + (b.rand() - 0.5) * 3, v + (b.rand() - 0.5) * 2, (Math.floor(b.rand() * 4) * Math.PI) / 2, { floors, w, d, tier: floors >= 6 ? 2 : 1, mat: b.rand() < 0.3 ? "brick" : "plaster" });
  });
  // Xe hỏng, rào chắn bê tông trên phố làm chỗ nấp.
  for (let k = 0; k < 14; k++) {
    const onU = b.rand() < 0.5;
    const along = (b.rand() - 0.5) * (onU ? s.rx : s.rz) * 1.7;
    const lane = (onU ? [-14, 14] : [-17, 17])[Math.floor(b.rand() * 2)]! + (b.rand() - 0.5) * 4;
    const [u, v] = onU ? [along, lane] : [lane, along];
    if (b.rand() < 0.5) {
      const rot = onU ? 0 : Math.PI / 2;
      const car = b.local(u, v, rot + (b.rand() - 0.5) * 0.4);
      const tint = ["#7a2c24", "#2d4a6b", "#d8d8d0", "#3a3a3a", "#6b6b2f"][Math.floor(b.rand() * 5)]!;
      car(0, 0.55, 0, 4.2, 0.9, 1.8, "metal", { tint });
      car(-0.2, 1.3, 0, 2.2, 0.7, 1.6, "metal", { tint });
    } else b.add(u, 0.5, v, onU ? 3 : 0.7, 1, onU ? 0.7 : 3, "concrete", { tint: "#b8b4aa" });
    b.lootAt(u + 1.5, 0.05, v + 1.5, 1);
  }
}

export function container(add: ReturnType<Builder["local"]>, u: number, y: number, v: number, rand: Rand) {
  const tints = ["#b5372c", "#2f5f8f", "#d98e1e", "#3f7a3a", "#7b7b7b", "#8a3f7a", "#1f6f6f"];
  add(u, y + 1.3, v, 6.1, 2.6, 2.44, "container", { tint: tints[Math.floor(rand() * tints.length)] });
}

function buildPort(b: Builder) {
  const s = b.site;
  const quayU = PORT_QUAY_X - s.x; // mép kè theo trục u (khu không quay)
  // Bờ kè bê tông.
  b.add(quayU - 0.6, -4, 0, 1.2, 12.4, s.rz * 2 + 8, "concrete", { tint: "#9a968c" });
  // Hai cầu tàu vươn ra biển, trụ đỡ bên dưới.
  for (const pv of [-44, 26]) {
    const len = 42;
    b.add(quayU + len / 2, -0.25, pv, len, 0.5, 10, "concrete", { tint: "#a8a296" });
    for (let k = 4; k < len; k += 8) for (const side of [-4.2, 4.2]) b.add(quayU + k, -5, pv + side, 0.8, 9.5, 0.8, "concrete", { tint: "#6f6a60" });
    // Cột neo tàu.
    for (let k = 6; k < len; k += 10) b.add(quayU + k, 0.35, pv + 4.4, 0.5, 0.7, 0.5, "metal", { tint: "#2b2b2b" });
  }
  // Tàu hàng neo dọc bờ kè giữa hai cầu tàu: thân tàu, boong, container trên boong, đài chỉ huy nhiều tầng ở đuôi.
  const shipU = quayU + 9.5;
  const shipV = -9;
  const ship = b.local(shipU, shipV, Math.PI / 2);
  ship(0, -3.5, 0, 54, 11, 15, "hull", { tint: "#6e1f1a" });
  ship(0, 2.1, 0, 52, 0.3, 14, "metal", { tint: "#6b6f72" });
  for (const side of [-7.1, 7.1]) ship(0, 2.8, side, 52, 1.1, 0.2, "metal", { tint: "#8a8f92" });
  for (const end of [-26.1, 26.1]) ship(end, 2.8, 0, 0.2, 1.1, 14, "metal", { tint: "#8a8f92" });
  for (let k = 0; k < 5; k++) {
    const cu = -18 + k * 6.6;
    const stack = 1 + Math.floor(b.rand() * 3);
    for (let lv = 0; lv < stack; lv++) for (const cv of [-3, 0, 3]) if (b.rand() < 0.75) container(ship, cu, 2.25 + lv * 2.6, cv, b.rand);
  }
  b.lootLocal(shipU, shipV, Math.PI / 2, 16, 2.25, 4, 2);
  tower(b, shipU, shipV - 20, Math.PI / 2, { floors: 3, w: 10, d: 11, mat: "metal", tint: "#e8e6e0", tier: 2 });
  // Cầu lên tàu: dốc từ bờ kè lên boong.
  const gang = b.local(quayU - 0.6, shipV + 10, Math.PI / 2);
  gang(0, 1.05, 0, 1.6, 0.2, Math.hypot(5, 2.25), "metal", { tint: "#555a5e", pitch: -Math.atan2(2.25, 5) });
  // Bãi container: các dãy chồng 1–3 tầng, có lối đi xen giữa.
  for (let row = 0; row < 6; row++) {
    const v = -50 + row * 9;
    for (let col = 0; col < 4; col++) {
      const u = -22 + col * 7;
      if (b.rand() < 0.2) continue;
      const stack = 1 + Math.floor(b.rand() * 3);
      const add = b.local(u, v, 0);
      for (let lv = 0; lv < stack; lv++) container(add, 0, lv * 2.6, (lv % 2) * 0.1, b.rand);
      if (b.rand() < 0.5) b.lootAt(u + 3.5, 0.05, v + 2, 1);
    }
  }
  // Hai nhà kho lớn: tường tôn, mái tôn, cửa cuốn mở, kệ hàng bên trong.
  for (const [u, v] of [
    [-12, 22],
    [-12, 46],
  ] as const) {
    const add = b.local(u, v, 0);
    const W = 34;
    const D = 18;
    const H = 9;
    add(0, H / 2, -D / 2, W, H, 0.3, "metal", { tint: "#8c9aa3" });
    add(-W / 4 - 3, H / 2, D / 2, W / 2 - 6, H, 0.3, "metal", { tint: "#8c9aa3" });
    add(W / 4 + 3, H / 2, D / 2, W / 2 - 6, H, 0.3, "metal", { tint: "#8c9aa3" });
    add(0, H - 1.5, D / 2, 12, 3, 0.3, "metal", { tint: "#8c9aa3" });
    add(-W / 2, H / 2, 0, 0.3, H, D, "metal", { tint: "#8c9aa3" });
    add(W / 2, H / 2 - 2, 0, 0.3, H - 4, D, "metal", { tint: "#8c9aa3" });
    add(W / 2, H - 1.5, 0, 0.3, 3, D, "metal", { tint: "#8c9aa3" });
    add(0, H + 0.1, 0, W + 0.6, 0.25, D + 0.6, "roof", { tint: "#6c7a80" });
    for (let k = 0; k < 4; k++) {
      add(-12 + k * 8, 1.4, -2, 5, 2.8, 1.2, "wood", { tint: "#8a6a44" });
      b.lootLocal(u, v, 0, -12 + k * 8, 0.05, 2, k % 2 === 0 ? 2 : 1);
    }
  }
  // Hai cần cẩu giàn trên bờ kè, cần vươn ra biển.
  for (const v of [-58, -2]) {
    const add = b.local(quayU - 6, v, 0);
    for (const lu of [-4, 4]) for (const lv of [-5, 5]) add(lu, 13, lv, 1, 26, 1, "metal", { tint: "#e0b21a" });
    add(0, 26.5, 0, 9, 1.4, 11, "metal", { tint: "#e0b21a" });
    add(12, 27.6, 0, 40, 1.2, 1.6, "metal", { tint: "#e0b21a" });
    add(-2, 24, 0, 3, 3, 3, "metal", { tint: "#d8d4c8" });
  }
  // Văn phòng cảng.
  tower(b, 10, 5, 0, { floors: 3, w: 12, d: 10, tier: 1 });
}

export function buildFortress(b: Builder) {
  const S = 22;
  const T = 2.6;
  const H = 7;
  const stone = "#8d877c";
  const add = b.local(0, 0, 0);
  // Bốn bức tường dày, lối đi trên mặt tường, lỗ châu mai phía ngoài; cổng ở phía nam.
  for (const [side, along] of [
    [-1, "u"],
    [1, "u"],
    [-1, "v"],
    [1, "v"],
  ] as const) {
    const at = side * (S - T / 2);
    const gate = side === -1 && along === "u";
    const segs = gate
      ? [
          [-S / 2 - 1.5, S - 3],
          [S / 2 + 1.5, S - 3],
        ]
      : [[0, 2 * S]];
    for (const [c, len] of segs) {
      if (along === "u") add(c!, H / 2, at, len!, H, T, "stone", { tint: stone });
      else add(at, H / 2, c!, T, H, len!, "stone", { tint: stone });
    }
    if (gate) add(0, H - 1.2, at, 6, 2.4, T, "stone", { tint: stone });
    // Răng cưa ở mép ngoài.
    for (let k = -S + 1.5; k < S - 1; k += 2.2) {
      if (gate && Math.abs(k) < 3.5) continue;
      const out = side * (S - 0.3);
      if (along === "u") add(k, H + 0.6, out, 1.1, 1.2, 0.6, "stone", { tint: stone });
      else add(out, H + 0.6, k, 0.6, 1.2, 1.1, "stone", { tint: stone });
    }
  }
  // Tháp góc, đỉnh cao hơn mặt tường nửa mét (bước lên được).
  for (const cu of [-S, S])
    for (const cv of [-S, S]) {
      add(cu, (H + 0.5) / 2, cv, 7, H + 0.5, 7, "stone", { tint: "#7d776c" });
      for (const [du, dv, w, d] of [
        [0, -3.3, 7, 0.5],
        [0, 3.3, 7, 0.5],
        [-3.3, 0, 0.5, 7],
        [3.3, 0, 0.5, 7],
      ] as const)
        add(cu + du, H + 1.1, cv + dv, w, 1.2, d, "stone", { tint: "#7d776c" });
      b.lootAt(cu, H + 0.5, cv, 2);
    }
  // Dốc đá từ sân lên mặt tường (bên trong tường đông và tây).
  const slope = Math.atan2(H, 13);
  add(S - T - 1, H / 2 - 0.15, 0, 2, 0.4, Math.hypot(H, 13), "stone", { tint: stone, pitch: -slope });
  add(-S + T + 1, H / 2 - 0.15, 0, 2, 0.4, Math.hypot(H, 13), "stone", { tint: stone, pitch: slope });
  // Nhà chính hai tầng giữa sân, vài khẩu pháo trên tường.
  tower(b, 0, 4, 0, { floors: 2, w: 14, d: 12, mat: "stone", tint: "#9a9386", tier: 2 });
  for (const k of [-10, 0, 10]) add(k, H + 0.5, S - T / 2, 0.6, 0.6, 2.6, "metal", { tint: "#2a2a2a" });
  // Bao cát trong sân.
  for (let k = 0; k < 6; k++) add(-14 + k * 5.5, 0.45, -10 + (k % 2) * 4, 3, 0.9, 0.8, "sandbag");
  b.lootAt(-12, 0.05, -12, 2);
  b.lootAt(12, 0.05, -12, 1);
}

function buildMinefield(b: Builder) {
  const s = b.site;
  // Hàng rào dây thép gai quanh bãi, chừa vài lối hở; biển cảnh báo.
  const post = (u: number, v: number) => b.add(u, 0.7, v, 0.12, 1.4, 0.12, "wood", { tint: "#5a4630" });
  for (let u = -s.rx; u <= s.rx; u += 4) {
    if (Math.abs(u) > 3) {
      post(u, -s.rz);
      post(u, s.rz);
      b.add(u + 2, 0.9, -s.rz, 4, 0.7, 0.05, "fence", { solid: false });
      b.add(u + 2, 0.9, s.rz, 4, 0.7, 0.05, "fence", { solid: false });
    }
  }
  for (let v = -s.rz; v <= s.rz; v += 4) {
    post(-s.rx, v);
    post(s.rx, v);
    if (Math.abs(v) > 3) {
      b.add(-s.rx, 0.9, v + 2, 0.05, 0.7, 4, "fence", { solid: false });
      b.add(s.rx, 0.9, v + 2, 0.05, 0.7, 4, "fence", { solid: false });
    }
  }
  for (const [u, v] of [
    [-s.rx - 1, -8],
    [s.rx + 1, 8],
    [0, -s.rz - 1],
    [10, s.rz + 1],
    [-20, s.rz + 1],
  ] as const) {
    b.add(u, 0.9, v, 0.1, 1.8, 0.1, "wood", { tint: "#5a4630" });
    b.add(u, 1.6, v, 1.1, 0.7, 0.06, "sign", { solid: false });
  }
  // Xác xe tăng cháy và hố bom giữa bãi: chỗ nấp duy nhất, đồ hiếm ở đó.
  const tank = b.local(4, -2, 0.7);
  tank(0, 0.9, 0, 6.5, 1.6, 3.4, "rust");
  tank(-0.5, 2.1, 0, 3, 0.9, 2.6, "rust");
  tank(2.5, 2.2, 0, 4, 0.3, 0.3, "rust");
  b.lootAt(6, 0.05, 1, 3);
  b.lootAt(-16, 0.05, 6, 2);
}

export function buildArmory(b: Builder, fence = true) {
  const s = b.site;
  // Hàng rào lưới quanh khu, cổng trước (cứ điểm chiến trường thì bỏ rào cho hai phe vào chiếm được từ mọi phía).
  for (let u = -s.rx; u < s.rx && fence; u += 5) {
    if (Math.abs(u + 2.5) > 4) b.add(u + 2.5, 1.2, -s.rz, 5, 2.4, 0.08, "fence", { solid: true });
    b.add(u + 2.5, 1.2, s.rz, 5, 2.4, 0.08, "fence", { solid: true });
  }
  for (let v = -s.rz; v < s.rz && fence; v += 5) {
    b.add(-s.rx, 1.2, v + 2.5, 0.08, 2.4, 5, "fence", { solid: true });
    b.add(s.rx, 1.2, v + 2.5, 0.08, 2.4, 5, "fence", { solid: true });
  }
  // Ba boongke bê tông: tường dày, mái dày, một cửa; hòm vũ khí hiếm bên trong.
  for (const [u, v, rot] of [
    [-15, 5, 0],
    [2, 8, 0],
    [17, 2, Math.PI / 2],
  ] as const) {
    const add = b.local(u, v, rot);
    const W = 11;
    const D = 8;
    const H = 3.6;
    add(0, H / 2, D / 2, W, H, 0.6, "concrete", { tint: "#a8a596" });
    add(-W / 2, H / 2, 0, 0.6, H, D, "concrete", { tint: "#a8a596" });
    add(W / 2, H / 2, 0, 0.6, H, D, "concrete", { tint: "#a8a596" });
    add(-W / 4 - 1, H / 2, -D / 2, W / 2 - 2, H, 0.6, "concrete", { tint: "#a8a596" });
    add(W / 4 + 1, H / 2, -D / 2, W / 2 - 2, H, 0.6, "concrete", { tint: "#a8a596" });
    add(0, H + 0.4, 0, W + 1, 0.8, D + 1, "concrete", { tint: "#96927f" });
    add(0, 0.5, 2.6, 6, 1, 1, "wood", { tint: "#4f5a32" });
    b.lootLocal(u, v, rot, -2, 0.05, 1, 3);
    b.lootLocal(u, v, rot, 2, 0.05, 1, 3);
  }
  // Tháp canh: bốn chân, sàn, lan can, dốc lên.
  const tw = b.local(-18, -12, 0);
  for (const lu of [-1.8, 1.8]) for (const lv of [-1.8, 1.8]) tw(lu, 3, lv, 0.3, 6, 0.3, "wood", { tint: "#6a5238" });
  tw(0, 6.1, 0, 4.4, 0.25, 4.4, "wood", { tint: "#7a6040" });
  for (const [du, dv, w, d] of [
    [0, -2.1, 4.4, 0.15],
    [0, 2.1, 4.4, 0.15],
    [2.1, 0, 0.15, 4.4],
  ] as const)
    tw(du, 6.75, dv, w, 1.1, d, "wood", { tint: "#7a6040" });
  // Dốc lên tháp theo trục u (khung quay 90° để chiều dài dốc nằm dọc trục u).
  const slope = Math.atan2(6.1, 9);
  const ramp = b.local(-18 - 2.2 - 4.5, -12, Math.PI / 2);
  ramp(0, 3.05, 0, 1.2, 0.2, Math.hypot(6.1, 9), "wood", { tint: "#7a6040", pitch: slope });
  b.lootAt(-18, 6.25, -12, 3);
  // Bao cát, thùng đạn ngoài sân.
  for (let k = 0; k < 8; k++) b.add(-20 + k * 5.5, 0.45, -6 + (k % 3) * 3, 2.6, 0.9, 0.8, "sandbag");
  for (let k = 0; k < 4; k++) b.lootAt(-12 + k * 8, 0.05, -9, 2);
}

export function buildVillage(b: Builder) {
  const s = b.site;
  const houses = 2 + Math.floor(b.rand() * 2);
  for (let k = 0; k < houses; k++) {
    const u = (k - (houses - 1) / 2) * (s.rx * 1.6 / houses) + (b.rand() - 0.5) * 2;
    const v = (b.rand() - 0.5) * s.rz * 0.8;
    tower(b, u, v, (Math.floor(b.rand() * 4) * Math.PI) / 2, { floors: 1 + (b.rand() < 0.4 ? 1 : 0), w: 10, d: 10, pitched: true, tier: 1, mat: b.rand() < 0.5 ? "wood" : "plaster" });
  }
  b.lootAt((b.rand() - 0.5) * s.rx, 0.05, (b.rand() - 0.5) * s.rz, 1);
}

// ---------------------------------------------------------------------------- chỉ mục khối (tia đạn, va chạm)

export interface BoxIndex {
  cell: number;
  /** Ô lưới (khoá số, xem `cellKey`) → các khối đặc chạm ô đó. */
  grid: Map<number, number[]>;
  boxes: readonly BattleBox[];
  /** Trục u, trục đứng, trục v của từng khối trong thế giới (9 số mỗi khối), tính sẵn cho khỏi sin/cos mỗi tia. */
  axes: Float64Array;
  /** Đánh dấu khối đã thử trong lần dò hiện tại (so với `stamp`), thay cho tạo Set mới mỗi tia. */
  seen: Uint32Array;
  stamp: number;
  /** Khối đã vỡ / sập (1): mọi tia, mọi phép dò bỏ qua. Mỗi phòng (server) một bản riêng, xem `withDestruction`. */
  dead?: Uint8Array;
}

/** Ma trận quay (YXZ) của khối, dùng để đổi điểm và hướng về toạ độ riêng của khối. */
function basis(b: BattleBox) {
  const cy = Math.cos(b.rot);
  const sy = Math.sin(b.rot);
  const cx = Math.cos(b.pitch);
  const sx = Math.sin(b.pitch);
  // Cột của ma trận R = Ry · Rx: trục u, trục đứng, trục v của khối trong thế giới.
  return {
    ux: [cy, 0, -sy] as const,
    uy: [sy * sx, cx, cy * sx] as const,
    uz: [sy * cx, -sx, cy * cx] as const,
  };
}

function boxRadius(b: BattleBox): number {
  return Math.hypot(b.w, b.h, b.d) / 2;
}

/** Khoá số của ô lưới (gx, gz): nhanh hơn chuỗi "gx,gz" và không tạo rác. Bản đồ chỉ vài chục ô mỗi chiều. */
function cellKey(gx: number, gz: number): number {
  return (gx + 32768) * 65536 + (gz + 32768);
}

export function buildIndex(boxes: readonly BattleBox[], cell = 16): BoxIndex {
  const grid = new Map<number, number[]>();
  const axes = new Float64Array(boxes.length * 9);
  boxes.forEach((b, i) => {
    const { ux, uy, uz } = basis(b);
    axes.set([...ux, ...uy, ...uz], i * 9);
    if (!b.solid) return;
    const r = boxRadius(b);
    for (let gx = Math.floor((b.x - r) / cell); gx <= Math.floor((b.x + r) / cell); gx++)
      for (let gz = Math.floor((b.z - r) / cell); gz <= Math.floor((b.z + r) / cell); gz++) {
        const key = cellKey(gx, gz);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
  });
  return { cell, grid, boxes, axes, seen: new Uint32Array(boxes.length), stamp: 0 };
}

/** Đạn xuyên qua được khối này không: hàng rào lưới thép chỉ chặn người đi, không chặn đạn. */
export function bulletPasses(b: BattleBox): boolean {
  return b.mat === "fence";
}

/**
 * Tia (gốc o, hướng chuẩn hoá d) chạm khối nào gần nhất trong `max` mét: trả khoảng cách hoặc Infinity.
 * `bullet`: tia đạn / tầm nhìn bắn, bỏ qua các khối đạn xuyên được (hàng rào lưới).
 */
export function raycastBoxes(index: BoxIndex, o: readonly [number, number, number], d: readonly [number, number, number], max: number, bullet = false): number {
  return raycastBoxesHit(index, o, d, max, bullet).t;
}

/** Như `raycastBoxes` nhưng cho biết cả khối bị chạm (`i`, −1 nếu không chạm gì). */
export function raycastBoxesHit(index: BoxIndex, o: readonly [number, number, number], d: readonly [number, number, number], max: number, bullet = false, skip = -1): { t: number; i: number } {
  let best = max;
  let bi = -1;
  // Đánh dấu mới cho lần dò này; tràn số thì xoá sạch dấu cũ.
  if (++index.stamp >= 0xffffffff) {
    index.seen.fill(0);
    index.stamp = 1;
  }
  const stamp = index.stamp;
  const seen = index.seen;
  const dead = index.dead;
  const step = index.cell * 0.5;
  for (let t = 0; t <= best + step; t += step) {
    const px = o[0] + d[0] * Math.min(t, best);
    const pz = o[2] + d[2] * Math.min(t, best);
    const list = index.grid.get(cellKey(Math.floor(px / index.cell), Math.floor(pz / index.cell)));
    if (!list) continue;
    for (const i of list) {
      if (seen[i] === stamp) continue;
      seen[i] = stamp;
      if (i === skip || dead?.[i]) continue;
      if (bullet && bulletPasses(index.boxes[i]!)) continue;
      const hit = rayBoxAt(index, i, o, d, best);
      if (hit < best) {
        best = hit;
        bi = i;
      }
    }
  }
  return best < max ? { t: best, i: bi } : { t: Infinity, i: -1 };
}

/** Đoạn tia nằm trong khối `i`: [vào, ra] (Infinity nếu không cắt). Để biết đạn đi xuyên bao nhiêu thịt tường. */
export function boxSpan(index: BoxIndex, i: number, o: readonly [number, number, number], d: readonly [number, number, number]): [number, number] {
  const b = index.boxes[i]!;
  const a = index.axes;
  const k = i * 9;
  const rx = o[0] - b.x;
  const ry = o[1] - b.y;
  const rz = o[2] - b.z;
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const j = k + axis * 3;
    const lo = rx * a[j]! + ry * a[j + 1]! + rz * a[j + 2]!;
    const ld = d[0] * a[j]! + d[1] * a[j + 1]! + d[2] * a[j + 2]!;
    const half = (axis === 0 ? b.w : axis === 1 ? b.h : b.d) / 2;
    if (Math.abs(ld) < 1e-9) {
      if (Math.abs(lo) > half) return [Infinity, Infinity];
      continue;
    }
    let t1 = (-half - lo) / ld;
    let t2 = (half - lo) / ld;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return [Infinity, Infinity];
  }
  return [tmin, tmax];
}

// ---------------------------------------------------------------------------- phá huỷ: tường vỡ, đạn xuyên, nhà sập

/** Đạn xuyên qua được tấm mỏng chừng này mét (vách gỗ, tường vữa, tôn) nếu vật liệu cho phép, xem `penetrable`. */
export const PEN_MAX = 0.45;
/** Sát thương còn lại sau mỗi lần xuyên. */
export const PEN_DAMAGE = 0.6;

/** Vật liệu đạn xuyên qua được khi đủ mỏng: gỗ, vữa, tôn biển báo. Gạch, bê tông, đá, bao cát, thép dày thì không. */
export function penetrable(b: BattleBox): boolean {
  return b.mat === "wood" || b.mat === "plaster" || b.mat === "sign";
}

/**
 * Độ bền của khối (0: không phá được). Tường, vách, lan can, thùng gỗ, bao cát vỡ được; móng, sàn, mái, đường,
 * container, thép, thân tàu thì không (sàn, mái chỉ đổ theo khi cả nhà sập). Tường quá dày (tường thành đá) cũng không.
 */
export function boxDurability(b: BattleBox): number {
  if (!b.solid || b.part === "base" || b.part === "floor" || b.part === "roof") return 0;
  if (b.mat === "road" || b.mat === "roof" || b.mat === "metal" || b.mat === "container" || b.mat === "hull" || b.mat === "rust") return 0;
  const thick = Math.min(b.w, b.h, b.d);
  if (thick > 0.9) return 0;
  // Tấm to thì bền hơn một chút (nhiều vật liệu hơn), tối đa gấp 1,4.
  const size = Math.min(1.4, Math.max(0.6, Math.sqrt(b.w * b.h * b.d / 0.5)));
  const base: Partial<Record<BoxMat, number>> = { wood: 140, plaster: 260, sign: 40, fence: 90, sandbag: 380, brick: 420, concrete: 560, stone: 700 };
  return Math.round((base[b.mat] ?? 0) * size);
}

/** Đạn găm vào vật liệu này mất bao nhiêu sát thương vào khối (so với sát thương vào người). */
export function bulletWallFactor(b: BattleBox): number {
  return b.mat === "wood" || b.mat === "sign" || b.mat === "fence" ? 0.9 : b.mat === "plaster" ? 0.6 : b.mat === "sandbag" ? 0.35 : 0.4;
}

/**
 * Đường đạn thẳng từ o theo d trong `max` mét, có tính xuyên tường mỏng: găm vào khối nào (`t`, `i`), đã xuyên qua
 * những khối nào, ở đâu (`pens`, tối đa `maxPens`), sát thương còn lại (`mult`).
 */
export function bulletThrough(
  index: BoxIndex,
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  max: number,
  maxPens = 1,
): { t: number; i: number; pens: { i: number; t: number }[]; mult: number } {
  const pens: { i: number; t: number }[] = [];
  let from = 0;
  let mult = 1;
  let skip = -1;
  for (;;) {
    const origin: [number, number, number] = [o[0] + d[0] * from, o[1] + d[1] * from, o[2] + d[2] * from];
    const hit = raycastBoxesHit(index, origin, d, max - from, true, skip);
    if (hit.i < 0) return { t: Infinity, i: -1, pens, mult };
    const t = from + hit.t;
    const b = index.boxes[hit.i]!;
    if (pens.length < maxPens && penetrable(b)) {
      const [tin, tout] = boxSpan(index, hit.i, o, d);
      if (tout - Math.max(tin, from) <= PEN_MAX) {
        pens.push({ i: hit.i, t });
        mult *= PEN_DAMAGE;
        from = tout + 0.01;
        skip = hit.i;
        if (from >= max) return { t: Infinity, i: -1, pens, mult };
        continue;
      }
    }
    return { t, i: hit.i, pens, mult };
  }
}

/**
 * Bản đồ riêng cho một phòng: dùng chung hình khối, lưới (chỉ đọc) với bản đồ gốc trong cache, nhưng có mặt nạ
 * khối vỡ, cây đổ riêng, để phá nhà trong trận này không ảnh hưởng phòng khác cùng seed.
 */
export function withDestruction(map: BattleMap): BattleMap {
  const n = map.index.boxes.length;
  return {
    ...map,
    index: { ...map.index, seen: new Uint32Array(n), stamp: 0, dead: new Uint8Array(n) },
    treeDead: new Uint8Array(map.world.trees.length),
  };
}

/** Tia cắt khối thứ `i` của chỉ mục (slab test trong toạ độ riêng của khối, trục tính sẵn). */
function rayBoxAt(index: BoxIndex, i: number, o: readonly [number, number, number], d: readonly [number, number, number], max: number): number {
  const b = index.boxes[i]!;
  const a = index.axes;
  const k = i * 9;
  const rx = o[0] - b.x;
  const ry = o[1] - b.y;
  const rz = o[2] - b.z;
  let tmin = 0;
  let tmax = max;
  for (let axis = 0; axis < 3; axis++) {
    const j = k + axis * 3;
    const lo = rx * a[j]! + ry * a[j + 1]! + rz * a[j + 2]!;
    const ld = d[0] * a[j]! + d[1] * a[j + 1]! + d[2] * a[j + 2]!;
    const half = (axis === 0 ? b.w : axis === 1 ? b.h : b.d) / 2;
    if (Math.abs(ld) < 1e-9) {
      if (Math.abs(lo) > half) return Infinity;
      continue;
    }
    let t1 = (-half - lo) / ld;
    let t2 = (half - lo) / ld;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Điểm (x, y, z) có nằm trong một khối riêng lẻ không (nới thêm `pad`). */
export function pointInBox(b: BattleBox, x: number, y: number, z: number, pad = 0): boolean {
  const cy = Math.cos(b.rot);
  const sy = Math.sin(b.rot);
  const cx = Math.cos(b.pitch);
  const sx = Math.sin(b.pitch);
  const rx = x - b.x;
  const ry = y - b.y;
  const rz = z - b.z;
  return (
    Math.abs(rx * cy - rz * sy) < b.w / 2 + pad &&
    Math.abs(rx * sy * sx + ry * cx + rz * cy * sx) < b.h / 2 + pad &&
    Math.abs(rx * sy * cx - ry * sx + rz * cy * cx) < b.d / 2 + pad
  );
}

/** Khối đặc chứa điểm (x, y, z) (nới thêm `pad`), hoặc null. */
export function boxAt(index: BoxIndex, x: number, y: number, z: number, pad = 0): BattleBox | null {
  const list = index.grid.get(cellKey(Math.floor(x / index.cell), Math.floor(z / index.cell)));
  if (!list) return null;
  const a = index.axes;
  for (const i of list) {
    if (index.dead?.[i]) continue;
    const b = index.boxes[i]!;
    const k = i * 9;
    const rx = x - b.x;
    const ry = y - b.y;
    const rz = z - b.z;
    if (
      Math.abs(rx * a[k]! + ry * a[k + 1]! + rz * a[k + 2]!) < b.w / 2 + pad &&
      Math.abs(rx * a[k + 3]! + ry * a[k + 4]! + rz * a[k + 5]!) < b.h / 2 + pad &&
      Math.abs(rx * a[k + 6]! + ry * a[k + 7]! + rz * a[k + 8]!) < b.d / 2 + pad
    )
      return b;
  }
  return null;
}

/** Các khối đặc có thể chạm hình tròn (x, z, r) trên mặt bằng (theo ô lưới, chưa lọc chính xác). */
export function boxesNear(index: BoxIndex, x: number, z: number, r: number): BattleBox[] {
  const out: BattleBox[] = [];
  if (++index.stamp >= 0xffffffff) {
    index.seen.fill(0);
    index.stamp = 1;
  }
  const stamp = index.stamp;
  for (let gx = Math.floor((x - r) / index.cell); gx <= Math.floor((x + r) / index.cell); gx++)
    for (let gz = Math.floor((z - r) / index.cell); gz <= Math.floor((z + r) / index.cell); gz++) {
      const list = index.grid.get(cellKey(gx, gz));
      if (!list) continue;
      for (const i of list) {
        if (index.seen[i] === stamp) continue;
        index.seen[i] = stamp;
        if (!index.dead?.[i]) out.push(index.boxes[i]!);
      }
    }
  return out;
}

/** Điểm có nằm trong khối đặc nào không (dùng để chọn chỗ xuất phát, chỗ rơi đồ). */
export function insideBox(index: BoxIndex, x: number, y: number, z: number, pad = 0): boolean {
  return boxAt(index, x, y, z, pad) !== null;
}

/** Mặt sàn cao nhất (khối đặc) ngay dưới điểm (x, yTop, z), hoặc địa hình. */
export function floorBelow(map: BattleMap, x: number, yTop: number, z: number): number {
  let best = map.world.heightAt(x, z);
  const t = raycastBoxes(map.index, [x, yTop, z], [0, -1, 0], yTop - best);
  if (t < Infinity) best = Math.max(best, yTop - t);
  return best;
}

// ---------------------------------------------------------------------------- thế giới

/** Tia chạm địa hình: đi từng bước 1 m rồi chia đôi cho chính xác. Trả khoảng cách hoặc Infinity. */
/** Bán kính thân cây chặn đạn (khớp CylinderCollider của client trong Trees.tsx). */
export function trunkRadius(t: Tree): number {
  return t.kind === "palm" ? 0.3 : 0.35 * t.lean;
}

interface TrunkIndex {
  cell: number;
  grid: Map<number, number[]>;
  /** x, z, bán kính, chân, đỉnh của từng thân. */
  data: Float64Array;
}
const trunkIndexes = new WeakMap<World, TrunkIndex>();

function trunkIndex(world: World): TrunkIndex {
  let idx = trunkIndexes.get(world);
  if (idx && idx.data.length === world.trees.length * 5) return idx;
  const cell = 8;
  const grid = new Map<number, number[]>();
  const data = new Float64Array(world.trees.length * 5);
  world.trees.forEach((t, i) => {
    const r = trunkRadius(t);
    const y = world.heightAt(t.x, t.z);
    data.set([t.x, t.z, r, y - 0.2, y + t.height], i * 5);
    for (let gx = Math.floor((t.x - r) / cell); gx <= Math.floor((t.x + r) / cell); gx++)
      for (let gz = Math.floor((t.z - r) / cell); gz <= Math.floor((t.z + r) / cell); gz++) {
        const key = cellKey(gx, gz);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
  });
  idx = { cell, grid, data };
  trunkIndexes.set(world, idx);
  return idx;
}

/**
 * Tia chạm thân cây gần nhất (trụ đứng) trong `max` mét: trả khoảng cách hoặc Infinity. Client có va chạm thân cây
 * (đạn người chơi găm vào cây) nên server cũng phải tính: trước đây máy nhìn và bắn xuyên qua cây người chơi nấp sau.
 */
export function raycastTrunks(world: World, o: readonly [number, number, number], d: readonly [number, number, number], max: number, dead?: Uint8Array): number {
  return raycastTrunksHit(world, o, d, max, dead).t;
}

/** Như `raycastTrunks` nhưng cho biết cả cây bị chạm (`i` theo `world.trees`, −1 nếu không). */
export function raycastTrunksHit(world: World, o: readonly [number, number, number], d: readonly [number, number, number], max: number, dead?: Uint8Array): { t: number; i: number } {
  if (!world.trees.length) return { t: Infinity, i: -1 };
  const { cell, grid, data } = trunkIndex(world);
  let best = max;
  let bi = -1;
  const tried = new Set<number>();
  // Đi từng đoạn dài một ô, xét mọi ô mà hộp bao của đoạn chạm tới (không lọt ô nào khi tia đi chéo).
  for (let t0 = 0; t0 < best; t0 += cell) {
    const t1 = Math.min(t0 + cell, best);
    const ax = o[0] + d[0] * t0;
    const az = o[2] + d[2] * t0;
    const bx = o[0] + d[0] * t1;
    const bz = o[2] + d[2] * t1;
    for (let gx = Math.floor(Math.min(ax, bx) / cell); gx <= Math.floor(Math.max(ax, bx) / cell); gx++)
      for (let gz = Math.floor(Math.min(az, bz) / cell); gz <= Math.floor(Math.max(az, bz) / cell); gz++) {
        const list = grid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const i of list) {
          if (tried.has(i) || dead?.[i]) continue;
          tried.add(i);
          const k = i * 5;
          const hit = rayTrunk(o, d, data[k]!, data[k + 1]!, data[k + 2]!, data[k + 3]!, data[k + 4]!, best);
          if (hit < best) {
            best = hit;
            bi = i;
          }
        }
      }
  }
  return best < max ? { t: best, i: bi } : { t: Infinity, i: -1 };
}

/** Độ bền thân cây trước khi gãy đổ (dừa mảnh thì yếu hơn cây rừng to). */
export function treeDurability(t: Tree): number {
  return t.kind === "palm" ? 160 : Math.round(200 * t.lean);
}

/** Tia cắt trụ đứng (tâm x, z, bán kính r, từ y0 tới y1). */
function rayTrunk(o: readonly [number, number, number], d: readonly [number, number, number], x: number, z: number, r: number, y0: number, y1: number, max: number): number {
  const ox = o[0] - x;
  const oz = o[2] - z;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-9) return Infinity;
  const b = ox * d[0] + oz * d[2];
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / a;
  // Gốc tia nằm trong thân (đứng sát cây): không tính là chặn, kẻo bắn không ra.
  if (t < 0) return Infinity;
  if (t > max) return Infinity;
  const y = o[1] + d[1] * t;
  if (y < y0 || y > y1) return Infinity;
  return t;
}

export function raycastTerrain(world: World, o: readonly [number, number, number], d: readonly [number, number, number], max: number): number {
  const step = 1;
  let prev = 0;
  for (let t = step; t <= max + step; t += step) {
    const tt = Math.min(t, max);
    const y = o[1] + d[1] * tt;
    if (y < world.heightAt(o[0] + d[0] * tt, o[2] + d[2] * tt)) {
      let a = prev;
      let b = tt;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        if (o[1] + d[1] * m < world.heightAt(o[0] + d[0] * m, o[2] + d[2] * m)) b = m;
        else a = m;
      }
      return a;
    }
    prev = tt;
    if (tt >= max) break;
  }
  return Infinity;
}

function battleTrees(rand: Rand, world: World): Tree[] {
  const trees: Tree[] = [];
  const near = (x: number, z: number, r: number) => trees.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
  // Dừa ven biển.
  for (let tries = 0; trees.length < 150 && tries < 4000; tries++) {
    const a = rand() * Math.PI * 2;
    const r = shoreR(Math.cos(a), Math.sin(a)) - 4 - rand() * 24;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (world.heightAt(x, z) < 0.7 || !world.isClear(x, z, 4) || near(x, z, 5)) continue;
    trees.push({ id: `p${trees.length}`, kind: "palm", x, z, height: 6 + rand() * 3, lean: (rand() - 0.5) * 0.4 });
  }
  // Rừng cây tán rộng thành từng cụm trong đảo và trên sườn núi.
  const palms = trees.length;
  const groves: { x: number; z: number }[] = [];
  for (let k = 0; k < 26; k++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 130;
    groves.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  for (let tries = 0; trees.length - palms < 420 && tries < 9000; tries++) {
    const g = groves[Math.floor(rand() * groves.length)]!;
    const x = g.x + (rand() - 0.5) * 60;
    const z = g.z + (rand() - 0.5) * 60;
    const inland = shoreR(x, z) - Math.hypot(x, z);
    if (inland < 22 || world.heightAt(x, z) > 22 || !world.isClear(x, z, 5) || near(x, z, 4.5)) continue;
    trees.push({ id: `b${trees.length}`, kind: "broadleaf", x, z, height: 5 + rand() * 4, lean: 0.85 + rand() * 0.45 });
  }
  return trees;
}

function battleGrass(rand: Rand, world: World): GrassPatch[] {
  const out: GrassPatch[] = [];
  for (let tries = 0; out.length < 34 && tries < 800; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 25 + rand() * 140;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = world.heightAt(x, z);
    if (h < 1 || h > 16 || !world.isClear(x, z, 8)) continue;
    out.push({ x, z, radius: 5 + rand() * 7 });
  }
  return out;
}

const cache = new Map<number, BattleMap>();

/** Bản đồ Battleground của một thế giới (đảo sinh tồn hay chiến trường), để phần nào chỉ có `world` cũng tra được. */
const byWorld = new WeakMap<World, BattleMap>();
export function registerMap(map: BattleMap) {
  byWorld.set(map.world, map);
}
export function mapOf(world: World): BattleMap {
  return byWorld.get(world) ?? battleMap(world.seed || 1);
}

export function battleMap(seed: number): BattleMap {
  const hit = cache.get(seed);
  if (hit) return hit;
  const boxes: BattleBox[] = [];
  const loot: LootSpot[] = [];
  const layoutRand = makeRand(20261001);
  let buildings = 0;
  for (const site of BATTLE_SITES) {
    const b = new Builder(site, layoutRand);
    if (site.kind === "city") buildCity(b);
    else if (site.kind === "port") buildPort(b);
    else if (site.kind === "fortress") buildFortress(b);
    else if (site.kind === "minefield") buildMinefield(b);
    else if (site.kind === "armory") buildArmory(b);
    else buildVillage(b);
    buildings = b.numberBuildings(buildings);
    boxes.push(...b.boxes);
    loot.push(...b.loot);
  }

  const inSite = (x: number, z: number, grow: number) => BATTLE_SITES.find((s) => outside(s, x, z, grow) === 0) ?? null;
  const surface = (x: number, z: number): Surface => {
    const inland = shoreR(x, z) - Math.hypot(x, z);
    const site = inSite(x, z, 1);
    const onQuay = !!site && site.kind === "port" && x > PORT_QUAY_X;
    return { island: inland < 0 && !site ? "sea" : "main", inland: onQuay ? -1 : inland, islet: null, reef: false, pad: !!site && !onQuay, ground: site && !onQuay ? site.ground : undefined };
  };
  const world: World = {
    seed,
    kind: "battle",
    extent: 196,
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
    heightAt: siteHeight,
    surface,
    zoneAt: (): ZoneId => "beach",
    regionAt: (x, z) => {
      const site = inSite(x, z, 10);
      if (site) return site.name;
      const inland = shoreR(x, z) - Math.hypot(x, z);
      const h = siteHeight(x, z);
      if (inland < -3) return "Biển";
      if (h > 14) return "Núi Ưng";
      if (inland < 25) return "Bãi biển";
      return "Rừng";
    },
    structureAt: () => null,
    isClear: (x, z, margin) => !inSite(x, z, margin) && !(x > PORT_QUAY_X - margin && Math.abs(z + 20) < 64 + margin),
  };
  const rand = makeRand(subSeed(seed, "battle"));
  world.trees = battleTrees(rand, world);
  world.palms = world.trees.filter((t) => t.kind === "palm").map((t) => ({ x: t.x, z: t.z, height: t.height, lean: t.lean }));
  world.tallGrass = battleGrass(rand, world);

  // Mìn trong bãi mìn: rải đều, tránh xác xe tăng.
  const mf = BATTLE_SITES.find((s) => s.kind === "minefield")!;
  const mines: { x: number; z: number }[] = [];
  const mineRand = makeRand(subSeed(seed, "mines"));
  for (let tries = 0; mines.length < 42 && tries < 500; tries++) {
    const u = (mineRand() * 2 - 1) * (mf.rx - 1.5);
    const v = (mineRand() * 2 - 1) * (mf.rz - 1.5);
    if (Math.hypot(u - 4, v + 2) < 5) continue;
    const p = toWorld(mf, u, v);
    if (mines.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < 2.2)) continue;
    mines.push(p);
  }

  const map: BattleMap = { layout: "island", half: 240, flags: [], world, sites: BATTLE_SITES, boxes, loot, mines, index: buildIndex(boxes) };
  cache.set(seed, map);
  registerMap(map);
  return map;
}

/** Chỗ xuất phát ngẫu nhiên trên đất liền (không trong nước, không kẹt trong nhà, không trong bãi mìn). */
export function battleSpawn(map: BattleMap, rand: () => number, avoid: readonly { x: number; z: number }[] = []): { x: number; y: number; z: number } {
  const mf = map.sites.find((s) => s.kind === "minefield");
  let fallback = { x: 0, y: map.world.heightAt(0, 0) + 1, z: 0 };
  for (let tries = 0; tries < 200; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 20 + Math.sqrt(rand()) * 150;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = map.world.heightAt(x, z);
    if (h < 1 || (mf && outside(mf, x, z, 4) === 0)) continue;
    if (insideBox(map.index, x, h + 1, z, 0.6)) continue;
    fallback = { x, y: h, z };
    if (avoid.every((p) => Math.hypot(p.x - x, p.z - z) > 45)) return { x, y: h, z };
  }
  return fallback;
}
