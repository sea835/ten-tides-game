import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineRoom, defineServer, matchMaker, type Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { BATTLE_ROOM_NAME, IslandState, MAX_PLAYERS, Messages, type PublicRoomInfo } from "@tentides/protocol";
import { BattleRoom } from "./battle/BattleRoom.ts";
import { LISTING_SYNC_MS, listPublicRooms, pickQuickRoom, publicRooms, quickPlayMode } from "./rooms.ts";

const room = (code: string, over: Partial<PublicRoomInfo> = {}): PublicRoomInfo => ({ code, mode: "war", map: "frontier", humans: 1, max: MAX_PLAYERS, phase: "lobby", host: "An", ...over });

describe("Chơi nhanh: chọn phòng", () => {
  it("không có phòng hợp thì null (tạo phòng mới)", () => {
    expect(pickQuickRoom([], "war")).toBeNull();
    expect(pickQuickRoom([room("AAAA", { mode: "naval" })], "war")).toBeNull();
    expect(pickQuickRoom([room("AAAA", { humans: MAX_PLAYERS })], "war")).toBeNull();
  });

  it("ưu tiên phòng ở sảnh, rồi phòng đông người nhất, cùng hạng thì theo mã", () => {
    const rooms = [room("BBBB", { humans: 2 }), room("CCCC", { humans: 4 }), room("DDDD", { humans: 5, phase: "battle" }), room("AAAA", { humans: 4 })];
    expect(pickQuickRoom(rooms, "war")).toBe("AAAA");
    expect(pickQuickRoom(rooms.filter((r) => r.phase !== "lobby"), "war")).toBe("DDDD");
  });

  it("chiến trường vào giữa trận được (có hồi sinh), chế độ khác chỉ nhận phòng ở sảnh", () => {
    expect(pickQuickRoom([room("AAAA", { phase: "battle" })], "war")).toBe("AAAA");
    expect(pickQuickRoom([room("AAAA", { phase: "prep" })], "war")).toBe("AAAA");
    expect(pickQuickRoom([room("AAAA", { phase: "ended" })], "war")).toBeNull();
    for (const mode of ["naval", "squad", "solo"]) {
      expect(pickQuickRoom([room("AAAA", { mode, phase: "battle" })], mode)).toBeNull();
      expect(pickQuickRoom([room("AAAA", { mode, phase: "lobby" })], mode)).toBe("AAAA");
    }
  });

  it("danh sách: chỉ phòng công khai của Battleground, phòng khoá coi như đầy, sảnh lên trước", () => {
    const list = publicRooms([
      { roomId: "PRIV", name: BATTLE_ROOM_NAME, metadata: { public: false, mode: "war", humans: 1, max: 6, phase: "lobby" } },
      { roomId: "NOMD", name: BATTLE_ROOM_NAME },
      { roomId: "ISLE", name: "island", metadata: { public: true, mode: "war", humans: 1, max: 6, phase: "lobby" } },
      { roomId: "BATL", name: BATTLE_ROOM_NAME, metadata: { public: true, mode: "war", humans: 3, max: 6, phase: "battle" } },
      { roomId: "LOBY", name: BATTLE_ROOM_NAME, metadata: { public: true, mode: "naval", humans: 1, max: 6, phase: "lobby", host: "Bình" } },
      { roomId: "FULL", name: BATTLE_ROOM_NAME, locked: true, metadata: { public: true, mode: "war", humans: 4, max: 6, phase: "lobby" } },
    ]);
    expect(list.map((r) => r.code)).toEqual(["FULL", "LOBY", "BATL"]);
    expect(list[0]!.humans).toBe(6);
    expect(list[1]).toEqual({ code: "LOBY", mode: "naval", map: "", humans: 1, max: 6, phase: "lobby", host: "Bình" });
    expect(pickQuickRoom(list, "war")).toBe("BATL");
  });

  it("tham số tạo phòng Chơi nhanh", () => {
    expect(quickPlayMode({ quick: "naval" })).toBe("naval");
    expect(quickPlayMode({ quick: "story" })).toBeNull();
    expect(quickPlayMode(undefined)).toBeNull();
    expect(quickPlayMode({ name: "An" })).toBeNull();
  });
});

// Server Colyseus thật trong tiến trình test: phòng Chơi nhanh tự công khai, hiện trong danh sách; phòng tạo bằng mã
// thì riêng tư cho tới khi chủ phòng bật "Phòng công khai".
const PORT = 33_000 + Math.floor(Math.random() * 2000);
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
async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const t0 = Date.now();
  while (!(await check())) {
    if (Date.now() - t0 > ms) throw new Error("hết giờ chờ");
    await wait(50);
  }
}

describe("danh sách phòng công khai trên server thật", () => {
  it("phòng Chơi nhanh công khai đúng chế độ; phòng mã riêng tư, bật công khai thì hiện", async () => {
    const client = new Client(`ws://localhost:${PORT}`);
    const quick: Room<any, IslandState> = await client.create(BATTLE_ROOM_NAME, { name: "An", token: token(11), quick: "naval" }, IslandState);
    const priv: Room<any, IslandState> = await client.create(BATTLE_ROOM_NAME, { name: "Bình", token: token(12) }, IslandState);
    await until(() => !!quick.state.players?.size && !!priv.state.players?.size);
    expect(quick.state.battleMode).toBe("naval");
    expect(quick.state.settings.publicRoom).toBe(true);
    expect(priv.state.settings.publicRoom).toBe(false);

    await until(async () => (await listPublicRooms()).some((r) => r.code === quick.roomId && r.humans === 1 && r.host === "An"), LISTING_SYNC_MS * 3);
    let list = await listPublicRooms();
    expect(list.find((r) => r.code === quick.roomId)).toMatchObject({ mode: "naval", phase: "lobby", max: MAX_PLAYERS });
    expect(list.some((r) => r.code === priv.roomId)).toBe(false);
    expect(pickQuickRoom(list, "naval")).toBe(quick.roomId);

    // Chủ phòng bật công khai.
    priv.send(Messages.battleSettings, { public: true, mode: "war" });
    await until(async () => (await listPublicRooms()).some((r) => r.code === priv.roomId && r.mode === "war"), LISTING_SYNC_MS * 3);
    list = await listPublicRooms();
    expect(pickQuickRoom(list, "war")).toBe(priv.roomId);
    expect(matchMaker.getLocalRoomById(priv.roomId)).toBeTruthy();

    await quick.leave();
    await priv.leave();
  });
});
