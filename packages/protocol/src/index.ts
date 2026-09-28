// Hợp đồng mạng giữa client và server: tên phòng, state đồng bộ và các message.
// State ở đây chỉ chứa thứ công khai. Bí mật (vai ẩn, hành động đêm, ngăn bí mật, lời kể riêng)
// đi qua message `private`, server gửi riêng cho đúng từng người; chỗ đào kho báu chỉ vào state khi đã lộ.

import { schema, t, type SchemaType } from "@colyseus/schema";
import { BACKGROUND_IDS, BIO_MAX_LENGTH, DIFFICULTY_IDS, FLAW_IDS, GRID_SIZE, NIGHT_ACTION_IDS, RATION_IDS, STAT_MAX, STAT_MIN, type PrivateView } from "@tentides/rules";
import { z } from "zod";

export const ROOM_NAME = "island";
export const MAX_PLAYERS = 6;
export const DEFAULT_SERVER_PORT = 2567;

/** Mã phòng: 4 ký tự, bỏ các ký tự dễ nhầm như O/0, I/1/L. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

/** Tốc độ chạy tối đa (m/s). Server dùng để loại vị trí bất thường. */
export const MAX_RUN_SPEED = 16;

/** Thời lượng mỗi pha (giây), theo PROJECT.md. Server có thể co giãn bằng biến PHASE_SCALE khi dev. */
export const PHASE_SECONDS = {
  create: 120,
  pack: 240,
  dawn: 30,
  explore: 180,
  dusk: 30,
  night: 60,
} as const;
export type TimedPhase = keyof typeof PHASE_SECONDS;

/** Màu áo người chơi chọn được lúc tạo nhân vật (mỗi người một màu). */
export const PLAYER_COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#8a4fff", "#2a9d8f", "#d1495b", "#6a994e"] as const;

/** Chủ phòng chọn độ dài đêm: nhóm chat bằng chữ cần lâu hơn nhóm có voice call ngoài game. */
export const NIGHT_SECONDS_OPTIONS = [60, 90, 120] as const;

/** Một sự kiện đang mở mà không ai chọn thì server tự chọn lựa chọn đầu sau chừng này giây. */
export const EVENT_TIMEOUT_SECONDS = 40;

/** Mọi người đều bấm sẵn sàng thì pha hiện tại chỉ còn chừng này giây. */
export const READY_WRAP_UP_SECONDS = 3;

export const PlayerState = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    /** Phiên kết nối hiện tại, để client nhận ra đâu là mình. Không phải thông tin bí mật. */
    sessionId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    rotY: t.float32().default(0),
    moving: t.boolean().default(false),
    /** Đang ngồi (nghỉ, hoặc nấp trong cỏ cao). */
    sitting: t.boolean().default(false),
    connected: t.boolean().default(true),
    // Phiếu nhân vật, chép từ engine luật sau mỗi hành động.
    background: t.string().default(""),
    flaw: t.string().default(""),
    bio: t.string().default(""),
    created: t.boolean().default(false),
    /** Mang quá sức: đi chậm hơn. */
    overweight: t.boolean().default(false),
    stats: t.map("uint8"),
    hp: t.int16().default(0),
    maxHp: t.int16().default(0),
    hunger: t.uint8().default(0),
    morale: t.uint8().default(0),
    stamina: t.uint8().default(0),
    /** Đồ đồng đội nhìn thấy được (không gồm ngăn bí mật). Balo đầy đủ chỉ gửi riêng cho chủ nhân. */
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

/** Một hậu quả trong báo cáo sự cố buổi sáng (không kèm nguyên nhân). */
export const EffectState = schema(
  {
    type: t.string().default(""),
    amount: t.int16().default(0),
    playerId: t.string().default(""),
    itemId: t.string().default(""),
  },
  "EffectState",
);
export type EffectState = SchemaType<typeof EffectState>;

/** Nhật ký công khai: mọi lần tung xúc xắc, tổng kết hoàng hôn và đêm, sự cố, cái chết, rời đảo. */
export const LogEntryState = schema(
  {
    kind: t.string().default(""),
    day: t.uint8().default(0),
    /** check: người mở thẻ · night: người bị trói · death: người chết */
    playerId: t.string().default(""),
    /** check: người tham gia · dusk: người ngủ ngoài · night: người đồng ý trói · departure: người lên thuyền */
    players: t.array("string"),
    /** night: người không đồng ý trói · departure: người bị bỏ lại */
    others: t.array("string"),
    /** incident: các hậu quả của đêm qua */
    effects: t.array(EffectState),
    /** night: người đói lả */
    starving: t.array("string"),
    anchorId: t.string().default(""),
    cardId: t.string().default(""),
    choiceId: t.string().default(""),
    roll: t.uint8().default(0),
    modifiers: t.array(ModifierState),
    total: t.int16().default(0),
    dc: t.uint8().default(0),
    /** check: qua hay không · departure: có mang kho báu theo không */
    success: t.boolean().default(false),
    /** check thất bại: những món mà nếu có thì đã qua */
    wouldPassWith: t.array("string"),
    /** check: mặt xúc xắc lần đầu nếu Tay cờ bạc được tung lại (0 = không tung lại) */
    rerolledFrom: t.uint8().default(0),
    /** check: kẻ hậu đậu làm rơi món này */
    dropped: t.string().default(""),
    /** check: thuốc súng cạnh diêm phát nổ */
    exploded: t.boolean().default(false),
    /** night: số khẩu phần đã ăn · departure: độ bền thuyền */
    amount: t.int16().default(0),
    /** night: cách chia lương thực */
    ration: t.string().default(""),
    /** night: người bị đề cử trói */
    nominee: t.string().default(""),
  },
  "LogEntryState",
);
export type LogEntryState = SchemaType<typeof LogEntryState>;

