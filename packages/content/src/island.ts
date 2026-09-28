// Đảo chính: hàm độ cao địa hình và các vùng, cố định qua mọi ván (người chơi thuộc map vẫn là lợi thế).
// Những thứ xáo theo seed (đảo nhỏ, rạn san hô, hang, hầm mỏ, easter egg, sinh vật, bẫy) nằm trong worldgen.ts;
// client và server nên dùng `world.heightAt()` của thế giới đã sinh, hàm ở đây chỉ là nền của đảo chính.
// Đơn vị: mét. Trục x hướng đông, trục z hướng nam (trại ở phía nam).

import { nextFloat, type AnchorDef, type RngState, type ZoneId } from "@tentides/rules";

export const WATER_LEVEL = 0;
/** Nửa cạnh của cả vùng biển chơi được (đảo chính, đảo nhỏ quanh đó và biển sâu). */
export const MAP_HALF_SIZE = 240;

export const CAMP = { x: 0, z: 80 } as const;
export const LAKE = { x: -45, z: 5, radius: 16 } as const;
export const CAVE = { x: 52, z: -18, radius: 12 } as const;
export const VOLCANO = { x: -5, z: -62, radius: 42, height: 26, craterRadius: 7 } as const;

export const ZONE_LABELS: Record<ZoneId, string> = {
  beach: "Bãi biển & rừng dừa",
  lake: "Hồ nước ngọt",
  cave: "Hang động",
  volcano: "Núi lửa",
};

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

/** Bán kính bờ biển theo hướng, để đảo không tròn vành vạnh. */
export function shoreRadius(x: number, z: number): number {
  const angle = Math.atan2(z, x);
  return 100 + 8 * Math.sin(3 * angle) + 5 * Math.sin(5 * angle + 1);
}

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const inland = shoreRadius(x, z) - r;

  let h: number;
  if (inland < 0) {
    // Thềm cát thoai thoải rồi dốc xuống biển sâu, đáy gợn sóng nhẹ cho lặn đỡ đơn điệu.
    const off = -inland;
    h = -6 * smoothstep(0, 20, off) - 9 * smoothstep(22, 110, off);
    h += 0.8 * Math.sin(x * 0.05 + Math.cos(z * 0.03)) * Math.cos(z * 0.045) * smoothstep(20, 45, off);
  } else {
    h = 1.2 * smoothstep(0, 15, inland) + 1.8 * smoothstep(15, 45, inland);
    h += 1.5 * Math.sin(x * 0.07) * Math.cos(z * 0.06) * smoothstep(20, 50, inland);
  }

  // Sống núi đá phía sau hang.
  const ridge = Math.hypot((x - (CAVE.x + 8)) / 1.6, z - (CAVE.z - 16));
  h += 12 * smoothstep(24, 4, ridge);

  // Mặt bằng trước cửa hang.
  h = lerp(h, 3, smoothstep(CAVE.radius + 8, CAVE.radius, Math.hypot(x - CAVE.x, z - CAVE.z)));

  // Lòng hồ trũng xuống dưới mực nước.
  h = lerp(h, -2.5, smoothstep(LAKE.radius + 6, LAKE.radius - 4, Math.hypot(x - LAKE.x, z - LAKE.z)));

  // Núi lửa và miệng núi.
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  h += VOLCANO.height * smoothstep(VOLCANO.radius, 0, dv);
  h -= 6 * smoothstep(VOLCANO.craterRadius, 0, dv);

  return h;
}

export function zoneAt(x: number, z: number): ZoneId {
  if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.radius + 3) return "volcano";
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 10) return "lake";
  if (Math.hypot(x - CAVE.x, z - CAVE.z) < CAVE.radius + 14) return "cave";
  return "beach";
}

/** Điểm xuất phát của người chơi thứ `index`, xếp vòng quanh đống lửa ở trại. */
export function spawnPoint(index: number): { x: number; y: number; z: number } {
  const angle = (index / 6) * Math.PI * 2;
  const x = CAMP.x + Math.cos(angle) * 4;
  const z = CAMP.z + Math.sin(angle) * 4;
  return { x, y: heightAt(x, z) + 1.5, z };
}

export interface Palm {
  x: number;
  z: number;
  height: number;
  lean: number;
}

/** Rừng dừa dọc bờ biển. Vị trí cố định (seed riêng của map, không đổi giữa các ván). */
function generatePalms(count: number, seed: RngState): Palm[] {
  const palms: Palm[] = [];
  let rng = seed;
  const next = () => {
    const r = nextFloat(rng);
    rng = r.rng;
    return r.value;
  };
  let attempts = 0;
  while (palms.length < count && attempts < count * 20) {
    attempts++;
    const angle = next() * Math.PI * 2;
    const x0 = Math.cos(angle);
    const z0 = Math.sin(angle);
    const r = shoreRadius(x0 * 100, z0 * 100) - 8 - next() * 30;
    const x = x0 * r;
    const z = z0 * r;
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < 14) continue;
    if (zoneAt(x, z) !== "beach") continue;
    if (heightAt(x, z) < 0.6) continue;
    if (palms.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    palms.push({ x, z, height: 6 + next() * 3, lean: (next() - 0.5) * 0.4 });
  }
  return palms;
}

export const PALMS: readonly Palm[] = generatePalms(48, 20260925);

/** Bán kính để mở thẻ tại một điểm sự kiện, và bán kính để được tính là "đang đứng đó". */
export const ANCHOR_TRIGGER_RADIUS = 3.5;
export const ANCHOR_PARTICIPANT_RADIUS = 7;
/** Ở trong bán kính này quanh đống lửa khi trời tối thì tính là đã về trại. */
export const CAMP_RADIUS = 12;

export interface Anchor extends AnchorDef {
  x: number;
  y: number;
  z: number;
}

