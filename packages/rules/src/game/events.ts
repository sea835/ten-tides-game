import type { CardChoice, EventCard, Outcome } from "../cards.ts";
import { rollCheck, type Modifier } from "../dice.ts";
import { nextFloat, nextInt } from "../rng.ts";
import type { ZoneId } from "../stats.ts";
import { activePairs, bagWeight, capacityKg, lookupFrom } from "./backpack.ts";
import {
  BACKGROUNDS,
  BACKGROUND_TITLES,
  CLUMSY_DROP_CHANCE,
  FLAW_TITLES,
  FLAW_ZONE_PENALTY,
  LIAR_STAT,
  POWDER_KEG_CHANCE,
  POWDER_KEG_DAMAGE,
} from "./character.ts";
import { gainItem, removeItemAt } from "./inventory.ts";
import { checkDeaths } from "./endings.ts";
import { DIFFICULTIES, DIG_ITEM, TREASURE_REVEAL, clamp, fail, type Difficulty, type GameConfig, type GameState, type PlayerSheet } from "./types.ts";

export function isBusy(state: GameState, playerId: string): boolean {
  return Object.values(state.anchors).some((a) => a.status === "active" && a.participants.includes(playerId));
}

export function canAct(state: GameState, playerId: string): boolean {
  const p = state.players[playerId];
  return !!p && p.alive && !p.lost && !p.tied && !isBusy(state, playerId);
}

export function cardById(config: GameConfig, cardId: string): EventCard {
  return config.cards.find((c) => c.id === cardId) ?? fail(`Không có thẻ "${cardId}"`);
}

export function effectiveDc(dc: number, difficulty: Difficulty): number {
  return dc + DIFFICULTIES[difficulty].dcOffset;
}

export type CheckingPlayer = Pick<PlayerSheet, "stats" | "items" | "hunger" | "morale" | "background" | "flaw" | "bag">;

export function isOverweight(player: Pick<PlayerSheet, "stats" | "bag">, config: GameConfig): boolean {
  return bagWeight(player.bag, lookupFrom(config.items)) > capacityKg(player.stats.strength);
}

/**
 * Các khoản cộng/trừ cho phép kiểm tra, hiện công khai cạnh xúc xắc: đồ đang mang, xuất thân, tật xấu,
 * đồ đặt cạnh nhau trong balo, quá tải và trạng thái xấu.
 */
export function checkModifiers(player: CheckingPlayer, choice: CardChoice, config: GameConfig, zone?: ZoneId): Modifier[] {
  const modifiers: Modifier[] = [];
  const stat = choice.check.stat;
  for (const [itemId, bonus] of Object.entries(choice.check.itemBonus ?? {})) {
    if (player.items.includes(itemId)) {
      const name = config.items.find((i) => i.id === itemId)?.name ?? itemId;
      modifiers.push({ label: name, value: bonus });
    }
  }
  const bg = BACKGROUNDS[player.background];
  if ((zone && bg.zoneBonus?.includes(zone)) || bg.statBonus === stat) {
    modifiers.push({ label: BACKGROUND_TITLES[player.background], value: 2 });
  }
  if (zone && FLAW_ZONE_PENALTY[player.flaw] === zone) modifiers.push({ label: FLAW_TITLES[player.flaw], value: -2 });
  if (player.flaw === "liar" && stat === LIAR_STAT) modifiers.push({ label: FLAW_TITLES.liar, value: -2 });
  const pairs = activePairs(player.bag, lookupFrom(config.items));
  if (stat === "intellect" && (pairs.includes("night_reading") || pairs.includes("true_north"))) {
    modifiers.push({ label: "Bản đồ soi đèn", value: 2 });
  }
  if ((stat === "strength" || stat === "dexterity") && isOverweight(player, config)) modifiers.push({ label: "Quá tải", value: -2 });
  if (player.hunger === 0) modifiers.push({ label: "Kiệt sức", value: -2 });
  if (player.morale === 0) modifiers.push({ label: "Hoảng loạn", value: -2 });
  return modifiers;
}

export function anchorZone(config: GameConfig, anchorId: string): ZoneId | undefined {
  return config.anchors.find((a) => a.id === anchorId)?.zone;
}

/** Xác suất qua phép kiểm tra (0–1), để hiện cho người chơi trước khi chọn. */
export function successChance(
  player: CheckingPlayer,
  choice: CardChoice,
  config: GameConfig,
  difficulty: Difficulty,
  zone?: ZoneId,
): number {
  const bonus =
    player.stats[choice.check.stat] + checkModifiers(player, choice, config, zone).reduce((sum, m) => sum + m.value, 0);
  const needed = effectiveDc(choice.check.dc, difficulty) - bonus;
  return clamp((21 - needed) / 20, 0, 1);
}

export function trigger(state: GameState, playerId: string, anchorId: string, participants: string[]): GameState {
  if (state.phase !== "explore") fail("Chỉ mở thẻ được trong giờ khám phá");
  const placed = state.anchors[anchorId];
  if (!placed || placed.status !== "open") fail("Điểm này không có thẻ đang chờ");
  if (!canAct(state, playerId)) fail("Người chơi không thể mở thẻ lúc này");

  const others = participants.filter((id) => id !== playerId && canAct(state, id));
  placed.status = "active";
  placed.participants = [playerId, ...new Set(others)];
  return state;
}