/**
 * Phiếu trói đêm nay. Phiếu kín: trước khi lật chỉ biết ai đã bỏ phiếu, không biết bỏ gì.
 * Engine giữ phiếu thật; server chỉ chép sang đây sau khi lật.
 */
export const TieBallotState = schema(
  {
    nominator: t.string().default(""),
    nominee: t.string().default(""),
    cast: t.array("string"),
    revealed: t.boolean().default(false),
    yes: t.array("string"),
    no: t.array("string"),
  },
  "TieBallotState",
);
export type TieBallotState = SchemaType<typeof TieBallotState>;

/** Một hành động đêm, chỉ công khai ở màn lật bài cuối ván. */
export const NightRecordState = schema(
  {
    day: t.uint8().default(0),
    playerId: t.string().default(""),
    action: t.string().default(""),
    target: t.string().default(""),
  },
  "NightRecordState",
);
export type NightRecordState = SchemaType<typeof NightRecordState>;

export const LootState = schema(
  {
    playerId: t.string().default(""),
    itemId: t.string().default(""),
  },
  "LootState",
);

/** Màn lật bài: rỗng cho tới khi ván kết thúc. */
export const RevealState = schema(
  {
    roles: t.map("string"),
    nights: t.array(NightRecordState),
    loot: t.array(LootState),
    signals: t.uint8().default(0),
    deceit: t.uint8().default(0),
    tied: t.array("string"),
  },
  "RevealState",
);
export type RevealState = SchemaType<typeof RevealState>;

/** Một đoạn kể chuyện công khai (bình minh hoặc hoàng hôn), do bộ sinh truyện viết từ sự thật trong ván. */
export const StoryLineState = schema(
  {
    day: t.uint8().default(0),
    kind: t.string().default(""),
    text: t.string().default(""),
  },
  "StoryLineState",
);
export type StoryLineState = SchemaType<typeof StoryLineState>;

/** Biên niên sử cuối ván. */
export const ChronicleState = schema(
  {
    title: t.string().default(""),
    paragraphs: t.array("string"),
  },
  "ChronicleState",
);
export type ChronicleState = SchemaType<typeof ChronicleState>;

export const IslandState = schema(
  {
    seed: t.uint32().default(0),
    hostId: t.string().default(""),
    difficulty: t.string().default("normal"),
    nightSeconds: t.uint16().default(PHASE_SECONDS.night),
    /** Thời lượng hoàng hôn của phòng, để client tính còn bao lâu tới lúc tối. */
    duskSeconds: t.uint16().default(PHASE_SECONDS.dusk),
    paused: t.boolean().default(false),
    phase: t.string().default("lobby"),
    day: t.uint8().default(0),
    /** Giây còn lại của pha hiện tại và tổng thời lượng pha, cho đồng hồ mặt trời. */
    timeLeft: t.uint16().default(0),
    phaseDuration: t.uint16().default(0),
    /** Bao nhiêu người đã bấm sẵn sàng trong pha hiện tại. Chỉ công khai con số, không công khai là ai. */
    readyCount: t.uint8().default(0),
    readyNeeded: t.uint8().default(0),
    weather: t.string().default(""),
    volcano: t.uint8().default(0),
    food: t.int16().default(0),
    treasure: t.uint8().default(0),
    hull: t.uint8().default(100),
    ending: t.string().default(""),
    winner: t.string().default(""),
    soloWinner: t.string().default(""),
    /** Chỗ đào kho báu: rỗng cho tới khi tiến độ đủ. */
    treasureSite: t.string().default(""),
    treasureDug: t.boolean().default(false),
    treasureCarrier: t.string().default(""),
    treasureSafe: t.boolean().default(false),
    players: t.map(PlayerState),
    anchors: t.map(AnchorState),
    sceneStates: t.map("string"),
    /** Cửa hàng của ván này. */
    shop: t.array("string"),
    /** Người ngồi quanh đống lửa đêm nay. */
    campers: t.array("string"),
    /** Lương thực không đủ chia đều thì phải bầu cách chia. */
    rationNeeded: t.boolean().default(false),
    /** Phiếu chia khẩu phần là phiếu công khai: người ở trại → cách chia. */
    rations: t.map("string"),
    tie: t.ref(TieBallotState).default(() => new TieBallotState()),
    log: t.array(LogEntryState),
    reveal: t.ref(RevealState).default(() => new RevealState()),
    story: t.array(StoryLineState),
    chronicle: t.ref(ChronicleState).default(() => new ChronicleState()),
  },
  "IslandState",
);
export type IslandState = SchemaType<typeof IslandState>;

