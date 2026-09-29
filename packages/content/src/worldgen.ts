// Bộ sinh thế giới theo seed. Đảo chính giữ nguyên (island.ts); seed quyết định mọi thứ quanh nó:
// đảo nhỏ ngoài khơi, rạn san hô để lặn, hang động và hầm mỏ, easter egg, điểm bất thường, bãi sinh vật.
// Bẫy dùng một seed riêng mà chỉ server biết (generateTraps), để người chơi không tính trước được bẫy nằm đâu.
//
// Hàm thuần: cùng seed luôn ra cùng một thế giới, trên mọi máy. Client dựng cảnh 3D từ đây,
// server dùng cùng dữ liệu để kiểm tra vị trí, cho sinh vật đi lại và xác nhận chạm trán.
// Đơn vị mét; trục x hướng đông, trục z hướng nam, như island.ts.

import { nextFloat, type RngState, type StatId, type ZoneId } from "@tentides/rules";
import {
  ANCHORS,
  CAMP,
  CAVE,
  LAKE,
  MAP_HALF_SIZE,
  PALMS,
  TALL_GRASS,
  TREASURE_SITES,
  VOLCANO,
  ZONE_LABELS,
  heightAt as islandHeightAt,
  shoreRadius,
  zoneAt as islandZoneAt,
  type GrassPatch,
  type Palm,
} from "./island.ts";
import { worldCatalog, type Habitat, type PoiDef, type WorldCatalog } from "./worldCatalog.ts";

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

export const ISLET_KINDS = ["sandbar", "jungle", "rocky", "volcanic", "atoll"] as const;
export type IsletKind = (typeof ISLET_KINDS)[number];

export const ISLET_KIND_LABELS: Record<IsletKind, string> = {
  sandbar: "cồn cát",
  jungle: "đảo rừng",
  rocky: "đảo đá",
  volcanic: "đảo cát đen",
  atoll: "đảo vòng",
};

export interface Islet {
  id: string;
  name: string;
  kind: IsletKind;
  x: number;
  z: number;
  /** Bán kính bờ trung bình. */
  radius: number;
  /** Độ cao đỉnh. */
  peak: number;
  /** Độ méo của bờ: biên độ và pha của hai sóng quanh tâm, để đảo không tròn vành vạnh. */
  wobble: [number, number, number, number];
}

/** Rạn san hô: đáy biển nhô lên gần mặt nước, lặn xuống thấy san hô, cá, trai, bạch tuộc. */
export interface Reef {
  id: string;
  x: number;
  z: number;
  radius: number;
  /** Độ cao mặt rạn (âm, dưới mặt nước). */
  top: number;
}

export type StructureKind = "cave" | "mine";

/**
 * Hang động hoặc hầm mỏ: lưới ô vuông trong hệ toạ độ riêng (u ngang, v đi sâu vào trong).
 * Cửa ở cạnh v = 0 của ô (0, 0); ô (i, j) có tâm tại (i × cellSize, (j + 0,5) × cellSize).
 * Toạ độ riêng đổi ra thế giới bằng phép quay quanh trục y một góc `rot` (giống three.js).
 */
export interface Structure {
  id: string;
  kind: StructureKind;
  name: string;
  /** Vị trí cửa. */
  x: number;
  z: number;
  rot: number;
  /** Độ cao mặt sàn (địa hình quanh đó được san phẳng về đây). */
  floor: number;
  cellSize: number;
  /** Chiều cao trong lòng hầm. */
  height: number;
  cells: [number, number][];
  /** Số ô phải đi qua từ cửa tới ô này (ô cửa là 0). */
  depth: number[];
}

export type TreeKind = "palm" | "broadleaf";

export interface Tree {
  id: string;
  kind: TreeKind;
  x: number;
  z: number;
  /** Chiều cao thân (m). */
  height: number;
  /** Dừa: độ nghiêng; cây rừng: độ to của tán (0,8–1,3). */
  lean: number;
}

export interface Poi {
  id: string;
  defId: string;
  kind: PoiDef["kind"];
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Điểm bất thường: kết quả đã định sẵn theo seed (chỉ số trong `outcomes`). Easter egg: -1. */
  outcome: number;
  /** Chỉ hiện trong ngày này (0 là mọi ngày). */
  day: number;
  habitat: Habitat;
  structure: string | null;
}

