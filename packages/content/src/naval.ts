import type { ZoneId } from "@tentides/rules";
import { buildIndex, registerMap, type BattleMap } from "./battle.ts";
import { makeRand, subSeed, type World } from "./worldgen.ts";

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
  ddGun: { id: "ddGun", name: "Pháo 127 ly", reload: 3.6, damage: 58, splash: 5, speed: 140, range: 1300, spread: 0.006, fire: 0.15 },
  aa: { id: "aa", name: "Pháo phòng không 40 ly", reload: 0.11, damage: 13, splash: 0, speed: 650, range: 700, spread: 0.018, fire: 0.01 },
  torpedo: { id: "torpedo", name: "Ngư lôi", reload: 14, damage: 450, splash: 8, speed: 25, range: 1200, spread: 0, fire: 0.3 },
  gtorpedo: { id: "gtorpedo", name: "Ngư lôi dẫn đường", reload: 20, damage: 380, splash: 8, speed: 21, range: 65, spread: 0, fire: 0.3 },
  missile: { id: "missile", name: "Tên lửa chống hạm", reload: 20, damage: 450, splash: 10, speed: 72, range: 26, spread: 0, fire: 0.8 },
  depth: { id: "depth", name: "Bom chìm", reload: 9, damage: 320, splash: 15, speed: 0, range: 0, spread: 0, fire: 0 },
  decoy: { id: "decoy", name: "Mồi nhử", reload: 25, damage: 0, splash: 0, speed: 0, range: 0, spread: 0, fire: 0 },
  jetGun: { id: "jetGun", name: "Pháo máy bay 20 ly", reload: 0.07, damage: 15, splash: 0, speed: 800, range: 600, spread: 0.01, fire: 0.02 },
  bomb: { id: "bomb", name: "Bom 500 kg", reload: 22, damage: 460, splash: 11, speed: 0, range: 0, spread: 0, fire: 0.6 },
};

/** Máu của đơn vị bay / chạy: tên lửa (pháo phòng không bắn hạ được), ngư lôi, máy bay. */
export const UNIT_HP = { missile: 70, gtorpedo: 9999, torpedo: 9999, plane: 260, decoy: 9999 } as const;

/**
 * Giáp theo lớp tàu: hệ số sát thương nhận vào theo loại vũ khí. Thiết giáp hạm vỏ dày: pháo nhỏ, đạn phòng không gần
 * như không xuyên; ngư lôi, tên lửa vẫn đau. Tàu ngầm vỏ mỏng.
 */
