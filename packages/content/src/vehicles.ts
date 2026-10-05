// Khí tài cơ giới dùng chung giữa server và client: xe tăng (thông số chính ở squad.ts), xe trinh sát bọc thép
// ("jeep", có đại liên trên thùng xe), thuyền tuần tra ("boat", có súng máy mũi thuyền). Ở đây có: thông số từng
// loại, chỗ ngồi, một bước lái xe / thuyền (khớp va chạm giữa máy người lái và server), dò tia trúng vỏ xe kèm mặt
// trúng (giáp trước, hông, đuôi), hệ số giáp theo góc, đứt xích khi nổ sát dải xích.

import { boxAt, boxesNear, type BattleMap } from "./battle.ts";
import { WEAPON, type WeaponDef } from "./battleItems.ts";
import { TANK, tankFits, tankStep, type TankPose } from "./squad.ts";

type V3 = readonly [number, number, number];

export const VEHICLE_KINDS = ["tank", "jeep", "boat"] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

/**
 * Xe trinh sát bọc thép (technical): nhẹ, nhanh (tối đa ~75 km/h), giáp mỏng (đạn thường cũng làm hư), lội được
 * nước nông, bẻ lái như ô tô (phải chạy mới quay được). Bốn chỗ: lái, phụ lái, xạ thủ đại liên trên thùng, ghế sau.
 */
export const JEEP = {
  hp: 420,
  forward: 21,
  reverse: 6,
  /** Tăng tốc, phanh (khi đạp ngược chiều đang chạy), trôi (nhả ga) — m/s². */
  accel: 7,
  brake: 16,
  coast: 3,
  /** Chiều dài cơ sở (m) và góc bánh lái tối đa (rad): tốc độ quay thân = v / L · tan(góc lái). */
  wheelbase: 2.7,
  steer: 0.55,
  /** Nửa kích thước thân: ngang, cao, dọc. Gốc ở đáy thân (mặt đất), giữa xe. */
  half: [1.05, 0.95, 2.35] as const,
  /** Lội nước: đáy sâu nhất (m, âm là dưới mặt nước) xe còn chạy được; dưới nước thì chậm lại. */
  ford: -0.85,
  waterSpeed: 0.45,
  enter: 3.8,
  bulletFactor: 0.45,
  blastFactor: 1.3,
} as const;

/**
 * Thuyền tuần tra: chỉ chạy trên mặt nước (biển quanh bản đồ), năm chỗ (lái, súng máy mũi, ba lính), ủi vào bãi
 * nông được để đổ quân lên bờ.
 */
export const BOAT = {
  hp: 520,
  forward: 15,
  reverse: 4,
  accel: 4,
  brake: 7,
  coast: 1.4,
  /** Tốc độ quay (rad/s) khi đủ trớn; đứng yên thì chỉ xoay được chút ít. */
  turn: 0.75,
  half: [1.35, 0.8, 4.2] as const,
  /** Tâm thuyền cần nước sâu chừng này (đáy dưới mực nước), mũi / đuôi / mạn thì nông hơn cũng được (ủi bãi). */
  draft: -0.55,
  hullDraft: -0.12,
  enter: 6.2,
  bulletFactor: 0.4,
  blastFactor: 1.3,
} as const;

/** Đại liên gắn trên xe (thùng xe trinh sát, mũi thuyền): bắn đạn thường, server dò như súng cầm tay. */
export const HMG: WeaponDef = {
  ...WEAPON.get("m249")!,
  id: "hmg",
  name: "Đại liên",
  damage: 46,
  rpm: 560,
  range: 220,
  velocity: 890,
  hipSpread: 0.012,
  adsSpread: 0.012,
  mag: 0,
  price: 0,
  rare: true,
};
// Ghi vào bảng súng để bảng hạ gục, tiếng súng nhận ra (giá 0: không mua, không rơi ra đất).
if (!WEAPON.has(HMG.id)) (WEAPON as Map<string, WeaponDef>).set(HMG.id, HMG);

/** Đại liên: góc nòng ngẩng / chúc tối đa (rad), dài nòng (m). */
export const MOUNT = { pitchUp: 0.6, pitchDown: -0.35, barrel: 1.15 } as const;

