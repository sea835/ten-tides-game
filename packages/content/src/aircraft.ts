// Trực thăng vũ trang hạng nhẹ ("heli", kiểu Little Bird) và tên lửa vác vai phòng không IGLA, dùng chung giữa server
// và client. Ở đây có: thông số trực thăng, mô hình bay "arcade mà có trọng lượng" (chúc mũi để lấy tốc, cần tập thể
// để lên xuống, đệm khí sát đất, đáp mềm / rơi vỡ), dò va chạm với địa hình và công trình (thân, càng, cánh quạt),
// kiểm tra gói vị trí của phi công (server), rocket mũi, súng máy hai cửa hông; tên lửa tầm nhiệt (khoá mục tiêu,
// bay đuổi có giới hạn góc quay) và pháo sáng mồi bẫy.

import { boxesNear, type BattleMap } from "./battle.ts";
import { WEAPON, type WeaponDef } from "./battleItems.ts";
import { tankGround, type TankPose } from "./squad.ts";

/** Thông số trực thăng. Gốc toạ độ ở đáy càng đáp, giữa thân; mũi theo hướng rotY như xe. */
export const HELI = {
  hp: 760,
  /** Nửa kích thước hộp thân (ngang, cao, dọc) để dò đạn, nổ; không tính đuôi mảnh và cánh quạt. */
  half: [1.15, 1.2, 3.3] as const,
  /** Bán kính bấm F lên trực thăng (đứng cạnh cửa). */
  enter: 6,
  bulletFactor: 0.36,
  blastFactor: 1.25,
  /** Tốc độ ngang tối đa (m/s, ~165 km/h) khi chúc mũi hết cỡ. */
  maxSpeed: 46,
  /** Tốc độ lên / xuống tối đa (m/s) theo cần tập thể; gia tốc đuổi theo tốc độ đứng mong muốn. */
  climb: 9,
  sink: 10,
  vAccel: 7,
  /** Góc chúc mũi, nghiêng cánh tối đa (rad) và tốc độ đổi góc (rad/s). */
  tiltMax: 0.42,
  rollMax: 0.36,
  tiltRate: 1.3,
  /** Gia tốc ngang khi chúc mũi hết cỡ (m/s²); cản không khí tỉ lệ vận tốc sao cho đạt đúng maxSpeed. */
  thrust: 13,
  yawRate: 1.3,
  /** Trần bay (độ cao tuyệt đối, m). */
  ceiling: 150,
  /** Bán kính cánh quạt chính; dải cao của đĩa cánh (từ đáy càng). */
  rotor: 5.2,
  rotorLow: 2.35,
  rotorHigh: 2.9,
  /** Thân (để dò va chạm): nửa ngang, nửa dọc, cao từ đáy càng. */
  bodyHw: 1.05,
  bodyHl: 3.4,
  bodyTop: 2.3,
  /** Đệm khí sát đất: dưới độ cao này rơi chậm lại (dễ đáp). */
  groundEffect: 6,
  /** Chạm đất / vật cản chậm hơn mức này (m/s) thì không sao; nhanh hơn `crashSpeed` thì nổ tung. */
  safeSink: 5.5,
  crashSpeed: 17,
  /** Rocket mũi: số quả mỗi lần nạp, giãn cách hai quả (s); pháo sáng: số lượt, chờ giữa hai lượt (s). */
  rockets: 14,
  rocketGap: 0.28,
  flares: 6,
  flareCooldown: 4,
  /** Đáp trong bán kính này quanh sân đỗ nhà (m) thì được nạp lại rocket, pháo sáng (mỗi `rearmEvery` giây một đợt). */
  rearmRadius: 16,
  rearmEvery: 1.2,
  /** Đậu dưới nước (đáp xuống biển) thì máy ngập, mất máu mỗi giây. */
  drown: 45,
} as const;

