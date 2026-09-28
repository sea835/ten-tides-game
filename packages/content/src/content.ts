import { z } from "zod";
import type { GameConfig } from "@tentides/rules";
import { TWIST_IDS } from "@tentides/rules";
import { EventCardSchema, ItemSchema, OutsideEventSchema, STORY_CATEGORIES, StoryElementSchema, StoryTemplatesSchema, type EventCard, type Item, type OutsideEvent, type StoryElement, type StoryTemplates } from "./schema.ts";
import { ANCHORS, TREASURE_SITES } from "./island.ts";
import itemsJson from "./data/items.json" with { type: "json" };
import cardsJson from "./data/cards.json" with { type: "json" };
import nightsJson from "./data/nights.json" with { type: "json" };
import storyJson from "./data/story.json" with { type: "json" };
import storyTemplatesJson from "./data/story_templates.json" with { type: "json" };

export interface Content {
  items: ReadonlyMap<string, Item>;
  cards: ReadonlyMap<string, EventCard>;
  /** Chuyện có thể xảy ra với người ngủ ngoài trại. */
  nights: ReadonlyMap<string, OutsideEvent>;
}

function indexById<T extends { id: string }>(kind: string, list: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of list) {
    if (map.has(entry.id)) throw new Error(`${kind} trùng id: ${entry.id}`);
    map.set(entry.id, entry);
  }
  return map;
}

/** Kiểm tra toàn bộ nội dung; ném lỗi nếu sai schema hoặc tham chiếu tới id không tồn tại. */
export function loadContent(raw: { items: unknown; cards: unknown; nights?: unknown }): Content {
  const items = indexById("Đồ", z.array(ItemSchema).parse(raw.items));
  const cards = indexById("Thẻ sự kiện", z.array(EventCardSchema).parse(raw.cards));
  const nights = indexById("Chuyện đêm ngủ ngoài", z.array(OutsideEventSchema).parse(raw.nights ?? []));
  const anchorTypes = new Set(ANCHORS.map((a) => a.type));

  const missingItem = (where: string, itemId: string) => {
    if (!items.has(itemId)) throw new Error(`${where}: tham chiếu đồ không tồn tại "${itemId}"`);
  };
  for (const card of cards.values()) {
    if (!anchorTypes.has(card.anchorType)) {
      throw new Error(`Thẻ ${card.id}: không có điểm sự kiện nào thuộc loại "${card.anchorType}"`);
    }
    for (const choice of card.choices) {
      const where = `Thẻ ${card.id}, lựa chọn ${choice.id}`;
      for (const itemId of Object.keys(choice.check.itemBonus ?? {})) missingItem(where, itemId);
      for (const outcome of [choice.onSuccess, choice.onFail]) {
        if (outcome.gainItem) missingItem(where, outcome.gainItem);
      }
    }
  }
  for (const item of items.values()) {
    if (item.cook) missingItem(`Đồ ${item.id} (nướng thành)`, item.cook);
  }
  for (const night of nights.values()) {
    const where = `Chuyện đêm ${night.id}`;
    for (const itemId of Object.keys(night.check.itemBonus ?? {})) missingItem(where, itemId);
    for (const outcome of [night.onSuccess, night.onFail]) if (outcome.gainItem) missingItem(where, outcome.gainItem);
  }
  // Thẻ đòi một cờ thì phải có thẻ khác (hoặc biến cố ngày 5) dựng cờ đó, không thì thẻ không bao giờ xuất hiện.
  const flagsSet = new Set([
    ...TWIST_IDS.map((t) => `twist_${t}`),
    ...[...cards.values()].flatMap((c) => c.choices.flatMap((ch) => [ch.onSuccess.setFlag, ch.onFail.setFlag])).filter((f): f is string => !!f),
  ]);
  for (const card of cards.values()) {
    for (const flag of card.requires?.flags ?? []) {
      if (!flagsSet.has(flag)) throw new Error(`Thẻ ${card.id}: đòi cờ "${flag}" mà không thẻ nào dựng cờ đó`);
    }
  }
  return { items, cards, nights };
}

export const content: Content = loadContent({ items: itemsJson, cards: cardsJson, nights: nightsJson });

/** Cấu hình cho engine luật, dựng từ nội dung đã kiểm tra. */
export const gameConfig: GameConfig = {
  cards: [...content.cards.values()],
  anchors: ANCHORS,
  items: [...content.items.values()].map(({ id, name, size, weightKg, price, tags, loot, eat, ration, cook }) => ({
    id,
    name,
    size,
    weightKg,
    price,
    tags,
    loot,
    eat,
    ration,
    cook,
  })),
  treasureSites: TREASURE_SITES,
  outsideEvents: [...content.nights.values()],
};

export interface StoryLibrary {
  elements: readonly StoryElement[];
  templates: StoryTemplates;
}

/** Thư viện yếu tố truyện và mẫu câu, đã kiểm tra: id không trùng, nhóm nào cũng có đủ yếu tố. */
export function loadStoryLibrary(raw: { elements: unknown; templates: unknown }): StoryLibrary {
  const elements = [...indexById("Yếu tố truyện", z.array(StoryElementSchema).parse(raw.elements)).values()];
  for (const category of STORY_CATEGORIES) {
    if (!elements.some((e) => e.category === category)) throw new Error(`Thư viện truyện thiếu nhóm "${category}"`);
  }
  // Biến cố ngày 5 do engine chọn; mỗi biến cố phải có một yếu tố truyện cùng id để kể.
  for (const twist of TWIST_IDS) {
    if (!elements.some((e) => e.category === "twist" && e.id === twist)) throw new Error(`Thư viện truyện thiếu biến cố "${twist}"`);
  }
  return { elements, templates: StoryTemplatesSchema.parse(raw.templates) };
}

export const storyLibrary: StoryLibrary = loadStoryLibrary({ elements: storyJson, templates: storyTemplatesJson });
