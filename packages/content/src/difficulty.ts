// Độ khó của máy (bot) do chủ phòng chọn ở Trung tâm chỉ huy: một bảng hệ số duy nhất cho cả bộ binh (bots.ts) và
// pháo thủ hải chiến (naval.ts). Mọi con số chỉnh độ khó nằm ở đây, server chỉ nhân theo.
//
// Mốc chỉnh (đánh tay đôi với một khẩu súng trường ở 20 m, người chơi không giáp):
// - "Khó" giữ nguyên cách bắn cũ của máy (trước khi có bảng này): thấy là sau 0,8–1,5 s nổ súng, trúng chừng 36% mỗi
//   phát, hạ người trong khoảng 1,5 s kể từ phát đầu.
// - "Thường" (mặc định) nhẹ tay hơn một chút: người mới vào không bị bắn gục trước khi kịp quay lại.
// - "Dễ": phản ứng chậm gấp rưỡi, trúng chưa tới một nửa so với "Khó", nghỉ lâu giữa các loạt: hạ người mất 6–7 s, người
//   mới bắn trả trúng 1/3 số phát là thắng phần lớn các trận tay đôi.
// - "Cựu binh": phản ứng nửa giây, trúng nhiều hơn 30%, hay bắn vào đầu, nhìn xa hơn, ném lựu đạn dày: lộ ra giữa
//   trống là gục, phải dùng địa hình, khói, đồng đội.

export const BOT_DIFFICULTIES = ["easy", "normal", "hard", "veteran"] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export const DEFAULT_DIFFICULTY: BotDifficulty = "normal";

export const DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: "Dễ",
  normal: "Thường",
  hard: "Khó",
  veteran: "Cựu binh",
};

/** Mô tả ngắn hiện dưới nút chọn độ khó. */
export const DIFFICULTY_BRIEF: Record<BotDifficulty, string> = {
  easy: "Máy phản ứng chậm, bắn trượt nhiều: hợp người mới tập bắn.",
  normal: "Máy bắn vừa phải, cho thời gian quay lại đáp trả.",
  hard: "Máy nhanh tay, trúng nhiều: phải nấp và bắn trước.",
  veteran: "Máy phản ứng tức thì, hay trúng đầu, ném lựu đạn dày: lộ ra là gục.",
};

/** Hệ số của một mức độ khó. "Khó" là mốc 1 (cách máy bắn trước đây). */
export interface DifficultyTuning {
  /** Nhân vào xác suất trúng mỗi phát (sau khi tính khoảng cách, tư thế). */
  hit: number;
  /** Trần xác suất trúng mỗi phát của súng thường / súng bắn tỉa. */
  cap: number;
  capSniper: number;
  /** Nhân vào tỉ lệ phát trúng là trúng đầu. */
  head: number;
  /** Nhân vào thời gian phản ứng: từ lúc thấy (hay bị bắn) tới phát đầu tiên. */
  react: number;
  /** Nhân vào số phát mỗi loạt (kỷ luật bắn loạt: số nhỏ là loạt ngắn). */
  burst: number;
  /** Nhân vào thời gian nghỉ giữa hai loạt. */
  pause: number;
  /** Nhân vào thời gian chờ giữa hai quả lựu đạn (số lớn là ít ném). */
  nade: number;
  /** Nhân vào độ lệch khi ném lựu đạn, bắn RPG, độ toả của phát trượt (số lớn là trượt xa). */
  spread: number;
  /** Nhân vào tầm nhìn phát hiện địch. */
  sight: number;
  /** Nhân vào sai số ngắm của pháo thủ máy ở hải chiến (BOT_EASE của naval.ts; "Thường" là 1). */
  naval: number;
}

export const DIFFICULTY: Record<BotDifficulty, DifficultyTuning> = {
  easy: { hit: 0.45, cap: 0.22, capSniper: 0.3, head: 0.5, react: 1.7, burst: 0.8, pause: 1.7, nade: 2.2, spread: 1.8, sight: 0.8, naval: 1.5 },
  normal: { hit: 0.8, cap: 0.36, capSniper: 0.48, head: 0.85, react: 1.2, burst: 0.9, pause: 1.2, nade: 1.3, spread: 1.25, sight: 0.92, naval: 1 },
  hard: { hit: 1, cap: 0.42, capSniper: 0.55, head: 1, react: 1, burst: 1, pause: 1, nade: 1, spread: 1, sight: 1, naval: 0.8 },
  veteran: { hit: 1.3, cap: 0.58, capSniper: 0.7, head: 1.6, react: 0.6, burst: 1.15, pause: 0.75, nade: 0.75, spread: 0.7, sight: 1.15, naval: 0.6 },
};

export function isBotDifficulty(v: unknown): v is BotDifficulty {
  return typeof v === "string" && (BOT_DIFFICULTIES as readonly string[]).includes(v);
}

/** Bảng hệ số theo giá trị trong RoomSettingsState (giá trị lạ thì về mặc định). */
export function difficultyOf(v: unknown): DifficultyTuning {
  return DIFFICULTY[isBotDifficulty(v) ? v : DEFAULT_DIFFICULTY];
}

/**
 * Xác suất trúng mỗi phát của máy theo khoảng cách (chưa tính tư thế hai bên): kém dần theo khoảng cách, súng bắn tỉa,
 * DMR giữ chính xác xa hơn; nhân hệ số độ khó rồi kẹp trong [0,05; trần].
 */
export function botHitChance(weaponClass: string, d: number, t: DifficultyTuning): number {
  const reach = weaponClass === "sniper" ? 420 : weaponClass === "dmr" ? 260 : 140;
  const cap = weaponClass === "sniper" ? t.capSniper : t.cap;
  return Math.max(0.05, Math.min(cap, (0.5 - d / reach) * t.hit));
}
