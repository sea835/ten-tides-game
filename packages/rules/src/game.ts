// Engine luật của một ván: reduce(state, action, config) → state mới.
// Hàm thuần và có tính xác định: cùng seed và cùng chuỗi hành động luôn ra cùng một ván.
// Mọi dữ liệu thời gian thực (ai đang đứng ở đâu) do server đưa vào trong chính hành động,
// nên chỉ cần lưu seed + chuỗi hành động là phát lại được cả ván.

import type { AnchorDef, CardChoice, EventCard, ItemDef, Outcome } from "./cards.ts";
import { rollCheck, type CheckResult, type Modifier } from "./dice.ts";
import { nextFloat, nextInt, shuffle, type RngState } from "./rng.ts";
import { STAT_IDS, type Stats } from "./stats.ts";
import { WEATHER_WEIGHTS, type WeatherId } from "./weather.ts";

export const TOTAL_DAYS = 10;
export const STAT_POINTS = 15;
export const STARTER_ITEMS = 3;
export const FOOD_PER_PLAYER = 2;
export const MAX_CARDS_PER_DAY = 6;
export const DAILY_HUNGER = 25;
/** Một khẩu phần hồi chừng này điểm No. */
export const MEAL_HUNGER = 25;
export const STARVING_DAMAGE = 15;

/** Cách chia lương thực mà cả trại bỏ phiếu mỗi đêm. */
export const RATION_IDS = ["full", "normal", "half", "skip"] as const;
export type RationId = (typeof RATION_IDS)[number];
/** Phiếu trói: id người bị nghi, hoặc không trói ai. */
export const NO_TIE = "none";

export type Phase = "lobby" | "dawn" | "explore" | "dusk" | "night" | "ended";
export type EndingId = "treasure_home" | "empty_handed" | "buried";

export interface PlayerSheet {
  id: string;
  name: string;
  stats: Stats;
  hp: number;
  maxHp: number;
  /** No: 100 là no căng, 0 là kiệt sức. */
  hunger: number;
  morale: number;
  stamina: number;
  items: string[];
  alive: boolean;
  /** Lạc đường tới hoàng hôn: không mở được thẻ sự kiện nào nữa trong ngày. */
  lost: boolean;
  /** Bị cả trại trói: ở yên trong trại, không mở được sự kiện, tới hoàng hôn hôm sau mới được thả. */
  tied: boolean;
}

export interface NightVotes {
  ration: Record<string, RationId>;
  tie: Record<string, string>;
}

export type AnchorStatus = "open" | "active" | "resolved";

export interface PlacedCard {
  anchorId: string;
  cardId: string;
  status: AnchorStatus;
  participants: string[];
}

export type LogEntry =
  | {
      kind: "check";
      day: number;
      playerId: string;
      participants: string[];
      anchorId: string;
      cardId: string;
      choiceId: string;
      result: CheckResult;
    }
  | { kind: "dusk"; day: number; sleptOutside: string[] }
  | { kind: "night"; day: number; ration: RationId; ate: number; starving: string[]; tied: string | null }
  | { kind: "death"; day: number; playerId: string };

export interface GameState {
  seed: number;
  rng: RngState;
  phase: Phase;
  day: number;
  weather: WeatherId[];
  /** Mức hoạt động núi lửa 0–100; tới 100 thì phun trào. */
  volcano: number;
  food: number;
  treasure: number;
  hull: number;
  flags: string[];
  players: Record<string, PlayerSheet>;
  playerOrder: string[];
  /** Thẻ đã đặt lên map trong ngày hiện tại, theo id điểm sự kiện. */
  anchors: Record<string, PlacedCard>;
  sceneStates: Record<string, string>;
  /** Những người ngồi quanh đống lửa đêm nay: chỉ họ được chat và bỏ phiếu. */
  campers: string[];
  votes: NightVotes;
  usedCards: string[];
  log: LogEntry[];
  ending: EndingId | null;
}

export interface GameConfig {
  cards: readonly EventCard[];
  anchors: readonly AnchorDef[];
  items: readonly ItemDef[];
}

