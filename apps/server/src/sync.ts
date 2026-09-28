import type { ArraySchema, MapSchema } from "@colyseus/schema";
import { gameConfig } from "@tentides/content";
import { isOverweight, rationVoteNeeded, treasureRevealed, visibleItems, weatherOf, type GameState, type LogEntry } from "@tentides/rules";
import { AnchorState, EffectState, LogEntryState, LootState, ModifierState, NightRecordState, type IslandState } from "@tentides/protocol";

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
      out.wouldPassWith.push(...entry.wouldPassWith);
      out.rerolledFrom = entry.result.rerolledFrom ?? 0;
      out.dropped = entry.dropped ?? "";
      out.exploded = entry.exploded;
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
      out.nominee = entry.nominee ?? "";
      out.players.push(...entry.yes);
      out.others.push(...entry.no);
      out.playerId = entry.tied ?? "";
      break;
    case "death":
    case "dig":
      out.playerId = entry.playerId;
      break;
    case "incident":
      for (const e of entry.effects) {
        const effect = new EffectState();
        effect.type = e.type;
        if ("amount" in e) effect.amount = e.amount;
        if ("playerId" in e) effect.playerId = e.playerId;
        if ("itemId" in e) effect.itemId = e.itemId;
        out.effects.push(effect);
      }
      break;
    case "encounter":
      out.playerId = entry.playerId;
      out.source = entry.source;
      out.refId = entry.refId;
      out.defId = entry.defId;
      out.dodged = entry.dodged;
      for (const [type, amount] of Object.entries(entry.effects)) {
        if (typeof amount !== "number" || amount === 0) continue;
        const effect = new EffectState();
        effect.type = type;
        effect.amount = amount;
        out.effects.push(effect);
      }
      if (entry.gained) {
        const effect = new EffectState();
        effect.type = "gain";
        effect.itemId = entry.gained;
        out.effects.push(effect);
      }
      break;
    case "departure":
      out.players.push(...entry.aboard);
      out.others.push(...entry.leftBehind);
      out.amount = entry.hull;
      out.success = entry.withTreasure;
      break;
  }
  return out;
}

export function syncState(target: IslandState, game: GameState) {
  // Seed của engine luật không bao giờ được chép sang đây: từ nó suy ra được vai ẩn và chỗ kho báu.
  target.difficulty = game.phase === "lobby" ? target.difficulty : game.difficulty;
  target.phase = game.phase;
  target.day = game.day;
  target.weather = weatherOf(game) ?? "";
  target.volcano = game.volcano;
  target.food = game.food;
  target.treasure = game.treasure;
  target.hull = game.hull;
  target.ending = game.ending ?? "";
  target.winner = game.winner ?? "";
  target.soloWinner = game.soloWinner ?? "";
  // Chỗ đào là bí mật cho tới khi cả đội gom đủ manh mối.
  target.treasureSite = treasureRevealed(game) ? game.treasureSite : "";
  target.treasureDug = game.treasureDug;
  target.treasureCarrier = game.treasureCarrier ?? "";
  target.treasureSafe = game.treasureSafe;

  for (const sheet of Object.values(game.players)) {
    const p = target.players.get(sheet.id);
    if (!p) continue;
    setMap(p.stats, sheet.stats);
    p.background = sheet.background;
    p.flaw = sheet.flaw;
    p.bio = sheet.bio;
    p.created = sheet.created;
    p.overweight = isOverweight(sheet, gameConfig);
    p.hp = sheet.hp;
    p.maxHp = sheet.maxHp;
    p.hunger = sheet.hunger;
    p.morale = sheet.morale;
    p.stamina = sheet.stamina;
    p.alive = sheet.alive;
    p.lost = sheet.lost;
    p.tied = sheet.tied;
    // Chỉ công khai đồ nằm ngoài ngăn bí mật; balo đầy đủ gửi riêng cho chủ nhân.
    setArray(p.items, visibleItems(sheet, gameConfig));
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
  setArray(target.discovered, game.discovered);

  setArray(target.campers, game.campers);
  target.rationNeeded = game.phase === "night" && rationVoteNeeded(game);
  setMap(target.rations, game.votes.ration);

  // Phiếu trói là phiếu kín: trước khi lật chỉ công khai ai đã bỏ phiếu.
  const ballot = game.votes.tie;
  const tie = target.tie;
  tie.nominator = ballot?.by ?? "";
  tie.nominee = ballot?.target ?? "";
  tie.revealed = ballot?.revealed ?? false;
  setArray(tie.cast, ballot ? Object.keys(ballot.votes) : []);
  const revealed = ballot?.revealed ? ballot.votes : {};
  setArray(
    tie.yes,
    Object.keys(revealed).filter((id) => revealed[id]),
  );
  setArray(
    tie.no,
    Object.keys(revealed).filter((id) => !revealed[id]),
  );

  for (let i = target.log.length; i < game.log.length; i++) target.log.push(toLogEntry(game.log[i]!));

  // Màn lật bài: vai, hành động từng đêm, đồ bỏ túi. Chỉ chép khi ván đã kết thúc.
  if (game.phase === "ended" && target.reveal.roles.size === 0) {
    const reveal = target.reveal;
    for (const p of Object.values(game.players)) {
      reveal.roles.set(p.id, p.role);
      for (const itemId of p.loot) {
        const loot = new LootState();
        loot.playerId = p.id;
        loot.itemId = itemId;
        reveal.loot.push(loot);
      }
    }
    for (const n of game.nightHistory) {
      const record = new NightRecordState();
      record.day = n.day;
      record.playerId = n.playerId;
      record.action = n.action;
      record.target = n.target ?? "";
      reveal.nights.push(record);
    }
    reveal.signals = game.signals;
    reveal.deceit = game.deceit;
    reveal.tied.push(...game.tieHistory.map((t) => t.playerId));
  }
}
