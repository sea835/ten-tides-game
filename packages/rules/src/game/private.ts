import { activePairs, bagWeight, capacityKg, lookupFrom, type AdjacencyId, type Placement, type TrayItem } from "./backpack.ts";
import { allowedNightActions } from "./night.ts";
import { canAssassinate } from "./interactions.ts";
import {
  DECEIT_TO_WIN,
  SIGNALS_TO_WIN,
  type Clue,
  type GameConfig,
  type GameState,
  type GhostChoice,
  type NightActionId,
  type NightChoice,
  type RoleId,
  type StatChange,
} from "./types.ts";

/**
 * Những gì một người được biết mà người khác không được biết. Server gửi phần này riêng cho từng người;
 * không bao giờ gửi cho cả phòng rồi để client tự giấu.
 */
export interface PrivateView {
  role: RoleId;
  nightActions: readonly NightActionId[];
  nightChoice: NightChoice | null;
  clues: Clue[];
  /** Tiến độ mục tiêu bí mật của kẻ phản bội. */
  goal: { current: number; needed: number } | null;
  loot: string[];
  /** Balo đầy đủ, kể cả ngăn bí mật; đồng đội chỉ thấy phần ngoài ngăn bí mật. */
  bag: Placement[];
  tray: TrayItem[];
  budget: number;
  weightKg: number;
  capacityKg: number;
  pairs: AdjacencyId[];
  /** Kẻ phản bội: hôm nay còn kết liễu được không. */
  canAssassinate: boolean;
  /** Nhật ký chỉ số của riêng mình: được mất gì, vì sao. */
  statLog: StatChange[];
  /** Số lần trượt liên tiếp (để hiện "Quyết tâm" sắp có). */
  failStreak: number;
  /** Hồn ma: việc đã chọn đêm nay. */
  ghostChoice: GhostChoice | null;
  /** Khảo sát kín: đêm nay mình đang nghi ai ("" là chưa ghi, null là không nghi ai). */
  suspicion: string | null | "";
  /** Số khoảnh khắc mình đã đánh dấu. */
  stars: number;
}

export function privateView(state: GameState, playerId: string, config: GameConfig): PrivateView | null {
  const p = state.players[playerId];
  if (!p) return null;
  const goal =
    p.role === "pirate"
      ? { current: state.signals, needed: SIGNALS_TO_WIN }
      : p.role === "con"
        ? { current: state.deceit, needed: DECEIT_TO_WIN }
        : null;
  return {
    role: p.role,
    nightActions: state.phase === "night" ? allowedNightActions(state, playerId) : [],
    nightChoice: state.nightChoices[playerId] ?? null,
    clues: state.clues[playerId] ?? [],
    goal,
    loot: p.loot,
    bag: p.bag,
    tray: p.tray,
    budget: p.budget,
    weightKg: Math.round(bagWeight(p.bag, lookupFrom(config.items)) * 10) / 10,
    capacityKg: capacityKg(p.stats.strength),
    pairs: activePairs(p.bag, lookupFrom(config.items)),
    canAssassinate: canAssassinate(state, playerId),
    statLog: state.statLog[playerId] ?? [],
    failStreak: p.failStreak ?? 0,
    ghostChoice: state.ghostChoices[playerId] ?? null,
    suspicion: state.suspicions.find((s) => s.day === state.day && s.playerId === playerId)?.target ?? "",
    stars: state.stars.filter((s) => s.playerId === playerId).length,
  };
}