export type GameAction =
  | { type: "join"; playerId: string; name: string }
  | { type: "leave"; playerId: string }
  | { type: "start" }
  /** Sang pha kế tiếp. Khi rời hoàng hôn, server cho biết ai đang ở trong trại. */
  | { type: "advance"; atCamp?: string[] }
  /** Server đã kiểm tra khoảng cách; participants là những người đứng tại điểm đó. */
  | { type: "trigger"; playerId: string; anchorId: string; participants: string[] }
  | { type: "choose"; playerId: string; anchorId: string; choiceId: string }
  | { type: "vote"; playerId: string; ballot: "ration"; choice: RationId }
  | { type: "vote"; playerId: string; ballot: "tie"; choice: string };

export class RuleError extends Error {
  override name = "RuleError";
}

function fail(message: string): never {
  throw new RuleError(message);
}

export function isOver(state: GameState): boolean {
  return state.phase === "ended";
}

export function actOf(day: number): 1 | 2 | 3 {
  if (day <= 3) return 1;
  if (day <= 7) return 2;
  return 3;
}

export function createGame(seed: number): GameState {
  return {
    seed,
    rng: seed,
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
    votes: { ration: {}, tie: {} },
    usedCards: [],
    log: [],
    ending: null,
  };
}

export function reduce(prev: GameState, action: GameAction, config: GameConfig): GameState {
  const state = structuredClone(prev);
  switch (action.type) {
    case "join":
      return join(state, action.playerId, action.name, config);
    case "leave":
      if (state.phase !== "lobby") fail("Chỉ rời được khi ván chưa bắt đầu");
      delete state.players[action.playerId];
      state.playerOrder = state.playerOrder.filter((id) => id !== action.playerId);
      return state;
    case "start":
      return start(state, config);
    case "advance":
      return advance(state, action.atCamp, config);
    case "trigger":
      return trigger(state, action.playerId, action.anchorId, action.participants);
    case "choose":
      return choose(state, action.playerId, action.anchorId, action.choiceId, config);
    case "vote":
      return vote(state, action);
  }
}

// ---------- Sảnh chờ ----------

function join(state: GameState, playerId: string, name: string, config: GameConfig): GameState {
  if (state.phase !== "lobby") fail("Ván đã bắt đầu");
  if (state.players[playerId]) fail("Người chơi đã có trong ván");

  // Chưa có màn tạo nhân vật: chia ngẫu nhiên 15 điểm (mỗi thuộc tính 1–5) và phát tạm 3 món đồ.
  const stats = Object.fromEntries(STAT_IDS.map((id) => [id, 1])) as Stats;
  let rng = state.rng;
  for (let points = STAT_POINTS - STAT_IDS.length; points > 0; ) {
    const r = nextInt(rng, 0, STAT_IDS.length - 1);
    rng = r.rng;
    const stat = STAT_IDS[r.value]!;
    if (stats[stat] < 5) {
      stats[stat]++;
      points--;
    }
  }
  const kit = shuffle(
    rng,
    config.items.map((i) => i.id),
  );
  state.rng = kit.rng;

  const maxHp = 60 + stats.strength * 10;
  state.players[playerId] = {
    id: playerId,
    name,
    stats,
    hp: maxHp,
    maxHp,
    hunger: 80,
    morale: Math.min(100, 40 + stats.nerve * 10),
    stamina: 100,
    items: kit.value.slice(0, STARTER_ITEMS),
    alive: true,
    lost: false,
    tied: false,
  };
  state.playerOrder.push(playerId);
  return state;
}

function start(state: GameState, config: GameConfig): GameState {
  if (state.phase !== "lobby") fail("Ván đã bắt đầu");
  if (state.playerOrder.length === 0) fail("Chưa có ai trong phòng");

  const wake = nextInt(state.rng, 4, 6);
  state.rng = wake.rng;
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const table = WEATHER_WEIGHTS[day >= wake.value ? "awake" : "calm"];
    const r = weightedPick(state.rng, table);
    state.rng = r.rng;
    state.weather.push(r.value);
  }
  state.food = state.playerOrder.length * FOOD_PER_PLAYER;
  return beginDay(state, config);
}

function weightedPick<T extends string>(rng: RngState, weights: Partial<Record<T, number>>): { value: T; rng: RngState } {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const r = nextFloat(rng);
  let roll = r.value * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll < 0) return { value, rng: r.rng };
  }
  return { value: entries[entries.length - 1]![0], rng: r.rng };
}

