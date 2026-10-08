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
    /** Ống ngắm lắp trên từng khẩu (id trong SIGHTS, rỗng là thước ngắm sắt). */
    sight1: t.string().default(""),
    sight2: t.string().default(""),
    sightP: t.string().default(""),
    /** Phụ kiện khác lắp trên từng khẩu (id trong ATTACHMENTS, cách nhau dấu phẩy): đầu nòng, tay cầm, băng đạn, báng. */
    att1: t.string().default(""),
    att2: t.string().default(""),
    attP: t.string().default(""),
    /** Ô đang cầm: primary1, primary2, pistol, frag, smoke, mine hoặc rỗng (tay không). */
    active: t.string().default(""),
    ammo: t.map("uint16"),
    frag: t.uint8().default(0),
    smoke: t.uint8().default(0),
    flash: t.uint8().default(0),
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

/** Phần trang trí của người chơi có tài khoản, ai cũng thấy. */
export const BadgeState = schema(
  {
    /** Quân hàm 1–30 (RANKS trong content), 0 là khách hay máy (không có quân hàm). Server cập nhật khi được cộng XP. */
    rank: t.uint8().default(0),
    /** Thẻ tên và huy hiệu đang lắp (id trong CALLING_CARDS, EMBLEMS), hiện trên băng rôn "Bạn bị hạ bởi". */
    card: t.string().default(""),
    emblem: t.string().default(""),
  },
  "BadgeState",
);
export type BadgeState = SchemaType<typeof BadgeState>;

/** Lớp lính (chiến trường, đội trưởng chế độ Đồng đội): Đột Kích, Bắn Tỉa, Quân Nhu, Kỹ Thuật. Trùng với content. */
export const SOLDIER_CLASSES = ["assault", "recon", "support", "engineer"] as const;
export type SoldierClassId = (typeof SOLDIER_CLASSES)[number];
/** Khí tài theo lớp lính (trùng với GADGETS trong content). */
export const GADGET_IDS = ["syringe", "m203", "binoculars", "ammobox", "sandbag", "repair", "atmine"] as const;
export type GadgetIdName = (typeof GADGET_IDS)[number];

/**
 * Lớp lính và khí tài của một người (gom một ref: schema PlayerState gần chạm trần số trường). Sinh tồn solo không có
 * lớp lính (rỗng). `n1`, `n2`: số lượt còn lại của khí tài ô 1, ô 2 (khí tài không tính lượt như ống nhòm, mỏ lết thì 0).
 */
export const GearState = schema(
  {
    cls: t.string().default(""),
    n1: t.uint8().default(0),
    n2: t.uint8().default(0),
    /** Bơm Adrenaline: còn bao nhiêu giây chạy nhanh (server cho phép tốc độ cao hơn trong lúc này). */
    boost: t.float32().default(0),
    /** Điểm chiến thuật (chi viện: UAV, mưa pháo, thùng chi viện), giữ qua các lần gục trong trận. */
    tp: t.uint16().default(0),
    /** Đang mặc giáp Juggernaut (chịu đòn gấp ba, đi chậm, vác Minigun); gục là mất. */
    jugg: t.boolean().default(false),
    /** Kỹ Thuật mang tên lửa phòng không IGLA thay RPG-7 (lần hồi sinh tới). */
    aa: t.boolean().default(false),
  },
  "GearState",
);
export type GearState = SchemaType<typeof GearState>;

