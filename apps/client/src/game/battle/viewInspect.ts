// Ngắm nghía vũ khí (phím I, chỉ súng trước mặt, chỉ trên máy mình): súng nghiêng 45° sang trái, xoay lật khoe sườn
// phải (cửa thoát vỏ, buồng đạn) rồi lật xuống khoe băng đạn; tay trái vuốt dọc ốp lót tay; đưa súng về tư thế sẵn
// sàng. Cả động tác ~2,5 giây; bắn, ngắm, thay đạn, chạy, đổi súng, đâm dao là huỷ ngay (súng trượt về trong ~0,1 s).
// Trong lúc ngắm nghía, một vệt sáng ảo quét qua kim loại (viewGlint) để khoe skin.

/** Thời lượng cả động tác (giây). */
export const INSPECT_DUR = 2.5;

/**
 * Trạng thái ngắm nghía. `request`: vừa bấm I (ViewModel xét có được phép không); `at`: lúc bắt đầu (performance.now,
 * ms; 0 là không ngắm); `weight`: độ hoà động tác (1 đang ngắm, giảm dần về 0 khi bị huỷ); `hold`: chỉ để thử (dev),
 * ≥ 0 thì đứng hình ở giây đó của động tác (chụp ảnh không phụ thuộc tốc độ khung hình).
 */
export const inspect = { request: false, at: 0, weight: 0, hold: -1 };

/** Tư thế cộng thêm vào súng trước mặt (toạ độ camera), vị trí tay trái, vệt sáng. */
export interface InspectPose {
  px: number;
  py: number;
  pz: number;
  /** Góc cộng thêm: ngóc nòng (x), quay ngang (y), lăn quanh nòng (z), radian. */
  rx: number;
  ry: number;
  rz: number;
  /** Tay trái trượt dọc ốp lót tay về phía đầu nòng (m, toạ độ súng). */
  hand: number;
  /** Độ sáng vệt quét (0–1) và vị trí ngang của nguồn sáng ảo (−1,6 trái … 1,6 phải). */
  glint: number;
  sweep: number;
}

export function newPose(): InspectPose {
  return {
    px: 0,
    py: 0,
    pz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    hand: 0,
    glint: 0,
    sweep: 0,
  };
}

// Khung động tác: [giây, px, py, pz, rx, ry, rz]. Nghiêng trái 45° (rz +0,78) và quay nòng sang phải (ry âm) để sườn
// phải khẩu súng ngửa lên phía mắt; rồi lật ngược ~55° sang phải cho băng đạn chĩa về phía mắt; tay trái vuốt ốp; về chỗ.
// Gốc xoay ở tay cầm nên quay ngang ít thôi, kẻo báng súng quét vào giữa màn hình.
const KEYS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.45, -0.1, 0.06, -0.02, 0.1, -0.3, 0.78],
  [1.05, -0.11, 0.07, -0.03, 0.16, -0.42, 0.9],
  [1.55, -0.1, 0.06, -0.03, 0.1, -0.2, -0.95],
  [2.05, -0.06, 0.04, -0.02, 0.05, -0.08, -0.35],
  [2.5, 0, 0, 0, 0, 0, 0],
];

function smooth01(t: number, a: number, b: number): number {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Tiếp tuyến Catmull-Rom (khoảng thời gian không đều) của kênh `c` tại khung `i`; hai đầu đứng yên. */
function tangent(i: number, c: number): number {
  if (i <= 0 || i >= KEYS.length - 1) return 0;
  const a = KEYS[i - 1]!;
  const b = KEYS[i + 1]!;
  return (b[c]! - a[c]!) / (b[0]! - a[0]!);
}

/** Tư thế ngắm nghía tại giây `t` (ghi vào `out`, không cấp phát). Ngoài [0, INSPECT_DUR] là tư thế gốc. */
export function inspectPose(t: number, out: InspectPose): InspectPose {
  out.hand = out.glint = out.sweep = 0;
  if (!(t > 0 && t < INSPECT_DUR)) {
    out.px = out.py = out.pz = out.rx = out.ry = out.rz = 0;
    return out;
  }
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1]![0]!) i++;
  const k0 = KEYS[i]!;
  const k1 = KEYS[i + 1]!;
  const h = k1[0]! - k0[0]!;
  const s = (t - k0[0]!) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const ch = (c: number) => h00 * k0[c]! + h10 * h * tangent(i, c) + h01 * k1[c]! + h11 * h * tangent(i + 1, c);
  out.px = ch(1);
  out.py = ch(2);
  out.pz = ch(3);
  out.rx = ch(4);
  out.ry = ch(5);
  out.rz = ch(6);
  // Tay trái vuốt tới đầu ốp rồi lùi về (1,5–2,15 s).
  const hk = t > 1.5 && t < 2.15 ? Math.sin(((t - 1.5) / 0.65) * Math.PI) : 0;
  out.hand = hk * hk * 0.11;
  // Vệt sáng: lượt một quét trái → phải trên sườn phải, lượt hai quét ngược lại trên băng đạn.
  out.glint = smooth01(t, 0.2, 0.5) * (1 - smooth01(t, 2.0, 2.35));
  out.sweep = t < 1.25 ? -1.6 + 3.2 * smooth01(t, 0.3, 1.2) : 1.6 - 3.2 * smooth01(t, 1.3, 2.1);
  return out;
}

/** Bắt đầu ngắm nghía lúc `now` (ms). */
export function startInspect(now: number) {
  inspect.at = now;
  inspect.weight = 1;
}

/** Huỷ ngay (súng trượt về theo `weight`). */
export function cancelInspect() {
  inspect.at = 0;
  inspect.request = false;
}

/** Các phím làm việc khác (thay đạn, đổi súng, cất súng, đâm dao, chạy, tương tác): huỷ ngắm nghía. */
const CANCEL_KEYS = new Set([
  "KeyR",
  "KeyX",
  "KeyV",
  "KeyF",
  "ShiftLeft",
  "ShiftRight",
  "Digit0",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
]);

/** Phím `code` có huỷ động tác ngắm nghía không. */
export function cancelsInspect(code: string): boolean {
  return CANCEL_KEYS.has(code);
}
