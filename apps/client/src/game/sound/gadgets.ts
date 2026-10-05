import { audio, noiseBurst, tone } from "./engine.ts";
import type { Place } from "./engine.ts";

// Tiếng khí tài lớp lính, tổng hợp bằng Web Audio: phóng lựu M203 ("bụp" trầm rỗng), bơm tiêm (xì khí, tim đập),
// đặt hộp đạn / bao cát (thịch xuống đất), mỏ lết sửa xe (kim loại gõ lách cách), ống nhòm đánh dấu (nốt kép).

/** Phóng lựu 40 mm: tiếng "bụp" trầm rỗng của ống phóng, ở xa nghe nhỏ dần. */
export function playLauncher(at: Place | null) {
  const out = audio.output("sfx", 0.9, at ?? undefined, 160);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  tone(out, t, { type: "sine", freq: 150, freqEnd: 55, attack: 0.003, decay: 0.22, peak: 0.9 });
  noiseBurst(out, t, { brown: true, type: "lowpass", freq: 900, freqEnd: 200, attack: 0.002, decay: 0.18, peak: 0.8 });
  noiseBurst(out, t + 0.01, { type: "bandpass", freq: 2400, q: 0.8, attack: 0.002, decay: 0.05, peak: 0.25 });
}

/** Bơm Adrenaline: tiếng xì của pít-tông rồi hai nhịp tim dồn. */
export function playInject() {
  const out = audio.output("sfx", 0.6);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  noiseBurst(out, t, { type: "highpass", freq: 3500, attack: 0.02, decay: 0.22, peak: 0.35 });
  for (let k = 0; k < 3; k++) {
    tone(out, t + 0.35 + k * 0.42, { type: "sine", freq: 62, freqEnd: 40, attack: 0.004, decay: 0.12, peak: 0.8 });
    tone(out, t + 0.5 + k * 0.42, { type: "sine", freq: 55, freqEnd: 38, attack: 0.004, decay: 0.1, peak: 0.55 });
  }
}

/** Đặt đồ xuống đất: hộp đạn (thịch gỗ), bao cát (phịch mềm), mìn (cạch kim loại nhỏ). */
export function playPlace(at: Place, kind: "box" | "sandbag" | "mine") {
  const out = audio.output("sfx", 0.7, at, 40);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  if (kind === "sandbag") {
    noiseBurst(out, t, { brown: true, type: "lowpass", freq: 500, attack: 0.01, decay: 0.25, peak: 0.9 });
    noiseBurst(out, t + 0.12, { brown: true, type: "lowpass", freq: 420, attack: 0.01, decay: 0.2, peak: 0.6 });
  } else if (kind === "box") {
    tone(out, t, { type: "triangle", freq: 180, freqEnd: 120, decay: 0.12, peak: 0.6 });
    noiseBurst(out, t, { type: "bandpass", freq: 900, q: 1.5, decay: 0.1, peak: 0.5 });
  } else {
    tone(out, t, { type: "square", freq: 1800, decay: 0.03, peak: 0.15 });
    noiseBurst(out, t + 0.02, { type: "bandpass", freq: 3000, q: 3, decay: 0.05, peak: 0.25 });
  }
}

/** Mỏ lết gõ vào vỏ xe: một nhịp kim loại ngắn (gọi đều đặn khi đang sửa). */
export function playWrench(at: Place) {
  const out = audio.output("sfx", 0.45, at, 35);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  const f = 1900 + Math.random() * 500;
  tone(out, t, { type: "triangle", freq: f, decay: 0.09, peak: 0.35 });
  tone(out, t, { type: "sine", freq: f * 2.7, decay: 0.05, peak: 0.15 });
  noiseBurst(out, t, { type: "highpass", freq: 4000, decay: 0.03, peak: 0.2 });
}

/** Ống nhòm đánh dấu được mục tiêu: nốt kép cao như máy đo xa. */
export function playSpotted() {
  const out = audio.output("ui", 0.45);
  if (!out) return;
  const t = audio.ctx!.currentTime;
  tone(out, t, { type: "square", freq: 2100, decay: 0.05, peak: 0.18 });
  tone(out, t + 0.07, { type: "square", freq: 2600, decay: 0.08, peak: 0.18 });
}
