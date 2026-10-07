// Quán tính súng trước mặt (thủ tục, không cần hoạt ảnh): lia chuột nhanh thì súng trễ lại phía sau cú xoay và lăn
// nhẹ, rồi đuổi kịp bằng lò xo tắt dần (hơi vượt quá một chút); bước ngang thì súng nghiêng theo, tăng tốc thì súng
// lùi về phía người; đang bay thì súng nổi lên (rơi) hay trĩu xuống (bật lên); đáp đất thì nhún xuống ngực theo lực
// rơi rồi nảy lại. Lò xo giải bằng nghiệm giải tích nên cảm giác giống nhau ở 30 hay 240 khung hình/giây.
// Đang ngắm thì gần như tắt hết (thước ngắm đứng yên giữa màn hình).

/** Lò xo một chiều: vị trí, vận tốc. */
export interface Spring1 {
  x: number;
  v: number;
}

/**
 * Kéo lò xo về `target` với tần số góc `w` (rad/s) và hệ số tắt dần `zeta` (< 1: hơi nảy). Giải đúng nghiệm giải tích
 * trong một bước (đích giữ nguyên trong bước), nên độc lập tần số khung hình và không bao giờ vỡ khi bước dài.
 */
export function springTo(sp: Spring1, target: number, dt: number, w: number, zeta: number) {
  if (dt <= 0) return;
  const z = zeta < 0.999 ? zeta : 0.999;
  const x0 = sp.x - target;
  const v0 = sp.v;
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * dt);
  const c = Math.cos(wd * dt);
  const s = Math.sin(wd * dt);
  sp.x = target + e * (x0 * c + ((v0 + z * w * x0) / wd) * s);
  sp.v = e * (v0 * c - ((z * w * v0 + w * w * x0) / wd) * s);
}

const clamp = (v: number, a: number) => (v > a ? a : v < -a ? -a : v);

export interface Inertia {
  init: boolean;
  lastYaw: number;
  lastPitch: number;
  /** Trễ theo cú xoay chuột (ngang, dọc, lăn). */
  swayX: Spring1;
  swayY: Spring1;
  swayRoll: Spring1;
  /** Vận tốc đi (toạ độ camera) đã làm mượt bằng lò xo: chênh với vận tốc thật là phần súng "trễ" theo quán tính. */
  velX: Spring1;
  velZ: Spring1;
  /** Nổi / trĩu khi đang bay. */
  air: Spring1;
  /** Nhún khi đáp đất. */
  land: Spring1;
  landRoll: Spring1;
  /** Kết quả cộng vào súng (toạ độ camera): vị trí (m) và góc (rad). */
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

const sp = (): Spring1 => ({ x: 0, v: 0 });

export function newInertia(): Inertia {
  return {
    init: false,
    lastYaw: 0,
    lastPitch: 0,
    swayX: sp(),
    swayY: sp(),
    swayRoll: sp(),
    velX: sp(),
    velZ: sp(),
    air: sp(),
    land: sp(),
    landRoll: sp(),
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
  };
}

/** Đáp đất với độ nặng `power` (0–1, xem stance.land): đá lò xo nhún, lăn nhẹ ngẫu nhiên một bên. */
export function landKick(s: Inertia, power: number) {
  s.land.v -= 0.35 + power * 2.2;
  s.landRoll.v += (Math.random() < 0.5 ? -1 : 1) * power * 1.2;
}

/** Đặt lại mốc góc nhìn (khi súng vừa hiện lại) để không coi bước nhảy góc là một cú lia chuột. */
export function resetInertia(s: Inertia, yaw: number, pitch: number) {
  s.lastYaw = yaw;
  s.lastPitch = pitch;
  s.init = true;
}

/**
 * Cập nhật quán tính.
 * - `yaw`, `pitch`: góc nhìn đang vẽ (pitch dương là cúi xuống).
 * - `vx`, `vy`, `vz`: vận tốc của mình trong toạ độ camera (m/s; x phải, y lên, z lùi về sau).
 * - `aim`: mức ngắm (0–1); `airborne`: đang bay.
 */
export function updateInertia(s: Inertia, dt: number, yaw: number, pitch: number, vx: number, vy: number, vz: number, aim: number, airborne: boolean) {
  if (!s.init) resetInertia(s, yaw, pitch);
  let dYaw = yaw - s.lastYaw;
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const dPitch = pitch - s.lastPitch;
  s.lastYaw = yaw;
  s.lastPitch = pitch;
  const free = 1 - aim * 0.9;
  const inv = dt > 1e-4 ? 1 / dt : 0;
  // Tốc độ xoay (rad/s), chặn trần để cú vẩy 180° không ném súng ra khỏi màn hình.
  const wYaw = clamp(dYaw * inv, 12);
  const wPitch = clamp(dPitch * inv, 10);
  // Xoay sang trái (yaw tăng) thì súng trễ lại bên phải (+x), nòng lệch phải, đỉnh súng ngả về phía trễ.
  springTo(s.swayX, clamp(wYaw * 0.0075, 0.05) * free, dt, 15, 0.55);
  springTo(s.swayY, clamp(wPitch * 0.006, 0.035) * free, dt, 16, 0.6);
  springTo(s.swayRoll, clamp(-wYaw * 0.012, 0.12) * free, dt, 12, 0.5);

  // Quán tính đi lại: vận tốc mượt đuổi theo vận tốc thật, phần chênh đẩy súng ngược hướng tăng tốc.
  springTo(s.velX, vx, dt, 9, 0.8);
  springTo(s.velZ, vz, dt, 9, 0.8);
  const lagX = clamp(s.velX.x - vx, 6);
  const lagZ = clamp(s.velZ.x - vz, 8);
  // Đang bay: rơi thì súng nổi lên, bật lên thì súng trĩu xuống.
  springTo(s.air, airborne ? clamp(-vy * 0.0045, 0.035) * free : 0, dt, 10, 0.7);
  springTo(s.land, 0, dt, 12, 0.42);
  springTo(s.landRoll, 0, dt, 13, 0.45);

  const strafe = clamp(s.velX.x, 8);
  s.x = s.swayX.x + (lagX * 0.004 - strafe * 0.0015) * free;
  s.y = s.swayY.x + s.air.x + s.land.x * 0.055 * (1 - aim * 0.6);
  s.z = lagZ * 0.004 * free;
  // Nòng lệch theo trễ ngang / dọc; đáp đất thì chúc nòng.
  s.ry = -s.swayX.x * 1.4;
  s.rx = s.swayY.x * 1.2 - s.land.x * 0.07 * (1 - aim * 0.6) - s.air.x * 0.6;
  // Bước ngang thì súng nghiêng theo chiều đi.
  s.rz = s.swayRoll.x - strafe * 0.012 * free + s.landRoll.x * 0.04 * free;
}