export function choose(state: GameState, playerId: string, anchorId: string, choiceId: string, config: GameConfig): GameState {
  const placed = state.anchors[anchorId];
  if (!placed || placed.status !== "active") fail("Thẻ này không đang mở");
  if (!placed.participants.includes(playerId)) fail("Chỉ người đang đứng ở đó mới được chọn");
  const card = cardById(config, placed.cardId);
  const choice = card.choices.find((c) => c.id === choiceId) ?? fail(`Thẻ ${card.id} không có lựa chọn "${choiceId}"`);
  const chooser = state.players[playerId]!;

  const dc = effectiveDc(choice.check.dc, state.difficulty);
  const zone = anchorZone(config, anchorId);
  const input = { stat: choice.check.stat, dc, stats: chooser.stats, modifiers: checkModifiers(chooser, choice, config, zone) };
  let rolled = rollCheck(state.rng, input);
  state.rng = rolled.rng;
  // Tay cờ bạc: lần thua đầu tiên trong ngày được tung lại, ai cũng thấy.
  if (!rolled.result.success && chooser.background === "gambler" && !chooser.rerolledToday) {
    chooser.rerolledToday = true;
    const first = rolled.result.roll;
    rolled = rollCheck(state.rng, input);
    state.rng = rolled.rng;
    rolled.result.rerolledFrom = first;
  }
  const result = rolled.result;
  const chance = () => {
    const r = nextFloat(state.rng);
    state.rng = r.rng;
    return r.value;
  };

  // "Vì sao thua": những món mà nếu có trong balo thì đã qua.
  const wouldPassWith = result.success
    ? []
    : Object.entries(choice.check.itemBonus ?? {})
        .filter(([id, bonus]) => !chooser.items.includes(id) && result.total + bonus >= dc)
        .map(([id]) => id);

  applyOutcome(state, result.success ? choice.onSuccess : choice.onFail, chooser, placed.participants, config);

  let dropped: string | null = null;
  let exploded = false;
  if (!result.success) {
    if (chooser.flaw === "clumsy" && chooser.items.length > 0 && chance() < CLUMSY_DROP_CHANCE) {
      dropped = removeItemAt(chooser, Math.floor(chance() * chooser.items.length));
    }
    if (activePairs(chooser.bag, lookupFrom(config.items)).includes("powder_keg") && chance() < POWDER_KEG_CHANCE) {
      exploded = true;
      chooser.hp = clamp(chooser.hp - POWDER_KEG_DAMAGE, 0, chooser.maxHp);
    }
  }
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
    result,
    wouldPassWith,
    dropped,
    exploded,
  });
  return checkDeaths(state);
}

/** Không ai chọn (hết giờ): người mở thẻ coi như chọn lựa chọn đầu tiên. */
export function autoResolve(state: GameState, anchorId: string, config: GameConfig): GameState {
  const placed = state.anchors[anchorId];
  if (!placed || placed.status !== "active") fail("Thẻ này không đang mở");
  const card = cardById(config, placed.cardId);
  return choose(state, placed.participants[0]!, anchorId, card.choices[0]!.id, config);
}

function applyOutcome(state: GameState, outcome: Outcome, chooser: PlayerSheet, participantIds: string[], config: GameConfig) {
  const present = participantIds.map((id) => state.players[id]!);
  // Có y sĩ bỏ nghề ở đó thì chữa trị hiệu quả gấp đôi; có thợ săn thì kiếm thêm được thức ăn.
  const heal = present.some((p) => p.background === "ex_medic") ? 2 : 1;
  const extraFood = outcome.food && outcome.food > 0 && present.some((p) => p.background === "hunter") ? 1 : 0;
  for (const p of present) {
    if (outcome.hp) p.hp = clamp(p.hp + (outcome.hp > 0 ? outcome.hp * heal : outcome.hp), 0, p.maxHp);
    if (outcome.morale) p.morale = clamp(p.morale + outcome.morale, 0, 100);
    if (outcome.hunger) p.hunger = clamp(p.hunger + outcome.hunger, 0, 100);
    if (outcome.stamina) p.stamina = clamp(p.stamina + outcome.stamina, 0, 100);
    if (outcome.lostUntilDusk) p.lost = true;
  }

  for (let i = 0; i < (outcome.loseRandomItem ?? 0) && chooser.items.length > 0; i++) {
    const r = nextInt(state.rng, 0, chooser.items.length - 1);
    state.rng = r.rng;
    removeItemAt(chooser, r.value);
  }
  // Balo đầy thì món nhặt được phải bỏ lại.
  if (outcome.gainItem) gainItem(state, chooser, outcome.gainItem, config);

  if (outcome.food) state.food = Math.max(0, state.food + outcome.food + extraFood);
  if (outcome.treasure) state.treasure = clamp(state.treasure + outcome.treasure, 0, 100);
  if (outcome.hull) state.hull = clamp(state.hull + outcome.hull, 0, 100);
  if (outcome.setFlag && !state.flags.includes(outcome.setFlag)) state.flags.push(outcome.setFlag);
}


/** Tiến độ kho báu đủ thì ai cũng biết chỗ đào. */
export function treasureRevealed(state: Pick<GameState, "treasure">): boolean {
  return state.treasure >= TREASURE_REVEAL;
}

/** Đào kho báu: cần biết chỗ, cần xẻng, và rương chưa bị ai đào lên. Server đã kiểm tra người đào đứng đúng chỗ. */
export function dig(state: GameState, playerId: string): GameState {
  if (state.phase !== "explore") fail("Chỉ đào được trong giờ khám phá");
  if (!treasureRevealed(state)) fail("Chưa biết chính xác chỗ đào");
  if (state.treasureDug) fail("Rương đã được đào lên rồi");
  if (!canAct(state, playerId)) fail("Bạn không đào được lúc này");
  if (!state.players[playerId]!.items.includes(DIG_ITEM)) fail("Cần có xẻng mới đào được");
  state.treasureDug = true;
  state.treasureCarrier = playerId;
  state.treasureSafe = false;
  state.log.push({ kind: "dig", day: state.day, playerId });
  return state;
}
