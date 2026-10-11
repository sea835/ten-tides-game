import { audio, type Place } from "./engine.ts";

// Tiếng máy hải chiến, dựng bằng nút Web Audio (không cần tệp âm thanh), cùng kiểu với air.ts / motors.ts:
// - Máy tàu: diesel trầm (hai sóng răng cưa lệch nhau chút ít qua lọc thấp, nhịp nổ máy nhấp nhô theo vòng tua) cộng
//   tiếng nước rẽ mũi tàu, xoáy sau chân vịt (tiếng ồn qua lọc dải), to dần theo tốc độ.
// - Máy bay: động cơ cánh quạt gầm (răng cưa + hoà âm, cao độ theo tốc độ, nhấp nhô theo nhịp cánh quạt) cộng tiếng
//   gió rít quanh thân khi bay nhanh, bổ nhào.

const noop = () => {};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function live(): AudioContext | null {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== "running" || audio.settings.muted) return null;
  return ctx;
}

/** Âm lượng theo khoảng cách tới người nghe, và độ lệch trái / phải (−1 … 1). */
function place(at: Place, hearing: number): { k: number; pan: number; d: number } {
  const L = audio.listener;
  const dx = at.x - L.x;
  const dz = at.z - L.z;
  const d = Math.hypot(dx, dz, (at.y - L.y) * 0.7);
  const k = Math.pow(1 - Math.min(1, d / hearing), 1.6);
  const pan = d > 1 ? clamp(((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.8, -0.8, 0.8) : 0;
  return { k, pan, d };
}

export interface LoopSound {
  update: (at: Place, load: number, local: boolean) => void;
  stop: () => void;
}

function stopper(ctx: AudioContext, out: GainNode, nodes: AudioScheduledSourceNode[]): () => void {
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(0, t, 0.2);
      for (const n of nodes) n.stop(t + 1);
      setTimeout(() => out.disconnect(), 1300);
    } catch {
      // Đã tắt.
    }
  };
}

/** Nghe được máy tàu tới chừng này mét. */
const SHIP_HEARING = 420;

/** Máy tàu; `update` mỗi khung với vị trí, tải (0 dừng máy … 1 hết máy), có phải tàu mình đang ở trên. */
export function shipEngineSound(size: number): LoopSound {
  const ctx = live();
  if (!ctx) return { update: noop, stop: noop };
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner();
  out.connect(pan).connect(audio.bus("sfx"));
  // Diesel: hai răng cưa trầm lệch nhau, lọc thấp, điều biên theo nhịp nổ.
  const base = 30 + 20 / Math.max(0.6, size);
  const a = ctx.createOscillator();
  a.type = "sawtooth";
  a.frequency.value = base;
  const b = ctx.createOscillator();
  b.type = "square";
  b.frequency.value = base * 1.502;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 160;
  lp.Q.value = 2;
  const chug = ctx.createGain();
  chug.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = "triangle";
  lfo.frequency.value = 5;
  const depth = ctx.createGain();
  depth.gain.value = 0.35;
  lfo.connect(depth).connect(chug.gain);
  const og = ctx.createGain();
  og.gain.value = 0.22;
  a.connect(lp);
  b.connect(og).connect(lp);
  lp.connect(chug).connect(out);
  // Nước rẽ mũi, xoáy chân vịt.
  const water = ctx.createBufferSource();
  water.buffer = audio.brown;
  water.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 500;
  bp.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = 0;
  water.connect(bp).connect(wg).connect(out);
  a.start();
  b.start();
  lfo.start();
  water.start(0, Math.random() * 3);
  return {
    update(at, load, local) {
      const t = ctx.currentTime;
      const l = clamp(load, 0, 1);
      const { k, pan: p } = local ? { k: 1, pan: 0 } : place(at, SHIP_HEARING);
      const gain = (local ? 0.16 : 0.32) * k * (0.35 + 0.65 * l);
      out.gain.setTargetAtTime(gain, t, 0.3);
      pan.pan.setTargetAtTime(p, t, 0.2);
      a.frequency.setTargetAtTime(base * (1 + 0.6 * l), t, 0.8);
      b.frequency.setTargetAtTime(base * 1.502 * (1 + 0.6 * l), t, 0.8);
      lfo.frequency.setTargetAtTime(3 + 7 * l, t, 0.8);
      lp.frequency.setTargetAtTime(120 + 160 * l, t, 0.5);
      wg.gain.setTargetAtTime(0.9 * l * l, t, 0.4);
      bp.frequency.setTargetAtTime(350 + 450 * l, t, 0.5);
    },
    stop: stopper(ctx, out, [a, b, lfo, water]),
  };
}

/** Nghe được máy bay tới chừng này mét. */
const JET_HEARING = 900;

/** Máy bay cánh quạt; `load`: tốc độ so với tối đa (0–1+), `local`: máy bay mình đang lái. */
export function planeEngineSound(): LoopSound {
  const ctx = live();
  if (!ctx) return { update: noop, stop: noop };
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner();
  out.connect(pan).connect(audio.bus("sfx"));
  // Động cơ: răng cưa + hoà âm bậc hai, lọc thấp, nhịp cánh quạt điều biên.
  const e1 = ctx.createOscillator();
  e1.type = "sawtooth";
  e1.frequency.value = 70;
  const e2 = ctx.createOscillator();
  e2.type = "sawtooth";
  e2.frequency.value = 141;
  const e2g = ctx.createGain();
  e2g.gain.value = 0.45;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 700;
  lp.Q.value = 1.4;
  const prop = ctx.createGain();
  prop.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 22;
  const depth = ctx.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth).connect(prop.gain);
  e1.connect(lp);
  e2.connect(e2g).connect(lp);
  lp.connect(prop).connect(out);
  // Gió rít.
  const wind = ctx.createBufferSource();
  wind.buffer = audio.brown;
  wind.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = 900;
  hp.Q.value = 0.7;
  const wg = ctx.createGain();
  wg.gain.value = 0;
  wind.connect(hp).connect(wg).connect(out);
  e1.start();
  e2.start();
  lfo.start();
  wind.start(0, Math.random() * 3);
  let lastD = -1;
  return {
    update(at, load, local) {
      const t = ctx.currentTime;
      const l = clamp(load, 0, 1.3);
      let gain: number;
      let p = 0;
      let doppler = 1;
      if (local) {
        gain = 0.2;
      } else {
        const pl = place(at, JET_HEARING);
        gain = 0.45 * pl.k;
        p = pl.pan;
        // Doppler thô: lại gần thì cao, bay xa thì trầm (theo đổi khoảng cách mỗi khung).
        if (lastD >= 0) doppler = clamp(1 - (pl.d - lastD) * 0.08, 0.85, 1.15);
        lastD = pl.d;
        lp.frequency.setTargetAtTime(300 + 500 * Math.max(0, 1 - pl.d / 400), t, 0.3);
      }
      out.gain.setTargetAtTime(gain, t, 0.15);
      pan.pan.setTargetAtTime(p, t, 0.1);
      const f = (62 + 46 * l) * doppler;
      e1.frequency.setTargetAtTime(f, t, 0.25);
      e2.frequency.setTargetAtTime(f * 2.02, t, 0.25);
      lfo.frequency.setTargetAtTime(14 + 22 * l, t, 0.3);
      wg.gain.setTargetAtTime(0.5 * Math.max(0, l - 0.5), t, 0.3);
      hp.frequency.setTargetAtTime(700 + 900 * l, t, 0.3);
    },
    stop: stopper(ctx, out, [e1, e2, lfo, wind]),
  };
}
