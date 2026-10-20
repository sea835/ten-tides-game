import { makeRand, subSeed } from "./worldgen.ts";

// Thử thách ngày (3) và tuần (3): mỗi tài khoản một bộ riêng, bốc cố định theo id tài khoản và mã ngày / tuần
// (cùng người cùng ngày luôn ra cùng bộ, không cần lưu bộ đã bốc). Tiến độ cộng lúc hết trận từ số liệu trận của
// từng người (server: recordProgress). Thưởng xu và XP, không tính vào giới hạn xu mỗi ngày.

/**
 * Số liệu trận dùng cho thử thách. Server cộng lúc hết trận: hạ gục, thắng, trận đã chơi từ kết quả trận; phần còn
 * lại đếm theo sự kiện XP (capture, revive, repair, resupply, sink, headshot) hay noteStat(id, key) của tính năng khác.
 */
export type ChallengeStat =
  | "matches"
  | "wins"
  | "winsWar"
  | "winsNaval"
  | "winsSquad"
  | "winsSolo"
  | "kills"
  | "headshots"
  | "captures"
  | "revives"
  | "repairs"
  | "resupplies"
  | "sinks";

export const CHALLENGE_STATS: readonly ChallengeStat[] = [
  "matches",
  "wins",
  "winsWar",
  "winsNaval",
  "winsSquad",
  "winsSolo",
  "kills",
  "headshots",
  "captures",
  "revives",
  "repairs",
  "resupplies",
  "sinks",
];

export function isChallengeStat(k: string): k is ChallengeStat {
  return (CHALLENGE_STATS as readonly string[]).includes(k);
}

export type ChallengePeriod = "daily" | "weekly";

export interface ChallengeDef {
  id: string;
  period: ChallengePeriod;
  title: string;
  stat: ChallengeStat;
  target: number;
  coins: number;
  xp: number;
  /** Chỉ làm được ở một chế độ: mỗi bộ có tối đa một thử thách kiểu này (đỡ ép người chơi đổi chế độ). */
  mode?: "war" | "naval" | "squad" | "solo";
}

/** Số thử thách mỗi ngày, mỗi tuần. */
export const CHALLENGES_PER_PERIOD = 3;

/**
 * Thưởng: ba thử thách ngày cộng lại chừng 350–450 xu (≈ 4 lượt quay), ba thử thách tuần chừng 1.500–1.800 xu. Không
 * tính vào giới hạn 1.500 xu/ngày từ trận đấu: chơi đều đặn có lợi hơn cày một ngày.
 */
export const CHALLENGES: readonly ChallengeDef[] = [
  // Ngày
  { id: "d-kills-15", period: "daily", title: "Hạ 15 lính địch", stat: "kills", target: 15, coins: 120, xp: 600 },
  { id: "d-captures-3", period: "daily", title: "Chiếm 3 cứ điểm", stat: "captures", target: 3, coins: 150, xp: 800, mode: "war" },
  { id: "d-naval-win", period: "daily", title: "Thắng 1 trận hải chiến", stat: "winsNaval", target: 1, coins: 150, xp: 800, mode: "naval" },
  { id: "d-repairs-2", period: "daily", title: "Sửa 2 bộ phận tàu hay xe", stat: "repairs", target: 2, coins: 120, xp: 600 },
  { id: "d-revives-3", period: "daily", title: "Hồi sinh đồng đội 3 lần", stat: "revives", target: 3, coins: 150, xp: 800 },
  { id: "d-matches-3", period: "daily", title: "Chơi hết 3 trận", stat: "matches", target: 3, coins: 100, xp: 500 },
  { id: "d-win-1", period: "daily", title: "Thắng 1 trận bất kỳ", stat: "wins", target: 1, coins: 120, xp: 600 },
  { id: "d-headshots-5", period: "daily", title: "Hạ 5 địch bằng phát vào đầu", stat: "headshots", target: 5, coins: 130, xp: 700 },
  { id: "d-resupply-3", period: "daily", title: "Tiếp tế đạn 3 lần", stat: "resupplies", target: 3, coins: 110, xp: 550 },
  { id: "d-sink-1", period: "daily", title: "Đánh chìm 1 tàu địch", stat: "sinks", target: 1, coins: 150, xp: 800, mode: "naval" },
  { id: "d-squad-win", period: "daily", title: "Thắng 1 trận Chỉ Huy Tiểu Đội", stat: "winsSquad", target: 1, coins: 150, xp: 800, mode: "squad" },

  // Tuần
  { id: "w-kills-150", period: "weekly", title: "Hạ 150 lính địch", stat: "kills", target: 150, coins: 500, xp: 3000 },
  { id: "w-captures-25", period: "weekly", title: "Chiếm 25 cứ điểm", stat: "captures", target: 25, coins: 600, xp: 3500, mode: "war" },
  { id: "w-wins-10", period: "weekly", title: "Thắng 10 trận", stat: "wins", target: 10, coins: 600, xp: 3500 },
  { id: "w-naval-wins-3", period: "weekly", title: "Thắng 3 trận hải chiến", stat: "winsNaval", target: 3, coins: 600, xp: 3500, mode: "naval" },
  { id: "w-war-wins-5", period: "weekly", title: "Thắng 5 trận Đại Chiến", stat: "winsWar", target: 5, coins: 600, xp: 3500, mode: "war" },
  { id: "w-matches-15", period: "weekly", title: "Chơi hết 15 trận", stat: "matches", target: 15, coins: 450, xp: 2500 },
  { id: "w-revives-20", period: "weekly", title: "Hồi sinh đồng đội 20 lần", stat: "revives", target: 20, coins: 550, xp: 3200 },
  { id: "w-headshots-40", period: "weekly", title: "Hạ 40 địch bằng phát vào đầu", stat: "headshots", target: 40, coins: 550, xp: 3200 },
  { id: "w-repairs-15", period: "weekly", title: "Sửa 15 bộ phận tàu hay xe", stat: "repairs", target: 15, coins: 500, xp: 3000 },
  { id: "w-solo-wins-2", period: "weekly", title: "Thắng 2 trận Sinh Tồn", stat: "winsSolo", target: 2, coins: 600, xp: 3500, mode: "solo" },
];

