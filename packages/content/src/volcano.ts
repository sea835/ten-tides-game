// Núi lửa leo thang của chế độ sinh tồn. Lịch leo thang suy ra từ mức núi lửa có sẵn trong state (`volcano`,
// engine luật tăng 10 mỗi ngày, cộng thêm nếu ván có biến cố "núi lửa tỉnh giấc sớm"), nên không thêm trường nào:
//   ngày 1–4  (mức < 45): khói mỏng, yên bình;
//   ngày 5–7  (mức 45–74): động đất từng đợt làm nứt đất, mưa tro phủ mờ tầm nhìn, suối nước nóng sôi sục (bỏng);
//   ngày 8–10 (mức ≥ 75): phun trào, bom nham thạch rơi ngẫu nhiên (server tính sát thương, để lại hố lửa), dòng
//   dung nham chảy tràn xuống sườn chặn bớt lối đi, ngày càng dài ra trong ngày.
// Dòng dung nham sinh theo seed thế giới và ngày, nên server và client dựng ra giống nhau mà không cần đồng bộ.

import { ANCHORS, VOLCANO } from "./island.ts";
import { makeRand, subSeed, type World } from "./worldgen.ts";

export type VolcanoStage = 0 | 1 | 2 | 3;

/** Mức núi lửa bắt đầu rung chuyển (ngày 5) và phun trào (ngày 8). */
export const UNREST_LEVEL = 45;
export const ERUPTION_LEVEL = 75;

/** 0: chưa vào ván · 1: khói mỏng · 2: động đất, mưa tro, suối sôi · 3: phun trào. */
export function volcanoStage(level: number): VolcanoStage {
  if (level >= ERUPTION_LEVEL) return 3;
  if (level >= UNREST_LEVEL) return 2;
  return level > 0 ? 1 : 0;
}

/** Độ dày mưa tro (0–1) theo mức núi lửa: chưa có trước ngày 5, dày dần tới lúc phun trào. */
export function ashAmount(level: number): number {
  const stage = volcanoStage(level);
  if (stage < 2) return 0;
  return Math.min(1, 0.35 + ((level - UNREST_LEVEL) / (99 - UNREST_LEVEL)) * 0.65);
}

/** Khoảng giây giữa hai đợt động đất (server phát): ngày 5–7 thưa, phun trào thì dồn dập. */
export function quakeInterval(level: number): [number, number] {
  const stage = volcanoStage(level);
  if (stage === 3) return [12, 22];
  if (stage === 2) return [24, 45];
  return [Infinity, Infinity];
}

// ---------------------------------------------------------------------------
// Bom nham thạch
// ---------------------------------------------------------------------------

/** Bom bay mất chừng này giây từ miệng núi tới chỗ rơi (bóng đỏ báo trước dưới đất để kịp chạy). */
export const BOMB_FLIGHT = 3.2;
/** Bán kính nổ, sát thương ở tâm (giảm dần ra mép). */
export const BOMB_RADIUS = 4.5;
export const BOMB_DAMAGE = 30;
/** Hố lửa bom để lại: cháy chừng này giây, đứng trong đó thì bỏng từng nhịp. */
export const CRATER_RADIUS = 2.2;
export const CRATER_SECONDS = 40;
export const CRATER_BURN = 6;
export const CRATER_BURN_INTERVAL = 1.2;

/** Số giây giữa hai quả bom: mức 75 thưa (9 s), cuối ván (mức 99) dồn dập (3,5 s). Chưa phun trào thì không có. */
export function bombInterval(level: number): number {
  if (volcanoStage(level) < 3) return Infinity;
  const k = Math.min(1, Math.max(0, (level - ERUPTION_LEVEL) / (99 - ERUPTION_LEVEL)));
  return 9 - 5.5 * k;
}

