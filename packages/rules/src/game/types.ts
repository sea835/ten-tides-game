import type { AnchorDef, EventCard, ItemDef, OutsideEvent } from "../cards.ts";
import type { CheckResult } from "../dice.ts";
import type { RngState } from "../rng.ts";
import type { Stats } from "../stats.ts";
import type { WeatherId } from "../weather.ts";
import type { Placement, Rotation, TrayItem } from "./backpack.ts";
import type { BackgroundId, CharacterChoice, FlawId } from "./character.ts";

export const TOTAL_DAYS = 10;
/** Mỗi món có thẻ "food" mang theo được đổi thành chừng này khẩu phần cho kho chung khi lên đảo. */
export const RATIONS_PER_FOOD_ITEM = 1;
/** Mang quá tải thì mỗi đêm đói thêm chừng này. */
export const OVERWEIGHT_HUNGER = 10;
export const MAX_CARDS_PER_DAY = 6;
/** Trượt liên tiếp chừng này lần thì được "Quyết tâm +1", gấp đôi số đó thì +2. */
export const FAIL_STREAK_BONUS = 2;
/** Thẻ có lựa chọn được cộng điểm nhờ món đồ đội đang mang thì dễ được chia ra hơn chừng này lần. */
export const ITEM_CARD_WEIGHT = 2;
/** Mỗi người giữ chừng này dòng nhật ký chỉ số gần nhất. */
export const STAT_LOG_SIZE = 40;
export const DAILY_HUNGER = 25;
/** Ngủ ngoài trại không có lều thì mất chừng này Tinh thần, rồi còn gặp chuyện trong đêm. */
export const OUTSIDE_MORALE = 8;
/** Một khẩu phần hồi chừng này điểm No. */
export const MEAL_HUNGER = 25;
export const STARVING_DAMAGE = 15;

export const DIFFICULTIES = {
  easy: { dcOffset: -2, foodPerPlayer: 3 },
  normal: { dcOffset: 0, foodPerPlayer: 2 },
  hard: { dcOffset: 2, foodPerPlayer: 1 },
} as const;
export type Difficulty = keyof typeof DIFFICULTIES;
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as Difficulty[];

/** Cách chia khi lương thực không đủ mỗi người một phần. Đủ thì luôn chia đều, khỏi bầu. */
export const RATION_IDS = ["normal", "half", "skip"] as const;
export type RationId = (typeof RATION_IDS)[number];

export type Phase = "lobby" | "create" | "pack" | "dawn" | "explore" | "dusk" | "night" | "ended";

export const ENDING_IDS = [
  "treasure_home",
  "bloody_treasure",
  "traitor_exposed",
  "sole_survivor",
  "empty_handed",
  "buried",
  "pirates_win",
  "sold_out",
] as const;
export type EndingId = (typeof ENDING_IDS)[number];
/** Ai thắng: phe đội, một người duy nhất, phe phản bội, hoặc không ai. */
export type Winner = "team" | "solo" | "traitor" | "none";

// ---------- Vai ẩn ----------

export const ROLE_IDS = ["villager", "nurse", "pirate", "con"] as const;
export type RoleId = (typeof ROLE_IDS)[number];
export const TRAITOR_ROLES: readonly RoleId[] = ["pirate", "con"];
export function isTraitor(role: RoleId): boolean {
  return TRAITOR_ROLES.includes(role);
}

/** Vai ẩn chỉ có từ chừng này người. */
export const MIN_PLAYERS_FOR_ROLES = 4;
/** Xác suất ván có kẻ phản bội theo số người (kiểu Shadows over Camelot); không ai biết ván này có hay không. */
export const TRAITOR_CHANCE: Record<number, number> = { 4: 0.5, 5: 0.6, 6: 0.7 };
export const NURSE_CHANCE = 0.5;