export const PlayerState = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    /** Phiên kết nối hiện tại, để client nhận ra đâu là mình. Không phải thông tin bí mật. */
    sessionId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    /**
     * Hướng quay (radian). Nén 16 bit trên đường truyền (~0,0055°/bước, 2 byte thay vì 4): đọc ra luôn nằm trong
     * [0, 2π) — so góc thì dùng hiệu đã gói vòng (atan2(sin, cos)), đừng trừ thẳng.
     */
    rotY: t.angle().default(0),
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
    /** Đang nằm sấp (bắn nằm): thấp nhất, khó thấy, khó trúng, đi bò rất chậm. */
    prone: t.boolean().default(false),
    aiming: t.boolean().default(false),
    /** Góc ngắm lên xuống (radian, dương là ngẩng lên), để máy khác thấy nòng súng chĩa đúng hướng. Nén 16 bit trong [−2, 2]. */
    aimPitch: t.quantized({ min: -2, max: 2 }).default(0),
    /** Nghiêng người (Q/E): −1 trái … 1 phải, lượng tử hoá theo 1/8 (thân trên, đầu lệch sang bên; dò đạn trúng theo đó). */
    lean: t.float32().default(0),
    /**
     * Dáng di chuyển nhất thời để máy khác diễn lại (gói gọn một byte): 2 bit thấp là 0 bình thường, 1 đang trượt,
     * 2 đang lao người nằm sấp (dolphin dive); bit 4 là đang ở trên không (nhảy, rơi). Xem `GAIT`.
     */
    gait: t.uint8().default(0),
    /** Bộ đếm phát bắn, để máy khác diễn giật súng, chớp lửa đầu nòng. */
    shots: t.uint16().default(0),
    /** Là máy (bot) do server điều khiển. */
    bot: t.boolean().default(false),
    /** Skin súng đang lắp (id súng → id skin trong SKINS), server nạp từ tài khoản khi vào phòng. Khách thì rỗng. */
    skins: t.map("string"),
    /**
     * Chế độ Đồng đội: đội (id người dẫn đội, hay "ai1", "ai2"... với đội toàn máy), vai trò (leader, rifle, sniper,
     * tanker, support), đang ngồi xe nào (id trong `vehicles`, rỗng là đi bộ). Chế độ solo thì đội rỗng.
     */
    team: t.string().default(""),
    role: t.string().default(""),
    vehicle: t.string().default(""),
    /** Chiến trường: còn bao nhiêu giây nữa được hồi sinh (0 là chọn chỗ được rồi). */
    respawn: t.float32().default(0),
    /** Quân hàm, thẻ tên, huy hiệu (gom một ref cho đỡ tốn chỗ: schema giới hạn số trường). */
    badge: t.ref(BadgeState).default(() => new BadgeState()),
    /** Lớp lính, số lượt khí tài, Adrenaline (GearState). */
    gear: t.ref(GearState).default(() => new GearState()),
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

/**
 * Bẫy đã sập: chỉ lúc này mới công khai chỗ đặt bẫy. Battleground dùng lại map này (IslandState đã chạm trần số
 * trường) cho khí tài đặt xuống đất: hộp tiếp đạn, bờ bao cát (`defId`), hướng, phe, người đặt, độ bền còn lại (%).
 */
export const TrapState = schema(
  {
    defId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
    team: t.string().default(""),
    owner: t.string().default(""),
    hp: t.uint8().default(100),
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
    /** Mảnh lắp ghép (sàn, vách, cầu thang, tháp canh): ở tầng mấy (xem snap.ts của content). */
    level: t.uint8().default(0),
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
    /** Lựu đạn vừa nổ trong khói: khoảng trống quanh (cx, cz) còn bao nhiêu giây (0 là khói kín). */
    clear: t.float32().default(0),
    cx: t.float32().default(0),
    cz: t.float32().default(0),
  },
  "SmokeState",
);
export type SmokeState = SchemaType<typeof SmokeState>;