export function armorOf(cls: ShipClassId, weapon: NavalWeaponId): number {
  if (cls === "battleship") return weapon === "ddGun" ? 0.55 : weapon === "aa" || weapon === "jetGun" ? 0.4 : weapon === "bbGun" ? 0.85 : 1;
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

// ---------------------------------------------------------------------------- dựng hình tàu

/** Thân tàu: phần giữa vuông, mũi thon dần ba bậc, đuôi vát; mặt trên là boong chính. */
function hull(L: number, B: number, deck: number, draft: number, out: ShipBox[], sheer = 0.6) {
  const y0 = -draft;
  const h = deck - y0;
  const midEnd = L * 0.22;
  out.push({ x: 0, y: y0 + h / 2, z: (-L / 2 + 3 + midEnd) / 2, w: B, h, d: midEnd + L / 2 - 3, mat: "hull", solid: true, part: "mid" });
  out.push({ x: 0, y: y0 + h / 2 - 0.3, z: -L / 2 + 1.5, w: B * 0.86, h: h - 0.6, d: 3, mat: "hull", solid: true, part: "stern" });
  const steps = [0.86, 0.62, 0.34];
  const len = (L / 2 - midEnd) / steps.length;
  steps.forEach((k, i) => {
    const hh = h + sheer * (i + 1);
    out.push({ x: 0, y: y0 + hh / 2, z: midEnd + len * (i + 0.5), w: B * k, h: hh, d: len + 0.05, mat: "hull", solid: true, part: "bow" });
  });
  // Lan can hai mạn phần giữa (chặn người rơi xuống biển, chừa lối ở đuôi).
  for (const side of [-1, 1]) out.push({ x: (side * B) / 2 - side * 0.08, y: deck + 0.55, z: (-L / 2 + 6 + midEnd) / 2, w: 0.1, h: 1.1, d: midEnd + L / 2 - 6, mat: "rail", solid: true });
}

/** Thượng tầng nhiều tầng: khối thân, sàn trên có lan can, dốc lên từ boong chính. */
function block(out: ShipBox[], x: number, y0: number, z: number, w: number, h: number, d: number, part: string, mat: ShipBox["mat"] = "steel") {
  out.push({ x, y: y0 + h / 2, z, w, h, d, mat, solid: true, part });
}

/** Dốc (cầu thang) từ độ cao y0 lên y1 dọc theo z, bắt đầu ở z0, bề ngang w, tại hoành độ x. */
function ramp(out: ShipBox[], x: number, y0: number, y1: number, z0: number, z1: number, w = 1.4) {
  const rise = y1 - y0;
  const run = z1 - z0;
  const len = Math.hypot(rise, run);
  out.push({ x, y: (y0 + y1) / 2 - 0.1, z: (z0 + z1) / 2, w, h: 0.2, d: len, pitch: -Math.atan2(rise, run), mat: "steel", solid: true });
}

function turretBoxes(out: ShipBox[], m: ShipMount, part: string, size: number) {
  // Bệ tháp pháo cố định (tháp xoay vẽ riêng theo hướng ngắm).
  out.push({ x: m.pivot[0], y: m.pivot[1] - size * 0.35, z: m.pivot[2], w: size, h: size * 0.7, d: size, mat: "dark", solid: true, part });
}

function role(r: NavalRole, name: string, brief: string, station: readonly [number, number, number], face: number, weapons: readonly NavalWeaponId[], helm = false): ShipRole {
  return { role: r, name, brief, station, face, weapons, helm };
}

function sections(L: number, deck: number, B: number): ShipPart[] {
  return [
    { id: "bow", name: "Khoang mũi", kind: "section", hp: 99999, at: [0, deck - 1, L * 0.36], r: B * 0.7 },
    { id: "mid", name: "Khoang giữa", kind: "section", hp: 99999, at: [0, deck - 1, 0], r: B * 0.8 },
    { id: "stern", name: "Khoang đuôi", kind: "section", hp: 99999, at: [0, deck - 1, -L * 0.38], r: B * 0.7 },
  ];
}

function battleship(): ShipClass {
  const L = 96;
  const B = 17;
  const D = 5;
  const boxes: ShipBox[] = [];
  hull(L, B, D, 6, boxes);
  const gun = (z: number, y: number, rest: number): ShipMount => ({ weapon: "bbGun", pivot: [0, y, z], rest, arc: 2.4, barrels: 3, barrel: 13 });
  const t1 = gun(30, D + 2, 0);
  const t2 = gun(19, D + 4.6, 0);
  const t3 = gun(-31, D + 2, Math.PI);
  turretBoxes(boxes, t1, "t1", 8);
  turretBoxes(boxes, t2, "t2", 8);
  boxes.push({ x: 0, y: D + 1.3, z: 19, w: 8.4, h: 2.6, d: 8.4, mat: "steel", solid: true });
  turretBoxes(boxes, t3, "t3", 8);
  // Thượng tầng hai tầng, tháp chỉ huy, ống khói.
  block(boxes, 0, D, 2, 12, 4, 20, "mid");
  block(boxes, 0, D + 4, 6, 8, 4, 10, "bridge");
  block(boxes, 0, D + 8, 7, 6, 3, 6, "bridge", "glass");
  boxes.push({ x: 0, y: D + 11.15, z: 7, w: 7, h: 0.3, d: 7, mat: "deck", solid: true, part: "bridge" });
  block(boxes, 0, D + 4, -5, 4, 7, 5, "engine", "dark");
  boxes.push({ x: 0, y: D + 16, z: 5, w: 0.5, h: 9, d: 0.5, mat: "dark", solid: true, part: "radar" });
  ramp(boxes, 6.6, D, D + 4, -12, -4);
  ramp(boxes, -3.2, D + 4, D + 8, -1, 4.5);
  ramp(boxes, 3.2, D + 8, D + 11.3, 1, 3.9, 1.2);
  const aa = (x: number, y: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc: 1.9, barrels: 4, barrel: 2.8 });
  const aas = [aa(5, D + 4.9, 9, Math.PI / 2), aa(-5, D + 4.9, 9, -Math.PI / 2), aa(6.8, D + 0.9, -18, Math.PI / 2), aa(-6.8, D + 0.9, -18, -Math.PI / 2)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.45, z: m.pivot[2], w: 2.6, h: 0.9, d: 2.6, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const tp = (side: number): ShipMount => ({ weapon: "torpedo", pivot: [side * 7.2, D + 0.8, -9], rest: (side * Math.PI) / 2, arc: 0.85, barrels: 3, barrel: 5 });
  for (const [i, side] of [1, -1].entries()) boxes.push({ x: side * 7.2, y: D + 0.4, z: -9, w: 1.4, h: 0.8, d: 3, mat: "dark", solid: true, part: `tp${i + 1}` });
  return {
    id: "battleship",
    name: "Thiết giáp hạm",
    brief: "Máu trâu, ba tháp pháo chính 406 ly (mỗi tháp ba nòng) bắn xa nhất, bốn ổ phòng không, ngư lôi hai mạn. Chậm, quay chậm.",
    hp: 4400,
    length: L,
    beam: B,
    deck: D,
    draft: 6,
    speed: 12,
    reverse: 4,
    accel: 0.9,
    turn: 0.07,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu (W/S tốc độ, A/D bẻ lái), bắn ngư lôi hai mạn (chuột trái).", [0, D + 11.3, 8.2], 0, ["torpedo"], true),
      role("gunner", "Pháo thủ chính", "Ba tháp pháo chính: ngắm vào mặt biển, máy tự tính góc nâng; chuột trái bắn loạt.", [2.6, D + 4, -5.5], 0, ["bbGun"]),
      role("aa", "Phòng không", "Bốn ổ pháo phòng không: bắn máy bay, tên lửa, lính trên boong tàu địch.", [5.5, D + 4, -1], Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(L, D, B),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 700, at: [0, D + 9, 7], r: 5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 800, at: [0, D, -5], r: 6 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 250, at: [0, D + 17, 5], r: 3 },
      { id: "t1", name: "Tháp pháo 1", kind: "turret", hp: 650, at: t1.pivot, r: 5, mount: t1 },
      { id: "t2", name: "Tháp pháo 2", kind: "turret", hp: 650, at: t2.pivot, r: 5, mount: t2 },
      { id: "t3", name: "Tháp pháo 3", kind: "turret", hp: 650, at: t3.pivot, r: 5, mount: t3 },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 180, at: m.pivot, r: 2.4, mount: m })),
      { id: "tp1", name: "Ống phóng ngư lôi trái", kind: "torpedo", hp: 280, at: tp(1).pivot, r: 2.5, mount: tp(1) },
      { id: "tp2", name: "Ống phóng ngư lôi phải", kind: "torpedo", hp: 280, at: tp(-1).pivot, r: 2.5, mount: tp(-1) },
    ],
    boxes,
  };
}