/**
 * Chỗ ngồi theo hệ toạ độ riêng của xe (x ngang — dương là bên trái khi nhìn theo mũi xe, y cao từ đáy, z dọc —
 * dương là mũi). Ghế 0 luôn là ghế lái. `gunner` là ghế cầm đại liên (−1: không có), `mount` là trụ xoay đại liên.
 */
export const SEATS: Record<VehicleKind, { seats: readonly V3[]; names: readonly string[]; gunner: number; mount: V3 }> = {
  tank: { seats: [[0, 1.6, 0]], names: ["Lái + pháo thủ"], gunner: -1, mount: [0, TANK.gunY, 0] },
  jeep: {
    seats: [
      [0.45, 0.75, 0.25],
      [-0.45, 0.75, 0.25],
      [0, 1.15, -1.25],
      [-0.5, 0.85, -1.95],
    ],
    names: ["Tài xế", "Phụ lái", "Xạ thủ đại liên", "Ghế sau"],
    gunner: 2,
    mount: [0, 2.05, -1.0],
  },
  boat: {
    seats: [
      [0, 0.85, -2.3],
      [0, 0.95, 2.9],
      [0.75, 0.7, 0.7],
      [-0.75, 0.7, 0.7],
      [0, 0.7, -0.6],
    ],
    names: ["Lái thuyền", "Súng máy mũi", "Lính", "Lính", "Lính"],
    gunner: 1,
    mount: [0, 1.75, 3.25],
  },
};

/** Thông số chung theo loại xe: máu, nửa kích thước, bán kính bấm lên xe, hệ số đạn / nổ, tốc độ tối đa. */
export function vehicleSpec(kind: string): { hp: number; half: readonly [number, number, number]; enter: number; bulletFactor: number; blastFactor: number; forward: number; seats: number } {
  if (kind === "jeep") return { hp: JEEP.hp, half: JEEP.half, enter: JEEP.enter, bulletFactor: JEEP.bulletFactor, blastFactor: JEEP.blastFactor, forward: JEEP.forward, seats: SEATS.jeep.seats.length };
  if (kind === "boat") return { hp: BOAT.hp, half: BOAT.half, enter: BOAT.enter, bulletFactor: BOAT.bulletFactor, blastFactor: BOAT.blastFactor, forward: BOAT.forward, seats: SEATS.boat.seats.length };
  return { hp: TANK.hp, half: TANK.half, enter: TANK.enter, bulletFactor: TANK.bulletFactor, blastFactor: TANK.blastFactor, forward: TANK.forward, seats: 1 };
}

function seatsOf(kind: string) {
  return SEATS[(kind in SEATS ? kind : "tank") as VehicleKind];
}

/** Điểm (x, y, z) theo toạ độ riêng của xe → toạ độ thế giới (không tính nghiêng theo dốc). */
export function vehicleLocal(v: TankPose, lx: number, ly: number, lz: number): [number, number, number] {
  const c = Math.cos(v.rotY);
  const s = Math.sin(v.rotY);
  return [v.x + c * lx + s * lz, v.y + ly, v.z - s * lx + c * lz];
}

/** Chỗ ngồi thứ `seat` của xe trong thế giới. */
export function seatPos(kind: string, v: TankPose, seat: number): [number, number, number] {
  const s = seatsOf(kind).seats[seat] ?? seatsOf(kind).seats[0]!;
  return vehicleLocal(v, s[0], s[1], s[2]);
}

/** Trụ xoay đại liên trong thế giới, và đầu nòng theo hướng `yaw` (thế giới), góc ngẩng `pitch`. */
export function mountMuzzle(kind: string, v: TankPose, yaw: number, pitch: number): { pivot: [number, number, number]; o: [number, number, number]; d: [number, number, number] } {
  const m = seatsOf(kind).mount;
  const pivot = vehicleLocal(v, m[0], m[1], m[2]);
  const cp = Math.cos(pitch);
  const d: [number, number, number] = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  return { pivot, o: [pivot[0] + d[0] * MOUNT.barrel, pivot[1] + d[1] * MOUNT.barrel, pivot[2] + d[2] * MOUNT.barrel], d };
}