/** Một chiếc xe tăng: vị trí, hướng thân, hướng tháp pháo (theo thế giới), góc nòng, máu, đội, người lái. */
export const VehicleState = schema(
  {
    kind: t.string().default("tank"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    /** Hướng thân, hướng tháp pháo / súng (radian, nén 16 bit, đọc ra trong [0, 2π) như PlayerState.rotY). */
    rotY: t.angle().default(0),
    turret: t.angle().default(0),
    /** Góc nòng (radian, nén 16 bit trong [−1,6; 1,6]: đủ cho cối ngẩng 85°, số 0 giữ đúng 0). */
    pitch: t.quantized({ min: -1.6, max: 1.6 }).default(0),
    hp: t.int16().default(0),
    team: t.string().default(""),
    /** Người đang lái (và bắn); rỗng là xe bỏ trống. */
    driver: t.string().default(""),
    /** Bộ đếm phát pháo, để máy khác diễn giật nòng, lửa đầu nòng. */
    shots: t.uint16().default(0),
    moving: t.boolean().default(false),
    /**
     * Xe trinh sát, thuyền: người ngồi các ghế khác ghế lái (khoá là số ghế "1"…"4", ghế 0 là `driver`). Xe tăng
     * không dùng. Với xe có đại liên, `turret`/`pitch` là hướng đại liên do xạ thủ xoay.
     */
    seats: t.map("string"),
    /** Xe tăng đứt xích: còn bao nhiêu giây (làm tròn lên) mới chạy lại được; 0 là xích lành. */
    tracks: t.uint8().default(0),
    /** Trực thăng: hướng, góc ngẩng súng cửa phải (ghế 2; súng cửa trái dùng `turret`/`pitch`). */
    turret2: t.float32().default(0),
    pitch2: t.float32().default(0),
    /** Trực thăng: góc chúc mũi (dương là chúc xuống), nghiêng cánh (dương là nghiêng phải). */
    tilt: t.float32().default(0),
    roll: t.float32().default(0),
    /** Trực thăng: rocket mũi, lượt pháo sáng còn lại. */
    rockets: t.uint8().default(0),
    flares: t.uint8().default(0),
    /** Cảnh báo cho tổ lái trực thăng: 0 yên, 1 đang bị ngắm khoá, 2 đã bị khoá, 3 tên lửa đang bay tới. */
    alert: t.uint8().default(0),
  },
  "VehicleState",
);
export type VehicleState = SchemaType<typeof VehicleState>;

/** Một cứ điểm (chiến trường 50 vs 50): phe đang giữ, tiến độ chiếm (−1 đỏ … 1 xanh), số người mỗi phe trong vùng. */
export const FlagState = schema(
  {
    name: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    r: t.float32().default(15),
    owner: t.string().default(""),
    progress: t.float32().default(0),
    blue: t.uint8().default(0),
    red: t.uint8().default(0),
  },
  "FlagState",
);
export type FlagState = SchemaType<typeof FlagState>;

/**
 * Thùng thính (Battleground): rơi bằng dù từ trên cao xuống một chỗ trong vùng an toàn. `y` là độ cao hiện tại của
 * thùng, `ground` là mặt đất chỗ rơi; chạm đất thì `landed`, đồ đổ ra quanh thùng (nằm trong groundItems) và khói
 * đỏ bốc lên trong `smoke` giây. Nằm trong state nên người vào giữa trận cũng thấy.
 */
export const AirdropState = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ground: t.float32().default(0),
    landed: t.boolean().default(false),
    /** Còn bao nhiêu giây nữa chạm đất (lúc đang rơi). */
    fallLeft: t.float32().default(0),
    smoke: t.float32().default(0),
  },
  "AirdropState",
);
export type AirdropState = SchemaType<typeof AirdropState>;

/**
 * Cài đặt phòng Battleground mà chủ phòng chọn ở sảnh (Trung tâm chỉ huy). Gom vào một schema con vì IslandState đã
 * chạm trần 63 trường của Colyseus: cài đặt phòng mới thì thêm vào đây.
 */
export const RoomSettingsState = schema(
  {
    /** Thời tiết, giờ trong ngày cho trận tới ("random" hoặc một kiểu cụ thể). */
    weatherPick: t.string().default("random"),
    timePick: t.string().default("random"),
    /** Chiến trường: vé quân lúc đầu mỗi phe (150–500). */
    warTickets: t.uint16().default(300),
    /** Có xe cơ giới (xe tăng, xe jeep, thuyền...) trong trận không; tắt thì server không đặt xe nào. */
    vehiclesEnabled: t.boolean().default(true),
    /** Chiến trường 50 vs 50: bản đồ chủ phòng chọn (mã trong WAR_MAP_LIST của content; rỗng là bản đồ gốc). */
    warMap: t.string().default("frontier"),
  },
  "RoomSettingsState",
);
export type RoomSettingsState = SchemaType<typeof RoomSettingsState>;

