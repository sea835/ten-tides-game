// Chuyển động có trọng lượng của nhân vật: IK hai khúc cho chân (bàn chân bám dốc), dò mặt đất dưới từng bàn chân,
// bụi đất / tia lửa khi đáp đất, trượt, lao người nằm sấp. Phần toán thuần (không đụng three, không đụng cảnh) để
// kiểm thử được; Character.tsx gọi mỗi khung hình.

/** Dài đùi, dài cẳng chân (khớp với Character.tsx). */
export const THIGH = 0.43;
export const SHIN = 0.41;

/**
 * Cổ chân ở đâu (mặt phẳng dọc của chân, gốc ở khớp hông, z ra trước, y lên trên) khi đùi xoay `thigh`, gối gập
 * `knee` quanh trục x như Character (đùi âm là đưa chân ra trước, gối dương là cẳng chân gập ra sau).
 */
export function ankleAt(thigh: number, knee: number, out: { z: number; y: number }): { z: number; y: number } {
  const s = thigh + knee;
  out.z = -THIGH * Math.sin(thigh) - SHIN * Math.sin(s);
  out.y = -THIGH * Math.cos(thigh) - SHIN * Math.cos(s);
  return out;
}

/**
 * Ngược lại `ankleAt`: góc đùi và góc gối để cổ chân chạm (z, y). Gối luôn gập ra sau (như người thật); xa quá tầm
 * thì duỗi thẳng chĩa về phía đó, gần quá thì gập tối đa.
 */
export function solveLeg(z: number, y: number, out: { thigh: number; knee: number }): { thigh: number; knee: number } {
  const d = Math.min(THIGH + SHIN - 1e-4, Math.max(0.12, Math.hypot(z, y)));
  const phi = Math.atan2(-z, -y);
  const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
  out.knee = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosK)));
  const cosB = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
  out.thigh = phi - Math.acos(Math.min(1, Math.max(-1, cosB)));
  return out;
}

/** Tiến đều về đích với tốc độ `step` mỗi lần gọi (không vượt quá). */
export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Nhanh-chậm hai đầu (smoothstep): chuyển tư thế bắt đầu êm và dừng êm, không giật. */
export function smooth01(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

/**
 * Dò mặt đất ở (x, z) gần độ cao y: trả độ cao mặt đất (NaN nếu không thấy trong tầm), ghi pháp tuyến vào `n`.
 * Mình thì dò tia vật lý (sàn nhà, cầu, bậc thềm), người khác cũng vậy khi có tia, không thì theo địa hình.
 */
export type GroundProbe = (x: number, y: number, z: number, n: { x: number; y: number; z: number }) => number;

/**
 * Nhún khi đáp đất: rơi càng nhanh nhún càng sâu (0–1). Rơi chậm hơn 2 m/s (bước xuống bậc) thì gần như không nhún.
 */
export function landImpact(fallSpeed: number): number {
  return Math.min(1, Math.max(0, (fallSpeed - 2) / 10));
}

/**
 * Lượng nhún theo thời gian sau khi chạm đất: dồn xuống trong 60 ms rồi hồi lên dần (lò xo tắt dần, không nảy).
 */
export function landCurve(t: number): number {
  if (t < 0) return 0;
  return t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) * 6.5);
}

/**
 * Nhún lấy đà khi nhảy (chỉ là hình, vật lý nhảy ngay khi bấm): gập gối trong 50 ms đầu rồi bật, sau đó duỗi thẳng
 * người lên trong khoảng 0,05–0,3 giây. Trả { wind, ext } cùng 0–1.
 */
export function jumpCurve(t: number): { wind: number; ext: number } {
  const wind = t < 0 ? 0 : t < 0.05 ? t / 0.05 : Math.max(0, 1 - (t - 0.05) / 0.06);
  const ext = t < 0.05 || t > 0.3 ? 0 : Math.sin((Math.PI * (t - 0.05)) / 0.25);
  return { wind, ext };
}
