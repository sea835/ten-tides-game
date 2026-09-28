import { z } from "zod";
import type { GameConfig } from "@tentides/rules";
import { EventCardSchema, ItemSchema, STORY_CATEGORIES, StoryElementSchema, StoryTemplatesSchema, type EventCard, type Item, type StoryElement, type StoryTemplates } from "./schema.ts";
import { ANCHORS, TREASURE_SITES } from "./island.ts";
import itemsJson from "./data/items.json" with { type: "json" };
import cardsJson from "./data/cards.json" with { type: "json" };
import storyJson from "./data/story.json" with { type: "json" };
import storyTemplatesJson from "./data/story_templates.json" with { type: "json" };

export interface Content {
  items: ReadonlyMap<string, Item>;
  cards: ReadonlyMap<string, EventCard>;
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
export function loadContent(raw: { items: unknown; cards: unknown }): Content {
  const items = indexById("Đồ", z.array(ItemSchema).parse(raw.items));
  const cards = indexById("Thẻ sự kiện", z.array(EventCardSchema).parse(raw.cards));
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
  return { items, cards };
}

export const content: Content = loadContent({ items: itemsJson, cards: cardsJson });

/** Cấu hình cho engine luật, dựng từ nội dung đã kiểm tra. */
export const gameConfig: GameConfig = {
  cards: [...content.cards.values()],
  anchors: ANCHORS,
  items: [...content.items.values()].map(({ id, name, size, weightKg, price, tags }) => ({ id, name, size, weightKg, price, tags })),
  treasureSites: TREASURE_SITES,
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
  return { elements, templates: StoryTemplatesSchema.parse(raw.templates) };
}

export const storyLibrary: StoryLibrary = loadStoryLibrary({ elements: storyJson, templates: storyTemplatesJson });