/** Tư thế trực thăng: vị trí, hướng mũi, góc chúc mũi (`tilt`, dương là chúc xuống), nghiêng cánh (`roll`, dương là nghiêng phải). */
export interface HeliPose extends TankPose {
  tilt: number;
  roll: number;
}
/** Vận tốc (m/s, theo thế giới). */
export interface HeliMotion {
  vx: number;
  vy: number;
  vz: number;
}
/**
 * Cần lái, mỗi trục −1…1: `pitch` dương là chúc mũi (W, tiến), `yaw` dương là quay phải (D), `strafe` dương là nghiêng
 * sang phải (E), `lift` dương là kéo cần tập thể lên (Space), âm là hạ (Shift).
 */
export interface HeliInput {
  pitch: number;
  yaw: number;
  strafe: number;
  lift: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Hai hình chữ nhật xoay trên mặt bằng có chồng nhau không (trục phân tách; quy ước như tankFits). */
export function obbOverlap(ax: number, az: number, ar: number, ahu: number, ahv: number, bx: number, bz: number, br: number, bhu: number, bhv: number): boolean {
  const ca = Math.cos(ar);
  const sa = Math.sin(ar);
  const cb = Math.cos(br);
  const sb = Math.sin(br);
  const dx = bx - ax;
  const dz = bz - az;
  const axes = [ca, -sa, sa, ca, cb, -sb, sb, cb];
  for (let k = 0; k < 8; k += 2) {
    const nx = axes[k]!;
    const nz = axes[k + 1]!;
    const ra = ahu * Math.abs(ca * nx - sa * nz) + ahv * Math.abs(sa * nx + ca * nz);
    const rb = bhu * Math.abs(cb * nx - sb * nz) + bhv * Math.abs(sb * nx + cb * nz);
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}

/** Mặt đỗ dưới điểm (x, z): đất, mặt cầu / cầu tàu, hay mặt nước (đáp xuống biển là ngập máy). */
export function heliGround(map: BattleMap, x: number, z: number): number {
  return Math.max(tankGround(map, x, z), 0);
}

/** Điểm mẫu quanh thân (càng đáp, mũi, đuôi) theo hệ (ngang, dọc). */
const FOOT: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.05, 1.6],
  [-1.05, 1.6],
  [1.05, -1.4],
  [-1.05, -1.4],
  [0, 3.3],
  [0, -3.6],
];
/** Đầu cánh quạt theo bốn hướng (dò sườn đồi chạm cánh). */
const TIPS: readonly (readonly [number, number])[] = [
  [HELI.rotor, 0],
  [-HELI.rotor, 0],
  [0, HELI.rotor],
  [0, -HELI.rotor],
];

/**
 * Trực thăng ở (x, y, z) hướng rotY: mặt đỗ cao nhất dưới càng (đất, nóc nhà thấp hơn bụng chút ít) và có đâm vào gì
 * không (sườn đồi, tường cao hơn bụng, nhà chạm đĩa cánh quạt).
 */
export function heliProbe(map: BattleMap, x: number, y: number, z: number, rotY: number): { floor: number; hit: boolean } {
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  let floor = -Infinity;
  let hit = false;
  for (const [u, v] of FOOT) {
    const g = heliGround(map, x + c * u + s * v, z - s * u + c * v);
    // Sườn dốc đứng cao hơn bụng: đâm vào, không phải đáp.
    if (g > y + 1.1) hit = true;
    else floor = Math.max(floor, g);
  }
  for (const [u, v] of TIPS) if (tankGround(map, x + c * u + s * v, z - s * u + c * v) > y + HELI.rotorLow) hit = true;
  for (const b of boxesNear(map.index, x, z, HELI.rotor + 2)) {
    const top = b.y + b.h / 2;
    const bottom = b.y - b.h / 2;
    if (bottom > y + HELI.rotorHigh) continue;
    const r = Math.abs(b.pitch) > 0.05 ? Math.max(b.w, b.d) : 0;
    const bw = (r || b.w) / 2;
    const bd = (r || b.d) / 2;
    if (top <= y + 0.6) {
      // Mặt trên thấp hơn bụng: là chỗ đáp được (nóc nhà, bệ bê tông) nếu nằm dưới thân.
      if (obbOverlap(x, z, rotY, HELI.bodyHw, HELI.bodyHl * 0.6, b.x, b.z, b.rot, bw, bd)) floor = Math.max(floor, top);
      continue;
    }
    // Cao hơn bụng: đụng thân (dưới nóc cabin) hay đụng đĩa cánh quạt.
    if (bottom < y + HELI.bodyTop && obbOverlap(x, z, rotY, HELI.bodyHw, HELI.bodyHl, b.x, b.z, b.rot, bw, bd)) hit = true;
    else if (top > y + HELI.rotorLow && obbOverlap(x, z, rotY, HELI.rotor * 0.75, HELI.rotor * 0.75, b.x, b.z, b.rot, bw, bd)) hit = true;
    if (hit) break;
  }
  return { floor: Number.isFinite(floor) ? floor : heliGround(map, x, z), hit };
}

