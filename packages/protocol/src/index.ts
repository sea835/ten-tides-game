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

/** Thời lượng mỗi pha (giây), theo PROJECT.md. Server có thể co giãn bằng biến PHASE_SCALE khi dev. */
export const PHASE_SECONDS = {
  dawn: 30,
  explore: 180,
  dusk: 30,
  night: 60,
} as const;
export type TimedPhase = keyof typeof PHASE_SECONDS;

/** Một sự kiện đang mở mà không ai chọn thì server tự chọn lựa chọn đầu sau chừng này giây. */
export const EVENT_TIMEOUT_SECONDS = 40;

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
    // Phiếu nhân vật, chép từ engine luật sau mỗi hành động.
    stats: t.map("uint8"),
    hp: t.int16().default(0),
    maxHp: t.int16().default(0),
    hunger: t.uint8().default(0),
    morale: t.uint8().default(0),
    stamina: t.uint8().default(0),
    items: t.array("string"),
    alive: t.boolean().default(true),
    lost: t.boolean().default(false),
    tied: t.boolean().default(false),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** Thẻ đang nằm ở một điểm sự kiện trong ngày. Key của map là id điểm. */
export const AnchorState = schema(
  {
    cardId: t.string().default(""),
    status: t.string().default("open"),
    participants: t.array("string"),
    /** Còn bao nhiêu giây trước khi server tự chọn thay (khi status = active). */
    timeLeft: t.uint8().default(0),
  },
  "AnchorState",
);
export type AnchorState = SchemaType<typeof AnchorState>;

export const ModifierState = schema(
  {
    label: t.string().default(""),
    value: t.int8().default(0),
  },
  "ModifierState",
);
export type ModifierState = SchemaType<typeof ModifierState>;

/** Phiếu của một người quanh đống lửa. Bỏ phiếu công khai: ai cũng thấy ai chọn gì. */
export const VoteState = schema(
  {
    ration: t.string().default(""),
    tie: t.string().default(""),
  },
  "VoteState",
);
export type VoteState = SchemaType<typeof VoteState>;

/** Nhật ký công khai: mọi lần tung xúc xắc, tổng kết hoàng hôn và đêm, cái chết. */
export const LogEntryState = schema(
  {
    kind: t.string().default(""),
    day: t.uint8().default(0),
    /** check: người mở thẻ · night: người bị trói · death: người chết */
    playerId: t.string().default(""),
    /** check: người tham gia · dusk: người ngủ ngoài */
    players: t.array("string"),
    /** night: người đói lả */
    starving: t.array("string"),
    anchorId: t.string().default(""),
    cardId: t.string().default(""),
    choiceId: t.string().default(""),
    roll: t.uint8().default(0),
    modifiers: t.array(ModifierState),
    total: t.int16().default(0),
    dc: t.uint8().default(0),
    success: t.boolean().default(false),
    /** night: số khẩu phần đã ăn */
    amount: t.int16().default(0),
    /** night: cách chia lương thực đã chọn */
    ration: t.string().default(""),
  },
  "LogEntryState",
);
export type LogEntryState = SchemaType<typeof LogEntryState>;

export const IslandState = schema(
  {
    seed: t.uint32().default(0),
    hostId: t.string().default(""),
    phase: t.string().default("lobby"),
    day: t.uint8().default(0),
    /** Giây còn lại của pha hiện tại và tổng thời lượng pha, cho đồng hồ mặt trời. */
    timeLeft: t.uint16().default(0),
    phaseDuration: t.uint16().default(0),
    weather: t.string().default(""),
    volcano: t.uint8().default(0),
    food: t.int16().default(0),
    treasure: t.uint8().default(0),
    hull: t.uint8().default(100),
    ending: t.string().default(""),
    players: t.map(PlayerState),
    anchors: t.map(AnchorState),
    sceneStates: t.map("string"),
    /** Người ngồi quanh đống lửa đêm nay và phiếu của họ. */
    campers: t.array("string"),
    votes: t.map(VoteState),
    log: t.array(LogEntryState),
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

export const TriggerMessage = z.object({ anchorId: z.string().max(64) });
export type TriggerMessage = z.infer<typeof TriggerMessage>;

export const ChooseMessage = z.object({ anchorId: z.string().max(64), choiceId: z.string().max(64) });
export type ChooseMessage = z.infer<typeof ChooseMessage>;

export const VoteMessage = z.discriminatedUnion("ballot", [
  z.object({ ballot: z.literal("ration"), choice: z.enum(["full", "normal", "half", "skip"]) }),
  z.object({ ballot: z.literal("tie"), choice: z.string().max(64) }),
]);
export type VoteMessage = z.infer<typeof VoteMessage>;

export const CHAT_MAX_LENGTH = 200;
/** Khoảng cách tối thiểu giữa hai tin nhắn của một người (ms). */
export const CHAT_MIN_INTERVAL_MS = 700;

/** Tin nhắn chat là dữ liệu người chơi nhập: cắt khoảng trắng, giới hạn độ dài. */
export const ChatMessage = z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Server chuyển tin nhắn tới đúng những người được nghe. */
export interface ChatBroadcast {
  from: string;
  name: string;
  text: string;
}

/** Server báo khi từ chối một hành động (vd. đứng quá xa điểm sự kiện). */
export interface RejectedMessage {
  reason: string;
}

export const Messages = {
  move: "move",
  correct: "correct",
  start: "start",
  trigger: "trigger",
  choose: "choose",
  vote: "vote",
  chat: "chat",
  rejected: "rejected",
} as const;
