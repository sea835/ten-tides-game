import { describe, expect, it } from "vitest";
import { IslandState, PlayerState, VOICE_SDP_MAX, VoiceMessages } from "@tentides/protocol";
import { SIGNAL_BURST, SIGNAL_RATE, VoiceRelay, type VoiceClient, type VoiceHost } from "./voice.ts";

interface Sent {
  type: string;
  message: Record<string, unknown>;
}

/** Phòng giả: vài người thật (mỗi người một client ghi lại gói nhận được) và một máy. */
function makeHost() {
  const state = new IslandState();
  const clients = new Map<string, VoiceClient & { inbox: Sent[] }>();
  const add = (id: string, opts: { bot?: boolean; connected?: boolean } = {}) => {
    const p = new PlayerState();
    p.name = id;
    p.bot = !!opts.bot;
    p.connected = opts.connected ?? true;
    if (!p.bot) {
      p.sessionId = `s-${id}`;
      const inbox: Sent[] = [];
      clients.set(id, { sessionId: p.sessionId, inbox, send: (type, message) => inbox.push({ type, message: message as Record<string, unknown> }) });
    }
    state.players.set(id, p);
  };
  add("alice");
  add("bob");
  add("carol", { connected: false });
  add("bot1", { bot: true });
  const host: VoiceHost = {
    state,
    playerOf: (client) => [...clients.entries()].find(([, c]) => c.sessionId === client.sessionId)?.[0],
    clientOf: (id) => clients.get(id),
  };
  let now = 1_000_000;
  const relay = new VoiceRelay(host, () => now);
  return { state, clients, relay, c: (id: string) => clients.get(id)!, advance: (ms: number) => (now += ms) };
}

describe("giọng nói: chuyển gói bắt tay", () => {
  it("chuyển đúng cho người nhận, gắn id người gửi, không lộ `to`", () => {
    const h = makeHost();
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "offer", sdp: "v=0..." })).toBe(true);
    expect(h.c("bob").inbox).toEqual([{ type: VoiceMessages.signal, message: { from: "alice", kind: "offer", sdp: "v=0..." } }]);
    expect(h.c("alice").inbox).toEqual([]);
    h.relay.signal(h.c("bob"), { to: "alice", kind: "ice", candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 });
    expect(h.c("alice").inbox[0]!.message).toMatchObject({ from: "bob", kind: "ice", sdpMLineIndex: 0 });
  });

  it("không bao giờ gửi cho máy, người đang rớt mạng, chính mình hay người không có thật", () => {
    const h = makeHost();
    expect(h.relay.signal(h.c("alice"), { to: "bot1", kind: "hello" })).toBe(false);
    expect(h.relay.signal(h.c("alice"), { to: "carol", kind: "hello" })).toBe(false);
    expect(h.relay.signal(h.c("alice"), { to: "alice", kind: "hello" })).toBe(false);
    expect(h.relay.signal(h.c("alice"), { to: "nobody", kind: "hello" })).toBe(false);
    for (const c of h.clients.values()) expect(c.inbox).toEqual([]);
  });

  it("từ chối gói sai dạng hoặc quá lớn, và client lạ không thuộc phòng", () => {
    const h = makeHost();
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "offer", sdp: "x".repeat(VOICE_SDP_MAX + 1) })).toBe(false);
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "ice", candidate: "x".repeat(5000) })).toBe(false);
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "launch-missiles" })).toBe(false);
    expect(h.relay.signal(h.c("alice"), "offer")).toBe(false);
    expect(h.relay.signal(h.c("alice"), null)).toBe(false);
    const stranger = { sessionId: "s-zzz", send: () => {} };
    expect(h.relay.signal(stranger, { to: "bob", kind: "hello" })).toBe(false);
    // Phiên cũ của một người đã vào lại bằng phiên mới cũng không gửi được.
    h.state.players.get("alice")!.sessionId = "s-alice-new";
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "hello" })).toBe(false);
    expect(h.c("bob").inbox).toEqual([]);
  });

  it("giới hạn tốc độ: dồn quá nhiều thì bỏ, chờ một lúc thì gửi tiếp được", () => {
    const h = makeHost();
    let ok = 0;
    for (let i = 0; i < SIGNAL_BURST + 50; i++) if (h.relay.signal(h.c("alice"), { to: "bob", kind: "ice", candidate: `c${i}` })) ok++;
    expect(ok).toBe(SIGNAL_BURST);
    expect(h.relay.signal(h.c("alice"), { to: "bob", kind: "hello" })).toBe(false);
    // Người khác không bị vạ lây.
    expect(h.relay.signal(h.c("bob"), { to: "alice", kind: "hello" })).toBe(true);
    h.advance(1000);
    let more = 0;
    for (let i = 0; i < SIGNAL_RATE * 2; i++) if (h.relay.signal(h.c("alice"), { to: "bob", kind: "hello" })) more++;
    expect(more).toBe(SIGNAL_RATE);
  });
});

describe("giọng nói: báo đang nói", () => {
  it("báo cho mọi người thật khác đang nối mạng, rớt mạng thì báo thôi nói", () => {
    const h = makeHost();
    expect(h.relay.talk(h.c("alice"), { on: true, radio: true })).toBe(true);
    expect(h.c("bob").inbox).toEqual([{ type: VoiceMessages.talk, message: { from: "alice", on: true, radio: true } }]);
    expect(h.c("alice").inbox).toEqual([]);
    expect(h.c("carol").inbox).toEqual([]);
    h.relay.drop("alice");
    expect(h.c("bob").inbox[1]!.message).toEqual({ from: "alice", on: false, radio: false });
    // Không nói thì rớt mạng cũng không báo gì.
    h.relay.drop("alice");
    expect(h.c("bob").inbox.length).toBe(2);
    expect(h.relay.talk(h.c("alice"), { on: "yes" })).toBe(false);
  });

  it("bấm nhả liên hồi bị chặn, nhưng thôi nói luôn được báo", () => {
    const h = makeHost();
    let on = 0;
    for (let i = 0; i < 100; i++) if (h.relay.talk(h.c("alice"), { on: true, radio: false })) on++;
    expect(on).toBeLessThan(20);
    expect(h.relay.talk(h.c("alice"), { on: false, radio: false })).toBe(true);
  });
});