/** Trực thăng đậu được ở (x, z) trên mặt đất không: đất khô, bằng phẳng, không vướng nhà, cánh quạt không chạm cây. */
export function heliFits(map: BattleMap, x: number, z: number, rotY: number): boolean {
  const half = map.half ?? 240;
  if (Math.abs(x) > half - 10 || Math.abs(z) > half - 10) return false;
  const h = tankGround(map, x, z);
  if (h < 0.5) return false;
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  for (const [u, v] of FOOT) if (Math.abs(tankGround(map, x + c * u + s * v, z - s * u + c * v) - h) > 0.9) return false;
  const p = heliProbe(map, x, h + 0.05, z, rotY);
  if (p.hit || p.floor > h + 0.6) return false;
  const r = HELI.rotor + 1;
  const trees = map.world.trees;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i]!;
    if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r && !map.treeDead?.[i]) return false;
  }
  return true;
}

/** Sát thương khi va chạm ở tốc độ `impact` (m/s): dưới mức an toàn thì 0, từ `crashSpeed` trở lên thì nổ tung. */
export function heliCrashDamage(impact: number): number {
  if (impact <= HELI.safeSink) return 0;
  if (impact >= HELI.crashSpeed) return HELI.hp * 10;
  return Math.round(((impact - HELI.safeSink) / (HELI.crashSpeed - HELI.safeSink)) * HELI.hp * 0.75);
}

/**
 * Một bước bay. Chúc mũi (tilt) thì lực nâng nghiêng về trước, kéo trực thăng đi tới; nghiêng cánh (roll) thì trượt
 * ngang; cản không khí hãm lại (tốc độ đỉnh đúng HELI.maxSpeed). Cần tập thể đặt tốc độ lên / xuống, trực thăng đuổi
 * theo có quán tính; sát đất thì đệm khí làm rơi chậm lại. Đâm vào sườn đồi, nhà thì dừng lại và tính tốc độ va chạm;
 * chạm đất thì đáp (đứng yên trên càng khi không kéo cần lên). Trả tư thế, vận tốc mới, có đang đậu không, tốc độ va
 * chạm trong bước này (0: không va chạm).
 */
