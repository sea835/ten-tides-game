// Bộ máy âm thanh: mọi tiếng động đều tổng hợp tại chỗ bằng Web Audio (tiếng ồn lọc, sóng sin, tam giác...),
// không cần tải file nào. Tiếng có vị trí thì nhỏ dần theo khoảng cách và lệch trái phải theo hướng camera.
// Trình duyệt chỉ cho phát tiếng sau lần bấm chuột hay phím đầu tiên, nên bộ máy tự bật khi đó.

export type Bus = "sfx" | "ambience" | "music" | "ui";

export interface Place {
  x: number;
  y: number;
  z: number;
}

const STORAGE_KEY = "tentides.sound";
/** Xa hơn chừng này mét thì không nghe thấy. */
const HEARING = 70;

/** Âm lượng từng nhóm (0–1), chỉnh trong bảng Cài đặt. */
export type VolumeKey = "master" | "sfx" | "ambience" | "music";
export interface SoundSettings {
  muted: boolean;
  music: boolean;
  volume: Record<VolumeKey, number>;
}
/** Mặc định nhỏ hơn trước (tổng 0.8 → 0.56, nền 0.4 → 0.28): người chơi báo quá ồn mà không chỉnh được. */
export const DEFAULT_VOLUME: Record<VolumeKey, number> = { master: 0.7, sfx: 0.85, ambience: 0.7, music: 0.6 };
/** Mức gốc của từng nhóm trước khi nhân âm lượng người chơi chọn. */
const BASE: Record<Bus | "master", number> = { master: 0.8, sfx: 1, ambience: 0.4, music: 0.32, ui: 0.5 };

function readSetting(): SoundSettings {
  const def: SoundSettings = { muted: false, music: true, volume: { ...DEFAULT_VOLUME } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SoundSettings>;
      return { ...def, ...saved, volume: { ...DEFAULT_VOLUME, ...saved.volume } };
    }
  } catch {
    // Không đọc được thì dùng mặc định.
  }
  return def;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  /** Bộ lọc trên toàn bộ âm thanh: dưới nước thì mọi thứ nghe ù ù. */
  private muffle!: BiquadFilterNode;
  private buses = new Map<Bus, GainNode>();
  white!: AudioBuffer;
  brown!: AudioBuffer;
  /** Vị trí và hướng nhìn của người nghe (camera), Soundscape ghi mỗi khung hình. */
  readonly listener = { x: 0, y: 0, z: 0, yaw: 0 };
  settings = readSetting();
  private listeners = new Set<() => void>();

  /** Bật bộ máy (gọi sau một thao tác của người chơi). Gọi lại nhiều lần không sao. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterLevel();
    // Nén nhẹ để tiếng nổ, sấm không làm vỡ loa.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.knee.value = 12;
    // Nhả hơi chậm để một tràng súng liên thanh không làm nền "thở" giật cục.
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    // Chặn đỉnh (limiter) sau cùng: tiếng súng, tiếng nổ dồn dập to cỡ nào cũng không vượt 0 dBFS, không rè vỡ.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.09;
    this.muffle.connect(this.master).connect(comp).connect(limiter).connect(ctx.destination);
    for (const bus of ["sfx", "ambience", "music", "ui"] as Bus[]) {
      const g = ctx.createGain();
      g.gain.value = this.busLevel(bus);
      // Giao diện không bị nước làm ù.
      g.connect(bus === "ui" ? this.master : this.muffle);
      this.buses.set(bus, g);
    }
    this.white = this.makeNoise(ctx, false);
    this.brown = this.makeNoise(ctx, true);
    this.listeners.forEach((l) => l());
  }

  private makeNoise(ctx: AudioContext, brown: boolean): AudioBuffer {
    // Dài 5 giây: vòng lặp ngắn quá thì tai nhận ra mẫu lặp lại (tiếng "rè rè" đều đều).
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      } else data[i] = w;
    }
    return buffer;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  bus(name: Bus): GainNode {
    return this.buses.get(name)!;
  }

  /** Mỗi khi bộ máy vừa bật (để các vòng lặp nền tự dựng). */
  onStart(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.ctx) listener();
    return () => this.listeners.delete(listener);
  }

  /** Theo dõi cài đặt (tắt tiếng, tắt nhạc) cho giao diện. */
  subscribe = (listener: () => void): (() => void) => {
    this.changes.add(listener);
    return () => this.changes.delete(listener);
  };
  private changes = new Set<() => void>();

  setMuted(muted: boolean) {
    this.settings = { ...this.settings, muted };
    this.save();
    // Bấm nút bật tiếng cũng là một thao tác: bật luôn bộ máy nếu chưa.
    if (!muted) this.start();
    if (this.ctx) this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean) {
    this.settings = { ...this.settings, music: on };
    this.save();
    if (this.ctx) this.bus("music").gain.setTargetAtTime(this.busLevel("music"), this.ctx.currentTime, 0.3);
  }

  /** Chỉnh âm lượng một nhóm (0–1), áp ngay và nhớ lại cho lần sau. */
  setVolume(key: VolumeKey, value: number) {
    this.settings = { ...this.settings, volume: { ...this.settings.volume, [key]: Math.max(0, Math.min(1, value)) } };
    this.save();
    if (!this.ctx) return;
    if (key === "master") this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.05);
    else this.bus(key).gain.setTargetAtTime(this.busLevel(key), this.ctx.currentTime, 0.05);
  }

  private masterLevel(): number {
    return this.settings.muted ? 0 : BASE.master * this.settings.volume.master;
  }

  private busLevel(bus: Bus): number {
    if (bus === "music" && !this.settings.music) return 0;
    return BASE[bus] * (bus === "ui" ? 1 : this.settings.volume[bus]);
  }

  private save() {
    this.changes.forEach((l) => l());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Không lưu được thì lần sau về mặc định.
    }
  }

  /** Dưới nước (0–1): mọi tiếng ù đi. */
  setUnderwater(amount: number) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(20000 - amount * 19400, this.ctx.currentTime, 0.08);
  }

  /**
   * Đầu ra cho một tiếng động: có vị trí thì nhỏ dần theo khoảng cách và lệch trái phải; quá xa thì trả về null
   * (khỏi tổng hợp tiếng không ai nghe). `volume` là độ to gốc.
   */
  output(bus: Bus, volume: number, at?: Place, hearing = HEARING): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || this.settings.muted) return null;
    let gain = volume;
    let pan = 0;
    if (at) {
      const dx = at.x - this.listener.x;
      const dz = at.z - this.listener.z;
      const d = Math.hypot(dx, dz, (at.y - this.listener.y) * 0.5);
      if (d > hearing) return null;
      gain *= Math.pow(1 - d / hearing, 1.7);
      // Trục phải của camera: (cos yaw, −sin yaw).
      if (d > 0.5) pan = Math.max(-0.85, Math.min(0.85, ((dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw)) / d) * 0.85));
    }
    if (gain < 0.005) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.bus(bus));
    // Tự dọn nút sau vài giây (mọi tiếng động đều ngắn hơn thế).
    setTimeout(() => {
      g.disconnect();
      p.disconnect();
    }, 8000);
    return g;
  }
}