export const CHALLENGE: ReadonlyMap<string, ChallengeDef> = new Map(CHALLENGES.map((c) => [c.id, c]));

/**
 * Bộ thử thách của một tài khoản trong một ngày / tuần (`key` là dayKey / weekKey). Bốc cố định: cùng tài khoản, cùng
 * mã thì luôn ra cùng bộ. Không trùng số liệu (hai thử thách cùng đếm hạ gục), tối đa một thử thách riêng chế độ.
 */
export function pickChallenges(userId: number, period: ChallengePeriod, key: string, pool: readonly ChallengeDef[] = CHALLENGES): ChallengeDef[] {
  const rand = makeRand(subSeed(userId >>> 0, `${period}:${key}`));
  const out: ChallengeDef[] = [];
  let modeSpecific = false;
  for (const c of rand.shuffle(pool.filter((c) => c.period === period))) {
    if (out.length >= CHALLENGES_PER_PERIOD) break;
    if (out.some((o) => o.stat === c.stat)) continue;
    if (c.mode && modeSpecific) continue;
    if (c.mode) modeSpecific = true;
    out.push(c);
  }
  return out;
}

/** Mã kỳ lưu trong database: "d:2026-10-12", "w:2026-10-12" (thứ Hai đầu tuần). */
export function periodId(period: ChallengePeriod, key: string): string {
  return `${period === "daily" ? "d" : "w"}:${key}`;
}

export type StatTally = Partial<Record<ChallengeStat, number>>;

/** Một thử thách sau khi cộng tiến độ: tiến độ mới, vừa hoàn thành ở lần cộng này không. */
export interface ProgressStep {
  def: ChallengeDef;
  before: number;
  after: number;
  completedNow: boolean;
}

/**
 * Cộng số liệu trận vào tiến độ các thử thách (tiến độ không vượt quá mục tiêu). `current`: tiến độ đang có theo id.
 * Chỉ trả về thử thách có thay đổi.
 */
export function advanceChallenges(defs: readonly ChallengeDef[], current: ReadonlyMap<string, number>, stats: StatTally): ProgressStep[] {
  const out: ProgressStep[] = [];
  for (const def of defs) {
    const add = Math.max(0, Math.floor(stats[def.stat] ?? 0));
    if (!add) continue;
    const before = Math.min(def.target, Math.max(0, current.get(def.id) ?? 0));
    const after = Math.min(def.target, before + add);
    if (after === before) continue;
    out.push({ def, before, after, completedNow: after >= def.target && before < def.target });
  }
  return out;
}

/** Cộng dồn số liệu (vd. nhiều sự kiện trong trận). */
export function addStats(into: StatTally, more: StatTally): StatTally {
  for (const k of CHALLENGE_STATS) {
    const n = Math.max(0, Math.floor(more[k] ?? 0));
    if (n) into[k] = (into[k] ?? 0) + n;
  }
  return into;
}

/** Số liệu thắng theo chế độ ("war" → winsWar...). */
export function winStat(mode: string): ChallengeStat | null {
  if (mode === "war") return "winsWar";
  if (mode === "naval") return "winsNaval";
  if (mode === "squad") return "winsSquad";
  if (mode === "solo" || mode === "battle") return "winsSolo";
  return null;
}
