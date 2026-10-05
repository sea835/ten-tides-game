// Vũ khí cố định (công sự đặt sẵn trên bản đồ, không chạy được): ổ đại liên sau vòng bao cát ("hmg_nest", giá ba
// chân, xoay được ~120° trước mặt) và cối 82 ly ("mortar", bắn cầu vồng gián tiếp). Dùng chung hệ ghế của xe chở
// quân (VehicleState, ghế 0 là xạ thủ). Ở đây có: thông số, kẹp góc xoay / góc ngẩng, đạn đạo cối (tầm bắn theo góc
// ngẩng, góc ngẩng theo tầm, điểm rơi dự đoán theo địa hình), chọn chỗ đặt trên chiến trường và đảo sinh tồn.

import { WEAPON, BULLET_GRAVITY, type WeaponDef } from "./battleItems.ts";
import { boxesNear, type BattleMap } from "./battle.ts";

type V3 = readonly [number, number, number];

export const EMPLACEMENT_KINDS = ["hmg_nest", "mortar"] as const;
export type EmplacementKind = (typeof EMPLACEMENT_KINDS)[number];

/** Loại xe này có phải vũ khí cố định không (không lái được, xạ thủ lộ nửa người trên ra ngoài). */
export function isEmplacement(kind: string): kind is EmplacementKind {
  return kind === "hmg_nest" || kind === "mortar";
}

/**
 * Ổ đại liên: vòng bao cát cao ~1 m (chặn đạn thẳng vào chân, bụng xạ thủ; đầu, vai vẫn lộ), đại liên trên giá ba
 * chân xoay được `arc` rad quanh hướng đặt (`rotY`). Đạn thường gần như không làm hư bao cát; nổ thì có.
 */
export const NEST = {
  hp: 360,
  /** Nửa kích thước vòng bao cát: ngang, cao, dọc. Gốc ở mặt đất, giữa ổ. */
  half: [1.3, 0.5, 1.3] as const,
  enter: 2.8,
  bulletFactor: 0.06,
  blastFactor: 1.1,
  /** Góc xoay ngang tổng cộng (rad), chia đều hai bên hướng đặt. */
  arc: (120 * Math.PI) / 180,
  /** Trụ xoay đại liên (toạ độ riêng của ổ), chỗ xạ thủ đứng (sau súng). */
  mount: [0, 1.3, 0.35] as V3,
  seat: [0, 0.5, -0.6] as V3,
} as const;

/**
 * Cối 82 ly: ống trên giá hai chân, đế tì. Xạ thủ chỉnh phương vị (xoay đủ vòng) và góc ngẩng 45°–85°; đạn bay cầu
 * vồng theo trọng lực (server mô phỏng), nổ bán kính `radius` m. Nạp đạn `reload` giây mỗi phát.
 */
export const MORTAR = {
  hp: 220,
  half: [0.9, 0.35, 0.9] as const,
  enter: 2.6,
  bulletFactor: 0.12,
  blastFactor: 1.2,
  /** Sơ tốc (m/s): ở 45° bay xa chừng 300 m trên đất bằng. */
  velocity: 54,
  elevMin: (45 * Math.PI) / 180,
  elevMax: (85 * Math.PI) / 180,
  reload: 3,
  radius: 6,
  /** Sát thương người ở tâm nổ, thêm vào xe trúng thẳng. */
  damage: 120,
  armor: 180,
  /** Lệch ngẫu nhiên mỗi phát (rad) theo phương vị và góc ngẩng: cối không bắn trúng tuyệt đối. */
  spread: 0.006,
  /** Gốc ống (toạ độ riêng: giữa đế), dài ống (m), chỗ xạ thủ quỳ. */
  mount: [0, 0.3, 0] as V3,
  tube: 1.2,
  seat: [0, 0.5, -0.95] as V3,
  /** Đạn sắp rơi trong chừng này giây thì mọi người quanh đó nghe tiếng rít. */
  whistle: 2.2,
  /** Đạn bay lâu quá chừng này giây (rơi ra biển xa...) thì bỏ. */
  maxFlight: 25,
} as const;

