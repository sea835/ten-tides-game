import { audio, noiseBurst, tone, type Bus, type Place } from "./engine.ts";

// Công thức từng tiếng động. Mỗi công thức nhận đầu ra (đã tính khoảng cách, trái phải) và thời điểm bắt đầu.
// Tất cả là tổng hợp: tiếng ồn lọc cho gió, nước, cát, gỗ; dao động cho tiếng chuông, tiếng trầm.

type Recipe = (out: AudioNode, t: number) => void;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Tiếng gõ gỗ: một nhịp trầm đục cộng tiếng ồn băng hẹp. */
function knock(out: AudioNode, t: number, pitch = 1, peak = 1) {
  tone(out, t, { freq: 320 * pitch, freqEnd: 170 * pitch, decay: 0.12, peak: 0.8 * peak });
  noiseBurst(out, t, { freq: 900 * pitch, q: 3, decay: 0.07, peak: 0.9 * peak });
}

/** Rì rào nước: tiếng ồn lọc thấp trượt xuống. */
function water(out: AudioNode, t: number, dur: number, peak: number, from = 2400, to = 350) {
  noiseBurst(out, t, { type: "lowpass", freq: from, freqEnd: to, attack: 0.02, decay: dur, peak });
}

/** Chuỗi nốt (chuông giao diện, nhạc hiệu). */
function arpeggio(out: AudioNode, t: number, freqs: number[], step: number, type: OscillatorType = "triangle", peak = 0.5, decay = 0.6) {
  freqs.forEach((f, i) => {
    tone(out, t + i * step, { type, freq: f, decay, peak });
    tone(out, t + i * step, { type: "sine", freq: f * 2, decay: decay * 0.6, peak: peak * 0.25 });
  });
}

