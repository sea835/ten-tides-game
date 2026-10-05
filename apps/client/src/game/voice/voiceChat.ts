import { VOICE_MAX_PEERS, VOICE_RANGE, VoiceMessages, type PlayerState, type VoiceSignalMessage, type VoiceSignalRelay, type VoiceTalkBroadcast, type VoiceTalkMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { bodies } from "../battle/runtime.ts";
import { audio, noiseBurst, tone } from "../sound/engine.ts";
import { getVoiceSettings, subscribeVoiceSettings } from "./voiceSettings.ts";

// Giọng nói theo khoảng cách (WebRTC, nối lưới): mỗi người nối thẳng với tối đa VOICE_MAX_PEERS người khác (đồng đội
// trước, rồi người gần nhất); server chỉ chuyển gói bắt tay. Tiếng người khác đặt vào PannerNode đúng chỗ họ đứng, nhỏ
// dần theo khoảng cách và im hẳn ngoài VOICE_RANGE mét. Giữ phím bộ đàm thì đồng đội nghe ở mọi nơi, qua bộ lọc dải
// tần hẹp và méo nhẹ như bộ đàm quân sự, kèm tiếng "tách" khi bắt đầu và thôi nói.
// Micro chỉ xin quyền ở lần đầu bấm nói (hoặc khi bật "mở micro luôn").

/** Máy chủ STUN/TURN: VITE_VOICE_ICE_SERVERS là danh sách URL cách nhau dấu phẩy, hoặc JSON mảng RTCIceServer. */
function iceServers(): RTCIceServer[] {
  const raw = (import.meta.env.VITE_VOICE_ICE_SERVERS as string | undefined)?.trim();
  if (raw) {
    try {
      if (raw.startsWith("[")) return JSON.parse(raw) as RTCIceServer[];
      return [{ urls: raw.split(",").map((u) => u.trim()).filter(Boolean) }];
    } catch {
      console.warn("VITE_VOICE_ICE_SERVERS không đọc được, dùng STUN mặc định.");
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

/** Không còn muốn nối (xa quá, đủ người) chừng này ms thì mới ngắt, khỏi nối/ngắt liên tục ở ranh giới. */
const LINGER_MS = 5000;
/** Nối hỏng thì chờ chừng này ms rồi mới thử lại; bên kia nói thôi (đủ người, tắt giọng nói) thì chờ lâu hơn. */
const RETRY_MS = 5000;
const BYE_BACKOFF_MS = 25_000;
/** Mức âm micro (RMS) coi là đang nói khi mở micro luôn, và giữ thêm chừng này ms sau khi im. */
const VAD_LEVEL = 0.025;
const VAD_HANG_MS = 450;

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  /** Bên mình gửi offer (id nhỏ hơn). */
  initiator: boolean;
  stream: MediaStream | null;
  /** Chrome chỉ chịu chảy tiếng WebRTC vào Web Audio khi luồng cũng gắn vào một thẻ audio (tắt tiếng). */
  el: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  panner: PannerNode | null;
  prox: GainNode | null;
  radio: GainNode | null;
  /** Mức đang đặt (để chỉ chỉnh khi đổi). */
  lastGain: number;
  lastProx: number;
  lastRadio: number;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  /** Lần cuối còn nằm trong danh sách muốn nối. */
  wantedAt: number;
}

export interface TalkState {
  radio: boolean;
}

class VoiceChat {
  room: IslandRoom | null = null;
  private me = "";
  private peers = new Map<string, Peer>();
  private failedAt = new Map<string, number>();
  /** Ai đang nói (server báo), id → qua bộ đàm hay không. */
  readonly talking = new Map<string, TalkState>();
  private mic: MediaStream | null = null;
  private micPending: Promise<MediaStream | null> | null = null;
  /** Lý do không dùng được micro (để báo trên HUD). */
  micError = "";
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  private vadUntil = 0;
  private ptt = false;
  private radioKey = false;
  /** Đang phát đi (đã báo server). */
  private sent = { on: false, radio: false };
  private out: GainNode | null = null;
  private radioBus: GainNode | null = null;
  private offs: (() => void)[] = [];
  private timers: number[] = [];
  private changes = new Set<() => void>();
  private version = 0;
  /** Đã chào mọi người (để họ bỏ kết nối cũ với mình) từ lần vào phòng / nối lại gần nhất chưa. */
  private helloSent = false;

  // ------------------------------------------------------------------------ vòng đời

  attach(room: IslandRoom) {
    if (this.room === room) return;
    this.detach();
    this.room = room;
    this.offs.push(room.onMessage(VoiceMessages.signal, (m: VoiceSignalRelay) => void this.onSignal(m)));
    this.offs.push(room.onMessage(VoiceMessages.talk, (m: VoiceTalkBroadcast) => this.onTalk(m)));
    // Vào lại sau khi rớt mạng: báo mọi người bắt tay lại từ đầu (kết nối cũ có thể đã chết).
    const hello = () => {
      this.helloSent = false;
      this.sayHello();
    };
    room.onReconnect(hello);
    this.offs.push(() => room.onReconnect.remove(hello));
    this.offs.push(audio.onStart(() => this.buildGraph()));
    this.offs.push(subscribeVoiceSettings(() => this.onSettings()));
    this.timers.push(window.setInterval(() => this.select(), 1000));
    this.timers.push(window.setInterval(() => this.update(), 50));
    this.helloSent = false;
    if (getVoiceSettings().openMic && getVoiceSettings().enabled) void this.ensureMic();
    this.notify();
  }

  detach() {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.timers.forEach((t) => {
      clearInterval(t);
      clearTimeout(t);
    });
    this.timers = [];
    for (const id of [...this.peers.keys()]) this.closePeer(id, false);
    this.talking.clear();
    this.setPtt(false, false);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.micPending = null;
    this.analyser = null;
    this.room = null;
    this.me = "";
    this.helloSent = false;
    this.notify();
  }

  // ------------------------------------------------------------------------ cho giao diện

  subscribe = (listener: () => void): (() => void) => {
    this.changes.add(listener);
    return () => this.changes.delete(listener);
  };
  snapshot = (): number => this.version;
  private notify() {
    this.version++;
    this.changes.forEach((l) => l());
  }

  /** Mình đang phát đi không (để hiện biểu tượng micro). */
  get transmitting(): { on: boolean; radio: boolean } {
    return this.sent;
  }

  isTalking(id: string): boolean {
    if (id === this.me) return this.sent.on;
    return this.talking.has(id);
  }

  /** Trạng thái các kết nối (để thử nghiệm). */
  debug() {
    return {
      me: this.me,
      mic: !!this.mic,
      sent: this.sent,
      talking: [...this.talking.entries()],
      peers: [...this.peers.values()].map((p) => ({ id: p.id, initiator: p.initiator, state: p.pc.connectionState, audio: !!p.source, prox: p.lastProx, radio: p.lastRadio, gain: p.lastGain })),
    };
  }

  hasMic(): boolean {
    return !!this.mic;
  }

  /** Có đồng đội là người thật để nói qua bộ đàm không. */
  hasRadioMates(): boolean {
    const room = this.room;
    const me = room?.state.players.get(this.me);
    if (!room || !me?.team) return false;
    for (const [id, p] of room.state.players) if (id !== this.me && !p.bot && p.team === me.team) return true;
    return false;
  }

  // ------------------------------------------------------------------------ nói

  /** Giữ / thả phím nói (`radio`: phím bộ đàm). */
  setPtt(down: boolean, radio: boolean) {
    if (radio) this.radioKey = down;
    else this.ptt = down;
    if (down && getVoiceSettings().enabled) void this.ensureMic().then(() => this.refreshTalk());
    else this.refreshTalk();
  }

  private ensureMic(): Promise<MediaStream | null> {
    if (this.mic) return Promise.resolve(this.mic);
    if (this.micPending) return this.micPending;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micError = "Trình duyệt không cho dùng micro ở trang này (cần https hoặc localhost).";
      this.notify();
      return Promise.resolve(null);
    }
    this.micPending = navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        if (!this.room) {
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }
        this.mic = stream;
        this.micError = "";
        const track = stream.getAudioTracks()[0] ?? null;
        if (track) track.enabled = false;
        // Gắn micro vào mọi kết nối đã có (không cần bắt tay lại: kênh tiếng đã mở hai chiều từ đầu).
        for (const p of this.peers.values()) this.attachMic(p);
        this.buildAnalyser();
        this.notify();
        return stream;
      })
      .catch(() => {
        this.micError = "Không dùng được micro (chưa cho phép hoặc không có micro).";
        this.notify();
        return null;
      })
      .finally(() => {
        this.micPending = null;
      });
    return this.micPending;
  }

  private attachMic(p: Peer) {
    const track = this.mic?.getAudioTracks()[0];
    const tr = p.pc.getTransceivers()[0];
    if (!track || !tr) return;
    if (tr.direction !== "sendrecv") tr.direction = "sendrecv";
    void tr.sender.replaceTrack(track).catch(() => {});
  }

  private buildAnalyser() {
    const ctx = audio.ctx;
    if (!ctx || !this.mic || this.analyser) return;
    const src = ctx.createMediaStreamSource(this.mic);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyserBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    src.connect(this.analyser);
  }

  /** Tính lại có đang phát không: giữ phím nói, giữ phím bộ đàm, hoặc mở micro luôn mà đang có tiếng nói. */
  private refreshTalk() {
    const set = getVoiceSettings();
    const radio = this.radioKey && this.hasRadioMates();
    const on = !!this.mic && set.enabled && (this.ptt || radio || (set.openMic && performance.now() < this.vadUntil));
    const track = this.mic?.getAudioTracks()[0];
    if (track && track.enabled !== on) track.enabled = on;
    if (on === this.sent.on && (radio && on) === this.sent.radio) return;
    const wasRadio = this.sent.radio;
    this.sent = { on, radio: on && radio };
    if (this.sent.radio !== wasRadio) this.squelch(this.sent.radio);
    this.room?.send(VoiceMessages.talk, { on, radio: this.sent.radio } satisfies VoiceTalkMessage);
    this.notify();
  }

  // ------------------------------------------------------------------------ chọn người để nối

  private sayHello() {
    const room = this.room;
    if (!room || !getVoiceSettings().enabled) return;
    this.me = myId(room);
    if (!this.me || this.helloSent) return;
    this.helloSent = true;
    for (const id of this.wanted()) this.send({ to: id, kind: "hello" });
  }

  /** Những người nên nối: người thật đang nối mạng, đồng đội trước, rồi gần nhất; tối đa VOICE_MAX_PEERS. */
  private wanted(): string[] {
    const room = this.room;
    if (!room) return [];
    const me = room.state.players.get(this.me);
    if (!me) return [];
    const list: { id: string; score: number }[] = [];
    for (const [id, p] of room.state.players) {
      if (id === this.me || p.bot || !p.connected) continue;
      const mate = !!me.team && p.team === me.team;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      list.push({ id, score: (mate ? 0 : 1e6) + d });
    }
    list.sort((a, b) => a.score - b.score);
    return list.slice(0, VOICE_MAX_PEERS).map((e) => e.id);
  }

  private select() {
    const room = this.room;
    if (!room) return;
    this.me = myId(room);
    if (!this.me) return;
    const now = performance.now();
    const enabled = getVoiceSettings().enabled;
    // Chào trước khi gọi ai (state có nhân vật của mình rồi mới chào được).
    if (enabled && !this.helloSent) this.sayHello();
    const want = enabled ? this.wanted() : [];
    for (const id of want) {
      const p = this.peers.get(id);
      if (p) p.wantedAt = now;
      else if (this.me < id && now - (this.failedAt.get(id) ?? -1e9) > RETRY_MS) void this.call(id);
    }
    for (const [id, p] of this.peers) {
      const gone = !room.state.players.get(id)?.connected;
      if (!enabled || gone || now - p.wantedAt > LINGER_MS) this.closePeer(id, !gone && enabled);
    }
    // Ai thôi có mặt thì bỏ dấu đang nói.
    for (const id of this.talking.keys()) {
      if (!room.state.players.get(id)?.connected) {
        this.talking.delete(id);
        this.notify();
      }
    }
    // Mở micro luôn mà chưa có micro (vừa bật trong cài đặt): xin quyền.
    if (enabled && getVoiceSettings().openMic && !this.mic && !this.micPending && !this.micError) void this.ensureMic();
  }

  // ------------------------------------------------------------------------ bắt tay

  private send(m: VoiceSignalMessage) {
    this.room?.send(VoiceMessages.signal, m);
  }

  private newPeer(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const p: Peer = { id, pc, initiator, stream: null, el: null, source: null, gain: null, panner: null, prox: null, radio: null, lastGain: -1, lastProx: -1, lastRadio: -1, pendingIce: [], remoteSet: false, wantedAt: performance.now() };
    pc.onicecandidate = (e) => {
      if (!e.candidate || this.peers.get(id) !== p) return;
      this.send({ to: id, kind: "ice", candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex });
    };
    pc.ontrack = (e) => {
      if (this.peers.get(id) !== p) return;
      p.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.wirePeer(p);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.failedAt.set(id, performance.now());
        this.closePeer(id, false);
      }
    };
    this.peers.set(id, p);
    return p;
  }

  /** Bên id nhỏ hơn gọi: mở một kênh tiếng hai chiều (có micro thì gắn luôn), gửi offer. */
  private async call(id: string) {
    const p = this.newPeer(id, true);
    const track = this.mic?.getAudioTracks()[0];
    if (track) p.pc.addTransceiver(track, { direction: "sendrecv" });
    else p.pc.addTransceiver("audio", { direction: "sendrecv" });
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      if (this.peers.get(id) !== p || !offer.sdp) return;
      this.send({ to: id, kind: "offer", sdp: offer.sdp });
    } catch {
      this.failedAt.set(id, performance.now());
      this.closePeer(id, false);
    }
  }

  private async onSignal(m: VoiceSignalRelay) {
    const room = this.room;
    if (!room || !m || typeof m.from !== "string") return;
    this.me = myId(room);
    const from = m.from;
    if (!from || from === this.me) return;
    if (!getVoiceSettings().enabled) {
      // Đã tắt giọng nói: từ chối để bên kia khỏi chờ.
      if (m.kind === "offer") this.send({ to: from, kind: "bye" });
      return;
    }
    switch (m.kind) {
      case "hello":
        // Bên kia mới vào lại: bỏ kết nối cũ; mình là bên gọi thì lần chọn sau gọi lại ngay.
        if (this.peers.has(from)) this.closePeer(from, false);
        this.failedAt.delete(from);
        return;
      case "bye":
        if (this.peers.has(from)) this.closePeer(from, false);
        this.failedAt.set(from, performance.now() + BYE_BACKOFF_MS);
        return;
      case "offer": {
        if (this.peers.has(from)) this.closePeer(from, false);
        if (this.peers.size >= VOICE_MAX_PEERS + 4) {
          this.send({ to: from, kind: "bye" });
          return;
        }
        const p = this.newPeer(from, false);
        try {
          await p.pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
          p.remoteSet = true;
          const tr = p.pc.getTransceivers()[0];
          if (tr) tr.direction = "sendrecv";
          this.attachMic(p);
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          if (this.peers.get(from) !== p || !answer.sdp) return;
          this.send({ to: from, kind: "answer", sdp: answer.sdp });
          this.flushIce(p);
        } catch {
          this.closePeer(from, false);
        }
        return;
      }
      case "answer": {
        const p = this.peers.get(from);
        if (!p || !p.initiator || p.remoteSet) return;
        try {
          await p.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
          p.remoteSet = true;
          this.flushIce(p);
        } catch {
          this.closePeer(from, false);
        }
        return;
      }
      case "ice": {
        const p = this.peers.get(from);
        if (!p) return;
        const c: RTCIceCandidateInit = { candidate: m.candidate, sdpMid: m.sdpMid ?? null, sdpMLineIndex: m.sdpMLineIndex ?? null };
        if (!p.remoteSet) {
          if (p.pendingIce.length < 64) p.pendingIce.push(c);
          return;
        }
        void p.pc.addIceCandidate(c).catch(() => {});
        return;
      }
    }
  }

  private flushIce(p: Peer) {
    for (const c of p.pendingIce) void p.pc.addIceCandidate(c).catch(() => {});
    p.pendingIce = [];
  }

  private closePeer(id: string, tell: boolean) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    if (tell) this.send({ to: id, kind: "bye" });
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.source?.disconnect();
    p.gain?.disconnect();
    p.panner?.disconnect();
    p.prox?.disconnect();
    p.radio?.disconnect();
    if (p.el) {
      p.el.srcObject = null;
      p.el = null;
    }
  }

  // ------------------------------------------------------------------------ đường tiếng

  /** Đầu ra chung (âm lượng giọng nói) và bộ lọc bộ đàm dùng chung cho mọi người. */
  private buildGraph() {
    const ctx = audio.ctx;
    if (!ctx || this.out) return;
    this.out = ctx.createGain();
    this.out.gain.value = getVoiceSettings().volume;
    // Giọng nói không bị nước làm ù như tiếng súng, đi thẳng ra loa (vẫn theo âm lượng tổng).
    this.out.connect(audio.bus("ui"));
    // Bộ đàm: cắt trầm, cắt bổng (dải 400–2800 Hz), méo nhẹ bằng hàm tanh, nén chặt cho đều tiếng.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 400;
    hp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    lp.Q.value = 0.9;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1500;
    mid.gain.value = 5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(new ArrayBuffer(1024 * 4));
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 8;
    this.radioBus = ctx.createGain();
    this.radioBus.gain.value = 0.85;
    hp.connect(lp).connect(mid).connect(shaper).connect(comp).connect(this.radioBus).connect(this.out);
    this.radioIn = hp;
    for (const p of this.peers.values()) this.wirePeer(p);
    this.buildAnalyser();
  }
  private radioIn: AudioNode | null = null;

  private wirePeer(p: Peer) {
    const ctx = audio.ctx;
    if (!ctx || !this.out || !this.radioIn || !p.stream || p.source) return;
    const el = new Audio();
    el.srcObject = p.stream;
    el.muted = true;
    void el.play().catch(() => {});
    p.el = el;
    p.source = ctx.createMediaStreamSource(p.stream);
    p.gain = ctx.createGain();
    p.panner = ctx.createPanner();
    p.panner.panningModel = "HRTF";
    // Tuyến tính: rõ trong 2 m, nhỏ dần, im hẳn ở VOICE_RANGE.
    p.panner.distanceModel = "linear";
    p.panner.refDistance = 2;
    p.panner.maxDistance = VOICE_RANGE;
    p.panner.rolloffFactor = 1;
    p.prox = ctx.createGain();
    p.radio = ctx.createGain();
    p.prox.gain.value = 0;
    p.radio.gain.value = 0;
    p.source.connect(p.gain);
    p.gain.connect(p.panner).connect(p.prox).connect(this.out);
    p.gain.connect(p.radio).connect(this.radioIn);
    p.lastGain = p.lastProx = p.lastRadio = -1;
  }

  private wasEnabled = getVoiceSettings().enabled;

  private onSettings() {
    const set = getVoiceSettings();
    if (this.out && audio.ctx) this.out.gain.setTargetAtTime(set.volume, audio.ctx.currentTime, 0.05);
    if (!set.enabled) {
      this.ptt = this.radioKey = false;
      for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    } else if (!this.wasEnabled) this.helloSent = false;
    this.wasEnabled = set.enabled;
    this.refreshTalk();
    this.notify();
  }

  private onTalk(m: VoiceTalkBroadcast) {
    if (!m || typeof m.from !== "string") return;
    const before = this.talking.get(m.from);
    if (m.on) this.talking.set(m.from, { radio: !!m.radio });
    else this.talking.delete(m.from);
    const nowRadio = !!m.on && !!m.radio;
    // Đồng đội bấm / thả bộ đàm: tiếng "tách" (người đã tắt tiếng thì thôi).
    if (!!before?.radio !== nowRadio && this.isMate(m.from) && !getVoiceSettings().muted.includes(m.from)) this.squelch(nowRadio);
    this.notify();
  }

  private isMate(id: string): boolean {
    const room = this.room;
    const me = room?.state.players.get(this.me);
    return !!me?.team && room?.state.players.get(id)?.team === me.team;
  }

  /** Tiếng "tách" và xì ngắn của bộ đàm khi bắt đầu / thôi nói. */
  private squelch(open: boolean) {
    const ctx = audio.ctx;
    if (!ctx || !this.out || ctx.state !== "running") return;
    const t = ctx.currentTime;
    tone(this.out, t, { type: "square", freq: open ? 1900 : 1500, attack: 0.002, peak: 0.06, decay: 0.035 });
    noiseBurst(this.out, t + 0.01, { type: "bandpass", freq: 2200, q: 0.8, attack: 0.003, peak: open ? 0.12 : 0.2, decay: open ? 0.06 : 0.16 });
  }

  /** 20 lần/giây: đặt tai nghe theo camera, giọng mỗi người theo chỗ họ đứng, chọn nghe thường hay qua bộ đàm. */
  private update() {
    const ctx = audio.ctx;
    const room = this.room;
    if (!room) return;
    // Mở micro luôn: dò có tiếng nói không.
    if (this.analyser && this.analyserBuf && getVoiceSettings().openMic) {
      this.analyser.getFloatTimeDomainData(this.analyserBuf);
      let sum = 0;
      for (let i = 0; i < this.analyserBuf.length; i++) sum += this.analyserBuf[i]! * this.analyserBuf[i]!;
      if (Math.sqrt(sum / this.analyserBuf.length) > VAD_LEVEL) this.vadUntil = performance.now() + VAD_HANG_MS;
    }
    this.refreshTalk();
    if (!ctx || !this.out || this.peers.size === 0) return;
    const t = ctx.currentTime;
    const l = audio.listener;
    const lis = ctx.listener;
    // Trục trước của camera: (−sin yaw, 0, −cos yaw).
    const fx = -Math.sin(l.yaw);
    const fz = -Math.cos(l.yaw);
    if (lis.positionX) {
      lis.positionX.setTargetAtTime(l.x, t, 0.04);
      lis.positionY.setTargetAtTime(l.y, t, 0.04);
      lis.positionZ.setTargetAtTime(l.z, t, 0.04);
      lis.forwardX.setTargetAtTime(fx, t, 0.04);
      lis.forwardY.setTargetAtTime(0, t, 0.04);
      lis.forwardZ.setTargetAtTime(fz, t, 0.04);
      lis.upX.value = 0;
      lis.upY.value = 1;
      lis.upZ.value = 0;
    } else {
      lis.setPosition(l.x, l.y, l.z);
      lis.setOrientation(fx, 0, fz, 0, 1, 0);
    }
    this.me = myId(room);
    const me = room.state.players.get(this.me);
    this.tickCtx = t;
    this.tickMe = me;
    this.tickMuted = getVoiceSettings().muted;
    this.peers.forEach(this.updatePeer);
  }
  private tickCtx = 0;
  private tickMe: PlayerState | undefined = undefined;
  private tickMuted: string[] = [];

  private updatePeer = (p: Peer) => {
    if (!p.gain || !p.panner || !p.prox || !p.radio) return;
    const room = this.room!;
    const t = this.tickCtx;
    const me = this.tickMe;
    const who = room.state.players.get(p.id);
    const b = bodies.get(p.id);
    const x = b ? b.x : (who?.x ?? 0);
    const y = (b ? b.y : (who?.y ?? 0)) + 1.6;
    const z = b ? b.z : (who?.z ?? 0);
    if (p.panner.positionX) {
      p.panner.positionX.setTargetAtTime(x, t, 0.05);
      p.panner.positionY.setTargetAtTime(y, t, 0.05);
      p.panner.positionZ.setTargetAtTime(z, t, 0.05);
    } else p.panner.setPosition(x, y, z);
    const talk = this.talking.get(p.id);
    const mate = !!me?.team && who?.team === me.team;
    const radio = !!talk?.radio && mate;
    // Người đã gục không nói được với người còn sống (người đang xem thì nghe hết).
    const silenced = !!me?.alive && !!who && !who.alive;
    const gain = this.tickMuted.includes(p.id) || silenced ? 0 : 1;
    const prox = radio ? 0 : 1;
    const rad = radio ? 1 : 0;
    if (gain !== p.lastGain) p.gain.gain.setTargetAtTime((p.lastGain = gain), t, 0.03);
    if (prox !== p.lastProx) p.prox.gain.setTargetAtTime((p.lastProx = prox), t, 0.03);
    if (rad !== p.lastRadio) p.radio.gain.setTargetAtTime((p.lastRadio = rad), t, 0.03);
  };
}

export const voice = new VoiceChat();

// Thử nghiệm: xem trạng thái giọng nói từ console (window.__tentidesVoice.debug()).
if (import.meta.env.DEV) (window as unknown as { __tentidesVoice: VoiceChat }).__tentidesVoice = voice;
