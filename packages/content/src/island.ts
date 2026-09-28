// Bản đồ đảo graybox: hàm độ cao địa hình và các vùng.
// Client dựng mesh địa hình từ heightAt(), server dùng cùng hàm này để đặt điểm hồi sinh
// và biết người chơi đang ở vùng nào. Map cố định; thứ xáo theo seed sẽ nằm ở chỗ khác.
// Đơn vị: mét. Trục x hướng đông, trục z hướng nam (trại ở phía nam).

import { nextFloat, type RngState, type ZoneId } from "@tentides/rules";

export const WATER_LEVEL = 0;
export const MAP_HALF_SIZE = 150;

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
    h = -6 * smoothstep(0, 20, -inland);
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
