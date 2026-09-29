import { WEAPON, type WeaponClass } from "@tentides/content";
import { audio, noiseBurst, tone, type Bus, type Place } from "./engine.ts";

// Âm thanh đấu súng (chế độ Battleground): tiếng nổ từng loại súng, thay đạn, lựu đạn, trúng đích, bước chân...
// Tất cả tổng hợp tại chỗ như sfx.ts. Tiếng nổ súng và lựu đạn được dựng sẵn thành buffer (tính từng mẫu, xem
// renderDry/renderTail): sóng N siêu thanh và tiếng tách dải rộng bị bão hòa cho cú "đanh", khối hơi đầu nòng và thân
// trầm trượt cao độ cho cú "đấm", tiếng bark cộng hưởng riêng từng loại súng, rồi đuôi vang ngoài trời (tiếng dội rời
// từ vách, đồi và lớp trầm lăn dài như sấm với súng lớn), cộng hồi âm chung dội từ địa hình đảo.
// Súng nghe được xa hơn nhiều so với 70 m của bộ máy: tiếng xa thì nhỏ, đục (lọc thấp theo khoảng cách), đến trễ
// theo vận tốc âm thanh và vang nhiều hơn. Có giới hạn số tiếng cùng lúc để bắn liên thanh không đẻ nút vô hạn.

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Vận tốc âm thanh (m/s) và độ trễ tối đa (không để tiếng đến quá muộn so với hình). */
const SPEED_OF_SOUND = 343;
const MAX_DELAY = 1.1;

/** Chạy an toàn: âm thanh không bao giờ được làm hỏng trò chơi. */
function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch {
      // Lỗi âm thanh thì im lặng bỏ qua.
    }
  };
}

const noop = () => {};

function live(): AudioContext | null {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== "running" || audio.settings.muted) return null;
  return ctx;
}

// ---------------------------------------------------------------------------- hồi âm chung

/**
 * Một bộ hồi âm dùng chung (ConvolverNode, chi phí cố định dù bắn bao nhiêu phát): đáp ứng xung tự dựng gồm vài
 * tiếng dội rời (vách đá, đồi) rồi đuôi tiếng ồn tắt dần, hai kênh khác nhau cho độ rộng stereo.
 */
let shared: { ctx: AudioContext; send: GainNode } | null = null;

function reverbSend(ctx: AudioContext): GainNode {
  if (shared && shared.ctx === ctx) return shared.send;
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 2.2);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const s = i / rate;
      // Đuôi khuếch tán: tiếng ồn làm tối dần (lọc một cực) theo thời gian, tắt theo hàm mũ.
      const k = 0.35 + 0.6 * Math.exp(-s / 0.4);
      lp += k * ((Math.random() * 2 - 1) - lp);
      data[i] = s < 0.018 ? 0 : lp * 0.55 * Math.exp(-s / 0.55);
    }
    // Tiếng dội rời: mỗi kênh lệch nhau một chút như vách ở hai bên.
    const slaps = ch === 0 ? [0.083, 0.171, 0.29, 0.47, 0.72] : [0.097, 0.188, 0.33, 0.52, 0.8];
    slaps.forEach((at, n) => {
      const start = Math.floor(at * rate);
      const width = Math.floor(rate * (0.006 + n * 0.006));
      const amp = 0.55 * Math.pow(0.62, n);
      for (let i = 0; i < width && start + i < len; i++) {
        data[start + i] = (data[start + i] ?? 0) + (Math.random() * 2 - 1) * amp * (1 - i / width);
      }
    });
  }
  const send = ctx.createGain();
  // Bỏ bớt trầm trước khi vang cho khỏi đục, và bớt chói.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 180;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5000;
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const ret = ctx.createGain();
  ret.gain.value = 0.55;
  send.connect(hp).connect(lp).connect(conv).connect(ret).connect(audio.bus("sfx"));
  shared = { ctx, send };
  return send;
}

// ---------------------------------------------------------------------------- vị trí, khoảng cách

interface Spatial {
  d: number;
  gain: number;
  pan: number;
  /** Tần số cắt của bộ lọc thấp (xa thì đục). */
  cutoff: number;
  /** Trễ do âm thanh bay (giây). */
  delay: number;
}

/**
 * Tính độ to, lệch trái phải, độ đục và độ trễ của một tiếng ở `at`. Quá `range` mét thì null.
 * Độ to giảm chậm (tiếng súng vang xa) rồi mờ hẳn ở mép tầm nghe.
 */
function spatial(at: Place, range: number, ref = 20): Spatial | null {
  const L = audio.listener;
  const dx = at.x - L.x;
  const dz = at.z - L.z;
  const d = Math.hypot(dx, dz, (at.y - L.y) * 0.7);
  if (!(d < range)) return null;
  const gain = Math.pow(1 + d / ref, -0.85) * (1 - Math.pow(d / range, 3));
  let pan = 0;
  let cutoff = clamp(17000 * Math.exp(-d / 90), 380, 17000);
  if (d > 0.5) {
    // Trục phải của camera: (cos yaw, −sin yaw); trục trước: (−sin yaw, −cos yaw).
    const right = (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d;
    const front = (-dx * Math.sin(L.yaw) - dz * Math.cos(L.yaw)) / d;
    pan = clamp(right * 0.85, -0.85, 0.85);
    // Tiếng sau lưng hơi đục hơn (đầu che bớt tần số cao): giúp phân biệt trước sau.
    if (front < 0) cutoff *= 1 + front * 0.35;
  }
  return { d, gain, pan, cutoff, delay: Math.min(MAX_DELAY, d / SPEED_OF_SOUND) };
}

// ---------------------------------------------------------------------------- tiếng (voice) và giới hạn

type Pool = "gun" | "fx" | "local" | "ui";
/** Số tiếng tối đa cùng lúc mỗi nhóm; vượt thì cướp tiếng nhỏ nhất / sắp hết nhất. */
const POOL_CAP: Record<Pool, number> = { gun: 24, fx: 20, local: 14, ui: 8 };
const pools: Record<Pool, Voice[]> = { gun: [], fx: [], local: [], ui: [] };

/**
 * Một tiếng: nút vào (độ to) → [lọc thấp theo khoảng cách] → lệch trái phải → bus, cộng một nhánh gửi sang hồi âm.
 * Các lớp tiếng nối vào `input` (giữa) hoặc `side` (lệch một bên, cho độ rộng tiếng súng của chính mình).
 * Tự tháo nút khi hết tiếng.
 */
class Voice {
  readonly ctx: AudioContext;
  readonly input: GainNode;
  side: AudioNode;
  readonly t0: number;
  end: number;
  private nodes: AudioNode[] = [];
  /** Các nút độ to cần hạ về 0 khi tiếng bị cướp (nút vào và các nhánh riêng như đuôi vang). */
  private gates: GainNode[] = [];
  /** Các nguồn buffer đang phát: bị cướp thì dừng hẳn để khỏi tốn CPU. */
  private sources: AudioBufferSourceNode[] = [];
  private readonly out: AudioNode;
  private timer: ReturnType<typeof setTimeout> | null = null;
  dead = false;

  constructor(
    ctx: AudioContext,
    readonly pool: Pool,
    readonly level: number,
    opts: { bus: Bus; sp?: Spatial | null; reverb?: number; wide?: number; delay?: number; gain?: number },
  ) {
    this.ctx = ctx;
    const sp = opts.sp;
    this.t0 = ctx.currentTime + 0.005 + (opts.delay ?? sp?.delay ?? 0);
    this.end = this.t0;
    const input = ctx.createGain();
    input.gain.value = opts.gain ?? level;
    this.input = input;
    this.gates.push(input);
    let head: AudioNode = input;
    this.nodes.push(input);
    if (sp && sp.cutoff < 16000) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = sp.cutoff;
      lp.Q.value = 0.5;
      head = head.connect(lp);
      this.nodes.push(lp);
    }
    const out = audio.bus(opts.bus);
    this.out = out;
    if (sp && Math.abs(sp.pan) > 0.02) {
      const p = ctx.createStereoPanner();
      p.pan.value = sp.pan;
      head = head.connect(p);
      this.nodes.push(p);
    }
    head.connect(out);
    if (opts.reverb) {
      const send = ctx.createGain();
      send.gain.value = opts.reverb;
      head.connect(send).connect(reverbSend(ctx));
      this.nodes.push(send);
    }
    this.side = input;
    if (opts.wide) {
      // Nhánh lệch một bên ngẫu nhiên: tiếng súng của mình nghe rộng hơn, không dẹt ở giữa.
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = (Math.random() < 0.5 ? -1 : 1) * opts.wide;
      g.connect(p).connect(input);
      this.nodes.push(g, p);
      this.side = g;
    }
  }

  /** Thêm một đoạn tiếng ồn lọc, bắt đầu sau `dt` giây. */
  noise(dt: number, opts: Parameters<typeof noiseBurst>[2], out: AudioNode = this.input) {
    const t = this.t0 + dt;
    noiseBurst(out, t, opts);
    this.end = Math.max(this.end, t + (opts.attack ?? 0.005) + opts.decay + 0.05);
  }

  /** Thêm một nốt dao động. */
  osc(dt: number, opts: Parameters<typeof tone>[2], out: AudioNode = this.input): OscillatorNode {
    const t = this.t0 + dt;
    const o = tone(out, t, opts);
    this.end = Math.max(this.end, t + (opts.attack ?? 0.005) + opts.decay + 0.05);
    return o;
  }

  /** Phát một buffer dựng sẵn (tiếng nổ súng, đuôi vang) sau `dt` giây, tốc độ `rate`, độ to `level`. */
  buffer(dt: number, buf: AudioBuffer, rate: number, level: number, out: AudioNode = this.input) {
    const t = this.t0 + dt;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(out);
    src.start(t);
    this.nodes.push(g);
    this.sources.push(src);
    this.end = Math.max(this.end, t + buf.duration / rate);
  }

  /**
   * Nhánh riêng đi thẳng ra bus, không qua bộ lọc khoảng cách của phần thẳng: dùng cho đuôi vang (tiếng dội từ
   * địa hình đến từ nhiều phía nên lọc nhẹ hơn, lệch trái phải ít hơn).
   */
  branch(cutoff: number, pan: number): GainNode {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.nodes.push(g);
    this.gates.push(g);
    let head: AudioNode = g;
    if (cutoff < 16000) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = cutoff;
      lp.Q.value = 0.4;
      head = head.connect(lp);
      this.nodes.push(lp);
    }
    if (Math.abs(pan) > 0.02) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      head = head.connect(p);
      this.nodes.push(p);
    }
    head.connect(this.out);
    return g;
  }

  /** Xong phần dựng: hẹn giờ tháo nút. */
  done(): this {
    const ms = (this.end - this.ctx.currentTime + 0.25) * 1000;
    this.timer = setTimeout(() => this.release(), Math.max(50, ms));
    return this;
  }

  /** Độ "đáng giữ": to và còn dài thì giữ, nhỏ và sắp tắt thì cướp trước. */
  score(now: number): number {
    const span = Math.max(0.01, this.end - this.t0);
    return this.level * clamp((this.end - now) / span, 0, 1);
  }

  /** Tắt nhanh (bị cướp hay bị hủy) rồi tháo. */
  kill() {
    if (this.dead) return;
    const now = this.ctx.currentTime;
    for (const gate of this.gates) {
      const g = gate.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.03);
    }
    for (const src of this.sources) {
      try {
        src.stop(now + 0.04);
      } catch {
        // Chưa bắt đầu hay đã dừng.
      }
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), 80);
    this.remove();
  }

  private remove() {
    this.dead = true;
    const list = pools[this.pool];
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }

  private release() {
    this.remove();
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // Đã tháo rồi.
      }
    }
    this.nodes = [];
    this.sources = [];
    this.gates = [];
  }
}

