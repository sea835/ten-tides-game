// Hợp đồng mạng giữa client và server: tên phòng, state đồng bộ và các message.
// State ở đây chỉ chứa thứ công khai. Bí mật (vai ẩn, hành động đêm, ngăn bí mật, lời kể riêng)
// đi qua message `private`, server gửi riêng cho đúng từng người; chỗ đào kho báu chỉ vào state khi đã lộ.

import { schema, t, type SchemaType } from "@colyseus/schema";
import { BACKGROUND_IDS, BIO_MAX_LENGTH, DIFFICULTY_IDS, FLAW_IDS, GHOST_ACTION_IDS, GRID_SIZE, NIGHT_ACTION_IDS, RATION_IDS, STAT_MAX, STAT_MIN, type EncounterEffects, type PrivateView } from "@tentides/rules";
import { z } from "zod";

export const ROOM_NAME = "island";
/** Phòng chế độ Battleground (bắn súng sinh tồn, người cuối cùng còn sống thắng). */
export const BATTLE_ROOM_NAME = "battle";
export const MAX_PLAYERS = 6;
export const DEFAULT_SERVER_PORT = 2567;

/** Mã phòng: 4 ký tự, bỏ các ký tự dễ nhầm như O/0, I/1/L. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

/** Tốc độ chạy tối đa (m/s). Server dùng để loại vị trí bất thường. */
export const MAX_RUN_SPEED = 16;
/** Trượt và nhảy thỏ (bunny hop) đẩy tốc độ vượt mức chạy, tối đa gấp chừng này lần. */
export const MAX_SPEED_BOOST = 1.5;

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

/** Hành trang Battleground của một người: tiền, súng ba ô, đạn trong băng, đạn dự trữ, đồ ném, giáp, mũ, đồ hồi máu. */
export const KitState = schema(
  {
    money: t.uint32().default(0),
    primary1: t.string().default(""),
    primary2: t.string().default(""),
    pistol: t.string().default(""),
    mag1: t.uint16().default(0),
    mag2: t.uint16().default(0),
    magP: t.uint16().default(0),
    /** Ô đang cầm: primary1, primary2, pistol, frag, smoke, mine hoặc rỗng (tay không). */
    active: t.string().default(""),
    ammo: t.map("uint16"),
    frag: t.uint8().default(0),
    smoke: t.uint8().default(0),
    mine: t.uint8().default(0),
    bandage: t.uint8().default(0),
    medkit: t.uint8().default(0),
    armor: t.uint8().default(0),
    armorHp: t.uint16().default(0),
    helmet: t.uint8().default(0),
    helmetHp: t.uint16().default(0),
    outfit: t.string().default("woodland"),
    /** Đang thay đạn / đang băng bó (tên đồ hồi máu), để máy khác diễn động tác. */
    reloading: t.boolean().default(false),
    healing: t.string().default(""),
  },
  "KitState",
);
export type KitState = SchemaType<typeof KitState>;

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
    /** Đang bơi hoặc lặn (để vẽ dáng bơi). */
    swimming: t.boolean().default(false),
    /** Hơi thở khi lặn (0–100), server tính từ độ sâu. Hết hơi thì đuối nước, mất Máu. */
    breath: t.uint8().default(100),
    /** Món đang cầm trên tay (id đồ, rỗng là tay không). Ai cũng thấy, như đồ lớn đeo trên lưng. */
    held: t.string().default(""),
    /** Động tác vừa làm (swing, throw, shoot, stab, eat, chop) và bộ đếm, để máy khác diễn lại đúng một lần. */
    act: t.string().default(""),
    actN: t.uint16().default(0),
    /** Hiệu ứng còn lại bao nhiêu giây: choáng (đứng hình), chóng mặt (loạng choạng), mù (tối sầm). */
    stun: t.float32().default(0),
    dizzy: t.float32().default(0),
    blind: t.float32().default(0),
    /** Đang leo cây nào (id cây, rỗng là không leo). */
    climbing: t.string().default(""),
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
    // Battleground.
    kit: t.ref(KitState).default(() => new KitState()),
    kills: t.uint16().default(0),
    crouching: t.boolean().default(false),
    aiming: t.boolean().default(false),
    /** Góc ngắm lên xuống (radian, dương là ngẩng lên), để máy khác thấy nòng súng chĩa đúng hướng. */
    aimPitch: t.float32().default(0),
    /** Bộ đếm phát bắn, để máy khác diễn giật súng, chớp lửa đầu nòng. */
    shots: t.uint16().default(0),
    /** Là máy (bot) do server điều khiển. */
    bot: t.boolean().default(false),
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
    /** encounter: egg, anomaly, trap, creature, friend, drowning */
    source: t.string().default(""),
    /** encounter: id trên bản đồ và id trong danh mục thế giới · twist: biến cố · outside: chuyện đêm · stash: món góp vào kho */
    refId: t.string().default(""),
    defId: t.string().default(""),
    /** encounter: né được bẫy */
    dodged: t.boolean().default(false),
    /** build: công trình vừa dựng */
    building: t.string().default(""),
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
    /** Hồn ma thì thầm gì (chỉ lộ ở màn lật bài). */
    text: t.string().default(""),
  },
  "NightRecordState",
);
export type NightRecordState = SchemaType<typeof NightRecordState>;