export const RECIPES: Record<string, Recipe> = {
  // --- bước chân, bơi, leo
  step_sand: (o, t) => noiseBurst(o, t, { type: "lowpass", freq: rand(700, 1000), attack: 0.01, decay: 0.09, peak: 0.35 }),
  step_grass: (o, t) => noiseBurst(o, t, { type: "bandpass", freq: rand(1800, 2600), q: 0.8, attack: 0.01, decay: 0.08, peak: 0.28 }),
  step_rock: (o, t) => {
    noiseBurst(o, t, { type: "highpass", freq: 2500, decay: 0.04, peak: 0.3 });
    tone(o, t, { freq: rand(180, 230), freqEnd: 120, decay: 0.06, peak: 0.2 });
  },
  step_wood: (o, t) => knock(o, t, rand(0.9, 1.1), 0.35),
  step_water: (o, t) => water(o, t, 0.25, 0.4, 3000, 600),
  swim: (o, t) => water(o, t, 0.5, 0.35, 1500, 300),
  climb: (o, t) => {
    noiseBurst(o, t, { type: "bandpass", freq: 1200, q: 2, decay: 0.12, peak: 0.3 });
    knock(o, t + 0.05, 0.7, 0.15);
  },
  // --- đánh nhau
  whoosh: (o, t) => noiseBurst(o, t, { type: "bandpass", freq: 400, freqEnd: 1800, q: 1.5, attack: 0.06, decay: 0.16, peak: 0.6 }),
  throw: (o, t) => noiseBurst(o, t, { type: "bandpass", freq: 300, freqEnd: 1400, q: 1.2, attack: 0.1, decay: 0.3, peak: 0.55 }),
  punch: (o, t) => {
    tone(o, t, { freq: 140, freqEnd: 50, decay: 0.16, peak: 1 });
    noiseBurst(o, t, { type: "lowpass", freq: 1400, decay: 0.06, peak: 0.8 });
  },
  slash: (o, t) => {
    noiseBurst(o, t, { type: "highpass", freq: 2500, freqEnd: 6000, attack: 0.02, decay: 0.12, peak: 0.6 });
    tone(o, t + 0.03, { type: "triangle", freq: 1900, decay: 0.25, peak: 0.15 });
    tone(o, t, { freq: 120, freqEnd: 60, decay: 0.12, peak: 0.6 });
  },
  clang: (o, t) => {
    tone(o, t, { type: "triangle", freq: 740, decay: 0.6, peak: 0.5 });
    tone(o, t, { type: "sine", freq: 1110, decay: 0.45, peak: 0.3 });
    tone(o, t, { freq: 150, freqEnd: 60, decay: 0.15, peak: 0.7 });
  },
  bite: (o, t) => {
    const growl = tone(o, t, { type: "sawtooth", freq: 95, freqEnd: 70, attack: 0.04, decay: 0.3, peak: 0.35 });
    growl.detune.setValueAtTime(0, t);
    noiseBurst(o, t + 0.2, { type: "highpass", freq: 3000, decay: 0.05, peak: 0.8 });
    tone(o, t + 0.2, { freq: 160, freqEnd: 60, decay: 0.1, peak: 0.6 });
  },
  gunshot: (o, t) => {
    noiseBurst(o, t, { type: "lowpass", freq: 5000, freqEnd: 400, decay: 0.45, peak: 1 });
    tone(o, t, { freq: 90, freqEnd: 35, decay: 0.35, peak: 1 });
    noiseBurst(o, t + 0.12, { brown: true, type: "lowpass", freq: 500, attack: 0.05, decay: 0.9, peak: 0.35 });
  },
  twang: (o, t) => {
    tone(o, t, { type: "triangle", freq: 330, freqEnd: 180, decay: 0.2, peak: 0.5 });
    noiseBurst(o, t, { type: "bandpass", freq: 900, freqEnd: 2500, q: 2, decay: 0.12, peak: 0.4 });
  },
  thud: (o, t) => {
    tone(o, t, { freq: 110, freqEnd: 40, decay: 0.3, peak: 1 });
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 400, decay: 0.3, peak: 0.8 });
  },
  kill: (o, t) => {
    tone(o, t, { freq: 180, freqEnd: 45, decay: 0.5, peak: 0.9 });
    tone(o, t + 0.05, { type: "triangle", freq: 520, freqEnd: 180, decay: 0.45, peak: 0.25 });
  },
  poof: (o, t) => noiseBurst(o, t, { type: "lowpass", freq: 1600, freqEnd: 300, attack: 0.03, decay: 0.5, peak: 0.45 }),
  // --- cây cối, dựng nhà
  chop: (o, t) => {
    knock(o, t, rand(0.85, 1.05), 1);
    noiseBurst(o, t + 0.02, { type: "highpass", freq: 3500, decay: 0.05, peak: 0.25 });
  },
  tree_fall: (o, t) => {
    // Tiếng thân cây kẽo kẹt rồi đổ rầm.
    const creak = tone(o, t, { type: "sawtooth", freq: 70, freqEnd: 140, attack: 0.3, decay: 0.8, peak: 0.12 });
    creak.detune.linearRampToValueAtTime(300, t + 1);
    noiseBurst(o, t + 0.9, { type: "lowpass", freq: 3000, freqEnd: 200, decay: 1.4, peak: 0.9 });
    tone(o, t + 0.9, { freq: 70, freqEnd: 30, decay: 0.8, peak: 1 });
    noiseBurst(o, t + 0.95, { type: "highpass", freq: 4000, decay: 0.8, peak: 0.25 });
  },
  dig: (o, t) => {
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 900, decay: 0.15, peak: 0.7 });
    noiseBurst(o, t + 0.22, { brown: true, type: "lowpass", freq: 700, decay: 0.2, peak: 0.6 });
  },
  hammer: (o, t) => {
    for (let i = 0; i < 3; i++) knock(o, t + i * 0.18, rand(1.1, 1.3), 0.8);
  },
  // --- nước, lửa, dung nham
  splash: (o, t) => {
    water(o, t, 0.7, 0.9, 4000, 300);
    for (let i = 0; i < 4; i++) tone(o, t + 0.1 + i * rand(0.05, 0.12), { freq: rand(500, 900), freqEnd: rand(900, 1500), decay: 0.05, peak: 0.15 });
  },
  bubbles: (o, t) => {
    for (let i = 0; i < 7; i++) tone(o, t + i * rand(0.04, 0.12), { freq: rand(300, 600), freqEnd: rand(700, 1300), decay: 0.06, peak: 0.3 });
  },
  sizzle: (o, t) => {
    const f = noiseBurst(o, t, { type: "highpass", freq: 4000, attack: 0.05, decay: 1, peak: 0.45 });
    f.Q.value = 0.5;
    for (let i = 0; i < 6; i++) noiseBurst(o, t + rand(0, 0.8), { type: "highpass", freq: 6000, decay: 0.02, peak: 0.6 });
  },
  lava: (o, t) => {
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 300, attack: 0.05, decay: 1.8, peak: 1 });
    noiseBurst(o, t, { type: "highpass", freq: 3000, attack: 0.02, decay: 1.4, peak: 0.6 });
    tone(o, t, { freq: 60, freqEnd: 28, decay: 1.5, peak: 1 });
  },
  // --- đồ đạc
  crunch: (o, t) => {
    for (let i = 0; i < 4; i++) noiseBurst(o, t + i * 0.11, { type: "bandpass", freq: rand(1800, 3200), q: 1.5, decay: 0.05, peak: 0.45 });
  },
  gulp: (o, t) => {
    tone(o, t, { freq: 220, freqEnd: 120, decay: 0.12, peak: 0.5 });
    tone(o, t + 0.25, { freq: 200, freqEnd: 110, decay: 0.12, peak: 0.4 });
  },
  pickup: (o, t) => {
    tone(o, t, { type: "triangle", freq: 620, decay: 0.08, peak: 0.4 });
    tone(o, t + 0.07, { type: "triangle", freq: 930, decay: 0.15, peak: 0.4 });
  },
  stash: (o, t) => arpeggio(o, t, [660, 880, 1320], 0.07, "triangle", 0.35, 0.3),
  rustle: (o, t) => {
    for (let i = 0; i < 5; i++) noiseBurst(o, t + i * 0.07, { type: "highpass", freq: rand(3000, 5000), decay: 0.06, peak: 0.35 });
  },
  // --- trời đất
  thunder: (o, t) => {
    noiseBurst(o, t, { type: "highpass", freq: 1500, decay: 0.25, peak: 0.5 });
    noiseBurst(o, t + 0.05, { brown: true, type: "lowpass", freq: 260, attack: 0.15, decay: 3.2, peak: 1 });
    noiseBurst(o, t + 0.6, { brown: true, type: "lowpass", freq: 140, attack: 0.3, decay: 2.5, peak: 0.8 });
  },
  rumble: (o, t) => {
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 120, attack: 0.4, decay: 2.2, peak: 1 });
    tone(o, t, { freq: 38, attack: 0.4, decay: 2, peak: 0.7 });
  },
  shark: (o, t) => {
    // Hai nốt trầm luân phiên, dồn dập dần.
    for (let i = 0; i < 6; i++) tone(o, t + i * (0.42 - i * 0.04), { type: "sawtooth", freq: i % 2 ? 87 : 82, decay: 0.25, peak: 0.35 });
  },
  // --- giao diện
  click: (o, t) => tone(o, t, { type: "triangle", freq: 1400, decay: 0.04, peak: 0.3 }),
  buzz: (o, t) => tone(o, t, { type: "square", freq: 150, decay: 0.16, peak: 0.12 }),
  chime_good: (o, t) => arpeggio(o, t, [523, 659, 784, 1047], 0.08),
  chime_bad: (o, t) => arpeggio(o, t, [392, 311, 233], 0.12, "sine", 0.55, 0.7),
  chime_neutral: (o, t) => arpeggio(o, t, [587, 880], 0.1),
  dice: (o, t) => {
    for (let i = 0; i < 7; i++) knock(o, t + i * (0.05 + i * 0.012), rand(2.2, 3), 0.35 - i * 0.03);
  },
  success: (o, t) => arpeggio(o, t, [523, 784, 1047], 0.09, "triangle", 0.45, 0.5),
  fail: (o, t) => arpeggio(o, t, [311, 262], 0.16, "sine", 0.45, 0.6),
  dawn: (o, t) => arpeggio(o, t, [392, 494, 587, 784], 0.16, "triangle", 0.4, 1.2),
  dusk: (o, t) => {
    tone(o, t, { freq: 196, decay: 3, peak: 0.45 });
    tone(o, t, { freq: 294, decay: 2.5, peak: 0.25 });
    tone(o, t, { freq: 523, decay: 1.8, peak: 0.12 });
  },
  night: (o, t) => arpeggio(o, t, [440, 523, 659], 0.3, "sine", 0.3, 1.5),
  death: (o, t) => {
    tone(o, t, { type: "triangle", freq: 330, freqEnd: 110, attack: 0.05, decay: 1.8, peak: 0.5 });
    tone(o, t, { freq: 165, freqEnd: 55, attack: 0.05, decay: 2, peak: 0.5 });
  },
  twist: (o, t) => {
    tone(o, t, { type: "sawtooth", freq: 110, attack: 0.1, decay: 2.2, peak: 0.25 });
    tone(o, t, { type: "sawtooth", freq: 131, attack: 0.1, decay: 2.2, peak: 0.2 });
    tone(o, t, { type: "sawtooth", freq: 156, attack: 0.1, decay: 2.2, peak: 0.18 });
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 200, attack: 0.3, decay: 2, peak: 0.6 });
  },
  ended: (o, t) => arpeggio(o, t, [262, 330, 392, 523, 659], 0.18, "triangle", 0.45, 1.6),
};

