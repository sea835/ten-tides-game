// Engine luật của một ván: reduce(state, action, config) → state mới.
// Hàm thuần và có tính xác định: cùng seed và cùng chuỗi hành động luôn ra cùng một ván.
// Mọi dữ liệu thời gian thực (ai đang đứng ở đâu) do server đưa vào trong chính hành động,
// nên chỉ cần lưu seed + chuỗi hành động là phát lại được cả ván.

import { advance } from "./day.ts";
import { choose, dig, trigger } from "./events.ts";
import { join, leave, start } from "./lobby.ts";
import { buy, createCharacter, finishCreation, finishPacking, place, sell, unplace } from "./prep.ts";
import { castBallot, chooseNightAction, emptyVotes, nominate, revealBallot, voteRation } from "./night.ts";
import type { GameAction, GameConfig, GameState } from "./types.ts";

export * from "./types.ts";
export * from "./backpack.ts";
export * from "./character.ts";
export { visibleItems } from "./inventory.ts";
export { anchorZone, canAct, checkModifiers, effectiveDc, isBusy, isOverweight, successChance, treasureRevealed, type CheckingPlayer } from "./events.ts";
export { allowedNightActions, rationResult, rationVoteNeeded, tieResult } from "./night.ts";
export { ENDING_WINNERS } from "./endings.ts";
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
    shop: [],
    nextUid: 1,
    treasureSite: "",
    treasureDug: false,
    treasureCarrier: null,
    treasureSafe: false,
  };
}

export function reduce(prev: GameState, action: GameAction, config: GameConfig): GameState {
  const state = structuredClone(prev);
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
    case "dig":
      return dig(state, action.playerId);
  }
}