/** Trang nhật ký của người xưa: mỗi ngày một trang ở một chỗ khác, nội dung do bộ sinh truyện viết. */
export interface DiaryPage {
  id: string;
  day: number;
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface CreatureSpawn {
  id: string;
  species: string;
  habitat: Habitat;
  x: number;
  z: number;
  /** Con vật lang thang trong bán kính này quanh chỗ sinh ra (với hang, hầm: trong các ô của nó). */
  range: number;
  structure: string | null;
}

export interface Trap {
  id: string;
  defId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  habitat: Habitat;
}

export interface Surface {
  /** Đang ở trên đảo nào (hoặc ngoài biển). */
  island: "main" | "islet" | "sea";
  /** Số mét tính từ bờ vào trong đảo gần nhất (âm là ngoài khơi). */
  inland: number;
  islet: Islet | null;
  reef: boolean;
  /** Sân đất nện trước cửa hang hay hầm mỏ. */
  pad: boolean;
  /** Nền nhân tạo của Battleground: đường nhựa, bê tông, đất trống (không mọc cây cỏ). */
  ground?: "asphalt" | "concrete" | "dirt" | "stone";
}

export interface StructureHit {
  structure: Structure;
  cell: number;
  depth: number;
}

export interface World {
  seed: number;
  /** Bản đồ cốt truyện (mặc định) hay bản đồ Battleground (xem battle.ts). */
  kind?: "story" | "battle";
  /** Nửa cạnh vùng đảo chính (để rải cây cỏ); mặc định 112. */
  extent?: number;
  /** Nửa cạnh cả bản đồ (địa hình, mặt biển); mặc định MAP_HALF_SIZE. Chiến trường 50 vs 50 rộng hơn. */
  half?: number;
  islets: readonly Islet[];
  reefs: readonly Reef[];
  structures: readonly Structure[];
  pois: readonly Poi[];
  /** Trang nhật ký, mỗi ngày một trang. */
  pages: readonly DiaryPage[];
  spawns: readonly CreatureSpawn[];
  /** Mọi cây dừa: dừa đảo chính (trừ cây nằm trên nền hang, hầm) và dừa trên các đảo nhỏ. */
  palms: readonly Palm[];
  /**
   * Mọi cây leo được, chặt được: dừa (id "p…") và cây rừng tán rộng (id "b…"). Server giữ cây nào đã bị chặt,
   * cây nào mới trồng; client vẽ theo.
   */
  trees: readonly Tree[];
  /** Đám cỏ cao để nấp: như TALL_GRASS, bỏ những đám bị hang, hầm đè lên. */
  tallGrass: readonly GrassPatch[];
  /** Đang đứng trong lõi một đám cỏ cao (ngồi xuống là nấp). */
  inTallGrass(x: number, z: number): boolean;
  heightAt(x: number, z: number): number;
  surface(x: number, z: number): Surface;
  /** Vùng của engine luật (để tính cộng điểm theo vùng): đảo nhỏ tính là bãi biển, hang và hầm tính là hang. */
  zoneAt(x: number, z: number): ZoneId;
  /** Tên nơi đang đứng, cho HUD. */
  regionAt(x: number, z: number): string;
  structureAt(x: number, z: number): StructureHit | null;
  /** Khoảng trống: không nằm trong hang, hầm (cộng lề `margin`) và cách mọi điểm bí mật ít nhất `margin`. */
  isClear(x: number, z: number, margin: number): boolean;
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Rand {
  (): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** PRNG có seed của engine luật, gói lại cho tiện dùng trong vòng lặp. */
export function makeRand(seed: RngState): Rand {
  let state = seed >>> 0;
  const next = (() => {
    const r = nextFloat(state);
    state = r.rng;
    return r.value;
  }) as Rand;
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  next.pick = (items) => items[Math.floor(next() * items.length)]!;
  next.shuffle = (items) => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return next;
}

/** Trộn seed với một nhãn để mỗi phần của thế giới có luồng random riêng (thêm phần mới không làm xáo phần cũ). */
export function subSeed(seed: number, label: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Đổi toạ độ riêng (u, v) của hang/hầm ra toạ độ thế giới. */
export function structureToWorld(s: Pick<Structure, "x" | "z" | "rot">, u: number, v: number): { x: number; z: number } {
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  return { x: s.x + u * c + v * sn, z: s.z - u * sn + v * c };
}

export function worldToStructure(s: Pick<Structure, "x" | "z" | "rot">, x: number, z: number): { u: number; v: number } {
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  return { u: dx * c - dz * sn, v: dx * sn + dz * c };
}

export function cellCenter(s: Structure, index: number): { x: number; z: number } {
  const [i, j] = s.cells[index]!;
  return structureToWorld(s, i * s.cellSize, (j + 0.5) * s.cellSize);
}

/** Độ dày vách và trần hang. */
export const STRUCTURE_WALL = 1.2;

/** Hình chữ nhật bao các ô (toạ độ riêng), để san nền và tránh chồng lên thứ khác. */
function structureBounds(s: Pick<Structure, "cells" | "cellSize">) {
  const half = s.cellSize / 2 + STRUCTURE_WALL;
  let minU = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const [i, j] of s.cells) {
    minU = Math.min(minU, i * s.cellSize - half);
    maxU = Math.max(maxU, i * s.cellSize + half);
    maxV = Math.max(maxV, (j + 1) * s.cellSize + STRUCTURE_WALL);
  }
  return { minU, maxU, minV: -STRUCTURE_WALL, maxV };
}

/** Khoảng cách từ (u, v) tới hình chữ nhật bao (0 khi ở trong). */
function outsideBounds(b: ReturnType<typeof structureBounds>, u: number, v: number): number {
  const du = Math.max(b.minU - u, 0, u - b.maxU);
  const dv = Math.max(b.minV - v, 0, v - b.maxV);
  return Math.hypot(du, dv);
}

export interface Slab {
  /** Tâm theo toạ độ riêng của hang/hầm; y tính từ mặt sàn. */
  u: number;
  y: number;
  v: number;
  /** Kích thước theo u, y, v. */
  su: number;
  sy: number;
  sv: number;
  part: "wall" | "roof";
}

/** Vách và trần của hang/hầm: vách ở mọi cạnh giáp ô đặc, trừ cạnh cửa; trần phủ mọi ô. */
export function structureSlabs(s: Structure): Slab[] {
  const open = new Set(s.cells.map(([i, j]) => `${i},${j}`));
  const cs = s.cellSize;
  const w = STRUCTURE_WALL;
  const out: Slab[] = [];
  for (const [i, j] of s.cells) {
    const cu = i * cs;
    const cv = (j + 0.5) * cs;
    const sides: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [di, dj] of sides) {
      if (open.has(`${i + di},${j + dj}`)) continue;
      if (i === 0 && j === 0 && dj === -1) continue; // cửa
      const u = cu + (di * (cs + w)) / 2;
      const v = cv + (dj * (cs + w)) / 2;
      out.push({ u, y: s.height / 2, v, su: di ? w : cs + w, sy: s.height, sv: dj ? w : cs + w, part: "wall" });
    }
    out.push({ u: cu, y: s.height + w / 2, v: cv, su: cs + w, sy: w, sv: cs + w, part: "roof" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Đảo nhỏ và rạn san hô
// ---------------------------------------------------------------------------

/** Số mét tính từ bờ đảo nhỏ vào trong (âm là ngoài khơi). */
export function isletEdge(islet: Islet, x: number, z: number): number {
  const dx = x - islet.x;
  const dz = z - islet.z;
  const a = Math.atan2(dz, dx);
  const [a1, p1, a2, p2] = islet.wobble;
  const r = islet.radius * (1 + a1 * Math.sin(3 * a + p1) + a2 * Math.sin(5 * a + p2));
  return r - Math.hypot(dx, dz);
}

/** Độ cao của riêng một đảo nhỏ (kể cả sườn dốc xuống đáy biển quanh nó). */
function isletHeight(islet: Islet, x: number, z: number, edge: number): number {
  if (edge < 0) return 0.3 - 10.5 * smoothstep(0, 26, -edge);
  const R = islet.radius;
  const beach = 0.3 + 0.9 * smoothstep(0, 5, edge);
  const bump = Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.17 - x * 0.07);
  switch (islet.kind) {
    case "sandbar":
      return 0.3 + (islet.peak - 0.3) * smoothstep(0, R * 0.7, edge) + 0.15 * bump;
    case "jungle":
      return beach + (islet.peak - 1.2) * smoothstep(4, R * 0.85, edge) + 0.7 * bump * smoothstep(4, 10, edge);
    case "rocky":
      return beach + islet.peak * Math.pow(smoothstep(2, R * 0.65, edge), 1.3) + 1.4 * bump * smoothstep(3, 8, edge);
    case "volcanic": {
      const d = Math.hypot(x - islet.x, z - islet.z);
      const cone = beach + islet.peak * smoothstep(2, R * 0.8, edge);
      return cone - (islet.peak * 0.45) * smoothstep(R * 0.24, R * 0.08, d);
    }
    case "atoll": {
      // Vành đai cát bao quanh một vụng nước nông ở giữa.
      const ring = Math.max(5, R * 0.34);
      const band = beach + (islet.peak - 1.2) * smoothstep(2, ring * 0.5, edge) * smoothstep(ring, ring * 0.55, edge);
      return lerp(band, -2.2, smoothstep(ring - 1, ring + 5, edge));
    }
  }
}

function reefHeight(reef: Reef, x: number, z: number, d: number): number {
  const coral = 0.9 * Math.max(0, Math.sin(x * 0.55 + Math.sin(z * 0.4) * 2) * Math.cos(z * 0.5 - x * 0.12));
  return reef.top - 1.4 * smoothstep(reef.radius * 0.3, reef.radius, d) + coral;
}

// ---------------------------------------------------------------------------
// Sinh thế giới
// ---------------------------------------------------------------------------

/** Tạo thế giới từ seed. Nặng vừa phải (vài chục mili giây), nên gọi một lần mỗi seed rồi giữ lại. */
export function generateWorld(seed: number, catalog: WorldCatalog = worldCatalog): World {
  const islets = generateIslets(makeRand(subSeed(seed, "islets")), catalog);
  const reefs = generateReefs(makeRand(subSeed(seed, "reefs")), islets);

  // Độ cao trước khi san nền cho hang/hầm.
  const rawHeight = (x: number, z: number): number => {
    let h = islandHeightAt(x, z);
    for (const islet of islets) {
      const dx = x - islet.x;
      const dz = z - islet.z;
      const reach = islet.radius * 1.45 + 28;
      if (dx * dx + dz * dz > reach * reach) continue;
      h = Math.max(h, isletHeight(islet, x, z, isletEdge(islet, x, z)));
    }
    for (const reef of reefs) {
      const d = Math.hypot(x - reef.x, z - reef.z);
      if (d < reef.radius) h = Math.max(h, reefHeight(reef, x, z, d));
    }
    return h;
  };

  const structures = generateStructures(makeRand(subSeed(seed, "structures")), catalog, islets, rawHeight);
  const bounds = structures.map(structureBounds);
  const cellIndex = structures.map((s) => new Map(s.cells.map(([i, j], k) => [`${i},${j}`, k])));

  const padAt = (x: number, z: number): { floor: number; weight: number; front: boolean } | null => {
    let best: { floor: number; weight: number; front: boolean } | null = null;
    for (let k = 0; k < structures.length; k++) {
      const s = structures[k]!;
      const { u, v } = worldToStructure(s, x, z);
      const out = outsideBounds(bounds[k]!, u, v);
      const weight = 1 - smoothstep(1.5, 7, out);
      // Sân trước cửa: vệt đất nện hình bán nguyệt trước miệng hang.
      const front = v < 1 && Math.hypot(u, v) < s.cellSize * 1.4 + 2;
      if (weight > 0 && (!best || weight > best.weight)) best = { floor: s.floor, weight, front };
    }
    return best;
  };

  const heightAt = (x: number, z: number): number => {
    const h = rawHeight(x, z);
    const pad = padAt(x, z);
    return pad ? lerp(h, pad.floor, pad.weight) : h;
  };

  const structureAt = (x: number, z: number): StructureHit | null => {
    for (let k = 0; k < structures.length; k++) {
      const s = structures[k]!;
      const { u, v } = worldToStructure(s, x, z);
      if (v < 0 || outsideBounds(bounds[k]!, u, v) > 0) continue;
      const cell = cellIndex[k]!.get(`${Math.round(u / s.cellSize)},${Math.floor(v / s.cellSize)}`);
      if (cell !== undefined) return { structure: s, cell, depth: s.depth[cell]! };
    }
    return null;
  };

  const surface = (x: number, z: number): Surface => {
    let inland = shoreRadius(x, z) - Math.hypot(x, z);
    let islet: Islet | null = null;
    for (const it of islets) {
      const e = isletEdge(it, x, z);
      if (e > inland) {
        inland = e;
        islet = it;
      }
    }
    const reef = reefs.some((r) => Math.hypot(x - r.x, z - r.z) < r.radius * 0.85);
    const p = padAt(x, z);
    const pad = !!p && p.weight > 0.5 && p.front;
    return { island: inland < 0 ? "sea" : islet ? "islet" : "main", inland, islet, reef, pad };
  };

  const zoneAt = (x: number, z: number): ZoneId => {
    if (structureAt(x, z)) return "cave";
    const s = surface(x, z);
    if (s.islet && s.inland > -2) return "beach";
    return islandZoneAt(x, z);
  };

  const regionAt = (x: number, z: number): string => {
    const hit = structureAt(x, z);
    if (hit) return hit.structure.name;
    const s = surface(x, z);
    if (s.islet && s.inland > -3) return `${s.islet.name} · ${ISLET_KIND_LABELS[s.islet.kind]}`;
    if (s.island === "main" || s.inland > -3 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 4) return ZONE_LABELS[islandZoneAt(x, z)];
    if (s.reef) return "Rạn san hô";
    return s.inland > -30 ? "Vùng nước ven bờ" : "Biển khơi";
  };

  const world: World = {
    seed,
    islets,
    reefs,
    structures,
    pois: [],
    pages: [],
    spawns: [],
    palms: [],
    trees: [],
    tallGrass: [],
    inTallGrass: (x, z) => world.tallGrass.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius * 0.85),
    heightAt,
    surface,
    zoneAt,
    regionAt,
    structureAt,
    isClear: (x, z, margin) =>
      structures.every((s, k) => {
        const { u, v } = worldToStructure(s, x, z);
        return outsideBounds(bounds[k]!, u, v) > margin;
      }) && world.pois.every((p) => Math.hypot(p.x - x, p.z - z) > margin),
  };
  world.tallGrass = TALL_GRASS.filter((p) => world.isClear(p.x, p.z, p.radius + 1));
  world.palms = [...PALMS.filter((p) => world.isClear(p.x, p.z, 2)), ...generateIsletPalms(makeRand(subSeed(seed, "palms")), world)];
  world.pois = generatePois(makeRand(subSeed(seed, "pois")), world, catalog);
  world.trees = [
    ...world.palms.map((p, i): Tree => ({ id: `p${i}`, kind: "palm", x: p.x, z: p.z, height: p.height, lean: p.lean })),
    ...generateBroadleaf(makeRand(subSeed(seed, "trees")), world),
  ];
  world.pages = generatePages(makeRand(subSeed(seed, "pages")), world);
  world.spawns = generateSpawns(makeRand(subSeed(seed, "creatures")), world, catalog);
  return world;
}

/** Chỗ trang nhật ký của từng ngày: mấy ngày đầu gần trại, về sau xa dần (lên đồi, vào hang, ra đảo nhỏ, lên núi lửa). */
const PAGE_HABITATS: readonly Habitat[] = ["palm", "beach", "forest", "hilltop", "cave", "forest", "islet", "volcano", "mine", "hilltop"];

function generatePages(rand: Rand, world: World): DiaryPage[] {
  const pages: DiaryPage[] = [];
  const taken = new Set<string>();
  for (let day = 1; day <= PAGE_HABITATS.length; day++) {
    const habitats = [PAGE_HABITATS[day - 1]!, "forest", "beach"] as const;
    let spot: Spot | null = null;
    for (const hab of habitats) {
      for (let tries = 0; tries < 12 && !spot; tries++) {
        const s = sampleHabitat(rand, world, hab, taken);
        if (!s) continue;
        const clear =
          world.trees.every((t) => Math.hypot(t.x - s.x, t.z - s.z) > 2.5) && pages.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 20);
        if (clear) spot = s;
      }
      if (spot) break;
    }
    if (!spot) continue;
    if (spot.structure) taken.add(`${spot.structure.id}:${spot.cell}`);
    pages.push({
      id: `page${day}`,
      day,
      x: spot.x,
      y: spot.structure ? spot.structure.floor : world.heightAt(spot.x, spot.z),
      z: spot.z,
      rot: rand() * Math.PI * 2,
    });
  }
  return pages;
}

function generateIslets(rand: Rand, catalog: WorldCatalog): Islet[] {
  const count = rand.int(4, 6);
  const names = rand.shuffle(catalog.names.islets);
  // Luôn có ít nhất một đảo rừng và một đảo đá, còn lại tuỳ seed.
  const kinds: IsletKind[] = rand.shuffle(["jungle", "rocky", ...Array.from({ length: count - 2 }, () => rand.pick(ISLET_KINDS))]);
  const islets: Islet[] = [];
  for (let attempt = 0; islets.length < count && attempt < 400; attempt++) {
    const kind = kinds[islets.length]!;
    const radius = { sandbar: 9 + rand() * 6, jungle: 18 + rand() * 12, rocky: 13 + rand() * 9, volcanic: 16 + rand() * 9, atoll: 22 + rand() * 9 }[kind];
    const angle = rand() * Math.PI * 2;
    const maxDist = MAP_HALF_SIZE - radius - 28;
    const dist = 150 + rand() * Math.max(0, maxDist - 150);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const shore = shoreRadius(x, z);
    if (dist - radius * 1.3 - shore < 26) continue;
    if (Math.abs(x) + radius > MAP_HALF_SIZE - 20 || Math.abs(z) + radius > MAP_HALF_SIZE - 20) continue;
    if (islets.some((o) => Math.hypot(o.x - x, o.z - z) < (o.radius + radius) * 1.3 + 24)) continue;
    const peak = { sandbar: 0.8 + rand() * 0.5, jungle: 5 + rand() * 4, rocky: 9 + rand() * 8, volcanic: 8 + rand() * 5, atoll: 1.6 + rand() * 0.8 }[kind];
    islets.push({
      id: `islet${islets.length}`,
      name: names[islets.length % names.length]!,
      kind,
      x,
      z,
      radius,
      peak,
      wobble: [0.06 + rand() * 0.1, rand() * Math.PI * 2, 0.03 + rand() * 0.06, rand() * Math.PI * 2],
    });
  }
  return islets;
}

function generateReefs(rand: Rand, islets: readonly Islet[]): Reef[] {
  const reefs: Reef[] = [];
  const count = rand.int(5, 8);
  for (let attempt = 0; reefs.length < count && attempt < 300; attempt++) {
    let x: number;
    let z: number;
    if (islets.length > 0 && rand() < 0.5) {
      // Rạn quanh đảo nhỏ.
      const it = rand.pick(islets);
      const a = rand() * Math.PI * 2;
      const d = it.radius * 1.15 + 8 + rand() * 10;
      x = it.x + Math.cos(a) * d;
      z = it.z + Math.sin(a) * d;
    } else {
      // Rạn trên thềm quanh đảo chính, tránh bến thuyền phía nam.
      const a = rand() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.35) continue;
      const d = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100) + 16 + rand() * 22;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    }
    const radius = 9 + rand() * 8;
    if (Math.abs(x) > MAP_HALF_SIZE - radius - 5 || Math.abs(z) > MAP_HALF_SIZE - radius - 5) continue;
    if (reefs.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + radius + 6)) continue;
    if (islets.some((it) => isletEdge(it, x, z) > -4)) continue;
    if (islandHeightAt(x, z) > -3) continue;
    reefs.push({ id: `reef${reefs.length}`, x, z, radius, top: -2.2 - rand() * 1.4 });
  }
  return reefs;
}