export function heliStep(map: BattleMap, pose: HeliPose, m: HeliMotion, input: HeliInput, dt: number): { pose: HeliPose; motion: HeliMotion; grounded: boolean; impact: number } {
  const probe0 = heliProbe(map, pose.x, pose.y, pose.z, pose.rotY);
  const alt = pose.y - probe0.floor;
  const onGround = alt < 0.08 && input.lift <= 0 && m.vy <= 0.05;
  // Góc chúc mũi, nghiêng cánh đuổi theo cần lái (đang đậu thì về thăng bằng).
  const tiltWant = onGround ? 0 : clamp(input.pitch, -1, 1) * HELI.tiltMax;
  const rollWant = onGround ? 0 : clamp(input.strafe, -1, 1) * HELI.rollMax + clamp(input.yaw, -1, 1) * 0.1;
  const rate = HELI.tiltRate * dt;
  const tilt = pose.tilt + clamp(tiltWant - pose.tilt, -rate, rate);
  const roll = pose.roll + clamp(rollWant - pose.roll, -rate, rate);
  // Quay đầu (đang đậu thì quay chậm trên càng).
  const rotY = pose.rotY - clamp(input.yaw, -1, 1) * HELI.yawRate * (onGround ? 0.35 : 1) * dt;
  const fx = Math.sin(rotY);
  const fz = Math.cos(rotY);
  // Bên phải của mũi (trục x riêng dương là bên trái).
  const rx = -fz;
  const rz = fx;
  let vx = m.vx;
  let vz = m.vz;
  if (onGround) {
    // Đậu: ma sát càng đáp hãm hết trớn.
    const k = Math.max(0, 1 - dt * 6);
    vx *= k;
    vz *= k;
  } else {
    const af = (HELI.thrust * tilt) / HELI.tiltMax;
    const ar = (HELI.thrust * 0.75 * roll) / HELI.rollMax;
    const drag = HELI.thrust / HELI.maxSpeed;
    vx += (fx * af + rx * ar - vx * drag) * dt;
    vz += (fz * af + rz * ar - vz * drag) * dt;
    const sp = Math.hypot(vx, vz);
    if (sp > HELI.maxSpeed) {
      vx *= HELI.maxSpeed / sp;
      vz *= HELI.maxSpeed / sp;
    }
  }
  // Lên xuống: cần tập thể đặt tốc độ đứng; nghiêng nhiều thì hụt chút lực nâng; sát đất có đệm khí.
  const lift = clamp(input.lift, -1, 1);
  let vyWant = lift > 0 ? lift * HELI.climb : lift * HELI.sink;
  vyWant -= ((Math.abs(tilt) / HELI.tiltMax + Math.abs(roll) / HELI.rollMax) * 0.6) * (lift > 0 ? 0 : 1);
  if (alt < HELI.groundEffect && lift <= 0) vyWant = Math.max(vyWant, -(1.4 + ((HELI.sink - 1.4) * Math.max(0, alt)) / HELI.groundEffect));
  // Trong đệm khí lực nâng dội lại mạnh: hãm rơi nhanh hơn.
  const va = HELI.vAccel * (alt < HELI.groundEffect && lift <= 0 && m.vy < 0 ? 2.4 : 1) * dt;
  let vy = onGround ? 0 : m.vy + clamp(vyWant - m.vy, -va, va);
  let x = pose.x + vx * dt;
  let z = pose.z + vz * dt;
  // Đang đậu: ngồi hẳn trên mặt đỗ.
  let y = onGround ? probe0.floor : pose.y + vy * dt;
  if (y > HELI.ceiling) {
    y = HELI.ceiling;
    vy = Math.min(vy, 0);
  }
  const half = (map.half ?? 240) - 6;
  if (Math.abs(x) > half || Math.abs(z) > half) {
    x = clamp(x, -half, half);
    z = clamp(z, -half, half);
    vx = vz = 0;
  }
  let impact = 0;
  let probe = heliProbe(map, x, y, z, rotY);
  if (probe.hit) {
    // Đâm ngang (sườn đồi, tường, cánh chạm nhà): dừng lại, dội ra chút ít.
    impact = Math.hypot(vx, vz, Math.min(0, vy) * 0.5);
    x = pose.x;
    z = pose.z;
    y = Math.max(pose.y, y);
    vx *= -0.15;
    vz *= -0.15;
    probe = heliProbe(map, x, y, z, rotY);
    if (probe.hit) {
      // Vẫn kẹt (quay đầu vào tường): giữ hướng cũ.
      return { pose: { x, y, z, rotY: pose.rotY, tilt, roll }, motion: { vx: 0, vy: Math.max(0, vy), vz: 0 }, grounded: false, impact };
    }
  }
  let grounded = false;
  if (y <= probe.floor) {
    // Chạm đất: tốc độ rơi (và trượt ngang nhanh khi đáp) thành va chạm.
    const h = Math.hypot(vx, vz);
    impact = Math.max(impact, Math.hypot(Math.max(0, -vy), Math.max(0, h - 9) * 0.8));
    y = probe.floor;
    vy = Math.max(0, vy);
    grounded = lift <= 0;
  }
  return { pose: { x, y, z, rotY, tilt, roll }, motion: { vx, vy, vz }, grounded, impact };
}