function destroyer(): ShipClass {
  const L = 70;
  const B = 10;
  const D = 4;
  const boxes: ShipBox[] = [];
  hull(L, B, D, 4, boxes, 0.5);
  const gun = (z: number, y: number, rest: number): ShipMount => ({ weapon: "ddGun", pivot: [0, y, z], rest, arc: 2.5, barrels: 2, barrel: 6 });
  const g1 = gun(22, D + 1.4, 0);
  const g2 = gun(-24, D + 1.4, Math.PI);
  turretBoxes(boxes, g1, "g1", 4.5);
  turretBoxes(boxes, g2, "g2", 4.5);
  block(boxes, 0, D, 6, 7, 3.4, 13, "mid");
  block(boxes, 0, D + 3.4, 9, 5, 3, 5, "bridge", "glass");
  boxes.push({ x: 0, y: D + 6.55, z: 9, w: 5.6, h: 0.3, d: 5.6, mat: "deck", solid: true, part: "bridge" });
  block(boxes, 0, D, -4, 3.4, 7, 4, "engine", "dark");
  boxes.push({ x: 0, y: D + 10, z: 6, w: 0.4, h: 7, d: 0.4, mat: "dark", solid: true, part: "radar" });
  ramp(boxes, 4.2, D, D + 3.4, -1.5, 2.6, 1.2);
  ramp(boxes, -2.1, D + 3.4, D + 6.7, 3, 6.6, 1);
  const tpm: ShipMount = { weapon: "torpedo", pivot: [0, D + 0.9, -12], rest: Math.PI / 2, arc: Math.PI, barrels: 4, barrel: 6 };
  boxes.push({ x: 0, y: D + 0.4, z: -12, w: 2, h: 0.8, d: 2, mat: "dark", solid: true, part: "tp1" });
  const aa = (x: number, y: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc: 1.9, barrels: 2, barrel: 2.6 });
  const aas = [aa(3.2, D + 3.9, 3, Math.PI / 2), aa(-3.2, D + 3.9, 3, -Math.PI / 2), aa(0, D + 0.9, -18, Math.PI)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.45, z: m.pivot[2], w: 2, h: 0.9, d: 2, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const dc: ShipMount = { weapon: "depth", pivot: [0, D + 0.6, -L / 2 + 3], rest: Math.PI, arc: 0.2, barrels: 2, barrel: 1 };
  boxes.push({ x: 0, y: D + 0.5, z: -L / 2 + 3.5, w: 3, h: 1, d: 2, mat: "dark", solid: true, part: "dc" });
  return {
    id: "destroyer",
    name: "Tàu khu trục",
    brief: "Như thiết giáp hạm thu nhỏ: hai tháp pháo 127 ly bắn nhanh (sát thương thấp hơn), ngư lôi bốn ống, bom chìm diệt tàu ngầm. Nhanh, quay gắt, máu mỏng.",
    hp: 2500,
    length: L,
    beam: B,
    deck: D,
    draft: 4,
    speed: 17,
    reverse: 5,
    accel: 1.6,
    turn: 0.13,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu, bắn ngư lôi (chuột trái), thả bom chìm ở đuôi (chuột phải).", [0, D + 6.7, 9.4], 0, ["torpedo", "depth"], true),
      role("gunner", "Pháo thủ", "Hai tháp pháo 127 ly: ngắm mặt biển, chuột trái bắn.", [0, D + 3.4, 3], 0, ["ddGun"]),
      role("aa", "Phòng không", "Ba ổ phòng không: máy bay, tên lửa, lính trên boong địch.", [-2.6, D, -9], -Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(L, D, B),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 450, at: [0, D + 4.5, 9], r: 3.5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 500, at: [0, D, -4], r: 4.5 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 180, at: [0, D + 11, 6], r: 2.5 },
      { id: "g1", name: "Tháp pháo mũi", kind: "turret", hp: 380, at: g1.pivot, r: 3, mount: g1 },
      { id: "g2", name: "Tháp pháo đuôi", kind: "turret", hp: 380, at: g2.pivot, r: 3, mount: g2 },
      { id: "tp1", name: "Ống phóng ngư lôi", kind: "torpedo", hp: 260, at: tpm.pivot, r: 2.5, mount: tpm },
      { id: "dc", name: "Giá bom chìm", kind: "depth", hp: 220, at: dc.pivot, r: 2.5, mount: dc },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 150, at: m.pivot, r: 2, mount: m })),
    ],
    boxes,
  };
}