// ---------------------------------------------------------------------------
// Hang động và hầm mỏ
// ---------------------------------------------------------------------------

function carveCave(rand: Rand): [number, number][] {
  const cells: [number, number][] = [[0, 0]];
  const has = (i: number, j: number) => cells.some(([a, b]) => a === i && b === j);
  const target = rand.int(5, 8);
  let [i, j] = [0, 0];
  for (let tries = 0; cells.length < target && tries < 60; tries++) {
    const r = rand();
    // Đi sâu vào trong là chính, thỉnh thoảng rẽ ngang, đôi khi rẽ nhánh từ một ô cũ.
    if (r < 0.15 && cells.length > 2) [i, j] = rand.pick(cells.slice(1));
    const dir = rand();
    const [di, dj] = dir < 0.5 ? [0, 1] : dir < 0.75 ? [1, 0] : [-1, 0];
    const ni = i + di;
    const nj = j + dj;
    if (nj < 1 && !(ni === 0 && nj === 0)) continue;
    if (!has(ni, nj)) cells.push([ni, nj]);
    [i, j] = [ni, nj];
  }
  return cells;
}

function carveMine(rand: Rand): [number, number][] {
  const length = rand.int(4, 6);
  const cells: [number, number][] = Array.from({ length }, (_, j) => [0, j] as [number, number]);
  const galleries = rand.int(1, 2);
  const used = new Set<number>();
  for (let g = 0; g < galleries; g++) {
    const j = rand.int(1, length - 1);
    if (used.has(j)) continue;
    used.add(j);
    const side = rand() < 0.5 ? -1 : 1;
    const reach = rand.int(1, 3);
    for (let k = 1; k <= reach; k++) cells.push([side * k, j]);
  }
  return cells;
}

