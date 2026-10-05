import { audio, noiseBurst, tone } from "./engine.ts";

// Tiếng liên lạc trong đội: "bíp" khi đánh dấu (chỗ thường, địch, nguy hiểm), tiếng xè bộ đàm khi có câu khẩu lệnh.
// Toàn bộ tổng hợp bằng Web Audio, nghe như ở ngay tai (bus giao diện).

/** Bíp đánh dấu: chỗ thường hai nốt đi lên, địch nốt cao gắt, nguy hiểm ba nốt dồn dập. */
export function playPing(kind: "spot" | "enemy" | "danger" | "order") {
  const out = audio.output("ui", 0.55);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  if (kind === "enemy") {
    tone(out, t, { type: "square", freq: 1320, decay: 0.07, peak: 0.25 });
    tone(out, t + 0.08, { type: "square", freq: 1320, decay: 0.09, peak: 0.25 });
  } else if (kind === "danger") {
    for (let k = 0; k < 3; k++) tone(out, t + k * 0.07, { type: "sawtooth", freq: 980, freqEnd: 700, decay: 0.06, peak: 0.18 });
  } else if (kind === "order") {
    tone(out, t, { type: "triangle", freq: 520, decay: 0.08, peak: 0.4 });
    tone(out, t + 0.07, { type: "triangle", freq: 780, decay: 0.12, peak: 0.4 });
  } else {
    tone(out, t, { type: "sine", freq: 880, decay: 0.08, peak: 0.5 });
    tone(out, t + 0.06, { type: "sine", freq: 1320, decay: 0.16, peak: 0.45 });
  }
}

/**
 * Bộ đàm: bật máy (tiếng xè ngắn qua lọc băng hẹp như loa bộ đàm, kèm nốt "chíp"), một chút nhiễu nền lúc nói,
 * rồi tiếng nhả nút (roger beep) sau `talk` giây.
 */
export function playRadio(talk = 0.55) {
  const out = audio.output("ui", 0.5);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  noiseBurst(out, t, { type: "bandpass", freq: 2200, q: 1.4, attack: 0.004, decay: 0.09, peak: 0.6 });
  tone(out, t + 0.02, { type: "square", freq: 1750, decay: 0.05, peak: 0.12 });
  // Nhiễu nền lúc "nói": rì rì nhỏ, băng hẹp.
  noiseBurst(out, t + 0.06, { type: "bandpass", freq: 1500, q: 2.5, attack: 0.05, decay: talk, peak: 0.12 });
  // Nhả nút: hai nốt ngắn rồi xè tắt.
  tone(out, t + talk, { type: "square", freq: 1200, decay: 0.04, peak: 0.1 });
  tone(out, t + talk + 0.05, { type: "square", freq: 900, decay: 0.05, peak: 0.1 });
  noiseBurst(out, t + talk + 0.08, { type: "bandpass", freq: 2600, freqEnd: 900, q: 1.2, decay: 0.12, peak: 0.5 });
}
