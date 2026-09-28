import { rollCheck } from "../dice.ts";
import { nextFloat, nextInt, shuffle } from "../rng.ts";
import { activePairs, lookupFrom } from "./backpack.ts";
import { ALCOHOLIC_MORALE, GREEDY_SNACK_CHANCE } from "./character.ts";
import { checkDeaths } from "./endings.ts";
import { applyOutcome, checkModifiers, effectiveDc, isOverweight } from "./events.ts";
import { removeItemAt } from "./inventory.ts";
import {
  DAILY_HUNGER,
  FORGE_DAMAGE,
  GUARD_DC,
  GUARD_MORALE_COST,
  INCIDENT_CHANCE,
  MEAL_HUNGER,
  OVERWEIGHT_HUNGER,
  RATION_IDS,
  REPAIR_PER_PLAYER,
  ROLE_NIGHT_ACTIONS,
  SABOTAGE_DAMAGE,
  SABOTAGE_GUARDED,
  OUTSIDE_MORALE,
  SHELTER_MORALE,
  SIGNAL_SEEN_CHANCE,
  SLEEP_MORALE,
  STARVING_DAMAGE,
  TRAITOR_ACTIONS,
  clamp,
  fail,
  weatherOf,
  type GameConfig,
  type GameState,
  type IncidentEffect,
  type NightActionId,
  type NightVotes,
  type PlayerSheet,
  type RationId,
} from "./types.ts";

export function emptyVotes(): NightVotes {
  return { ration: {}, tie: null };
}

/** Hoàng hôn khép lại: ai ngoài trại phải ngủ ngoài; ai trong trại ngồi quanh đống lửa. */
export function nightfall(state: GameState, atCamp: string[], config: GameConfig): GameState {
  const sleptOutside: string[] = [];
  state.campers = [];
  state.votes = emptyVotes();
  state.nightChoices = {};

  // Người vác rương về tới trại thì rương được cất an toàn.
  if (state.treasureCarrier && atCamp.includes(state.treasureCarrier)) state.treasureSafe = true;

  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (!p.alive) continue;
    p.lost = false;
    // Mang quá tải thì đói nhanh hơn.
    p.hunger = clamp(p.hunger - DAILY_HUNGER - (isOverweight(p, config) ? OVERWEIGHT_HUNGER : 0), 0, 100);
    if (atCamp.includes(id)) {
      state.campers.push(id);
    } else {
      sleptOutside.push(id);
      // Có lều thì ngủ ngoài đỡ khổ.
      if (!p.items.includes("tent")) p.morale = clamp(p.morale - OUTSIDE_MORALE, 0, 100);
    }
  }
  state.log.push({ kind: "dusk", day: state.day, sleptOutside });
  for (const id of sleptOutside) outsideNight(state, state.players[id]!, config);
  state.phase = "night";
  return checkDeaths(state);
}

/** Người ngủ ngoài trại gặp một chuyện trong đêm (hợp thời tiết), qua được phép kiểm tra thì đỡ hoặc còn được lợi. */
function outsideNight(state: GameState, p: PlayerSheet, config: GameConfig) {
  if (!p.alive) return;
  const weather = weatherOf(state);
  const pool = (config.outsideEvents ?? []).filter((e) => !e.weather || (weather && e.weather.includes(weather)));
  if (pool.length === 0) {
    p.hp = clamp(p.hp - 10, 0, p.maxHp);
    return;
  }
  const pick = nextInt(state.rng, 0, pool.length - 1);
  state.rng = pick.rng;
  const event = pool[pick.value]!;
  const choice = { check: event.check };
  const rolled = rollCheck(state.rng, {
    stat: event.check.stat,
    dc: effectiveDc(event.check.dc, state.difficulty),
    stats: p.stats,
    modifiers: checkModifiers(p, choice, config),
  });
  state.rng = rolled.rng;
  applyOutcome(state, rolled.result.success ? event.onSuccess : event.onFail, p, [p.id], config);
  state.log.push({ kind: "outside", day: state.day, playerId: p.id, event: event.id, result: rolled.result });
}

export function aliveCampers(state: GameState): string[] {
  return state.campers.filter((id) => state.players[id]?.alive);
}

function requireCamper(state: GameState, playerId: string) {
  if (state.phase !== "night") fail("Chỉ làm được việc này ban đêm");
  if (!aliveCampers(state).includes(playerId)) fail("Chỉ người ngồi quanh đống lửa mới làm được việc này");
}