function cruiser(): ShipClass {
  const L = 80;
  const B = 13;
  const D = 4.5;
  const boxes: ShipBox[] = [];
  hull(L, B, D, 5, boxes);
  // Hai cụm giếng phóng thẳng đứng (VLS) phẳng mặt boong (mũi, đuôi).
  const vls = (z: number): ShipMount => ({ weapon: "missile", pivot: [0, D + 0.3, z], rest: 0, arc: Math.PI, barrels: 1, barrel: 1 });
  const v1 = vls(22);
  const v2 = vls(-25);
  for (const [id, m] of [
    ["v1", v1],
    ["v2", v2],
  ] as const)
    boxes.push({ x: 0, y: D + 0.15, z: m.pivot[2], w: 5, h: 0.3, d: 6, mat: "dark", solid: true, part: id });
  block(boxes, 0, D, 1, 9, 4, 22, "mid");
  block(boxes, 0, D + 4, 5, 7, 3.4, 9, "bridge", "glass");
  boxes.push({ x: 0, y: D + 7.55, z: 5, w: 7.6, h: 0.3, d: 9.6, mat: "deck", solid: true, part: "bridge" });
  block(boxes, 0, D + 7.7, 1, 3, 4, 3, "radar", "steel");
  boxes.push({ x: 0, y: D + 12.2, z: 1, w: 4.6, h: 1.4, d: 0.4, mat: "accent", solid: true, part: "radar" });
  ramp(boxes, 5.2, D, D + 4, -12, -6, 1.2);
  ramp(boxes, -2.6, D + 4, D + 7.7, -3, 0.4, 1.2);
  const aa = (x: number, y: number, z: number, rest: number, arc: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc, barrels: 1, barrel: 2.2 });
  const aas = [aa(0, D + 8.2, 10.5, 0, 2.6), aa(4.6, D + 4.6, -8, Math.PI / 2, 1.9), aa(-4.6, D + 4.6, -8, -Math.PI / 2, 1.9)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.5, z: m.pivot[2], w: 1.8, h: 1, d: 1.8, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const dec: ShipMount = { weapon: "decoy", pivot: [3.6, D + 4.5, 2], rest: Math.PI / 2, arc: Math.PI, barrels: 2, barrel: 1 };
  boxes.push({ x: 3.6, y: D + 4.3, z: 2, w: 1.4, h: 0.6, d: 1.4, mat: "dark", solid: true, part: "decoy" });
  return {
    id: "cruiser",
    name: "Tàu tên lửa",
    brief: "Hai cụm giếng phóng tên lửa chống hạm: người phóng nhìn từ đầu tên lửa, tự lái vào mục tiêu (tên lửa bay chậm, phòng không bắn hạ được). Hoa tiêu lái tàu, phóng mồi nhử, ra-đa soi tàu ngầm.",
    hp: 3000,
    length: L,
    beam: B,
    deck: D,
    draft: 5,
    speed: 15,
    reverse: 4.5,
    accel: 1.3,
    turn: 0.1,
    roles: [
      role("navigator", "Hoa tiêu", "Lái tàu; chuột phải phóng mồi nhử (lừa tên lửa, ngư lôi địch); ra-đa soi tàu ngầm trong 450 m.", [0, D + 7.7, 7.5], 0, ["decoy"], true),
      role("missile", "Sĩ quan tên lửa", "Chuột trái phóng tên lửa, nhìn từ đầu tên lửa, rê chuột lái vào tàu địch. Tránh lưới phòng không.", [0, D + 4, -2], 0, ["missile"]),
      role("aa", "Phòng không", "Ba ổ pháo bắn nhanh: máy bay, tên lửa, lính trên boong địch.", [-4, D, -14], -Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(L, D, B),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 550, at: [0, D + 5.5, 5], r: 4 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 600, at: [0, D, -6], r: 5 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 260, at: [0, D + 11, 1], r: 2.8 },
      { id: "v1", name: "Giếng phóng mũi", kind: "vls", hp: 480, at: v1.pivot, r: 3.4, mount: v1 },
      { id: "v2", name: "Giếng phóng đuôi", kind: "vls", hp: 480, at: v2.pivot, r: 3.4, mount: v2 },
      { id: "decoy", name: "Ống phóng mồi nhử", kind: "decoy", hp: 200, at: dec.pivot, r: 1.6, mount: dec },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 160, at: m.pivot, r: 1.8, mount: m })),
    ],
    boxes,
  };
}

