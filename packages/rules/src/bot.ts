// Bot chơi hết một ván, dùng cho mô phỏng cân bằng (chạy hàng nghìn ván không cần 3D hay AI).
// Sau này cùng chính sách này sẽ giữ nhân vật cho người rời ván giữa chừng.

import {
  DIG_ITEM,
  firstFit,
  lookupFrom,
  randomCharacter,
  TOTAL_DAYS,
  allowedNightActions,
  canAct,
  createGame,
  isOver,
  rationVoteNeeded,
  reduce,
  successChance,
  treasureRevealed,
} from "./game/index.ts";
import type { Difficulty, GameAction, GameConfig, GameState, NightActionId, RationId } from "./game/index.ts";
import { nextFloat, type RngState } from "./rng.ts";

export interface BotPolicy {
  /** Xác suất mở một thẻ đang chờ khi còn người rảnh. */
  openChance: number;
  /** Xác suất chọn lựa chọn có tỷ lệ thành công cao nhất (còn lại chọn bừa). */
  pickBestChance: number;
  /** Xác suất mỗi người về trại kịp lúc hoàng hôn. */
  returnChance: number;
  /** Ngày cuối ai cũng biết thuyền rời bến lúc tối, nên hầu như ai cũng về. */
  lastDayReturnChance: number;
  /** Xác suất bỏ phiếu đồng ý trói người bị đề cử. */
  tieYesChance: number;
  /** Xác suất có người đề cử trói mỗi đêm. */
  nominateChance: number;
  /**
   * Độ chính xác nghi ngờ: khi đề cử, xác suất nhắm đúng kẻ phản bội (nếu có). Bot không suy luận được,
   * nên đây là tham số quét để xem cân bằng đứng vững ở mức nghi ngờ của một nhóm bạn bình thường.
   */
  suspicionAccuracy: number;
}

export const DEFAULT_BOT_POLICY: BotPolicy = {
  openChance: 0.6,
  pickBestChance: 0.7,
  returnChance: 0.85,
  lastDayReturnChance: 0.97,
  tieYesChance: 0.5,
  nominateChance: 0.35,
  suspicionAccuracy: 0.4,
};

export interface BotGame {
  state: GameState;
  actions: GameAction[];
  /** Trạng thái lúc bình minh mỗi ngày, để vẽ đường cong theo ngày. */
  dawns: GameState[];
}

