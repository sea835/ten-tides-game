// Điểm chi viện chiến thuật (scorestreak) của chế độ Chiến trường và Đồng đội: hạ gục, chiếm cứ điểm, tiếp tế, sửa xe,
// hồi sinh đồng đội, phá xe địch thì được điểm chiến thuật; điểm giữ qua các lần gục trong trận, tiêu để gọi chi viện:
// - UAV trinh sát (500): cả đội thấy mọi kẻ địch trên bản đồ nhỏ trong 20 giây, máy bay không người lái lượn trên trời.
// - Mưa pháo (1200): chấm toạ độ trên bản đồ, khói đỏ đánh dấu + còi báo động, rồi 5 loạt đạn pháo rơi xuống quanh đó.
// - Thùng chi viện đặc biệt (2000): thả dù tới chỗ chọn, trong là bộ giáp Juggernaut (kèm Minigun) hoặc tên lửa TOW.
// Dùng chung cho server (cộng điểm, kiểm tra, hẹn giờ) và client (bảng chọn, đếm giờ, âm thanh).

export type StreakId = "uav" | "artillery" | "airdrop";
export const STREAK_IDS: readonly StreakId[] = ["uav", "artillery", "airdrop"];

/** Sự kiện được điểm chiến thuật (trùng các loại XP, thêm phá xe địch). */
export type PointKind = "kill" | "headshot" | "capture" | "resupply" | "repair" | "revive" | "vehicle";

/** Điểm chiến thuật mỗi sự kiện. */
export const TACTICAL_POINTS: Record<PointKind, number> = {
  kill: 100,
  headshot: 125,
  capture: 250,
  resupply: 40,
  repair: 40,
  revive: 100,
  vehicle: 300,
};

export const POINT_LABEL: Record<PointKind, string> = {
  kill: "Hạ gục",
  headshot: "Hạ gục bằng phát vào đầu",
  capture: "Chiếm cứ điểm",
  resupply: "Tiếp tế đạn",
  repair: "Sửa xe",
  revive: "Hồi sinh đồng đội",
  vehicle: "Phá huỷ xe địch",
};

export function isPointKind(k: string): k is PointKind {
  return Object.prototype.hasOwnProperty.call(TACTICAL_POINTS, k);
}

/** Tối đa bao nhiêu điểm tích được (đủ gọi thùng chi viện và còn dư). */
export const MAX_POINTS = 5000;

export interface StreakDef {
  id: StreakId;
  name: string;
  /** Giá (điểm chiến thuật). */
  cost: number;
  /** Gọi xong phải chờ chừng này giây mới gọi lại được loại này (mỗi người). */
  cooldown: number;
  /** Có cần chấm toạ độ trên bản đồ không. */
  target: boolean;
  desc: string;
}

export const STREAKS: Record<StreakId, StreakDef> = {
  uav: { id: "uav", name: "UAV Trinh Sát", cost: 500, cooldown: 25, target: false, desc: "Cả đội thấy mọi kẻ địch trên bản đồ nhỏ trong 20 giây." },
  artillery: { id: "artillery", name: "Mưa Pháo Kích", cost: 1200, cooldown: 45, target: true, desc: "Chấm toạ độ: 5 loạt đạn pháo dội xuống quanh khói đỏ." },
  airdrop: { id: "airdrop", name: "Hòm Tiếp Tế Siêu Cấp", cost: 2000, cooldown: 60, target: true, desc: "Thả dù giáp Juggernaut + Minigun hoặc tên lửa TOW dẫn đường." },
};

/** UAV: bao lâu (giây), độ cao bay vòng, bán kính vòng lượn quanh tâm bản đồ (m). */
export const UAV = { seconds: 20, height: 150, orbit: 180 } as const;

/**
 * Mưa pháo: báo động `warn` giây (khói đỏ, còi) rồi `salvos` loạt, mỗi loạt cách nhau `every` giây, mỗi loạt `shells`
 * quả rơi ngẫu nhiên trong vòng `spread` mét quanh chỗ chấm. Nổ: bán kính, sát thương ở tâm. Tiếng rít `whistle` giây
 * trước khi chạm đất. Không được chấm gần mình hơn `minRange` mét; người trong `siren` mét nghe còi báo động.
 */
export const ARTILLERY = { warn: 5, salvos: 5, every: 1.6, shells: 4, spread: 14, radius: 7, damage: 150, whistle: 1.4, minRange: 30, siren: 120 } as const;

