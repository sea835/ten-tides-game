// Phần tính toán thuần (không đụng Web Audio) của âm thanh 2.0: điểm đường đạn gần tai nhất, thời điểm tiếng nứt
// siêu thanh và tiếng nổ đầu nòng tới tai, phân loại môi trường quanh một điểm (phố, đồi trống, rừng, trong nhà) để
// chỉnh đuôi vang, tiếng dội từ vách, và đường bao giảm tiếng khi ù tai. Tách riêng để kiểm thử được.

/** Vận tốc âm thanh (m/s). */
export const SPEED_OF_SOUND = 343;
/** Độ trễ tối đa của tiếng (không để tiếng đến quá muộn so với hình), giống guns.ts. */
export const MAX_SOUND_DELAY = 1.1;
/** Đạn bay ngang trong chừng này mét thì nghe tiếng nứt siêu thanh. */
export const CRACK_RANGE = 12;
/** Sát hơn chừng này mét: tiếng "chát" ngay mang tai, giật mình, rung màn hình. */
export const SNAP_RANGE = 1;
/** Sát hơn chừng này mét: tiếng rít "víu" lệch theo bên đạn bay. */
export const WHIZ_RANGE = 4;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------- đường đạn sượt qua

export interface Approach {
  /** Quãng đường đạn đã bay tới điểm gần nhất (m, tính từ đầu nòng). */
  t: number;
  /** Khoảng cách từ điểm gần nhất tới tai (m). */
  miss: number;
  /** Điểm gần nhất. */
  x: number;
  y: number;
  z: number;
  /** Độ dài cả đoạn đường đạn. */
  len: number;
}

/** Điểm trên đoạn thẳng đầu nòng (o) → điểm cuối (e) gần tai (l) nhất. Ghi vào `out` nếu có (khỏi tạo rác). */
export function closestApproach(
  ox: number, oy: number, oz: number,
  ex: number, ey: number, ez: number,
  lx: number, ly: number, lz: number,
  out: Approach = { t: 0, miss: 0, x: 0, y: 0, z: 0, len: 0 },
): Approach {
  const dx = ex - ox;
  const dy = ey - oy;
  const dz = ez - oz;
  const len = Math.hypot(dx, dy, dz);
  const k = len > 1e-6 ? 1 / len : 0;
  const t = clamp(((lx - ox) * dx + (ly - oy) * dy + (lz - oz) * dz) * k, 0, len);
  out.t = t;
  out.len = len;
  out.x = ox + dx * k * t;
  out.y = oy + dy * k * t;
  out.z = oz + dz * k * t;
  out.miss = Math.hypot(out.x - lx, out.y - ly, out.z - lz);
  return out;
}

export type FlybyZone = "snap" | "whiz" | "crack" | "none";

export interface FlybyTiming {
  /** Đạn nhanh hơn âm thanh (và không giảm thanh): có tiếng nứt "CHÁT!". */
  supersonic: boolean;
  /** Lúc tiếng nứt / tiếng rít tới tai (giây kể từ lúc bắn): đạn bay tới điểm gần nhất rồi tiếng đi nốt quãng `miss`. */
  crackDelay: number;
  /** Lúc tiếng nổ đầu nòng tới tai (giây): khoảng cách người bắn / 343, có trần. */
  reportDelay: number;
  zone: FlybyZone;
}

/**
 * Thời điểm và loại tiếng khi đạn bay ngang tai. `along`, `miss`, `passes` lấy từ `closestApproach` (`passes`: đạn
 * thật sự bay qua điểm đó chứ không găm trước), `shooterDist` là khoảng cách đầu nòng → tai.
 * Đạn siêu thanh: tiếng nứt tới trước, tiếng nổ đầu nòng tới sau theo khoảng cách (luôn sau tiếng nứt dù có trần
 * độ trễ). Đạn cận âm (súng lục/tiểu liên chậm) hay bắn giảm thanh: không nứt, chỉ rít khi rất gần.
 */
export function flybyTiming(along: number, miss: number, passes: boolean, shooterDist: number, velocity: number, suppressed: boolean, minAlong = 4): FlybyTiming {
  const supersonic = velocity > SPEED_OF_SOUND && !suppressed;
  const reportDelay = Math.min(MAX_SOUND_DELAY, Math.max(0, shooterDist) / SPEED_OF_SOUND);
  let crackDelay = Math.max(0, along) / Math.max(1, velocity) + miss / SPEED_OF_SOUND;
  // Có trần độ trễ cho tiếng nổ: tiếng nứt vẫn phải tới trước nó.
  if (supersonic) crackDelay = Math.min(crackDelay, Math.max(0, reportDelay - 0.02));
  else crackDelay = Math.min(crackDelay, MAX_SOUND_DELAY);
  let zone: FlybyZone = "none";
  if (along > minAlong) {
    if (miss < SNAP_RANGE) zone = "snap";
    else if (miss < WHIZ_RANGE) zone = "whiz";
    else if (supersonic && passes && miss < CRACK_RANGE) zone = "crack";
  }
  return { supersonic, crackDelay, reportDelay, zone };
}

// ---------------------------------------------------------------------------- môi trường quanh điểm bắn / nghe

export type Acoustic = "open" | "hilltop" | "forest" | "urban" | "indoor";

/** Số hướng dò tường quanh một điểm (đều nhau, hướng k: góc k·2π/N, vector (cos, sin) trên mặt x–z). */
export const PROBE_DIRS = 8;
/** Dò tường xa tối đa (m). */
export const PROBE_REACH = 40;

