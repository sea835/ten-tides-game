import {
  DECEIT_TO_WIN,
  HULL_TO_SAIL,
  SIGNALS_TO_WIN,
  isTraitor,
  type EndingId,
  type GameState,
  type IncidentEffect,
  type Winner,
} from "./types.ts";

export const ENDING_WINNERS: Record<EndingId, Winner> = {
  treasure_home: "team",
  bloody_treasure: "team",
  traitor_exposed: "team",
  sole_survivor: "solo",
  empty_handed: "none",
  buried: "none",
  pirates_win: "traitor",
  sold_out: "traitor",
};

function end(state: GameState, ending: EndingId, soloWinner: string | null = null): GameState {
  state.phase = "ended";
  state.ending = ending;
  state.winner = ENDING_WINNERS[ending];
  state.soloWinner = soloWinner;
  return state;
}

function traitorWith(state: GameState, role: "pirate" | "con") {
  return Object.values(state.players).find((p) => p.role === role && p.alive);
}

/**
 * Ai hết máu thì gục, trừ người đang được y tá che chở (còn lại 1 Máu). Người vác rương gục thì rương
 * rơi lại chỗ đào. Cả đội gục thì ván kết thúc; thuyền nát trong lúc có cướp biển thì cướp biển thắng.
 */
export function checkDeaths(state: GameState, effects?: IncidentEffect[]): GameState {
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (!p.alive || p.hp > 0) continue;
    if (p.protected) {
      p.hp = 1;
      p.protected = false;
      effects?.push({ type: "rescued", playerId: id });
      continue;
    }
    p.alive = false;
    p.tied = false;
    state.log.push({ kind: "death", day: state.day, playerId: id });
    if (state.treasureCarrier === id && !state.treasureSafe) {
      state.treasureCarrier = null;
      state.treasureDug = false;
    }
  }
  if (state.phase === "ended") return state;
  if (state.playerOrder.length > 0 && state.playerOrder.every((id) => !state.players[id]!.alive)) return end(state, "buried");
  if (state.hull <= 0 && traitorWith(state, "pirate")) return end(state, "pirates_win");
  return state;
}

/**
 * Tối ngày cuối: ai đang ở trại thì lên thuyền, núi lửa phun. Kết thúc xét theo thứ tự: phe phản bội đạt
 * mục tiêu → thuyền không đi được → có kho báu hay không → một người sống sót → lật mặt kẻ phản bội →
 * có ai chết, bị bỏ lại hay bị trói oan không.
 */
export function departure(state: GameState, atCamp: string[]): GameState {
  const alive = state.playerOrder.filter((id) => state.players[id]!.alive);
  const aboard = alive.filter((id) => atCamp.includes(id));
  const leftBehind = alive.filter((id) => !atCamp.includes(id));
  const withTreasure =
    state.treasureDug && (state.treasureSafe || (state.treasureCarrier !== null && aboard.includes(state.treasureCarrier)));
  state.volcano = 100;
  state.log.push({ kind: "departure", day: state.day, aboard, leftBehind, hull: state.hull, withTreasure });

  const pirate = traitorWith(state, "pirate");
  if (pirate && state.signals >= SIGNALS_TO_WIN) return end(state, "pirates_win");
  const con = traitorWith(state, "con");
  if (con && !con.tied && state.deceit >= DECEIT_TO_WIN && aboard.includes(con.id)) return end(state, "sold_out");

  if (aboard.length === 0 || state.hull < HULL_TO_SAIL) return end(state, "buried");
  if (!withTreasure) return end(state, "empty_handed");
  if (aboard.length === 1 && state.playerOrder.length > 1) return end(state, "sole_survivor", aboard[0]!);

  const tiedIds = state.tieHistory.map((t) => t.playerId);
  if (tiedIds.some((id) => isTraitor(state.players[id]!.role))) return end(state, "traitor_exposed");
  const someoneDied = state.playerOrder.some((id) => !state.players[id]!.alive);
  const wrongfulTie = tiedIds.some((id) => !isTraitor(state.players[id]!.role));
  if (someoneDied || leftBehind.length > 0 || wrongfulTie) return end(state, "bloody_treasure");
  return end(state, "treasure_home");
}