// ---------- Vòng ngày ----------

function beginDay(state: GameState, config: GameConfig): GameState {
  state.day++;
  state.phase = "dawn";
  state.volcano = state.day * 10;
  for (const p of Object.values(state.players)) p.stamina = 100;
  return dealCards(state, config);
}

export function weatherOf(state: GameState): WeatherId | undefined {
  return state.weather[state.day - 1];
}

function cardFits(card: EventCard, anchor: AnchorDef, state: GameState): boolean {
  const req = card.requires;
  const weather = weatherOf(state);
  if (card.anchorType !== anchor.type) return false;
  if (!card.acts.includes(actOf(state.day))) return false;
  if (req?.zone && req.zone !== anchor.zone) return false;
  if (req?.weather && (!weather || !req.weather.includes(weather))) return false;
  if (req?.flags?.some((f) => !state.flags.includes(f))) return false;
  if (req?.notFlags?.some((f) => state.flags.includes(f))) return false;
  return true;
}

/** Mỗi sáng đặt thẻ vào các điểm sự kiện. Ưu tiên thẻ chưa gặp; cùng một thẻ không xuất hiện hai lần trong ngày. */
function dealCards(state: GameState, config: GameConfig): GameState {
  state.anchors = {};
  const order = shuffle(state.rng, config.anchors);
  state.rng = order.rng;
  const dealtToday = new Set<string>();

  for (const anchor of order.value) {
    if (dealtToday.size >= MAX_CARDS_PER_DAY) break;
    const candidates = config.cards.filter((c) => !dealtToday.has(c.id) && cardFits(c, anchor, state));
    if (candidates.length === 0) continue;
    const fresh = candidates.filter((c) => !state.usedCards.includes(c.id));
    const pool = fresh.length > 0 ? fresh : candidates;
    const pick = nextInt(state.rng, 0, pool.length - 1);
    state.rng = pick.rng;
    const card = pool[pick.value]!;
    dealtToday.add(card.id);
    state.anchors[anchor.id] = { anchorId: anchor.id, cardId: card.id, status: "open", participants: [] };
  }
  return state;
}

function advance(state: GameState, atCamp: string[] | undefined, config: GameConfig): GameState {
  switch (state.phase) {
    case "dawn":
      state.phase = "explore";
      return state;
    case "explore":
      // Hết giờ khám phá mà sự kiện còn dở: người mở thẻ coi như chọn lựa chọn đầu tiên.
      for (const placed of Object.values(state.anchors)) {
        if (placed.status !== "active") continue;
        const card = cardById(config, placed.cardId);
        choose(state, placed.participants[0]!, placed.anchorId, card.choices[0]!.id, config);
        if (isOver(state)) return state;
      }
      state.phase = "dusk";
      return state;
    case "dusk":
      return nightfall(state, atCamp ?? []);
    case "night":
      resolveNight(state);
      if (isOver(state)) return state;
      if (state.day >= TOTAL_DAYS) return endGame(state);
      return beginDay(state, config);
    default:
      fail(`Không thể sang pha kế tiếp từ "${state.phase}"`);
  }
}

/** Hoàng hôn khép lại: ai ngoài trại phải ngủ ngoài; ai trong trại ngồi quanh đống lửa. */
function nightfall(state: GameState, atCamp: string[]): GameState {
  const sleptOutside: string[] = [];
  state.campers = [];
  state.votes = { ration: {}, tie: {} };

  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (!p.alive) continue;
    p.lost = false;
    p.tied = false;
    p.hunger = clamp(p.hunger - DAILY_HUNGER, 0, 100);
    if (atCamp.includes(id)) {
      state.campers.push(id);
    } else {
      sleptOutside.push(id);
      p.morale = clamp(p.morale - 15, 0, 100);
      p.hp = clamp(p.hp - 10, 0, p.maxHp);
    }
  }
  state.log.push({ kind: "dusk", day: state.day, sleptOutside });
  state.phase = "night";
  return checkDeaths(state);
}