/**
 * Server kiểm tra một gói vị trí của phi công: không bay nhanh hơn trực thăng (nới cho trễ mạng), không quá trần,
 * không chui xuống đất hay vào trong nhà. `elapsed` là giây kể từ gói trước.
 */
export function heliMoveOk(map: BattleMap, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number; rotY: number }, elapsed: number): boolean {
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  if (flat > HELI.maxSpeed * 1.45 * elapsed + 0.8) return false;
  if (Math.abs(to.y - from.y) > HELI.sink * 1.6 * elapsed + 0.8) return false;
  if (to.y > HELI.ceiling + 1 || Math.hypot(to.x, to.z) > (map.half ?? 240) * 1.2) return false;
  if (to.y < heliGround(map, to.x, to.z) - 0.5) return false;
  return !heliProbe(map, to.x, to.y + 0.25, to.z, to.rotY).hit;
}

// ---------------------------------------------------------------------------- vũ khí trên trực thăng

/** Hai ống rocket hai bên mũi (toạ độ riêng: x dương là bên trái). */
export const HELI_PODS: readonly (readonly [number, number, number])[] = [
  [1.35, 0.95, 0.5],
  [-1.35, 0.95, 0.5],
];
/** Ống rocket chúc xuống thêm chừng này so với mũi (rad). */
export const POD_DROOP = 0.045;

/** Rocket mũi trực thăng: không điều khiển, nổ khi chạm (đi qua đường launch như RPG). */
export const HYDRA: WeaponDef = {
  ...WEAPON.get("rpg7")!,
  id: "hydra",
  name: "Rocket trực thăng",
  velocity: 140,
  hipSpread: 0.012,
  adsSpread: 0.012,
  range: 400,
  price: 0,
  rare: true,
  explosive: { radius: 4.2, damage: 100, armor: 240 },
  boost: { vmax: 330, accel: 450 },
};
if (!WEAPON.has(HYDRA.id)) (WEAPON as Map<string, WeaponDef>).set(HYDRA.id, HYDRA);

/**
 * Nón ngắm rocket quanh mũi: phi công ngắm bằng chuột (tâm màn hình), rocket bay về đó nếu nằm trong ±`yaw` rad quanh
 * hướng mũi và góc ngẩng / chúc tuyệt đối trong [`down`, `up`]; ngoài nón thì bám mép nón.
 */
export const ROCKET_CONE = { yaw: 0.32, up: 0.22, down: -0.85 } as const;

/** Kẹp hướng ngắm (`yaw` theo quy ước rotY, `pitch` dương là ngẩng) vào nón rocket của trực thăng hướng `rotY`. */
export function clampRocketAim(rotY: number, yaw: number, pitch: number): { yaw: number; pitch: number } {
  const d = Math.atan2(Math.sin(yaw - rotY), Math.cos(yaw - rotY));
  return { yaw: rotY + clamp(d, -ROCKET_CONE.yaw, ROCKET_CONE.yaw), pitch: clamp(pitch, ROCKET_CONE.down, ROCKET_CONE.up) };
}

/** Rocket thứ `k` bắn theo hướng ngắm (`yaw`, `pitch`, đã kẹp vào nón quanh mũi): đầu ống và hướng bay. */
export function heliRocketAim(v: HeliPose, k: number, yaw: number, pitch: number): { o: [number, number, number]; d: [number, number, number] } {
  const a = clampRocketAim(v.rotY, yaw, pitch);
  const { o } = heliRocketMuzzle(v, k);
  const cp = Math.cos(a.pitch);
  return { o, d: [Math.sin(a.yaw) * cp, Math.sin(a.pitch), Math.cos(a.yaw) * cp] };
}