/** Giờ (giây kể từ lúc gọi) từng loạt pháo chạm đất. */
export function artilleryImpacts(): number[] {
  return Array.from({ length: ARTILLERY.salvos }, (_, i) => ARTILLERY.warn + i * ARTILLERY.every);
}

/** Tổng thời gian một trận mưa pháo (giây), tới loạt cuối. */
export function artilleryDuration(): number {
  return ARTILLERY.warn + (ARTILLERY.salvos - 1) * ARTILLERY.every;
}

/** Thùng chi viện: chấm xa nhất chừng này mét so với mình; chỗ không trống thì tìm chỗ trống trong `search` mét. */
export const SPECIAL_DROP = { range: 320, search: 30 } as const;

export type SpecialPick = "jugg" | "tow";
/** Đồ trong thùng chi viện theo lựa chọn (id đồ dưới đất). */
export const SPECIAL_LOOT: Record<SpecialPick, readonly string[]> = {
  jugg: ["jugg"],
  tow: ["tow", "ammo:rocket:4", "medkit"],
};

/** Giáp Juggernaut: chịu đòn gấp `soak` lần (máu hiệu dụng ×3), đi chậm lại, kèm Minigun và `ammo` viên đạn. */
export const JUGGERNAUT = { soak: 3, speed: 0.78, ammo: 600 } as const;

/**
 * Minigun: bấm cò thì quay nòng `spinup` ms mới nhả đạn; loạt bắn bắt đầu ở `start` phần tốc độ, tăng dần tới đủ tốc
 * độ trong `ramp` ms. Thả cò quá `idle` ms thì nòng dừng, lần sau quay lại từ đầu.
 */
export const MINIGUN = { spinup: 450, ramp: 700, start: 0.45, idle: 300 } as const;

/** Tốc độ bắn (phát/phút) của Minigun sau `ms` mili giây kể từ phát đầu của loạt. */
export function minigunRpm(rpm: number, ms: number): number {
  const k = Math.min(1, Math.max(0, ms) / MINIGUN.ramp);
  return rpm * (MINIGUN.start + (1 - MINIGUN.start) * k);
}

/**
 * TOW: tên lửa bay `speed` m/s, bẻ lái tối đa `turn` rad/s, tự nổ sau `life` giây. Dẫn đường bằng dây: tên lửa bám
 * theo đường ngắm của người bắn (điểm cách mắt người bắn xa hơn tên lửa `lead` mét); không nhận lệnh lái quá `wire`
 * giây (thả chuột, đổi súng, gục) thì bay thẳng.
 */
export const TOW = { speed: 95, turn: 2.4, life: 6, lead: 30, wire: 0.45 } as const;

type V3 = [number, number, number];

/**
 * Bẻ hướng bay `dir` (vector đơn vị) của tên lửa ở `pos` về đường ngắm (mắt `eye`, hướng `aim` đơn vị), tối đa
 * `maxTurn` radian. Trả về hướng mới (đơn vị).
 */
export function towSteer(dir: V3, pos: V3, eye: V3, aim: V3, maxTurn: number): V3 {
  const reach = Math.hypot(pos[0] - eye[0], pos[1] - eye[1], pos[2] - eye[2]) + TOW.lead;
  const wx = eye[0] + aim[0] * reach - pos[0];
  const wy = eye[1] + aim[1] * reach - pos[1];
  const wz = eye[2] + aim[2] * reach - pos[2];
  const wl = Math.hypot(wx, wy, wz) || 1;
  const want: V3 = [wx / wl, wy / wl, wz / wl];
  const dot = Math.max(-1, Math.min(1, dir[0] * want[0] + dir[1] * want[1] + dir[2] * want[2]));
  const angle = Math.acos(dot);
  if (angle <= maxTurn || angle < 1e-6) return want;
  // Quay `dir` trong mặt phẳng (dir, want) đúng `maxTurn` radian.
  let px = want[0] - dir[0] * dot;
  let py = want[1] - dir[1] * dot;
  let pz = want[2] - dir[2] * dot;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) return dir;
  px /= pl;
  py /= pl;
  pz /= pl;
  const c = Math.cos(maxTurn);
  const s = Math.sin(maxTurn);
  return [dir[0] * c + px * s, dir[1] * c + py * s, dir[2] * c + pz * s];
}
