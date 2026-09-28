import type { ArraySchema, MapSchema } from "@colyseus/schema";
import { weatherOf, type GameState, type LogEntry } from "@tentides/rules";
import { AnchorState, LogEntryState, ModifierState, VoteState, type IslandState } from "@tentides/protocol";

// Chép trạng thái của engine luật sang state đồng bộ của Colyseus.
// Engine là nguồn sự thật; schema chỉ là bản chiếu công khai để gửi cho client.
// Chỉ gán khi giá trị đổi, để Colyseus không gửi thừa dữ liệu.

function setArray<T>(target: ArraySchema<T>, values: readonly T[]) {
  if (target.length === values.length && values.every((v, i) => target[i] === v)) return;
  target.clear();
  target.push(...values);
}

function setMap<V>(target: MapSchema<V>, source: Record<string, V>) {
  for (const key of [...target.keys()]) if (!(key in source)) target.delete(key);
  for (const [key, value] of Object.entries(source)) if (target.get(key) !== value) target.set(key, value);
}

function toLogEntry(entry: LogEntry): LogEntryState {
  const out = new LogEntryState();
  out.kind = entry.kind;
  out.day = entry.day;
  switch (entry.kind) {
    case "check":
      out.playerId = entry.playerId;
      out.players.push(...entry.participants);
      out.anchorId = entry.anchorId;
      out.cardId = entry.cardId;
      out.choiceId = entry.choiceId;
      out.roll = entry.result.roll;
      out.total = entry.result.total;
      out.dc = entry.result.dc;
      out.success = entry.result.success;
      for (const m of entry.result.modifiers) {
        const mod = new ModifierState();
        mod.label = m.label;
        mod.value = m.value;
        out.modifiers.push(mod);
      }
      break;
    case "dusk":
      out.players.push(...entry.sleptOutside);
      break;
    case "night":
      out.ration = entry.ration;
      out.amount = entry.ate;
      out.starving.push(...entry.starving);
      out.playerId = entry.tied ?? "";
      break;
    case "death":
      out.playerId = entry.playerId;
      break;
  }
  return out;
}

export function syncState(target: IslandState, game: GameState) {
  target.seed = game.seed;
  target.phase = game.phase;
  target.day = game.day;
  target.weather = weatherOf(game) ?? "";
  target.volcano = game.volcano;
  target.food = game.food;
  target.treasure = game.treasure;
  target.hull = game.hull;
  target.ending = game.ending ?? "";

  for (const sheet of Object.values(game.players)) {
    const p = target.players.get(sheet.id);
    if (!p) continue;
    setMap(p.stats, sheet.stats);
    p.hp = sheet.hp;
    p.maxHp = sheet.maxHp;
    p.hunger = sheet.hunger;
    p.morale = sheet.morale;
    p.stamina = sheet.stamina;
    p.alive = sheet.alive;
    p.lost = sheet.lost;
    p.tied = sheet.tied;
    setArray(p.items, sheet.items);
  }

  for (const id of [...target.anchors.keys()]) if (!game.anchors[id]) target.anchors.delete(id);
  for (const placed of Object.values(game.anchors)) {
    let a = target.anchors.get(placed.anchorId);
    if (!a || a.cardId !== placed.cardId) {
      a = new AnchorState();
      a.cardId = placed.cardId;
      target.anchors.set(placed.anchorId, a);
    }
    a.status = placed.status;
    setArray(a.participants, placed.participants);
  }

  setMap(target.sceneStates, game.sceneStates);

  setArray(target.campers, game.campers);
  for (const id of [...target.votes.keys()]) if (!game.campers.includes(id)) target.votes.delete(id);
  for (const id of game.campers) {
    let v = target.votes.get(id);
    if (!v) {
      v = new VoteState();
      target.votes.set(id, v);
    }
    v.ration = game.votes.ration[id] ?? "";
    v.tie = game.votes.tie[id] ?? "";
  }

  for (let i = target.log.length; i < game.log.length; i++) target.log.push(toLogEntry(game.log[i]!));
}