/** Hành động đêm bí mật. Ai cũng có một hành động để thời điểm bấm nút không tố cáo kẻ phản bội. */
export const NIGHT_ACTION_IDS = ["repair", "sleep", "guard", "search", "protect", "sabotage", "signal", "forge", "pocket"] as const;
export type NightActionId = (typeof NIGHT_ACTION_IDS)[number];
export const ROLE_NIGHT_ACTIONS: Record<RoleId, readonly NightActionId[]> = {
  villager: ["repair", "sleep", "guard", "search"],
  nurse: ["repair", "sleep", "guard", "search", "protect"],
  pirate: ["repair", "sleep", "guard", "search", "sabotage", "signal"],
  con: ["repair", "sleep", "guard", "search", "forge", "pocket"],
};
/** Hành động đêm cần chọn một người khác đang ngồi quanh đống lửa. */
export const TARGETED_NIGHT_ACTIONS: readonly NightActionId[] = ["protect", "search"];
/** Lục soát balo người khác: mệt và áy náy, mất chừng này Tinh thần. */
export const SEARCH_MORALE_COST = 5;

/** Hồn ma mỗi đêm được làm một việc nhỏ: thì thầm vào giấc mơ, làm ai đó lạnh gáy, hay dẫn lối manh mối. */
export const GHOST_ACTION_IDS = ["whisper", "chill", "guide"] as const;
export type GhostActionId = (typeof GHOST_ACTION_IDS)[number];
export const GHOST_WHISPER_MAX = 80;
export const GHOST_CHILL_MORALE = 6;
export const GHOST_GUIDE_TREASURE = 2;
/** Mỗi người đánh dấu tối đa chừng này khoảnh khắc trong một ván. */
export const MAX_STARS = 12;
/** Hành động đêm có hại, dùng để biết đêm nay kẻ phản bội có ra tay không. */
export const TRAITOR_ACTIONS: readonly NightActionId[] = ["sabotage", "signal", "forge", "pocket"];

export const REPAIR_PER_PLAYER = 6;
export const SLEEP_MORALE = 10;
export const GUARD_MORALE_COST = 5;
export const GUARD_DC = 12;
export const SABOTAGE_DAMAGE = 20;
/** Có người canh gác thì phá hoại chỉ gây chừng này thiệt hại. */
export const SABOTAGE_GUARDED = 10;
export const FORGE_DAMAGE = 10;
/** Cướp biển gửi đủ chừng này tín hiệu thì băng cướp tìm tới và chiếm thuyền lúc rời đảo. */
export const SIGNALS_TO_WIN = 4;
/** Kẻ lừa đảo gom đủ chừng này lần lừa thì dụ được cả đoàn tới vịnh giao dịch. */
export const DECEIT_TO_WIN = 7;
/** Mỗi đêm có chừng này xác suất xảy ra một sự cố tự nhiên, trông giống hệt phá hoại. */
export const INCIDENT_CHANCE = 0.35;
/** Tín hiệu của cướp biển đôi khi để lại dấu vết mà cả trại thấy. */
export const SIGNAL_SEEN_CHANCE = 0.25;

/** Đủ chỗ ngủ có mái che cho mọi người quanh đống lửa thì ai cũng thêm chừng này Tinh thần mỗi đêm. */
export const SHELTER_MORALE = 5;

// ---------- Kho báu & thuyền ----------

/** Tiến độ kho báu đạt mức này thì biết chính xác chỗ đào. */
export const TREASURE_REVEAL = 100;
/** Thuyền phải bền ít nhất chừng này mới rời đảo được. */
export const HULL_TO_SAIL = 40;
/** Cần xẻng để đào kho báu. */
export const DIG_ITEM = "shovel";