/** Mở một tiếng mới trong nhóm; đầy thì cướp tiếng ít quan trọng nhất (nếu tiếng mới quan trọng hơn). */
function voice(pool: Pool, level: number, opts: { bus?: Bus; sp?: Spatial | null; reverb?: number; wide?: number; delay?: number; gain?: number } = {}): Voice | null {
  const ctx = live();
  if (!ctx || level < 0.004) return null;
  const list = pools[pool];
  const now = ctx.currentTime;
  // Dọn các tiếng đã hết mà hẹn giờ chưa kịp chạy.
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.end + 0.1 < now) list[i]!.kill();
  if (list.length >= POOL_CAP[pool]) {
    let worst: Voice | null = null;
    let worstScore = Infinity;
    for (const v of list) {
      const s = v.score(now);
      if (s < worstScore) {
        worst = v;
        worstScore = s;
      }
    }
    // Tiếng mới còn nhỏ hơn mọi tiếng đang phát thì bỏ luôn tiếng mới.
    if (!worst || worstScore > level * 1.5) return null;
    worst.kill();
  }
  const v = new Voice(ctx, pool, level, { ...opts, bus: opts.bus ?? "sfx" });
  list.push(v);
  return v;
}

// ---------------------------------------------------------------------------- dựng sẵn tiếng nổ (buffer)

/**
 * Công thức một tiếng nổ (súng hay lựu đạn). Dựng một lần thành buffer (vài biến thể) bằng cách tính từng mẫu
 * trong JS, rồi mỗi phát chỉ cần một hai nguồn buffer: rẻ hơn nhiều so với chục nút tiếng ồn/dao động mỗi phát,
 * nên bắn liên thanh từ nhiều người vẫn nhẹ, và cho phép làm những thứ nút Web Audio khó làm (sóng N siêu thanh,
 * bão hòa tanh, tiếng dội rời có chủ đích).
 */
interface Blast {
  /** Sóng N siêu thanh (đạn bay nhanh hơn âm thanh): độ to, độ dài (ms). */
  crack: number;
  nwave: number;
  /** Tiếng "tách" dải rộng vài ms ở đầu (khí thuốc súng phụt ra). */
  click: number;
  /** Độ bão hòa (tanh) cho cú đấm: càng lớn càng dày, càng "đanh". */
  drive: number;
  /** Thân trầm: sin trượt từ → đến (Hz), thời gian tắt (s), độ to. */
  body: [number, number, number, number];
  /** Khối hơi đầu nòng: tiếng ồn lọc thấp (Hz), thời gian tắt (s), độ to. */
  blast: [number, number, number];
  /** Tiếng "bark" giữa đặc trưng từng loại súng: hai cộng hưởng dải (Hz, Q, thời gian tắt, độ to). */
  bark: [number, number, number, number];
  bark2: [number, number, number, number];
  /** Độ dài phần khô (s). */
  dry: number;
  /** Đuôi vang ngoài trời: độ dài (s), lọc thấp (Hz), độ "lăn" như sấm 0–1, số tiếng dội rời. */
  tail: [number, number, number, number];
}

/** Hệ số bộ lọc một cực cho tần số cắt `f`. */
const pole = (f: number, sr: number) => 1 - Math.exp((-2 * Math.PI * f) / sr);

/** Bộ lọc dải (biquad RBJ, đỉnh 0 dB) chạy từng mẫu. */
function bandpass(f: number, q: number, sr: number): (x: number) => number {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

const white = () => Math.random() * 2 - 1;

/** Chuẩn hóa đỉnh các kênh về `peak` và làm mờ vài ms cuối cho khỏi tiếng tách khi hết buffer. */
function finish(chans: Float32Array[], peak: number, sr: number, fadeFrac = 0.1) {
  let max = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) max = Math.max(max, Math.abs(c[i]!));
  const k = max > 0 ? peak / max : 0;
  for (const c of chans) {
    const n = c.length;
    const fade = Math.max(Math.floor(sr * 0.01), Math.floor(n * fadeFrac));
    for (let i = 0; i < n; i++) {
      const f = i > n - fade ? (n - i) / fade : 1;
      c[i] = c[i]! * k * f * f;
    }
  }
}

/**
 * Phần khô của một phát: sóng N + tiếng tách dải rộng (bão hòa mạnh), khối hơi đầu nòng, thân trầm trượt cao độ,
 * tiếng bark cộng hưởng; rồi cả khối qua tanh cho cú đấm đặc, chặn DC, thêm vài tiếng dội sớm (mặt đất, vật gần)
 * lệch nhau giữa hai kênh cho độ rộng stereo.
 */
function renderDry(ctx: BaseAudioContext, B: Blast): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(64, Math.floor(B.dry * sr));
  const x = new Float32Array(n);
  const j = () => rand(0.9, 1.1);
  // 1. Sóng N siêu thanh: nhảy lên, dốc thẳng xuống âm, rồi về 0 — cái "crack" sắc nhất.
  if (B.crack > 0) {
    const nw = Math.max(3, Math.floor(((B.nwave * j()) / 1000) * sr));
    for (let i = 0; i < nw && i < n; i++) x[i] = x[i]! + B.crack * 2.4 * (1 - (2 * i) / nw);
  }
  // 2. Tiếng tách dải rộng: tiếng ồn trắng (nhấn cao tần) tắt trong vài ms.
  const clickTau = 0.0007 * j();
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t > clickTau * 9) break;
    const w = white();
    x[i] = x[i]! + B.click * 1.9 * (w - prev * 0.85) * Math.exp(-t / clickTau);
    prev = w;
  }
  // Đường bao tính dồn (nhân dần) thay vì gọi Math.exp mỗi mẫu cho nhanh.
  const fall = (tau: number) => Math.exp(-1 / (tau * sr));
  // 3. Khối hơi đầu nòng: tiếng ồn qua lọc thấp hai cực, mở sáng ở đầu rồi đóng dần.
  {
    const [bf, btau, bamp] = B.blast;
    const tau = btau * j();
    const m = Math.min(n, Math.floor(tau * 9 * sr));
    const g = bamp * 3.2 * Math.min(8, Math.sqrt(sr / (4 * bf)));
    const kd = fall(tau);
    const ka = fall(0.0004);
    const ko = fall(0.012);
    let env = 1;
    let att = 1;
    let open = 1;
    let lp1 = 0;
    let lp2 = 0;
    let k = pole(bf, sr);
    for (let i = 0; i < m; i++) {
      if ((i & 15) === 0) k = pole(bf * (0.55 + 2.2 * open), sr);
      lp1 += k * (white() - lp1);
      lp2 += k * (lp1 - lp2);
      x[i] = x[i]! + g * lp2 * (1 - att) * env;
      env *= kd;
      att *= ka;
      open *= ko;
    }
  }
  // 4. Thân trầm: sin trượt cao độ xuống nhanh (cái "thump" 60–250 Hz), thêm họa âm bậc hai cho ấm.
  {
    const [f0, f1, btau, bamp] = B.body;
    const tau = btau * j();
    const m = Math.min(n, Math.floor(tau * 9 * sr));
    const kd = fall(tau);
    const ka = fall(0.0007);
    const ks = fall(0.018);
    const df = f0 * j() - f1;
    let env = 1;
    let att = 1;
    let slide = 1;
    let ph = 0;
    for (let i = 0; i < m; i++) {
      ph += (2 * Math.PI * (f1 + df * slide)) / sr;
      x[i] = x[i]! + bamp * 1.4 * (Math.sin(ph) + 0.22 * Math.sin(2 * ph)) * (1 - att) * env;
      env *= kd;
      att *= ka;
      slide *= ks;
    }
  }
  // 5. Tiếng bark: tiếng ồn qua hai bộ cộng hưởng dải — chỗ phân biệt khẩu này với khẩu kia.
  for (const [bf, q, btau, bamp] of [B.bark, B.bark2]) {
    const f = bf * j();
    const bp = bandpass(f, q, sr);
    const tau = btau * j();
    const m = Math.min(n, Math.floor(tau * 10 * sr));
    const g = bamp * 1.5 * Math.min(10, Math.sqrt(sr / 2 / (f / q)));
    const kd = fall(tau);
    const ka = fall(0.0003);
    let env = 1;
    let att = 1;
    for (let i = 0; i < m; i++) {
      x[i] = x[i]! + g * bp(white()) * (1 - att) * env;
      env *= kd;
      att *= ka;
    }
  }
  // 6. Bão hòa: đỉnh bị ép phẳng (cú đấm đặc, "đanh"), phần sau gần như tuyến tính.
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(x[i]!));
  const drive = B.drive / Math.max(1e-6, max);
  // Chặn DC (sóng N và bão hòa lệch dấu tạo DC): lọc cao một cực ~25 Hz.
  const hp = 1 - pole(25, sr);
  let hx = 0;
  let hy = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.tanh(x[i]! * drive);
    hy = hp * (hy + s - hx);
    hx = s;
    x[i] = hy;
  }
  // 7. Tiếng dội sớm (mặt đất, tường, xe gần): bản sao đục hơn, trễ vài ms, khác nhau giữa hai kênh.
  const refl = new Float32Array(n);
  {
    const k = pole(2600, sr);
    let l = 0;
    for (let i = 0; i < n; i++) {
      l += k * (x[i]! - l);
      refl[i] = l;
    }
  }
  const buf = ctx.createBuffer(2, n, sr);
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const out = new Float32Array(n);
    const d1 = Math.floor(rand(0.003, 0.0065) * sr);
    const d2 = Math.floor(rand(0.009, 0.019) * sr);
    const d3 = Math.floor(rand(0.022, 0.038) * sr);
    const a1 = rand(0.25, 0.4);
    const a2 = rand(0.12, 0.22);
    const a3 = rand(0.06, 0.12);
    for (let i = 0; i < n; i++) {
      out[i] = x[i]! + (i >= d1 ? a1 * refl[i - d1]! : 0) + (i >= d2 ? a2 * refl[i - d2]! : 0) + (i >= d3 ? a3 * refl[i - d3]! : 0);
    }
    chans.push(out);
  }
  finish(chans, 0.97, sr, 0.12);
  chans.forEach((c, ch) => buf.getChannelData(ch).set(c));
  return buf;
}

/** Đuôi vang dựng ở tần số mẫu thấp (tiếng dội vốn đục), đỡ tốn bộ nhớ. */
const TAIL_RATE = 24000;

/**
 * Đuôi vang ngoài trời (stereo): vài tiếng dội rời (vách đá, đồi, nhà) mỗi lần đục và nhỏ hơn, cộng một lớp tiếng
 * ồn trầm lăn dài; độ "lăn" cao thì có các cục sóng to nhỏ nối nhau như sấm (súng bắn tỉa, lựu đạn).
 */