function depthsOf(cells: [number, number][]): number[] {
  const index = new Map(cells.map(([i, j], k) => [`${i},${j}`, k]));
  const depth = cells.map(() => Infinity);
  depth[0] = 0;
  const queue = [0];
  while (queue.length > 0) {
    const k = queue.shift()!;
    const [i, j] = cells[k]!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = index.get(`${i + di},${j + dj}`);
      if (n !== undefined && depth[n] === Infinity) {
        depth[n] = depth[k]! + 1;
        queue.push(n);
      }
    }
  }
  return depth;
}

/**
 * Những chỗ cố định của đảo chính mà hang/hầm không được đè lên. Dừa và đám cỏ cao thì được:
 * cái nào nằm trong nền hang bị bỏ đi (xem `palms`, `tallGrass` của thế giới).
 */
function mainIslandClear(x: number, z: number, margin: number): boolean {
  if (Math.hypot(x - CAMP.x, z - CAMP.z) < 30 + margin) return false;
  if (Math.hypot(x - CAVE.x, z - CAVE.z) < CAVE.radius + 14 + margin) return false;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 10 + margin) return false;
  if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.craterRadius + 14 + margin) return false;
  if (ANCHORS.some((a) => Math.hypot(a.x - x, a.z - z) < 10 + margin)) return false;
  if (TREASURE_SITES.some((t) => Math.hypot(t.x - x, t.z - z) < 9 + margin)) return false;
  return true;
}

