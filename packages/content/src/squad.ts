// Chế độ Đồng đội (Battleground kiểu Arma) và những thứ dùng chung giữa server và client: thân người khi đứng, ngồi
// xổm, nằm sấp (để dò đạn trúng khớp nhau), vai trò trong đội, xe tăng.

import { boxAt, type BattleMap } from "./battle.ts";

type V3 = readonly [number, number, number];

/** Tư thế thân người để dò đạn: chân ở (x, y, z), mặt nhìn theo rotY (hướng (sin rotY, cos rotY)). */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  rotY: number;
  crouch: boolean;
  prone: boolean;
}

/** Nằm sấp: thân là một khối trụ nằm dọc từ gót (sau hông) tới vai, đầu ở trước vai; tất cả sát đất. */
export const PRONE = {
  /** Gót chân và vai tính theo hướng mặt (m, âm là phía sau chỗ đứng). */
  back: -0.95,
  front: 0.5,
  /** Độ cao trục thân, bán kính thân. */
  y: 0.2,
  r: 0.24,
  /** Tâm đầu: trước chỗ đứng, cao hơn đất; bán kính đầu. */
  headFwd: 0.78,
  headY: 0.32,
  headR: 0.15,
} as const;

/** Tốc độ bò (m/s) khi nằm sấp, và thời gian nằm xuống / đứng dậy (giây). */
export const PRONE_SPEED = 1.25;
export const PRONE_TIME = 0.55;

/** Khoảng cách gần nhất giữa tia (o, d đơn vị, từ 0) và đoạn thẳng [a, b]: trả tham số t trên tia và khoảng cách. */
function raySegment(o: V3, d: V3, a: V3, b: V3): { t: number; dist: number } {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const wx = o[0] - a[0];
  const wy = o[1] - a[1];
  const wz = o[2] - a[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const B = d[0] * ux + d[1] * uy + d[2] * uz;
  const C = ux * ux + uy * uy + uz * uz;
  const D = d[0] * wx + d[1] * wy + d[2] * wz;
  const E = ux * wx + uy * wy + uz * wz;
  const den = A * C - B * B;
  let s = den > 1e-9 ? (A * E - B * D) / den : 0;
  s = Math.max(0, Math.min(1, s));
  let t = (B * s - D) / A;
  if (t < 0) t = 0;
  const px = o[0] + d[0] * t - (a[0] + ux * s);
  const py = o[1] + d[1] * t - (a[1] + uy * s);
  const pz = o[2] + d[2] * t - (a[2] + uz * s);
  return { t, dist: Math.hypot(px, py, pz) };
}

/** Khoảng cách từ điểm p tới đoạn thẳng [a, b]. */
function pointSegment(p: V3, a: V3, b: V3): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const L = ux * ux + uy * uy + uz * uz || 1;
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy + (p[2] - a[2]) * uz) / L));
  return Math.hypot(p[0] - a[0] - ux * k, p[1] - a[1] - uy * k, p[2] - a[2] - uz * k);
}

function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const q = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - q;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

/** Tâm đầu và hai đầu trục thân khi nằm sấp. */
export function proneParts(b: BodyPose): { head: [number, number, number]; a: [number, number, number]; c: [number, number, number] } {
  const fx = Math.sin(b.rotY);
  const fz = Math.cos(b.rotY);
  return {
    head: [b.x + fx * PRONE.headFwd, b.y + PRONE.headY, b.z + fz * PRONE.headFwd],
    a: [b.x + fx * PRONE.back, b.y + PRONE.y, b.z + fz * PRONE.back],
    c: [b.x + fx * PRONE.front, b.y + PRONE.y, b.z + fz * PRONE.front],
  };
}

/**
 * Tia (gốc o, hướng d đơn vị) gặp thân người ở tư thế `b`: đứng, ngồi xổm là trụ đứng bán kính 0,3 cộng đầu cầu;
 * nằm sấp là trụ nằm dọc sát đất cộng đầu ở phía trước. Trả khoảng cách và phần trúng, hoặc null.
 */
