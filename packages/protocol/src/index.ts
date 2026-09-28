// Hợp đồng mạng giữa client và server: tên phòng, state đồng bộ và các message.
// State ở đây chỉ chứa thứ công khai. Bí mật (vai ẩn, ngăn bí mật, vị trí kho báu)
// sẽ gắn .view() và chỉ gửi cho người được phép thấy qua StateView.

import { schema, t, type SchemaType } from "@colyseus/schema";
import { z } from "zod";

export const ROOM_NAME = "island";
export const MAX_PLAYERS = 6;
export const DEFAULT_SERVER_PORT = 2567;

/** Mã phòng: 4 ký tự, bỏ các ký tự dễ nhầm như O/0, I/1. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

/** Tốc độ chạy tối đa (m/s). Server dùng để loại vị trí bất thường. */
export const MAX_RUN_SPEED = 9;

export const PlayerState = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    rotY: t.float32().default(0),
    moving: t.boolean().default(false),
    connected: t.boolean().default(true),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const IslandState = schema(
  {
    seed: t.uint32().default(0),
    day: t.uint8().default(1),
    players: t.map(PlayerState),
  },
  "IslandState",
);
export type IslandState = SchemaType<typeof IslandState>;

export const JoinOptions = z.object({
  name: z.string().trim().min(1).max(20),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

// zod 4 đã từ chối NaN và Infinity sẵn.
const finite = z.number();

/** Client gửi lên khoảng 15 lần/giây khi đang di chuyển. */
export const MoveMessage = z.object({
  x: finite,
  y: finite,
  z: finite,
  rotY: finite,
  moving: z.boolean(),
});
export type MoveMessage = z.infer<typeof MoveMessage>;

/** Server gửi xuống khi từ chối một vị trí: client phải dịch về đúng chỗ này. */
export interface CorrectMessage {
  x: number;
  y: number;
  z: number;
}

export const Messages = {
  move: "move",
  correct: "correct",
} as const;