export interface PlayerSheet {
  id: string;
  name: string;
  stats: Stats;
  hp: number;
  maxHp: number;
  /** No: 100 là no căng, 0 là kiệt sức. */
  hunger: number;
  morale: number;
  /** Sức bền tối đa trong ngày (0–100): giới hạn thanh chạy nhanh trên client. Hồi đầy mỗi sáng. */
  stamina: number;
  items: string[];
  alive: boolean;
  /** Lạc đường tới hoàng hôn: không mở được thẻ sự kiện nào nữa trong ngày. */
  lost: boolean;
  /** Bị cả trại trói: ở yên trong trại, không mở được sự kiện, không có năng lực ban đêm. Hết đêm hôm sau mới được thả. */
  tied: boolean;
  role: RoleId;
  /** Y tá che chở: nếu lẽ ra gục thì còn lại 1 Máu. Kéo dài tới hết đêm sau. */
  protected: boolean;
  /** Đồ kẻ lừa đảo bỏ túi, giấu riêng, chỉ lộ ở màn lật bài. */
  loot: string[];

  background: BackgroundId;
  flaw: FlawId;
  /** Dòng tự mô tả: chỉ là dữ liệu cho bộ kể chuyện, không bao giờ ảnh hưởng luật. */
  bio: string;
  /** Đã tự tạo nhân vật (chưa thì hết giờ sẽ được tạo ngẫu nhiên). */
  created: boolean;
  budget: number;
  /** Đồ trong balo và vị trí trên lưới. `items` là danh sách id tương ứng, dùng cho luật. */
  bag: Placement[];
  /** Đồ đã mua nhưng chưa xếp vào balo; hết giờ xếp mà còn trong khay thì bỏ lại trên tàu. */
  tray: TrayItem[];
  /** Tay cờ bạc đã dùng lượt tung lại của hôm nay chưa. */
  rerolledToday: boolean;
  /** Số lần trượt liên tiếp ở thẻ sự kiện; đủ nhiều thì được cộng "Quyết tâm" (bù xui công khai). */
  failStreak: number;
}

/** Một lần chỉ số của một người thay đổi, và vì sao (mã lý do, client dịch ra lời). */
export interface StatChange {
  day: number;
  /** Mã lý do: "card:<id>", "encounter:<nguồn>:<id>", "eat:<món>", "night", "dusk", "twist"... */
  reason: string;
  hp?: number;
  hunger?: number;
  morale?: number;
  stamina?: number;
}

export interface GhostChoice {
  action: GhostActionId;
  target?: string;
  /** Lời thì thầm (chỉ với "whisper"), đã cắt ngắn. */
  text?: string;
}

export interface NightChoice {
  action: NightActionId;
  target?: string;
}

/** Hậu quả công khai của một đêm, không kèm nguyên nhân: phá hoại và sự cố tự nhiên trông y hệt nhau. */
export type IncidentEffect =
  | { type: "hull"; amount: number }
  | { type: "food"; amount: number }
  | { type: "treasure"; amount: number }
  | { type: "itemMissing"; playerId: string; itemId: string }
  | { type: "strangeLight" }
  | { type: "repair"; amount: number }
  | { type: "rescued"; playerId: string };

/** Ghi chú riêng chỉ người đó thấy (vd. điều người canh gác nhìn thấy). */
export interface Clue {
  day: number;
  text: string;
}

/** Bỏ phiếu trói: một người đề cử, mọi người bỏ phiếu kín, rồi lật cùng lúc. */
export interface TieBallot {
  by: string;
  target: string;
  /** true = đồng ý trói. Phiếu đã bỏ thì không đổi được. */
  votes: Record<string, boolean>;
  revealed: boolean;
}

export interface NightVotes {
  ration: Record<string, RationId>;
  tie: TieBallot | null;
}

// ---------- Chạm trán ngoài bản đồ ----------

/**
 * Hệ quả của một lần chạm trán ngoài thẻ sự kiện: nhặt easter egg, chạm điểm bất thường, sập bẫy,
 * bị sinh vật tấn công, vuốt ve sinh vật thân thiện, đuối nước. Chỉ số cá nhân áp cho người gặp;
 * lương thực và kho báu áp cho cả đội.
 */
export interface EncounterEffects {
  hp?: number;
  morale?: number;
  hunger?: number;
  stamina?: number;
  food?: number;
  treasure?: number;
  gainItem?: string;
}