/** Danh hiệu cuối ván (vui là chính): ai, danh hiệu gì, vì sao. */
export const AwardState = schema(
  {
    playerId: t.string().default(""),
    title: t.string().default(""),
    detail: t.string().default(""),
  },
  "AwardState",
);
export type AwardState = SchemaType<typeof AwardState>;

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
    awards: t.array(AwardState),
    /** Khảo sát kín từng đêm: ai nghi ai ("" là không nghi ai). */
    suspicions: t.array(NightRecordState),
    /** Khoảnh khắc ⭐: ai đánh dấu, ngay sau dòng nhật ký nào (`target` là chỉ số dòng). */
    stars: t.array(NightRecordState),
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

/** Một sinh vật đang sống trên bản đồ. Server cho đi lại, client chỉ vẽ theo. */
export const CreatureState = schema(
  {
    species: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    rotY: t.float32().default(0),
    /** idle, walk, flee, chase, attack, follow, return, climb, perch */
    mode: t.string().default("idle"),
    /** Máu còn lại (phần trăm). */
    hp: t.uint8().default(100),
    /** Đang choáng: đứng im, sao bay quanh đầu. */
    stunned: t.boolean().default(false),
  },
  "CreatureState",
);
export type CreatureState = SchemaType<typeof CreatureState>;

/** Bẫy đã sập: chỉ lúc này mới công khai chỗ đặt bẫy. */
export const TrapState = schema(
  {
    defId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
  },
  "TrapState",
);
export type TrapState = SchemaType<typeof TrapState>;

/** Một món đồ nằm dưới đất (thả ra, ném đi, rơi từ thú hay từ cây). */
export const GroundItemState = schema(
  {
    itemId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
  },
  "GroundItemState",
);
export type GroundItemState = SchemaType<typeof GroundItemState>;

/** Một món đang bay (bị ném hoặc đạn bắn ra). */
export const ProjectileState = schema(
  {
    itemId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
  },
  "ProjectileState",
);
export type ProjectileState = SchemaType<typeof ProjectileState>;

/** Cây mới trồng: lớn dần theo thời gian (0–1). */
export const PlantState = schema(
  {
    kind: t.string().default("palm"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    growth: t.float32().default(0),
  },
  "PlantState",
);
export type PlantState = SchemaType<typeof PlantState>;

/** Công trình ở trại, đặt tương đối so với lửa trại: dời lửa trại là cả khu nhà dời theo. */
export const BuildingState = schema(
  {
    kind: t.string().default(""),
    dx: t.float32().default(0),
    dz: t.float32().default(0),
    rot: t.float32().default(0),
  },
  "BuildingState",
);
export type BuildingState = SchemaType<typeof BuildingState>;

/** Vùng an toàn của Battleground: vòng hiện tại, vòng kế tiếp, còn bao lâu tới lúc thu hẹp (hay thu xong). */
export const ZoneState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    r: t.float32().default(0),
    nx: t.float32().default(0),
    nz: t.float32().default(0),
    nr: t.float32().default(0),
    stage: t.uint8().default(0),
    shrinking: t.boolean().default(false),
    timeLeft: t.uint16().default(0),
    /** Máu mất mỗi giây khi đứng ngoài vùng. */
    dps: t.float32().default(0),
  },
  "ZoneState",
);
export type ZoneState = SchemaType<typeof ZoneState>;

/** Một dòng bảng hạ gục: ai hạ ai, bằng gì, có trúng đầu không. `killer` rỗng là chết vì vùng độc hay mìn. */
export const KillState = schema(
  {
    killer: t.string().default(""),
    victim: t.string().default(""),
    weapon: t.string().default(""),
    headshot: t.boolean().default(false),
    n: t.uint32().default(0),
  },
  "KillState",
);
export type KillState = SchemaType<typeof KillState>;

/** Một đám khói còn bao nhiêu giây. */
export const SmokeState = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    timeLeft: t.float32().default(0),
  },
  "SmokeState",
);
export type SmokeState = SchemaType<typeof SmokeState>;