/** Những hành động đêm một người được chọn đêm nay. Bị trói thì chỉ còn ngủ. */
export function allowedNightActions(state: GameState, playerId: string): readonly NightActionId[] {
  const p = state.players[playerId];
  if (!p?.alive || !state.campers.includes(playerId)) return [];
  return p.tied ? ["sleep"] : ROLE_NIGHT_ACTIONS[p.role];
}

export function chooseNightAction(state: GameState, playerId: string, action: NightActionId, target?: string): GameState {
  requireCamper(state, playerId);
  if (!allowedNightActions(state, playerId).includes(action)) fail("Bạn không làm được việc này đêm nay");
  if (action === "protect") {
    if (!target || !aliveCampers(state).includes(target)) fail("Chỉ che chở được người đang ở trong trại");
    state.nightChoices[playerId] = { action, target };
  } else {
    state.nightChoices[playerId] = { action };
  }
  return state;
}

/** Chỉ phải bầu cách chia khi lương thực không đủ mỗi người một phần. */
export function rationVoteNeeded(state: Pick<GameState, "food" | "campers">): boolean {
  return state.food < state.campers.length;
}

export function voteRation(state: GameState, playerId: string, choice: RationId): GameState {
  requireCamper(state, playerId);
  if (!rationVoteNeeded(state)) fail("Lương thực đủ chia đều, không cần bầu");
  if (!RATION_IDS.includes(choice)) fail("Không có cách chia này");
  state.votes.ration[playerId] = choice;
  return state;
}

export function nominate(state: GameState, playerId: string, target: string): GameState {
  requireCamper(state, playerId);
  if (state.votes.tie) fail("Đêm nay đã có người bị đề cử");
  if (target === playerId || !aliveCampers(state).includes(target)) {
    fail("Chỉ đề cử được người khác đang ngồi quanh đống lửa");
  }
  state.votes.tie = { by: playerId, target, votes: {}, revealed: false };
  return state;
}

export function castBallot(state: GameState, playerId: string, tie: boolean): GameState {
  requireCamper(state, playerId);
  const ballot = state.votes.tie ?? fail("Chưa ai bị đề cử");
  if (ballot.revealed) fail("Phiếu đã lật");
  if (playerId in ballot.votes) fail("Đã bỏ phiếu thì không đổi được");
  ballot.votes[playerId] = tie;
  if (aliveCampers(state).every((id) => id in ballot.votes)) ballot.revealed = true;
  return state;
}

export function revealBallot(state: GameState): GameState {
  const ballot = state.votes.tie ?? fail("Chưa ai bị đề cử");
  ballot.revealed = true;
  return state;
}

/** Cách chia được nhiều phiếu nhất; hoà hoặc không ai bầu thì ưu tiên người đói nhất. */
export function rationResult(votes: NightVotes): RationId {
  const counts = new Map<RationId, number>();
  for (const choice of Object.values(votes.ration)) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) return "normal";
  return ranked[0]![0];
}

/** Trói nếu số phiếu đồng ý vượt quá nửa số người quanh đống lửa (người không bầu tính là không đồng ý). */
export function tieResult(votes: NightVotes, campers: readonly string[]): string | null {
  const ballot = votes.tie;
  if (!ballot) return null;
  const yes = Object.values(ballot.votes).filter(Boolean).length;
  return yes > campers.length / 2 ? ballot.target : null;
}

function addClue(state: GameState, playerId: string, text: string) {
  (state.clues[playerId] ??= []).push({ day: state.day, text });
}

/**
 * Hết đêm, theo thứ tự: che chở của y tá → hành động của kẻ phản bội → sự cố tự nhiên → người canh gác
 * → sửa thuyền, ngủ bù → chia lương thực → trói → đói lả → ai gục.
 */