function carrier(): ShipClass {
  const L = 118;
  const B = 18;
  const D = 12;
  const boxes: ShipBox[] = [];
  hull(L, B, 8, 7, boxes, 0.4);
  // Nhà chứa máy bay (tường hai bên) và sàn bay rộng chìa ra hai mạn.
  for (const side of [-1, 1]) boxes.push({ x: side * 8.5, y: 10, z: -2, w: 1, h: 4, d: L * 0.72, mat: "steel", solid: true, part: "mid" });
  boxes.push({ x: 0, y: D - 0.4, z: 1, w: 28, h: 0.8, d: L - 6, mat: "flight", solid: true, part: "mid" });
  for (const side of [-1, 1]) boxes.push({ x: side * 13.9, y: D + 0.5, z: 1, w: 0.1, h: 1, d: L - 10, mat: "rail", solid: true });
  // Đảo chỉ huy bên mạn phải.
  block(boxes, -10, D, -4, 6, 6, 22, "bridge", "steel");
  block(boxes, -10, D + 6, -2, 5, 3.4, 10, "bridge", "glass");
  boxes.push({ x: -10, y: D + 9.55, z: -2, w: 5.6, h: 0.3, d: 10.6, mat: "deck", solid: true, part: "bridge" });
  boxes.push({ x: -10, y: D + 13, z: -4, w: 0.5, h: 7, d: 0.5, mat: "dark", solid: true, part: "radar" });
  block(boxes, -10, D + 6, -11, 3.6, 5, 4, "engine", "dark");
  ramp(boxes, -6.4, D, D + 6, -20, -12, 1.4);
  ramp(boxes, -11.6, D + 6, D + 9.7, 4.2, 7.6, 1.2);
  // Máy phóng (catapult) ở mũi, đường băng sơn vạch.
  const cat: ShipMount = { weapon: "jetGun", pivot: [4, D + 0.1, 36], rest: 0, arc: 0.1, barrels: 1, barrel: 1 };
  boxes.push({ x: 4, y: D + 0.05, z: 36, w: 1.2, h: 0.1, d: 26, mat: "accent", solid: false, part: "cat" });
  const aa = (x: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, D + 0.9, z], rest, arc: 1.7, barrels: 2, barrel: 2.4 });
  const aas = [aa(13, 34, Math.PI / 2), aa(-13, 34, -Math.PI / 2), aa(13, -8, Math.PI / 2), aa(-13.2, 12, -Math.PI / 2), aa(12, -46, Math.PI * 0.75), aa(-12, -46, -Math.PI * 0.75)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.45, z: m.pivot[2], w: 2, h: 0.9, d: 2, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const tp = (side: number): ShipMount => ({ weapon: "torpedo", pivot: [side * 9.2, 6, -26], rest: (side * Math.PI) / 2, arc: 0.85, barrels: 2, barrel: 4 });
  return {
    id: "carrier",
    name: "Tàu sân bay",
    brief: "Phi công cất cánh tiêm kích bom từ sàn bay (súng 20 ly, ba quả bom 500 kg, bay sát tàu mẹ để nạp lại). Sáu ổ súng phòng không. Thuyền trưởng lái tàu, bắn ngư lôi.",
    hp: 4600,
    length: L,
    beam: 28,
    deck: D,
    draft: 7,
    speed: 13,
    reverse: 4,
    accel: 0.9,
    turn: 0.065,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu (W/S tốc độ, A/D bẻ lái), bắn ngư lôi hai mạn (chuột trái).", [-10, D + 9.7, 0], 0, ["torpedo"], true),
      role("pilot", "Phi công", "Đứng ở máy phóng, chuột trái cất cánh. Bay theo hướng chuột, W/S ga, chuột trái súng, chuột phải thả bom, F bỏ máy bay.", [6.5, D, 30], 0, ["jetGun", "bomb"]),
      role("aa", "Phòng không", "Sáu ổ súng máy phòng không: bắn máy bay, tên lửa, lính trên boong địch.", [8, D, -14], Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(L, 8, B),
      { id: "bridge", name: "Đảo chỉ huy", kind: "bridge", hp: 650, at: [-10, D + 6, -2], r: 5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 750, at: [0, 6, -10], r: 7 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 240, at: [-10, D + 15, -4], r: 2.5 },
      { id: "cat", name: "Máy phóng", kind: "catapult", hp: 520, at: cat.pivot, r: 5, mount: cat },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 160, at: m.pivot, r: 2, mount: m })),
      { id: "tp1", name: "Ống phóng ngư lôi trái", kind: "torpedo", hp: 260, at: tp(1).pivot, r: 2.5, mount: tp(1) },
      { id: "tp2", name: "Ống phóng ngư lôi phải", kind: "torpedo", hp: 260, at: tp(-1).pivot, r: 2.5, mount: tp(-1) },
    ],
    boxes,
  };
}