export type SoundName = keyof typeof RECIPES;

/**
 * Hệ số chỉnh độ to từng tiếng, đo bằng cách dựng ngoại tuyến (OfflineAudioContext) mỗi công thức rồi so đỉnh
 * sóng với mức mong muốn: bước chân khẽ, đòn đánh rõ, nổ súng và dung nham to nhất nhưng không vượt 1 (không vỡ tiếng).
 */
export const TRIM: Record<string, number> = {
  step_sand: 2.25,
  step_grass: 1.38,
  step_rock: 0.39,
  step_wood: 0.77,
  step_water: 0.80,
  swim: 0.91,
  climb: 1.82,
  whoosh: 2.86,
  throw: 3.08,
  punch: 0.68,
  slash: 0.86,
  clang: 0.53,
  bite: 0.57,
  gunshot: 0.54,
  twang: 0.91,
  thud: 0.80,
  kill: 0.86,
  poof: 1.59,
  chop: 0.82,
  tree_fall: 0.65,
  dig: 1.40,
  hammer: 0.85,
  splash: 0.92,
  bubbles: 1.21,
  sizzle: 0.71,
  lava: 0.49,
  crunch: 1.52,
  gulp: 0.85,
  pickup: 0.92,
  stash: 0.89,
  rustle: 0.38,
  thunder: 1.25,
  rumble: 0.8,
  shark: 1.47,
  click: 0.71,
  buzz: 2.27,
  chime_good: 0.75,
  chime_bad: 0.68,
  chime_neutral: 0.76,
  dice: 1.38,
  success: 0.79,
  fail: 0.80,
  dawn: 0.82,
  dusk: 0.65,
  night: 0.95,
  death: 0.69,
  twist: 1.54,
  ended: 0.81,
};

/** Phát một tiếng động (không vị trí thì nghe như ở ngay tai). */
export function play(name: SoundName, opts: { at?: Place; volume?: number; bus?: Bus; delay?: number; hearing?: number } = {}) {
  const recipe = RECIPES[name];
  const out = recipe && audio.output(opts.bus ?? "sfx", (opts.volume ?? 1) * (TRIM[name] ?? 1), opts.at, opts.hearing);
  if (!out) return;
  recipe(out, audio.ctx!.currentTime + (opts.delay ?? 0));
}