export function playBotGame(
  seed: number,
  playerCount: number,
  config: GameConfig,
  options: { difficulty?: Difficulty; policy?: BotPolicy } = {},
): BotGame {
  const policy = options.policy ?? DEFAULT_BOT_POLICY;
  let state = createGame(seed);
  let rng: RngState = (seed ^ 0x5bd1e995) >>> 0;
  const actions: GameAction[] = [];
  const dawns: GameState[] = [];

  const chance = (p: number) => {
    const r = nextFloat(rng);
    rng = r.rng;
    return r.value < p;
  };
  const pick = <T>(items: readonly T[]): T => {
    const r = nextFloat(rng);
    rng = r.rng;
    return items[Math.floor(r.value * items.length)]!;
  };
  const act = (action: GameAction) => {
    state = reduce(state, action, config);
    actions.push(action);
  };

  for (let i = 0; i < playerCount; i++) act({ type: "join", playerId: `p${i}`, name: `Bot ${i}` });
  act({ type: "start", difficulty: options.difficulty ?? "normal" });

  // Tạo nhân vật ngẫu nhiên, rồi mua đồ theo ngân sách (ưu tiên xẻng) và xếp vào chỗ trống đầu tiên.
  for (const id of state.playerOrder) {
    const character = randomCharacter(rng);
    rng = character.rng;
    act({ type: "createCharacter", playerId: id, ...character.choice });
  }
  act({ type: "advance" });
  const lookup = lookupFrom(config.items);
  for (const id of state.playerOrder) {
    const wishlist = [DIG_ITEM, ...state.shop.filter((i) => i !== DIG_ITEM)];
    for (const itemId of wishlist) {
      const def = lookup(itemId)!;
      if (state.players[id]!.budget < def.price || !chance(itemId === DIG_ITEM ? 0.6 : 0.5)) continue;
      act({ type: "buy", playerId: id, itemId });
      const bought = state.players[id]!.tray.at(-1)!;
      const spot = firstFit(state.players[id]!.bag, def, lookup);
      if (spot) act({ type: "place", playerId: id, uid: bought.uid, ...spot });
    }
  }
  act({ type: "advance" });

  while (!isOver(state)) {
    if (state.phase === "dawn") dawns.push(state);

    if (state.phase === "explore" && treasureRevealed(state) && !state.treasureDug) {
      const digger = state.playerOrder.find((id) => canAct(state, id) && state.players[id]!.items.includes(DIG_ITEM));
      if (digger) act({ type: "dig", playerId: digger });
    }

    if (state.phase === "explore") {
      for (const placed of Object.values(state.anchors)) {
        if (isOver(state)) break;
        const actor = state.playerOrder.find((id) => canAct(state, id));
        if (!actor || placed.status !== "open" || !chance(policy.openChance)) continue;
        act({ type: "trigger", playerId: actor, anchorId: placed.anchorId, participants: [actor] });
        const card = config.cards.find((c) => c.id === placed.cardId)!;
        const player = state.players[actor]!;
        const best = [...card.choices].sort(
          (a, b) => successChance(player, b, config, state.difficulty) - successChance(player, a, config, state.difficulty),
        )[0]!;
        const choice = chance(policy.pickBestChance) ? best : pick(card.choices);
        act({ type: "choose", playerId: actor, anchorId: placed.anchorId, choiceId: choice.id });
      }
    }

    if (!isOver(state) && state.phase === "night") {
      const campers = state.campers.filter((id) => state.players[id]?.alive);
      if (rationVoteNeeded(state)) {
        for (const id of campers) act({ type: "ration", playerId: id, choice: pick<RationId>(["normal", "half", "half", "skip"]) });
      }
      for (const id of campers) {
        const options = allowedNightActions(state, id);
        act({ type: "nightAction", playerId: id, ...botNightAction(state, id, options, pick, chance) });
      }
      if (campers.length >= 3 && chance(policy.nominateChance)) {
        const [by, ...others] = campers;
        const traitor = others.find((id) => ["pirate", "con"].includes(state.players[id]!.role));
        const target = traitor && chance(policy.suspicionAccuracy) ? traitor : pick(others);
        act({ type: "nominate", playerId: by!, target });
        for (const id of campers) if (!state.votes.tie?.revealed) act({ type: "ballot", playerId: id, tie: id !== target && chance(policy.tieYesChance) });
      }
    }

    if (isOver(state)) break;
    const returnChance = state.day >= TOTAL_DAYS ? policy.lastDayReturnChance : policy.returnChance;
    const atCamp = state.phase === "dusk" ? state.playerOrder.filter(() => chance(returnChance)) : undefined;
    act({ type: "advance", atCamp });
  }
  return { state, actions, dawns };
}

/** Người thường chủ yếu sửa thuyền; kẻ phản bội ra tay phần lớn các đêm nhưng đôi khi giả vờ sửa thuyền; y tá che chở người yếu nhất. */
function botNightAction(
  state: GameState,
  playerId: string,
  options: readonly NightActionId[],
  pick: <T>(items: readonly T[]) => T,
  chance: (p: number) => boolean,
): { action: NightActionId; target?: string } {
  const role = state.players[playerId]!.role;
  if (options.length === 1) return { action: options[0]! };
  if (role === "pirate" && !chance(0.2)) return { action: chance(0.5) ? "sabotage" : "signal" };
  if (role === "con" && !chance(0.2)) return { action: chance(0.5) ? "forge" : "pocket" };
  if (role === "nurse" && chance(0.7)) {
    const weakest = [...state.campers].filter((id) => state.players[id]!.alive).sort((a, b) => state.players[a]!.hp - state.players[b]!.hp)[0]!;
    return { action: "protect", target: weakest };
  }
  return { action: pick<NightActionId>(["repair", "repair", "repair", "sleep", "guard"]) };
}