export function rayBody(o: V3, d: V3, b: BodyPose): { t: number; part: "head" | "body" } | null {
  if (b.prone) {
    const { head, a, c } = proneParts(b);
    let best: { t: number; part: "head" | "body" } | null = null;
    const th = raySphere(o, d, head, PRONE.headR);
    if (th !== null) best = { t: th, part: "head" };
    const seg = raySegment(o, d, a, c);
    if (seg.dist < PRONE.r) {
      const t = Math.max(0, seg.t - Math.sqrt(PRONE.r * PRONE.r - seg.dist * seg.dist));
      if (t > 0 && (!best || t < best.t)) best = { t, part: "body" };
    }
    return best;
  }
  const headY = b.y + (b.crouch ? 1.12 : 1.62);
  let best: { t: number; part: "head" | "body" } | null = null;
  const th = raySphere(o, d, [b.x, headY, b.z], 0.15);
  if (th !== null) best = { t: th, part: "head" };
  // Thân: trụ đứng bán kính 0,3 từ chân tới vai.
  const top = b.y + (b.crouch ? 0.98 : 1.46);
  const ox = o[0] - b.x;
  const oz = o[2] - b.z;
  const aa = d[0] * d[0] + d[2] * d[2];
  if (aa > 1e-8) {
    const bq = ox * d[0] + oz * d[2];
    const cc = ox * ox + oz * oz - 0.3 * 0.3;
    const disc = bq * bq - aa * cc;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / aa;
      const y = o[1] + d[1] * t;
      if (t > 0 && y > b.y + 0.05 && y < top && (!best || t < best.t)) best = { t, part: "body" };
    }
  }
  return best;
}

/**
 * Server kiểm tra lại một điểm trúng (điểm đạn ở khoảng cách người bắn báo): có nằm sát thân người này không (nới
 * rộng một chút cho độ trễ mạng), và có phải trúng đầu không. Trả null nếu điểm quá xa thân.
 */
export function checkBodyPoint(p: V3, b: BodyPose, claimedHead: boolean): { head: boolean } | null {
  if (b.prone) {
    const { head, a, c } = proneParts(b);
    const toHead = Math.hypot(p[0] - head[0], p[1] - head[1], p[2] - head[2]);
    const toBody = pointSegment(p, a, c);
    // Người nằm bò chậm nên độ lệch do trễ mạng nhỏ: nới vừa đủ quanh thân nằm (không nhận điểm ngang ngực người đứng).
    if (toHead > 0.65 && toBody > 0.8) return null;
    return { head: claimedHead && toHead < 0.45 };
  }
  const height = b.crouch ? 1.25 : 1.8;
  if (Math.hypot(p[0] - b.x, p[2] - b.z) > 1.6 || p[1] < b.y - 0.5 || p[1] > b.y + height + 0.5) return null;
  return { head: claimedHead && p[1] > b.y + height - 0.55 };
}

// ---------------------------------------------------------------------------- đội, vai trò

/** Chế độ trận: solo (sinh tồn, người cuối cùng còn sống thắng) hay đồng đội (mỗi người dẫn 5 máy, kiểu Arma). */
export const BATTLE_MODES = ["solo", "squad"] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];

/** Mỗi người chơi được chừng này máy đi theo trong chế độ Đồng đội. */
export const SQUAD_BOTS = 5;
/** Số máy tối đa trong một phòng. */
export const MAX_BOTS = 50;

export type SquadRole = "leader" | "rifle" | "sniper" | "tanker" | "support" | "antitank";

/** Tên vai trò, súng mang theo, đồ kèm. Máy trong đội đủ vai: tay súng trường, bắn tỉa, xạ thủ súng máy, lái tăng. */
export const ROLES: Record<SquadRole, { name: string; guns: readonly string[]; sight: string; outfit?: string; extras: readonly string[] }> = {
  leader: { name: "Đội trưởng", guns: ["m416", "scar"], sight: "x2", extras: ["frag", "smoke", "bandage", "bandage"] },
  rifle: { name: "Tay súng trường", guns: ["m416", "akm", "scar"], sight: "reddot", extras: ["frag", "bandage", "bandage"] },
  sniper: { name: "Bắn tỉa", guns: ["kar98k", "sks"], sight: "x8", outfit: "ghillie", extras: ["smoke", "bandage"] },
  support: { name: "Súng máy", guns: ["m249"], sight: "holo", extras: ["smoke", "bandage", "bandage"] },
  tanker: { name: "Lái xe tăng", guns: ["ump45", "vector"], sight: "reddot", extras: ["bandage"] },
  antitank: { name: "Chống tăng", guns: ["ump45", "m416"], sight: "reddot", extras: ["rpg7", "ammo:rocket:6", "bandage", "bandage"] },
};

/** Thứ tự vai trò của 5 máy đi theo một người (hay đội máy: máy đầu tiên làm đội trưởng). */
export const SQUAD_ROLES: readonly SquadRole[] = ["rifle", "sniper", "tanker", "support", "antitank"];

