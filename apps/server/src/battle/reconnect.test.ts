import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineRoom, defineServer, matchMaker, type Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { BATTLE_ROOM_NAME, IslandState, VoiceMessages } from "@tentides/protocol";
import { BattleRoom, RECONNECT_SECONDS } from "./BattleRoom.ts";

// Chạy một server Colyseus thật trong tiến trình test: rớt mạng (đứt socket không báo trước) rồi nối lại bằng
// reconnectionToken thì về đúng nhân vật cũ (đội, đồ, súng đang cầm), và gói bắt tay giọng nói đi đúng người.

const PORT = 31_000 + Math.floor(Math.random() * 2000);
let server: Server;

beforeAll(async () => {
  server = defineServer({ transport: new WebSocketTransport(), rooms: { [BATTLE_ROOM_NAME]: defineRoom(BattleRoom) } });
  await server.listen(PORT);
});

afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const token = (n: number) => `${n}`.padStart(32, "0");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error("hết giờ chờ");
    await wait(20);
  }
}

function serverRoom(id: string): BattleRoom {
  return matchMaker.getLocalRoomById(id) as unknown as BattleRoom;
}

describe("vào lại trận sau khi rớt mạng", () => {
  it(`giữ chỗ ít nhất 30 giây (${RECONNECT_SECONDS})`, () => {
    expect(RECONNECT_SECONDS).toBeGreaterThanOrEqual(30);
  });

  it("đứt mạng giữa chừng: nhân vật vẫn đứng đó, nối lại bằng token thì về đúng đội, đồ, súng", async () => {
    const client = new Client(`ws://localhost:${PORT}`);
    const room: Room<any, IslandState> = await client.create(BATTLE_ROOM_NAME, { name: "An", token: token(1) }, IslandState);
    room.reconnection.enabled = false;
    await until(() => !!room.state.players?.size);
    const sr = serverRoom(room.roomId);
    const [id, p] = [...sr.state.players.entries()][0]!;
    // Giả như đang giữa trận: có đội, có súng, đang cầm súng phụ, còn ít máu.
    p.team = "blue";
    p.kit.money = 1234;
    p.kit.active = "pistol";
    p.hp = 37;
    const reconnectionToken = room.reconnectionToken;
    const sessionId = room.sessionId;

    // Đứt socket kiểu mất mạng (không có khung đóng), server coi là rớt chứ không phải tự rời.
    const sc = sr.clients.find((c) => c.sessionId === sessionId)!;
    (sc.ref as unknown as { terminate(): void }).terminate();
    await until(() => sr.state.players.get(id)?.connected === false);
    await wait(100);
    const kept = sr.state.players.get(id)!;
    expect(kept.alive).toBe(true);
    expect(kept.hp).toBe(37);

    // Tải lại trang: client mới, chỉ có token đã lưu.
    const fresh = new Client(`ws://localhost:${PORT}`);
    const back: Room<any, IslandState> = await fresh.reconnect(reconnectionToken, IslandState);
    await until(() => !!back.state.players?.size);
    expect(back.sessionId).toBe(sessionId);
    await until(() => sr.state.players.get(id)?.connected === true);
    const mine = back.state.players.get(id)!;
    expect(mine.team).toBe("blue");
    expect(mine.kit.money).toBe(1234);
    expect(mine.kit.active).toBe("pistol");
    expect(mine.hp).toBe(37);
    await back.leave();
  });

  it("gói bắt tay giọng nói đi đúng người thật trong cùng phòng", async () => {
    const a = new Client(`ws://localhost:${PORT}`);
    const b = new Client(`ws://localhost:${PORT}`);
    const ra: Room<any, IslandState> = await a.create(BATTLE_ROOM_NAME, { name: "A", token: token(2) }, IslandState);
    const rb: Room<any, IslandState> = await b.joinById(ra.roomId, { name: "B", token: token(3) }, IslandState);
    await until(() => ra.state.players?.size === 2 && rb.state.players?.size === 2);
    const idOf = (r: Room<any, IslandState>) => [...r.state.players.entries()].find(([, p]) => p.sessionId === r.sessionId)![0];
    const got: unknown[] = [];
    rb.onMessage(VoiceMessages.signal, (m) => got.push(m));
    ra.onMessage(VoiceMessages.signal, () => got.push("không được tới A"));
    ra.send(VoiceMessages.signal, { to: idOf(rb), kind: "offer", sdp: "v=0" });
    // Gói hỏng thì bỏ qua, không làm sập phòng.
    ra.send(VoiceMessages.signal, { to: idOf(rb), kind: "offer", sdp: 42 });
    await until(() => got.length > 0);
    await wait(100);
    expect(got).toEqual([{ from: idOf(ra), kind: "offer", sdp: "v=0" }]);
    await ra.leave();
    await rb.leave();
  });
});
