import type { ZoneId } from "@tentides/rules";
import { buildIndex, registerMap, type BattleMap } from "./battle.ts";
import { makeRand, subSeed, type World } from "./worldgen.ts";
import { SHIP_BUILDERS, type HullSpec, type ShipDecor } from "./navalShips.ts";

export { deckAt, halfBeamAt, type DecorKind, type HullSpec, type ShipDecor } from "./navalShips.ts";

// Hải chiến 3 vs 3: mỗi phe một chiến hạm lớn, ba người (hay máy) điều khiển. Dùng chung giữa server và client:
// lớp tàu (máu, kích thước, tốc độ, ba vai trò), hình khối tàu theo toạ độ riêng của tàu (sàn đi lại được, thượng tầng,
// tháp pháo, ổ phòng không...), các bộ phận trúng đạn được (vũ khí, cầu chỉ huy, máy, các khoang), thông số vũ khí,
// một bước lái tàu, đường đạn pháo, ngư lôi, tên lửa, máy bay, dò trúng thân tàu và bản đồ biển.
//
// Toạ độ riêng của tàu: x ngang (dương là mạn trái khi nhìn về mũi), y cao tính từ mặt nước, z dọc (dương là mũi).
// Đổi sang thế giới như xe (vehicleLocal): (sx + c·x + s·z, y, sz − s·x + c·z) với c = cos(rotY), s = sin(rotY).

export type ShipClassId = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";
export const SHIP_CLASSES: readonly ShipClassId[] = ["battleship", "carrier", "cruiser", "submarine", "destroyer"];

/** Vai trò trên tàu (mỗi lớp tàu ba vai). */
export type NavalRole = "captain" | "navigator" | "gunner" | "aa" | "pilot" | "missile" | "torpedo";

/** Vũ khí của tàu. */
export type NavalWeaponId = "bbGun" | "ddGun" | "aa" | "torpedo" | "gtorpedo" | "missile" | "depth" | "decoy" | "jetGun" | "bomb";

/** Bộ phận tàu (trúng đạn, cháy, hỏng). Khoang (bow/mid/stern) không hỏng hẳn, chỉ là chỗ cháy. */
export type PartKind = "section" | "bridge" | "engine" | "turret" | "aa" | "torpedo" | "vls" | "catapult" | "radar" | "depth" | "decoy" | "periscope";

export interface ShipBox {
  /** Tâm (toạ độ riêng của tàu) và kích thước đủ: w ngang, h đứng, d dọc. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Nghiêng theo chiều dọc (dốc cầu thang, rad). */
  pitch?: number;
  mat: "hull" | "deck" | "steel" | "dark" | "wood" | "glass" | "accent" | "flight" | "rail";
  /** Có va chạm (đi lên được, chặn người). Lan can, cột mảnh: va chạm nhưng không chặn đạn. */
  solid?: boolean;
  /** Thuộc bộ phận nào (hỏng thì khối này đen sạm, gãy). */
  part?: string;
  /** Chỉ để va chạm (máy vẽ dựng vỏ tàu trơn thay cho các lát cắt thân tàu). */
  hidden?: boolean;
}

export interface ShipMount {
  weapon: NavalWeaponId;
  /** Trụ xoay (toạ độ riêng). */
  pivot: readonly [number, number, number];
  /** Hướng nghỉ so với mũi tàu (rad, 0 là mũi, dương quay sang trái) và nửa cung bắn (π: quay tròn). */
  rest: number;
  arc: number;
  /** Số nòng (bắn cùng lúc). */
  barrels: number;
  /** Dài nòng (m). */
  barrel: number;
}

export interface ShipPart {
  id: string;
  name: string;
  kind: PartKind;
  hp: number;
  /** Tâm bộ phận (toạ độ riêng), bán kính dò trúng. */
  at: readonly [number, number, number];
  r: number;
  mount?: ShipMount;
}

