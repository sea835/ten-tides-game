// Nhịp vẽ khung hình (FrameDriver dùng): tách riêng, không phụ thuộc trình duyệt, để kiểm thử được.

/**
 * Khoảng cách giữa hai lần vẽ (ms) cho giới hạn `cap` khung/giây trên màn có chu kỳ `period` ms: bội nguyên của chu
 * kỳ màn hình gần với giới hạn nhất (không vượt quá giới hạn quá 25%). Chưa đo được chu kỳ thì dùng đúng 1000/cap.
 */
export function paceInterval(cap: number, period: number): number {
  if (cap <= 0) return 0;
  if (!(period > 0)) return 1000 / cap;
  const refresh = 1000 / period;
  let n = Math.max(1, Math.round(refresh / cap));
  if (refresh / n > cap * 1.25) n++;
  return n * period;
}