function renderTail(ctx: BaseAudioContext, B: Blast): AudioBuffer {
  const sr = TAIL_RATE;
  const [len0, lpF, roll, slaps] = B.tail;
  const len = len0 * rand(0.92, 1.08);
  const n = Math.floor(len * sr);
  const buf = ctx.createBuffer(2, n, sr);
  // Các cục sóng "lăn": chung cho hai kênh (nghe như cả vùng trời rền), lệch nhau một chút.
  const lumps: { at: number; w: number; h: number }[] = [];
  const count = Math.round(1 + roll * 6);
  for (let i = 0; i < count; i++) lumps.push({ at: rand(0.18, 0.75) * len, w: rand(0.06, 0.28) * (0.5 + roll), h: rand(0.3, 1) * (0.3 + roll) });
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n);
    // Lớp lăn dài: tiếng ồn lọc thấp hai cực, lọc đóng dần theo thời gian.
    const tau = len * (0.15 + 0.1 * roll);
    const decay = Math.exp(-1 / (tau * sr));
    const lumpDecay = Math.exp(-1 / (len * 0.35 * sr));
    const shift = ch * rand(0.01, 0.035);
    let env = 0.5;
    let lenv = 1;
    let lp1 = 0;
    let lp2 = 0;
    let k = pole(lpF, sr);
    let norm = 1;
    let lump = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) {
        const fc = 110 + lpF * Math.exp(-t / (len * 0.3));
        k = pole(fc, sr);
        norm = Math.min(6, Math.sqrt(sr / (4 * fc)));
      }
      if ((i & 31) === 0) {
        lump = 0;
        for (const L of lumps) {
          const z = (t - L.at - shift) / L.w;
          if (z > -3 && z < 3) lump += L.h * Math.exp(-z * z);
        }
      }
      lp1 += k * (white() - lp1);
      lp2 += k * (lp1 - lp2);
      d[i] = lp2 * norm * ((1 - Math.exp(-t / 0.035)) * env + lump * lenv);
      env *= decay;
      lenv *= lumpDecay;
    }
    // Tiếng dội rời: mỗi tiếng là một "phát súng nhỏ" đục dần, cách nhau thưa dần.
    let at = rand(0.05, 0.1) + ch * rand(0.006, 0.025);
    for (let s = 0; s < slaps && at < len * 0.8; s++) {
      const amp = 0.95 * Math.pow(0.7, s) * rand(0.65, 1.1);
      const tauE = 0.007 + s * 0.007;
      const fcE = Math.max(260, lpF * 2.4 * Math.pow(0.78, s));
      const kk = pole(fcE, sr);
      const g = Math.min(6, Math.sqrt(sr / (4 * fcE)));
      const start = Math.floor(at * sr);
      const m = Math.floor((tauE * 8 + 0.02) * sr);
      const kE = Math.exp(-1 / (tauE * sr));
      const kT = Math.exp(-1 / (0.03 * sr));
      const w85 = (2 * Math.PI * 85) / sr;
      let eE = amp * g;
      let eT = amp * 0.35;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i < m && start + i < n; i++) {
        e1 += kk * (white() - e1);
        e2 += kk * (e1 - e2);
        d[start + i] = d[start + i]! + e2 * eE + Math.sin(w85 * i) * eT;
        eE *= kE;
        eT *= kT;
      }
      at += rand(0.06, 0.15) * (1 + s * 0.4);
    }
    chans.push(d);
  }
  finish(chans, 1, sr, 0.15);
  chans.forEach((c, ch) => buf.getChannelData(ch).set(c));
  return buf;
}

/** Kho buffer đã dựng, theo từng khẩu (hay loại nổ): vài biến thể phần khô và đuôi để các phát không giống hệt nhau. */
interface Bank {
  dry: AudioBuffer[];
  tail: AudioBuffer[];
}
let banks: { ctx: AudioContext; map: Map<string, Bank> } | null = null;

