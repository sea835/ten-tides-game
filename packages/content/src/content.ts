import { z } from "zod";
import { EventCardSchema, ItemSchema, type EventCard, type Item } from "./schema.ts";
import itemsJson from "./data/items.json" with { type: "json" };
import caveCollapse01 from "./data/events/cave_collapse_01.json" with { type: "json" };

export interface Content {
  items: ReadonlyMap<string, Item>;
  events: ReadonlyMap<string, EventCard>;
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
export function loadContent(raw: { items: unknown; events: unknown[] }): Content {
  const items = indexById("Đồ", z.array(ItemSchema).parse(raw.items));
  const events = indexById("Thẻ sự kiện", raw.events.map((e) => EventCardSchema.parse(e)));

  for (const card of events.values()) {
    for (const choice of card.choices) {
      for (const itemId of Object.keys(choice.check.itemBonus ?? {})) {
        if (!items.has(itemId)) {
          throw new Error(`Thẻ ${card.id}, lựa chọn ${choice.id}: itemBonus tham chiếu đồ không tồn tại "${itemId}"`);
        }
      }
    }
  }
  return { items, events };
}

export const content: Content = loadContent({ items: itemsJson, events: [caveCollapse01] });