export const JoinOptions = z.object({
  name: z.string().trim().min(1).max(20),
  /** Token bí mật của người chơi, lưu ở trình duyệt, để vào lại đúng nhân vật sau khi rớt mạng hay tải lại trang. */
  token: z.string().min(16).max(64),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

// zod 4 đã từ chối NaN và Infinity sẵn.
const finite = z.number();
const id = z.string().max(64);

/** Client gửi lên khoảng 15 lần/giây khi đang di chuyển. */
export const MoveMessage = z.object({
  x: finite,
  y: finite,
  z: finite,
  rotY: finite,
  moving: z.boolean(),
  sitting: z.boolean(),
});
export type MoveMessage = z.infer<typeof MoveMessage>;

/** Server gửi xuống khi từ chối một vị trí: client phải dịch về đúng chỗ này. */
export interface CorrectMessage {
  x: number;
  y: number;
  z: number;
}

export const SettingsMessage = z
  .object({
    difficulty: z.enum(DIFFICULTY_IDS),
    nightSeconds: z.literal([...NIGHT_SECONDS_OPTIONS]),
  })
  .partial();
export type SettingsMessage = z.infer<typeof SettingsMessage>;

export const KickMessage = z.object({ playerId: id });
export const TriggerMessage = z.object({ anchorId: id });
export type TriggerMessage = z.infer<typeof TriggerMessage>;
export const ChooseMessage = z.object({ anchorId: id, choiceId: id });
export type ChooseMessage = z.infer<typeof ChooseMessage>;
export const RationMessage = z.object({ choice: z.enum(RATION_IDS) });
export const NominateMessage = z.object({ target: id });
export const BallotMessage = z.object({ tie: z.boolean() });
const stat = z.int().min(STAT_MIN).max(STAT_MAX);
export const CreateCharacterMessage = z.object({
  stats: z.object({ strength: stat, dexterity: stat, intellect: stat, charisma: stat, nerve: stat }),
  background: z.enum(BACKGROUND_IDS),
  flaw: z.enum(FLAW_IDS),
  /** Dòng tự mô tả: dữ liệu người chơi nhập, chỉ để kể chuyện. */
  bio: z.string().max(BIO_MAX_LENGTH * 2),
  color: z.enum(PLAYER_COLORS),
});
export type CreateCharacterMessage = z.infer<typeof CreateCharacterMessage>;
export const BuyMessage = z.object({ itemId: id });
export const SellMessage = z.object({ uid: id });
const cell = z.int().min(0).max(GRID_SIZE - 1);
export const PlaceMessage = z.object({ uid: id, x: cell, y: cell, rot: z.union([z.literal(0), z.literal(1)]) });
export type PlaceMessage = z.infer<typeof PlaceMessage>;
export const UnplaceMessage = z.object({ uid: id });

export const NightActionMessage = z.object({ action: z.enum(NIGHT_ACTION_IDS), target: id.optional() });

/** Thông tin riêng server gửi cho đúng một người: vai, hành động đêm, ghi chú, balo, lời kể riêng. */
export type PrivateMessage = PrivateView & { story: { day: number; text: string }[] };

export const CHAT_MAX_LENGTH = 200;
/** Khoảng cách tối thiểu giữa hai tin nhắn của một người (ms). */
export const CHAT_MIN_INTERVAL_MS = 700;

/** Tin nhắn chat là dữ liệu người chơi nhập: cắt khoảng trắng, giới hạn độ dài. */
export const ChatMessage = z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) });
export type ChatMessage = z.infer<typeof ChatMessage>;

/** room: sảnh chờ · camp: quanh đống lửa · ghost: hồn ma nói với nhau. */
export type ChatChannel = "room" | "camp" | "ghost";

/** Server chuyển tin nhắn tới đúng những người được nghe. */
export interface ChatBroadcast {
  from: string;
  name: string;
  text: string;
  channel: ChatChannel;
}

/** Server báo khi từ chối một hành động (vd. đứng quá xa điểm sự kiện). */
export interface RejectedMessage {
  reason: string;
}

export const Messages = {
  move: "move",
  correct: "correct",
  settings: "settings",
  createCharacter: "createCharacter",
  buy: "buy",
  sell: "sell",
  place: "place",
  unplace: "unplace",
  kick: "kick",
  start: "start",
  pause: "pause",
  ready: "ready",
  trigger: "trigger",
  choose: "choose",
  ration: "ration",
  nominate: "nominate",
  ballot: "ballot",
  nightAction: "nightAction",
  dig: "dig",
  private: "private",
  chat: "chat",
  rejected: "rejected",
} as const;

/** Mã đóng kết nối khi bị chủ phòng mời ra. */
export const KICKED_CLOSE_CODE = 4001;