/** Đạn cối trong bảng súng (bảng hạ gục, tên vũ khí); giá 0 nên không mua, không rơi ra đất. */
const { boost: _boost, ...RPG } = WEAPON.get("rpg7")!;
export const MORTAR_WEAPON: WeaponDef = {
  ...RPG,
  id: "mortar",
  name: "Cối 82mm",
  velocity: MORTAR.velocity,
  explosive: { radius: MORTAR.radius, damage: MORTAR.damage, armor: MORTAR.armor },
  mag: 0,
  price: 0,
  rare: true,
};
if (!WEAPON.has(MORTAR_WEAPON.id)) (WEAPON as Map<string, WeaponDef>).set(MORTAR_WEAPON.id, MORTAR_WEAPON);

/** Thông số chung theo loại vũ khí cố định (cùng dạng vehicleSpec). */
export function emplacementSpec(kind: EmplacementKind) {
  const k = kind === "mortar" ? MORTAR : NEST;
  return { hp: k.hp, half: k.half, enter: k.enter, bulletFactor: k.bulletFactor, blastFactor: k.blastFactor, forward: 0, seats: 1 };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Kẹp hướng xoay đại liên (thế giới) trong cung `NEST.arc` quanh hướng đặt ổ `rotY`. Cối xoay đủ vòng. */
export function clampTraverse(kind: string, rotY: number, yaw: number): number {
  if (kind !== "hmg_nest") return yaw;
  const half = NEST.arc / 2;
  const d = wrap(yaw - rotY);
  return rotY + Math.max(-half, Math.min(half, d));
}

/** Hướng `yaw` có nằm trong cung xoay của ổ (nới `slack` rad cho trễ mạng) không. */
export function inTraverse(kind: string, rotY: number, yaw: number, slack = 0): boolean {
  if (kind !== "hmg_nest") return true;
  return Math.abs(wrap(yaw - rotY)) <= NEST.arc / 2 + slack;
}

/** Kẹp góc ngẩng cối trong [45°, 85°]. */
export function clampElevation(elev: number): number {
  return Math.max(MORTAR.elevMin, Math.min(MORTAR.elevMax, elev));
}

/**
 * Tầm bắn cối (m, theo mặt bằng) ở góc ngẩng `elev`: đạn rơi xuống độ cao thấp hơn đầu nòng `drop` mét (âm là mục
 * tiêu cao hơn). Không với tới (mục tiêu cao quá) thì 0. Không tính sức cản không khí.
 */
export function mortarRange(elev: number, drop = 0, velocity: number = MORTAR.velocity, g = BULLET_GRAVITY): number {
  const vy = velocity * Math.sin(elev);
  const disc = vy * vy + 2 * g * drop;
  if (disc < 0) return 0;
  const t = (vy + Math.sqrt(disc)) / g;
  return velocity * Math.cos(elev) * t;
}

/** Thời gian bay (s) tới chỗ rơi ở góc ngẩng `elev`, độ thấp hơn đầu nòng `drop`. */
export function mortarFlightTime(elev: number, drop = 0, velocity: number = MORTAR.velocity, g = BULLET_GRAVITY): number {
  const vy = velocity * Math.sin(elev);
  const disc = vy * vy + 2 * g * drop;
  return disc < 0 ? 0 : (vy + Math.sqrt(disc)) / g;
}

/**
 * Góc ngẩng (nhánh cao, trong [45°, 85°]) để đạn rơi cách `range` m: dò nhị phân (tầm giảm dần khi ngẩng lên trên
 * 45°). null nếu ngoài tầm (quá xa hay quá gần).
 */
export function mortarElevationFor(range: number, drop = 0): number | null {
  let lo = MORTAR.elevMin;
  let hi = MORTAR.elevMax;
  if (range > mortarRange(lo, drop) || range < mortarRange(hi, drop)) return null;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (mortarRange(mid, drop) > range) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Hướng nòng cối (đơn vị) theo phương vị `az` (thế giới) và góc ngẩng `elev`. */
export function mortarDir(az: number, elev: number): [number, number, number] {
  const c = Math.cos(elev);
  return [Math.sin(az) * c, Math.sin(elev), Math.cos(az) * c];
}

/** Gốc ống cối và đầu nòng trong thế giới (đế cối nằm giữa ổ nên không phụ thuộc hướng đặt). */
export function mortarMuzzle(v: { x: number; y: number; z: number }, az: number, elev: number): { pivot: [number, number, number]; o: [number, number, number]; d: [number, number, number] } {
  const pivot: [number, number, number] = [v.x + MORTAR.mount[0], v.y + MORTAR.mount[1], v.z + MORTAR.mount[2]];
  const d = mortarDir(az, elev);
  return { pivot, o: [pivot[0] + d[0] * MORTAR.tube, pivot[1] + d[1] * MORTAR.tube, pivot[2] + d[2] * MORTAR.tube], d };
}

/**
 * Điểm rơi dự đoán (chỉ tính địa hình, không tính nhà cửa): bay từng bước `step` giây từ đầu nòng `o` theo hướng
 * `d`, gặp mặt đất (hay mặt nước) thì dừng. Dùng cho dấu điểm rơi trên màn hình xạ thủ.
 */
export function mortarImpact(map: BattleMap, o: V3, d: V3, velocity: number = MORTAR.velocity, step = 0.05): { x: number; y: number; z: number; t: number } {
  let x = o[0];
  let y = o[1];
  let z = o[2];
  const vx = d[0] * velocity;
  let vy = d[1] * velocity;
  const vz = d[2] * velocity;
  for (let t = 0; t < MORTAR.maxFlight; t += step) {
    const nx = x + vx * step;
    const nz = z + vz * step;
    const ny = y + vy * step - 0.5 * BULLET_GRAVITY * step * step;
    vy -= BULLET_GRAVITY * step;
    const ground = Math.max(0, map.world.heightAt(nx, nz));
    if (vy < 0 && ny <= ground) {
      // Nội suy chỗ chạm đất trong bước cuối.
      const g0 = Math.max(0, map.world.heightAt(x, z));
      const k = Math.max(0, Math.min(1, (y - g0) / Math.max(1e-6, y - g0 - (ny - ground))));
      return { x: x + (nx - x) * k, y: ground, z: z + (nz - z) * k, t: t + step * k };
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return { x, y, z, t: MORTAR.maxFlight };
}

// ---------------------------------------------------------------------------- chỗ đặt

/** Một vũ khí cố định đặt sẵn: loại, chỗ, hướng đặt (ổ đại liên chĩa về hướng này). */
export interface EmplacementSpot {
  kind: EmplacementKind;
  x: number;
  z: number;
  rotY: number;
}

/**
 * Đặt được vũ khí cố định ở (x, z) không: trên đất liền khô (cao hơn mặt nước), nền tương đối phẳng, không chồng lên
 * tường, nhà, bao cát, container (đường nhựa, biển báo mỏng thì không tính).
 */
export function emplacementFits(map: BattleMap, kind: EmplacementKind, x: number, z: number): boolean {
  const half = map.half ?? 240;
  if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) return false;
  const h = map.world.heightAt(x, z);
  if (h < 0.8) return false;
  const r = Math.hypot(emplacementSpec(kind).half[0], emplacementSpec(kind).half[2]) + 0.6;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const ph = map.world.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (ph < 0.6 || Math.abs(ph - h) > 0.9) return false;
  }
  for (const b of boxesNear(map.index, x, z, r + 6)) {
    if (b.h <= 0.3 || b.mat === "sign") continue;
    if (b.y - b.h / 2 > h + 2.5 || b.y + b.h / 2 < h + 0.1) continue;
    // Khoảng cách từ tâm ổ tới hộp xoay (theo mặt bằng) nhỏ hơn bán kính ổ là chồng lên nhau.
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    const dx = x - b.x;
    const dz = z - b.z;
    const u = dx * c - dz * s;
    const v = dx * s + dz * c;
    const du = Math.max(0, Math.abs(u) - b.w / 2);
    const dv = Math.max(0, Math.abs(v) - b.d / 2);
    if (Math.hypot(du, dv) < r) return false;
  }
  return true;
}

/**
 * Tìm chỗ đặt gần (x, z) nhất (dò theo các vòng tròn lớn dần, tối đa `maxR` m), cách các chỗ đã chọn `taken` ít nhất
 * 7 m. Tất định (không bốc thăm) để server, kiểm thử ra cùng kết quả.
 */
function nearestFit(map: BattleMap, kind: EmplacementKind, x: number, z: number, taken: readonly EmplacementSpot[], maxR = 24): { x: number; z: number } | null {
  for (let r = 0; r <= maxR; r += 1.5) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((r * Math.PI * 2) / 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (taken.some((t) => Math.hypot(t.x - px, t.z - pz) < 7)) continue;
      if (emplacementFits(map, kind, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Hướng (rotY) từ (ax, az) nhìn về (bx, bz). */
const facing = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az);

/**
 * Chỗ đặt vũ khí cố định trên bản đồ. Chiến trường: mỗi cứ điểm một ổ đại liên ở rìa vùng chiếm, chĩa về phía thị
 * trấn trung tâm (đường tiến quân chính); thị trấn trung tâm hai ổ chĩa ra hai phía tây, đông; mỗi căn cứ một ổ chĩa ra
 * mặt trận; cối 82 ly ở cứ điểm B, C (bắn được vào thị trấn trung tâm) và ở mỗi căn cứ. Đảo sinh tồn: vài ổ đại liên
 * ở rìa các khu (chĩa ra ngoài) và một khẩu cối ở pháo đài (nếu có).
 */
export function emplacementSpots(map: BattleMap): EmplacementSpot[] {
  const out: EmplacementSpot[] = [];
  const put = (kind: EmplacementKind, x: number, z: number, rotY: number, maxR?: number) => {
    const at = nearestFit(map, kind, x, z, out, maxR);
    if (at) out.push({ kind, x: at.x, z: at.z, rotY });
  };
  if (map.layout === "war") {
    const flags = map.flags ?? [];
    for (const f of flags) {
      if (Math.hypot(f.x, f.z) < 30) {
        // Thị trấn trung tâm: hai ổ chĩa ra hai phía.
        for (const s of [-1, 1]) put("hmg_nest", f.x + s * (f.r + 4), f.z, s > 0 ? Math.PI / 2 : -Math.PI / 2);
        continue;
      }
      const a = facing(f.x, f.z, 0, 0);
      put("hmg_nest", f.x + Math.sin(a) * (f.r + 3), f.z + Math.cos(a) * (f.r + 3), a);
      // Cối đặt phía sau cột cờ (xa mặt trận hơn), trong vùng chiếm.
      if (f.id === "B" || f.id === "C") put("mortar", f.x - Math.sin(a) * f.r * 0.7, f.z - Math.cos(a) * f.r * 0.7, a);
    }
    for (const x of [-262, 262]) {
      const a = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      put("hmg_nest", x + Math.sin(a) * 38, 10, a, 30);
      put("mortar", x - Math.sin(a) * 4, -34, a, 30);
    }
    return out;
  }
  const sites = map.sites.filter((s) => s.kind !== "minefield" && s.kind !== "port");
  let nests = 0;
  for (const s of sites) {
    if (nests >= 4) break;
    // Rìa khu phía quay vào giữa đảo (người chơi tới từ đó), ổ chĩa về phía đó.
    const out0 = Math.hypot(s.x, s.z) < 20 ? 0 : facing(0, 0, s.x, s.z);
    const a = out0 + Math.PI;
    const r = Math.max(s.rx, s.rz) + 5;
    const before = out.length;
    put("hmg_nest", s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, a, 18);
    if (out.length > before) nests++;
  }
  const fort = map.sites.find((s) => s.kind === "fortress");
  if (fort) put("mortar", fort.x, fort.z, 0, 30);
  return out;
}
