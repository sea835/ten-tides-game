// Hai pha chuẩn bị trước khi lên đảo: tạo nhân vật rồi mua đồ và xếp balo.

import { canPlace, firstFit, lookupFrom, type Rotation } from "./backpack.ts";
import { BACKGROUNDS, BIO_MAX_LENGTH, BACKGROUND_IDS, FLAW_IDS, randomCharacter, statsProblem, type CharacterChoice } from "./character.ts";
import { beginDay } from "./day.ts";
import { gainItem, newUid, syncItems } from "./inventory.ts";
import { applyCharacter } from "./lobby.ts";
import { RATIONS_PER_FOOD_ITEM, fail, type GameConfig, type GameState, type PlayerSheet } from "./types.ts";

const START_UID_PREFIX = "start-";

function sheet(state: GameState, playerId: string): PlayerSheet {
  return state.players[playerId] ?? fail("Không có người chơi này");
}

export function createCharacter(state: GameState, playerId: string, choice: CharacterChoice): GameState {
  if (state.phase !== "create") fail("Chỉ tạo nhân vật được ở pha tạo nhân vật");
  if (!BACKGROUND_IDS.includes(choice.background)) fail("Không có xuất thân này");
  if (!FLAW_IDS.includes(choice.flaw)) fail("Không có tật xấu này");
  const problem = statsProblem(choice.stats);
  if (problem) fail(problem);
  const p = sheet(state, playerId);
  // Dòng tự mô tả chỉ là dữ liệu: cắt độ dài, không bao giờ đọc như lệnh.
  applyCharacter(p, { ...choice, bio: choice.bio.trim().slice(0, BIO_MAX_LENGTH) });
  p.created = true;
  return state;
}

/** Hết giờ tạo nhân vật: ai chưa tạo thì nhận nhân vật ngẫu nhiên; ai cũng nhận món đồ của xuất thân. */
export function finishCreation(state: GameState, config: GameConfig): GameState {
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    if (!p.created) {
      const random = randomCharacter(state.rng);
      state.rng = random.rng;
      applyCharacter(p, random.choice);
      p.created = true;
    }
    gainItem(state, p, BACKGROUNDS[p.background].startItem, config, `${START_UID_PREFIX}${id}`);
  }
  state.phase = "pack";
  return state;
}

function requirePacking(state: GameState) {
  if (state.phase !== "pack") fail("Chỉ mua và xếp đồ được ở pha xếp balo");
}

export function buy(state: GameState, playerId: string, itemId: string, config: GameConfig): GameState {
  requirePacking(state);
  if (!state.shop.includes(itemId)) fail("Cửa hàng ván này không bán món này");
  const def = config.items.find((i) => i.id === itemId) ?? fail("Không có món này");
  const p = sheet(state, playerId);
  if (p.budget < def.price) fail("Không đủ tiền");
  p.budget -= def.price;
  p.tray.push({ uid: newUid(state), itemId });
  return state;
}

/** Bán lại món đang ở khay hoặc trong balo (hoàn đủ tiền). Đồ khởi đầu của xuất thân được cho không nên không bán được. */
export function sell(state: GameState, playerId: string, uid: string, config: GameConfig): GameState {
  requirePacking(state);
  if (uid.startsWith(START_UID_PREFIX)) fail("Đồ của xuất thân không bán được");
  const p = sheet(state, playerId);
  const inTray = p.tray.findIndex((t) => t.uid === uid);
  const inBag = p.bag.findIndex((b) => b.uid === uid);
  const itemId = inTray >= 0 ? p.tray[inTray]!.itemId : inBag >= 0 ? p.bag[inBag]!.itemId : fail("Không có món này");
  if (inTray >= 0) p.tray.splice(inTray, 1);
  else p.bag.splice(inBag, 1);
  p.budget += config.items.find((i) => i.id === itemId)!.price;
  syncItems(p);
  return state;
}

/** Đặt (hoặc dời) một món vào balo ở vị trí và hướng cho trước. */
export function place(state: GameState, playerId: string, uid: string, x: number, y: number, rot: Rotation, config: GameConfig): GameState {
  requirePacking(state);
  const p = sheet(state, playerId);
  const lookup = lookupFrom(config.items);
  const fromTray = p.tray.findIndex((t) => t.uid === uid);
  const fromBag = p.bag.findIndex((b) => b.uid === uid);
  const itemId = fromTray >= 0 ? p.tray[fromTray]!.itemId : fromBag >= 0 ? p.bag[fromBag]!.itemId : fail("Không có món này");
  if (!canPlace(p.bag, lookup(itemId)!, x, y, rot, lookup, uid)) fail("Chỗ đó không vừa");
  if (fromTray >= 0) {
    p.tray.splice(fromTray, 1);
    p.bag.push({ uid, itemId, x, y, rot });
  } else {
    p.bag[fromBag] = { uid, itemId, x, y, rot };
  }
  syncItems(p);
  return state;
}

/** Nhấc một món ra khỏi balo, để lại vào khay. */
export function unplace(state: GameState, playerId: string, uid: string): GameState {
  requirePacking(state);
  const p = sheet(state, playerId);
  const index = p.bag.findIndex((b) => b.uid === uid);
  if (index < 0) fail("Món này không có trong balo");
  const [removed] = p.bag.splice(index, 1);
  p.tray.push({ uid, itemId: removed!.itemId });
  syncItems(p);
  return state;
}

/**
 * Hết giờ xếp balo: đồ còn trong khay bị bỏ lại trên tàu; đồ ăn mang theo được góp vào kho chung.
 * Rồi cả đoàn lên đảo, bắt đầu ngày 1.
 */
export function finishPacking(state: GameState, config: GameConfig): GameState {
  const lookup = lookupFrom(config.items);
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    // Đồ còn trong khay được nhét vào chỗ trống nếu vừa; hết chỗ thì mới bị bỏ lại trên tàu.
    for (const t of p.tray) {
      const def = lookup(t.itemId);
      const spot = def && firstFit(p.bag, def, lookup);
      if (spot) p.bag.push({ uid: t.uid, itemId: t.itemId, ...spot });
    }
    p.tray = [];
    const food = p.bag.filter((b) => lookup(b.itemId)?.tags.includes("food"));
    state.food += food.length * RATIONS_PER_FOOD_ITEM;
    p.bag = p.bag.filter((b) => !food.includes(b));
    syncItems(p);
  }
  return beginDay(state, config);
}