/** Sát thương của bom ở khoảng cách `d` từ tâm nổ (0 khi ngoài bán kính). */
export function bombDamage(d: number): number {
  if (d >= BOMB_RADIUS) return 0;
  return Math.round(BOMB_DAMAGE * (1 - 0.7 * (d / BOMB_RADIUS)));
}

// ---------------------------------------------------------------------------
// Suối nước nóng
// ---------------------------------------------------------------------------

const SPRING = ANCHORS.find((a) => a.type === "hot_spring")!;
/** Vũng suối nước nóng (client vẽ lệch khỏi điểm sự kiện một chút, xem Landmarks.tsx). */
export const HOT_SPRING = { x: SPRING.x + 3, z: SPRING.z + 1, radius: 2.6 } as const;
/** Suối sôi (từ ngày 5): ngâm mình trong đó thì bỏng từng nhịp. */
export const SPRING_BURN = 5;
export const SPRING_BURN_INTERVAL = 1.5;

export function springBoiling(level: number): boolean {
  return volcanoStage(level) >= 2;
}

// ---------------------------------------------------------------------------
// Dòng dung nham
// ---------------------------------------------------------------------------

export interface LavaFlow {
  id: string;
  /** Đường giữa dòng, từ miệng núi xuống chân núi (x, y, z theo mặt đất). */
  points: readonly { x: number; y: number; z: number }[];
  width: number;
}

/** Bước đi của dòng chảy (mét) và số bước tối đa. */
const FLOW_STEP = 2.5;
const FLOW_STEPS = 34;
/** Dòng dung nham dừng khi xuống thấp tới độ cao này hay ra quá xa chân núi. */
const FLOW_MIN_HEIGHT = 3;
const FLOW_MAX_REACH = VOLCANO.radius + 16;

/** Số dòng dung nham đang chảy hôm nay: ngày 8 một dòng, ngày 9 hai, ngày 10 ba (chỉ khi đã phun trào). */
export function flowCount(day: number, level: number): number {
  if (volcanoStage(level) < 3) return 0;
  return Math.min(3, Math.max(1, day - 7));
}

/** Dòng dung nham dài dần trong ngày: sáng sớm mới chảy 35%, tới hoàng hôn tràn hết chiều dài. */
export function flowProgress(time: number): number {
  return Math.min(1, 0.35 + 0.65 * Math.min(1, Math.max(0, time / 0.72)));
}

const flowCache = new Map<string, readonly LavaFlow[]>();

/**
 * Các dòng dung nham của ngày `day` trên thế giới này: mỗi dòng bắt đầu ở mép miệng núi (hướng theo seed), rồi bò
 * xuống theo hướng dốc nhất của địa hình (thêm chút uốn lượn) tới khi gặp đất thấp hay ra khỏi chân núi.
 */
export function lavaFlows(world: World, day: number, level: number): readonly LavaFlow[] {
  const count = flowCount(day, level);
  if (count === 0 || world.kind === "battle") return [];
  const key = `${world.seed}:${day}:${count}`;
  const cached = flowCache.get(key);
  if (cached) return cached;
  const out: LavaFlow[] = [];
  for (let k = 0; k < count; k++) {
    // Mỗi dòng có luồng random riêng theo (seed, thứ tự): dòng của hôm qua vẫn chảy đúng chỗ cũ hôm nay.
    const rand = makeRand(subSeed(world.seed, `lava:${k}`));
    let angle = rand() * Math.PI * 2;
    // Dòng sau tránh hướng của các dòng trước.
    for (let tries = 0; tries < 8 && out.some((f) => angleGap(f, angle) < 0.9); tries++) angle = rand() * Math.PI * 2;
    let x = VOLCANO.x + Math.cos(angle) * (VOLCANO.craterRadius + 2);
    let z = VOLCANO.z + Math.sin(angle) * (VOLCANO.craterRadius + 2);
    let dx = Math.cos(angle);
    let dz = Math.sin(angle);
    const points = [{ x, y: world.heightAt(x, z), z }];
    for (let i = 0; i < FLOW_STEPS; i++) {
      const e = 1.5;
      const gx = world.heightAt(x + e, z) - world.heightAt(x - e, z);
      const gz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
      const g = Math.hypot(gx, gz) || 1;
      // Xuôi dốc, giữ đà hướng cũ, uốn lượn chút ít.
      const wobble = (rand() - 0.5) * 0.6;
      let nx = dx * 0.55 - (gx / g) * 0.45;
      let nz = dz * 0.55 - (gz / g) * 0.45;
      const c = Math.cos(wobble);
      const s = Math.sin(wobble);
      [nx, nz] = [nx * c - nz * s, nx * s + nz * c];
      const n = Math.hypot(nx, nz) || 1;
      dx = nx / n;
      dz = nz / n;
      x += dx * FLOW_STEP;
      z += dz * FLOW_STEP;
      const y = world.heightAt(x, z);
      points.push({ x, y, z });
      if (y < FLOW_MIN_HEIGHT || Math.hypot(x - VOLCANO.x, z - VOLCANO.z) > FLOW_MAX_REACH) break;
    }
    out.push({ id: `flow${k}`, points, width: 2.6 + rand() * 1.2 });
  }
  flowCache.set(key, out);
  return out;
}