/** Đầu ống rocket thứ `k` và hướng bắn theo mũi trực thăng (kể cả góc chúc mũi). */
export function heliRocketMuzzle(v: HeliPose, k: number): { o: [number, number, number]; d: [number, number, number] } {
  const pod = HELI_PODS[k % HELI_PODS.length]!;
  const c = Math.cos(v.rotY);
  const s = Math.sin(v.rotY);
  const pitch = -v.tilt - POD_DROOP;
  const cp = Math.cos(pitch);
  const d: [number, number, number] = [s * cp, Math.sin(pitch), c * cp];
  const o: [number, number, number] = [v.x + c * pod[0] + s * pod[2] + d[0] * 1.2, v.y + pod[1] + d[1] * 1.2 - Math.sin(v.tilt) * pod[2], v.z - s * pod[0] + c * pod[2] + d[2] * 1.2];
  return { o, d };
}

/** Súng máy cửa hông: mỗi cửa quay được ±DOOR_ARC quanh hướng vuông góc thân, ngẩng / chúc trong khoảng này. */
export const DOOR_ARC = 1.35;
export const DOOR_PITCH = { up: 0.5, down: -1.0 } as const;

/** Hướng giữa cung bắn của cửa: ghế 1 cửa trái, ghế 2 cửa phải. */
export function doorCenter(seat: number, rotY: number): number {
  return rotY + (seat === 1 ? Math.PI / 2 : -Math.PI / 2);
}

/** Kẹp hướng súng cửa `seat` về trong cung bắn. */
export function clampDoor(seat: number, rotY: number, yaw: number): number {
  const mid = doorCenter(seat, rotY);
  const d = Math.atan2(Math.sin(yaw - mid), Math.cos(yaw - mid));
  return mid + clamp(d, -DOOR_ARC, DOOR_ARC);
}

/** Hướng `yaw` có trong cung bắn của cửa `seat` không (nới `slack`). */
export function inDoorArc(seat: number, rotY: number, yaw: number, slack = 0): boolean {
  const mid = doorCenter(seat, rotY);
  return Math.abs(Math.atan2(Math.sin(yaw - mid), Math.cos(yaw - mid))) <= DOOR_ARC + slack;
}

// ---------------------------------------------------------------------------- tên lửa vác vai IGLA, pháo sáng

/** Khoá mục tiêu: giữ tâm ngắm lên trực thăng chừng này giây; tầm, nón ngắm (rad), quãng ngắt cho phép (s), độ cao tối thiểu. */
export const IGLA_LOCK = { time: 2.4, range: 400, cone: 0.09, gap: 0.5, minAlt: 3, slack: 0.25 } as const;

/**
 * Tên lửa: rời ống chậm, động cơ đẩy lên `vmax`; quay đầu tối đa `turn` rad/s (không bám được cú quay gắt ở gần);
 * cháy hết sau `life` giây; ngòi cận đích `fuse` m; sát thương vào trực thăng trúng (`armor`), sức nổ (bán kính,
 * sát thương người ở tâm). Không có khoá thì bay thẳng như rocket.
 */
export const MISSILE = { speed: 55, vmax: 175, accel: 220, turn: 1.5, life: 6, fuse: 4, arm: 0.3, armor: 390, radius: 3.5, damage: 70 } as const;

/** Pháo sáng: số lượt mỗi lần nạp (HELI.flares), cháy bao lâu (s), tên lửa trong tầm này thì bị mồi, xác suất bị mồi. */
export const FLARES = { burn: 3.5, range: 420, chance: 0.95 } as const;

/** Khoá đang giữ: trực thăng nào, đã giữ bao lâu (s), lần cuối thấy (ms). */
export interface LockState {
  vid: string;
  held: number;
  at: number;
}

