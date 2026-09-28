import { Client, type Room } from "@colyseus/sdk";
import { DEFAULT_SERVER_PORT, IslandState, ROOM_NAME } from "@tentides/protocol";

export type IslandRoom = Room<any, IslandState>;

const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${DEFAULT_SERVER_PORT}`;

const client = new Client(SERVER_URL);

/** Chờ tới khi state đầu tiên về, để biết điểm xuất phát của mình. */
function whenReady(room: IslandRoom): Promise<IslandRoom> {
  return new Promise((resolve) => {
    if (room.state?.players?.has(room.sessionId)) return resolve(room);
    const check = () => {
      if (room.state.players.has(room.sessionId)) {
        room.onStateChange.remove(check);
        resolve(room);
      }
    };
    room.onStateChange(check);
  });
}

export async function createRoom(name: string): Promise<IslandRoom> {
  return whenReady(await client.create(ROOM_NAME, { name }, IslandState));
}

export async function joinRoom(code: string, name: string): Promise<IslandRoom> {
  return whenReady(await client.joinById(code.trim().toUpperCase(), { name }, IslandState));
}

export function describeJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|invalid/i.test(message)) return "Không tìm thấy phòng với mã này.";
  if (/full|locked/i.test(message)) return "Phòng đã đủ người.";
  if (/too_small|too_big/i.test(message)) return "Tên phải từ 1 đến 20 ký tự.";
  if (/connect|network|fetch/i.test(message)) return "Không kết nối được tới server. Server đã chạy chưa?";
  return message;
}