function beachPoint(angleDeg: number, inset: number): { x: number; z: number } {
  const a = (angleDeg * Math.PI) / 180;
  const r = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100) - inset;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function anchor(id: string, type: string, at: { x: number; z: number }, y = heightAt(at.x, at.z)): Anchor {
  return { id, type, zone: zoneAt(at.x, at.z), x: at.x, y, z: at.z };
}

/** Các điểm sự kiện cố định. Mỗi sáng engine chọn thẻ hợp loại điểm để đặt vào. */
export const ANCHORS: readonly Anchor[] = [
  anchor("grove_east", "coconut_grove", beachPoint(20, 22)),
  anchor("grove_south", "coconut_grove", beachPoint(60, 20)),
  anchor("grove_west", "coconut_grove", beachPoint(160, 22)),
  anchor("shore_southwest", "shore_drift", beachPoint(125, 6)),
  anchor("shore_northeast", "shore_drift", beachPoint(-30, 6)),
  anchor("lake_east", "lake_shore", { x: LAKE.x + 19, z: LAKE.z }),
  anchor("lake_west", "lake_shore", { x: LAKE.x - 18, z: LAKE.z - 6 }),
  anchor("cave_mouth", "cave_mouth", { x: CAVE.x, z: CAVE.z + 8 }),
  anchor("cave_tunnel", "cave_tunnel", { x: CAVE.x - 2, z: CAVE.z - 6 }, 3),
  anchor("slope_south", "volcano_slope", { x: VOLCANO.x, z: VOLCANO.z + 25 }),
  anchor("slope_west", "volcano_slope", { x: VOLCANO.x - 25, z: VOLCANO.z }),
  anchor("crater_rim", "crater_rim", { x: VOLCANO.x, z: VOLCANO.z + 9 }),
];

/** Bán kính đứng đào quanh chỗ giấu kho báu. */
export const DIG_RADIUS = 3;

export interface TreasureSite {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

function site(id: string, label: string, at: { x: number; z: number }): TreasureSite {
  return { id, label, x: at.x, y: heightAt(at.x, at.z), z: at.z };
}

/** Các chỗ kho báu có thể nằm. Mỗi ván chọn một theo seed; tiến độ đủ 100 mới lộ ra là chỗ nào. */
export const TREASURE_SITES: readonly TreasureSite[] = [
  site("under_old_palm", "Gốc dừa già phía đông", beachPoint(5, 30)),
  site("north_shore_rocks", "Bãi đá phía bắc", beachPoint(-80, 14)),
  site("lake_island_edge", "Bờ tây hồ", { x: LAKE.x - 10, z: LAKE.z + 17 }),
  site("behind_cave", "Sau lưng hang", { x: CAVE.x + 14, z: CAVE.z + 2 }),
  site("volcano_foot", "Chân núi lửa phía đông", { x: VOLCANO.x + 34, z: VOLCANO.z + 10 }),
  site("west_cove", "Vịnh nhỏ phía tây", beachPoint(185, 12)),
  site("south_dunes", "Đụn cát phía nam", beachPoint(110, 10)),
];

export interface GrassPatch {
  x: number;
  z: number;
  radius: number;
}

/**
 * Các đám cỏ cao (cao hơn người ngồi, thấp hơn người đứng). Ngồi xuống trong đám cỏ là nấp:
 * người khác không thấy tên và chấm của mình trên bản đồ. Vị trí cố định theo seed của map để
 * mọi máy tính ra cùng một kết quả. Tránh trại, điểm sự kiện và chỗ giấu kho báu.
 */
function generateTallGrass(count: number, seed: RngState): GrassPatch[] {
  const patches: GrassPatch[] = [];
  let rng = seed;
  const next = () => {
    const r = nextFloat(rng);
    rng = r.rng;
    return r.value;
  };
  const clear = (x: number, z: number, radius: number) =>
    Math.hypot(x - CAMP.x, z - CAMP.z) > CAMP_RADIUS + radius + 4 &&
    ANCHORS.every((a) => Math.hypot(a.x - x, a.z - z) > radius + 5) &&
    TREASURE_SITES.every((t) => Math.hypot(t.x - x, t.z - z) > radius + 4) &&
    patches.every((p) => Math.hypot(p.x - x, p.z - z) > p.radius + radius + 3);

  // Lau sậy quanh bờ hồ.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const radius = 3 + next() * 1.5;
    const x = LAKE.x + Math.cos(a) * (LAKE.radius + 5);
    const z = LAKE.z + Math.sin(a) * (LAKE.radius + 5);
    if (heightAt(x, z) > 0.3 && clear(x, z, radius)) patches.push({ x, z, radius });
  }
  // Đám cỏ tranh rải khắp vùng đất trong đảo.
  for (let attempts = 0; patches.length < count && attempts < count * 40; attempts++) {
    const angle = next() * Math.PI * 2;
    const x0 = Math.cos(angle);
    const z0 = Math.sin(angle);
    const r = 20 + next() * 70;
    const x = x0 * r;
    const z = z0 * r;
    const radius = 3.5 + next() * 4;
    const inland = shoreRadius(x, z) - Math.hypot(x, z);
    if (inland < 16 || zoneAt(x, z) === "volcano" || heightAt(x, z) < 0.8 || heightAt(x, z) > 7) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 3) continue;
    if (!clear(x, z, radius)) continue;
    patches.push({ x, z, radius });
  }
  return patches;
}

export const TALL_GRASS: readonly GrassPatch[] = generateTallGrass(30, 20260928);

/** Đang đứng trong lõi một đám cỏ cao (mép đám cỏ thưa, chưa đủ che). */
export function inTallGrass(x: number, z: number): boolean {
  return TALL_GRASS.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius * 0.85);
}
