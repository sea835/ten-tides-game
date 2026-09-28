// Tương tác với đồ vật và với nhau ngoài thẻ sự kiện: thả, nhặt, ăn, nướng đồ, góp vào kho; dựng nhà; kẻ phản bội kết liễu.
// Server làm trọng tài thời gian thực (ai đứng đâu, đồ rơi chỗ nào); engine giữ balo, chỉ số và bí mật.

import { ENCOUNTER_PHASES } from "./encounters.ts";
import { checkDeaths } from "./endings.ts";
import { gainItem, syncItems } from "./inventory.ts";
import { clamp, fail, isTraitor, type GameConfig, type GameState, type Phase, type PlayerSheet } from "./types.ts";

/** Pha còn cầm đồ trong tay được (ban đêm quanh đống lửa vẫn ăn uống được). */
const HANDS_PHASES: readonly Phase[] = [...ENCOUNTER_PHASES, "night"];

function actor(state: GameState, playerId: string, phases: readonly Phase[] = ENCOUNTER_PHASES): PlayerSheet {
  if (!phases.includes(state.phase)) fail("Lúc này không làm được việc này");
  const p = state.players[playerId] ?? fail("Không có người chơi này");
  if (!p.alive) fail("Người đã gục không làm được gì nữa");
  return p;
}

function takeFromBag(p: PlayerSheet, uid: string): string {
  const index = p.bag.findIndex((b) => b.uid === uid);
  if (index < 0) fail("Món này không có trong balo");
  const [removed] = p.bag.splice(index, 1);
  syncItems(p);
  return removed!.itemId;
}

export function drop(state: GameState, playerId: string, uid: string): GameState {
  takeFromBag(actor(state, playerId), uid);
  return state;
}

export function pickup(state: GameState, playerId: string, itemId: string, config: GameConfig): GameState {
  const p = actor(state, playerId);
  if (!config.items.some((i) => i.id === itemId)) fail("Không có món này");
  if (!gainItem(state, p, itemId, config)) fail("Balo đầy, không nhét thêm được");
  return state;
}

export function consume(state: GameState, playerId: string, uid: string, config: GameConfig): GameState {
  const p = actor(state, playerId, HANDS_PHASES);
  const itemId = p.bag.find((b) => b.uid === uid)?.itemId ?? fail("Món này không có trong balo");
  const eat = config.items.find((i) => i.id === itemId)?.eat ?? fail("Món này không ăn hay dùng được");
  takeFromBag(p, uid);
  if (eat.hunger) p.hunger = clamp(p.hunger + eat.hunger, 0, 100);
  if (eat.hp) p.hp = clamp(p.hp + eat.hp, 0, p.maxHp);
  if (eat.morale) p.morale = clamp(p.morale + eat.morale, 0, 100);
  if (eat.stamina) p.stamina = clamp(p.stamina + eat.stamina, 0, 100);
  return checkDeaths(state);
}

/** Kẻ phản bội còn kết liễu được hôm nay không. */
export function canAssassinate(state: GameState, playerId: string): boolean {
  const p = state.players[playerId];
  if (!p || !p.alive || p.tied || !isTraitor(p.role) || !ENCOUNTER_PHASES.includes(state.phase)) return false;
  return !state.kills.some((k) => k.by === playerId && k.day === state.day);
}

/**
 * Kết liễu nhanh một đòn. Chỉ kẻ phản bội, mỗi ngày một lần, người bị trói thì không. Người được y tá che chở
 * vẫn còn lại 1 Máu. Nhật ký công khai chỉ ghi ai gục, không ghi ai ra tay.
 */
export function assassinate(state: GameState, playerId: string, target: string): GameState {
  actor(state, playerId);
  if (!canAssassinate(state, playerId)) fail("Bạn không ra tay được lúc này");
  if (target === playerId) fail("Không thể tự kết liễu mình");
  const victim = state.players[target] ?? fail("Không có người này");
  if (!victim.alive) fail("Người này đã gục rồi");
  state.kills.push({ day: state.day, by: playerId, target });
  victim.hp = 0;
  return checkDeaths(state);
}

/** Có đủ vật liệu trong balo không. */
export function hasMaterials(p: Pick<PlayerSheet, "items">, cost: Record<string, number>): boolean {
  return Object.entries(cost).every(([item, n]) => p.items.filter((i) => i === item).length >= n);
}

export function build(state: GameState, playerId: string, building: string, cost: Record<string, number>, shelter: number): GameState {
  const p = actor(state, playerId);
  if (!hasMaterials(p, cost)) fail("Không đủ vật liệu");
  for (const [item, n] of Object.entries(cost)) {
    for (let k = 0; k < n; k++) takeFromBag(p, p.bag.find((b) => b.itemId === item)!.uid);
  }
  state.shelter += Math.max(0, Math.min(8, Math.round(shelter)));
  state.log.push({ kind: "build", day: state.day, playerId, building });
  return state;
}

/** Góp đồ ăn kiếm được (dừa, cá, thịt...) vào kho lương thực chung. */
export function stash(state: GameState, playerId: string, uid: string, config: GameConfig): GameState {
  const p = actor(state, playerId, HANDS_PHASES);
  const itemId = p.bag.find((b) => b.uid === uid)?.itemId ?? fail("Món này không có trong balo");
  const amount = config.items.find((i) => i.id === itemId)?.ration ?? 0;
  if (amount <= 0) fail("Món này không góp vào kho lương thực được");
  takeFromBag(p, uid);
  state.food += amount;
  state.log.push({ kind: "stash", day: state.day, playerId, itemId, amount });
  return state;
}

/** Nướng một món trên lửa trại: món sống thành món chín, nằm nguyên chỗ cũ trong balo. */
export function cook(state: GameState, playerId: string, uid: string, config: GameConfig): GameState {
  const p = actor(state, playerId, HANDS_PHASES);
  const placed = p.bag.find((b) => b.uid === uid) ?? fail("Món này không có trong balo");
  const result = config.items.find((i) => i.id === placed.itemId)?.cook ?? fail("Món này không nướng được");
  if (!config.items.some((i) => i.id === result)) fail("Không có món này");
  placed.itemId = result;
  syncItems(p);
  return state;
}

/** Trao tay một món cho người đứng cạnh (server đã kiểm tra khoảng cách). Balo người nhận đầy thì không đưa được. */
export function give(state: GameState, playerId: string, target: string, uid: string, config: GameConfig): GameState {
  const p = actor(state, playerId, HANDS_PHASES);
  if (target === playerId) fail("Không tự đưa cho mình được");
  const receiver = state.players[target] ?? fail("Không có người này");
  if (!receiver.alive) fail("Người này đã gục rồi");
  const itemId = p.bag.find((b) => b.uid === uid)?.itemId ?? fail("Món này không có trong balo");
  // Giữ nguyên mã món đồ khi trao tay, để món đang cầm vẫn là món đó.
  if (!gainItem(state, receiver, itemId, config, uid)) fail(`Balo của ${receiver.name} đầy rồi`);
  takeFromBag(p, uid);
  state.log.push({ kind: "give", day: state.day, playerId, target, itemId });
  return state;
}