export interface ShipRole {
  role: NavalRole;
  name: string;
  /** Mô tả ngắn (sảnh chờ, HUD). */
  brief: string;
  /** Chỗ đứng điều khiển (bàn điều khiển, ghế) theo toạ độ riêng của tàu. */
  station: readonly [number, number, number];
  /** Hướng nhìn mặc định khi vào vị trí (so với mũi tàu). */
  face: number;
  weapons: readonly NavalWeaponId[];
  /** Vai lái tàu (thuyền trưởng, hoa tiêu). */
  helm?: boolean;
}

export interface ShipClass {
  id: ShipClassId;
  name: string;
  brief: string;
  hp: number;
  /** Dài, rộng (m), cao mặt boong chính trên mặt nước, mớn nước. */
  length: number;
  beam: number;
  deck: number;
  draft: number;
  /** Tốc độ tối đa (m/s), lùi, tăng tốc (m/s²), tốc độ quay (rad/s) khi đủ trớn. */
  speed: number;
  reverse: number;
  accel: number;
  turn: number;
  roles: readonly [ShipRole, ShipRole, ShipRole];
  parts: readonly ShipPart[];
  boxes: readonly ShipBox[];
  /** Dáng thân tàu (vẽ vỏ trơn) và các chi tiết chỉ để vẽ. */
  hull: HullSpec;
  decor: readonly ShipDecor[];
}

// ---------------------------------------------------------------------------- vũ khí

export interface NavalWeapon {
  id: NavalWeaponId;
  name: string;
  /** Hồi nạp (giây) mỗi ụ. */
  reload: number;
  damage: number;
  /** Bán kính nổ (m) (0: không nổ lan). */
  splash: number;
  /** Sơ tốc (m/s). */
  speed: number;
  /** Tầm (m) / thời gian bay tối đa (giây) với vũ khí dẫn đường. */
  range: number;
  /** Độ tản (rad). */
  spread: number;
  /** Khả năng gây cháy (0–1) khi trúng tàu. */
  fire: number;
}

export const NAVAL_WEAPONS: Record<NavalWeaponId, NavalWeapon> = {
  bbGun: { id: "bbGun", name: "Pháo chính 406 ly", reload: 7.5, damage: 220, splash: 9, speed: 150, range: 1600, spread: 0.007, fire: 0.3 },
  ddGun: { id: "ddGun", name: "Pháo 127 ly", reload: 5, damage: 58, splash: 5, speed: 140, range: 1300, spread: 0.006, fire: 0.15 },
  aa: { id: "aa", name: "Pháo phòng không 40 ly", reload: 0.11, damage: 13, splash: 0, speed: 650, range: 700, spread: 0.018, fire: 0.01 },
  torpedo: { id: "torpedo", name: "Ngư lôi", reload: 14, damage: 450, splash: 8, speed: 25, range: 1200, spread: 0, fire: 0.3 },
  gtorpedo: { id: "gtorpedo", name: "Ngư lôi dẫn đường", reload: 20, damage: 380, splash: 8, speed: 21, range: 65, spread: 0, fire: 0.3 },
  missile: { id: "missile", name: "Tên lửa chống hạm", reload: 20, damage: 450, splash: 10, speed: 72, range: 26, spread: 0, fire: 0.8 },
  depth: { id: "depth", name: "Bom chìm", reload: 9, damage: 320, splash: 15, speed: 0, range: 0, spread: 0, fire: 0 },
  decoy: { id: "decoy", name: "Mồi nhử", reload: 25, damage: 0, splash: 0, speed: 0, range: 0, spread: 0, fire: 0 },
  jetGun: { id: "jetGun", name: "Pháo máy bay 20 ly", reload: 0.07, damage: 15, splash: 0, speed: 800, range: 600, spread: 0.01, fire: 0.02 },
  bomb: { id: "bomb", name: "Bom 500 kg", reload: 22, damage: 380, splash: 11, speed: 0, range: 0, spread: 0, fire: 0.6 },
};