function submarine(): ShipClass {
  const L = 64;
  const B = 7;
  const D = 1.6;
  const boxes: ShipBox[] = [];
  hull(L, B, D, 6, boxes, 0.2);
  // Tháp chỉ huy (sail), kính tiềm vọng, thang lên.
  block(boxes, 0, D, 8, 3, 5, 9, "bridge", "hull");
  boxes.push({ x: 0, y: D + 5.15, z: 8, w: 3.4, h: 0.3, d: 9.4, mat: "deck", solid: true, part: "bridge" });
  boxes.push({ x: 0, y: D + 7, z: 9.5, w: 0.3, h: 3.4, d: 0.3, mat: "dark", solid: true, part: "scope" });
  ramp(boxes, 0, D, D + 5.3, -3, 3.5, 1.1);
  const bow: ShipMount = { weapon: "torpedo", pivot: [0, -1.5, L / 2 - 2], rest: 0, arc: 0.6, barrels: 2, barrel: 2 };
  const gt = (z: number, rest: number): ShipMount => ({ weapon: "gtorpedo", pivot: [0, -1.5, z], rest, arc: 0.4, barrels: 1, barrel: 2 });
  const g1 = gt(L / 2 - 4, 0);
  const g2 = gt(-L / 2 + 3, Math.PI);
  return {
    id: "submarine",
    name: "Tàu ngầm",
    brief: "Lặn (C) để tàng hình, tránh pháo và tên lửa (chỉ ngư lôi, bom chìm, đạn nổ sát mới trúng); dưỡng khí có hạn. Hai sĩ quan ngư lôi dẫn đường lái ngư lôi bằng chuột; thuyền trưởng ngắm kính tiềm vọng bắn ngư lôi thẳng.",
    hp: 1900,
    length: L,
    beam: B,
    deck: D,
    draft: 6,
    speed: 11,
    reverse: 3.5,
    accel: 1,
    turn: 0.11,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu, C lặn / nổi, ngắm kính tiềm vọng bắn hai ngư lôi mũi (chuột trái).", [0, D + 5.3, 9], 0, ["torpedo"], true),
      role("torpedo", "Sĩ quan ngư lôi mũi", "Chuột trái phóng ngư lôi dẫn đường, rê chuột lái theo mục tiêu.", [0, D, 16], 0, ["gtorpedo"]),
      role("torpedo", "Sĩ quan ngư lôi đuôi", "Chuột trái phóng ngư lôi dẫn đường từ đuôi, rê chuột lái theo mục tiêu.", [0, D, -10], Math.PI, ["gtorpedo"]),
    ],
    parts: [
      ...sections(L, D, B),
      { id: "bridge", name: "Tháp chỉ huy", kind: "bridge", hp: 420, at: [0, D + 3, 8], r: 3.5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 450, at: [0, -1, -12], r: 4 },
      { id: "scope", name: "Kính tiềm vọng", kind: "periscope", hp: 150, at: [0, D + 7, 9.5], r: 1.6 },
      { id: "tb", name: "Ống ngư lôi mũi", kind: "torpedo", hp: 300, at: bow.pivot, r: 2.5, mount: bow },
      { id: "gt1", name: "Ống dẫn đường mũi", kind: "torpedo", hp: 260, at: g1.pivot, r: 2.2, mount: g1 },
      { id: "gt2", name: "Ống dẫn đường đuôi", kind: "torpedo", hp: 260, at: g2.pivot, r: 2.2, mount: g2 },
    ],
    boxes,
  };
}

