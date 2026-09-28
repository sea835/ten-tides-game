// Balo 16x16: mỗi món là một khối chữ nhật chiếm nhiều ô, xoay được. Ba giới hạn chạy cùng lúc:
// ô trống, trọng lượng (theo Thể lực) và ngân sách. Hàm ở đây là hàm thuần, dùng chung cho engine,
// bot và giao diện kéo thả trên client.

import type { ItemDef } from "../cards.ts";

export const GRID_SIZE = 16;
/** Ngăn bí mật 4x4 ở góc dưới phải: đồ nằm trọn trong đó thì đồng đội không thấy. */
export const COMPARTMENT = { x: 12, y: 12, size: 4 } as const;
export const BASE_BUDGET = 60;

export type Rotation = 0 | 1;

export interface Placement {
  uid: string;
  itemId: string;
  x: number;
  y: number;
  rot: Rotation;
}

export interface TrayItem {
  uid: string;
  itemId: string;
}

/** Cặp đồ đặt cạnh nhau tạo hiệu ứng (theo PROJECT.md: đèn dầu cạnh bản đồ, thuốc súng cạnh diêm...). */
export const ADJACENCY_PAIRS = [
  { id: "night_reading", a: "lantern", b: "old_map" },
  { id: "powder_keg", a: "gunpowder", b: "matches" },
  { id: "repair_kit", a: "hammer", b: "rope" },
  { id: "true_north", a: "compass", b: "old_map" },
] as const;
export type AdjacencyId = (typeof ADJACENCY_PAIRS)[number]["id"];

export function capacityKg(strength: number): number {
  return 8 + 3 * strength;
}

export function footprint(item: Pick<ItemDef, "size">, rot: Rotation): { w: number; h: number } {
  return rot === 0 ? item.size : { w: item.size.h, h: item.size.w };
}

function cells(item: Pick<ItemDef, "size">, x: number, y: number, rot: Rotation): [number, number][] {
  const { w, h } = footprint(item, rot);
  const out: [number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([x + dx, y + dy]);
  return out;
}

type ItemLookup = (itemId: string) => ItemDef | undefined;

export function lookupFrom(items: readonly ItemDef[]): ItemLookup {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id) => map.get(id);
}

/** Đặt được không: nằm trong lưới và không đè lên món khác (bỏ qua chính món đang được dời). */
export function canPlace(bag: readonly Placement[], item: ItemDef, x: number, y: number, rot: Rotation, lookup: ItemLookup, ignoreUid?: string): boolean {
  const { w, h } = footprint(item, rot);
  if (x < 0 || y < 0 || x + w > GRID_SIZE || y + h > GRID_SIZE) return false;
  const taken = new Set<string>();
  for (const p of bag) {
    if (p.uid === ignoreUid) continue;
    const def = lookup(p.itemId);
    if (!def) continue;
    for (const [cx, cy] of cells(def, p.x, p.y, p.rot)) taken.add(`${cx},${cy}`);
  }
  return cells(item, x, y, rot).every(([cx, cy]) => !taken.has(`${cx},${cy}`));
}

/** Chỗ trống đầu tiên đủ cho món đồ (quét từng hàng, thử cả hai hướng), tránh ngăn bí mật nếu được. */
export function firstFit(bag: readonly Placement[], item: ItemDef, lookup: ItemLookup): { x: number; y: number; rot: Rotation } | null {
  for (const avoidCompartment of [true, false]) {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        for (const rot of [0, 1] as const) {
          if (!canPlace(bag, item, x, y, rot, lookup)) continue;
          if (avoidCompartment && touchesCompartment(item, x, y, rot)) continue;
          return { x, y, rot };
        }
      }
    }
  }
  return null;
}

function touchesCompartment(item: Pick<ItemDef, "size">, x: number, y: number, rot: Rotation): boolean {
  return cells(item, x, y, rot).some(([cx, cy]) => cx >= COMPARTMENT.x && cy >= COMPARTMENT.y);
}

/** Món nằm trọn trong ngăn bí mật thì không ai khác thấy. */
export function inCompartment(p: Placement, lookup: ItemLookup): boolean {
  const def = lookup(p.itemId);
  if (!def) return false;
  return cells(def, p.x, p.y, p.rot).every(([cx, cy]) => cx >= COMPARTMENT.x && cy >= COMPARTMENT.y);
}

export function bagWeight(bag: readonly Placement[], lookup: ItemLookup): number {
  return bag.reduce((sum, p) => sum + (lookup(p.itemId)?.weightKg ?? 0), 0);
}

function adjacent(a: Placement, b: Placement, lookup: ItemLookup): boolean {
  const da = lookup(a.itemId);
  const db = lookup(b.itemId);
  if (!da || !db) return false;
  const bCells = new Set(cells(db, b.x, b.y, b.rot).map(([x, y]) => `${x},${y}`));
  return cells(da, a.x, a.y, a.rot).some(([x, y]) =>
    [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].some(([nx, ny]) => bCells.has(`${nx},${ny}`)),
  );
}

/** Những cặp hiệu ứng đang có hiệu lực trong balo. */
export function activePairs(bag: readonly Placement[], lookup: ItemLookup): AdjacencyId[] {
  const out: AdjacencyId[] = [];
  for (const pair of ADJACENCY_PAIRS) {
    const as = bag.filter((p) => p.itemId === pair.a);
    const bs = bag.filter((p) => p.itemId === pair.b);
    if (as.some((a) => bs.some((b) => adjacent(a, b, lookup)))) out.push(pair.id);
  }
  return out;
}
