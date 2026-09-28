// Engine luật của một ván: reduce(state, action, config) → state mới.
// Hàm thuần và có tính xác định: cùng seed và cùng chuỗi hành động luôn ra cùng một ván.
// Mọi dữ liệu thời gian thực (ai đang đứng ở đâu) do server đưa vào trong chính hành động,
// nên chỉ cần lưu seed + chuỗi hành động là phát lại được cả ván.

import { advance } from "./day.ts";
import { choose, dig, trigger } from "./events.ts";
import { encounter } from "./encounters.ts";
import { assassinate, build, consume, cook, drop, give, pickup, stash } from "./interactions.ts";
import { join, leave, start } from "./lobby.ts";
import { buy, createCharacter, finishCreation, finishPacking, place, sell, unplace } from "./prep.ts";
import { castBallot, chooseGhostAction, chooseNightAction, emptyVotes, nominate, revealBallot, star, suspect, voteRation } from "./night.ts";
import { STAT_LOG_SIZE, type GameAction, type GameConfig, type GameState, type StatChange } from "./types.ts";

export * from "./types.ts";
export * from "./backpack.ts";
export * from "./character.ts";
export { visibleItems } from "./inventory.ts";
export { anchorZone, canAct, checkModifiers, effectiveDc, isBusy, isOverweight, successChance, treasureRevealed, type CheckingPlayer } from "./events.ts";
export { allowedNightActions, rationResult, rationVoteNeeded, tieResult } from "./night.ts";
export { ENDING_WINNERS } from "./endings.ts";
export { ENCOUNTER_PHASES } from "./encounters.ts";
export { canAssassinate, hasMaterials } from "./interactions.ts";
export { TWISTS, TWIST_DAY, TWIST_IDS, twistVolcano, type TwistId } from "./twists.ts";
export { privateView, type PrivateView } from "./private.ts";

export function createGame(seed: number): GameState {
  return {
    seed,
    rng: seed,
    difficulty: "normal",
    phase: "lobby",
    day: 0,
    weather: [],
    volcano: 0,
    food: 0,
    treasure: 0,
    hull: 100,
    flags: [],
    players: {},
    playerOrder: [],
    anchors: {},
    sceneStates: {},
    campers: [],
    votes: emptyVotes(),
    usedCards: [],
    log: [],
    ending: null,
    winner: null,
    soloWinner: null,
    nightChoices: {},
    nightHistory: [],
    clues: {},
    signals: 0,
    deceit: 0,
    tieHistory: [],
    discovered: [],
    kills: [],
    shelter: 0,
    statLog: {},
    ghostChoices: {},
    ghostHistory: [],
    suspicions: [],
    stars: [],
    twist: "",
    twistPlayer: null,
    shop: [],
    nextUid: 1,
    treasureSite: "",
    treasureDug: false,
    treasureCarrier: null,
    treasureSafe: false,
  };
}

export function reduce(prev: GameState, action: GameAction, config: GameConfig): GameState {
  const next = apply(structuredClone(prev), action, config);
  recordStatChanges(prev, next, action);
  return next;
}

/** Vì sao chỉ số đổi, suy từ hành động (client dịch mã này ra lời). */
function statReason(prev: GameState, action: GameAction): string {
  switch (action.type) {
    case "choose":
      return `card:${prev.anchors[action.anchorId]?.cardId ?? ""}`;
    case "encounter":
      return `encounter:${action.source}:${action.defId}`;
    case "consume":
      return `eat:${prev.players[action.playerId]?.bag.find((b) => b.uid === action.uid)?.itemId ?? ""}`;
    case "assassinate":
      return "sudden";
    case "advance":
      // Hết hoàng hôn là đói thêm một ngày, ngủ ngoài; hết đêm là ăn uống, ngủ, và có khi là biến cố ngày 5.
      return prev.phase === "dusk" ? "dusk" : prev.phase === "night" ? "night" : prev.phase;
    default:
      return action.type;
  }
}

/** Ghi nhật ký chỉ số riêng: ai được, mất bao nhiêu Máu, No, Tinh thần, Sức bền và vì sao. */
function recordStatChanges(prev: GameState, next: GameState, action: GameAction) {
  if (prev.phase === "lobby" || prev.phase === "create" || prev.phase === "pack") return;
  const reason = statReason(prev, action);
  for (const [id, after] of Object.entries(next.players)) {
    const before = prev.players[id];
    if (!before) continue;
    const change: StatChange = { day: next.day, reason };
    let any = false;
    for (const key of ["hp", "hunger", "morale", "stamina"] as const) {
      // Sức bền hồi đầy mỗi sáng là chuyện thường ngày, không ghi.
      if (key === "stamina" && reason === "night") continue;
      const delta = after[key] - before[key];
      if (delta !== 0) {
        change[key] = delta;
        any = true;
      }
    }
    if (!any) continue;
    const log = (next.statLog[id] ??= []);
    log.push(change);
    if (log.length > STAT_LOG_SIZE) log.splice(0, log.length - STAT_LOG_SIZE);
  }
}

function apply(state: GameState, action: GameAction, config: GameConfig): GameState {
  switch (action.type) {
    case "join":
      return join(state, action.playerId, action.name);
    case "leave":
      return leave(state, action.playerId);
    case "start":
      return start(state, action.difficulty ?? "normal", config);
    case "advance":
      if (state.phase === "create") return finishCreation(state, config);
      if (state.phase === "pack") return finishPacking(state, config);
      return advance(state, action.atCamp, config);
    case "createCharacter": {
      const { playerId, stats, background, flaw, bio } = action;
      return createCharacter(state, playerId, { stats, background, flaw, bio });
    }
    case "buy":
      return buy(state, action.playerId, action.itemId, config);
    case "sell":
      return sell(state, action.playerId, action.uid, config);
    case "place":
      return place(state, action.playerId, action.uid, action.x, action.y, action.rot, config);
    case "unplace":
      return unplace(state, action.playerId, action.uid);
    case "trigger":
      return trigger(state, action.playerId, action.anchorId, action.participants);
    case "choose":
      return choose(state, action.playerId, action.anchorId, action.choiceId, config);
    case "ration":
      return voteRation(state, action.playerId, action.choice);
    case "nominate":
      return nominate(state, action.playerId, action.target);
    case "ballot":
      return castBallot(state, action.playerId, action.tie);
    case "revealBallot":
      return revealBallot(state);
    case "nightAction":
      return chooseNightAction(state, action.playerId, action.action, action.target);
    case "ghostAction":
      return chooseGhostAction(state, action.playerId, action.action, action.target, action.text);
    case "suspect":
      return suspect(state, action.playerId, action.target);
    case "star":
      return star(state, action.playerId);
    case "dig":
      return dig(state, action.playerId);
    case "encounter":
      return encounter(state, action, config);
    case "drop":
      return drop(state, action.playerId, action.uid);
    case "pickup":
      return pickup(state, action.playerId, action.itemId, config);
    case "consume":
      return consume(state, action.playerId, action.uid, config);
    case "assassinate":
      return assassinate(state, action.playerId, action.target);
    case "build":
      return build(state, action.playerId, action.building, action.cost, action.shelter);
    case "stash":
      return stash(state, action.playerId, action.uid, config);
    case "give":
      return give(state, action.playerId, action.target, action.uid, config);
    case "cook":
      return cook(state, action.playerId, action.uid, config);
  }
}