/** Lấy (dựng nếu chưa có) kho buffer cho `key`. Lần đầu dựng một biến thể ngay, các biến thể còn lại dựng sau. */
function bankFor(ctx: AudioContext, key: string, B: Blast): Bank {
  if (!banks || banks.ctx !== ctx) banks = { ctx, map: new Map() };
  const map = banks.map;
  let bank = map.get(key);
  if (!bank) {
    const b: Bank = { dry: [renderDry(ctx, B)], tail: [renderTail(ctx, B)] };
    map.set(key, b);
    // Dựng thêm biến thể rải rác cho khỏi giật khung hình.
    // Ba biến thể phần khô, một đuôi (đuôi dài, tốn bộ nhớ nhất; các phát khác nhau đã nhờ phần khô và tốc độ phát).
    const more = [() => b.dry.push(renderDry(ctx, B)), () => b.dry.push(renderDry(ctx, B))];
    more.forEach((f, i) => setTimeout(safe(f), 40 + i * 70));
    bank = b;
  }
  return bank;
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

// ---------------------------------------------------------------------------- tiếng súng

interface GunProfile {
  /** Độ to phần khô. */
  vol: number;
  /** Tầm nghe (m). */
  range: number;
  /** Lượng gửi sang hồi âm chung. */
  rev: number;
  /** Độ to đuôi vang so với phần khô. */
  tailVol: number;
  blast: Blast;
}

const PROFILES: Record<WeaponClass, GunProfile> = {
  // Súng lục: gọn, giòn, "bốp" nhanh, đuôi ngắn.
  pistol: {
    vol: 0.9, range: 300, rev: 0.3, tailVol: 0.32,
    blast: { crack: 0.35, nwave: 0.25, click: 1.1, drive: 3.2, body: [190, 85, 0.022, 0.8], blast: [1100, 0.022, 0.9], bark: [2300, 1.3, 0.012, 1], bark2: [1150, 1.1, 0.02, 0.55], dry: 0.4, tail: [1.5, 1800, 0.15, 5] },
  },
  // Tiểu liên: nhẹ, nhanh, nhiều cao tần hơn, thân mỏng.
  smg: {
    vol: 0.82, range: 300, rev: 0.26, tailVol: 0.28,
    blast: { crack: 0.4, nwave: 0.25, click: 1, drive: 3, body: [210, 105, 0.016, 0.6], blast: [1300, 0.017, 0.8], bark: [2700, 1.1, 0.01, 0.9], bark2: [1400, 1, 0.016, 0.45], dry: 0.32, tail: [1.3, 2000, 0.1, 4] },
  },
  // Súng trường (5,56): sắc, đấm chắc, có tiếng nứt siêu thanh rõ.
  ar: {
    vol: 1, range: 350, rev: 0.4, tailVol: 0.42,
    blast: { crack: 1, nwave: 0.35, click: 1, drive: 4.2, body: [160, 68, 0.032, 0.95], blast: [750, 0.032, 1.05], bark: [1850, 1.5, 0.02, 1], bark2: [950, 1.2, 0.03, 0.6], dry: 0.5, tail: [2.1, 1500, 0.35, 6] },
  },
  // Trung liên: nặng, trầm, đuôi dày.
  lmg: {
    vol: 1.05, range: 380, rev: 0.45, tailVol: 0.46,
    blast: { crack: 1.05, nwave: 0.38, click: 0.9, drive: 4.6, body: [118, 50, 0.048, 1.05], blast: [580, 0.045, 1.1], bark: [1450, 1.1, 0.028, 0.95], bark2: [680, 1, 0.042, 0.75], dry: 0.6, tail: [2.5, 1200, 0.45, 6] },
  },
  // Súng bắn tỉa bán tự động: nổ to, đuôi dài.
  dmr: {
    vol: 1.15, range: 450, rev: 0.55, tailVol: 0.55,
    blast: { crack: 1.3, nwave: 0.45, click: 1, drive: 5, body: [104, 44, 0.065, 1.15], blast: [520, 0.06, 1.2], bark: [1500, 1, 0.032, 0.9], bark2: [700, 0.9, 0.05, 0.75], dry: 0.85, tail: [3.2, 1100, 0.75, 7] },
  },
  // Súng bắn tỉa: cú "ĐOÀNG" khổng lồ, đuôi vang lăn như sấm.
  sniper: {
    vol: 1.25, range: 500, rev: 0.65, tailVol: 0.62,
    blast: { crack: 1.5, nwave: 0.55, click: 1, drive: 5.5, body: [88, 36, 0.085, 1.25], blast: [450, 0.075, 1.3], bark: [1250, 0.9, 0.038, 0.85], bark2: [580, 0.8, 0.06, 0.85], dry: 1.05, tail: [4.4, 950, 1, 8] },
  },
  // RPG: tiếng phụt đẩy trầm và khối khí phụt sau (không có sóng nứt siêu thanh), đuôi vang dài.
  launcher: {
    vol: 1.2, range: 420, rev: 0.55, tailVol: 0.5,
    blast: { crack: 0.1, nwave: 0.6, click: 0.7, drive: 4.4, body: [70, 30, 0.09, 1.35], blast: [380, 0.09, 1.5], bark: [700, 0.6, 0.05, 0.9], bark2: [320, 0.6, 0.08, 0.9], dry: 0.9, tail: [3, 900, 0.6, 6] },
  },
  // Shotgun: bùm rộng, dày, trầm, ít tiếng nứt.
  shotgun: {
    vol: 1.2, range: 320, rev: 0.5, tailVol: 0.5,
    blast: { crack: 0.25, nwave: 0.3, click: 0.9, drive: 4.2, body: [80, 34, 0.075, 1.35], blast: [430, 0.065, 1.35], bark: [950, 0.7, 0.04, 0.95], bark2: [480, 0.7, 0.06, 0.9], dry: 0.8, tail: [2.7, 1000, 0.5, 6] },
  },
};

/** Súng trường đạn 7,62 (AKM): trầm hơn, bark thấp hơn, đuôi dày hơn khẩu 5,56. */
const AR_762: Partial<Blast> = { drive: 4.6, body: [128, 56, 0.04, 1.05], blast: [620, 0.038, 1.1], bark: [1350, 1.25, 0.026, 0.95], bark2: [720, 1.1, 0.036, 0.7], dry: 0.55, tail: [2.3, 1300, 0.4, 6] };
/** Súng lục cỡ lớn (Deagle): thân dày, bark thấp, vang hơn. */
const PISTOL_BIG: Partial<Blast> = { crack: 0.6, drive: 3.8, body: [150, 66, 0.032, 1], blast: [850, 0.03, 1], bark: [1700, 1.2, 0.017, 1], dry: 0.5, tail: [1.9, 1500, 0.25, 5] };

/**
 * Làm tiếng nổ "đanh" hơn: sóng N siêu thanh và tiếng tách to hơn, ngắn hơn; bark lên cao, tắt nhanh; thân trầm và
 * khối hơi gọn lại cho khỏi ùng ục. Kết quả: cú "chát" khô, sắc ở đầu, vẫn còn lực nhờ bão hòa.
 */
function sharpen(B: Blast, cls: WeaponClass): Blast {
  const snap = cls === "shotgun" ? 0.6 : 1;
  return {
    ...B,
    crack: B.crack * (1 + 0.5 * snap),
    nwave: B.nwave * 0.8,
    click: B.click * (1 + 0.7 * snap),
    drive: B.drive * 1.18,
    body: [B.body[0], B.body[1], B.body[2] * 0.8, B.body[3] * 0.85],
    blast: [B.blast[0] * 1.15, B.blast[1] * 0.8, B.blast[2]],
    bark: [B.bark[0] * 1.15, B.bark[1] * 1.15, B.bark[2] * 0.8, B.bark[3] * 1.1],
    bark2: [B.bark2[0] * 1.1, B.bark2[1], B.bark2[2] * 0.85, B.bark2[3]],
  };
}

/** Công thức riêng của từng khẩu: theo nhóm, chỉnh thêm theo cỡ đạn, sát thương. */
function blastFor(cls: WeaponClass, ammo: string | undefined, damage: number): Blast {
  const base = PROFILES[cls].blast;
  if (cls === "ar" && ammo === "762") return sharpen({ ...base, ...AR_762 }, cls);
  if (cls === "pistol" && damage >= 50) return sharpen({ ...base, ...PISTOL_BIG }, cls);
  return sharpen(base, cls);
}

/** Băm tên súng ra số 0–1: mỗi khẩu có âm sắc hơi khác dù cùng nhóm. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Nhân độ to chung của tiếng súng. */
const GUN_LOUDNESS = 1.35;

/** Lúc phát súng gần nhất của chính mình: bắn liên thanh thì đuôi mỗi phát nhỏ lại (các đuôi chồng lên nhau). */
let lastLocalShot = 0;

/** Một phát súng. `local` là do chính mình bắn (to hơn, không lọc khoảng cách, rộng). `at` là đầu nòng. */
export const playGunshot = safe((weaponId: string, at: Place, local: boolean) => {
  const ctx = live();
  if (!ctx) return;
  const def = WEAPON.get(weaponId);
  const cls: WeaponClass = def?.class ?? "ar";
  const P = PROFILES[cls];
  const damage = def?.damage ?? 40;
  // Tầm "to rõ" 32 m (trước là 20 m): súng người khác ở vài chục mét vẫn nghe đanh, to.
  const sp = local ? null : spatial(at, P.range * 1.15, 32);
  if (!local && !sp) return;
  const d = sp?.d ?? 0;
  const bank = bankFor(ctx, weaponId, blastFor(cls, def?.ammo, damage));
  // Cao độ riêng từng khẩu (theo tên), khẩu sát thương cao hơi trầm hơn; mỗi phát lệch nhẹ để liên thanh không như máy lặp.
  const heavy = clamp((damage - 30) / 70, 0, 1);
  const rate = (0.95 + hash(weaponId) * 0.1) * (1 - heavy * 0.05) * rand(0.97, 1.03);
  // To hơn trước khoảng 35% (bộ nén và chặn đỉnh ở engine giữ cho không vỡ tiếng).
  const loud = P.vol * GUN_LOUDNESS * rand(0.92, 1.04);
  const now = ctx.currentTime;
  const burst = local && now - lastLocalShot < 0.2;
  if (local) lastLocalShot = now;
  // Gần: phần thẳng áp đảo; xa: phần thẳng mờ nhanh, còn lại chủ yếu tiếng dội (như tiếng súng xa thật).
  const direct = local ? 1 : 1 / (1 + Math.pow(d / 110, 1.6));
  const dryLevel = loud * (local ? 1 : 0.95 * sp!.gain * direct);
  const tailLevel = loud * P.tailVol * (local ? (burst ? 0.6 : 1) : Math.pow(sp!.gain, 0.55) * (1 + 0.8 * Math.min(1, d / 160)));
  const reverb = P.rev * (local ? 0.45 : 0.6 + 1.2 * Math.min(1, d / 180));
  const v = voice("gun", Math.max(dryLevel, tailLevel * 0.6), { sp, reverb, wide: local ? 0.35 : 0, gain: 1 });
  if (!v) return;

  // 1–4. Phần khô dựng sẵn: tiếng nứt siêu thanh + tách dải rộng (bão hòa), khối hơi, thân trầm, bark.
  v.buffer(0, pick(bank.dry), rate, dryLevel);
  // 5. Tiếng cơ khí của chính mình: kim hỏa đập, khối khóa nòng va vào hộp khóa, lò xo rung kim loại.
  if (local) {
    const m = cls === "sniper" || cls === "dmr" ? 0.8 : cls === "pistol" ? 1.1 : 1;
    // Tiếng "chát" ở ngay đầu: dải cao rất ngắn, cho phát súng đanh, dứt khoát.
    v.noise(0, { type: "highpass", freq: 4200, q: 0.7, decay: 0.009, peak: 0.28 * m, attack: 0.0003 });
    v.noise(0.002, { type: "bandpass", freq: rand(2800, 3400), q: 4, decay: 0.012, peak: 0.16 * m, attack: 0.0005 }, v.side);
    v.noise(0.012, { type: "bandpass", freq: rand(1000, 1300), q: 6, decay: 0.035, peak: 0.12 * m }, v.side);
    v.osc(0.012, { type: "triangle", freq: rand(430, 520), freqEnd: 380, decay: 0.05, peak: 0.05 * m }, v.side);
  }
  // RPG: động cơ tên lửa rít xa dần sau cú phụt.
  if (cls === "launcher") {
    v.noise(0.03, { type: "bandpass", freq: 2200, freqEnd: 900, q: 0.8, attack: 0.03, decay: 0.9, peak: 0.5 * dryLevel });
    v.noise(0.02, { type: "lowpass", freq: 600, decay: 0.7, peak: 0.6 * dryLevel });
  }
  // 6. Đuôi vang ngoài trời: nhánh riêng, lọc nhẹ theo khoảng cách, lệch trái phải ít (tiếng dội đến từ nhiều phía).
  const tailCut = local ? 20000 : clamp(9000 * Math.exp(-d / 150), 450, 20000);
  const tail = v.branch(tailCut, (sp?.pan ?? 0) * 0.35);
  v.buffer(0.004, pick(bank.tail), Math.sqrt(rate), tailLevel, tail);
  // 7. Súng lớn nghe từ xa: thêm một đợt dội muộn từ đồi xa, lăn rền như sấm.
  if (d > 110 && (cls === "sniper" || cls === "dmr" || cls === "lmg")) {
    v.buffer(rand(0.35, 0.7), pick(bank.tail), Math.sqrt(rate) * 0.85, tailLevel * 0.55, tail);
  }
  v.done();
});

let warmed: AudioContext | null = null;

/**
 * Dựng trước buffer cho mọi khẩu súng và lựu đạn, rải từng khẩu một (mỗi khẩu vài chục ms) để phát súng đầu tiên
 * trong trận không bị khựng. Gọi lại nhiều lần không sao.
 */
export function warmGunSounds() {
  try {
    const ctx = live();
    if (!ctx || warmed === ctx) return;
    warmed = ctx;
    const jobs: (() => void)[] = [];
    for (const def of WEAPON.values()) jobs.push(() => void bankFor(ctx, def.id, blastFor(def.class, def.ammo, def.damage)));
    jobs.push(() => void bankFor(ctx, "boom:frag", BLASTS.frag), () => void bankFor(ctx, "boom:mine", BLASTS.mine));
    jobs.forEach((f, i) => setTimeout(safe(f), 300 + i * 420));
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Hết đạn: tiếng tách khô. */
export const playDryFire = safe(() => {
  const v = voice("local", 0.35);
  if (!v) return;
  v.noise(0, { type: "highpass", freq: 3500, decay: 0.012, peak: 0.9, attack: 0.001 });
  v.osc(0, { type: "triangle", freq: 2900, decay: 0.02, peak: 0.35 });
  v.noise(0.03, { type: "bandpass", freq: 1500, q: 4, decay: 0.02, peak: 0.3 });
  v.done();
});

// ---------------------------------------------------------------------------- thao tác súng

/** Tiếng kim loại va nhau ngắn (khóa, lẫy): `f` là độ cao. */
function clack(v: Voice, dt: number, f: number, peak: number) {
  v.noise(dt, { type: "bandpass", freq: f, q: 3, decay: 0.03, peak, attack: 0.001 });
  v.osc(dt, { type: "triangle", freq: f * 0.55, freqEnd: f * 0.4, decay: 0.035, peak: peak * 0.35 });
}

/** Tiếng trượt kim loại (kéo khóa nòng, rút băng): tiếng ồn băng hẹp trượt cao độ. */
function slide(v: Voice, dt: number, from: number, to: number, dur: number, peak: number) {
  v.noise(dt, { type: "bandpass", freq: from, freqEnd: to, q: 2.5, attack: dur * 0.3, decay: dur * 0.7, peak });
}

function magOut(v: Voice, dt: number) {
  clack(v, dt, 2600, 0.5); // nút nhả băng
  slide(v, dt + 0.04, 1800, 900, 0.14, 0.35);
}

function magIn(v: Voice, dt: number, heavy = 1) {
  slide(v, dt, 900, 1600, 0.09, 0.3);
  clack(v, dt + 0.09, 1700, 0.8);
  v.osc(dt + 0.09, { freq: 190 * heavy, freqEnd: 90, decay: 0.06, peak: 0.45 });
}

function charge(v: Voice, dt: number) {
  slide(v, dt, 1400, 2600, 0.1, 0.45);
  clack(v, dt + 0.14, 2200, 0.85);
  v.osc(dt + 0.14, { freq: 240, freqEnd: 110, decay: 0.05, peak: 0.35 });
}

/** Chu trình khóa nòng (kéo lên, lùi, đẩy tới, khóa xuống). */
function boltCycle(v: Voice, dt: number, rate = 1) {
  clack(v, dt, 2100, 0.5);
  slide(v, dt + 0.06 * rate, 1200, 2400, 0.12 * rate, 0.45);
  clack(v, dt + 0.2 * rate, 2600, 0.6);
  slide(v, dt + 0.28 * rate, 2300, 1300, 0.1 * rate, 0.4);
  clack(v, dt + 0.4 * rate, 1800, 0.85);
  v.osc(dt + 0.4 * rate, { freq: 210, freqEnd: 100, decay: 0.05, peak: 0.35 });
}

/** Thay đạn cho khẩu này, trải trong `seconds` giây. Trả về hàm hủy (khi đổi súng giữa chừng). */
export function playReload(weaponId: string, seconds: number): () => void {
  try {
    const cls: WeaponClass = WEAPON.get(weaponId)?.class ?? "ar";
    const s = clamp(Number.isFinite(seconds) ? seconds : 2, 0.5, 8);
    const v = voice("local", 0.5);
    if (!v) return noop;
    if (cls === "shotgun") {
      // Bẻ nòng, nạp hai viên, đóng nòng.
      clack(v, 0.05, 1500, 0.8);
      slide(v, 0.08, 1100, 600, 0.12, 0.3);
      for (let i = 0; i < 2; i++) {
        const t = s * (0.35 + i * 0.22);
        slide(v, t, 700, 1400, 0.07, 0.3);
        clack(v, t + 0.07, 1300, 0.5);
      }
      clack(v, s * 0.88, 1200, 1);
      v.osc(s * 0.88, { freq: 170, freqEnd: 80, decay: 0.08, peak: 0.5 });
    } else if (cls === "sniper") {
      // Mở khóa nòng, ấn từng viên vào hộp đạn, đóng khóa.
      clack(v, 0.05, 2100, 0.5);
      slide(v, 0.12, 1200, 2400, 0.14, 0.45);
      const rounds = 4;
      for (let i = 0; i < rounds; i++) clack(v, s * (0.3 + (i * 0.4) / rounds), rand(2800, 3300), 0.4);
      slide(v, s * 0.82, 2300, 1300, 0.12, 0.4);
      clack(v, s * 0.82 + 0.14, 1800, 0.9);
    } else {
      magOut(v, s * 0.08);
      // Băng cũ rơi / cất vào túi.
      v.noise(s * 0.3, { brown: true, type: "lowpass", freq: 900, decay: 0.08, peak: 0.25 });
      magIn(v, s * 0.55, cls === "lmg" ? 0.8 : 1);
      if (cls === "lmg") {
        // Trung liên: mở nắp, đặt dây đạn, đóng nắp.
        clack(v, s * 0.3, 1900, 0.6);
        slide(v, s * 0.68, 2500, 3500, 0.2, 0.2);
        clack(v, s * 0.78, 1500, 1);
      }
      if (cls === "pistol") clack(v, s * 0.85, 2400, 0.9); // nhả khóa trượt
      else charge(v, s * 0.82);
    }
    v.done();
    return () => v.kill();
  } catch {
    return noop;
  }
}

/** Chu trình khóa nòng sau phát bắn tỉa (Kar98k, AWM). */
export const playBolt = safe(() => {
  const v = voice("local", 0.45);
  if (!v) return;
  boltCycle(v, 0);
  v.done();
});

/** Đổi súng / rút súng: vải sột soạt rồi tiếng kim loại. */
export const playDraw = safe(() => {
  const v = voice("local", 0.4);
  if (!v) return;
  v.noise(0, { type: "bandpass", freq: 2200, freqEnd: 3500, q: 0.8, attack: 0.04, decay: 0.12, peak: 0.3 });
  clack(v, 0.14, 2400, 0.55);
  clack(v, 0.22, 1600, 0.7);
  v.done();
});

// ---------------------------------------------------------------------------- trúng đích, bị bắn

/** Dấu trúng: tiếng tích ngắn; trúng đầu là tiếng "keng" kim loại; hạ gục thêm cú thụp xác nhận. */
export const playHitMarker = safe((kind: "body" | "head" | "kill") => {
  const v = voice("ui", 0.5, { bus: "ui" });
  if (!v) return;
  v.osc(0, { type: "triangle", freq: 2600, decay: 0.03, peak: 0.6, attack: 0.001 });
  v.noise(0, { type: "highpass", freq: 5000, decay: 0.015, peak: 0.4, attack: 0.001 });
  if (kind === "head") {
    // Tần số không hòa âm (tỉ lệ như chuông) cho chất kim loại.
    v.osc(0.005, { freq: 2350, decay: 0.35, peak: 0.45 });
    v.osc(0.005, { freq: 2350 * 2.76, decay: 0.18, peak: 0.18 });
    v.osc(0.005, { freq: 2350 * 5.4, decay: 0.08, peak: 0.08 });
  }
  if (kind === "kill") {
    v.osc(0.03, { freq: 150, freqEnd: 48, decay: 0.25, peak: 1 });
    v.noise(0.03, { brown: true, type: "lowpass", freq: 500, decay: 0.15, peak: 0.6 });
    v.osc(0.06, { type: "triangle", freq: 1320, decay: 0.2, peak: 0.25 });
  }
  v.done();
});

/** Mình trúng đạn: va chạm đục vào người và tiếng thụp trầm ngắn. */
export const playHurt = safe(() => {
  const v = voice("local", 0.6);
  if (!v) return;
  v.noise(0, { brown: true, type: "lowpass", freq: 1200, freqEnd: 300, decay: 0.12, peak: 1 });
  v.noise(0, { type: "bandpass", freq: 700, q: 1.5, decay: 0.05, peak: 0.6 });
  v.osc(0, { freq: 95, freqEnd: 38, decay: 0.22, peak: 1 });
  v.done();
});

/** Giáp đỡ đạn: tiếng tấm giáp kêu "cạch". */
export const playArmorHit = safe(() => {
  const v = voice("local", 0.45);
  if (!v) return;
  const f = rand(1150, 1400);
  v.osc(0, { type: "triangle", freq: f, decay: 0.12, peak: 0.6 });
  v.osc(0, { freq: f * 2.43, decay: 0.07, peak: 0.3 });
  v.noise(0, { type: "highpass", freq: 3500, decay: 0.03, peak: 0.6, attack: 0.001 });
  v.osc(0, { freq: 130, freqEnd: 60, decay: 0.08, peak: 0.5 });
  v.done();
});

/**
 * Đạn bay sượt qua người: `at` là điểm đường đạn gần mình nhất, `miss` là khoảng cách tới đầu (m), `delay` là lúc
 * viên đạn tới điểm đó (giây, theo sơ tốc). Đạn siêu thanh (nhanh hơn 343 m/s) kêu "chát!" như roi quất (sóng xung
 * kích), sát tai thì rất to và gắt; đạn chậm (UMP45, súng lục) chỉ rít "víu" trượt cao độ. Cả hai lệch đúng bên đạn bay.
 */
export const playBulletWhiz = safe((at: Place, miss: number, delay: number, velocity: number) => {
  const sp = spatial(at, 30, 3);
  if (!sp) return;
  sp.delay = Math.min(0.6, Math.max(0, delay));
  sp.cutoff = 17000;
  // Gần tai thì lệch hẳn sang một bên (đạn bay bên trái hay bên phải đầu).
  sp.pan = clamp(sp.pan * 1.3, -0.95, 0.95);
  const near = clamp(1 - miss / 7, 0, 1);
  const level = (0.35 + 0.75 * near * near) * clamp(sp.gain * 1.6, 0.3, 1);
  const v = voice("fx", level, { sp, gain: level });
  if (!v) return;
  if (velocity > 360) {
    // Sóng xung kích: cú "chát" cực ngắn dải rộng, rồi tiếng tách cộng hưởng cao.
    v.noise(0, { type: "highpass", freq: 1800, q: 0.6, decay: 0.006 + 0.004 * near, peak: 1.3, attack: 0.0002 });
    v.noise(0.0008, { type: "bandpass", freq: rand(2600, 3400), q: 2.2, decay: 0.018, peak: 0.8, attack: 0.0003 });
    v.osc(0, { type: "square", freq: rand(900, 1300), freqEnd: 400, decay: 0.012, peak: 0.12 * near, attack: 0.0002 });
  }
  // Tiếng rít: tiếng ồn qua bộ lọc dải trượt từ cao xuống thấp (hiệu ứng Doppler khi đạn lao qua).
  const f = rand(2600, 3600) * (velocity > 360 ? 1 : 0.8);
  const whizz = velocity > 360 ? 0.35 : 0.9;
  v.noise(0.002, { type: "bandpass", freq: f, freqEnd: f * 0.35, q: 4, attack: 0.02, decay: 0.16 + 0.1 * near, peak: whizz });
  v.noise(0.004, { type: "bandpass", freq: f * 1.6, freqEnd: f * 0.5, q: 6, attack: 0.015, decay: 0.1, peak: whizz * 0.5 });
  v.done();
});

/** Đạn găm vào bề mặt gần người nghe. */
export const playImpact = safe((at: Place, surface: "dirt" | "concrete" | "metal" | "wood" | "water") => {
  const sp = spatial(at, 60, 6);
  if (!sp) return;
  const v = voice("fx", 0.45 * sp.gain, { sp, reverb: 0.15 });
  if (!v) return;
  switch (surface) {
    case "dirt":
      v.noise(0, { brown: true, type: "lowpass", freq: 900, decay: 0.08, peak: 1 });
      v.noise(0.01, { type: "highpass", freq: 3000, decay: 0.12, peak: 0.25, attack: 0.01 }); // đất cát rơi lả tả
      break;
    case "concrete":
      v.noise(0, { type: "highpass", freq: 2500, decay: 0.04, peak: 0.9, attack: 0.001 });
      v.noise(0, { type: "bandpass", freq: rand(1600, 2200), q: 2, decay: 0.06, peak: 0.6 });
      v.noise(0.03, { type: "highpass", freq: 4000, decay: 0.15, peak: 0.2, attack: 0.02 });
      break;
    case "metal": {
      const f = rand(1800, 3200);
      v.noise(0, { type: "highpass", freq: 3000, decay: 0.02, peak: 0.8, attack: 0.001 });
      v.osc(0, { type: "triangle", freq: f, decay: 0.3, peak: 0.45 });
      v.osc(0, { freq: f * 2.76, decay: 0.15, peak: 0.2 });
      // Đạn nảy (ricochet) thỉnh thoảng.
      if (Math.random() < 0.3) v.noise(0.02, { type: "bandpass", freq: 4200, freqEnd: 1800, q: 4, attack: 0.02, decay: 0.3, peak: 0.35 });
      break;
    }
    case "wood":
      v.osc(0, { freq: rand(280, 340), freqEnd: 160, decay: 0.09, peak: 0.7 });
      v.noise(0, { type: "bandpass", freq: 1000, q: 3, decay: 0.06, peak: 0.9 });
      v.noise(0.005, { type: "highpass", freq: 3500, decay: 0.04, peak: 0.3 }); // dăm gỗ
      break;
    case "water":
      v.noise(0, { type: "lowpass", freq: 3500, freqEnd: 600, decay: 0.25, peak: 0.8 });
      v.osc(0.02, { freq: rand(500, 700), freqEnd: rand(1100, 1500), decay: 0.06, peak: 0.3 });
      break;
  }
  v.done();
});

// ---------------------------------------------------------------------------- lựu đạn, mìn, khói

/** Công thức dựng sẵn cho lựu đạn và mìn: sóng xung kích rất dài, thân trầm sâu, đuôi lăn như sấm. */
const BLASTS: Record<"frag" | "mine", Blast> = {
  frag: { crack: 1.5, nwave: 1.2, click: 1.2, drive: 6, body: [70, 24, 0.35, 1.5], blast: [320, 0.25, 1.6], bark: [700, 0.8, 0.06, 0.8], bark2: [300, 0.7, 0.12, 0.9], dry: 1.6, tail: [5, 700, 1, 7] },
  mine: { crack: 1.6, nwave: 1.4, click: 1.3, drive: 6.5, body: [85, 26, 0.3, 1.5], blast: [380, 0.22, 1.7], bark: [900, 0.8, 0.05, 0.9], bark2: [340, 0.7, 0.1, 0.9], dry: 1.4, tail: [4.5, 750, 0.9, 7] },
};

/** Nổ lựu đạn / mìn: tiếng nổ lớn với đuôi trầm lăn dài, xa thì có tiếng dội; gần thì rất mạnh và ù tai. */
export const playExplosion = safe((at: Place, kind: "frag" | "mine" | "flash") => {
  // Lựu đạn choáng có tiếng riêng.
  if (kind === "flash") {
    playFlashbang(at);
    return;
  }
  const ctx = live();
  if (!ctx) return;
  const sp = spatial(at, 500, 25);
  if (!sp) return;
  const d = sp.d;
  const mine = kind === "mine";
  const bank = bankFor(ctx, `boom:${kind}`, BLASTS[kind]);
  const loud = (mine ? 1.3 : 1.25) * rand(0.94, 1.04);
  // Như tiếng súng: xa thì phần thẳng mờ nhanh, còn lại tiếng dội lăn rền.
  const direct = 1 / (1 + Math.pow(d / 160, 1.5));
  const dryLevel = loud * sp.gain * direct;
  const tailLevel = loud * 0.7 * Math.pow(sp.gain, 0.5) * (1 + 0.6 * Math.min(1, d / 200));
  const v = voice("gun", Math.max(dryLevel, tailLevel * 0.6) * 1.5, { sp, reverb: 0.5 + Math.min(1, d / 150), gain: 1 });
  if (!v) return;
  const rate = rand(0.93, 1.04);
  v.buffer(0, pick(bank.dry), rate, dryLevel);
  // Cú dội hạ âm: sin rất trầm cho cảm giác "rung ngực" mà buffer khó giữ được qua loa nhỏ.
  v.osc(0, { freq: mine ? 62 : 55, freqEnd: 22, decay: 1.2, peak: 0.55 * dryLevel, attack: 0.004 });
  const tail = v.branch(clamp(8000 * Math.exp(-d / 180), 400, 20000), sp.pan * 0.35);
  v.buffer(0.01, pick(bank.tail), rate, tailLevel, tail);
  if (d < 40) {
    // Đất đá, mảnh vụn rơi lộp độp.
    for (let i = 0; i < 7; i++) v.noise(rand(0.3, 1.5), { type: "bandpass", freq: rand(1500, 4000), q: 2, decay: 0.04, peak: rand(0.1, 0.25) * dryLevel });
  }
  if (d > 90) {
    // Tiếng dội vọng lại từ đồi xa.
    v.buffer(rand(0.5, 0.9), pick(bank.tail), rate * 0.85, tailLevel * 0.5, tail);
  }
  v.done();
  if (d < 12) {
    // Ù tai: tiếng rít cao mảnh tắt dần.
    const ring = voice("local", 0.08 * (1 - d / 12), { delay: sp.delay });
    if (ring) {
      ring.osc(0.05, { freq: rand(3300, 3900), attack: 0.1, decay: 2.2, peak: 1 });
      ring.done();
    }
  }
});

/** Rút chốt lựu đạn và ném (của mình). */
export const playThrow = safe(() => {
  const v = voice("local", 0.45);
  if (!v) return;
  // Chốt tuột ra: tiếng "ting" kim loại mảnh.
  v.osc(0, { type: "triangle", freq: 2300, decay: 0.12, peak: 0.45 });
  v.osc(0, { freq: 2300 * 2.7, decay: 0.06, peak: 0.15 });
  v.noise(0, { type: "highpass", freq: 4000, decay: 0.02, peak: 0.4 });
  // Cần bẩy bật ra.
  clack(v, 0.2, 1900, 0.45);
  // Tiếng vút khi ném.
  v.noise(0.26, { type: "bandpass", freq: 350, freqEnd: 1600, q: 1.2, attack: 0.08, decay: 0.22, peak: 0.8 });
  v.done();
});

/** Lựu đạn nảy trên đất. */
export const playGrenadeBounce = safe((at: Place) => {
  const sp = spatial(at, 45, 5);
  if (!sp) return;
  const v = voice("fx", 0.4 * sp.gain, { sp });
  if (!v) return;
  const f = rand(900, 1300);
  v.osc(0, { type: "triangle", freq: f, decay: 0.08, peak: 0.5 });
  v.osc(0, { freq: f * 2.3, decay: 0.05, peak: 0.2 });
  v.noise(0, { brown: true, type: "lowpass", freq: 700, decay: 0.06, peak: 0.8 });
  v.done();
});

/** Bom khói: tiếng bụp rồi xì xì kéo dài khoảng 4 giây. */
export const playSmoke = safe((at: Place) => {
  const sp = spatial(at, 80, 8);
  if (!sp) return;
  const v = voice("fx", 0.45 * sp.gain, { sp, reverb: 0.2 });
  if (!v) return;
  v.noise(0, { type: "lowpass", freq: 2000, freqEnd: 300, decay: 0.2, peak: 0.9 });
  v.osc(0, { freq: 140, freqEnd: 60, decay: 0.15, peak: 0.6 });
  // Xì khói: tiếng ồn cao, lên chậm, tắt chậm; thêm lớp giữa cho dày.
  v.noise(0.08, { type: "highpass", freq: 3200, freqEnd: 2200, attack: 0.3, decay: 3.8, peak: 0.45 });
  v.noise(0.08, { type: "bandpass", freq: 1400, freqEnd: 900, q: 0.7, attack: 0.4, decay: 3.4, peak: 0.25 });
  v.done();
});

/** Mìn: tiếng bíp khi gài và tiếng tách trước khi nổ (có vị trí). */
export const playMineBeep = safe((at: Place) => {
  const sp = spatial(at, 40, 5);
  if (!sp) return;
  sp.delay = 0;
  const v = voice("fx", 0.4 * sp.gain, { sp });
  if (!v) return;
  clack(v, 0, 2800, 0.6);
  v.osc(0.05, { type: "square", freq: 2400, decay: 0.07, peak: 0.25 });
  v.osc(0.17, { type: "square", freq: 2400, decay: 0.07, peak: 0.25 });
  v.done();
});

// ---------------------------------------------------------------------------- bước chân, vùng an toàn, giao diện

/** Bước chân người khác (để nghe đối thủ): chạy thì to hơn. */
export const playFootstep = safe((at: Place, surface: "grass" | "concrete" | "metal" | "wood", run: boolean) => {
  const sp = spatial(at, run ? 45 : 25, 4);
  if (!sp) return;
  sp.delay = 0;
  const v = voice("fx", (run ? 0.42 : 0.24) * sp.gain, { sp });
  if (!v) return;
  const p = rand(0.9, 1.1);
  switch (surface) {
    case "grass":
      v.noise(0, { type: "bandpass", freq: 2200 * p, q: 0.8, attack: 0.01, decay: 0.09, peak: 0.8 });
      v.noise(0, { brown: true, type: "lowpass", freq: 500, decay: 0.05, peak: 0.5 });
      break;
    case "concrete":
      v.noise(0, { type: "highpass", freq: 2600 * p, decay: 0.035, peak: 0.6 });
      v.osc(0, { freq: 200 * p, freqEnd: 110, decay: 0.05, peak: 0.6 });
      break;
    case "metal":
      v.osc(0, { type: "triangle", freq: 520 * p, decay: 0.14, peak: 0.4 });
      v.osc(0, { freq: 1370 * p, decay: 0.08, peak: 0.2 });
      v.noise(0, { type: "highpass", freq: 3000, decay: 0.03, peak: 0.4 });
      break;
    case "wood":
      v.osc(0, { freq: 300 * p, freqEnd: 160, decay: 0.1, peak: 0.6 });
      v.noise(0, { type: "bandpass", freq: 900 * p, q: 3, decay: 0.06, peak: 0.7 });
      break;
  }
  v.done();
});

/** Đáp đất sau cú nhảy, cú rơi: tiếng dậm trầm, đồ nghề trên người lách cách; `hard` 0–1 theo độ cao rơi. */
export const playLand = safe((at: Place, hard: number) => {
  const sp = spatial(at, 30, 4);
  if (!sp) return;
  sp.delay = 0;
  const v = voice("fx", (0.3 + hard * 0.4) * sp.gain, { sp });
  if (!v) return;
  v.osc(0, { freq: rand(95, 120), freqEnd: 55, decay: 0.09 + hard * 0.08, peak: 0.9 });
  v.noise(0, { brown: true, type: "lowpass", freq: 700, decay: 0.07 + hard * 0.05, peak: 0.8 });
  v.noise(0.005, { type: "bandpass", freq: rand(1800, 2400), q: 1.2, decay: 0.05, peak: 0.35 });
  // Đồ nghề (súng, băng đạn) va vào nhau.
  v.noise(0.03, { type: "highpass", freq: 4200, decay: 0.05, peak: 0.25 + hard * 0.2, attack: 0.004 });
  v.done();
});

/** Cảnh báo / trừ máu ngoài vùng an toàn. */
export const playZoneTick = safe(() => {
  const v = voice("ui", 0.4, { bus: "ui" });
  if (!v) return;
  v.osc(0, { type: "square", freq: 110, decay: 0.14, peak: 0.25 });
  v.osc(0, { freq: 55, decay: 0.2, peak: 0.7 });
  v.noise(0, { type: "bandpass", freq: 1800, q: 1, decay: 0.08, peak: 0.3 }); // lẹt xẹt điện
  v.done();
});

/** Đếm ngược; `final` là tiếng "BẮT ĐẦU". */
export const playCountdown = safe((final: boolean) => {
  const v = voice("ui", 0.45, { bus: "ui" });
  if (!v) return;
  if (final) {
    v.osc(0, { type: "triangle", freq: 1320, decay: 0.7, peak: 0.6 });
    v.osc(0, { freq: 660, decay: 0.8, peak: 0.5 });
    v.osc(0, { freq: 1980, decay: 0.4, peak: 0.15 });
  } else {
    v.osc(0, { type: "triangle", freq: 880, decay: 0.18, peak: 0.6 });
    v.osc(0, { freq: 1760, decay: 0.1, peak: 0.15 });
  }
  v.done();
});

/** Dùng đồ hồi máu (băng gạc xé / hộp cứu thương), trải trong `seconds` giây; trả về hàm hủy. */
export function playHeal(kind: "bandage" | "medkit", seconds: number): () => void {
  try {
    const s = clamp(Number.isFinite(seconds) ? seconds : 3, 0.5, 10);
    const v = voice("local", 0.4);
    if (!v) return noop;
    if (kind === "bandage") {
      // Xé băng: vài đợt tiếng ồn băng hẹp rung nhanh, rồi quấn sột soạt.
      for (let i = 0; i < 3; i++) {
        const t = s * (0.05 + i * 0.25);
        for (let k = 0; k < 5; k++) v.noise(t + k * 0.03, { type: "bandpass", freq: rand(2500, 4000), q: 1.5, decay: 0.03, peak: 0.5 });
        v.noise(t + 0.18, { type: "bandpass", freq: 1500, freqEnd: 2600, q: 0.8, attack: 0.08, decay: 0.2, peak: 0.25 });
      }
    } else {
      // Mở khóa kéo, lục đồ, xé gói, bấm ống tiêm, đóng hộp.
      for (let k = 0; k < 10; k++) v.noise(0.05 + k * 0.025, { type: "bandpass", freq: 3000 + k * 120, q: 3, decay: 0.015, peak: 0.4 });
      for (let i = 0; i < 4; i++) v.noise(s * (0.2 + i * 0.12) + rand(0, 0.1), { type: "highpass", freq: rand(2500, 4500), attack: 0.03, decay: 0.15, peak: 0.3 });
      for (let k = 0; k < 4; k++) v.noise(s * 0.7 + k * 0.03, { type: "bandpass", freq: rand(2500, 4000), q: 1.5, decay: 0.03, peak: 0.45 });
      clack(v, s * 0.85, 2600, 0.5);
      v.noise(s * 0.85 + 0.05, { type: "highpass", freq: 5000, attack: 0.05, decay: 0.15, peak: 0.2 });
      clack(v, s * 0.95, 1400, 0.6);
    }
    v.done();
    return () => v.kill();
  } catch {
    return noop;
  }
}

/** Mua đồ: tiếng "ka-ching" kiểu máy tính tiền. */
export const playBuy = safe(() => {
  const v = voice("ui", 0.45, { bus: "ui" });
  if (!v) return;
  v.noise(0, { type: "bandpass", freq: 2200, q: 3, decay: 0.03, peak: 0.6 });
  v.osc(0, { freq: 200, freqEnd: 110, decay: 0.06, peak: 0.4 }); // ngăn kéo
  v.osc(0.06, { type: "triangle", freq: 1568, decay: 0.35, peak: 0.45 });
  v.osc(0.06, { type: "triangle", freq: 2093, decay: 0.45, peak: 0.4 });
  v.osc(0.06, { freq: 2093 * 2.7, decay: 0.15, peak: 0.1 });
  v.done();
});

// ---------------------------------------------------------------------------- vỏ đạn, lựu choáng, ù tai

/** Vỏ đạn rơi xuống đất: đồng thau trên nền cứng kêu "leng keng" nảy vài lần; vỏ shotgun (nhựa) kêu "cộc" đục; nền mềm thì gần như chỉ còn tiếng "bịch" nhỏ. */
export const playShellDrop = safe((at: Place, kind: "brass" | "shotgun", surface: "hard" | "soft") => {
  const sp = spatial(at, 12, 2);
  if (!sp) return;
  sp.delay = 0;
  const soft = surface === "soft";
  const v = voice("fx", (soft ? 0.12 : 0.22) * sp.gain, { sp });
  if (!v) return;
  const p = rand(0.88, 1.14);
  if (soft) {
    // Rơi vào cỏ, đất: tiếng bịch mờ, chút sột soạt.
    v.noise(0, { brown: true, type: "lowpass", freq: 650 * p, decay: 0.035, peak: 0.8 });
    v.noise(0, { type: "bandpass", freq: (kind === "brass" ? 2600 : 1500) * p, q: 1.2, decay: 0.02, peak: 0.2 });
  } else if (kind === "brass") {
    // Đồng thau: tiếng "ting" sáng, tần số không hòa âm, nảy 2–3 lần mỗi lần nhỏ và gần nhau hơn.
    const bounces = Math.random() < 0.5 ? 2 : 3;
    let t = 0;
    let gap = rand(0.07, 0.11);
    for (let i = 0; i < bounces; i++) {
      const f = rand(3800, 5200) * p;
      const k = Math.pow(0.55, i);
      v.noise(t, { type: "highpass", freq: 5000, decay: 0.008, peak: 0.6 * k, attack: 0.0005 });
      v.osc(t, { type: "triangle", freq: f, decay: 0.06 * (1 - i * 0.2), peak: 0.55 * k, attack: 0.001 });
      v.osc(t, { freq: f * 2.41, decay: 0.035, peak: 0.2 * k, attack: 0.001 });
      t += gap;
      gap *= rand(0.55, 0.75);
    }
  } else {
    // Vỏ nhựa shotgun: tiếng "cộc" rỗng, đục, nảy một lần.
    for (let i = 0; i < 2; i++) {
      const t = i * rand(0.09, 0.13);
      const k = i ? 0.45 : 1;
      v.noise(t, { type: "bandpass", freq: rand(900, 1200) * p, q: 3, decay: 0.03, peak: 0.8 * k, attack: 0.001 });
      v.osc(t, { type: "triangle", freq: 420 * p, freqEnd: 300 * p, decay: 0.04, peak: 0.4 * k });
    }
  }
  v.done();
});

/** Nổ lựu đạn choáng: tiếng nứt cực sắc, rất to, nhiều cao tần, ít trầm hơn lựu đạn nổ; nghe được rất xa. */
export const playFlashbang = safe((at: Place) => {
  const sp = spatial(at, 450, 25);
  if (!sp) return;
  const d = sp.d;
  const v = voice("gun", 0.8 * sp.gain, { sp, reverb: 0.4 + Math.min(1, d / 150) });
  if (!v) return;
  const roll = 1 + d / 220;
  // Tiếng "tách" siêu ngắn rồi tiếng nứt sắc kéo dài một chút.
  v.noise(0, { type: "highpass", freq: 6500, decay: 0.02, peak: 1.1, attack: 0.0005 });
  v.noise(0, { type: "highpass", freq: 2400, decay: 0.13, peak: 1.2, attack: 0.0008 });
  v.noise(0, { type: "bandpass", freq: 3600, freqEnd: 2000, q: 1.2, decay: 0.22, peak: 0.6, attack: 0.001 });
  // Khối giữa: đóng lại nhanh hơn lựu đạn thường.
  v.noise(0, { type: "lowpass", freq: 6000, freqEnd: 700, decay: 0.25, peak: 0.7, attack: 0.002 });
  // Thân trầm nhẹ (ít thuốc nổ).
  v.osc(0, { freq: 150, freqEnd: 55, decay: 0.3, peak: 0.55, attack: 0.002 });
  // Đuôi vang ngắn hơn, sáng hơn.
  v.noise(0.03, { brown: true, type: "lowpass", freq: 700, freqEnd: 200, attack: 0.05, decay: 1.3 * roll, peak: 0.45 });
  if (d > 90) {
    v.noise(rand(0.45, 0.75), { brown: true, type: "lowpass", freq: 420, attack: 0.12, decay: 1.4 * roll, peak: 0.35 });
  }
  v.done();
});

/** Mức giảm hiện tại của các bus trò chơi khi ù tai; nhiều lần ù chồng nhau thì lấy mức nặng nhất. */
interface Deafen {
  start: number;
  seconds: number;
  depth: number;
}
const deafens = new Set<Deafen>();
let deafTimer: ReturnType<typeof setInterval> | null = null;
/** Độ to gốc của bus sfx và ambience (lấy ở lần giảm đầu tiên; không ai khác chỉnh hai bus này). */
let deafBase: { sfx: number; ambience: number } | null = null;

/** Độ giảm (0–1) của một lần ù tai ở thời điểm `now`: giảm nhanh, giữ một lúc rồi hồi dần về 0. */
function deafAt(x: Deafen, now: number): number {
  const s = (now - x.start) / 1000;
  if (s < 0) return 0;
  const hold = x.seconds * 0.3;
  if (s < hold) return x.depth;
  return x.depth * Math.max(0, 1 - (s - hold) / Math.max(0.1, x.seconds - hold));
}

/** Cập nhật độ to hai bus theo các lần ù tai đang còn; hết thì trả về mức gốc và dừng hẹn giờ. */
function deafTick() {
  try {
    const ctx = audio.ctx;
    const now = performance.now();
    let depth = 0;
    for (const x of deafens) {
      const dx = deafAt(x, now);
      if ((now - x.start) / 1000 >= x.seconds) deafens.delete(x);
      else depth = Math.max(depth, dx);
    }
    if (ctx && deafBase) {
      const t = ctx.currentTime;
      audio.bus("sfx").gain.setTargetAtTime(deafBase.sfx * (1 - depth), t, deafens.size ? 0.05 : 0.25);
      audio.bus("ambience").gain.setTargetAtTime(deafBase.ambience * (1 - depth), t, deafens.size ? 0.05 : 0.25);
    }
    if (!deafens.size && deafTimer) {
      clearInterval(deafTimer);
      deafTimer = null;
    }
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/**
 * Ù tai sau khi bị lựu đạn choáng: tiếng rít sin cao (3.5–4.5 kHz) có nhịp phách nhẹ, tắt dần trong `seconds` giây,
 * to theo `strength` (0–1). Trong lúc ù, tiếng trò chơi (sfx, ambience) bị giảm nhỏ rồi hồi lại êm. Tiếng ù đi qua
 * bus giao diện nên không bị giảm theo. Trả về hàm dừng sớm.
 */
export function playTinnitus(seconds: number, strength: number): () => void {
  try {
    const s = clamp(Number.isFinite(seconds) ? seconds : 3, 0.3, 20);
    const k = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
    const v = voice("local", 0.16 * k, { bus: "ui" });
    if (!v) return noop;
    const f = rand(3500, 4500);
    // Hai sin lệch vài Hz tạo nhịp phách chậm; thêm bồi âm mảnh cho khó chịu hơn.
    v.osc(0, { freq: f, attack: 0.08, decay: s, peak: 1 });
    v.osc(0, { freq: f + rand(3, 7), attack: 0.12, decay: s * 0.85, peak: 0.45 });
    v.osc(0, { freq: f * 1.5, attack: 0.2, decay: s * 0.5, peak: 0.08 });
    v.done();

    if (!deafBase) deafBase = { sfx: audio.bus("sfx").gain.value, ambience: audio.bus("ambience").gain.value };
    const me: Deafen = { start: performance.now(), seconds: s, depth: 0.75 * k };
    deafens.add(me);
    if (!deafTimer) deafTimer = setInterval(deafTick, 60);
    deafTick();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        v.kill();
        deafens.delete(me);
        deafTick();
      } catch {
        // Lỗi âm thanh thì im lặng bỏ qua.
      }
    };
  } catch {
    return noop;
  }
}

// ---------------------------------------------------------------------------- dao, đổi vũ khí, lựu đạn

/** Vung dao (của mình): tiếng vút gió và chút vải sột soạt. */
export const playKnifeSwing = safe(() => {
  const v = voice("local", 0.35);
  if (!v) return;
  const p = rand(0.9, 1.12);
  v.noise(0, { type: "bandpass", freq: 2400 * p, q: 0.7, attack: 0.02, decay: 0.08, peak: 0.25 }); // vải
  v.noise(0.02, { type: "bandpass", freq: 450 * p, freqEnd: 1900 * p, q: 1.4, attack: 0.07, decay: 0.13, peak: 0.9 });
  v.noise(0.04, { type: "highpass", freq: 3500, attack: 0.05, decay: 0.08, peak: 0.15 });
  v.done();
});

/** Dao trúng: đâm vào người là tiếng "phập" trầm, ướt; trúng vật cứng là tiếng kim loại cào rít. */
export const playKnifeHit = safe((at: Place, flesh: boolean) => {
  const sp = spatial(at, 25, 3);
  if (!sp) return;
  sp.delay = 0;
  const v = voice("fx", 0.45 * sp.gain, { sp, reverb: flesh ? 0 : 0.1 });
  if (!v) return;
  if (flesh) {
    v.noise(0, { brown: true, type: "lowpass", freq: 900, freqEnd: 250, decay: 0.08, peak: 1 });
    v.osc(0, { freq: rand(105, 125), freqEnd: 45, decay: 0.1, peak: 0.8 });
    v.noise(0.004, { type: "bandpass", freq: rand(550, 750), q: 1.5, decay: 0.06, peak: 0.55 }); // tiếng ướt
    v.noise(0.03, { type: "bandpass", freq: 1400, freqEnd: 800, q: 2, decay: 0.05, peak: 0.2 });
  } else {
    const f = rand(1900, 2600);
    v.noise(0, { type: "highpass", freq: 3200, decay: 0.02, peak: 0.8, attack: 0.001 });
    v.osc(0, { type: "triangle", freq: f, decay: 0.18, peak: 0.35 });
    v.osc(0, { freq: f * 2.76, decay: 0.1, peak: 0.15 });
    // Lưỡi dao cào dọc bề mặt.
    v.noise(0.01, { type: "bandpass", freq: rand(3200, 4000), freqEnd: 2000, q: 5, attack: 0.015, decay: 0.14, peak: 0.45 });
  }
  v.done();
});

/** Đổi vũ khí: vải sột soạt rồi tiếng kim loại; súng lục nhẹ hơn, rút dao có tiếng lưỡi "xoẹt". */
export const playWeaponSwap = safe((kind: "gun" | "pistol" | "throwable" | "knife") => {
  const light = kind !== "gun";
  const v = voice("local", light ? 0.32 : 0.4);
  if (!v) return;
  // Vải, bao súng sột soạt.
  v.noise(0, { type: "bandpass", freq: rand(2000, 2400), freqEnd: 3400, q: 0.8, attack: 0.04, decay: light ? 0.09 : 0.13, peak: 0.3 });
  switch (kind) {
    case "gun":
      clack(v, 0.14, 2400, 0.55);
      clack(v, 0.22, 1600, 0.7);
      v.osc(0.22, { freq: 180, freqEnd: 90, decay: 0.05, peak: 0.3 }); // báng súng chạm vai
      break;
    case "pistol":
      clack(v, 0.11, 2900, 0.45);
      clack(v, 0.17, 2200, 0.4);
      break;
    case "throwable":
      clack(v, 0.1, 2700, 0.3);
      v.osc(0.12, { type: "triangle", freq: 2500, decay: 0.06, peak: 0.12 }); // cần bẩy lựu đạn khẽ kêu
      break;
    case "knife":
      // Lưỡi dao rút khỏi vỏ: tiếng "xoẹt" kim loại cao.
      v.noise(0.08, { type: "bandpass", freq: 4800, freqEnd: 7200, q: 6, attack: 0.02, decay: 0.16, peak: 0.45 });
      v.osc(0.1, { freq: rand(6000, 6600), attack: 0.01, decay: 0.18, peak: 0.08 });
      clack(v, 0.2, 3200, 0.25);
      break;
  }
  v.done();
});

/** Rút chốt lựu đạn: tiếng "tách" của vòng chốt và tiếng lò xo "ping" nhỏ. */
export const playPinPull = safe(() => {
  const v = voice("local", 0.4);
  if (!v) return;
  clack(v, 0, 3200, 0.45);
  slide(v, 0.01, 2500, 4000, 0.05, 0.25); // chốt trượt khỏi lỗ
  v.osc(0.05, { type: "triangle", freq: rand(2900, 3300), decay: 0.12, peak: 0.3 }); // vòng chốt
  v.osc(0.06, { freq: 5200, freqEnd: 4700, decay: 0.16, peak: 0.12 }); // lò xo
  v.done();
});

/** Cần bẩy (thìa) lựu đạn bật ra khi ném: tiếng "ting" kim loại nhẹ, lộn vòng. */
export const playSpoon = safe((at: Place) => {
  const sp = spatial(at, 25, 4);
  if (!sp) return;
  sp.delay = 0;
  const v = voice("fx", 0.3 * sp.gain, { sp });
  if (!v) return;
  const f = rand(2600, 3100);
  v.noise(0, { type: "highpass", freq: 4500, decay: 0.01, peak: 0.4, attack: 0.0005 });
  v.osc(0, { type: "triangle", freq: f, decay: 0.16, peak: 0.5 });
  v.osc(0, { freq: f * 2.7, decay: 0.07, peak: 0.18 });
  // Lộn vòng trong không khí rồi chạm khẽ.
  v.osc(rand(0.08, 0.12), { type: "triangle", freq: f * 1.08, decay: 0.08, peak: 0.2 });
  v.done();
});

// ---------------------------------------------------------------------------- các bước thay đạn rời, cơ khí sau phát bắn

function reloadClass(weaponId: string): WeaponClass {
  return WEAPON.get(weaponId)?.class ?? "ar";
}

/** Bước tháo băng (hoặc bẻ nòng shotgun, mở khóa nòng súng bắn tỉa, mở nắp trung liên). */
export const playMagOut = safe((weaponId: string) => {
  const cls = reloadClass(weaponId);
  const v = voice("local", cls === "pistol" ? 0.42 : 0.5);
  if (!v) return;
  if (cls === "shotgun") {
    clack(v, 0, 1500, 0.8);
    slide(v, 0.03, 1100, 600, 0.12, 0.3);
  } else if (cls === "sniper") {
    clack(v, 0, 2100, 0.5);
    slide(v, 0.07, 1200, 2400, 0.14, 0.45);
  } else {
    if (cls === "lmg") clack(v, 0, 1900, 0.6); // mở nắp
    magOut(v, cls === "lmg" ? 0.12 : 0);
    // Băng cũ rơi / cất vào túi.
    v.noise(0.25, { brown: true, type: "lowpass", freq: 900, decay: 0.08, peak: 0.25 });
  }
  v.done();
});

/** Bước lắp băng (shotgun và súng bắn tỉa: nạp một viên, gọi lại cho mỗi viên). */
export const playMagIn = safe((weaponId: string) => {
  const cls = reloadClass(weaponId);
  const v = voice("local", cls === "pistol" ? 0.42 : 0.5);
  if (!v) return;
  if (cls === "shotgun") {
    slide(v, 0, 700, 1400, 0.07, 0.3);
    clack(v, 0.07, 1300, 0.5);
  } else if (cls === "sniper") {
    clack(v, 0, rand(2800, 3300), 0.4);
  } else {
    magIn(v, 0, cls === "lmg" ? 0.8 : cls === "pistol" ? 1.2 : 1);
    if (cls === "lmg") {
      // Đặt dây đạn rồi đóng nắp.
      slide(v, 0.2, 2500, 3500, 0.2, 0.2);
      clack(v, 0.45, 1500, 1);
    }
  }
  v.done();
});

/** Bước lên đạn (kéo khóa nòng, nhả khóa trượt, đóng nòng shotgun, đẩy khóa nòng súng bắn tỉa). */
export const playBoltRack = safe((weaponId: string) => {
  const cls = reloadClass(weaponId);
  const v = voice("local", cls === "pistol" ? 0.42 : 0.5);
  if (!v) return;
  switch (cls) {
    case "pistol":
      clack(v, 0, 2400, 0.9); // nhả khóa trượt
      v.osc(0, { freq: 260, freqEnd: 130, decay: 0.04, peak: 0.25 });
      break;
    case "shotgun":
      clack(v, 0, 1200, 1);
      v.osc(0, { freq: 170, freqEnd: 80, decay: 0.08, peak: 0.5 });
      break;
    case "sniper":
      slide(v, 0, 2300, 1300, 0.12, 0.4);
      clack(v, 0.14, 1800, 0.9);
      v.osc(0.14, { freq: 210, freqEnd: 100, decay: 0.05, peak: 0.35 });
      break;
    default:
      charge(v, 0);
  }
  v.done();
});

/** Cơ khí sau mỗi phát (khóa trượt súng lục, bệ khóa nòng súng trường): tiếng lách cách khẽ, chỉ cho người bắn. */
export const playShotMechanics = safe((weaponId: string) => {
  const cls = reloadClass(weaponId);
  const p = (0.94 + hash(weaponId) * 0.12) * rand(0.96, 1.04);
  const v = voice("local", cls === "pistol" ? 0.16 : cls === "sniper" ? 0.1 : 0.14);
  if (!v) return;
  switch (cls) {
    case "pistol":
      // Khóa trượt lùi rồi lao tới.
      clack(v, 0, 3100 * p, 0.5);
      clack(v, 0.03, 2500 * p, 0.45);
      break;
    case "shotgun":
      clack(v, 0.01, 1700 * p, 0.5);
      break;
    case "sniper":
      clack(v, 0, 2300 * p, 0.3);
      break;
    default: {
      // Bệ khóa nòng: lùi, lò xo nén "boing" khẽ, đóng lại.
      const heavy = cls === "lmg" || cls === "dmr" ? 0.85 : cls === "smg" ? 1.15 : 1;
      v.noise(0, { type: "bandpass", freq: 1900 * p * heavy, q: 2, decay: 0.018, peak: 0.45, attack: 0.001 });
      v.osc(0.006, { freq: 950 * p * heavy, freqEnd: 720 * p * heavy, decay: 0.05, peak: 0.1 });
      clack(v, 0.028 / heavy, 2300 * p * heavy, 0.4);
    }
  }
  v.done();
});

// ---------------------------------------------------------------------------- xe tăng

/** Pháo xe tăng: cú nổ đầu nòng rất lớn, trầm, sóng xung kích dài, đuôi lăn như sấm (dựng sẵn như tiếng súng). */
const CANNON: Blast = { crack: 1.6, nwave: 0.9, click: 1.3, drive: 6.2, body: [62, 26, 0.16, 1.5], blast: [300, 0.12, 1.6], bark: [800, 0.8, 0.05, 0.9], bark2: [360, 0.7, 0.09, 0.9], dry: 1.5, tail: [5, 800, 1, 8] };

/** Một phát pháo xe tăng ở đầu nòng `at`. `local`: xe mình bắn (to, không lọc khoảng cách). */
export const playCannon = safe((at: Place, local: boolean) => {
  const ctx = live();
  if (!ctx) return;
  const sp = local ? null : spatial(at, 600, 30);
  if (!local && !sp) return;
  const d = sp?.d ?? 0;
  const bank = bankFor(ctx, "cannon", CANNON);
  const direct = local ? 1 : 1 / (1 + Math.pow(d / 180, 1.5));
  const dryLevel = 1.35 * (local ? 1 : sp!.gain * direct);
  const tailLevel = 0.9 * (local ? 1 : Math.pow(sp!.gain, 0.5) * (1 + 0.6 * Math.min(1, d / 200)));
  const v = voice("gun", Math.max(dryLevel, tailLevel) * 1.5, { sp, reverb: local ? 0.4 : 0.6 + Math.min(1, d / 150), gain: 1, wide: local ? 0.4 : 0 });
  if (!v) return;
  const rate = rand(0.95, 1.03);
  v.buffer(0, pick(bank.dry), rate, dryLevel);
  v.osc(0, { freq: 48, freqEnd: 20, decay: 1, peak: 0.6 * dryLevel, attack: 0.003 });
  const tail = v.branch(local ? 20000 : clamp(8000 * Math.exp(-d / 180), 400, 20000), (sp?.pan ?? 0) * 0.35);
  v.buffer(0.01, pick(bank.tail), rate, tailLevel, tail);
  // Của mình: tiếng khoá nòng pháo đóng lại, vỏ đạn rơi keng trong tháp pháo.
  if (local) {
    v.noise(0.6, { type: "bandpass", freq: 1400, q: 5, decay: 0.08, peak: 0.25 });
    v.osc(0.62, { type: "triangle", freq: 620, freqEnd: 480, decay: 0.25, peak: 0.12 });
  }
  v.done();
});

/** Nạp đạn pháo xong: tiếng khoá nòng đóng "cạch". */
export const playCannonReady = safe(() => {
  const v = voice("local", 0.4);
  if (!v) return;
  v.noise(0, { type: "bandpass", freq: 2200, q: 6, decay: 0.03, peak: 0.6, attack: 0.001 });
  v.osc(0.01, { type: "triangle", freq: 340, freqEnd: 260, decay: 0.12, peak: 0.3 });
  v.done();
});

/**
 * Tiếng máy xe tăng: tiếng ồn nâu lọc thấp (máy nổ) cộng răng cưa trầm (động cơ diesel), cao độ và độ to theo tốc
 * độ xe, lạch cạch xích; mỗi xe một vòng tiếng, nhỏ dần theo khoảng cách. Trả về hàm cập nhật và hàm tắt.
 */
export function tankEngine(): { update: (at: Place, speed: number, local: boolean) => void; stop: () => void } {
  const ctx = live();
  if (!ctx) return { update: noop, stop: noop };
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner();
  out.connect(pan).connect(audio.bus("sfx"));
  const src = ctx.createBufferSource();
  src.buffer = audio.brown;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  lp.Q.value = 2;
  src.connect(lp).connect(out);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 32;
  const og = ctx.createGain();
  og.gain.value = 0.18;
  const olp = ctx.createBiquadFilter();
  olp.type = "lowpass";
  olp.frequency.value = 180;
  osc.connect(olp).connect(og).connect(out);
  // Xích: tiếng ồn dải cao đập theo nhịp (điều biên bằng sóng vuông).
  const tr = ctx.createBufferSource();
  tr.buffer = audio.white;
  tr.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 1.5;
  const tg = ctx.createGain();
  tg.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = 6;
  const lg = ctx.createGain();
  lg.gain.value = 0;
  lfo.connect(lg).connect(tg.gain);
  tr.connect(bp).connect(tg).connect(out);
  src.start(0, Math.random() * 3);
  tr.start(0, Math.random() * 3);
  osc.start();
  lfo.start();
  let stopped = false;
  return {
    update(at, speed, local) {
      if (stopped || !audio.ctx) return;
      const t = ctx.currentTime;
      const k = Math.min(1, Math.abs(speed) / 8);
      let gain = 0.22 + 0.25 * k;
      let p = 0;
      if (!local) {
        const L = audio.listener;
        const dx = at.x - L.x;
        const dz = at.z - L.z;
        const d = Math.hypot(dx, dz);
        gain *= Math.max(0, Math.pow(1 - Math.min(1, d / 110), 1.8));
        if (d > 0.5) p = clamp(((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.8, -0.8, 0.8);
      } else gain *= 0.7;
      out.gain.setTargetAtTime(gain, t, 0.15);
      pan.pan.setTargetAtTime(p, t, 0.1);
      osc.frequency.setTargetAtTime(30 + 26 * k, t, 0.3);
      lp.frequency.setTargetAtTime(180 + 220 * k, t, 0.3);
      lg.gain.setTargetAtTime(0.12 * k, t, 0.2);
      lfo.frequency.setTargetAtTime(3 + 9 * k, t, 0.3);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.1);
        for (const n of [src, tr, osc, lfo]) n.stop(t + 0.5);
        setTimeout(() => out.disconnect(), 800);
      } catch {
        // Đã tắt.
      }
    },
  };
}