/**
 * Độ tản đạn pháo (độ lệch chuẩn): lệch xa / gần `range` × tầm bắn + `base` m, lệch ngang `lateral` × tầm bắn +
 * `baseLateral` m. Bắn 1 km: một nửa số đạn rơi trong khoảng ±55 m dọc hướng bắn, ±19 m ngang; tàu to, cao (tàu sân
 * bay) vẫn dễ trúng hơn tàu nhỏ nhưng không còn gần như viên nào cũng trúng.
 */
export const GUN_DISPERSION = { range: 0.06, lateral: 0.02, base: 20, baseLateral: 8 } as const;

/** Máu của đơn vị bay / chạy: tên lửa (pháo phòng không bắn hạ được), ngư lôi, máy bay. */
export const UNIT_HP = { missile: 70, gtorpedo: 9999, torpedo: 9999, plane: 260, decoy: 9999 } as const;

/**
 * Giáp theo lớp tàu: hệ số sát thương nhận vào theo loại vũ khí. Thiết giáp hạm vỏ dày: pháo nhỏ, đạn phòng không gần
 * như không xuyên; ngư lôi, tên lửa vẫn đau. Tàu ngầm vỏ mỏng.
 */
export function armorOf(cls: ShipClassId, weapon: NavalWeaponId): number {
  if (cls === "battleship") return weapon === "ddGun" ? 0.4 : weapon === "aa" || weapon === "jetGun" ? 0.4 : weapon === "bbGun" ? 0.85 : weapon === "torpedo" || weapon === "gtorpedo" ? 0.55 : weapon === "missile" ? 0.85 : 1;
  if (cls === "carrier") return weapon === "ddGun" ? 0.85 : 1;
  if (cls === "submarine") return weapon === "torpedo" || weapon === "gtorpedo" ? 1.1 : 1;
  return 1;
}

/** Đạn phòng không, pháo máy bay bắn vào tàu: chỉ trầy (sát thương nhỏ); vào người: như đạn súng máy. */
export const SMALL_ARMS_SHIP = 3;
/** Sô-na tàu khu trục: nghe thấy tàu ngầm đang lặn trong bán kính này (m). */
export const SONAR = 620;

/** Máy bay tiêm kích bom: tốc độ (m/s), cơ động, thời gian chờ có máy bay mới trên tàu sân bay. */
export const JET = {
  min: 48,
  max: 112,
  cruise: 80,
  accel: 14,
  /** Tốc độ quay hướng (rad/s) tối đa, chúc ngóc (rad/s). */
  turn: 0.9,
  climb: 0.85,
  /** Độ cao bay tối đa (m). */
  ceiling: 420,
  bombs: 3,
  respawn: 14,
  /** Nạp lại bom khi bay sát tàu mẹ (m). */
  rearm: 90,
} as const;

/** Tên lửa: tốc độ quay tối đa (rad/s). */
export const MISSILE_TURN = 1.15;
/** Ngư lôi dẫn đường: tốc độ quay tối đa (rad/s), chạy sâu (m). */
export const GTORPEDO_TURN = 0.45;
export const TORPEDO_DEPTH = -2.2;
/** Tàu ngầm: lặn sâu (mặt boong dưới nước), tốc độ lặn / nổi (m/s), thời gian lặn tối đa (giây) rồi phải nổi. */
export const SUB = { depth: -9, rate: 1.4, air: 60, recharge: 0.6 } as const;
/** Đám cháy: lớn dần mỗi giây, máu thân tàu mất mỗi giây khi cháy hết cỡ (100), dập mỗi giây, bán kính đứng dập. */
export const FIRE = { grow: 6, burn: 3.4, partBurn: 4, douse: 34, reach: 5.5, spread: 0.035, max: 4 } as const;
/** Thời gian chờ hồi sinh trên tàu (giây), giới hạn trận (giây). */
export const NAVAL_RESPAWN = 9;
export const NAVAL_TIME = 15 * 60;

// ---------------------------------------------------------------------------- hình tàu (navalShips.ts)