export const ENCOUNTER_SOURCES = ["egg", "anomaly", "trap", "creature", "friend", "drowning", "attack", "fall", "hunt", "page", "lava", "burn"] as const;
export type EncounterSource = (typeof ENCOUNTER_SOURCES)[number];
/** Giới hạn mỗi hệ quả của một lần chạm trán, phòng server tính nhầm. */
export const ENCOUNTER_EFFECT_LIMIT = 60;

export type AnchorStatus = "open" | "active" | "resolved";

export interface PlacedCard {
  anchorId: string;
  cardId: string;
  status: AnchorStatus;
  participants: string[];
}

export type LogEntry =
  | {
      kind: "check";
      day: number;
      playerId: string;
      participants: string[];
      anchorId: string;
      cardId: string;
      choiceId: string;
      result: CheckResult;
      /** Khi thất bại: những món đồ mà nếu người chọn mang theo thì đã qua. */
      wouldPassWith: string[];
      /** Kẻ hậu đậu làm rơi món này khi thua. */
      dropped: string | null;
      /** Thuốc súng cạnh diêm phát nổ khi thua. */
      exploded: boolean;
    }
  | { kind: "dusk"; day: number; sleptOutside: string[] }
  | {
      kind: "night";
      day: number;
      ration: RationId;
      ate: number;
      starving: string[];
      nominee: string | null;
      yes: string[];
      no: string[];
      tied: string | null;
    }
  | { kind: "death"; day: number; playerId: string }
  | { kind: "incident"; day: number; effects: IncidentEffect[] }
  | { kind: "dig"; day: number; playerId: string }
  | {
      kind: "encounter";
      day: number;
      playerId: string;
      source: EncounterSource;
      /** Id của thứ cụ thể trên bản đồ (vd. "poi3", "trap7", "c12"). */
      refId: string;
      /** Id trong danh mục (vd. "shipwreck", "wild_boar"), để kể chuyện. */
      defId: string;
      effects: EncounterEffects;
      /** Món nhặt được (null nếu balo đầy hoặc không có). */
      gained: string | null;
      /** Né được bẫy: không chịu hệ quả nào. */
      dodged: boolean;
    }
  | { kind: "departure"; day: number; aboard: string[]; leftBehind: string[]; hull: number; withTreasure: boolean }
  | { kind: "build"; day: number; playerId: string; building: string }
  /** Biến cố lớn của ngày 5; `playerId` là người bị cuốn vào (nếu có). */
  | { kind: "twist"; day: number; twist: string; playerId: string | null }
  /** Một người ngủ ngoài trại gặp chuyện trong đêm. */
  | { kind: "outside"; day: number; playerId: string; event: string; result: CheckResult }
  /** Trao tay một món cho người khác. */
  | { kind: "give"; day: number; playerId: string; target: string; itemId: string }
  /** Góp đồ ăn kiếm được vào kho lương thực chung. */
  | { kind: "stash"; day: number; playerId: string; itemId: string; amount: number }
  /** Chế tạo một món từ nguyên liệu trong balo. */
  | { kind: "craft"; day: number; playerId: string; itemId: string }
  /** Đóng ván vá thuyền ở lửa trại. */
  | { kind: "repair"; day: number; playerId: string; itemId: string; amount: number };

export interface GameState {
  seed: number;
  rng: RngState;
  difficulty: Difficulty;
  phase: Phase;
  day: number;
  weather: WeatherId[];
  /** Mức hoạt động núi lửa 0–100; tới 100 thì phun trào. */
  volcano: number;
  food: number;
  treasure: number;
  hull: number;
  flags: string[];
  players: Record<string, PlayerSheet>;
  playerOrder: string[];
  /** Thẻ đã đặt lên map trong ngày hiện tại, theo id điểm sự kiện. */
  anchors: Record<string, PlacedCard>;
  sceneStates: Record<string, string>;
  /** Những người ngồi quanh đống lửa đêm nay: chỉ họ được chat và bỏ phiếu. */
  campers: string[];
  votes: NightVotes;
  usedCards: string[];
  log: LogEntry[];
  ending: EndingId | null;
  winner: Winner | null;
  /** Người thắng một mình (kết thúc "Kẻ sống sót duy nhất"). */
  soloWinner: string | null;