export interface EnvProbe {
  /** Khoảng cách tới khối đặc gần nhất theo từng hướng (Infinity nếu không chạm trong `PROBE_REACH`). */
  walls: ArrayLike<number>;
  /** Khoảng cách tới trần / mái ngay trên đầu (Infinity nếu trời trống). */
  roof: number;
  /** Số cây quanh trong 15 m. */
  trees: number;
  /** Mặt đất ở đây cao hơn trung bình xung quanh (vòng 35 m) bao nhiêu mét. */
  rise: number;
}

/** Phân loại: trong nhà (có mái, tường kín), phố (nhiều vách quanh), rừng, đỉnh đồi trống, hay bãi trống. */
export function classifyEnvironment(p: EnvProbe): Acoustic {
  let near = 0;
  let mid = 0;
  for (let i = 0; i < p.walls.length; i++) {
    const w = p.walls[i]!;
    if (w < 12) near++;
    if (w < 30) mid++;
  }
  const n = Math.max(1, p.walls.length);
  if (p.roof < 8 && near >= Math.ceil(n * 0.6)) return "indoor";
  if (mid >= Math.ceil(n * 0.375)) return "urban";
  if (p.trees >= 8) return "forest";
  if (p.rise > 6 && mid <= 1) return "hilltop";
  return "open";
}

export interface EnvShape {
  /** Nhân độ to đuôi vang ngoài trời. */
  tail: number;
  /** Nhân lượng gửi sang hồi âm chung. */
  reverb: number;
  /** Đuôi vang bị cắt sau `hold` giây, tắt trong `fade` giây (Infinity: để tự tắt). */
  hold: number;
  fade: number;
  /** Lọc thấp đuôi vang (Hz): rừng nuốt cao tần. */
  cut: number;
  /** Độ "ùng" của phản xạ sớm dày đặc trong phòng (0 = không). */
  boom: number;
  /** Độ to tiếng dội rời từ vách (0 = không). */
  slap: number;
}

export const ENV_SHAPE: Record<Acoustic, EnvShape> = {
  open: { tail: 1, reverb: 1, hold: Infinity, fade: 0, cut: 20000, boom: 0, slap: 0 },
  // Đỉnh đồi: không có gì dội lại, tiếng súng khô và tan nhanh vào không trung.
  hilltop: { tail: 0.5, reverb: 0.35, hold: 0.3, fade: 0.45, cut: 6000, boom: 0, slap: 0 },
  // Rừng: lá cây nuốt cao tần, đuôi khuếch tán dày hơn chút.
  forest: { tail: 0.95, reverb: 1.25, hold: Infinity, fade: 0, cut: 2600, boom: 0, slap: 0.25 },
  // Phố: tiếng dội rời "đét đét" từ các bức tường quanh.
  urban: { tail: 0.85, reverb: 0.85, hold: Infinity, fade: 0, cut: 20000, boom: 0, slap: 0.55 },
  // Trong nhà: ùng ục, vang ngắn, không có đuôi ngoài trời.
  indoor: { tail: 0.35, reverb: 0.3, hold: 0.22, fade: 0.3, cut: 2200, boom: 0.85, slap: 0.4 },
};

export interface EchoTap {
  /** Trễ so với tiếng thẳng (giây). */
  delay: number;
  gain: number;
  pan: number;
}

/**
 * Tiếng dội rời từ các vách quanh điểm bắn: mỗi vách cách `d` mét dội lại sau 2d/343 giây (đi tới vách rồi về), nhỏ
 * dần theo khoảng cách, lệch trái phải theo hướng vách so với hướng nhìn `yaw` của người nghe. Lấy tối đa `max` vách
 * gần nhất, bỏ các tiếng dội quá sát nhau (dưới 12 ms nghe như một).
 */
export function echoTaps(walls: ArrayLike<number>, yaw: number, strength: number, max = 3, minDist = 1.5): EchoTap[] {
  const out: EchoTap[] = [];
  if (strength <= 0) return out;
  const n = walls.length;
  // Chọn dần vách gần nhất chưa lấy (n nhỏ nên làm thẳng tay, khỏi sắp xếp).
  let used = 0;
  while (out.length < max) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = walls[i]!;
      if (used & (1 << i) || !(d >= minDist) || d >= bestD) continue;
      best = i;
      bestD = d;
    }
    if (best < 0) break;
    used |= 1 << best;
    const delay = (2 * bestD) / SPEED_OF_SOUND;
    if (out.some((o) => Math.abs(o.delay - delay) < 0.012)) continue;
    const a = (best / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    out.push({ delay, gain: (strength * 0.6) / (1 + bestD / 12), pan: clamp(right * 0.8, -0.8, 0.8) });
  }
  return out;
}

// ---------------------------------------------------------------------------- giảm tiếng (ù tai, bị áp chế)

export interface Duck {
  /** Lúc bắt đầu (giây, đồng hồ bất kỳ). */
  start: number;
  /** Tổng thời gian (giây). */
  seconds: number;
  /** Độ giảm tối đa (0–1). */
  depth: number;
  /** Thời gian giảm xuống (giây). */
  attack: number;
}

/** Độ giảm (0–1) của một lần giảm tiếng ở thời điểm `now`: giảm nhanh, giữ ~30% thời gian rồi hồi dần về 0. */
export function duckAt(x: Duck, now: number): number {
  const s = now - x.start;
  if (s < 0 || s >= x.seconds) return 0;
  if (s < x.attack) return x.depth * (s / x.attack);
  const hold = Math.max(x.attack, x.seconds * 0.3);
  if (s < hold) return x.depth;
  return x.depth * Math.max(0, 1 - (s - hold) / Math.max(0.1, x.seconds - hold));
}