export const SHIPS: Record<ShipClassId, ShipClass> = {
  battleship: SHIP_BUILDERS.battleship(),
  carrier: SHIP_BUILDERS.carrier(),
  cruiser: SHIP_BUILDERS.cruiser(),
  submarine: SHIP_BUILDERS.submarine(),
  destroyer: SHIP_BUILDERS.destroyer(),
};

export function isShipClass(id: string): id is ShipClassId {
  return (SHIP_CLASSES as readonly string[]).includes(id);
}

export function shipClass(id: string): ShipClass {
  return SHIPS[isShipClass(id) ? id : "battleship"];
}

/** Bộ phận có ụ vũ khí `weapon` của lớp tàu. */
export function mountsOf(cls: ShipClass, weapon: NavalWeaponId): ShipPart[] {
  return cls.parts.filter((p) => p.mount?.weapon === weapon);
}

// ---------------------------------------------------------------------------- toạ độ

export interface ShipPose {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export function shipToWorld(s: ShipPose, lx: number, ly: number, lz: number): [number, number, number] {
  const c = Math.cos(s.rotY);
  const sn = Math.sin(s.rotY);
  return [s.x + c * lx + sn * lz, s.y + ly, s.z - sn * lx + c * lz];
}

export function worldToShip(s: ShipPose, x: number, y: number, z: number): [number, number, number] {
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.rotY);
  const sn = Math.sin(s.rotY);
  return [c * dx - sn * dz, y - s.y, sn * dx + c * dz];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ụ có quay tới được hướng thế giới `yaw` không (theo cung bắn quanh hướng nghỉ). */
export function mountCovers(s: ShipPose, m: ShipMount, yaw: number, slack = 0): boolean {
  return Math.abs(wrap(yaw - (s.rotY + m.rest))) <= m.arc + slack;
}

/** Kẹp hướng ngắm thế giới vào cung bắn của ụ. */
export function clampMountYaw(s: ShipPose, m: ShipMount, yaw: number): number {
  const rel = wrap(yaw - (s.rotY + m.rest));
  return s.rotY + m.rest + Math.max(-m.arc, Math.min(m.arc, rel));
}

/**
 * Góc nâng để đạn sơ tốc `v` rơi trúng điểm cách `d` mét theo phương ngang, thấp hơn `dy` mét (đường cầu vồng thấp).
 * NaN nếu ngoài tầm.
 */
export function shellElevation(v: number, d: number, dy: number, g = 9.81): number {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * -dy * v2);
  if (disc < 0) return NaN;
  return Math.atan2(v2 - Math.sqrt(disc), g * d);
}

/** Thời gian bay (giây) của đạn sơ tốc `v` góc nâng `elev` qua quãng ngang `d`. */
export function shellTime(v: number, elev: number, d: number): number {
  return d / Math.max(1, v * Math.cos(elev));
}

// ---------------------------------------------------------------------------- dò trúng thân tàu

/** Tia (o, d đơn vị) gặp khối nào của tàu trong `max` mét: khoảng cách và bộ phận gần chỗ trúng nhất. */
export function rayShip(cls: ShipClass, s: ShipPose, o: readonly [number, number, number], d: readonly [number, number, number], max: number): { t: number; part: string } | null {
  const lo = worldToShip(s, o[0], o[1], o[2]);
  const c = Math.cos(s.rotY);
  const sn = Math.sin(s.rotY);
  const ld = [c * d[0] - sn * d[2], d[1], sn * d[0] + c * d[2]];
  let best = max;
  let hit: ShipBox | null = null;
  for (const b of cls.boxes) {
    if (!b.solid || b.mat === "rail") continue;
    const t = rayAabb(lo, ld, b, best);
    if (t < best) {
      best = t;
      hit = b;
    }
  }
  if (!hit) return null;
  const px = lo[0] + ld[0]! * best;
  const py = lo[1] + ld[1]! * best;
  const pz = lo[2] + ld[2]! * best;
  return { t: best, part: partAt(cls, px, py, pz, hit.part) };
}