/** Ghế cầm đại liên của loại xe (−1: không có). */
export function gunnerSeat(kind: string): number {
  return seatsOf(kind).gunner;
}

// ---------------------------------------------------------------------------- va chạm, một bước lái

/** Hai hình chữ nhật xoay trên mặt bằng có chồng nhau không (định lý trục phân tách, quy ước như tankFits). */
function rectsOverlap(ax: number, az: number, ar: number, ahu: number, ahv: number, bx: number, bz: number, br: number, bhu: number, bhv: number): boolean {
  const axes = [
    [Math.cos(ar), -Math.sin(ar)],
    [Math.sin(ar), Math.cos(ar)],
    [Math.cos(br), -Math.sin(br)],
    [Math.sin(br), Math.cos(br)],
  ] as const;
  const dx = bx - ax;
  const dz = bz - az;
  for (const [nx, nz] of axes) {
    const ra = ahu * Math.abs(axes[0][0] * nx + axes[0][1] * nz) + ahv * Math.abs(axes[1][0] * nx + axes[1][1] * nz);
    const rb = bhu * Math.abs(axes[2][0] * nx + axes[2][1] * nz) + bhv * Math.abs(axes[3][0] * nx + axes[3][1] * nz);
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}

/** Tám điểm mẫu quanh thân (bốn góc, mũi, đuôi, hai bên hông) theo hệ (ngang, dọc). */
function samples(hw: number, hl: number): readonly (readonly [number, number])[] {
  return [
    [hw, hl],
    [-hw, hl],
    [hw, -hl],
    [-hw, -hl],
    [0, hl + 0.3],
    [0, -hl - 0.3],
    [hw, 0],
    [-hw, 0],
  ];
}

/** Trong mép bản đồ không (chừa `pad` mét). */
function inBounds(map: BattleMap, x: number, z: number, pad: number): boolean {
  const half = map.half ?? 240;
  return Math.abs(x) < half - pad && Math.abs(z) < half - pad;
}

/**
 * Xe trinh sát đứng được ở đây không: đất liền hay nước nông (đáy không sâu quá JEEP.ford), không dốc quá, không
 * đâm vào tường, nhà, container, bao cát cao (xe nhẹ không cán qua như xe tăng; chỉ biển báo thì lướt qua).
 */
export function jeepFits(map: BattleMap, x: number, z: number, rotY: number): boolean {
  if (!inBounds(map, x, z, 3)) return false;
  const h = map.world.heightAt(x, z);
  if (h < JEEP.ford) return false;
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  const [hw, , hl] = JEEP.half;
  for (const [u, v] of samples(hw, hl)) {
    const px = x + c * u + s * v;
    const pz = z - s * u + c * v;
    const ph = map.world.heightAt(px, pz);
    if (ph < JEEP.ford - 0.15 || Math.abs(ph - h) > 2.4) return false;
    const box = boxAt(map.index, px, ph + 0.6, pz, 0.1) ?? boxAt(map.index, px, ph + 1.3, pz, 0.1);
    if (box && box.mat !== "sign" && box.h > 0.75) return false;
  }
  for (const b of boxesNear(map.index, x, z, Math.hypot(hw, hl) + 1)) {
    if (b.mat === "sign" || b.h <= 0.75 || Math.abs(b.pitch) > 0.2) continue;
    if (b.y - b.h / 2 > h + 2 || b.y + b.h / 2 < h + 0.35) continue;
    if (rectsOverlap(x, z, rotY, hw, hl, b.x, b.z, b.rot, b.w / 2, b.d / 2)) return false;
  }
  return true;
}

/**
 * Thuyền nằm được ở đây không: tâm thuyền đủ sâu, mọi điểm quanh mạn còn dưới mặt nước (mũi ủi vào bãi nông được
 * nhưng không lên cạn), không đâm vào cầu cảng, công trình ven biển.
 */
export function boatFits(map: BattleMap, x: number, z: number, rotY: number): boolean {
  if (!inBounds(map, x, z, 5)) return false;
  if (map.world.heightAt(x, z) > BOAT.draft) return false;
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  const [hw, , hl] = BOAT.half;
  for (const [u, v] of samples(hw, hl)) {
    const px = x + c * u + s * v;
    const pz = z - s * u + c * v;
    if (map.world.heightAt(px, pz) > BOAT.hullDraft) return false;
    if (boxAt(map.index, px, 0.6, pz, 0.1)) return false;
  }
  for (const b of boxesNear(map.index, x, z, Math.hypot(hw, hl) + 1)) {
    if (b.y + b.h / 2 < 0.1 || b.y - b.h / 2 > 2.2) continue;
    if (rectsOverlap(x, z, rotY, hw, hl, b.x, b.z, b.rot, b.w / 2, b.d / 2)) return false;
  }
  return true;
}

/** Xe (theo loại) đứng được ở đây không. */
export function vehicleFits(kind: string, map: BattleMap, x: number, z: number, rotY: number): boolean {
  if (kind === "jeep") return jeepFits(map, x, z, rotY);
  if (kind === "boat") return boatFits(map, x, z, rotY);
  return tankFits(map, x, z, rotY);
}

/** Đuổi vận tốc hiện tại về vận tốc muốn có: tăng tốc, phanh (đạp ngược chiều), trôi (nhả ga). */
function approach(speed: number, want: number, accel: number, brake: number, coast: number, dt: number): number {
  let rate = accel;
  if (want === 0) rate = coast;
  else if (Math.sign(want) !== Math.sign(speed) && Math.abs(speed) > 0.3) rate = brake;
  else if (Math.abs(want) < Math.abs(speed)) rate = coast * 1.5;
  return speed + Math.max(-rate * dt, Math.min(rate * dt, want - speed));
}

/** Thử đi tới, đâm thì trượt dọc vật cản (lệch hướng một chút, chậm lại); không đi được thì dừng. */
function advance(fits: (x: number, z: number, r: number) => boolean, t: TankPose, rotY: number, v: number, dt: number): { x: number; z: number; rotY: number; v: number; blocked: boolean } {
  const at = (heading: number, k: number) => {
    const x = t.x + Math.sin(heading) * v * k * dt;
    const z = t.z + Math.cos(heading) * v * k * dt;
    return fits(x, z, rotY) ? { x, z } : null;
  };
  if (!fits(t.x, t.z, t.rotY)) {
    // Đang kẹt sẵn: cho đi để thoát ra.
    return { x: t.x + Math.sin(rotY) * v * dt, z: t.z + Math.cos(rotY) * v * dt, rotY, v, blocked: false };
  }
  let p = at(rotY, 1);
  if (p) return { ...p, rotY, v, blocked: false };
  if (Math.abs(v) > 0.05)
    for (const [off, k] of [
      [0.3, 0.7],
      [-0.3, 0.7],
      [0.7, 0.45],
      [-0.7, 0.45],
    ] as const) {
      p = at(rotY + off, k);
      if (p) return { ...p, rotY, v: v * 0.8, blocked: true };
    }
  // Đâm thẳng: dội lại chút ít. Không quay được tại chỗ thì giữ hướng cũ.
  const r = fits(t.x, t.z, rotY) ? rotY : t.rotY;
  return { x: t.x, z: t.z, rotY: r, v: -v * 0.15, blocked: true };
}

/**
 * Một bước lái xe trinh sát: `throttle`, `steer` −1…1 (steer dương là bẻ phải). Bẻ lái kiểu ô tô (đứng yên thì
 * không quay), chạy nhanh thì bẻ ít lại; lội nước thì chậm. Trả tư thế mới (y bám mặt đất), vận tốc, có đâm không.
 */
export function jeepStep(map: BattleMap, t: TankPose, throttle: number, steer: number, speed: number, dt: number): { pose: TankPose; speed: number; blocked: boolean } {
  const h = map.world.heightAt(t.x, t.z);
  const cap = h < 0 ? JEEP.waterSpeed : 1;
  const want = (throttle > 0 ? throttle * JEEP.forward : throttle * JEEP.reverse) * cap;
  let v = approach(speed, want, JEEP.accel, JEEP.brake, JEEP.coast, dt);
  if (Math.abs(v) > JEEP.forward * cap && Math.abs(want) <= Math.abs(v)) v -= Math.sign(v) * Math.min(Math.abs(v) - JEEP.forward * cap, 8 * dt);
  const authority = 1 - 0.55 * Math.min(1, Math.abs(v) / JEEP.forward);
  const yawRate = (v / JEEP.wheelbase) * Math.tan(steer * JEEP.steer * authority);
  const rotY = t.rotY - yawRate * dt;
  const r = advance((x, z, ry) => jeepFits(map, x, z, ry), t, rotY, v, dt);
  return { pose: { x: r.x, y: map.world.heightAt(r.x, r.z), z: r.z, rotY: r.rotY }, speed: r.v, blocked: r.blocked };
}

/**
 * Một bước lái thuyền: quay theo trớn (đứng yên chỉ xoay chậm), lùi thì lái ngược; mặt thuyền nằm trên mực nước.
 */
export function boatStep(map: BattleMap, t: TankPose, throttle: number, steer: number, speed: number, dt: number): { pose: TankPose; speed: number; blocked: boolean } {
  const want = throttle > 0 ? throttle * BOAT.forward : throttle * BOAT.reverse;
  const v = approach(speed, want, BOAT.accel, BOAT.brake, BOAT.coast, dt);
  const grip = Math.max(0.2, Math.min(1, Math.abs(v) / 5));
  const rotY = t.rotY - steer * BOAT.turn * grip * (v < -0.3 ? -1 : 1) * dt;
  const r = advance((x, z, ry) => boatFits(map, x, z, ry), t, rotY, v, dt);
  return { pose: { x: r.x, y: 0, z: r.z, rotY: r.rotY }, speed: r.v, blocked: r.blocked };
}

/** Một bước lái theo loại xe. `drive` false (xe tăng đứt xích): bánh không kéo, chỉ quay tại chỗ được. */
export function vehicleStep(kind: string, map: BattleMap, t: TankPose, throttle: number, steer: number, speed: number, dt: number, drive = true): { pose: TankPose; speed: number; blocked: boolean } {
  const th = drive ? throttle : 0;
  if (kind === "jeep") return jeepStep(map, t, th, steer, speed, dt);
  if (kind === "boat") return boatStep(map, t, th, steer, speed, dt);
  return tankStep(map, t, th, steer, drive ? speed : 0, dt);
}

/** Độ cao đặt xe ở (x, z): thuyền nổi trên mực nước, xe chạy bám đất. */
export function vehicleY(kind: string, map: BattleMap, x: number, z: number): number {
  return kind === "boat" ? 0 : map.world.heightAt(x, z);
}

// ---------------------------------------------------------------------------- giáp, dò trúng vỏ xe

/** Mặt vỏ xe bị trúng: giáp trước (mũi), hông, đuôi, nóc / gầm. */
export type ArmorFace = "front" | "side" | "rear" | "top";

/**
 * Giáp xe tăng theo mặt trúng: giáp trước dày (đạn nổ giảm 60%, góc tới sượt quá thì có thể nảy đi), hông chịu bình
 * thường, đuôi là điểm yếu (2 phát RPG vào đuôi là xe đầy máu nổ tung). Xe trinh sát, thuyền không có giáp nghiêng.
 */
export const HULL_ARMOR = {
  front: 0.4,
  side: 1,
  rear: 1.4,
  top: 1,
  /** cos góc giữa đường đạn và pháp tuyến mặt giáp: nhỏ hơn mức này là đạn sượt (góc tới trên ~75°). */
  ricochetCos: 0.26,
  ricochetChance: 0.55,
} as const;

/** Xích đứt bao lâu (giây) khi lựu đạn, mìn nổ sát dải xích; xác xe cháy bao lâu thì dọn đi. */
export const TRACKS_SECONDS = 8;
export const WRECK_SECONDS = 75;

/**
 * Tia (o, d đơn vị) gặp vỏ xe (hộp xoay theo rotY, theo loại xe): khoảng cách, mặt trúng và cos góc tới (1 là đâm
 * thẳng vào mặt, gần 0 là sượt qua). null nếu không trúng trong `max` mét.
 */
export function rayVehicle(v: { x: number; y: number; z: number; rotY: number; kind?: string }, o: V3, d: V3, max: number): { t: number; face: ArmorFace; cos: number } | null {
  const half = vehicleSpec(v.kind ?? "tank").half;
  const c = Math.cos(v.rotY);
  const s = Math.sin(v.rotY);
  const rx = o[0] - v.x;
  const ry = o[1] - (v.y + half[1]);
  const rz = o[2] - v.z;
  // Trục riêng: 0 ngang, 1 cao, 2 dọc (dương là mũi xe).
  const lo = [rx * c - rz * s, ry, rx * s + rz * c];
  const ld = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  let tmin = 0;
  let tmax = max;
  let axis = -1;
  for (let k = 0; k < 3; k++) {
    const hk = half[k]!;
    if (Math.abs(ld[k]!) < 1e-9) {
      if (Math.abs(lo[k]!) > hk) return null;
      continue;
    }
    let t1 = (-hk - lo[k]!) / ld[k]!;
    let t2 = (hk - lo[k]!) / ld[k]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      axis = k;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Gốc tia nằm sẵn trong hộp: coi như trúng mặt hông ngay tại chỗ.
  if (axis < 0) return { t: 0, face: "side", cos: 1 };
  const cos = Math.abs(ld[axis]!);
  // Đi theo chiều dọc âm (từ mũi về đuôi) là đâm vào mặt trước.
  const face: ArmorFace = axis === 1 ? "top" : axis === 0 ? "side" : ld[2]! < 0 ? "front" : "rear";
  return { t: tmin, face, cos };
}

/** Như rayVehicle nhưng chỉ trả khoảng cách (Infinity nếu không trúng). */
export function rayVehicleT(v: { x: number; y: number; z: number; rotY: number; kind?: string }, o: V3, d: V3, max: number): number {
  return rayVehicle(v, o, d, max)?.t ?? Infinity;
}

/**
 * Hệ số sát thương theo mặt trúng (chỉ xe tăng có giáp nghiêng). `roll` 0–1 bốc ngẫu nhiên cho nảy đạn: trúng giáp
 * trước ở góc sượt thì có thể nảy đi (không mất máu).
 */
export function armorFactor(kind: string, face: ArmorFace, cos: number, roll: number = Math.random()): { mult: number; ricochet: boolean } {
  if (kind !== "tank") return { mult: 1, ricochet: false };
  if (face === "front") {
    if (cos < HULL_ARMOR.ricochetCos && roll < HULL_ARMOR.ricochetChance) return { mult: 0, ricochet: true };
    return { mult: HULL_ARMOR.front, ricochet: false };
  }
  return { mult: HULL_ARMOR[face], ricochet: false };
}

/**
 * Lựu đạn, mìn nổ sát dải xích (hai bên thân, sát đất) thì đứt xích. Mìn mạnh hơn, với xa hơn; nổ trên cao (trên
 * nóc, ngang tháp pháo) thì không.
 */
export function trackHit(v: { x: number; y: number; z: number; rotY: number; kind?: string }, x: number, y: number, z: number, weapon: string): boolean {
  if ((v.kind ?? "tank") !== "tank" || (weapon !== "frag" && weapon !== "mine")) return false;
  if (y - v.y > 1.6 || y - v.y < -1.5) return false;
  const c = Math.cos(v.rotY);
  const s = Math.sin(v.rotY);
  const dx = x - v.x;
  const dz = z - v.z;
  const across = Math.abs(dx * c - dz * s);
  const along = Math.abs(dx * s + dz * c);
  const [hw, , hl] = TANK.half;
  // Dải xích: từ mép ngoài thân vào trong 0,75 m, chạy suốt chiều dọc.
  const da = Math.max(0, across - hw, hw - 0.75 - across);
  const dl = Math.max(0, along - hl);
  return Math.hypot(da, dl) <= (weapon === "mine" ? 3 : 1.8);
}