export const audio = new AudioEngine();

/** Bật âm thanh ở lần bấm chuột, phím hay chạm đầu tiên. */
export function unlockAudioOnGesture(): () => void {
  const unlock = () => audio.start();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

// ---------------------------------------------------------------------------- khối dựng tiếng

/** Đường bao âm lượng: lên nhanh rồi tắt dần (hàm mũ). */
export function envelope(param: AudioParam, t: number, attack: number, peak: number, decay: number) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Một đoạn tiếng ồn (trắng hoặc nâu) qua bộ lọc, có đường bao; trả về nút lọc để chỉnh thêm. */
export function noiseBurst(
  out: AudioNode,
  t: number,
  opts: { brown?: boolean; type?: BiquadFilterType; freq: number; freqEnd?: number; q?: number; attack?: number; peak?: number; decay: number; rate?: number },
): BiquadFilterNode {
  const ctx = audio.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = opts.brown ? audio.brown : audio.white;
  src.loop = true;
  src.playbackRate.value = opts.rate ?? 1;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.attack ?? 0.005) + opts.decay);
  filter.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  envelope(g.gain, t, opts.attack ?? 0.005, opts.peak ?? 1, opts.decay);
  src.connect(filter).connect(g).connect(out);
  const dur = (opts.attack ?? 0.005) + opts.decay + 0.05;
  src.start(t, Math.random() * 4);
  src.stop(t + dur);
  return filter;
}

/** Một nốt dao động (sin, tam giác, răng cưa, vuông), có thể trượt cao độ. */
export function tone(
  out: AudioNode,
  t: number,
  opts: { type?: OscillatorType; freq: number; freqEnd?: number; attack?: number; peak?: number; decay: number; detune?: number },
): OscillatorNode {
  const ctx = audio.ctx!;
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.attack ?? 0.005) + opts.decay);
  if (opts.detune) osc.detune.value = opts.detune;
  const g = ctx.createGain();
  envelope(g.gain, t, opts.attack ?? 0.005, opts.peak ?? 1, opts.decay);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + (opts.attack ?? 0.005) + opts.decay + 0.05);
  return osc;
}