export const IslandState = schema(
  {
    /**
     * Seed của thế giới (đảo nhỏ, hang, hầm mỏ, easter egg, sinh vật). Công khai để mọi máy dựng cùng một bản đồ.
     * Seed của engine luật (vai ẩn, chỗ kho báu, bẫy) thì không bao giờ rời server.
     */
    worldSeed: t.uint32().default(0),
    /** story: chế độ cốt truyện · battle: Battleground. */
    mode: t.string().default("story"),
    zone: t.ref(ZoneState).default(() => new ZoneState()),
    feed: t.array(KillState),
    smokes: t.map(SmokeState),
    /** Battleground: còn bao nhiêu người sống, số máy (bot) chủ phòng chọn. */
    aliveCount: t.uint8().default(0),
    bots: t.uint8().default(0),
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
    creatures: t.map(CreatureState),
    /** Bẫy đã sập, theo id trên bản đồ. */
    traps: t.map(TrapState),
    /** Easter egg đã tìm thấy, điểm bất thường đã chạm, bẫy đã sập. */
    discovered: t.array("string"),
    groundItems: t.map(GroundItemState),
    projectiles: t.map(ProjectileState),
    /** Cây của bản đồ đã bị đốn (chỉ còn gốc). */
    stumps: t.array("string"),
    /** Cây mới trồng, theo id. */
    plants: t.map(PlantState),
    /** Lửa trại: về đây trước khi tối. `campPacked`: đang có người vác bộ lửa trại đi dời trại. */
    campX: t.float32().default(0),
    campZ: t.float32().default(80),
    campPacked: t.boolean().default(false),
    buildings: t.map(BuildingState),
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
  swimming: z.boolean().optional(),
  /** Battleground: ngồi xổm, đang ngắm, góc ngắm lên xuống. */
  crouching: z.boolean().optional(),
  aiming: z.boolean().optional(),
  aimPitch: z.number().min(-2).max(2).optional(),
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
    /** Chủ phòng chọn bản đồ: nhập seed để chơi lại một bản đồ hay, hoặc gieo ngẫu nhiên. */
    worldSeed: z.int().min(1).max(0xffffffff),
  })
  .partial();
export type SettingsMessage = z.infer<typeof SettingsMessage>;

export const KickMessage = z.object({ playerId: id });
export const TriggerMessage = z.object({ anchorId: id });
const angle = z.number().min(-100).max(100);
/** Chọn món cầm trên tay (uid trong balo, rỗng là cất tay không). */
export const HoldMessage = z.object({ uid: z.string().max(64) });
/** Đánh (hoặc bắn) theo hướng đang nhìn. */
export const AttackMessage = z.object({ yaw: angle, pitch: angle });
/** Ném món đang cầm theo hướng đang nhìn; `power` 0–1 là lực ném. */
export const ThrowMessage = z.object({ yaw: angle, pitch: angle, power: z.number().min(0).max(1) });
/** Dùng món đang cầm: ăn uống, trồng cây, đặt lửa trại (ở vị trí x, z trước mặt). */
export const UseMessage = z.object({ x: finite, z: finite });
export const PickupMessage = z.object({ id });
/** Leo lên cây (id cây) hoặc tụt xuống (rỗng). */
export const ClimbMessage = z.object({ treeId: z.string().max(64) });
export const BuildMessage = z.object({ kind: id, x: finite, z: finite, rot: angle });
export const AssassinateMessage = z.object({ target: id });

/** Server gửi cho mọi người để vẽ hiệu ứng: trúng đòn, trượt, chặt cây, cây đổ, thú chết, ăn uống... */
export interface FxMessage {
  kind: "hit" | "miss" | "chop" | "fell" | "poof" | "kill" | "eat" | "plant" | "build" | "splash" | "shoot" | "cook" | "page" | "lava" | "burn" | "drown" | "give" | "craft" | "repair";
  x: number;
  y: number;
  z: number;
  /** Tiếng kêu vui hiện lên (BỐP!, PHẬP!...) và số Máu mất. */
  word?: string;
  amount?: number;
  /** Cây đổ theo hướng này (radian), id cây. */
  dir?: number;
  treeId?: string;
}

/** Server gửi riêng cho người bị đánh: bị đẩy lùi theo hướng này. */
export interface KnockMessage {
  dx: number;
  dz: number;
  force: number;
}

/** Nhấn E cạnh easter egg, điểm bất thường hoặc sinh vật thân thiện. */
export const InteractMessage = z.object({ targetId: id });
export type InteractMessage = z.infer<typeof InteractMessage>;
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
export const GhostActionMessage = z.object({ action: z.enum(GHOST_ACTION_IDS), target: id.optional(), text: z.string().max(200).optional() });
/** Khảo sát kín: đêm nay nghi ai (null là không nghi ai). */
export const SuspectMessage = z.object({ target: id.nullable() });
/** Trao món đang cầm cho người đứng cạnh. */
export const GiveMessage = z.object({ target: id });
/** Chế tạo một món theo công thức (id món muốn làm ra). */
export const CraftMessage = z.object({ itemId: id });

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

