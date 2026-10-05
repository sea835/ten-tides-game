import { VoiceMessages, VoiceSignalMessage, VoiceTalkMessage, type IslandState, type VoiceSignalRelay, type VoiceTalkBroadcast } from "@tentides/protocol";

// Chuyển giúp gói bắt tay WebRTC cho giọng nói. Server không đụng tới âm thanh, chỉ kiểm tra: người gửi là người thật
// trong phòng, người nhận cũng là người thật đang nối mạng (không bao giờ gửi cho máy), gói không quá lớn, không gửi
// dồn dập quá mức (xô token mỗi người), rồi chuyển đúng cho một người với `from` là id người gửi.

/** Cái tối thiểu một client cần có để nhận gói (Client của Colyseus khớp sẵn). */
export interface VoiceClient {
  sessionId: string;
  send(type: string, message: unknown): void;
}

export interface VoiceHost {
  readonly state: IslandState;
  playerOf(client: VoiceClient): string | undefined;
  clientOf(playerId: string): VoiceClient | undefined;
}

/** Xô token: chứa tối đa `burst`, mỗi giây đầy thêm `rate`. */
interface Bucket {
  tokens: number;
  at: number;
}

/** Bắt tay một lần sinh ra cả chục gói ICE cùng lúc, nối với vài người thì dồn thêm; đủ rộng cho việc thật. */
export const SIGNAL_BURST = 120;
export const SIGNAL_RATE = 40;
/** Bấm / thả phím nói không ai bấm nhanh hơn chừng này. */
export const TALK_BURST = 12;
export const TALK_RATE = 6;

export class VoiceRelay {
  private signalBuckets = new Map<string, Bucket>();
  private talkBuckets = new Map<string, Bucket>();
  /** Ai đang nói (để báo thôi nói khi họ rớt mạng). */
  private talking = new Map<string, boolean>();

  constructor(
    private host: VoiceHost,
    private now: () => number = Date.now,
  ) {}

  /** Gói bắt tay từ `client`. Trả về true nếu đã chuyển đi. */
  signal(client: VoiceClient, raw: unknown): boolean {
    const from = this.human(client);
    if (!from) return false;
    const parsed = VoiceSignalMessage.safeParse(raw);
    if (!parsed.success) return false;
    const { to, ...rest } = parsed.data;
    if (to === from) return false;
    const target = this.host.state.players.get(to);
    if (!target || target.bot || !target.connected) return false;
    const out = this.host.clientOf(to);
    if (!out) return false;
    if (!this.take(this.signalBuckets, from, SIGNAL_BURST, SIGNAL_RATE)) return false;
    out.send(VoiceMessages.signal, { ...rest, from } satisfies VoiceSignalRelay);
    return true;
  }

  /** Bắt đầu / thôi nói: báo cho mọi người thật khác trong phòng. Trả về true nếu đã báo. */
  talk(client: VoiceClient, raw: unknown): boolean {
    const from = this.human(client);
    if (!from) return false;
    const parsed = VoiceTalkMessage.safeParse(raw);
    if (!parsed.success) return false;
    // Thôi nói luôn được báo (kẻo biểu tượng kẹt), bắt đầu nói thì tính vào giới hạn.
    if (parsed.data.on && !this.take(this.talkBuckets, from, TALK_BURST, TALK_RATE)) return false;
    if (parsed.data.on) this.talking.set(from, parsed.data.radio);
    else this.talking.delete(from);
    this.toOthers(from, { from, on: parsed.data.on, radio: parsed.data.on && parsed.data.radio });
    return true;
  }

  /** Người chơi rớt mạng hay rời phòng: đang nói thì báo thôi, quên giới hạn. */
  drop(playerId: string) {
    if (this.talking.delete(playerId)) this.toOthers(playerId, { from: playerId, on: false, radio: false });
    this.signalBuckets.delete(playerId);
    this.talkBuckets.delete(playerId);
  }

  private toOthers(from: string, message: VoiceTalkBroadcast) {
    for (const [id, p] of this.host.state.players) {
      if (id === from || p.bot || !p.connected) continue;
      this.host.clientOf(id)?.send(VoiceMessages.talk, message);
    }
  }

  /** Id người thật đã gửi gói (máy không có client nên không bao giờ gửi được, nhưng nhập xác máy thì vẫn là người). */
  private human(client: VoiceClient): string | undefined {
    const id = this.host.playerOf(client);
    const p = id ? this.host.state.players.get(id) : undefined;
    if (!id || !p || p.bot || p.sessionId !== client.sessionId) return undefined;
    return id;
  }

  private take(buckets: Map<string, Bucket>, id: string, burst: number, rate: number): boolean {
    const now = this.now();
    let b = buckets.get(id);
    if (!b) {
      b = { tokens: burst, at: now };
      buckets.set(id, b);
    }
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
