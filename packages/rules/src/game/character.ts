// Tạo nhân vật: chia điểm thuộc tính, chọn xuất thân (cho 1 món đồ khởi đầu và 1 kỹ năng) và tật xấu
// (bắt buộc, đổi lấy thêm điểm). Hiệu ứng của từng xuất thân, tật xấu nằm ở đây theo id; tên và móc câu
// cho bộ kể chuyện nằm trong @tentides/content.

import { nextInt, type RngState } from "../rng.ts";
import { STAT_IDS, type StatId, type Stats, type ZoneId } from "../stats.ts";

export const STAT_POINTS = 15;
/** Tật xấu là bắt buộc và đổi lấy chừng này điểm thuộc tính. */
export const FLAW_POINTS = 2;
export const STAT_MIN = 1;
export const STAT_MAX = 5;
export const BIO_MAX_LENGTH = 140;

export const BACKGROUND_IDS = [
  "old_sailor",
  "ex_medic",
  "hunter",
  "archaeologist",
  "rich_kid",
  "gambler",
  "carpenter",
  "guide",
] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export interface BackgroundDef {
  startItem: string;
  budgetBonus?: number;
  /** Chỉnh thuộc tính sau khi chia điểm (vd. con nhà giàu kém Gan dạ). */
  statDelta?: Partial<Stats>;
  /** +2 cho mọi phép kiểm tra ở những vùng này. */
  zoneBonus?: ZoneId[];
  /** +2 cho mọi phép kiểm tra dùng thuộc tính này. */
  statBonus?: StatId;
}

/** Tên ngắn dùng trong bảng cộng điểm xúc xắc; mô tả đầy đủ và móc câu truyện nằm trong @tentides/content. */
export const BACKGROUND_TITLES: Record<BackgroundId, string> = {
  old_sailor: "Thủy thủ già",
  ex_medic: "Y sĩ bỏ nghề",
  hunter: "Thợ săn",
  archaeologist: "Nhà khảo cổ",
  rich_kid: "Con nhà giàu",
  gambler: "Tay cờ bạc",
  carpenter: "Thợ mộc",
  guide: "Người dẫn đường",
};

export const BACKGROUNDS: Record<BackgroundId, BackgroundDef> = {
  old_sailor: { startItem: "rope", zoneBonus: ["beach", "lake"] },
  ex_medic: { startItem: "first_aid_kit" },
  hunter: { startItem: "flintlock" },
  archaeologist: { startItem: "old_map", statBonus: "intellect" },
  rich_kid: { startItem: "rum", budgetBonus: 30, statDelta: { nerve: -1 } },
  gambler: { startItem: "amulet" },
  carpenter: { startItem: "hammer" },
  guide: { startItem: "lantern", zoneBonus: ["cave", "volcano"] },
};

export const FLAW_IDS = ["fear_heights", "fear_dark", "greedy", "alcoholic", "liar", "clumsy"] as const;
export type FlawId = (typeof FLAW_IDS)[number];

export const FLAW_TITLES: Record<FlawId, string> = {
  fear_heights: "Sợ độ cao",
  fear_dark: "Sợ bóng tối",
  greedy: "Tham lam",
  alcoholic: "Nghiện rượu",
  liar: "Nói dối thành tật",
  clumsy: "Hậu đậu",
};

/** Tật xấu gây −2 cho phép kiểm tra ở vùng này. */
export const FLAW_ZONE_PENALTY: Partial<Record<FlawId, ZoneId>> = {
  fear_heights: "volcano",
  fear_dark: "cave",
};
/** Nói dối thành tật: −2 Duyên (khó ai tin). */
export const LIAR_STAT: StatId = "charisma";
/** Tham lam: mỗi đêm ở trại có chừng này xác suất ăn vụng thêm một khẩu phần. */
export const GREEDY_SNACK_CHANCE = 0.25;
/** Nghiện rượu: đêm nào không có rượu rum trong balo thì mất chừng này Tinh thần. */
export const ALCOHOLIC_MORALE = 10;
/** Hậu đậu: thua phép kiểm tra thì có xác suất làm rơi một món đồ. */
export const CLUMSY_DROP_CHANCE = 0.3;
/** Thuốc súng nằm cạnh diêm: thua phép kiểm tra thì có xác suất phát nổ. */
export const POWDER_KEG_CHANCE = 0.2;
export const POWDER_KEG_DAMAGE = 15;

export interface CharacterChoice {
  stats: Stats;
  background: BackgroundId;
  flaw: FlawId;
  bio: string;
}

/** Tổng điểm phải đúng 15 + 2 (tật xấu), mỗi thuộc tính 1–5. Trả về lý do nếu không hợp lệ. */
export function statsProblem(stats: Stats): string | null {
  const total = STAT_IDS.reduce((sum, id) => sum + stats[id], 0);
  if (STAT_IDS.some((id) => !Number.isInteger(stats[id]) || stats[id] < STAT_MIN || stats[id] > STAT_MAX)) {
    return `Mỗi thuộc tính từ ${STAT_MIN} đến ${STAT_MAX}`;
  }
  if (total !== STAT_POINTS + FLAW_POINTS) return `Phải chia đúng ${STAT_POINTS + FLAW_POINTS} điểm (đang ${total})`;
  return null;
}

export function applyBackgroundStats(stats: Stats, background: BackgroundId): Stats {
  const out = { ...stats };
  for (const [id, delta] of Object.entries(BACKGROUNDS[background].statDelta ?? {}) as [StatId, number][]) {
    out[id] = Math.max(STAT_MIN, out[id] + delta);
  }
  return out;
}

/** Nhân vật ngẫu nhiên (cho người không kịp tạo, và cho bot). */
export function randomCharacter(rng: RngState): { choice: CharacterChoice; rng: RngState } {
  const stats = Object.fromEntries(STAT_IDS.map((id) => [id, STAT_MIN])) as Stats;
  let state = rng;
  for (let points = STAT_POINTS + FLAW_POINTS - STAT_IDS.length; points > 0; ) {
    const r = nextInt(state, 0, STAT_IDS.length - 1);
    state = r.rng;
    const stat = STAT_IDS[r.value]!;
    if (stats[stat] < STAT_MAX) {
      stats[stat]++;
      points--;
    }
  }
  const bg = nextInt(state, 0, BACKGROUND_IDS.length - 1);
  const flaw = nextInt(bg.rng, 0, FLAW_IDS.length - 1);
  return {
    choice: { stats, background: BACKGROUND_IDS[bg.value]!, flaw: FLAW_IDS[flaw.value]!, bio: "" },
    rng: flaw.rng,
  };
}
