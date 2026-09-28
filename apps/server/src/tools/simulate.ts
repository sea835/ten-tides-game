// Báo cáo cân bằng: cho bot chơi N ván trên nội dung thật và in phân phối kết quả.
// Chạy: pnpm --filter @tentides/server sim -- --games 2000 --difficulty normal

import { parseArgs } from "node:util";
import { ENDING_LABELS, content, gameConfig } from "@tentides/content";
import { DIFFICULTY_IDS, ENDING_WINNERS, isTraitor, playBotGame, type Difficulty, type EndingId } from "@tentides/rules";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    games: { type: "string", default: "2000" },
    difficulty: { type: "string", default: "normal" },
    players: { type: "string", default: "2-6" },
  },
});
const games = Number(values.games);
const difficulty = values.difficulty as Difficulty;
if (!DIFFICULTY_IDS.includes(difficulty)) throw new Error(`Độ khó phải là một trong: ${DIFFICULTY_IDS.join(", ")}`);
const [minPlayers, maxPlayers] = values.players.split("-").map(Number) as [number, number?];

const pct = (n: number, total: number) => `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
/** Khoảng tin cậy 95% (xấp xỉ Wald) cho một tỷ lệ. */
const ci = (n: number, total: number) => `±${(196 * Math.sqrt((n / total) * (1 - n / total) / total)).toFixed(1)}`;

const endings = new Map<EndingId, number>();
let traitorGames = 0;
let traitorWins = 0;
const endDay = new Map<number, number>();
let deaths = 0;
let gamesWithEarlyDeath = 0;
const firstDeathDay: number[] = [];
const foodByDay: number[][] = [];
const treasureByDay: number[][] = [];
const cardDraws = new Map<string, number>();
const choiceStats = new Map<string, { tries: number; wins: number }>();

for (let i = 0; i < games; i++) {
  const playerCount = minPlayers + (i % ((maxPlayers ?? minPlayers) - minPlayers + 1));
  const { state, dawns } = playBotGame(1000 + i, playerCount, gameConfig, { difficulty });

  endings.set(state.ending!, (endings.get(state.ending!) ?? 0) + 1);
  if (Object.values(state.players).some((p) => isTraitor(p.role))) {
    traitorGames++;
    if (state.winner === "traitor") traitorWins++;
  }
  endDay.set(state.day, (endDay.get(state.day) ?? 0) + 1);
  for (const dawn of dawns) {
    (foodByDay[dawn.day - 1] ??= []).push(dawn.food / dawn.playerOrder.length);
    (treasureByDay[dawn.day - 1] ??= []).push(dawn.treasure);
    for (const placed of Object.values(dawn.anchors)) cardDraws.set(placed.cardId, (cardDraws.get(placed.cardId) ?? 0) + 1);
  }
  const deathDays = state.log.filter((e) => e.kind === "death").map((e) => e.day);
  deaths += deathDays.length;
  if (deathDays.length) firstDeathDay.push(Math.min(...deathDays));
  if (deathDays.some((d) => d < 4)) gamesWithEarlyDeath++;
  for (const e of state.log) {
    if (e.kind !== "check") continue;
    const key = `${e.cardId}/${e.choiceId}`;
    const s = choiceStats.get(key) ?? { tries: 0, wins: 0 };
    s.tries++;
    if (e.result.success) s.wins++;
    choiceStats.set(key, s);
  }
}

const avg = (xs: number[] = []) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`\n${games} ván · ${minPlayers}${maxPlayers ? `–${maxPlayers}` : ""} người · độ khó ${difficulty}\n`);
console.log("Kết thúc (cổng: không kết thúc nào vượt 40%)");
for (const [id, label] of Object.entries(ENDING_LABELS) as [EndingId, { title: string }][]) {
  const n = endings.get(id) ?? 0;
  const flag = n / games > 0.4 ? "  ⚠ vượt 40%" : "";
  console.log(`  ${label.title.padEnd(24)} ${pct(n, games).padStart(6)} ${ci(n, games).padStart(6)}${flag}`);
}

const teamWins = [...endings].filter(([id]) => ENDING_WINNERS[id] === "team").reduce((a, [, n]) => a + n, 0);
const nobodyWins = [...endings].filter(([id]) => ENDING_WINNERS[id] === "none").reduce((a, [, n]) => a + n, 0);
console.log(`\n  Phe đội thắng:             ${pct(teamWins, games)} (mục tiêu 45–60%)`);
console.log(`  Không ai thắng:            ${pct(nobodyWins, games)} (mục tiêu 15–30%)`);
if (traitorGames > 0) {
  console.log(`  Phản bội thắng (trong ${traitorGames} ván có kẻ phản bội): ${pct(traitorWins, traitorGames)} (mục tiêu 30–45%)`);
}

console.log("\nNhịp");
console.log(`  Chạy tới ngày 10:           ${pct(endDay.get(10) ?? 0, games)} (mục tiêu ≥ 60%)`);
console.log(`  Kết thúc trước ngày 6:      ${pct([...endDay].filter(([d]) => d < 6).reduce((a, [, n]) => a + n, 0), games)} (mục tiêu ≤ 10%)`);
console.log(`  Có người chết trước ngày 4: ${pct(gamesWithEarlyDeath, games)}`);
console.log(`  Số người chết mỗi ván:      ${(deaths / games).toFixed(2)} · ngày chết đầu tiên trung bình ${avg(firstDeathDay).toFixed(1)}`);

console.log("\nĐường cong lúc bình minh (trung bình)");
console.log("  Ngày  Lương thực/người  Kho báu");
for (let d = 0; d < foodByDay.length; d++) {
  console.log(`  ${String(d + 1).padStart(4)}  ${avg(foodByDay[d]).toFixed(2).padStart(16)}  ${avg(treasureByDay[d]).toFixed(1).padStart(7)}`);
}

console.log("\nThẻ (số lần được đặt lên map)");
for (const card of content.cards.values()) {
  const n = cardDraws.get(card.id) ?? 0;
  console.log(`  ${card.id.padEnd(20)} ${String(n).padStart(6)}${n === 0 ? "  ⚠ không bao giờ xuất hiện" : ""}`);
}

console.log("\nTỷ lệ thành công từng lựa chọn (mục tiêu 25–85%)");
for (const [key, s] of [...choiceStats].sort()) {
  const rate = s.wins / s.tries;
  const flag = rate < 0.25 || rate > 0.85 ? "  ⚠ ngoài khoảng" : "";
  console.log(`  ${key.padEnd(36)} ${pct(s.wins, s.tries).padStart(6)} (${s.tries} lần)${flag}`);
}
console.log();
