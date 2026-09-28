import type { AnchorDef, EventCard } from "../cards.ts";
import { nextInt, shuffle } from "../rng.ts";
import { autoResolve } from "./events.ts";
import { departure } from "./endings.ts";
import { nightfall, resolveNight } from "./night.ts";
import { MAX_CARDS_PER_DAY, TOTAL_DAYS, actOf, fail, isOver, weatherOf, type GameConfig, type GameState } from "./types.ts";

export function beginDay(state: GameState, config: GameConfig): GameState {
  state.day++;
  state.phase = "dawn";
  state.volcano = state.day * 10;
  for (const p of Object.values(state.players)) {
    p.stamina = 100;
    p.rerolledToday = false;
  }
  return dealCards(state, config);
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

export function advance(state: GameState, atCamp: string[] | undefined, config: GameConfig): GameState {
  switch (state.phase) {
    case "dawn":
      state.phase = "explore";
      return state;
    case "explore":
      // Hết giờ khám phá mà sự kiện còn dở: người mở thẻ coi như chọn lựa chọn đầu tiên.
      for (const placed of Object.values(state.anchors)) {
        if (placed.status !== "active") continue;
        autoResolve(state, placed.anchorId, config);
        if (isOver(state)) return state;
      }
      state.phase = "dusk";
      return state;
    case "dusk":
      // Tối ngày cuối không có đêm: thuyền rời bến, núi lửa phun.
      if (state.day >= TOTAL_DAYS) return departure(state, atCamp ?? []);
      return nightfall(state, atCamp ?? [], config);
    case "night":
      resolveNight(state, config);
      if (isOver(state)) return state;
      return beginDay(state, config);
    default:
      fail(`Không thể sang pha kế tiếp từ "${state.phase}"`);
  }
}