/** Một lần nữa thấy trực thăng `vid` trong tâm ngắm lúc `now` (ms): giữ liên tục thì cộng dồn, đứt quãng thì khoá lại từ đầu. */
export function advanceLock(lock: LockState | null, vid: string, now: number): LockState {
  if (!lock || lock.vid !== vid || now - lock.at > IGLA_LOCK.gap * 1000) return { vid, held: 0, at: now };
  return { vid, held: lock.held + (now - lock.at) / 1000, at: now };
}

/** Khoá đã chín chưa (giữ đủ lâu, chưa đứt quãng); nới `IGLA_LOCK.slack` giây cho trễ mạng. */
export function lockReady(lock: LockState | null, now: number): boolean {
  return !!lock && lock.held >= IGLA_LOCK.time - IGLA_LOCK.slack && now - lock.at <= IGLA_LOCK.gap * 1000;
}

/** Tên lửa đang bay. `target` là id xe đuổi theo (rỗng: bay thẳng); `decoy` là chỗ pháo sáng đã mồi được nó. */
export interface MissileState {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  age: number;
  target: string;
  decoy: { x: number; y: number; z: number } | null;
}

/**
 * Quay vector đơn vị `d` về phía (tx, ty, tz) − (x, y, z) nhưng không quá `maxAngle` rad. Trả hướng mới (đơn vị).
 */
export function turnToward(d: readonly [number, number, number], want: readonly [number, number, number], maxAngle: number): [number, number, number] {
  const wl = Math.hypot(want[0], want[1], want[2]);
  if (wl < 1e-6) return [d[0], d[1], d[2]];
  const w: [number, number, number] = [want[0] / wl, want[1] / wl, want[2] / wl];
  const cos = clamp(d[0] * w[0] + d[1] * w[1] + d[2] * w[2], -1, 1);
  const ang = Math.acos(cos);
  if (ang <= maxAngle) return w;
  // Thành phần vuông góc với d trong mặt phẳng (d, w).
  let px = w[0] - d[0] * cos;
  let py = w[1] - d[1] * cos;
  let pz = w[2] - d[2] * cos;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Ngược hẳn chiều: quay lên trên.
    px = 0;
    py = 1;
    pz = 0;
  } else {
    px /= pl;
    py /= pl;
    pz /= pl;
  }
  const c = Math.cos(maxAngle);
  const s = Math.sin(maxAngle);
  return [d[0] * c + px * s, d[1] * c + py * s, d[2] * c + pz * s];
}

/** Một bước bay của tên lửa đuổi theo điểm `aim` (null: bay thẳng). Sửa thẳng vào `m`, trả quãng đã đi (m). */
export function missileStep(m: MissileState, aim: { x: number; y: number; z: number } | null, dt: number): number {
  m.age += dt;
  m.speed = Math.min(MISSILE.vmax, m.speed + MISSILE.accel * dt);
  if (aim && m.age > 0.15) {
    const d = turnToward([m.dx, m.dy, m.dz], [aim.x - m.x, aim.y - m.y, aim.z - m.z], MISSILE.turn * dt);
    m.dx = d[0];
    m.dy = d[1];
    m.dz = d[2];
  } else if (!aim) {
    // Bay thẳng thì võng nhẹ theo trọng lực.
    const d = turnToward([m.dx, m.dy, m.dz], [m.dx, m.dy - 0.05, m.dz], 0.05 * dt);
    m.dx = d[0];
    m.dy = d[1];
    m.dz = d[2];
  }
  const s = m.speed * dt;
  m.x += m.dx * s;
  m.y += m.dy * s;
  m.z += m.dz * s;
  return s;
}

/** Pháo sáng có mồi được tên lửa đang ở cách trực thăng `dist` mét không (`roll` 0–1 bốc ngẫu nhiên). */
export function flareDecoys(dist: number, roll: number): boolean {
  return dist <= FLARES.range && roll < FLARES.chance;
}
