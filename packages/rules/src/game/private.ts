import { activePairs, bagWeight, capacityKg, lookupFrom, type AdjacencyId, type Placement, type TrayItem } from "./backpack.ts";
import { allowedNightActions } from "./night.ts";
import {
  DECEIT_TO_WIN,
  SIGNALS_TO_WIN,
  type Clue,
  type GameConfig,
  type GameState,
  type NightActionId,
  type NightChoice,
  type RoleId,
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
  };
}