export const SHIPS: Record<ShipClassId, ShipClass> = {
  battleship: battleship(),
  carrier: carrier(),
  cruiser: cruiser(),
  submarine: submarine(),
  destroyer: destroyer(),
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
    if (b.pitch) y = b.y + Math.tan(-b.pitch) * (lz - b.z);
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
  for (let dz = -10; dz <= 10; dz++) {
    for (let dx = -8; dx <= 8; dx++) {
      const x = ax + dx;
      const z = az + dz;
      if (Math.abs(x) > cls.beam / 2 - 0.6 || Math.abs(z) > cls.length / 2 - 2) continue;
      const floor = deckBelow(cls, x, Math.max(ay, cls.deck) + 2, z);
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

export const NAVAL_HALF = 720;

/** Đảo đá giữa biển (che ngư lôi, tên lửa bay thấp, tàu nấp sau). */
export const NAVAL_ISLETS: readonly { x: number; z: number; r: number; h: number }[] = [
  { x: -40, z: 160, r: 46, h: 22 },
  { x: 90, z: -190, r: 38, h: 16 },
  { x: -170, z: -60, r: 26, h: 12 },
  { x: 190, z: 90, r: 30, h: 14 },
  { x: 0, z: -20, r: 18, h: 9 },
  { x: -320, z: 300, r: 34, h: 18 },
  { x: 330, z: -310, r: 34, h: 18 },
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

/** Bản đồ hải chiến: biển sâu 1 440 × 1 440 m, vài đảo đá ở giữa; hai tàu xuất phát hai đầu đông tây. */
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
  blue: { x: -520, z: -60, rotY: Math.PI / 2 },
  red: { x: 520, z: 60, rotY: -Math.PI / 2 },
} as const;