/** Màu đội (tên, màu vẽ trên HUD, trên xe tăng). */
export const TEAM_COLORS = ["#3d8bff", "#ff5a4a", "#ffc233", "#3fcf6a", "#c46bff", "#ff8a2a", "#35d6d0", "#ff5fb0", "#a0a0a0", "#8fd14f"] as const;

// ---------------------------------------------------------------------------- xe tăng

/**
 * Xe tăng: máu, tốc độ tiến / lùi (m/s), tốc độ quay thân và tháp pháo (rad/s), kích thước thân (va chạm), pháo chính
 * (nạp đạn, sơ tốc, bán kính và sát thương nổ vào người, sát thương vào xe khác).
 */
export const TANK = {
  hp: 1000,
  forward: 8,
  reverse: 3.5,
  turn: 0.9,
  turret: 1.4,
  /** Nửa kích thước thân: ngang, cao, dọc. Gốc ở đáy thân, giữa xe. */
  half: [1.7, 1.2, 3.1] as const,
  /** Độ cao nòng pháo so với đáy xe, dài nòng (tính từ tâm tháp). */
  gunY: 2.05,
  barrel: 3.4,
  reload: 4.5,
  velocity: 260,
  radius: 6,
  damage: 140,
  armorDamage: 300,
  /** Góc nòng pháo ngẩng lên / chúc xuống tối đa (rad). */
  pitchUp: 0.35,
  pitchDown: -0.12,
  /** Đứng cách xe chừng này (m) thì bấm E lên xe được. */
  enter: 4.5,
  /** Súng, nổ gây bao nhiêu phần sát thương lên xe (thép dày): đạn thường gần như không xi nhê. */
  bulletFactor: 0.07,
  blastFactor: 1.4,
} as const;

/** Điểm nằm trong thân xe (hộp xoay theo hướng xe) không, nới thêm `pad`. */
export function insideTank(t: { x: number; y: number; z: number; rotY: number }, x: number, y: number, z: number, pad = 0): boolean {
  const dx = x - t.x;
  const dz = z - t.z;
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  // Trục dọc xe là (sin rotY, cos rotY), trục ngang (cos rotY, −sin rotY).
  const along = dx * s + dz * c;
  const across = dx * c - dz * s;
  return Math.abs(across) < TANK.half[0] + pad && Math.abs(along) < TANK.half[2] + pad && y > t.y - pad && y < t.y + TANK.half[1] * 2 + pad;
}