function generateStructures(
  rand: Rand,
  catalog: WorldCatalog,
  islets: readonly Islet[],
  height: (x: number, z: number) => number,
): Structure[] {
  const structures: Structure[] = [];
  const caveNames = rand.shuffle(catalog.names.caves);
  const mineNames = rand.shuffle(catalog.names.mines);
  const plan: { kind: StructureKind; where: "main" | "islet" }[] = [
    { kind: "cave", where: "main" },
    { kind: "mine", where: "main" },
    { kind: "cave", where: rand() < 0.6 ? "islet" : "main" },
  ];
  if (rand() < 0.5) plan.push({ kind: "mine", where: rand() < 0.4 ? "islet" : "main" });
  const bigIslets = islets.filter((it) => (it.kind === "jungle" || it.kind === "rocky" || it.kind === "volcanic") && it.radius >= 15);

  for (const { kind, where } of plan) {
    if (where === "islet" && bigIslets.length === 0) continue;
    for (let attempt = 0; attempt < 250; attempt++) {
      const cells = kind === "cave" ? carveCave(rand) : carveMine(rand);
      const cellSize = kind === "cave" ? 6 : 5;
      let x: number;
      let z: number;
      let inward: number;
      if (where === "main") {
        const a = rand() * Math.PI * 2;
        const r = 30 + rand() * 60;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        // Đường hầm đâm về phía lõi đảo (chỗ đất cao), lệch ngẫu nhiên một chút.
        inward = Math.atan2(-x, -z) + (rand() - 0.5) * 1.4;
      } else {
        const it = rand.pick(bigIslets);
        const a = rand() * Math.PI * 2;
        const r = it.radius * (0.35 + rand() * 0.3);
        x = it.x + Math.cos(a) * r;
        z = it.z + Math.sin(a) * r;
        inward = Math.atan2(it.x - x, it.z - z) + (rand() - 0.5) * 1.2;
      }
      const draft: Structure = {
        id: `${kind}${structures.length}`,
        kind,
        name: "",
        x,
        z,
        rot: inward,
        floor: 0,
        cellSize,
        height: kind === "cave" ? 4.6 : 3.8,
        cells,
        depth: depthsOf(cells),
      };
      const entranceH = height(x, z);
      const front = structureToWorld(draft, 0, -5);
      const frontH = height(front.x, front.z);
      if (entranceH < 1.2 || frontH < 0.6 || Math.abs(frontH - entranceH) > 2.5) continue;
      const floor = Math.max(1.2, entranceH);
      const b = structureBounds(draft);
      // Kiểm tra các góc, tâm từng ô và cửa: phải là đất liền, không lở quá sâu, không đè lên thứ khác.
      const probes = [
        ...cells.map((_, k) => cellCenter(draft, k)),
        structureToWorld(draft, b.minU, b.maxV),
        structureToWorld(draft, b.maxU, b.maxV),
        structureToWorld(draft, b.minU, 0),
        structureToWorld(draft, b.maxU, 0),
        front,
      ];
      const ok = probes.every((p) => {
        const h = height(p.x, p.z);
        if (h < floor - 1.5 || h > floor + 11) return false;
        if (Math.abs(p.x) > MAP_HALF_SIZE - 20 || Math.abs(p.z) > MAP_HALF_SIZE - 20) return false;
        return where === "islet" || mainIslandClear(p.x, p.z, 3);
      });
      if (!ok) continue;
      if (structures.some((o) => Math.hypot(o.x - x, o.z - z) < 55)) continue;
      draft.floor = floor;
      draft.name = kind === "cave" ? caveNames[structures.filter((s) => s.kind === "cave").length % caveNames.length]! : mineNames[structures.filter((s) => s.kind === "mine").length % mineNames.length]!;
      structures.push(draft);
      break;
    }
  }
  return structures;
}

