// Đồ đạc trong ván: mọi thay đổi balo (mất, được, bị trộm) đi qua đây để `bag` và `items` luôn khớp nhau.

import { firstFit, inCompartment, lookupFrom, type Placement } from "./backpack.ts";
import type { GameConfig, GameState, PlayerSheet } from "./types.ts";

export function syncItems(p: PlayerSheet) {
  p.items = p.bag.map((b) => b.itemId);
}

export function newUid(state: GameState): string {
  return `i${state.nextUid++}`;
}

/** Bỏ món thứ `index` trong danh sách đồ, trả về id món đó. */
export function removeItemAt(p: PlayerSheet, index: number): string {
  const [removed] = p.bag.splice(index, 1) as [Placement];
  syncItems(p);
  return removed.itemId;
}

/** Nhận thêm một món: tự xếp vào chỗ trống đầu tiên; balo đầy thì phải bỏ lại. Trả về có nhận được không. */
export function gainItem(state: GameState, p: PlayerSheet, itemId: string, config: GameConfig, uid = newUid(state)): boolean {
  const lookup = lookupFrom(config.items);
  const def = lookup(itemId);
  if (!def) return false;
  const spot = firstFit(p.bag, def, lookup);
  if (!spot) return false;
  p.bag.push({ uid, itemId, ...spot });
  syncItems(p);
  return true;
}

/** Đồ đồng đội nhìn thấy được: mọi thứ trừ đồ nằm trong ngăn bí mật. */
export function visibleItems(p: PlayerSheet, config: GameConfig): string[] {
  const lookup = lookupFrom(config.items);
  return p.bag.filter((b) => !inCompartment(b, lookup)).map((b) => b.itemId);
}
