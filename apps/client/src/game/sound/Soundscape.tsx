import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { LAVA, type World } from "@tentides/content";
import { tide } from "../tide.ts";
import { Messages, type EncounterMessage, type FxMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useFx } from "../fxStore.ts";
import { isTyping, look } from "../input.ts";
import { windStrength } from "../nature.ts";
import { getPrivate } from "../privateStore.ts";
import { localEnv, localMotion, localPosition, sky, weatherFx } from "../shared.ts";
import { audio, noiseBurst, tone, unlockAudioOnGesture } from "./engine.ts";
import { warmGunSounds } from "./guns.ts";
import { play } from "./sfx.ts";

// Âm thanh của đảo: nền (sóng biển, sóng vỗ bờ, gió, mưa, dế đêm, chim ngày, lửa trại, dung nham sôi, nước nhỏ giọt
// trong hang), bước chân theo mặt đất, tiếng động theo hiệu ứng server gửi (đánh, chặt, cây đổ, nổ súng...),
// tiếng giao diện (xúc xắc, chuông, đổi pha) và nhạc nền tự sinh đổi theo lúc ngày, đêm, căng thẳng. Battleground có
// nhạc riêng: nền điện ảnh quân sự (tiếng trầm ngân, pad thứ, trống taiko thưa, tiếng dây căng), khẽ khi đang đánh.
// M tắt/bật âm thanh, N tắt/bật nhạc.

interface Loop {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/** Một vòng tiếng ồn chạy mãi (sóng, gió, mưa...), độ to chỉnh mỗi khung hình. */
function makeLoop(brown: boolean, type: BiquadFilterType, freq: number, q = 0.7): Loop {
  const ctx = audio.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = brown ? audio.brown : audio.white;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(audio.bus("ambience"));
  src.start(0, Math.random() * 4);
  return { gain, filter };
}

function setLevel(loop: Loop | undefined, level: number, smooth = 0.4) {
  if (!loop || !audio.ctx) return;
  loop.gain.gain.setTargetAtTime(Math.max(0, level), audio.ctx.currentTime, smooth);
}

// ---------------------------------------------------------------------------- nhạc nền

/**
 * Thang nốt cho nhạc cốt truyện, hạ một quãng tám so với trước (bớt "lanh canh"): nốt nào cũng nở chậm, mềm như
 * tiếng pad chứ không gõ nhọn như đồ chơi.
 */
const SCALES = {
  day: [131, 147, 165, 196, 220, 262, 294, 330],
  dusk: [98, 110, 123.5, 147, 165, 196, 220],
  night: [110, 131, 147, 165, 196, 220, 262],
  tense: [73.4, 77.8, 87.3, 98, 103.8, 116.5, 147],
} as const;
type Mood = keyof typeof SCALES;

/** Tình hình Battleground cho nhạc: pha (lobby, prep, battle, ended) và vùng an toàn có đang thu hẹp không. */
interface BattleCue {
  phase: string;
  shrinking: boolean;
}

/** Nốt Rê trầm ngân suốt bên dưới nhạc chiến trường (nốt pedal: giữ căng thẳng dù hợp âm bên trên đổi). */
const WAR_ROOT = 73.42;
/** Hợp âm thứ, treo, lửng lơ quanh Rê (có cả bậc II giáng kiểu Phrygian cho màu u tối). */
const WAR_CHORDS: number[][] = [
  [146.83, 220, 329.63, 349.23], // Rê thứ thêm 9
  [146.83, 233.08, 293.66, 329.63], // Si giáng thêm #11 trên nền Rê
  [146.83, 196, 233.08, 293.66], // Son thứ trên nền Rê
  [110, 220, 293.66, 329.63], // La treo 4
  [146.83, 220, 293.66, 329.63], // Rê treo 2
  [155.56, 233.08, 311.13, 349.23], // Mi giáng (bậc II giáng): u ám nhất
];
/**
 * Nhịp trống (16 móc đơn = 2 ô nhịp): 3 là trống taiko lớn, 2 là trống vừa, 1 là tom trầm nhỏ.
 * Sảnh chờ, chuẩn bị: rõ nhịp; trong trận: thưa, gần như chỉ còn nhịp tim; vùng thu hẹp: dồn hơn.
 */
const DRUMS = {
  lobby: [3, 0, 0, 1, 0, 0, 2, 0, 3, 0, 0, 1, 0, 0, 2, 1],
  fight: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  shrink: [3, 0, 0, 1, 0, 0, 2, 0, 3, 0, 0, 1, 0, 1, 2, 1],
} as const;
/** Dây trầm staccato khi vùng thu hẹp (1 là có nốt, 2 là nốt quãng tám). */
const OSTINATO = [1, 0, 1, 1, 1, 0, 1, 2, 1, 0, 1, 1, 1, 0, 2, 1];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Đáp ứng xung cho hồi âm của nhạc: tiếng ồn tắt dần và tối dần, dài ~3,5 giây như một khán phòng lớn. */
function hallImpulse(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 3.5);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const s = i / rate;
      const k = 0.08 + 0.5 * Math.exp(-s / 0.5);
      lp += k * (Math.random() * 2 - 1 - lp);
      data[i] = s < 0.02 ? 0 : lp * Math.exp(-s / 0.9) * (1 - s / 3.5);
    }
  }
  return ir;
}