export function resolveNight(state: GameState, config: GameConfig) {
  const campers = aliveCampers(state);
  const roll = () => {
    const r = nextFloat(state.rng);
    state.rng = r.rng;
    return r.value;
  };
  const choices = Object.fromEntries(
    campers.map((id) => {
      const choice = state.nightChoices[id];
      const allowed = allowedNightActions(state, id);
      // Không chọn (hoặc bị trói) thì coi như ngủ; người ngoài nhìn vào không phân biệt được.
      return [id, choice && allowed.includes(choice.action) ? choice : { action: "sleep" as const }];
    }),
  );
  for (const id of campers) state.nightHistory.push({ day: state.day, playerId: id, ...choices[id]! });
  const doing = (action: NightActionId) => campers.filter((id) => choices[id]!.action === action);
  const effects: IncidentEffect[] = [];

  // Che chở của đêm trước hết hạn; y tá đêm nay che chở người mới tới hết đêm mai.
  for (const p of Object.values(state.players)) p.protected = false;
  for (const nurse of doing("protect")) state.players[choices[nurse]!.target!]!.protected = true;

  const guards = doing("guard");
  // Mỗi vai phản bội chỉ có một người, nên mỗi hành động có hại xảy ra nhiều nhất một lần mỗi đêm.
  if (doing("sabotage").length > 0) {
    const damage = guards.length > 0 ? SABOTAGE_GUARDED : SABOTAGE_DAMAGE;
    state.hull = clamp(state.hull - damage, 0, 100);
    effects.push({ type: "hull", amount: -damage });
  }
  if (doing("signal").length > 0) {
    state.signals++;
    if (roll() < SIGNAL_SEEN_CHANCE) effects.push({ type: "strangeLight" });
  }
  if (doing("forge").length > 0) {
    state.deceit++;
    state.treasure = clamp(state.treasure - FORGE_DAMAGE, 0, 100);
    effects.push({ type: "treasure", amount: -FORGE_DAMAGE });
  }
  for (const con of doing("pocket")) {
    const victims = campers.filter((id) => id !== con && state.players[id]!.items.length > 0);
    if (victims.length === 0) continue;
    const victim = state.players[victims[Math.floor(roll() * victims.length)]!]!;
    const item = removeItemAt(victim, Math.floor(roll() * victim.items.length));
    state.players[con]!.loot.push(item);
    state.deceit++;
    effects.push({ type: "itemMissing", playerId: victim.id, itemId: item });
  }

  // Nhiễu nghi ngờ: sự cố tự nhiên có cùng dạng với phá hoại, xảy ra cả khi không có kẻ phản bội.
  if (roll() < (config.incidentChance ?? INCIDENT_CHANCE)) {
    const kind = Math.floor(roll() * 4);
    if (kind === 0) {
      state.hull = clamp(state.hull - 10, 0, 100);
      effects.push({ type: "hull", amount: -10 });
    } else if (kind === 1 && state.food > 0) {
      state.food--;
      effects.push({ type: "food", amount: -1 });
    } else if (kind === 2) {
      const owners = campers.filter((id) => state.players[id]!.items.length > 0);
      if (owners.length > 0) {
        const owner = state.players[owners[Math.floor(roll() * owners.length)]!]!;
        const item = removeItemAt(owner, Math.floor(roll() * owner.items.length));
        effects.push({ type: "itemMissing", playerId: owner.id, itemId: item });
      }
    } else if (state.treasure > 0) {
      state.treasure = clamp(state.treasure - 5, 0, 100);
      effects.push({ type: "treasure", amount: -5 });
    }
  }

  // Người canh gác: nếu đêm nay có kẻ ra tay, qua được phép kiểm tra thì thấy một bóng người
  // (lẫn với một người vô tội); không ai ra tay thì biết là đêm yên tĩnh.
  const culprits = campers.filter((id) => TRAITOR_ACTIONS.includes(choices[id]!.action));
  for (const guard of guards) {
    const p = state.players[guard]!;
    p.morale = clamp(p.morale - GUARD_MORALE_COST, 0, 100);
    const culprit = culprits.find((id) => id !== guard);
    if (!culprit) {
      addClue(state, guard, "Bạn thức canh cả đêm. Không có ai rời chỗ ngủ.");
      continue;
    }
    const spyglass = p.items.includes("spyglass") ? [{ label: "Ống nhòm", value: 3 }] : [];
    const check = rollCheck(state.rng, { stat: "intellect", dc: GUARD_DC, stats: p.stats, modifiers: spyglass });
    state.rng = check.rng;
    if (!check.result.success) {
      addClue(state, guard, "Bạn ngủ gật lúc canh gác, chỉ nhớ loáng thoáng có tiếng động.");
      continue;
    }
    const decoys = campers.filter((id) => id !== guard && id !== culprit);
    const lineup = [culprit];
    if (decoys.length > 0) {
      const decoy = nextInt(state.rng, 0, decoys.length - 1);
      state.rng = decoy.rng;
      lineup.push(decoys[decoy.value]!);
    }
    const suspects = shuffle(state.rng, lineup);
    state.rng = suspects.rng;
    const names = suspects.value.map((id) => state.players[id]!.name).join(" hoặc ");
    addClue(state, guard, `Nửa đêm bạn thấy một bóng người lén lút, dáng giống ${names}.`);
  }

  // Thợ mộc sửa gấp đôi; có búa thì sửa thêm; búa cạnh dây thừng là bộ đồ sửa thuyền.
  const lookup = lookupFrom(config.items);
  const repairers = doing("repair");
  if (repairers.length > 0) {
    const work = repairers.reduce((sum, id) => {
      const p = state.players[id]!;
      let amount = REPAIR_PER_PLAYER * (p.background === "carpenter" ? 2 : 1);
      if (p.items.includes("hammer")) amount += REPAIR_PER_PLAYER;
      if (activePairs(p.bag, lookup).includes("repair_kit")) amount += 3;
      return sum + amount;
    }, 0);
    const amount = Math.min(100 - state.hull, work);
    state.hull += amount;
    if (amount > 0) effects.push({ type: "repair", amount });
  }
  // Đủ chỗ ngủ có mái che cho cả trại thì ai cũng ngủ ngon hơn.
  if (campers.length > 0 && state.shelter >= campers.length) {
    for (const id of campers) {
      const p = state.players[id]!;
      p.morale = clamp(p.morale + SHELTER_MORALE, 0, 100);
    }
  }
  for (const id of doing("sleep")) {
    const p = state.players[id]!;
    p.morale = clamp(p.morale + SLEEP_MORALE, 0, 100);
  }

  for (const id of campers) {
    const p = state.players[id]!;
    if (p.items.includes("water_barrel")) p.morale = clamp(p.morale + 5, 0, 100);
    // Nghiện rượu: không có rượu rum thì bồn chồn cả đêm.
    if (p.flaw === "alcoholic" && !p.items.includes("rum")) p.morale = clamp(p.morale - ALCOHOLIC_MORALE, 0, 100);
    // Tham lam: lén ăn thêm một khẩu phần, sáng ra cả trại chỉ thấy kho hụt.
    if (p.flaw === "greedy" && state.food > 0 && roll() < GREEDY_SNACK_CHANCE) {
      state.food--;
      p.hunger = clamp(p.hunger + MEAL_HUNGER, 0, 100);
      effects.push({ type: "food", amount: -1 });
    }
  }

  const ate = eat(state);

  // Người bị trói đêm trước được thả; ai bị trói đêm nay thì mất năng lực tới hết đêm mai.
  for (const p of Object.values(state.players)) p.tied = false;
  const ballot = state.votes.tie;
  const tied = tieResult(state.votes, campers);
  if (tied) {
    state.players[tied]!.tied = true;
    state.tieHistory.push({ day: state.day, playerId: tied });
  }

  const starving: string[] = [];
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (p.alive && p.hunger === 0) {
      starving.push(id);
      p.hp = clamp(p.hp - STARVING_DAMAGE, 0, p.maxHp);
    }
  }
  state.log.push({
    kind: "night",
    day: state.day,
    ration: ate.ration,
    ate: ate.count,
    starving,
    nominee: ballot?.target ?? null,
    yes: ballot ? Object.keys(ballot.votes).filter((id) => ballot.votes[id]) : [],
    no: ballot ? Object.keys(ballot.votes).filter((id) => !ballot.votes[id]) : [],
    tied,
  });
  checkDeaths(state, effects);
  if (effects.length > 0) state.log.push({ kind: "incident", day: state.day, effects });

  state.campers = [];
  state.votes = emptyVotes();
  state.nightChoices = {};
}

function eat(state: GameState): { ration: RationId; count: number } {
  const campers = aliveCampers(state).map((id) => state.players[id]!);
  const ration: RationId = rationVoteNeeded(state) ? rationResult(state.votes) : "normal";
  let count = 0;
  const feed = (p: PlayerSheet, amount = MEAL_HUNGER) => {
    p.hunger = clamp(p.hunger + amount, 0, 100);
  };

  switch (ration) {
    case "normal": {
      // Mỗi người một phần; thiếu thì người đói nhất ăn trước.
      for (const p of [...campers].sort((a, b) => a.hunger - b.hunger)) {
        if (state.food === 0) break;
        state.food--;
        count++;
        feed(p);
      }
      break;
    }
    case "half":
      // Hai người chung một khẩu phần.
      for (let i = 0; i < campers.length && state.food > 0; i += 2) {
        state.food--;
        count++;
        for (const p of campers.slice(i, i + 2)) feed(p, MEAL_HUNGER / 2);
      }
      break;
    case "skip":
      for (const p of campers) p.morale = clamp(p.morale - 5, 0, 100);
      break;
  }
  return { ration, count };
}

