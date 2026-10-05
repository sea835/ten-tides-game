import { audio, noiseBurst, tone, type Place } from "./engine.ts";

// Tiếng máy xe trinh sát (máy dầu rền, lên ga thì gằn cao) và thuyền tuần tra (máy đuôi tôm rít, nước rẽ sóng),
// cùng kiểu với tiếng xe tăng ở guns.ts: một vòng lặp tiếng ồn qua bộ lọc + dao động răng cưa, chỉnh theo tốc độ.
// Thêm vài tiếng ngắn: đạn nảy khỏi giáp, xích đứt.

const noop = () => {};

function live(): AudioContext | null {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== "running" || audio.settings.muted) return null;
  return ctx;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Tiếng máy theo loại xe ("jeep" hay "boat"); `update` mỗi khung hình với vị trí, tốc độ (m/s), có phải xe mình. */
export function motorEngine(kind: string): { update: (at: Place, speed: number, local: boolean) => void; stop: () => void } {
  const ctx = live();
  if (!ctx) return { update: noop, stop: noop };
  const boat = kind === "boat";
  const top = boat ? 15 : 21;
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner();
  out.connect(pan).connect(audio.bus("sfx"));
  // Thân máy: răng cưa qua bộ lọc thấp (xe trinh sát trầm hơn, thuyền máy đuôi tôm rít hơn).
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = boat ? 55 : 42;
  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.value = boat ? 110 : 84;
  const og = ctx.createGain();
  og.gain.value = 0.16;
  const og2 = ctx.createGain();
  og2.gain.value = 0.05;
  const olp = ctx.createBiquadFilter();
  olp.type = "lowpass";
  olp.frequency.value = 260;
  osc.connect(og).connect(olp);
  osc2.connect(og2).connect(olp);
  olp.connect(out);
  // Tiếng ồn: ống xả (xe) hay nước rẽ sóng (thuyền).
  const src = ctx.createBufferSource();
  src.buffer = boat ? audio.white : audio.brown;
  src.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = boat ? "bandpass" : "lowpass";
  nf.frequency.value = boat ? 700 : 300;
  nf.Q.value = boat ? 0.7 : 1.5;
  const ng = ctx.createGain();
  ng.gain.value = boat ? 0.05 : 0.35;
  src.connect(nf).connect(ng).connect(out);
  src.start(0, Math.random() * 3);
  osc.start();
  osc2.start();
  let stopped = false;
  return {
    update(at, speed, local) {
      if (stopped || !audio.ctx) return;
      const t = ctx.currentTime;
      const k = clamp(Math.abs(speed) / top, 0, 1);
      let gain = 0.16 + 0.26 * k;
      let p = 0;
      if (!local) {
        const L = audio.listener;
        const dx = at.x - L.x;
        const dz = at.z - L.z;
        const d = Math.hypot(dx, dz);
        gain *= Math.max(0, Math.pow(1 - Math.min(1, d / 90), 1.8));
        if (d > 0.5) p = clamp(((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.8, -0.8, 0.8);
      } else gain *= 0.6;
      out.gain.setTargetAtTime(gain, t, 0.15);
      pan.pan.setTargetAtTime(p, t, 0.1);
      // Vòng tua: nhanh thì lên cao (xe trinh sát có "số": tua tụt nhẹ ở giữa dải tốc độ).
      const rev = boat ? 0.35 + 0.65 * k : 0.3 + 0.7 * ((k * 2.2) % 1) * 0.6 + 0.4 * k;
      osc.frequency.setTargetAtTime((boat ? 55 : 40) * (1 + 1.6 * rev), t, 0.25);
      osc2.frequency.setTargetAtTime((boat ? 110 : 80) * (1 + 1.6 * rev), t, 0.25);
      olp.frequency.setTargetAtTime(240 + 900 * rev, t, 0.25);
      ng.gain.setTargetAtTime(boat ? 0.04 + 0.22 * k : 0.25 + 0.15 * k, t, 0.2);
      nf.frequency.setTargetAtTime(boat ? 500 + 900 * k : 250 + 250 * k, t, 0.3);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.1);
        for (const n of [src, osc, osc2]) n.stop(t + 0.5);
        setTimeout(() => out.disconnect(), 800);
      } catch {
        // Đã tắt.
      }
    },
  };
}

/** Đạn nảy khỏi giáp trước xe tăng: tiếng "keng" kim loại vút đi. */
export function playRicochet(at: Place) {
  try {
    const out = audio.output("sfx", 0.7, at, 160);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    tone(out, t, { type: "triangle", freq: 2400, freqEnd: 900, peak: 0.5, decay: 0.35 });
    tone(out, t, { type: "sine", freq: 3300, freqEnd: 1500, peak: 0.25, decay: 0.5, detune: 12 });
    noiseBurst(out, t, { type: "highpass", freq: 3000, peak: 0.5, decay: 0.08 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Xích xe tăng đứt: tiếng thép gãy, mắt xích rơi loảng xoảng. */
export function playTrackSnap(at: Place) {
  try {
    const out = audio.output("sfx", 0.8, at, 120);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    noiseBurst(out, t, { type: "bandpass", freq: 1400, q: 2, peak: 0.8, decay: 0.12 });
    for (let k = 0; k < 5; k++) tone(out, t + 0.08 + k * 0.07 + Math.random() * 0.03, { type: "square", freq: 600 + Math.random() * 500, peak: 0.12, decay: 0.06 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}