export const IslandState = schema(
  {
    /**
     * Seed của thế giới (đảo nhỏ, hang, hầm mỏ, easter egg, sinh vật). Công khai để mọi máy dựng cùng một bản đồ.
     * Seed của engine luật (vai ẩn, chỗ kho báu, bẫy) thì không bao giờ rời server.
     */
    worldSeed: t.uint32().default(0),
    /** story: chế độ cốt truyện · battle: Battleground. */
    mode: t.string().default("story"),
    /**
     * Battleground: giờ trong ngày (0–1, 0,5 là giữa trưa, 0,9 là giữa đêm), bốc ngẫu nhiên mỗi trận rồi trôi chậm.
     * Thời tiết của trận nằm ở `weather` (sunny, cloudy, rain, fog, storm, snow).
     */
    clock: t.float32().default(0.35),
    /** Lựa chọn của chủ phòng cho trận tới: thời tiết, giờ, vé quân, xe cơ giới (RoomSettingsState). */
    settings: t.ref(RoomSettingsState).default(() => new RoomSettingsState()),
    zone: t.ref(ZoneState).default(() => new ZoneState()),
    feed: t.array(KillState),
    smokes: t.map(SmokeState),
    /** Battleground: thùng thính đang rơi hoặc đã chạm đất trong trận này. */
    airdrops: t.map(AirdropState),
    /**
     * Battleground: khối công trình bị bắn, nổ làm hư (khoá là số thứ tự khối trong bản đồ). 1–254: mức hư (nứt,
     * sạm), 255: đã vỡ / sập (không còn va chạm). Chỉ khối hư mới có mặt, nên người vào giữa trận cũng thấy.
     */
    broken: t.map("uint8"),
    /** Battleground: còn bao nhiêu người sống, số máy (bot) chủ phòng chọn. */
    aliveCount: t.uint8().default(0),
    bots: t.uint8().default(0),
    hostId: t.string().default(""),
    /** Battleground: "solo" (sinh tồn một mình) hay "squad" (mỗi người dẫn 5 máy, đội cuối cùng còn người thắng). */
    battleMode: t.string().default("solo"),
    vehicles: t.map(VehicleState),
    /** Chiến trường: cứ điểm (key là chữ cái A–G), vé quân còn lại của hai phe. */
    flags: t.map(FlagState),
    ticketsBlue: t.uint16().default(0),
    ticketsRed: t.uint16().default(0),
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
  /** Phiên đăng nhập tài khoản (nếu có). Hợp lệ thì server gắn nhân vật vào tài khoản; sai hay hết hạn thì chơi như khách. */
  session: z.string().max(128).optional(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

// zod 4 đã từ chối NaN và Infinity sẵn.
const finite = z.number();
const id = z.string().max(64);

/** Các bit của `PlayerState.gait`: hai bit thấp là kiểu di chuyển (trượt, lao người), bit 4 là đang ở trên không. */
export const GAIT = { slide: 1, dive: 2, kind: 3, air: 4 } as const;

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
  prone: z.boolean().optional(),
  aiming: z.boolean().optional(),
  aimPitch: z.number().min(-2).max(2).optional(),
  /** Nghiêng người (Q trái / E phải), −1..1. */
  lean: z.number().min(-1).max(1).optional(),
  /** Dáng di chuyển nhất thời: trượt, lao người, trên không (xem `GAIT`). */
  gait: z.number().int().min(0).max(7).optional(),
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
/** Dựng công trình; `level` là tầng của mảnh lắp ghép (sàn, vách, cầu thang, tháp canh). */
export const BuildMessage = z.object({ kind: id, x: finite, z: finite, rot: angle, level: z.int().min(0).max(3).optional() });
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
export const SwitchMessage = z.object({ slot: z.enum(["primary1", "primary2", "pistol", "frag", "smoke", "flash", "mine", "gadget1", "gadget2", ""]) });
/**
 * Dùng khí tài lớp lính: bơm tiêm, đặt hộp đạn / bao cát / mìn chống tăng thì chỉ cần `use`; M203 kèm đầu nòng `o`,
 * hướng `d`; ống nhòm kèm `target` (id người, hay "v:<id xe>"); mỏ lết kèm `target` là id xe đang sửa.
 */
export const GadgetMessage = z.object({ use: z.enum(GADGET_IDS), o: vec3.optional(), d: vec3.optional(), target: z.string().max(64).optional() });
export type GadgetMessage = z.infer<typeof GadgetMessage>;
/** Ở sảnh (Đồng đội, Chiến trường): chọn lớp lính cho trận tới. */
export const PickClassMessage = z.object({ cls: z.enum(SOLDIER_CLASSES), aa: z.boolean().optional() });
export const BattleBuyMessage = z.object({ item: z.string().max(40) });
export const BattleThrowMessage = z.object({ kind: z.enum(["frag", "smoke", "flash"]), o: vec3, v: vec3 });
/** Đâm dao: người bị đâm (máy mình dò trước, server kiểm tra lại tầm với, hướng, tường). Không trúng ai thì để trống. */
export const MeleeMessage = z.object({ target: z.string().max(64).optional(), yaw: z.number() });
export const HealMessage = z.object({ kind: z.enum(["bandage", "medkit"]) });
export const BATTLE_WEATHERS = ["sunny", "cloudy", "rain", "fog", "storm", "snow"] as const;
export const BATTLE_TIMES = ["dawn", "day", "dusk", "night"] as const;
/** Số máy (bot) trên sân: ít nhất / nhiều nhất (chiến trường tính theo mỗi phe, tối đa 50 mỗi phe = 100 quân). */
export const MIN_BATTLE_BOTS = 10;
export const MAX_BATTLE_BOTS = 100;
export const WAR_MAX_PER_SIDE = 50;
/** Chiến trường: vé quân lúc đầu mỗi phe (chủ phòng chọn trong khoảng này). */
export const WAR_TICKETS_MIN = 150;
export const WAR_TICKETS_MAX = 500;
export const WAR_TICKETS_DEFAULT = 300;
/**
 * Chủ phòng chỉnh (chỉ ở sảnh): số máy (chiến trường: mỗi phe), thời tiết và giờ trong ngày ("random" là để máy bốc
 * thăm), chế độ, vé quân, bật / tắt xe cơ giới. Khung ở đây chỉ chặn số vô lý; server tự kẹp về khoảng hợp lệ.
 */
export const BattleSettingsMessage = z
  .object({
    bots: z.int().min(0).max(255),
    weather: z.enum(["random", ...BATTLE_WEATHERS]),
    time: z.enum(["random", ...BATTLE_TIMES]),
    mode: z.enum(["solo", "squad", "war"]),
    tickets: z.int().min(0).max(5000),
    vehicles: z.boolean(),
    map: z.string().max(32),
  })
  .partial();
export type BattleSettingsMessage = z.infer<typeof BattleSettingsMessage>;
/** Lái xe tăng: vị trí, hướng thân, hướng tháp pháo, góc nòng (máy người lái tự tính, server kiểm tra tốc độ). */
export const VehicleMoveMessage = z.object({
  x: finite,
  y: finite,
  z: finite,
  rotY: finite,
  turret: finite,
  pitch: z.number().min(-1).max(1),
  moving: z.boolean(),
  /** Trực thăng: góc chúc mũi, nghiêng cánh, tốc độ va chạm máy phi công vừa tính (m/s, 0 là không va chạm). */
  tilt: z.number().min(-1).max(1).optional(),
  roll: z.number().min(-1).max(1).optional(),
  impact: z.number().min(0).max(200).optional(),
});
export type VehicleMoveMessage = z.infer<typeof VehicleMoveMessage>;
/** Bắn pháo xe tăng theo hướng tháp pháo, góc nòng hiện tại. */
export const TankFireMessage = z.object({ turret: finite, pitch: z.number().min(-1).max(1) });
export type TankFireMessage = z.infer<typeof TankFireMessage>;
/** Đổi ghế trên xe đang ngồi (0 là ghế lái). */
export const VehicleSeatMessage = z.object({ seat: z.int().min(0).max(4) });
export type VehicleSeatMessage = z.infer<typeof VehicleSeatMessage>;
/** Xạ thủ đại liên xoay súng (hướng thế giới, góc ngẩng; cối ngẩng tới 85° nên cho tới 1,6 rad). */
export const VehicleAimMessage = z.object({ turret: finite, pitch: z.number().min(-1).max(1.6) });
export type VehicleAimMessage = z.infer<typeof VehicleAimMessage>;
/** Xạ thủ đại liên bắn một phát: đầu nòng, hướng tia, người máy mình thấy trúng (server kiểm tra lại như súng cầm tay). */
export const VehicleGunMessage = z.object({
  o: vec3,
  d: vec3,
  hits: z.array(z.object({ target: id, part: z.enum(["head", "body"]), d: z.number().min(0).max(1000), ray: z.int().min(0).max(0) })).max(1),
});
export type VehicleGunMessage = z.infer<typeof VehicleGunMessage>;
/** Pháo thủ cối bắn một phát: phương vị (thế giới) và góc ngẩng (server kẹp về 45°–85°). */
export const MortarFireMessage = z.object({ turret: finite, elev: z.number().min(0).max(1.6) });
export type MortarFireMessage = z.infer<typeof MortarFireMessage>;
/**
 * Server báo mọi người: cối vừa bắn ("fire": đầu nòng, vận tốc ban đầu — máy khác tự vẽ quả đạn bay cầu vồng) hay
 * đạn cối sắp rơi ("whistle": chỗ rơi dự đoán, còn `t` giây — tiếng rít cho người quanh đó).
 */
export interface MortarFxMessage {
  kind: "fire" | "whistle";
  vid: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}
/** Người cầm IGLA đang giữ tâm ngắm lên trực thăng `vid` (gửi đều đặn ~5 lần / giây khi ngắm khoá). */
export const AaLockMessage = z.object({ vid: id });
export type AaLockMessage = z.infer<typeof AaLockMessage>;
/**
 * Server báo mọi người hiệu ứng trên không: tên lửa vừa phóng / đang bay ("missile": vị trí hiện tại, vị trí trước
 * đó, tốc độ — máy khác vẽ đoạn khói), tên lửa nổ / tắt ("end"), trực thăng thả pháo sáng ("flare": vị trí, vận tốc
 * trực thăng).
 */
export interface AirFxMessage {
  kind: "missile" | "end" | "flare";
  id: string;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  speed: number;
}
/** Server báo mọi người: đạn nảy khỏi giáp trước, xe tăng đứt xích (để vẽ tia lửa, khói, phát tiếng). */
export interface VehicleFxMessage {
  kind: "ricochet" | "tracks";
  vid: string;
  x: number;
  y: number;
  z: number;
}
/** Ra lệnh cho máy trong đội: đi theo mình, giữ chỗ, tới điểm (x, z). */
export const SquadOrderMessage = z.object({ kind: z.enum(["follow", "hold", "move"]), x: finite.optional(), z: finite.optional() });
/**
 * Chiến trường: lệnh cho các máy cùng phe (chọn trên bản đồ lớn): "attack" đánh chiếm vùng tròn (x, z, r), "hold" vào
 * vùng đó nấp giữ, "free" thôi lệnh (máy tự chọn cứ điểm như cũ).
 */
export const WarCommandMessage = z.object({ ids: z.array(id).max(60), kind: z.enum(["attack", "hold", "free"]), x: finite, z: finite, r: finite.optional() });
export type WarCommandMessage = z.infer<typeof WarCommandMessage>;
/** Ra lệnh cho máy lái tăng trong đội lên chiếc xe tăng trống (cùng đội) mình đang nhìn. */
export const SquadBoardMessage = z.object({ vid: id });

// ---------------------------------------------------------------------------- liên lạc trong đội: đánh dấu, bộ đàm

/**
 * Đánh dấu (chuột giữa): bấm nhanh là dấu theo ngữ cảnh: chỗ trống ("spot": di chuyển tới đây), địch (kèm người bị
 * đánh dấu), đồ dưới đất ("loot", kèm khoá món đồ), bấm đúp là nguy hiểm. Giữ chuột giữa mở vòng chọn: tấn công,
 * phòng thủ, đang tới, cần giáp, nhìn thấy địch, cẩn thận.
 */
export const PING_KINDS = ["spot", "enemy", "danger", "loot", "attack", "defend", "coming", "armor", "seen", "careful"] as const;
/** Các ô trên vòng chọn (giữ chuột giữa), theo chiều kim đồng hồ từ trên cùng. */
export const PING_WHEEL = ["attack", "defend", "coming", "armor", "seen", "careful"] as const;
/** Dấu đồ dưới đất: món đồ phải ở gần chỗ đánh dấu chừng này mét. */
export const PING_LOOT_SLACK = 3;
export type PingKind = (typeof PING_KINDS)[number];
/** Dấu hiện trên HUD: ba loại người chơi tự đánh, cộng dấu "spotted" do ống nhòm trinh sát (server tạo, thoi đỏ 15 s). */
export type PingShownKind = PingKind | "spotted";
/** Mỗi người đánh dấu tối đa 1 lần / khoảng này (ms), không xa hơn tầm này (m). */
export const PING_MIN_INTERVAL_MS = 500;
export const PING_MAX_DISTANCE = 450;
/** Dấu tồn tại bao lâu (ms) theo loại. */
export const PING_TTL_MS: Record<PingShownKind, number> = { spot: 8000, enemy: 6000, danger: 8000, spotted: 15000, loot: 12000, attack: 10000, defend: 10000, coming: 8000, armor: 10000, seen: 8000, careful: 8000 };
export const PingMessage = z.object({ kind: z.enum(PING_KINDS), x: finite, y: finite, z: finite, target: id.optional(), item: id.optional() });
export type PingMessage = z.infer<typeof PingMessage>;
/** Server chuyển dấu tới đồng đội (solo thì chỉ mình thấy). Dấu địch: vị trí là chỗ người đó lúc đánh dấu. */
export interface PingBroadcast {
  from: string;
  name: string;
  kind: PingShownKind;
  x: number;
  y: number;
  z: number;
  target: string;
  ttl: number;
  /** Dấu đồ dưới đất: id món đồ (vd. "armor:3"), để hiện "Ở đây có Giáp cấp 3!". */
  item?: string;
}
/** Vòng khẩu lệnh bộ đàm: mã từng câu (chữ hiện trên HUD do client dịch). */
export const RADIO_LINES = ["help", "ammo", "medic", "attack", "defend", "ack", "retreat", "thanks"] as const;
export type RadioLine = (typeof RADIO_LINES)[number];
export const RADIO_MIN_INTERVAL_MS = 1000;
export const RadioMessage = z.object({ line: z.enum(RADIO_LINES) });
export type RadioMessage = z.infer<typeof RadioMessage>;
/** Server chuyển câu bộ đàm tới đồng đội; `flag`: cứ điểm gần người nói (chiến trường, câu tấn công / phòng thủ). */
export interface RadioBroadcast {
  from: string;
  name: string;
  line: RadioLine;
  flag: string;
}
export type SquadOrderMessage = z.infer<typeof SquadOrderMessage>;

// ---------------------------------------------------------------------------- điểm chi viện chiến thuật

/** Gọi chi viện (phím K): UAV, mưa pháo (toạ độ x, z), thùng chi viện (toạ độ, chọn giáp Juggernaut hay TOW). */
export const StreakMessage = z.object({ kind: z.enum(["uav", "artillery", "airdrop"]), x: finite.optional(), z: finite.optional(), pick: z.enum(["jugg", "tow"]).optional() });
export type StreakMessage = z.infer<typeof StreakMessage>;
/** Đang giữ chuột lái tên lửa TOW: mắt (camera) và hướng ngắm, gửi đều đặn trong lúc tên lửa còn bay. */
export const TowSteerMessage = z.object({ o: z.tuple([finite, finite, finite]), d: z.tuple([finite, finite, finite]) });
export type TowSteerMessage = z.infer<typeof TowSteerMessage>;
/**
 * Server báo mọi người một chi viện vừa được gọi: UAV (phe `team` thấy địch trong `t` giây), mưa pháo (chỗ chấm, còn
 * `t` giây tới loạt đầu), loạt pháo sắp rơi ("salvo": các điểm rơi `pts`, còn `t` giây — tiếng rít), thùng chi viện.
 */
export interface StreakFxMessage {
  kind: "uav" | "artillery" | "salvo" | "airdrop";
  team: string;
  name: string;
  x: number;
  y: number;
  z: number;
  t: number;
  pts?: [number, number, number][];
}
/** Server báo riêng: vừa được (hay vừa tiêu, `amount` âm) điểm chiến thuật; `total` là số điểm hiện có. */
export interface PointsMessage {
  kind: string;
  amount: number;
  total: number;
}
/** Chiến trường: hồi sinh ở căn cứ ("hq") hay ở cứ điểm phe mình đang giữ (chữ cái), với lớp lính đã chọn. */
export const RespawnMessage = z.object({ at: z.string().max(8), role: z.enum(["rifle", "sniper", "support", "antitank", "tanker"]) });
export type RespawnMessage = z.infer<typeof RespawnMessage>;
/** Chiến trường (ở sảnh): chọn phe. */
export const PickSideMessage = z.object({ side: z.enum(["blue", "red"]) });
/** Đã gục: nhập vào một máy còn sống trong đội mình (theo id, hay theo ô 1–5 trong đội: xem `squadSlots`). */
export const PossessMessage = z.object({ id: id.optional(), slot: z.int().min(1).max(5).optional() });
export type PossessMessage = z.infer<typeof PossessMessage>;

/** Server báo mọi người: một phát bắn (để vẽ vệt đạn, chớp lửa, phát tiếng). `e` là điểm cuối từng tia. */
export interface ShotMessage {
  id: string;
  w: string;
  o: [number, number, number];
  e: [number, number, number][];
  /** Súng lắp giảm thanh: tiếng nhỏ, nghe gần mới thấy, không loé lửa. */
  s?: 1;
}
/** Server báo riêng người bắn: trúng thân, trúng đầu, hạ gục, trúng giáp. */
export interface HitMessage {
  kind: "body" | "head" | "kill";
  armor: boolean;
  amount: number;
  /** Chỉ có khi `kind` là "kill": phát hạ gục trúng đầu (tiếng chuông kim loại, đầu lâu viền vàng). */
  head?: 1;
  /** Chỉ có khi `kind` là "kill" do phá nổ xe: số người trên xe chết theo (0 = xe trống, không tính mạng). */
  crew?: number;
}
/** Server báo riêng người bị trúng: từ hướng nào, mất bao nhiêu. */
export interface HurtMessage {
  x: number;
  z: number;
  amount: number;
  armor: boolean;
}
/** Nổ: lựu đạn, mìn. Khói: bom khói bung ra. */
/** Battleground: toà nhà sập (tâm chân nhà, bán kính, chiều cao) để vẽ bụi, gạch đổ, rung màn hình. */
export interface CollapseMessage {
  building: number;
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}

export interface BoomMessage {
  kind: "frag" | "mine" | "smoke" | "flash" | "shell";
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
  melee: "melee",
  heal: "heal",
  battleSettings: "battleSettings",
  shot: "shot",
  hit: "hit",
  hurt: "hurt",
  boom: "boom",
  collapse: "collapse",
  /** Server báo riêng: vị trí mìn của chính mình (người khác không thấy). */
  myMines: "myMines",
  /** Server báo mọi người: mìn kêu tích (sắp nổ). */
  mineClick: "mineClick",
  // Chế độ Đồng đội, xe tăng.
  vehicleEnter: "vehicleEnter",
  vehicleExit: "vehicleExit",
  vehicleMove: "vehicleMove",
  tankFire: "tankFire",
  vehicleSeat: "vehicleSeat",
  vehicleAim: "vehicleAim",
  vehicleGun: "vehicleGun",
  vehicleFx: "vehicleFx",
  /** Trực thăng: phi công thả pháo sáng; người cầm IGLA báo đang ngắm khoá; server báo hiệu ứng trên không. */
  heliFlare: "heliFlare",
  aaLock: "aaLock",
  airFx: "airFx",
  /** Vũ khí cố định: pháo thủ cối bắn; server báo hiệu ứng đạn cối. */
  mortarFire: "mortarFire",
  mortarFx: "mortarFx",
  squadOrder: "squadOrder",
  /** Chiến trường: người chơi chọn lính trên bản đồ lớn, giao vùng đánh chiếm / giữ. */
  warCommand: "warCommand",
  possess: "possess",
  squadBoard: "squadBoard",
  /** Đánh dấu chuột giữa, câu bộ đàm: gửi lên server, server chuyển cho đồng đội. */
  ping: "ping",
  radio: "radio",
  respawn: "respawn",
  pickSide: "pickSide",
  /** Server báo mọi người: một phe vừa chiếm được cứ điểm. */
  flag: "flag",
  /** Server báo riêng: vừa được cộng XP (XpMessage). */
  xp: "xp",
  /** Server báo mọi người lúc hết trận: bảng vinh danh MVP và bảng điểm đầy đủ (MatchSummaryMessage). */
  matchSummary: "matchSummary",
  /** Dùng khí tài lớp lính (GadgetMessage); chọn lớp lính ở sảnh (PickClassMessage). */
  gadget: "gadget",
  pickClass: "pickClass",
  /** Điểm chi viện: gọi chi viện (StreakMessage), lái tên lửa TOW (TowSteerMessage), hiệu ứng chi viện, điểm. */
  streak: "streak",
  towSteer: "towSteer",
  streakFx: "streakFx",
  points: "points",
} as const;

/** Một dòng bảng điểm cuối trận. `support` là tiếp tế, sửa xe, hồi sinh đồng đội; `score` để xếp hạng. */
export interface MatchSummaryRow {
  id: string;
  name: string;
  team: string;
  bot: boolean;
  rank: number;
  card: string;
  emblem: string;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  support: number;
  score: number;
}
/** MVP Hạ gục, MVP Chiếm cứ điểm, MVP Hỗ trợ (hỗ trợ = trợ giúp hạ gục + tiếp tế, sửa xe...). */
export type MvpKind = "kills" | "captures" | "support";
export interface MvpEntry {
  kind: MvpKind;
  id: string;
  value: number;
}
/** Hết trận: chế độ, bên thắng (id người, id đội hay phe), MVP từng hạng mục (thiếu là không ai đạt), bảng điểm đã xếp. */
export interface MatchSummaryMessage {
  mode: string;
  winner: string;
  mvp: MvpEntry[];
  rows: MatchSummaryRow[];
}

/** Vừa được cộng XP: loại sự kiện (XpKind trong content), số XP, tổng XP trận này, quân hàm hiện tại. */
export interface XpMessage {
  kind: string;
  amount: number;
  match: number;
  rank: number;
}

/** Mã đóng kết nối khi bị chủ phòng mời ra. */
export const KICKED_CLOSE_CODE = 4001;

export * from "./voice.ts";
export * from "./survival.ts";