function angleGap(flow: LavaFlow, angle: number): number {
  const p = flow.points[0]!;
  const a = Math.atan2(p.z - VOLCANO.z, p.x - VOLCANO.x);
  return Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle)));
}

/** Số điểm của dòng đã chảy tới, theo tiến độ trong ngày (0–1). */
export function flowReach(flow: LavaFlow, progress: number): number {
  return Math.max(2, Math.ceil(flow.points.length * Math.min(1, Math.max(0, progress))));
}

/** Điểm (x, z) có nằm trên phần đã chảy tới của một dòng dung nham không. */
export function onLavaFlow(flows: readonly LavaFlow[], x: number, z: number, progress: number): boolean {
  for (const f of flows) {
    const n = flowReach(f, progress);
    for (let i = 1; i < n; i++) {
      const a = f.points[i - 1]!;
      const b = f.points[i]!;
      if (segmentDistance(x, z, a.x, a.z, b.x, b.z) < f.width / 2) return true;
    }
  }
  return false;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len = vx * vx + vz * vz || 1;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / len));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** Dòng dung nham: lội vào thì bỏng nặng từng nhịp (không chết ngay như hồ dung nham). */
export const FLOW_BURN = 12;
export const FLOW_BURN_INTERVAL = 0.8;

/** Vết nứt do động đất (chỉ là hình ảnh): vị trí theo seed thế giới, quanh chân núi và trên đảo. */
export function quakeCracks(world: World, count = 18): readonly { x: number; z: number; rot: number; length: number }[] {
  const rand = makeRand(subSeed(world.seed, "cracks"));
  const out: { x: number; z: number; rot: number; length: number }[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 10; attempt++) {
    const a = rand() * Math.PI * 2;
    const r = VOLCANO.radius * (0.55 + rand() * 1.4);
    const x = VOLCANO.x + Math.cos(a) * r;
    const z = VOLCANO.z + Math.sin(a) * r;
    if (world.heightAt(x, z) < 1 || world.structureAt(x, z)) continue;
    out.push({ x, z, rot: rand() * Math.PI, length: 4 + rand() * 7 });
  }
  return out;
}

/** Tên các mối nguy của núi lửa leo thang và những chỗ lộ ra khi triều rút (không nằm trong danh mục nào). */
export const SURVIVAL_THINGS: Record<string, string> = {
  lava_bomb: "bom nham thạch",
  lava_flow: "dòng dung nham",
  lava_crater: "hố lửa",
  hot_spring: "suối nước nóng sôi sục",
  flood_tide: "triều cường",
  tidal_wreck: "cổ vật trong xác tàu đắm",
  tidal_cave: "rương trong hang ngầm",
  tidal_reef: "cổ vật trên rạn san hô",
};