class Music {
  private ctx: AudioContext | null = null;
  /** Độ đậm tổng của nhạc theo cảnh (sảnh chờ rõ, giữa trận khẽ). */
  private out!: GainNode;
  private dry!: GainNode;
  /** Gửi sang hồi âm. */
  private wet!: GainNode;
  /** Lọc mềm cho giai điệu cốt truyện (cắt bớt cao tần cho khỏi chói). */
  private soft!: BiquadFilterNode;
  /** Trống: đi thẳng và gửi nhiều sang hồi âm cho xa, rộng. */
  private drums!: GainNode;
  /** Dây trầm staccato. */
  private ost!: BiquadFilterNode;
  private drone!: { gain: GainNode; filter: BiquadFilterNode; lfo: GainNode };
  private next = 0;
  private count = 0;
  private nextChord = 0;
  private chord = -1;
  private nextPad = 0;
  private beatAt = 0;
  private beat = 0;
  private nextSwell = 0;
  private lastPhase = "";

  private setup(ctx: AudioContext) {
    this.ctx = ctx;
    const music = audio.bus("music");
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(music);
    this.dry = ctx.createGain();
    this.dry.connect(this.out);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    const conv = ctx.createConvolver();
    conv.buffer = hallImpulse(ctx);
    this.wet.connect(conv).connect(this.out);
    this.soft = ctx.createBiquadFilter();
    this.soft.type = "lowpass";
    this.soft.frequency.value = 1500;
    this.soft.Q.value = 0.5;
    this.soft.connect(this.dry);
    const softSend = ctx.createGain();
    softSend.gain.value = 0.7;
    this.soft.connect(softSend).connect(this.wet);
    this.drums = ctx.createGain();
    this.drums.connect(this.dry);
    const drumSend = ctx.createGain();
    drumSend.gain.value = 0.55;
    this.drums.connect(drumSend).connect(this.wet);
    this.ost = ctx.createBiquadFilter();
    this.ost.type = "lowpass";
    this.ost.frequency.value = 480;
    this.ost.Q.value = 2.5;
    this.ost.connect(this.dry);
    // Tiếng trầm ngân: hai răng cưa lệch nhau vài cent (dày, rung nhẹ) cộng sin quãng tám dưới, qua lọc thấp có
    // LFO rất chậm cho màu tiếng "thở".
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 150;
    filter.Q.value = 1.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 45;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    for (const [type, freq, detune, level] of [
      ["sawtooth", WAR_ROOT, -7, 0.5],
      ["sawtooth", WAR_ROOT, 6, 0.5],
      ["sine", WAR_ROOT / 2, 0, 0.9],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start();
    }
    filter.connect(gain).connect(this.dry);
    const droneSend = ctx.createGain();
    droneSend.gain.value = 0.35;
    gain.connect(droneSend).connect(this.wet);
    this.drone = { gain, filter, lfo: lfoGain };
  }

  /** Mỗi khung hình: `battle` khác null là nhạc Battleground, không thì nhạc cốt truyện theo `mood`. */
  step(mood: Mood | null, battle: BattleCue | null) {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (this.ctx !== ctx) this.setup(ctx);
    const now = ctx.currentTime;
    // Tắt tiếng hay tắt nhạc thì khỏi đặt nốt mới (bus nhạc đã im, đỡ tốn CPU).
    const off = audio.settings.muted || !audio.settings.music;
    if (battle) this.war(now, battle, off);
    else this.story(now, mood, off);
  }

  // --- Battleground: nền điện ảnh quân sự, căng, u tối

  private war(now: number, cue: BattleCue, off: boolean) {
    const fight = cue.phase === "battle";
    const ended = cue.phase === "ended";
    const shrink = fight && cue.shrinking;
    // Sảnh chờ, chuẩn bị: nhạc rõ hơn; giữa trận: khẽ, nằm dưới tiếng súng; vùng thu hẹp: đậm lên một chút.
    const level = ended ? 0.45 : shrink ? 0.72 : fight ? 0.5 : 0.95;
    this.out.gain.setTargetAtTime(level, now, 2.5);
    this.drone.gain.gain.setTargetAtTime(off ? 0 : ended ? 0.06 : 0.14, now, 1.5);
    this.drone.filter.frequency.setTargetAtTime(shrink ? 240 : fight ? 150 : 185, now, 3);
    this.drone.lfo.gain.setTargetAtTime(shrink ? 90 : 45, now, 3);
    if (cue.phase !== this.lastPhase) {
      // Trận bắt đầu: một cú taiko lớn và tiếng dây dâng lên.
      if (this.lastPhase && fight && !off) {
        this.drum(now + 0.05, 3, 1.3);
        this.swell(now + 0.05, "strings", 5);
      }
      this.lastPhase = cue.phase;
    }
    if (off) return;
    // Hợp âm pad: đổi chậm, gối lên nhau cho liền mạch.
    if (this.nextChord < now - 1) this.nextChord = now + 0.1;
    if (now >= this.nextChord - 0.15) {
      let c = Math.floor(Math.random() * WAR_CHORDS.length);
      if (c === this.chord) c = (c + 1 + Math.floor(Math.random() * (WAR_CHORDS.length - 1))) % WAR_CHORDS.length;
      this.chord = c;
      const dur = fight ? rnd(11, 15) : rnd(8, 11);
      this.pad(WAR_CHORDS[c]!, this.nextChord, dur + 3.5, ended ? 0.018 : 0.03, fight ? 650 : 900);
      this.nextChord += dur;
    }
    // Trống và dây trầm, đặt trước ~0,3 giây cho đúng nhịp dù khung hình giật.
    const bpm = shrink ? 76 : 66;
    const eighth = 30 / bpm;
    if (this.beatAt < now - 0.5) this.beatAt = now + 0.05;
    while (this.beatAt < now + 0.3) {
      const step = this.beat % 16;
      if (!ended) {
        const pattern = shrink ? DRUMS.shrink : fight ? DRUMS.fight : DRUMS.lobby;
        const hit = pattern[step]!;
        // Giữa trận thỉnh thoảng bỏ nhịp nhỏ cho khỏi đều như máy.
        if (hit && !(fight && hit === 1 && Math.random() < 0.4)) this.drum(this.beatAt, hit as 1 | 2 | 3, fight && !shrink ? 0.75 : 1);
        if (shrink && OSTINATO[step]) {
          const f = OSTINATO[step] === 2 ? WAR_ROOT * 2 : WAR_ROOT;
          tone(this.ost, this.beatAt, { type: "sawtooth", freq: f, attack: 0.006, decay: 0.16, peak: 0.07 });
        }
      }
      this.beatAt += eighth;
      this.beat++;
    }
    // Thỉnh thoảng một tiếng dâng: dây nghịch tai hay kim loại cọ xa xa.
    if (this.nextSwell < now - 5) this.nextSwell = now + rnd(6, 12);
    if (now >= this.nextSwell && !ended) {
      this.nextSwell = now + (fight ? rnd(22, 40) : rnd(14, 26)) * (shrink ? 0.7 : 1);
      this.swell(now, Math.random() < 0.55 ? "strings" : "metal", rnd(5, 8));
    }
  }

  /** Pad: mỗi nốt hai răng cưa lệch vài cent, qua lọc thấp mở rồi đóng chậm; lên xuống từ từ. */
  private pad(freqs: readonly number[], t: number, dur: number, peak: number, cutoff: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(cutoff * 0.5, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.45, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    f.connect(g);
    g.connect(this.dry);
    g.connect(send).connect(this.wet);
    let first: OscillatorNode | null = null;
    for (const fr of freqs) {
      for (const det of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = fr;
        o.detune.value = det + rnd(-3, 3);
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
        first ??= o;
      }
    }
    if (first) {
      first.onended = () => {
        f.disconnect();
        g.disconnect();
        send.disconnect();
      };
    }
  }

  /** Trống taiko / tom trầm: thân sin trượt xuống, da trống (tiếng ồn nâu lọc thấp), tiếng dùi chạm. */
  private drum(t: number, kind: 1 | 2 | 3, k: number) {
    const out = this.drums;
    const big = kind === 3;
    const mid = kind === 2;
    tone(out, t, { freq: big ? 92 : mid ? 118 : 160, freqEnd: big ? 40 : mid ? 58 : 88, attack: 0.003, decay: big ? 0.95 : mid ? 0.55 : 0.32, peak: (big ? 0.55 : mid ? 0.34 : 0.2) * k });
    noiseBurst(out, t, { brown: true, type: "lowpass", freq: big ? 420 : 520, freqEnd: 110, attack: 0.002, decay: big ? 0.4 : 0.22, peak: (big ? 0.5 : 0.28) * k });
    noiseBurst(out, t, { type: "bandpass", freq: big ? 600 : 800, q: 0.9, attack: 0.001, decay: 0.025, peak: 0.07 * k });
  }

  /** Tiếng dâng căng thẳng: dây nghịch tai (quãng 2 thứ) mở dần, hay kim loại cọ (bồi âm không hòa âm) vọng xa. */
  private swell(t: number, kind: "strings" | "metal", dur: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === "strings" ? 0.05 : 0.035, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = kind === "strings" ? "bandpass" : "lowpass";
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(kind === "strings" ? 500 : 2500, t);
    f.frequency.exponentialRampToValueAtTime(kind === "strings" ? 1800 : 1500, t + dur * 0.85);
    f.connect(g);
    const send = ctx.createGain();
    send.gain.value = kind === "strings" ? 0.8 : 1.4;
    g.connect(this.dry);
    g.connect(send).connect(this.wet);
    const oscs: OscillatorNode[] = [];
    if (kind === "strings") {
      const sets = [
        [440, 466.16],
        [293.66, 311.13, 440],
        [587.33, 622.25],
      ];
      for (const fr of sets[Math.floor(Math.random() * sets.length)]!) {
        for (const det of [-6, 5]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = fr;
          o.detune.value = det;
          oscs.push(o);
          o.connect(f);
        }
      }
    } else {
      // Tỉ lệ bồi âm như một thanh kim loại được kéo vĩ: nghe lạnh, xa, bất an.
      const base = rnd(170, 250);
      [1, 2.76, 5.4, 8.93].forEach((r, i) => {
        const o = ctx.createOscillator();
        o.frequency.value = base * r;
        o.detune.value = rnd(-8, 8);
        const og = ctx.createGain();
        og.gain.value = 0.6 / (i + 1);
        o.connect(og).connect(f);
        oscs.push(o);
      });
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    oscs[0]!.onended = () => {
      f.disconnect();
      g.disconnect();
      send.disconnect();
    };
  }

  // --- Cốt truyện: mềm, thoáng, như gió biển

  private story(now: number, mood: Mood | null, off: boolean) {
    this.out.gain.setTargetAtTime(0.85, now, 2);
    this.lastPhase = "";
    // Căng thẳng thì có tiếng trầm ngân nền.
    this.drone.gain.gain.setTargetAtTime(!off && mood === "tense" ? 0.1 : 0, now, 1.5);
    this.drone.filter.frequency.setTargetAtTime(130, now, 2);
    this.drone.lfo.gain.setTargetAtTime(35, now, 2);
    if (off || !mood) return;
    const scale = SCALES[mood];
    const slow = mood === "night" || mood === "dusk" ? 1.4 : mood === "tense" ? 1.2 : 1;
    // Pad nền rất khẽ: nốt gốc, bậc ba, bậc năm của thang, đổi chậm.
    if (now >= this.nextPad) {
      const dur = rnd(10, 14) * slow;
      this.nextPad = now + dur - 3;
      const root = Math.floor(Math.random() * 3);
      this.pad([scale[root]!, scale[root + 2]!, scale[root + 4]!], now, dur, mood === "tense" ? 0.016 : 0.012, mood === "day" ? 900 : 650);
    }
    if (now < this.next) return;
    this.next = now + (1.1 + Math.random() * 1.6) * slow;
    this.count++;
    // Thỉnh thoảng lặng một nhịp cho giai điệu thở.
    if (Math.random() < 0.35) return;
    const freq = scale[Math.floor(Math.random() * scale.length)]!;
    // Nốt nở chậm (không gõ nhọn): sin làm lõi, tam giác qua lọc mềm cho chút màu, như sáo trầm hay kèn gỗ xa.
    tone(this.soft, now, { type: "sine", freq, attack: 0.22, decay: 2.2 * slow, peak: 0.2 });
    tone(this.soft, now, { type: "triangle", freq, attack: 0.3, decay: 1.6 * slow, peak: 0.07, detune: 4 });
    if (this.count % 4 === 0) tone(this.soft, now, { type: "sine", freq: scale[0]! / 2, attack: 0.5, decay: 3.2 * slow, peak: 0.2 });
  }
}

// ---------------------------------------------------------------------------- mặt đất dưới chân

function surfaceSound(world: World, x: number, z: number): "step_sand" | "step_grass" | "step_rock" | "step_water" | "step_wood" {
  const ground = world.heightAt(x, z);
  if (ground < tide.level + 0.05) return "step_water";
  if (world.structureAt(x, z)) return "step_rock";
  const s = world.surface(x, z);
  if (s.islet && (s.islet.kind === "rocky" || s.islet.kind === "volcanic")) return "step_rock";
  const zone = world.zoneAt(x, z);
  if (zone === "volcano" || (zone === "cave" && ground > 2.5)) return "step_rock";
  if (s.inland < (s.island === "islet" ? 5 : 14)) return "step_sand";
  return "step_grass";
}

// ---------------------------------------------------------------------------- tiếng theo hiệu ứng

const SLASH_WORDS = ["XOẸT!", "PHẬP!", "SOẠT!"];

function fxSound(fx: FxMessage) {
  const at = { x: fx.x, y: fx.y, z: fx.z };
  const word = fx.word ?? "";
  switch (fx.kind) {
    case "hit":
      if (word.includes("NGOẠM")) play("bite", { at });
      else if (word.includes("HUỴCH")) play("thud", { at });
      else if (word.includes("BONG")) play("clang", { at });
      else if (SLASH_WORDS.some((w) => word.includes(w))) play("slash", { at });
      else play("punch", { at, volume: Math.min(1, 0.6 + (fx.amount ?? 5) / 25) });
      return;
    case "miss":
      return play("whoosh", { at });
    case "chop":
      return play("chop", { at });
    case "fell":
      return play("tree_fall", { at, hearing: 110 });
    case "poof":
      return play("poof", { at });
    case "kill":
      return play("kill", { at });
    case "eat":
      if (word.includes("KHẨU PHẦN")) return play("stash", { at });
      return play(word.includes("ỰC") ? "gulp" : "crunch", { at });
    case "plant":
      return play("dig", { at });
    case "build":
      return play("hammer", { at });
    case "splash":
      play("splash", { at, hearing: 90 });
      if (word.includes("CÁ MẬP")) play("shark", { at, hearing: 90, volume: 1.2 });
      return;
    case "shoot":
      return word.includes("ĐOÀNG") ? play("gunshot", { at, hearing: 160 }) : play("twang", { at });
    case "cook":
      return play("sizzle", { at });
    case "page":
      return play("rustle", { at });
    case "lava":
      return play("lava", { at, hearing: 120 });
    case "burn":
      play("sizzle", { at });
      return play("punch", { at, volume: 0.5 });
    case "drown":
      return play("bubbles", { at });
    case "give":
      return play("pickup", { at });
    case "craft":
    case "repair":
      return play("hammer", { at });
  }
}

// ---------------------------------------------------------------------------- toàn cảnh

export function Soundscape({ room, world }: { room: IslandRoom; world: World }) {
  const loops = useRef<Record<string, Loop>>({});
  const music = useRef(new Music());
  const timers = useRef({ step: 0, cricket: 1, bird: 2, crackle: 0, drip: 1, bubble: 0.5, lastStep: 1 });
  const seen = useRef({ log: -1, phase: "", bag: -1 });

  // Bật âm thanh ở lần bấm đầu tiên; dựng các vòng tiếng nền khi bộ máy sẵn sàng.
  useEffect(() => unlockAudioOnGesture(), []);
  useEffect(
    () =>
      audio.onStart(() => {
        loops.current = {
          // Nền dùng tiếng ồn nâu (trầm, êm) thay cho tiếng ồn trắng: trước đây sóng vỗ, gió, mưa nghe "rè rè" như
          // radio mất sóng, lại đè lên tiếng bước chân, tiếng súng.
          ocean: makeLoop(true, "lowpass", 380),
          surf: makeLoop(true, "bandpass", 650, 0.5),
          wind: makeLoop(true, "lowpass", 420, 0.6),
          // Mưa: tiếng ồn trắng qua lọc thấp (lộp độp êm) thay cho dải thông 1,7 kHz nghe xè xè chói tai.
          rain: makeLoop(false, "lowpass", 1100, 0.5),
          lava: makeLoop(true, "lowpass", 160),
          fire: makeLoop(false, "bandpass", 3200, 0.8),
        };
      }),
    [],
  );

  // M tắt/bật âm thanh, N tắt/bật nhạc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      if (e.code === "KeyM") audio.setMuted(!audio.settings.muted);
      if (e.code === "KeyN") audio.setMusic(!audio.settings.music);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tin riêng từ server: chạm trán tốt xấu, bị từ chối.
  useEffect(() => {
    const offEncounter = room.onMessage(Messages.encounter, (m: EncounterMessage) =>
      play(m.tone === "good" ? "chime_good" : m.tone === "bad" ? "chime_bad" : "chime_neutral", { bus: "ui" }),
    );
    const offReject = room.onMessage(Messages.rejected, () => play("buzz", { bus: "ui" }));
    const offStar = room.onMessage(Messages.starred, () => play("chime_neutral", { bus: "ui" }));
    // Tiếng bấm, rê chuột qua nút: installUiSounds (sound/ui.ts) gắn cho cả ứng dụng ở App.
    return () => {
      offEncounter();
      offReject();
      offStar();
    };
  }, [room]);

  useFx(fxSound);

  useFrame(({ camera, clock }, rawDt) => {
    if (!audio.ready) return;
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const state = room.state;
    const me = myId(room);
    audio.listener.x = camera.position.x;
    audio.listener.y = camera.position.y;
    audio.listener.z = camera.position.z;
    audio.listener.yaw = look.yaw;
    audio.setUnderwater(localEnv.underwater ? 1 : 0);

    // --- nền
    const p = localPosition;
    const surface = world.surface(p.x, p.z);
    const outdoors = 1 - localEnv.indoor;
    const nearSea = Math.max(0, Math.min(1, 1 - surface.inland / 70));
    const waves = 0.65 + 0.35 * Math.sin(t * 0.55) * Math.sin(t * 0.23 + 1);
    // Bản đồ Battleground không có núi lửa, không có lửa trại; nền nhỏ hơn hẳn để nghe rõ bước chân, tiếng súng.
    const battle = state.mode === "battle";
    const bed = battle ? 0.55 : 1;
    setLevel(loops.current.ocean, (0.12 + 0.45 * nearSea) * outdoors * bed * (localEnv.underwater ? 1.4 : 1));
    // Sóng vỗ bờ: to nhất khi đứng sát mép nước.
    const shore = Math.max(0, 1 - Math.abs(surface.inland) / 25);
    setLevel(loops.current.surf, 0.3 * shore * waves * outdoors * bed * (1 + weatherFx.storm), 0.25);
    const height = Math.max(0, Math.min(1, p.y / 30));
    setLevel(loops.current.wind, (0.04 + 0.1 * height + 0.08 * (windStrength.value - 1)) * outdoors * bed);
    loops.current.wind?.filter.frequency.setTargetAtTime(300 + 150 * Math.sin(t * 0.3) + 250 * weatherFx.storm, audio.ctx!.currentTime, 0.5);
    // Nhỏ hơn nhiều so với trước (0.3 → 0.13), trong nhà gần như tắt, ở sảnh chờ / lúc chuẩn bị còn nhỏ nữa.
    const waiting = battle && (state.phase === "lobby" || state.phase === "prep");
    setLevel(loops.current.rain, 0.13 * weatherFx.rain * (0.12 + 0.88 * outdoors) * (battle ? 0.8 : 1) * (waiting ? 0.35 : 1));
    const lavaDist = battle ? 999 : Math.hypot(p.x - LAVA.x, p.z - LAVA.z);
    setLevel(loops.current.lava, 0.7 * Math.pow(Math.max(0, 1 - lavaDist / 70), 2) * (0.6 + state.volcano / 200));
    const campDist = state.campPacked || battle ? 99 : Math.hypot(p.x - state.campX, p.z - state.campZ);
    const fireNear = Math.pow(Math.max(0, 1 - campDist / 22), 2);
    setLevel(loops.current.fire, 0.1 * fireNear);

    // Tiếng lẻ tẻ: lửa lách tách, dế đêm, chim ngày, nước nhỏ giọt trong hang, bọt nước khi lặn.
    const tm = timers.current;
    tm.crackle -= dt;
    if (fireNear > 0.02 && tm.crackle <= 0) {
      tm.crackle = 0.08 + Math.random() * 0.35;
      const out = audio.output("ambience", 0.6 * fireNear);
      if (out) noiseBurst(out, audio.ctx!.currentTime, { type: "highpass", freq: 2500 + Math.random() * 3000, decay: 0.02 + Math.random() * 0.03, peak: 0.4 + Math.random() * 0.6 });
    }
    const onLand = surface.inland > 5 && !localEnv.underwater;
    tm.cricket -= dt;
    if (tm.cricket <= 0) {
      tm.cricket = 0.25 + Math.random() * 1.2;
      const level = sky.night * outdoors * (1 - weatherFx.rain) * (onLand ? 1 : 0.2);
      const out = level > 0.1 && audio.output("ambience", 0.12 * level);
      if (out) {
        const now = audio.ctx!.currentTime;
        const f = 4000 + Math.random() * 900;
        for (let k = 0; k < 3; k++) tone(out, now + k * 0.045, { freq: f, decay: 0.03, peak: 1 });
      }
    }
    tm.bird -= dt;
    if (tm.bird <= 0) {
      tm.bird = 1.5 + Math.random() * 5;
      const level = (1 - sky.night) * outdoors * (1 - weatherFx.rain) * (1 - weatherFx.storm) * (onLand ? 1 : 0.3);
      const out = level > 0.15 && audio.output("ambience", 0.18 * level);
      if (out) {
        const now = audio.ctx!.currentTime;
        const base = 1800 + Math.random() * 1600;
        const notes = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < notes; k++) tone(out, now + k * 0.13, { freq: base * (1 + Math.random() * 0.3), freqEnd: base * (0.8 + Math.random() * 0.7), decay: 0.09, peak: 1 });
      }
    }
    tm.drip -= dt;
    if (localEnv.indoor > 0.3 && tm.drip <= 0) {
      tm.drip = 0.8 + Math.random() * 2.5;
      const out = audio.output("ambience", 0.25 * localEnv.indoor);
      if (out) tone(out, audio.ctx!.currentTime, { freq: 1200 + Math.random() * 900, freqEnd: 600, decay: 0.12, peak: 1 });
    }
    tm.bubble -= dt;
    if (localEnv.underwater && tm.bubble <= 0) {
      tm.bubble = 1 + Math.random() * 2.5;
      play("bubbles", { volume: 0.4 });
    }

    // --- bước chân, bơi, leo
    // Đi bộ: phát đúng theo bộ đếm nhịp chân mà LocalPlayer cộng dồn cùng phase với camera bob.
    // Trước đây chạy timer riêng (0.42s/0.28s) trong khi bob chạy ~7.9 nhịp/s ⇒ lệch và trôi dần.
    // Chặn thêm một lớp: hai tiếng chân mặt đất không bao giờ sát nhau quá 0.15s (nhanh nhất lúc sprint
    // ~0.2s/bước), nên dù phase có dao động quanh π cũng không thành tiếng rè.
    tm.lastStep += dt;
    if (localMotion.stepHit && localMotion.moving && (localMotion.speed ?? 0) > 0.8 && tm.lastStep > 0.15) {
      tm.lastStep = 0;
      if (localMotion.climbing) {
        play("climb", { volume: 0.6 });
      } else if (localMotion.swimming) {
        play("swim", { volume: 0.7 });
      } else if (p.y - world.heightAt(p.x, p.z) < 0.3) {
        play(surfaceSound(world, p.x, p.z), { volume: localMotion.running ? 1 : 0.7 });
      }
    }
    // Bơi và leo không có nhịp chân trên mặt đất nên vẫn giữ nhịp riêng cho chúng.
    if (!localMotion.groundStep) {
      tm.step -= dt;
      if (tm.step <= 0 && localMotion.moving && (localMotion.climbing || localMotion.swimming)) {
        tm.step = localMotion.climbing ? 0.35 : localMotion.running ? 0.55 : 0.8;
        if (localMotion.climbing) play("climb", { volume: 0.6 });
        else play("swim", { volume: 0.7 });
      }
    }

    // --- đổi pha, nhật ký (xúc xắc, ai gục, biến cố), nhặt đồ
    const s = seen.current;
    if (state.phase !== s.phase) {
      if (s.phase) {
        // Battleground hết trận: cú trống trầm và hợp âm thứ thay cho nhạc hiệu vui tươi của cốt truyện.
        const stinger = battle
          ? state.phase === "ended"
            ? "battle_end"
            : undefined
          : ({ dawn: "dawn", dusk: "dusk", night: "night", ended: "ended" }[state.phase as string] as "dawn" | "dusk" | "night" | "ended" | undefined);
        if (stinger) play(stinger, { bus: "ui" });
      }
      s.phase = state.phase;
    }
    if (s.log < 0) s.log = state.log.length;
    for (; s.log < state.log.length; s.log++) {
      const e = state.log[s.log]!;
      if (e.kind === "check" && [...e.players].includes(me)) {
        play("dice", { bus: "ui" });
        play(e.success ? "success" : "fail", { bus: "ui", delay: 0.55 });
      } else if (e.kind === "death") play("death", { bus: "ui" });
      else if (e.kind === "twist") play("twist", { bus: "ui" });
    }
    const bag = getPrivate()?.bag.length ?? -1;
    if (bag > s.bag && s.bag >= 0 && ["dawn", "explore", "dusk"].includes(state.phase)) play("pickup", { bus: "ui" });
    s.bag = bag;

    // --- nhạc
    const hp = state.players.get(me)?.hp ?? 100;
    const tense = state.volcano >= 70 || weatherFx.storm > 0.5 || hp < 30;
    const mood =
      state.phase === "ended"
        ? null
        : tense && state.phase !== "lobby"
          ? "tense"
          : state.phase === "night"
            ? "night"
            : state.phase === "dusk"
              ? "dusk"
              : "day";
    // Battleground: nhạc chiến trường riêng (theo pha và vùng an toàn); dựng sẵn tiếng súng cho phát đầu khỏi khựng.
    if (battle) warmGunSounds();
    music.current.step(mood, battle ? { phase: state.phase, shrinking: !!state.zone?.shrinking } : null);
  });

  return null;
}
