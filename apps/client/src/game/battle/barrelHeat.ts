// Nhiệt nòng súng trước mặt: đếm loạt bắn liên tục để bật quầng khí nóng méo hình (heat shimmer) sau hơn 10 viên,
// và tính lượng khói mỏng bốc ra từ đầu nòng, cửa thoát vỏ sau mỗi loạt. Thuần số, không đụng tới three.

/** Hai phát cách nhau quá chừng này (giây) là loạt mới. */
export const STREAK_GAP = 0.45;
/** Bắn liên tục quá ngần này viên thì nòng bốc khí nóng. */
export const HEAT_SHOTS = 10;
/** Khí nóng còn bốc chừng này giây sau phát cuối. */
export const SHIMMER_HOLD = 2.6;

export interface Heat {
  /** Số viên của loạt đang bắn / vừa bắn. */
  streak: number;
  /** Lúc bắn phát cuối (giây). */
  lastShot: number;
  /** Khí nóng bốc tới lúc này (giây); 0 là nòng nguội. */
  shimmerUntil: number;
  /** Loạt vừa dứt: khói bốc tới lúc này (giây) với mật độ ban đầu `smokeRate` (làn/giây). */
  smokeFrom: number;
  smokeUntil: number;
  smokeRate: number;
  /** Phát to (súng bắn tỉa, shotgun, DMR): một phát cũng đủ bốc khói. */
  heavy: boolean;
}

export function newHeat(): Heat {
  return {
    streak: 0,
    lastShot: -1e9,
    shimmerUntil: 0,
    smokeFrom: 0,
    smokeUntil: 0,
    smokeRate: 0,
    heavy: false,
  };
}

/** Ghi nhận `n` phát bắn lúc `now` (giây). */
export function heatShot(h: Heat, now: number, n: number, heavy: boolean) {
  if (now - h.lastShot > STREAK_GAP) h.streak = 0;
  h.streak += n;
  h.lastShot = now;
  h.heavy = heavy;
  // Đang bắn thì khói loạt trước tắt (khói mới tính khi loạt này dứt).
  h.smokeUntil = 0;
  if (h.streak > HEAT_SHOTS) h.shimmerUntil = now + SHIMMER_HOLD;
}

/** Mức khí nóng (0–1) lúc `now`: đầy khi đang xả, nhạt dần trong giây cuối. */
export function shimmerLevel(h: Heat, now: number): number {
  if (now >= h.shimmerUntil) return 0;
  const left = h.shimmerUntil - now;
  // Đang xả thì còn mạnh hơn khi nòng vừa dứt (khí nóng bốc rõ nhất ngay sau loạt).
  const warm = Math.min(1, (h.streak - HEAT_SHOTS) / 12 + 0.55);
  return warm * Math.min(1, left / 1.2);
}

/**
 * Lượng khói (làn/giây) lúc `now`. Loạt dứt (không bắn thêm 0,12 s) thì bắt đầu bốc khói: loạt càng dài khói càng
 * đặc, càng lâu (tối đa ~3 s), nhạt dần. Đang xả dài (sau 6 viên) cũng rỉ chút khói.
 */
export function smokeRate(h: Heat, now: number): number {
  const since = now - h.lastShot;
  if (since < 0.12) return h.streak > 6 ? 3 : 0;
  if (h.smokeUntil === 0 && (h.streak >= 3 || (h.heavy && h.streak >= 1))) {
    const size = Math.min(1, (h.heavy ? 4 : 0) / 12 + h.streak / 14);
    h.smokeFrom = h.lastShot + 0.12;
    h.smokeUntil = h.smokeFrom + 1.2 + size * 1.8;
    h.smokeRate = 5 + size * 9;
  }
  if (now >= h.smokeUntil) return 0;
  const k = (now - h.smokeFrom) / (h.smokeUntil - h.smokeFrom);
  return h.smokeRate * (1 - k) * (1 - k);
}