function rayAabb(o: readonly number[], d: readonly number[], b: ShipBox, max: number): number {
  // Dốc cầu thang (khối nghiêng) coi như hộp bao không nghiêng: đủ cho đạn.
  const half = [b.w / 2, b.pitch ? Math.max(b.h, Math.abs(Math.sin(b.pitch)) * b.d) / 2 : b.h / 2, b.d / 2];
  const ctr = [b.x, b.y, b.z];
  let t0 = 0;
  let t1 = max;
  for (let k = 0; k < 3; k++) {
    const dk = d[k]!;
    const ok = o[k]! - ctr[k]!;
    if (Math.abs(dk) < 1e-9) {
      if (Math.abs(ok) > half[k]!) return Infinity;
      continue;
    }
    let a = (-half[k]! - ok) / dk;
    let c = (half[k]! - ok) / dk;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Điểm (toạ độ riêng) có nằm trong thân tàu (khối đặc) không, nới `pad` mét. */
export function insideShip(cls: ShipClass, lx: number, ly: number, lz: number, pad = 0): boolean {
  for (const b of cls.boxes) {
    if (!b.solid || b.mat === "rail") continue;
    if (Math.abs(lx - b.x) <= b.w / 2 + pad && Math.abs(ly - b.y) <= b.h / 2 + pad && Math.abs(lz - b.z) <= b.d / 2 + pad) return true;
  }
  return false;
}

/** Bộ phận gần điểm (toạ độ riêng) nhất: bộ phận có vũ khí / cầu chỉ huy nếu trong bán kính, không thì khoang. */
export function partAt(cls: ShipClass, lx: number, ly: number, lz: number, hint?: string): string {
  let best = "";
  let bestD = Infinity;
  for (const p of cls.parts) {
    if (p.kind === "section") continue;
    const d = Math.hypot(lx - p.at[0], ly - p.at[1], lz - p.at[2]);
    if (d < p.r && d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  if (best) return best;
  if (hint && cls.parts.some((p) => p.id === hint)) return hint;
  return lz > cls.length * 0.2 ? "bow" : lz < -cls.length * 0.2 ? "stern" : "mid";
}

/** Mặt sàn cao nhất dưới điểm (toạ độ riêng) trên tàu, hay −Infinity nếu không ở trên tàu. */
export function deckBelow(cls: ShipClass, lx: number, ly: number, lz: number): number {
  let top = -Infinity;
  for (const b of cls.boxes) {
    if (!b.solid) continue;
    if (Math.abs(lx - b.x) > b.w / 2 || Math.abs(lz - b.z) > b.d / 2) continue;
    let y = b.y + b.h / 2;
    if (b.pitch) {
      // Dốc: chỉ trong đoạn chiếu xuống mặt ngang (không kéo dài mặt dốc ra ngoài hai đầu).
      if (Math.abs(lz - b.z) > (b.d / 2) * Math.cos(b.pitch)) continue;
      y = b.y + b.h / 2 + Math.tan(-b.pitch) * (lz - b.z);
    }
    if (y <= ly + 0.6 && y > top) top = y;
  }
  return top;
}

const firePoints = new Map<string, [number, number, number]>();

/**
 * Chỗ đám cháy của bộ phận: điểm trên mặt sàn đứng được (đầu không vướng khối) gần bộ phận nhất, để người tới dập
 * được; bộ phận nằm trong thân, trong thượng tầng (máy, cầu chỉ huy) thì lửa bốc ra ở boong ngay cạnh.
 */
export function firePoint(cls: ShipClass, part: ShipPart): [number, number, number] {
  const key = `${cls.id}:${part.id}`;
  const hit = firePoints.get(key);
  if (hit) return hit;
  const [ax, ay, az] = part.at;
  let best: [number, number, number] = [ax, cls.deck, az];
  let bestScore = Infinity;
  const reach = Math.ceil(Math.max(8, cls.beam / 2));
  for (let dz = -12; dz <= 12; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = ax + dx;
      const z = az + dz;
      if (Math.abs(x) > cls.beam / 2 - 0.6 || Math.abs(z) > cls.length / 2 - 2) continue;
      const floor = deckBelow(cls, x, Math.max(ay, cls.deck) + 5, z);
      if (!Number.isFinite(floor) || insideShip(cls, x, floor + 1, z) || insideShip(cls, x, floor + 1.7, z)) continue;
      const score = Math.hypot(dx, dz, (floor - ay) * 0.7);
      if (score < bestScore) {
        bestScore = score;
        best = [x, floor, z];
      }
    }
  }
  firePoints.set(key, best);
  return best;
}

/** Như firePoint, theo mã bộ phận (không có thì giữa boong). */
export function firePointOf(cls: ShipClass, partId: string): [number, number, number] {
  const part = cls.parts.find((p) => p.id === partId);
  return part ? firePoint(cls, part) : [0, cls.deck, 0];
}

// ---------------------------------------------------------------------------- lái tàu

export interface ShipMotion {
  pose: ShipPose;
  speed: number;
}

/**
 * Một bước lái tàu: `throttle` −1…1 (tốc độ muốn có theo phần tốc độ tối đa; âm là lùi), `rudder` −1…1 (dương bẻ
 * sang phải). Tàu tăng tốc chậm, quay theo trớn (đứng yên gần như không quay). `drive` 0–1: máy hỏng thì yếu đi.
 * `blocked(x, z, rotY)`: tàu có mắc cạn / đâm vào đâu không.
 */
export function shipStep(cls: ShipClass, m: ShipMotion, throttle: number, rudder: number, dt: number, drive = 1, steer = 1, blocked?: (x: number, z: number, rotY: number) => boolean): ShipMotion {
  const want = throttle >= 0 ? throttle * cls.speed * drive : throttle * cls.reverse * drive;
  const rate = cls.accel * (Math.sign(want - m.speed) !== Math.sign(m.speed) && Math.abs(m.speed) > 0.5 ? 1.6 : 1);
  const speed = m.speed + Math.max(-rate * dt, Math.min(rate * dt, want - m.speed));
  const grip = Math.min(1, Math.abs(speed) / (cls.speed * 0.35)) * (speed < 0 ? -0.6 : 1);
  const rotY = m.pose.rotY - rudder * cls.turn * steer * grip * dt;
  const x = m.pose.x + Math.sin(rotY) * speed * dt;
  const z = m.pose.z + Math.cos(rotY) * speed * dt;
  if (blocked?.(x, z, rotY)) return { pose: { ...m.pose, rotY: blocked(m.pose.x, m.pose.z, rotY) ? m.pose.rotY : rotY }, speed: -speed * 0.2 };
  return { pose: { x, y: m.pose.y, z, rotY }, speed };
}

/** Tàu có mắc cạn ở (x, z, rotY) không: mũi, đuôi, hai mạn chạm đáy nông hơn mớn nước, hay ra ngoài bản đồ. */
export function shipAground(cls: ShipClass, map: BattleMap, x: number, z: number, rotY: number): boolean {
  const half = (map.half ?? 700) - 20;
  if (Math.abs(x) > half || Math.abs(z) > half) return true;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  for (const [lx, lz] of [
    [0, cls.length / 2],
    [0, -cls.length / 2],
    [cls.beam / 2, 0],
    [-cls.beam / 2, 0],
    [cls.beam / 3, cls.length / 3],
    [-cls.beam / 3, cls.length / 3],
  ] as const) {
    if (map.world.heightAt(x + c * lx + s * lz, z - s * lx + c * lz) > -cls.draft) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------- đơn vị bay, chạy

export interface UnitPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
}

/** Quay dần hướng `cur` về `want` (rad), tối đa `rate` rad mỗi giây. */
export function steerToward(cur: number, want: number, rate: number, dt: number): number {
  const d = wrap(want - cur);
  return cur + Math.max(-rate * dt, Math.min(rate * dt, d));
}

/** Một bước tên lửa: bay thẳng tốc độ đều, quay dần về hướng ngắm (yaw, pitch thế giới); không chúi xuống nước. */
export function navalMissileStep(u: UnitPose, wantYaw: number, wantPitch: number, dt: number): UnitPose {
  const yaw = steerToward(u.yaw, wantYaw, MISSILE_TURN, dt);
  const pitch = Math.max(-0.9, Math.min(0.9, steerToward(u.pitch, wantPitch, MISSILE_TURN, dt)));
  const v = NAVAL_WEAPONS.missile.speed;
  const cp = Math.cos(pitch);
  return { x: u.x + Math.sin(yaw) * cp * v * dt, y: u.y + Math.sin(pitch) * v * dt, z: u.z + Math.cos(yaw) * cp * v * dt, yaw, pitch, roll: wrap(wantYaw - u.yaw) * 0.8, speed: v };
}

/** Một bước ngư lôi (thẳng hay dẫn đường): chạy ngầm ở độ sâu cố định. */
export function torpedoStep(u: UnitPose, wantYaw: number, guided: boolean, dt: number): UnitPose {
  const yaw = guided ? steerToward(u.yaw, wantYaw, GTORPEDO_TURN, dt) : u.yaw;
  const v = guided ? NAVAL_WEAPONS.gtorpedo.speed : NAVAL_WEAPONS.torpedo.speed;
  return { x: u.x + Math.sin(yaw) * v * dt, y: TORPEDO_DEPTH, z: u.z + Math.cos(yaw) * v * dt, yaw, pitch: 0, roll: 0, speed: v };
}

/**
 * Một bước máy bay kiểu "bay theo chuột": mũi quay dần về hướng ngắm (yaw, pitch), nghiêng cánh khi lượn, ga W/S đổi
 * tốc độ. Chậm quá thì mất lực nâng, chúi xuống.
 */
export function jetStep(u: UnitPose, wantYaw: number, wantPitch: number, throttle: number, dt: number): UnitPose {
  const target = Math.max(JET.min, Math.min(JET.max, JET.cruise + throttle * (throttle > 0 ? JET.max - JET.cruise : JET.cruise - JET.min)));
  let speed = u.speed + Math.max(-JET.accel * dt, Math.min(JET.accel * dt, target - u.speed));
  const agility = 0.55 + 0.45 * Math.min(1, speed / JET.cruise);
  const dyaw = wrap(wantYaw - u.yaw);
  const yaw = steerToward(u.yaw, wantYaw, JET.turn * agility, dt);
  let pitch = Math.max(-1.1, Math.min(1.0, steerToward(u.pitch, wantPitch, JET.climb * agility, dt)));
  // Thiếu tốc: mũi chúc dần xuống. Leo dốc thì chậm lại, bổ nhào thì nhanh lên.
  if (speed < JET.min + 6) pitch = steerToward(pitch, -0.5, 0.6, dt);
  speed -= Math.sin(pitch) * 9.81 * dt * 0.6;
  const roll = steerToward(u.roll, Math.max(-1.2, Math.min(1.2, dyaw * 2.2)), 2.4, dt);
  const cp = Math.cos(pitch);
  const y = Math.min(JET.ceiling, u.y + Math.sin(pitch) * speed * dt);
  return { x: u.x + Math.sin(yaw) * cp * speed * dt, y, z: u.z + Math.cos(yaw) * cp * speed * dt, yaw, pitch, roll, speed };
}

/** Vị trí đạn pháo / bom sau `t` giây (bắn từ o với vận tốc v). */
export function ballisticAt(o: readonly [number, number, number], v: readonly [number, number, number], t: number, g = 9.81): [number, number, number] {
  return [o[0] + v[0] * t, o[1] + v[1] * t - 0.5 * g * t * t, o[2] + v[2] * t];
}

// ---------------------------------------------------------------------------- bản đồ biển

export const NAVAL_HALF = 1000;

/** Đảo đá giữa biển (che ngư lôi, tên lửa bay thấp, tàu nấp sau). */
export const NAVAL_ISLETS: readonly { x: number; z: number; r: number; h: number }[] = [
  { x: -55, z: 215, r: 58, h: 26 },
  { x: 120, z: -255, r: 48, h: 20 },
  { x: -230, z: -80, r: 33, h: 14 },
  { x: 255, z: 120, r: 38, h: 17 },
  { x: 0, z: -25, r: 22, h: 11 },
  { x: -430, z: 405, r: 42, h: 22 },
  { x: 445, z: -420, r: 42, h: 22 },
  { x: -520, z: -420, r: 30, h: 15 },
  { x: 530, z: 430, r: 30, h: 15 },
];

function navalHeight(x: number, z: number): number {
  let h = -32 + 3 * Math.sin(x * 0.006 + 0.4) * Math.cos(z * 0.005);
  for (const it of NAVAL_ISLETS) {
    const d = Math.hypot(x - it.x, z - it.z);
    if (d > it.r * 2.6) continue;
    const t = Math.max(0, 1 - d / (it.r * 2.6));
    const rock = it.h * Math.pow(Math.max(0, 1 - d / it.r), 0.8) * (0.85 + 0.15 * Math.sin(x * 0.3 + z * 0.2));
    h = Math.max(h, -32 + 34 * t * t, rock);
  }
  return h;
}

const navalCache = new Map<number, BattleMap>();

/** Bản đồ hải chiến: biển sâu 2 000 × 2 000 m, chín đảo đá rải rác; hai tàu xuất phát hai đầu đông tây. */
export function navalMap(seed: number): BattleMap {
  const hit = navalCache.get(seed);
  if (hit) return hit;
  const inland = (x: number, z: number) => {
    let best = -1000;
    for (const it of NAVAL_ISLETS) best = Math.max(best, it.r - Math.hypot(x - it.x, z - it.z));
    return best;
  };
  const world: World = {
    seed,
    kind: "battle",
    extent: 120,
    half: NAVAL_HALF,
    biome: "temperate",
    islets: [],
    reefs: [],
    structures: [],
    pois: [],
    pages: [],
    spawns: [],
    palms: [],
    trees: [],
    tallGrass: [],
    inTallGrass: () => false,
    heightAt: navalHeight,
    surface: (x, z) => {
      const i = inland(x, z);
      return { island: i < 0 ? "sea" : "main", inland: i, islet: null, reef: false, pad: false };
    },
    zoneAt: (): ZoneId => "beach",
    regionAt: (x, z) => (inland(x, z) > -4 ? "Đảo đá" : Math.abs(x) > NAVAL_HALF - 60 || Math.abs(z) > NAVAL_HALF - 60 ? "Biển khơi (mép bản đồ)" : "Biển khơi"),
    structureAt: () => null,
    isClear: () => true,
  };
  // Vài cây dừa trên các đảo đá lớn.
  const rand = makeRand(subSeed(seed, "naval"));
  const trees: World["trees"][number][] = [];
  for (const it of NAVAL_ISLETS) {
    for (let k = 0; k < Math.round(it.r / 6); k++) {
      const a = rand() * Math.PI * 2;
      const r = it.r * (0.3 + rand() * 0.45);
      const x = it.x + Math.cos(a) * r;
      const z = it.z + Math.sin(a) * r;
      if (navalHeight(x, z) < 1.5) continue;
      trees.push({ id: `p${trees.length}`, kind: "palm", x, z, height: 6 + rand() * 3, lean: (rand() - 0.5) * 0.4 });
    }
  }
  world.trees = trees;
  world.palms = trees.map((t) => ({ x: t.x, z: t.z, height: t.height, lean: t.lean }));
  const map: BattleMap = { layout: "island", half: NAVAL_HALF, flags: [], world, sites: [], boxes: [], loot: [], mines: [], index: buildIndex([]) };
  navalCache.set(seed, map);
  registerMap(map);
  return map;
}

/** Chỗ xuất phát hai tàu: phe Xanh phía tây quay mũi sang đông, phe Đỏ ngược lại. */
export const NAVAL_STARTS = {
  blue: { x: -740, z: -80, rotY: Math.PI / 2 },
  red: { x: 740, z: 80, rotY: -Math.PI / 2 },
} as const;
