// Biến cố ngày 5: chọn từ lúc bắt đầu ván (bộ sinh truyện dựng cốt truyện quanh nó), giữ bí mật,
// rồi xảy ra ở bình minh ngày 5 với hệ quả thật và mở khoá những thẻ sự kiện nối tiếp (cờ `twist_<id>`).

import { nextInt } from "../rng.ts";
import { clamp, type GameState } from "./types.ts";

export const TWIST_DAY = 5;

export const TWIST_IDS = [
  "half_taken",
  "map_reversed",
  "hider_alive",
  "other_party",
  "volcano_early",
  "treasure_trap",
  "oars_missing",
  "blood_relation",
] as const;
export type TwistId = (typeof TWIST_IDS)[number];

export interface TwistEffect {
  /** Áp cho cả đội. */
  treasure?: number;
  hull?: number;
  food?: number;
  /** Núi lửa hoạt động mạnh thêm chừng này từ hôm đó. */
  volcano?: number;
  /** Áp cho mọi người còn sống. */
  morale?: number;
  /** Áp riêng cho người bị cuốn vào biến cố. */
  personal?: { morale?: number; hp?: number };
}

export const TWISTS: Record<TwistId, TwistEffect> = {
  // Có người đã tới trước: mất một phần tiến độ, nhưng dấu đào cũ mở ra manh mối mới.
  half_taken: { treasure: -15, morale: -5 },
  // Đọc ngược bản đồ: mất phương hướng, nhưng ai đọc lại đúng sẽ tiến vượt bậc.
  map_reversed: { treasure: -10 },
  // Người giấu còn sống: cả đoàn rợn người; gặp được ông ta trong phế tích là manh mối lớn.
  hider_alive: { morale: -8 },
  // Một đoàn khác trên đảo: họ bỏ lại chút lương thực, và có thể trao đổi hay trộm của họ.
  other_party: { food: 2, morale: -3 },
  // Núi lửa tỉnh sớm: mức hoạt động tăng hẳn, sườn núi lộ ra lối mới.
  volcano_early: { volcano: 15, morale: -5 },
  // Kho báu có bẫy: gỡ được cơ quan dưới cát nóng thì mới yên.
  treasure_trap: { morale: -5 },
  // Mái chèo dự phòng biến mất: thuyền yếu đi, có khi vớt lại được.
  oars_missing: { hull: -15 },
  // Một người trong đoàn có họ hàng với người giấu: người đó vững dạ, cả đội thêm manh mối.
  blood_relation: { treasure: 10, personal: { morale: 15 } },
};

/** Biến cố nào cần gắn với một người chơi cụ thể. */
const PERSONAL: readonly TwistId[] = ["blood_relation"];

/** Lúc bắt đầu ván: chọn biến cố ngày 5 (và người bị cuốn vào, nếu có). */
export function chooseTwist(state: GameState) {
  const pick = nextInt(state.rng, 0, TWIST_IDS.length - 1);
  state.rng = pick.rng;
  const twist = TWIST_IDS[pick.value]!;
  state.twist = twist;
  state.twistPlayer = null;
  if (PERSONAL.includes(twist) && state.playerOrder.length > 0) {
    const who = nextInt(state.rng, 0, state.playerOrder.length - 1);
    state.rng = who.rng;
    state.twistPlayer = state.playerOrder[who.value]!;
  }
}

/** Mức núi lửa thêm vì biến cố (tính từ ngày biến cố xảy ra). */
export function twistVolcano(state: Pick<GameState, "twist" | "day">): number {
  return state.day >= TWIST_DAY ? (TWISTS[state.twist as TwistId]?.volcano ?? 0) : 0;
}

/** Bình minh ngày 5: biến cố xảy ra. */
export function applyTwist(state: GameState) {
  const effect = TWISTS[state.twist as TwistId];
  if (!effect) return;
  if (effect.treasure) state.treasure = clamp(state.treasure + effect.treasure, 0, 100);
  if (effect.hull) state.hull = clamp(state.hull + effect.hull, 0, 100);
  if (effect.food) state.food = Math.max(0, state.food + effect.food);
  for (const p of Object.values(state.players)) {
    if (!p.alive) continue;
    if (effect.morale) p.morale = clamp(p.morale + effect.morale, 0, 100);
  }
  const target = state.twistPlayer ? state.players[state.twistPlayer] : undefined;
  const personal = target?.alive ? effect.personal : undefined;
  if (target && personal?.morale) target.morale = clamp(target.morale + personal.morale, 0, 100);
  if (target && personal?.hp) target.hp = clamp(target.hp + personal.hp, 0, target.maxHp);
  const flag = `twist_${state.twist}`;
  if (!state.flags.includes(flag)) state.flags.push(flag);
  state.log.push({ kind: "twist", day: state.day, twist: state.twist, playerId: target?.alive ? target.id : null });
}