/** Server báo riêng cho người vừa chạm trán: tìm thấy gì, bị gì, kèm lời kể ngắn. */
export interface EncounterMessage {
  title: string;
  text: string;
  tone: "good" | "bad" | "neutral";
  effects: EncounterEffects;
  gained: string | null;
}

/** Bán kính nhấn E để xem xét một điểm bí mật hoặc vuốt ve sinh vật thân thiện. */
export const INTERACT_RADIUS = 3;

/** Server báo khi từ chối một hành động (vd. đứng quá xa điểm sự kiện). */
export interface RejectedMessage {
  reason: string;
}

// ---------------------------------------------------------------------------- Battleground

const vec3 = z.tuple([finite, finite, finite]);
/**
 * Bắn một phát: gốc tia (đầu nòng), các tia (shotgun nhiều tia), và những gì client thấy trúng (người nào, phần nào,
 * ở khoảng cách bao xa). Server kiểm tra lại (tốc độ bắn, đạn, vị trí, tường chắn) rồi mới tính sát thương.
 */
export const FireMessage = z.object({
  weapon: id,
  o: vec3,
  rays: z.array(vec3).min(1).max(12),
  hits: z.array(z.object({ target: id, part: z.enum(["head", "body"]), d: z.number().min(0).max(1000), ray: z.int().min(0).max(11) })).max(12),
});
export type FireMessage = z.infer<typeof FireMessage>;
export const SwitchMessage = z.object({ slot: z.enum(["primary1", "primary2", "pistol", "frag", "smoke", "mine", ""]) });
export const BattleBuyMessage = z.object({ item: z.string().max(40) });
export const BattleThrowMessage = z.object({ kind: z.enum(["frag", "smoke"]), o: vec3, v: vec3 });
export const HealMessage = z.object({ kind: z.enum(["bandage", "medkit"]) });
export const BattleSettingsMessage = z.object({ bots: z.int().min(0).max(12) }).partial();

/** Server báo mọi người: một phát bắn (để vẽ vệt đạn, chớp lửa, phát tiếng). `e` là điểm cuối từng tia. */
export interface ShotMessage {
  id: string;
  w: string;
  o: [number, number, number];
  e: [number, number, number][];
}
/** Server báo riêng người bắn: trúng thân, trúng đầu, hạ gục, trúng giáp. */
export interface HitMessage {
  kind: "body" | "head" | "kill";
  armor: boolean;
  amount: number;
}
/** Server báo riêng người bị trúng: từ hướng nào, mất bao nhiêu. */
export interface HurtMessage {
  x: number;
  z: number;
  amount: number;
  armor: boolean;
}
/** Nổ: lựu đạn, mìn. Khói: bom khói bung ra. */
export interface BoomMessage {
  kind: "frag" | "mine" | "smoke";
  x: number;
  y: number;
  z: number;
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
  interact: "interact",
  encounter: "encounter",
  hold: "hold",
  attack: "attack",
  throw: "throw",
  drop: "drop",
  use: "use",
  pickup: "pickup",
  climb: "climb",
  packCamp: "packCamp",
  /** Nướng hoặc góp vào kho món đang cầm, khi đứng cạnh lửa trại. */
  campfire: "campfire",
  give: "give",
  craft: "craft",
  ghostAction: "ghostAction",
  suspect: "suspect",
  star: "star",
  /** Server báo đã ghi khoảnh khắc ⭐ (kèm số khoảnh khắc mình đã đánh dấu). */
  starred: "starred",
  build: "build",
  assassinate: "assassinate",
  fx: "fx",
  knock: "knock",
  private: "private",
  chat: "chat",
  rejected: "rejected",
  // Battleground.
  fire: "fire",
  reload: "reload",
  switchSlot: "switchSlot",
  battleBuy: "battleBuy",
  battleThrow: "battleThrow",
  placeMine: "placeMine",
  heal: "heal",
  battleSettings: "battleSettings",
  shot: "shot",
  hit: "hit",
  hurt: "hurt",
  boom: "boom",
  /** Server báo riêng: vị trí mìn của chính mình (người khác không thấy). */
  myMines: "myMines",
  /** Server báo mọi người: mìn kêu tích (sắp nổ). */
  mineClick: "mineClick",
} as const;

/** Mã đóng kết nối khi bị chủ phòng mời ra. */
export const KICKED_CLOSE_CODE = 4001;