// ---------------------------------------------------------------------------
// Dừa trên đảo nhỏ
// ---------------------------------------------------------------------------

function generateIsletPalms(rand: Rand, world: World): Palm[] {
  const palms: Palm[] = [];
  for (const it of world.islets) {
    if (it.kind === "rocky") continue;
    const count = Math.round(it.radius * (it.kind === "sandbar" ? 0.25 : it.kind === "volcanic" ? 0.3 : 0.6));
    for (let attempt = 0, placed = 0; placed < count && attempt < count * 30; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = it.radius * (it.kind === "atoll" ? 0.75 + rand() * 0.2 : 0.2 + rand() * 0.7);
      const x = it.x + Math.cos(a) * r;
      const z = it.z + Math.sin(a) * r;
      const h = world.heightAt(x, z);
      if (h < 0.6 || h > 9 || isletEdge(it, x, z) < 2.5) continue;
      if (!world.isClear(x, z, 3)) continue;
      if (palms.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
      palms.push({ x, z, height: 5.5 + rand() * 3, lean: (rand() - 0.5) * 0.5 });
      placed++;
    }
  }
  return palms;
}

/**
 * Cây rừng tán rộng mọc trong nội đảo chính và trên đảo rừng: tránh điểm sự kiện, kho báu, trại,
 * cây dừa, đám cỏ tranh, hang, hầm và điểm bí mật.
 */
function generateBroadleaf(rand: Rand, world: World): Tree[] {
  const out: Tree[] = [];
  const jungle = world.islets.filter((it) => it.kind === "jungle");
  const target = 40 + jungle.length * 7;
  const inland = (x: number, z: number) => {
    const s = world.surface(x, z);
    return s.island === "islet" ? s.inland * 2.5 : s.inland;
  };
  for (let tries = 0; out.length < target && tries < 6000; tries++) {
    const onIslet = jungle.length > 0 && tries % 3 === 2;
    const r = onIslet ? jungle[Math.floor(rand() * jungle.length)]! : { x: 0, z: 0, radius: 75 };
    const x = r.x + (rand() * 2 - 1) * r.radius * (onIslet ? 0.8 : 1.2);
    const z = r.z + (rand() * 2 - 1) * r.radius * (onIslet ? 0.8 : 1.2);
    const h = world.heightAt(x, z);
    if (h < 0.6 || h > 9 || inland(x, z) < 26) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 3 || Math.hypot(x - CAVE.x, z - CAVE.z) < CAVE.radius + 2) continue;
    if (world.zoneAt(x, z) === "volcano" || world.structureAt(x, z)) continue;
    if (!awayFromFixed(x, z, 4) || !world.isClear(x, z, 5)) continue;
    if (world.tallGrass.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 2)) continue;
    if (world.palms.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 8)) continue;
    out.push({ id: `b${out.length}`, kind: "broadleaf", x, z, height: 4.5 + rand() * 2.5, lean: 0.8 + rand() * 0.5 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chọn chỗ theo môi trường sống
// ---------------------------------------------------------------------------

interface Spot {
  x: number;
  z: number;
  structure: Structure | null;
  cell: number;
}

/** Tránh những chỗ cố định của ván: trại, điểm sự kiện, chỗ giấu kho báu. */
function awayFromFixed(x: number, z: number, margin: number): boolean {
  if (Math.hypot(x - CAMP.x, z - CAMP.z) < 22 + margin) return false;
  if (ANCHORS.some((a) => Math.hypot(a.x - x, a.z - z) < 5 + margin)) return false;
  return TREASURE_SITES.every((t) => Math.hypot(t.x - x, t.z - z) >= 4 + margin);
}

/** Thử chọn một chỗ hợp môi trường sống; null nếu không tìm được. `taken` là các ô hang/hầm đã có người dùng. */
function sampleHabitat(rand: Rand, world: World, habitat: Habitat, taken: Set<string> = new Set()): Spot | null {
  const h = world.heightAt;
  const free = (x: number, z: number) => awayFromFixed(x, z, 0) && world.isClear(x, z, 2.5);
  const at = (x: number, z: number): Spot => ({ x, z, structure: null, cell: -1 });
  const inside = (kind: StructureKind, deep: boolean): Spot | null => {
    const options = world.structures
      .filter((s) => s.kind === kind)
      .flatMap((s) => {
        const maxDepth = Math.max(...s.depth);
        return s.cells
          .map((_, k) => k)
          .filter((k) => !taken.has(`${s.id}:${k}`) && s.depth[k]! >= (deep ? Math.max(1, maxDepth - 1) : 1))
          .map((k) => ({ s, k }));
      });
    if (options.length === 0) return null;
    const { s, k } = rand.pick(options);
    const c = cellCenter(s, k);
    // Lệch khỏi tâm ô một chút cho tự nhiên.
    const jitter = s.cellSize * 0.22;
    return { x: c.x + (rand() - 0.5) * jitter, z: c.z + (rand() - 0.5) * jitter, structure: s, cell: k };
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    switch (habitat) {
      case "beach": {
        const a = rand() * Math.PI * 2;
        const r = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100) - 3 - rand() * 8;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = h(x, z);
        if (y > 0.35 && y < 2.5 && islandZoneAt(x, z) === "beach" && free(x, z)) return at(x, z);
        break;
      }
      case "forest":
      case "hilltop": {
        let best: Spot | null = null;
        let bestH = -Infinity;
        for (let k = 0; k < (habitat === "hilltop" ? 30 : 1); k++) {
          const a = rand() * Math.PI * 2;
          const r = 22 + rand() * 70;
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          const y = h(x, z);
          if (shoreRadius(x, z) - Math.hypot(x, z) < 20 || islandZoneAt(x, z) !== "beach" || y < 1 || y > 11) continue;
          if (!free(x, z) || world.structureAt(x, z)) continue;
          if (y > bestH) {
            best = at(x, z);
            bestH = y;
          }
        }
        if (best) return best;
        break;
      }
      case "volcano": {
        const a = rand() * Math.PI * 2;
        const d = VOLCANO.craterRadius + 8 + rand() * (VOLCANO.radius - 12);
        const x = VOLCANO.x + Math.cos(a) * d;
        const z = VOLCANO.z + Math.sin(a) * d;
        const y = h(x, z);
        if (y > 1 && y < 22 && free(x, z)) return at(x, z);
        break;
      }
      case "lake": {
        const a = rand() * Math.PI * 2;
        const r = LAKE.radius + 3 + rand() * 5;
        const x = LAKE.x + Math.cos(a) * r;
        const z = LAKE.z + Math.sin(a) * r;
        if (h(x, z) > 0.3 && free(x, z)) return at(x, z);
        break;
      }
      case "lake_bed":
      case "lake_water": {
        const a = rand() * Math.PI * 2;
        const r = rand() * (LAKE.radius - 5);
        const x = LAKE.x + Math.cos(a) * r;
        const z = LAKE.z + Math.sin(a) * r;
        if (h(x, z) < -1.2) return at(x, z);
        break;
      }
      case "palm": {
        const p = rand.pick(world.palms);
        const away = Math.atan2(p.z, p.x) + (rand() - 0.5);
        const x = p.x + Math.cos(away) * 1.3;
        const z = p.z + Math.sin(away) * 1.3;
        if (h(x, z) > 0.3 && free(x, z)) return at(x, z);
        break;
      }
      case "shallows": {
        let x: number;
        let z: number;
        if (world.islets.length > 0 && rand() < 0.35) {
          const it = rand.pick(world.islets);
          const a = rand() * Math.PI * 2;
          const d = it.radius + 3 + rand() * 10;
          x = it.x + Math.cos(a) * d;
          z = it.z + Math.sin(a) * d;
        } else {
          const a = rand() * Math.PI * 2;
          const d = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100) + 3 + rand() * 14;
          x = Math.cos(a) * d;
          z = Math.sin(a) * d;
        }
        const y = h(x, z);
        if (y < -0.9 && y > -3.5 && free(x, z)) return at(x, z);
        break;
      }
      case "reef": {
        if (world.reefs.length === 0) return null;
        const r = rand.pick(world.reefs);
        const a = rand() * Math.PI * 2;
        const d = rand() * r.radius * 0.6;
        const x = r.x + Math.cos(a) * d;
        const z = r.z + Math.sin(a) * d;
        if (h(x, z) < -1.2 && free(x, z)) return at(x, z);
        break;
      }
      case "sea":
      case "seabed": {
        const a = rand() * Math.PI * 2;
        const d = 135 + rand() * (MAP_HALF_SIZE - 150);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (Math.abs(x) > MAP_HALF_SIZE - 15 || Math.abs(z) > MAP_HALF_SIZE - 15) break;
        if (h(x, z) > -7.5 || world.islets.some((it) => isletEdge(it, x, z) > -14)) break;
        if (free(x, z)) return at(x, z);
        break;
      }
      case "islet": {
        if (world.islets.length === 0) return null;
        const it = rand.pick(world.islets);
        const a = rand() * Math.PI * 2;
        const r = it.radius * rand() * 0.75;
        const x = it.x + Math.cos(a) * r;
        const z = it.z + Math.sin(a) * r;
        if (isletEdge(it, x, z) > 2 && h(x, z) > 0.45 && free(x, z) && !world.structureAt(x, z)) return at(x, z);
        break;
      }
      case "cave":
        return inside("cave", false);
      case "cave_deep":
        return inside("cave", true);
      case "mine":
        return inside("mine", false);
      case "mine_deep":
        return inside("mine", true);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Easter egg, điểm bất thường, sinh vật
// ---------------------------------------------------------------------------

function weightedIndex(rand: Rand, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

function generatePois(rand: Rand, world: World, catalog: WorldCatalog): Poi[] {
  const pois: Poi[] = [];
  const taken = new Set<string>();
  const defs = rand.shuffle([...catalog.pois.values()]);
  // Mỗi ván vắng mặt vài easter egg và vài điểm bất thường, để ván sau vẫn còn thứ để tìm.
  const eggs = defs.filter((d) => d.kind === "egg");
  const anomalies = defs.filter((d) => d.kind === "anomaly");
  const chosen = [...eggs.slice(0, Math.max(10, eggs.length - rand.int(1, 3))), ...anomalies.slice(0, rand.int(5, Math.min(7, anomalies.length)))];

  for (const def of chosen) {
    let spot: Spot | null = null;
    let habitat: Habitat = def.habitats[0]!;
    for (const hab of rand.shuffle(def.habitats)) {
      for (let tries = 0; tries < 6 && !spot; tries++) {
        const s = sampleHabitat(rand, world, hab, taken);
        if (s && (s.structure || pois.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 14))) {
          spot = s;
          habitat = hab;
        }
      }
      if (spot) break;
    }
    if (!spot) continue;
    if (spot.structure) taken.add(`${spot.structure.id}:${spot.cell}`);
    const outcome = def.outcomes ? weightedIndex(rand, def.outcomes.map((o) => o.weight)) : -1;
    pois.push({
      id: `poi${pois.length}`,
      defId: def.id,
      kind: def.kind,
      x: spot.x,
      y: spot.structure ? spot.structure.floor : world.heightAt(spot.x, spot.z),
      z: spot.z,
      rot: spot.structure ? spot.structure.rot : rand() * Math.PI * 2,
      outcome,
      day: def.oneDay ? rand.int(2, 8) : 0,
      habitat,
      structure: spot.structure?.id ?? null,
    });
  }
  return pois;
}

/** Bán kính lang thang quanh chỗ sinh ra, theo môi trường sống. */
const RANGE: Partial<Record<Habitat, number>> = {
  beach: 16,
  forest: 20,
  volcano: 16,
  islet: 12,
  shallows: 12,
  reef: 10,
  sea: 34,
  lake_water: 7,
};

function generateSpawns(rand: Rand, world: World, catalog: WorldCatalog): CreatureSpawn[] {
  const spawns: CreatureSpawn[] = [];
  for (const species of catalog.creatures.values()) {
    const count = rand.int(species.count[0], species.count[1]);
    for (let n = 0; n < count; n++) {
      const habitat = rand.pick(species.habitats);
      const spot = sampleHabitat(rand, world, habitat);
      if (!spot) continue;
      spawns.push({
        id: `c${spawns.length}`,
        species: species.id,
        habitat,
        x: spot.x,
        z: spot.z,
        range: spot.structure ? 0 : (RANGE[habitat] ?? 12),
        structure: spot.structure?.id ?? null,
      });
    }
  }
  return spawns;
}

// ---------------------------------------------------------------------------
// Bẫy (seed bí mật của server)
// ---------------------------------------------------------------------------

/** Bán kính giẫm phải bẫy. */
export const TRAP_RADIUS = 1.3;

/**
 * Rải bẫy theo một seed riêng mà chỉ server biết: client biết seed thế giới nhưng không biết bẫy nằm đâu,
 * cho tới khi có người sập bẫy (server mới công khai chỗ đó).
 */
export function generateTraps(world: World, secretSeed: number, catalog: WorldCatalog = worldCatalog): Trap[] {
  const rand = makeRand(subSeed(secretSeed, "traps"));
  const defs = [...catalog.traps.values()];
  const traps: Trap[] = [];
  const taken = new Set<string>();
  const count = rand.int(12, 16);
  for (let attempt = 0; traps.length < count && attempt < count * 8; attempt++) {
    const def = rand.pick(defs);
    const habitat = rand.pick(def.habitats);
    const spot = sampleHabitat(rand, world, habitat, taken);
    if (!spot) continue;
    if (traps.some((t) => Math.hypot(t.x - spot.x, t.z - spot.z) < 12)) continue;
    if (world.pois.some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < 5)) continue;
    if (spot.structure) taken.add(`${spot.structure.id}:${spot.cell}`);
    traps.push({
      id: `trap${traps.length}`,
      defId: def.id,
      x: spot.x,
      y: spot.structure ? spot.structure.floor : world.heightAt(spot.x, spot.z),
      z: spot.z,
      radius: TRAP_RADIUS,
      habitat,
    });
  }
  return traps;
}

/** Cơ hội né bẫy theo thuộc tính (mỗi điểm 8%, tối đa 45%). */
export function trapDodgeChance(stats: Partial<Record<StatId, number>>, stat: StatId): number {
  return Math.min(0.45, 0.08 * (stats[stat] ?? 0));
}

// ---------------------------------------------------------------------------
// Bộ nhớ đệm: mỗi seed chỉ sinh một lần.
// ---------------------------------------------------------------------------

const cache = new Map<number, World>();

export function worldFor(seed: number): World {
  let world = cache.get(seed);
  if (!world) {
    world = generateWorld(seed);
    cache.set(seed, world);
    // Giữ vài thế giới gần nhất (chủ phòng có thể đổi seed nhiều lần ở sảnh chờ).
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  return world;
}