function vote(state: GameState, action: Extract<GameAction, { type: "vote" }>): GameState {
  if (state.phase !== "night") fail("Chỉ bỏ phiếu được ban đêm");
  if (!state.campers.includes(action.playerId) || !state.players[action.playerId]?.alive) {
    fail("Chỉ người ngồi quanh đống lửa mới được bỏ phiếu");
  }
  if (action.ballot === "ration") {
    if (!RATION_IDS.includes(action.choice)) fail("Không có cách chia này");
    state.votes.ration[action.playerId] = action.choice;
  } else {
    const valid = action.choice === NO_TIE || (state.campers.includes(action.choice) && action.choice !== action.playerId);
    if (!valid) fail("Chỉ trói được người đang ở trong trại, và không tự trói mình");
    state.votes.tie[action.playerId] = action.choice;
  }
  return state;
}

/** Cách chia được nhiều phiếu nhất; hoà hoặc không ai bầu thì chia đều. */
export function rationResult(votes: NightVotes): RationId {
  const counts = new Map<RationId, number>();
  for (const choice of Object.values(votes.ration)) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) return "normal";
  return ranked[0]![0];
}

/** Người bị trói nếu quá nửa số người quanh đống lửa cùng chỉ vào họ. */
export function tieResult(votes: NightVotes, campers: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes.tie)) {
    if (target !== NO_TIE) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  for (const [target, n] of counts) if (n > campers.length / 2) return target;
  return null;
}

/** Hết đêm: chia lương thực theo phiếu, trói người bị nghi, ai đói lả thì mất máu. */
function resolveNight(state: GameState) {
  const ration = rationResult(state.votes);
  const campers = state.campers.map((id) => state.players[id]!).filter((p) => p.alive);
  let ate = 0;
  const eat = (p: PlayerSheet): boolean => {
    if (state.food === 0) return false;
    state.food--;
    ate++;
    p.hunger = clamp(p.hunger + MEAL_HUNGER, 0, 100);
    return true;
  };

  switch (ration) {
    case "full":
      // Mỗi người một phần trước, còn dư mới ăn phần thứ hai; ăn no thì vui hơn.
      for (const p of campers) eat(p);
      for (const p of campers) if (eat(p)) p.morale = clamp(p.morale + 5, 0, 100);
      break;
    case "normal":
      for (const p of campers) eat(p);
      break;
    case "half":
      // Hai người chung một khẩu phần.
      for (let i = 0; i < campers.length; i += 2) {
        if (state.food === 0) break;
        state.food--;
        ate++;
        for (const p of campers.slice(i, i + 2)) p.hunger = clamp(p.hunger + MEAL_HUNGER / 2, 0, 100);
      }
      break;
    case "skip":
      for (const p of campers) p.morale = clamp(p.morale - 5, 0, 100);
      break;
  }

  const tied = tieResult(state.votes, state.campers);
  if (tied) state.players[tied]!.tied = true;

  const starving: string[] = [];
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (p.alive && p.hunger === 0) {
      starving.push(id);
      p.hp = clamp(p.hp - STARVING_DAMAGE, 0, p.maxHp);
    }
  }
  state.log.push({ kind: "night", day: state.day, ration, ate, starving, tied });
  state.campers = [];
  state.votes = { ration: {}, tie: {} };
  checkDeaths(state);
}

function endGame(state: GameState): GameState {
  state.phase = "ended";
  state.volcano = 100;
  const anyAlive = Object.values(state.players).some((p) => p.alive);
  // Chưa có thuyền và đào kho báu: tạm coi ai còn sống là rời đảo kịp.
  state.ending = !anyAlive ? "buried" : state.treasure >= 100 ? "treasure_home" : "empty_handed";
  return state;
}

function checkDeaths(state: GameState): GameState {
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (p.alive && p.hp <= 0) {
      p.alive = false;
      state.log.push({ kind: "death", day: state.day, playerId: id });
    }
  }
  if (state.playerOrder.length > 0 && state.playerOrder.every((id) => !state.players[id]!.alive)) {
    state.phase = "ended";
    state.ending = "buried";
  }
  return state;
}

// ---------- Điểm sự kiện ----------

export function isBusy(state: GameState, playerId: string): boolean {
  return Object.values(state.anchors).some((a) => a.status === "active" && a.participants.includes(playerId));
}

export function canAct(state: GameState, playerId: string): boolean {
  const p = state.players[playerId];
  return !!p && p.alive && !p.lost && !p.tied && !isBusy(state, playerId);
}

