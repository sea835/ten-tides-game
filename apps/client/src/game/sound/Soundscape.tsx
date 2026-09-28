import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { LAVA, WATER_LEVEL, type World } from "@tentides/content";
import { Messages, type EncounterMessage, type FxMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useFx } from "../fxStore.ts";
import { isTyping, look } from "../input.ts";
import { windStrength } from "../nature.ts";
import { getPrivate } from "../privateStore.ts";
import { localEnv, localMotion, localPosition, sky, weatherFx } from "../shared.ts";
import { audio, noiseBurst, tone, unlockAudioOnGesture } from "./engine.ts";
import { play } from "./sfx.ts";

// Âm thanh của đảo: nền (sóng biển, sóng vỗ bờ, gió, mưa, dế đêm, chim ngày, lửa trại, dung nham sôi, nước nhỏ giọt
// trong hang), bước chân theo mặt đất, tiếng động theo hiệu ứng server gửi (đánh, chặt, cây đổ, nổ súng...),
// tiếng giao diện (xúc xắc, chuông, đổi pha) và nhạc nền tự sinh đổi theo lúc ngày, đêm, căng thẳng.
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
  src.start(0, Math.random() * 1.5);
  return { gain, filter };
}

function setLevel(loop: Loop | undefined, level: number, smooth = 0.4) {
  if (!loop || !audio.ctx) return;
  loop.gain.gain.setTargetAtTime(Math.max(0, level), audio.ctx.currentTime, smooth);
}

// ---------------------------------------------------------------------------- nhạc nền

const SCALES = {
  day: [262, 294, 330, 392, 440, 523, 587, 659],
  dusk: [196, 220, 247, 294, 330, 392, 440],
  night: [220, 262, 294, 330, 392, 440, 523],
  tense: [147, 156, 175, 196, 208, 233, 294],
} as const;
type Mood = keyof typeof SCALES;

class Music {
  private input: GainNode | null = null;
  private next = 0;
  private count = 0;
  private drone: { osc: OscillatorNode; gain: GainNode } | null = null;

  private setup() {
    const ctx = audio.ctx!;
    this.input = ctx.createGain();
    // Tiếng vọng nhẹ cho nốt nhạc nghe như vang giữa biển.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.37;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tail = ctx.createBiquadFilter();
    tail.type = "lowpass";
    tail.frequency.value = 2200;
    this.input.connect(audio.bus("music"));
    this.input.connect(delay).connect(tail).connect(feedback).connect(delay);
    tail.connect(audio.bus("music"));
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 73;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(audio.bus("music"));
    osc.start();
    this.drone = { osc, gain };
  }

  step(mood: Mood | null) {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (!this.input) this.setup();
    const now = ctx.currentTime;
    // Căng thẳng thì có tiếng trầm ngân nền.
    this.drone!.gain.gain.setTargetAtTime(mood === "tense" ? 0.12 : 0, now, 1.5);
    if (!mood || now < this.next) return;
    const scale = SCALES[mood];
    const slow = mood === "night" || mood === "dusk" ? 1.5 : mood === "tense" ? 1.25 : 1;
    this.next = now + (0.55 + Math.random() * 0.9) * slow;
    this.count++;
    // Thỉnh thoảng lặng một nhịp cho giai điệu thở.
    if (Math.random() < 0.28) return;
    const freq = scale[Math.floor(Math.random() * scale.length)]!;
    tone(this.input!, now, { type: "triangle", freq, attack: 0.01, decay: 1.4 * slow, peak: 0.22 });
    tone(this.input!, now, { type: "sine", freq: freq * 2, attack: 0.01, decay: 0.6, peak: 0.05 });
    if (this.count % 4 === 0) tone(this.input!, now, { type: "sine", freq: scale[0]! / 2, attack: 0.08, decay: 2.6 * slow, peak: 0.2 });
  }
}

// ---------------------------------------------------------------------------- mặt đất dưới chân

function surfaceSound(world: World, x: number, z: number): "step_sand" | "step_grass" | "step_rock" | "step_water" | "step_wood" {
  const ground = world.heightAt(x, z);
  if (ground < WATER_LEVEL + 0.05) return "step_water";
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
  const timers = useRef({ step: 0, cricket: 1, bird: 2, crackle: 0, drip: 1, bubble: 0.5 });
  const seen = useRef({ log: -1, phase: "", bag: -1 });

  // Bật âm thanh ở lần bấm đầu tiên; dựng các vòng tiếng nền khi bộ máy sẵn sàng.
  useEffect(() => unlockAudioOnGesture(), []);
  useEffect(
    () =>
      audio.onStart(() => {
        loops.current = {
          ocean: makeLoop(true, "lowpass", 500),
          surf: makeLoop(false, "bandpass", 1100, 0.6),
          wind: makeLoop(false, "bandpass", 600, 0.9),
          rain: makeLoop(false, "highpass", 1100, 0.5),
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
    // Bấm nút trên giao diện: tiếng tách nhỏ.
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("button")) play("click", { bus: "ui" });
    };
    window.addEventListener("click", onClick);
    return () => {
      offEncounter();
      offReject();
      offStar();
      window.removeEventListener("click", onClick);
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
    setLevel(loops.current.ocean, (0.25 + 0.55 * nearSea) * outdoors * (localEnv.underwater ? 1.4 : 1));
    // Sóng vỗ bờ: to nhất khi đứng sát mép nước.
    const shore = Math.max(0, 1 - Math.abs(surface.inland) / 25);
    setLevel(loops.current.surf, 0.35 * shore * waves * outdoors * (1 + weatherFx.storm), 0.25);
    const height = Math.max(0, Math.min(1, p.y / 30));
    setLevel(loops.current.wind, (0.05 + 0.12 * height + 0.09 * (windStrength.value - 1)) * outdoors);
    loops.current.wind?.filter.frequency.setTargetAtTime(450 + 350 * Math.sin(t * 0.3) + 200 * weatherFx.storm, audio.ctx!.currentTime, 0.5);
    setLevel(loops.current.rain, 0.5 * weatherFx.rain * (0.4 + 0.6 * outdoors));
    const lavaDist = Math.hypot(p.x - LAVA.x, p.z - LAVA.z);
    setLevel(loops.current.lava, 0.7 * Math.pow(Math.max(0, 1 - lavaDist / 70), 2) * (0.6 + state.volcano / 200));
    const campDist = state.campPacked ? 99 : Math.hypot(p.x - state.campX, p.z - state.campZ);
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
    tm.step -= dt;
    if (tm.step <= 0 && localMotion.moving) {
      if (localMotion.climbing) {
        tm.step = 0.35;
        play("climb", { volume: 0.6 });
      } else if (localMotion.swimming) {
        tm.step = localMotion.running ? 0.55 : 0.8;
        play("swim", { volume: 0.7 });
      } else if (p.y - world.heightAt(p.x, p.z) < 0.3) {
        tm.step = localMotion.running ? 0.28 : 0.42;
        play(surfaceSound(world, p.x, p.z), { volume: localMotion.running ? 1 : 0.7 });
      }
    }

    // --- đổi pha, nhật ký (xúc xắc, ai gục, biến cố), nhặt đồ
    const s = seen.current;
    if (state.phase !== s.phase) {
      if (s.phase) {
        const stinger = { dawn: "dawn", dusk: "dusk", night: "night", ended: "ended" }[state.phase as string] as "dawn" | "dusk" | "night" | "ended" | undefined;
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
    music.current.step(mood);
  });

  return null;
}