  // Vai ẩn và hành động đêm: chỉ server biết, lộ ở màn lật bài.
  nightChoices: Record<string, NightChoice>;
  nightHistory: { day: number; playerId: string; action: NightActionId; target?: string }[];
  clues: Record<string, Clue[]>;
  signals: number;
  deceit: number;
  tieHistory: { day: number; playerId: string }[];

  /** Easter egg đã tìm thấy, điểm bất thường đã chạm, bẫy đã sập (theo id trên bản đồ). */
  discovered: string[];
  /** Kẻ phản bội kết liễu ai, ngày nào. Bí mật: chỉ lộ ở màn lật bài. */
  kills: { day: number; by: string; target: string }[];
  /** Số chỗ ngủ có mái che ở trại (chòi, nhà sàn đã dựng). */
  shelter: number;
  /** Việc hồn ma chọn đêm nay và các đêm trước (lộ ở màn lật bài). */
  ghostChoices: Record<string, GhostChoice>;
  ghostHistory: ({ day: number; playerId: string } & GhostChoice)[];
  /** Khảo sát kín mỗi đêm: ai nghi ai (null là không nghi ai). Chỉ lộ ở màn lật bài. */
  suspicions: { day: number; playerId: string; target: string | null }[];
  /** Khoảnh khắc người chơi đánh dấu ⭐: lúc nào, ngay sau dòng nhật ký nào. */
  stars: { day: number; phase: Phase; playerId: string; logIndex: number }[];
  /** Nhật ký thay đổi chỉ số của từng người (chỉ gửi riêng cho người đó), giữ vài chục dòng gần nhất. */
  statLog: Record<string, StatChange[]>;
  /** Biến cố ngày 5, chọn từ lúc bắt đầu ván và giữ bí mật tới khi xảy ra; `twistPlayer` là người bị cuốn vào. */
  twist: string;
  twistPlayer: string | null;

  /** Cửa hàng của ván này (một bộ đồ ngẫu nhiên theo seed). */
  shop: string[];
  /** Bộ đếm để cấp id cho từng món đồ đã mua. */
  nextUid: number;

  // Kho báu: vị trí bí mật cho tới khi tiến độ đủ.
  treasureSite: string;
  treasureDug: boolean;
  /** Người đang vác rương; về tới trại lúc hoàng hôn thì rương an toàn. */
  treasureCarrier: string | null;
  treasureSafe: boolean;
}

export interface GameConfig {
  cards: readonly EventCard[];
  anchors: readonly AnchorDef[];
  items: readonly ItemDef[];
  /** Các chỗ kho báu có thể nằm; mỗi ván chọn một theo seed. */
  treasureSites: readonly { id: string }[];
  /** Chuyện có thể xảy ra với người ngủ ngoài trại. */
  outsideEvents?: readonly OutsideEvent[];
  /** Ghi đè xác suất sự cố tự nhiên mỗi đêm (unit test đặt 0 để kết quả không phụ thuộc may rủi). */
  incidentChance?: number;
}

