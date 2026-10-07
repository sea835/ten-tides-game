import { audio, noiseBurst, tone, type Place } from "./engine.ts";

// Tiếng trên không: cánh quạt trực thăng (tiếng "phành phạch" — tiếng ồn trầm nhấp nhô theo nhịp cánh — cộng tiếng
// tua-bin rít), tiếng bíp khoá mục tiêu của IGLA, còi cảnh báo bị khoá / tên lửa bay tới trong buồng lái, pháo sáng
// nổ lốp bốp, tên lửa rời ống. Cùng kiểu với motors.ts: dựng bằng nút Web Audio, không cần tệp âm thanh.

const noop = () => {};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function live(): AudioContext | null {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== "running" || audio.settings.muted) return null;
  return ctx;
}

/** Nghe được cánh quạt tới chừng này mét. */
const ROTOR_HEARING = 320;

/**
 * Tiếng trực thăng; `update` mỗi khung hình với vị trí, độ quay cánh (0 tắt máy … 1 đủ vòng tua), tải (0–1: kéo cần,
 * chúc mũi thì cánh "cắn gió" mạnh hơn), có phải trực thăng mình đang ngồi.
 */
export function rotorSound(): { update: (at: Place, spin: number, load: number, local: boolean) => void; stop: () => void } {
  const ctx = live();
  if (!ctx) return { update: noop, stop: noop };
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner();
  out.connect(pan).connect(audio.bus("sfx"));
  // Phành phạch: tiếng ồn nâu qua lọc thấp, âm lượng nhấp nhô theo nhịp cánh (dao động thấp tần điều biên).
  const src = ctx.createBufferSource();
  src.buffer = audio.brown;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  lp.Q.value = 1.2;
  const thump = ctx.createGain();
  thump.gain.value = 0.55;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 4;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(thump.gain);
  src.connect(lp).connect(thump).connect(out);
  // Tua-bin rít cao.
  const whine = ctx.createOscillator();
  whine.type = "sawtooth";
  whine.frequency.value = 600;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 3;
  const wg = ctx.createGain();
  wg.gain.value = 0.025;
  whine.connect(bp).connect(wg).connect(out);
  src.start(0, Math.random() * 3);
  lfo.start();
  whine.start();
  let stopped = false;
  return {
    update(at, spin, load, local) {
      if (stopped || !audio.ctx) return;
      const t = ctx.currentTime;
      const s = clamp(spin, 0, 1);
      let gain = (0.12 + 0.5 * s) * (0.85 + 0.25 * clamp(load, 0, 1));
      let p = 0;
      if (!local) {
        const L = audio.listener;
        const dx = at.x - L.x;
        const dz = at.z - L.z;
        const d = Math.hypot(dx, dz, (at.y - L.y) * 0.6);
        gain *= Math.pow(1 - Math.min(1, d / ROTOR_HEARING), 1.5);
        if (d > 0.5) p = clamp(((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.8, -0.8, 0.8);
        // Ở xa nghe trầm hơn (cao tần tắt dần).
        lp.frequency.setTargetAtTime(220 + 300 * Math.max(0, 1 - d / 150), t, 0.3);
      } else {
        gain *= 0.55;
        lp.frequency.setTargetAtTime(520, t, 0.3);
      }
      out.gain.setTargetAtTime(gain * s, t, 0.2);
      pan.pan.setTargetAtTime(p, t, 0.1);
      lfo.frequency.setTargetAtTime(1.5 + 9.5 * s + 1.2 * load, t, 0.4);
      whine.frequency.setTargetAtTime(240 + 520 * s, t, 0.5);
      wg.gain.setTargetAtTime((local ? 0.04 : 0.02) * s, t, 0.3);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.15);
        for (const n of [src, lfo, whine]) n.stop(t + 0.8);
        setTimeout(() => out.disconnect(), 1100);
      } catch {
        // Đã tắt.
      }
    },
  };
}

/** Tiếng bíp khoá mục tiêu trong ống IGLA: đang khoá thì bíp ngắt quãng, khoá chín thì bíp cao. */
export function playLockBeep(locked: boolean) {
  try {
    const out = audio.output("ui", 0.32);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    tone(out, t, { type: "square", freq: locked ? 1760 : 1180, peak: 0.25, decay: locked ? 0.09 : 0.06 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Còi cảnh báo trong buồng lái: 1 đang bị ngắm (bíp chậm), 2 đã bị khoá (bíp nhanh), 3 tên lửa bay tới (rú hai tông). */
export function playCockpitWarning(level: number) {
  try {
    const out = audio.output("ui", 0.36);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    if (level >= 3) {
      tone(out, t, { type: "square", freq: 1400, peak: 0.3, decay: 0.08 });
      tone(out, t + 0.1, { type: "square", freq: 1000, peak: 0.3, decay: 0.08 });
    } else tone(out, t, { type: "triangle", freq: level >= 2 ? 1250 : 900, peak: 0.28, decay: level >= 2 ? 0.07 : 0.12 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Pháo sáng bung ra: mấy tiếng lốp bốp, xèo xèo. */
export function playFlares(at: Place) {
  try {
    const out = audio.output("sfx", 0.8, at, 260);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    for (let k = 0; k < 6; k++) noiseBurst(out, t + k * 0.07, { type: "bandpass", freq: 1800 + Math.random() * 1200, q: 1.2, peak: 0.45, decay: 0.05 });
    noiseBurst(out, t + 0.1, { type: "highpass", freq: 2500, peak: 0.25, attack: 0.05, decay: 1.2 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Tên lửa rời ống: tiếng nổ đẩy ngắn rồi tiếng động cơ rít vút đi. */
export function playMissileLaunch(at: Place) {
  try {
    const out = audio.output("sfx", 0.9, at, 300);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    noiseBurst(out, t, { brown: true, type: "lowpass", freq: 900, peak: 0.9, decay: 0.15 });
    noiseBurst(out, t + 0.12, { type: "bandpass", freq: 900, freqEnd: 2600, q: 0.8, peak: 0.55, attack: 0.08, decay: 1.4 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}
