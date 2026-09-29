import { Client, type Room } from "@colyseus/sdk";
import { BATTLE_ROOM_NAME, DEFAULT_SERVER_PORT, IslandState, KICKED_CLOSE_CODE, ROOM_NAME } from "@tentides/protocol";
import { listenPrivate } from "./game/privateStore.ts";

export type IslandRoom = Room<any, IslandState>;

const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${DEFAULT_SERVER_PORT}`;

const client = new Client(SERVER_URL);

const TOKEN_KEY = "tentides.token";
const LAST_ROOM_KEY = "tentides.lastRoom";

function storage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Token bí mật của người chơi. Lưu theo tab (sessionStorage): tải lại trang vẫn vào lại đúng nhân vật,
 * còn mở hai tab để thử thì là hai người khác nhau.
 */
function playerToken(): string {
  const store = storage();
  let token = store?.getItem(TOKEN_KEY);
  if (!token) {
    // getRandomValues chạy cả khi mở qua http://<IP LAN>, còn randomUUID thì chỉ chạy trên https/localhost.
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    store?.setItem(TOKEN_KEY, token);
  }
  return token;
}

/** Phòng gần nhất tab này đã vào, để tải lại trang thì mời vào lại. */
export function lastRoom(): string | null {
  return storage()?.getItem(LAST_ROOM_KEY) ?? null;
}

export function forgetLastRoom() {
  storage()?.removeItem(LAST_ROOM_KEY);
}

/** Id người chơi của mình trong phòng: người có phiên kết nối trùng với phiên của tab này. */
export function myId(room: IslandRoom): string {
  for (const [id, p] of room.state.players) if (p.sessionId === room.sessionId) return id;
  return "";
}

/** Chờ tới khi state có nhân vật của mình, để biết điểm xuất phát. */
function whenReady(room: IslandRoom): Promise<IslandRoom> {
  storage()?.setItem(LAST_ROOM_KEY, room.roomId);
  // Nghe thông tin riêng ngay từ lúc vào phòng: server gửi vai ngay khi mình vừa vào, trước khi HUD kịp hiện.
  listenPrivate(room);
  return new Promise((resolve) => {
    if (room.state?.players && myId(room)) return resolve(room);
    const check = () => {
      if (myId(room)) {
        room.onStateChange.remove(check);
        resolve(room);
      }
    };
    room.onStateChange(check);
  });
}

export async function createRoom(name: string): Promise<IslandRoom> {
  return whenReady(await client.create(ROOM_NAME, { name, token: playerToken() }, IslandState));
}

/** Tạo phòng Battleground (mã phòng dùng chung ô "Vào phòng" như phòng thường). */
export async function createBattleRoom(name: string): Promise<IslandRoom> {
  return whenReady(await client.create(BATTLE_ROOM_NAME, { name, token: playerToken() }, IslandState));
}

export async function joinRoom(code: string, name: string): Promise<IslandRoom> {
  return whenReady(await client.joinById(code.trim().toUpperCase(), { name, token: playerToken() }, IslandState));
}

export function wasKicked(code: number): boolean {
  return code === KICKED_CLOSE_CODE;
}

export function describeJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|invalid/i.test(message)) return "Không tìm thấy phòng với mã này.";
  if (/full|locked/i.test(message)) return "Phòng đã đủ người hoặc ván đã bắt đầu.";
  if (/too_small|too_big/i.test(message)) return "Tên phải từ 1 đến 20 ký tự.";
  if (/connect|network|fetch/i.test(message)) return "Không kết nối được tới server. Server đã chạy chưa?";
  return message;
}