/** Tia gặp thân xe (hộp xoay theo rotY): trả khoảng cách hoặc Infinity. */
export function rayTank(t: { x: number; y: number; z: number; rotY: number }, o: V3, d: V3, max: number): number {
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  const rx = o[0] - t.x;
  const ry = o[1] - (t.y + TANK.half[1]);
  const rz = o[2] - t.z;
  const lo = [rx * c - rz * s, ry, rx * s + rz * c];
  const ld = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  let tmin = 0;
  let tmax = max;
  for (let k = 0; k < 3; k++) {
    const half = TANK.half[k]!;
    if (Math.abs(ld[k]!) < 1e-9) {
      if (Math.abs(lo[k]!) > half) return Infinity;
      continue;
    }
    let t1 = (-half - lo[k]!) / ld[k]!;
    let t2 = (half - lo[k]!) / ld[k]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Xe tăng đang đứng đâu, hướng nào (để tính một bước lái). */
export interface TankPose {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/**
 * Chỗ này xe tăng đứng được không: trên đất liền (không xuống nước), không quá dốc, bốn góc và mũi xe không đâm vào
 * tường nhà, container, bao cát (khối đặc cao hơn gầm xe).
 */
export function tankFits(map: BattleMap, x: number, z: number, rotY: number): boolean {
  const h = map.world.heightAt(x, z);
  if (h < 0.4) return false;
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  const [hw, , hl] = TANK.half;
  for (const [u, v] of [
    [hw, hl],
    [-hw, hl],
    [hw, -hl],
    [-hw, -hl],
    [0, hl + 0.3],
    [0, -hl - 0.3],
    [hw, 0],
    [-hw, 0],
  ] as const) {
    const px = x + c * u + s * v;
    const pz = z - s * u + c * v;
    const ph = map.world.heightAt(px, pz);
    if (ph < 0.2 || Math.abs(ph - h) > 3.2) return false;
    // Rào thép gai, biển báo, bao cát thấp thì xe cán qua; tường, nhà, container thì chặn.
    const box = boxAt(map.index, px, ph + 0.9, pz, 0.15) ?? boxAt(map.index, px, ph + 1.6, pz, 0.15);
    if (box && box.mat !== "fence" && box.mat !== "sign" && box.mat !== "sandbag" && box.h > 1.3) return false;
  }
  return true;
}

/**
 * Một bước lái xe tăng: `throttle` −1…1 (lùi, tiến), `steer` −1…1 (trái, phải), `speed` là vận tốc hiện tại (đuổi dần
 * theo vận tốc muốn có, xe nặng tăng tốc chậm). Đâm vào vật cản thì dừng lại. Trả về tư thế mới và vận tốc mới.
 */
export function tankStep(map: BattleMap, t: TankPose, throttle: number, steer: number, speed: number, dt: number): { pose: TankPose; speed: number; blocked: boolean } {
  const want = throttle > 0 ? throttle * TANK.forward : throttle * TANK.reverse;
  const accel = Math.abs(want) > Math.abs(speed) ? 2.2 : 4.5;
  let v = speed + Math.max(-accel * dt, Math.min(accel * dt, want - speed));
  // Quay tại chỗ được (hai dải xích chạy ngược nhau). Hướng xe (sin rotY, cos rotY): rotY giảm là quay sang phải,
  // nên D (steer +1) trừ góc. Lùi cũng giữ nguyên chiều quay của thân (như điều khiển xe tăng trong game bắn súng).
  const rotY = t.rotY - steer * TANK.turn * dt;
  const turn = rotY;
  let blocked = false;
  const at = (heading: number, k: number) => {
    const x = t.x + Math.sin(heading) * v * k * dt;
    const z = t.z + Math.cos(heading) * v * k * dt;
    return tankFits(map, x, z, rotY) ? { x, z } : null;
  };
  let p: { x: number; z: number } | null;
  if (!tankFits(map, t.x, t.z, t.rotY)) {
    // Đang kẹt sẵn (chỗ đứng hiện tại đã chạm tường): cho đi để thoát ra.
    p = { x: t.x + Math.sin(rotY) * v * dt, z: t.z + Math.cos(rotY) * v * dt };
  } else {
    p = at(rotY, 1);
    if (!p && Math.abs(v) > 0.05) {
      // Đâm vào vật cản: trượt dọc theo nó (lệch hướng đi một chút, chậm lại) thay vì đứng khựng.
      blocked = true;
      for (const [off, k] of [
        [0.35, 0.75],
        [-0.35, 0.75],
        [0.8, 0.5],
        [-0.8, 0.5],
        [1.3, 0.3],
        [-1.3, 0.3],
      ] as const) {
        p = at(rotY + off, k);
        if (p) break;
      }
      if (p) v *= 0.85;
    }
    if (!p) {
      blocked = true;
      v = 0;
      if (!tankFits(map, t.x, t.z, rotY)) return { pose: { x: t.x, y: t.y, z: t.z, rotY: t.rotY }, speed: 0, blocked };
      p = { x: t.x, z: t.z };
    }
  }
  const x = p.x;
  const z = p.z;
  return { pose: { x, y: map.world.heightAt(x, z), z, rotY: turn }, speed: v, blocked };
}

/** Góc nòng pháo cần ngẩng để đạn pháo (bay theo đường cong) rơi đúng mục tiêu cách `d` mét, cao hơn nòng `dy` mét. */
export function cannonPitch(d: number, dy: number, velocity: number = TANK.velocity): number {
  const g = 9.81;
  const drop = (g * d * d) / (2 * velocity * velocity);
  return Math.max(TANK.pitchDown, Math.min(TANK.pitchUp, Math.atan2(dy + drop, Math.max(1, d))));
}

/** Đầu nòng pháo trong thế giới (theo tư thế xe, hướng tháp pháo, góc nòng). */
export function cannonMuzzle(t: TankPose, turret: number, pitch: number): { o: [number, number, number]; d: [number, number, number] } {
  const cp = Math.cos(pitch);
  const d: [number, number, number] = [Math.sin(turret) * cp, Math.sin(pitch), Math.cos(turret) * cp];
  const pivotY = t.y + TANK.gunY;
  return { o: [t.x + d[0] * TANK.barrel, pivotY + d[1] * TANK.barrel, t.z + d[2] * TANK.barrel], d };
}
