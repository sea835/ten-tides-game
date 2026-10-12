// Đo tốc độ nhịp server: dựng một phòng Chiến trường không mạng (6 người đứng yên + máy cho đủ hai phe), chạy N giây
// trận rồi in thời gian nhịp (p50/p95/max) và từng phần (máy, xe, ...). Số ngẫu nhiên và đồng hồ cố định theo seed
// nên hai lần chạy cùng tham số cho cùng một trận (dấu vân tay cuối cùng giống nhau), để so trước/sau khi tối ưu.
//
//   pnpm --filter @tentides/server bench -- --seconds 120 --side 50 --humans 6 --seed 1
//
// --side: số người mỗi phe (kể cả người chơi), --load: bậc giảm tải máy cố định (mặc định để phòng tự chỉnh),
// --json: in kết quả dạng JSON (để so bằng script).

import { createHash } from "node:crypto";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "../src/battle/BattleRoom.ts";
import { Bots } from "../src/battle/bots.ts";
import { Vehicles } from "../src/battle/vehicles.ts";
import { War } from "../src/battle/war.ts";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const seconds = arg("seconds", 120);
const side = arg("side", 50);
const humans = arg("humans", 6);
const seed = arg("seed", 1);
const fixedLoad = arg("load", -1);
const json = process.argv.includes("--json");

// Số ngẫu nhiên (mulberry32) và đồng hồ (nhích đúng 50 ms mỗi nhịp) cố định.
let rs = seed >>> 0;
Math.random = () => {
  rs = (rs + 0x6d2b79f5) >>> 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let clock = 1_700_000_000_000;
Date.now = () => clock;

const room = new BattleRoom();
room.broadcast = (() => {}) as typeof room.broadcast;
room.state.battleMode = "war";
room.bots = new Bots(room);
room.vehicles = new Vehicles(room);
room.war = new War(room);
const priv = room as unknown as { setupMap: (seed: number) => void; startMatch: () => void; beginBattle: () => void; tick: (dt: number) => void };
priv.setupMap(99);
for (let h = 0; h < humans; h++) {
  const p = new PlayerState();
  p.name = `P${h}`;
  p.created = true;
  room.state.players.set(`human${h}`, p);
  room.war.assign(`human${h}`);
}
room.state.bots = side;
priv.startMatch();
priv.beginBattle();
room.state.ticketsBlue = room.state.ticketsRed = 100_000;

const all: number[] = [];
const t0 = performance.now();
const ticks = Math.round(seconds * 20);
for (let k = 0; k < ticks && room.state.phase === "battle"; k++) {
  if (fixedLoad >= 0) room.bots.thinkLevel = fixedLoad;
  priv.tick(0.05);
  clock += 50;
  all.push(room.perf.tick.recent(1)[0]!);
}
const wall = performance.now() - t0;

const sorted = all.slice().sort((a, b) => a - b);
const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const r2 = (v: number) => Math.round(v * 100) / 100;
const phases = room.perf.summary().phases;
const players = [...room.state.players.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const fp = createHash("sha256");
for (const [id, p] of players) fp.update(`${id}:${p.x.toFixed(4)},${p.z.toFixed(4)},${p.hp},${p.alive},${p.rotY.toFixed(4)};`);
fp.update(`${room.state.ticketsBlue}/${room.state.ticketsRed}`);
for (const f of room.state.flags.values()) fp.update(`${f.owner}${f.progress.toFixed(3)}`);
let kills = 0;
for (const p of room.state.players.values()) kills += p.kills ?? 0;

const result = {
  seconds: r2(all.length / 20),
  entities: room.state.players.size,
  bots: players.filter(([, p]) => p.bot).length,
  avg: r2(all.reduce((a, b) => a + b, 0) / all.length),
  p50: r2(pct(0.5)),
  p95: r2(pct(0.95)),
  max: r2(sorted[sorted.length - 1]!),
  wallMs: Math.round(wall),
  botsAvgLast60s: phases.bots?.avg ?? 0,
  botsP95Last60s: phases.bots?.p95 ?? 0,
  phasesLast60s: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, `${v.avg}/${v.p95}`])),
  load: room.bots.thinkLevel,
  kills,
  fingerprint: fp.digest("hex").slice(0, 16),
};
if (json) console.log(JSON.stringify(result));
else {
  console.log(`Chiến trường ${result.entities} người (${result.bots} máy), ${result.seconds} giây trận, chạy ${result.wallMs} ms`);
  console.log(`nhịp: tb ${result.avg} p50 ${result.p50} p95 ${result.p95} max ${result.max} ms`);
  console.log(`từng phần 60 giây cuối (tb/p95 ms): ${Object.entries(result.phasesLast60s).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`hạ gục ${result.kills}, bậc giảm tải ${result.load}, dấu vân tay ${result.fingerprint}`);
}
