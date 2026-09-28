// Phát lại một ván từ file log (seed + chuỗi hành động) để debug hoặc xem lại.
// Chạy: pnpm --filter @tentides/server replay -- logs/<file>.json [--verbose]

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { content, gameConfig } from "@tentides/content";
import { createGame, reduce } from "@tentides/rules";
import type { GameLogFile } from "../gameLog.ts";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  allowPositionals: true, options: { verbose: { type: "boolean", default: false } } });
const file = positionals[0];
if (!file) throw new Error("Cần đường dẫn tới file log ván");

const log = JSON.parse(await readFile(file, "utf8")) as GameLogFile;
let state = createGame(log.seed);
for (const [i, action] of log.actions.entries()) {
  try {
    state = reduce(state, action, gameConfig);
  } catch (e) {
    console.error(`Hành động #${i} (${action.type}) không phát lại được: ${(e as Error).message}`);
    console.error("Nội dung game có thể đã đổi kể từ khi ván này được chơi.");
    process.exit(1);
  }
}

const name = (id: string) => state.players[id]?.name ?? id;
console.log(`Phòng ${log.roomId} · ${log.createdAt} · seed ${log.seed} · ${log.actions.length} hành động · ${log.chat.length} tin nhắn`);
console.log(`Trạng thái: ${state.phase}, ngày ${state.day}${state.ending ? `, kết thúc ${state.ending}` : ""}`);
console.log(`Kho báu ${state.treasure} · lương thực ${state.food} · thuyền ${state.hull}`);
for (const id of state.playerOrder) {
  const p = state.players[id]!;
  console.log(`  ${p.name.padEnd(16)} ${p.alive ? `Máu ${p.hp}/${p.maxHp}` : "đã gục"} · No ${p.hunger} · Tinh thần ${p.morale}`);
}
if (values.verbose) {
  console.log("\nNhật ký:");
  for (const e of state.log) {
    if (e.kind === "check") {
      const card = content.cards.get(e.cardId);
      console.log(`  Ngày ${e.day} · ${name(e.playerId)} · ${card?.title ?? e.cardId} / ${e.choiceId}: ${e.result.total} vs ${e.result.dc} ${e.result.success ? "✓" : "✗"}`);
    } else if (e.kind === "dusk") {
      console.log(`  Ngày ${e.day} · hoàng hôn · ngủ ngoài: ${e.sleptOutside.map(name).join(", ") || "không ai"}`);
    } else if (e.kind === "night") {
      console.log(`  Ngày ${e.day} · đêm · ${e.ration}, ăn ${e.ate}${e.nominee ? ` · đề cử ${name(e.nominee)}: ${e.yes.length} đồng ý / ${e.no.length} không${e.tied ? " → trói" : ""}` : ""}`);
    } else if (e.kind === "incident") {
      console.log(`  Ngày ${e.day} · sự cố: ${e.effects.map((x) => x.type + ("amount" in x ? ` ${x.amount}` : "") + ("playerId" in x ? ` ${name(x.playerId)}` : "")).join(", ")}`);
    } else if (e.kind === "dig") {
      console.log(`  Ngày ${e.day} · ${name(e.playerId)} đào được rương kho báu`);
    } else if (e.kind === "departure") {
      console.log(`  Ngày ${e.day} · rời đảo: ${e.aboard.map(name).join(", ") || "không ai"} · bỏ lại ${e.leftBehind.map(name).join(", ") || "không ai"} · thuyền ${e.hull} · ${e.withTreasure ? "có" : "không có"} kho báu`);
    } else {
      console.log(`  Ngày ${e.day} · ${name(e.playerId)} gục ngã`);
    }
  }
  console.log("\nVai và hành động đêm:");
  for (const id of state.playerOrder) {
    const acts = state.nightHistory.filter((n) => n.playerId === id).map((n) => `N${n.day}:${n.action}${n.target ? `→${name(n.target)}` : ""}`);
    console.log(`  ${name(id).padEnd(16)} ${state.players[id]!.role.padEnd(9)} ${acts.join(" ")}`);
  }
  for (const c of log.chat) console.log(`  [chat ngày ${c.day}, ${c.channel}] ${name(c.from)}: ${c.text}`);
}