export type GameAction =
  | { type: "join"; playerId: string; name: string }
  | { type: "leave"; playerId: string }
  | { type: "start"; difficulty?: Difficulty }
  | ({ type: "createCharacter"; playerId: string } & CharacterChoice)
  | { type: "buy"; playerId: string; itemId: string }
  | { type: "sell"; playerId: string; uid: string }
  | { type: "place"; playerId: string; uid: string; x: number; y: number; rot: Rotation }
  | { type: "unplace"; playerId: string; uid: string }
  /** Sang pha kế tiếp. Khi rời hoàng hôn, server cho biết ai đang ở trong trại. */
  | { type: "advance"; atCamp?: string[] }
  /** Server đã kiểm tra khoảng cách; participants là những người đứng tại điểm đó. */
  | { type: "trigger"; playerId: string; anchorId: string; participants: string[] }
  | { type: "choose"; playerId: string; anchorId: string; choiceId: string }
  | { type: "ration"; playerId: string; choice: RationId }
  | { type: "nominate"; playerId: string; target: string }
  | { type: "ballot"; playerId: string; tie: boolean }
  /** Server lật phiếu sớm khi những người còn kết nối đã bỏ phiếu hết. */
  | { type: "revealBallot" }
  | { type: "nightAction"; playerId: string; action: NightActionId; target?: string }
  /** Hồn ma chọn việc làm đêm nay. */
  | { type: "ghostAction"; playerId: string; action: GhostActionId; target?: string; text?: string }
  /** Khảo sát kín: đêm nay mình nghi ai (null là không nghi ai). */
  | { type: "suspect"; playerId: string; target: string | null }
  /** Đánh dấu ⭐ khoảnh khắc vừa xảy ra, để xem lại ở màn lật bài. */
  | { type: "star"; playerId: string }
  /** Server đã kiểm tra người đào đứng đúng chỗ. */
  | { type: "dig"; playerId: string }
  /**
   * Server đã kiểm tra vị trí và tính hệ quả từ danh mục thế giới. `once`: thứ chỉ dùng được một lần
   * trong ván (easter egg, điểm bất thường, bẫy), engine từ chối nếu đã có người dùng.
   */
  /** Thả (đặt xuống đất hoặc ném đi) một món trong balo. Server lo chỗ món đó rơi xuống. */
  | { type: "drop"; playerId: string; uid: string }
  /** Nhặt một món dưới đất (hoặc rơi ra từ thú, cây) vào balo; balo đầy thì không nhặt được. */
  | { type: "pickup"; playerId: string; itemId: string }
  /** Ăn, uống hoặc dùng ngay một món có tác dụng. */
  | { type: "consume"; playerId: string; uid: string }
  /** Kẻ phản bội kết liễu một người đứng sát bên, mỗi ngày một lần. Server đã kiểm tra khoảng cách. */
  | { type: "assassinate"; playerId: string; target: string }
  /** Dựng công trình ở trại: tiêu vật liệu trong balo, thêm chỗ ngủ có mái che. */
  | { type: "build"; playerId: string; building: string; cost: Record<string, number>; shelter: number }
  /** Trao tay một món cho người đứng cạnh. Server đã kiểm tra khoảng cách. */
  | { type: "give"; playerId: string; target: string; uid: string }
  /** Góp một món ăn được vào kho lương thực chung. Server đã kiểm tra người đó đứng ở lửa trại. */
  | { type: "stash"; playerId: string; uid: string }
  /** Nướng một món trên lửa trại (thịt sống thành thịt nướng...). Server đã kiểm tra đứng ở lửa trại. */
  | { type: "cook"; playerId: string; uid: string }
  /** `atFire`: server xác nhận người chơi đang đứng cạnh lửa trại (công thức cần lửa). */
  | { type: "craft"; playerId: string; itemId: string; atFire?: boolean }
  | { type: "repair"; playerId: string; uid: string }
  | {
      type: "encounter";
      playerId: string;
      source: EncounterSource;
      refId: string;
      defId: string;
      effects: EncounterEffects;
      once?: boolean;
      dodged?: boolean;
      /** Chết ngay tại chỗ (nhảy vào dung nham): không ai che chở được. */
      fatal?: boolean;
    };

export class RuleError extends Error {
  override name = "RuleError";
}

export function fail(message: string): never {
  throw new RuleError(message);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isOver(state: GameState): boolean {
  return state.phase === "ended";
}

export function actOf(day: number): 1 | 2 | 3 {
  if (day <= 3) return 1;
  if (day <= 7) return 2;
  return 3;
}

export function weatherOf(state: GameState): WeatherId | undefined {
  return state.weather[state.day - 1];
}
