import { nextFloat, nextInt, shuffle, type RngState } from "../rng.ts";
import { chooseTwist } from "./twists.ts";
import type { Stats } from "../stats.ts";
import { WEATHER_WEIGHTS } from "../weather.ts";
import { BASE_BUDGET } from "./backpack.ts";
import { BACKGROUNDS, applyBackgroundStats, randomCharacter, type CharacterChoice } from "./character.ts";
import { DIG_ITEM, DIFFICULTIES, MIN_PLAYERS_FOR_ROLES, NURSE_CHANCE, TOTAL_DAYS, TRAITOR_CHANCE, fail, type Difficulty, type GameConfig, type GameState, type PlayerSheet } from "./types.ts";

/** Cửa hàng mỗi ván bày khoảng chừng này phần đồ (luôn có xẻng, vì không có xẻng thì không đào được kho báu). */
export const SHOP_SHARE = 0.7;

/** Chỉ số sinh tồn suy ra từ thuộc tính. */
export function applyCharacter(p: PlayerSheet, choice: CharacterChoice) {
  const stats: Stats = applyBackgroundStats(choice.stats, choice.background);
  p.stats = stats;
  p.background = choice.background;
  p.flaw = choice.flaw;
  p.bio = choice.bio;
  p.maxHp = 60 + stats.strength * 10;
  p.hp = p.maxHp;
  p.morale = Math.min(100, 40 + stats.nerve * 10);
  p.budget = BASE_BUDGET + (BACKGROUNDS[choice.background].budgetBonus ?? 0);
}

export function join(state: GameState, playerId: string, name: string): GameState {
  if (state.phase !== "lobby") fail("Ván đã bắt đầu");
  if (state.players[playerId]) fail("Người chơi đã có trong ván");

  // Tạm cho một nhân vật ngẫu nhiên; người chơi sẽ tự tạo ở pha tạo nhân vật.
  const placeholder = randomCharacter(state.rng);
  state.rng = placeholder.rng;
  const p: PlayerSheet = {
    id: playerId,
    name,
    stats: placeholder.choice.stats,
    hp: 0,
    maxHp: 0,
    hunger: 80,
    morale: 0,
    stamina: 100,
    items: [],
    alive: true,
    lost: false,
    tied: false,
    role: "villager",
    protected: false,
    loot: [],
    background: placeholder.choice.background,
    flaw: placeholder.choice.flaw,
    bio: "",
    created: false,
    budget: 0,
    bag: [],
    tray: [],
    rerolledToday: false,
    failStreak: 0,
  };
  applyCharacter(p, placeholder.choice);
  state.players[playerId] = p;
  state.playerOrder.push(playerId);
  return state;
}

export function leave(state: GameState, playerId: string): GameState {
  if (state.phase !== "lobby") fail("Chỉ rời được khi ván chưa bắt đầu");
  delete state.players[playerId];
  state.playerOrder = state.playerOrder.filter((id) => id !== playerId);
  return state;
}

/** Bắt đầu ván: chốt thời tiết, vai ẩn, chỗ giấu kho báu và cửa hàng, rồi sang pha tạo nhân vật. */
export function start(state: GameState, difficulty: Difficulty, config: GameConfig): GameState {
  if (state.phase !== "lobby") fail("Ván đã bắt đầu");
  if (state.playerOrder.length === 0) fail("Chưa có ai trong phòng");
  if (!(difficulty in DIFFICULTIES)) fail("Không có độ khó này");

  state.difficulty = difficulty;
  const wake = nextInt(state.rng, 4, 6);
  state.rng = wake.rng;
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const table = WEATHER_WEIGHTS[day >= wake.value ? "awake" : "calm"];
    const r = weightedPick(state.rng, table);
    state.rng = r.rng;
    state.weather.push(r.value);
  }
  state.food = state.playerOrder.length * DIFFICULTIES[difficulty].foodPerPlayer;
  assignRoles(state);
  if (config.treasureSites.length === 0) fail("Nội dung chưa khai báo chỗ nào để giấu kho báu");
  const site = nextInt(state.rng, 0, config.treasureSites.length - 1);
  state.rng = site.rng;
  state.treasureSite = config.treasureSites[site.value]!.id;

  const stock = shuffle(
    state.rng,
    config.items.filter((i) => !i.loot && i.id !== DIG_ITEM).map((i) => i.id),
  );
  state.rng = stock.rng;
  const count = Math.max(1, Math.round(config.items.filter((i) => !i.loot).length * SHOP_SHARE) - 1);
  state.shop = [DIG_ITEM, ...stock.value.slice(0, count)].filter((id) => config.items.some((i) => i.id === id));
  chooseTwist(state);

  state.phase = "create";
  return state;
}

/**
 * Chia vai ẩn: từ 4 người, ván có thể có 0 hoặc 1 kẻ phản bội (cướp biển hoặc kẻ lừa đảo),
 * có thể có y tá; còn lại là người thường. Chính khả năng "chẳng có ai" giữ cho nghi ngờ luôn sống.
 */
function assignRoles(state: GameState) {
  const count = state.playerOrder.length;
  if (count < MIN_PLAYERS_FOR_ROLES) return;
  const roll = () => {
    const r = nextFloat(state.rng);
    state.rng = r.rng;
    return r.value;
  };
  const order = shuffle(state.rng, state.playerOrder);
  state.rng = order.rng;
  let next = 0;
  if (roll() < TRAITOR_CHANCE[Math.min(count, 6)]!) {
    state.players[order.value[next++]!]!.role = roll() < 0.5 ? "pirate" : "con";
  }
  if (roll() < NURSE_CHANCE) state.players[order.value[next++]!]!.role = "nurse";
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