function trigger(state: GameState, playerId: string, anchorId: string, participants: string[]): GameState {
  if (state.phase !== "explore") fail("Chỉ mở thẻ được trong giờ khám phá");
  const placed = state.anchors[anchorId];
  if (!placed || placed.status !== "open") fail("Điểm này không có thẻ đang chờ");
  if (!canAct(state, playerId)) fail("Người chơi không thể mở thẻ lúc này");

  const others = participants.filter((id) => id !== playerId && canAct(state, id));
  placed.status = "active";
  placed.participants = [playerId, ...new Set(others)];
  return state;
}

function cardById(config: GameConfig, cardId: string): EventCard {
  return config.cards.find((c) => c.id === cardId) ?? fail(`Không có thẻ "${cardId}"`);
}

/** Các khoản cộng/trừ cho phép kiểm tra: đồ người chọn đang mang và trạng thái xấu. */
export function checkModifiers(player: PlayerSheet, choice: CardChoice, config: GameConfig): Modifier[] {
  const modifiers: Modifier[] = [];
  for (const [itemId, bonus] of Object.entries(choice.check.itemBonus ?? {})) {
    if (player.items.includes(itemId)) {
      const name = config.items.find((i) => i.id === itemId)?.name ?? itemId;
      modifiers.push({ label: name, value: bonus });
    }
  }
  if (player.hunger === 0) modifiers.push({ label: "Kiệt sức", value: -2 });
  if (player.morale === 0) modifiers.push({ label: "Hoảng loạn", value: -2 });
  return modifiers;
}

function choose(state: GameState, playerId: string, anchorId: string, choiceId: string, config: GameConfig): GameState {
  const placed = state.anchors[anchorId];
  if (!placed || placed.status !== "active") fail("Thẻ này không đang mở");
  if (!placed.participants.includes(playerId)) fail("Chỉ người đang đứng ở đó mới được chọn");
  const card = cardById(config, placed.cardId);
  const choice = card.choices.find((c) => c.id === choiceId) ?? fail(`Thẻ ${card.id} không có lựa chọn "${choiceId}"`);
  const chooser = state.players[playerId]!;

  const rolled = rollCheck(state.rng, {
    stat: choice.check.stat,
    dc: choice.check.dc,
    stats: chooser.stats,
    modifiers: checkModifiers(chooser, choice, config),
  });
  state.rng = rolled.rng;

  applyOutcome(state, rolled.result.success ? choice.onSuccess : choice.onFail, chooser, placed.participants);
  placed.status = "resolved";
  if (card.sceneState) state.sceneStates[anchorId] = card.sceneState.onAny;
  if (!state.usedCards.includes(card.id)) state.usedCards.push(card.id);
  state.log.push({
    kind: "check",
    day: state.day,
    playerId,
    participants: placed.participants,
    anchorId,
    cardId: card.id,
    choiceId,
    result: rolled.result,
  });
  return checkDeaths(state);
}

function applyOutcome(state: GameState, outcome: Outcome, chooser: PlayerSheet, participantIds: string[]) {
  for (const id of participantIds) {
    const p = state.players[id]!;
    if (outcome.hp) p.hp = clamp(p.hp + outcome.hp, 0, p.maxHp);
    if (outcome.morale) p.morale = clamp(p.morale + outcome.morale, 0, 100);
    if (outcome.hunger) p.hunger = clamp(p.hunger + outcome.hunger, 0, 100);
    if (outcome.stamina) p.stamina = clamp(p.stamina + outcome.stamina, 0, 100);
    if (outcome.lostUntilDusk) p.lost = true;
  }

  for (let i = 0; i < (outcome.loseRandomItem ?? 0) && chooser.items.length > 0; i++) {
    const r = nextInt(state.rng, 0, chooser.items.length - 1);
    state.rng = r.rng;
    chooser.items.splice(r.value, 1);
  }
  if (outcome.gainItem) chooser.items.push(outcome.gainItem);

  if (outcome.food) state.food = Math.max(0, state.food + outcome.food);
  if (outcome.treasure) state.treasure = clamp(state.treasure + outcome.treasure, 0, 100);
  if (outcome.hull) state.hull = clamp(state.hull + outcome.hull, 0, 100);
  if (outcome.setFlag && !state.flags.includes(outcome.setFlag)) state.flags.push(outcome.setFlag);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
