import type pg from "pg";
import {
  COIN_RULES,
  advanceChallenges,
  dayKey,
  isChallengeStat,
  periodEndsAt,
  periodId,
  pickChallenges,
  weekKey,
  type ChallengePeriod,
  type StatTally,
} from "@tentides/content";
import type { RewardChallenge } from "@tentides/protocol";
import { accountsEnabled, db, transaction } from "./pool.ts";

// Thử thách ngày / tuần trong database: bộ thử thách bốc lại mỗi lần (pickChallenges, cố định theo tài khoản và kỳ),
// chỉ bảng challenge_progress lưu tiến độ và lúc đã nhận thưởng. Xong thử thách là tự nhận thưởng (xu, XP) ngay trong
// cùng transaction: không lo qua ngày mới mất thưởng. Thưởng thử thách không tính vào giới hạn xu mỗi ngày.

export interface ChallengeView {
  id: string;
  title: string;
  stat: string;
  target: number;
  progress: number;
  coins: number;
  xp: number;
  claimed: boolean;
}

export interface ChallengeSet {
  period: ChallengePeriod;
  /** Mã kỳ ("2026-10-12": ngày, hay thứ Hai đầu tuần). */
  key: string;
  /** Lúc kỳ này kết thúc (ms, UTC). */
  endsAt: number;
  items: ChallengeView[];
}

export interface ChallengeStatus {
  daily: ChallengeSet;
  weekly: ChallengeSet;
  /** Xu từ trận đã nhận hôm nay và giới hạn ngày. */
  coins: { today: number; cap: number };
}

const PERIODS: readonly ChallengePeriod[] = ["daily", "weekly"];
const keyOf = (period: ChallengePeriod, now: number) => (period === "daily" ? dayKey(now) : weekKey(now));

type Querier = Pick<pg.PoolClient, "query">;

async function progressRows(q: Querier, userId: number, period: string, lock: boolean): Promise<Map<string, { progress: number; claimed: boolean }>> {
  const { rows } = await q.query<{ challenge_id: string; progress: number; claimed: boolean }>(
    `SELECT challenge_id, progress, claimed_at IS NOT NULL AS claimed FROM challenge_progress WHERE user_id = $1 AND period = $2${lock ? " FOR UPDATE" : ""}`,
    [userId, period],
  );
  return new Map(rows.map((r) => [r.challenge_id, { progress: r.progress, claimed: r.claimed }]));
}

/** Thử thách ngày, tuần hiện tại của một tài khoản kèm tiến độ, và xu trận đã nhận hôm nay. */
export async function challengeStatus(userId: number, now = Date.now()): Promise<ChallengeStatus> {
  const sets = await Promise.all(
    PERIODS.map(async (period): Promise<ChallengeSet> => {
      const key = keyOf(period, now);
      const saved = await progressRows(db(), userId, periodId(period, key), false);
      const items = pickChallenges(userId, period, key).map((c) => {
        const s = saved.get(c.id);
        return { id: c.id, title: c.title, stat: c.stat, target: c.target, progress: Math.min(c.target, s?.progress ?? 0), coins: c.coins, xp: c.xp, claimed: s?.claimed ?? false };
      });
      return { period, key, endsAt: periodEndsAt(period, now), items };
    }),
  );
  const { rows } = await db().query<{ coin_day: string; coins_today: number }>("SELECT coin_day, coins_today FROM users WHERE id = $1", [userId]);
  const u = rows[0];
  const today = u && u.coin_day === dayKey(now) ? u.coins_today : 0;
  return { daily: sets[0]!, weekly: sets[1]!, coins: { today, cap: COIN_RULES.dailyCap } };
}

/**
 * Cộng số liệu trận vào tiến độ thử thách ngày và tuần của một tài khoản, trong transaction có sẵn. Thử thách vừa xong
 * thì tự nhận thưởng (cộng xu, XP). Trả về các thử thách vừa xong. Khoá dòng người dùng trước (FOR UPDATE) để hai
 * phòng cùng hết trận không cộng đè nhau.
 */
export async function recordStatsTx(c: Querier, userId: number, stats: StatTally, now = Date.now()): Promise<RewardChallenge[]> {
  const clean: StatTally = {};
  for (const [k, v] of Object.entries(stats)) if (isChallengeStat(k) && Number.isFinite(v) && v! > 0) clean[k] = Math.floor(v!);
  if (!Object.keys(clean).length) return [];
  const locked = await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  if (!locked.rowCount) return [];
  const done: RewardChallenge[] = [];
  for (const period of PERIODS) {
    const key = keyOf(period, now);
    const pid = periodId(period, key);
    const defs = pickChallenges(userId, period, key);
    if (!defs.some((d) => clean[d.stat])) continue;
    const saved = await progressRows(c, userId, pid, true);
    const current = new Map([...saved].map(([id, s]) => [id, s.progress]));
    for (const step of advanceChallenges(defs, current, clean)) {
      const claimNow = step.after >= step.def.target && !saved.get(step.def.id)?.claimed;
      await c.query(
        `INSERT INTO challenge_progress (user_id, period, challenge_id, progress, claimed_at) VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)
         ON CONFLICT (user_id, period, challenge_id) DO UPDATE SET progress = EXCLUDED.progress,
           claimed_at = COALESCE(challenge_progress.claimed_at, EXCLUDED.claimed_at), updated_at = now()`,
        [userId, pid, step.def.id, step.after, claimNow],
      );
      if (!claimNow) continue;
      await c.query("UPDATE users SET coins = coins + $2, xp = xp + $3 WHERE id = $1", [userId, step.def.coins, step.def.xp]);
      done.push({ id: step.def.id, title: step.def.title, coins: step.def.coins, xp: step.def.xp });
    }
  }
  return done;
}

/** Cộng số liệu (nhiều loại một lúc) vào thử thách của một tài khoản. Không có database thì bỏ qua. */
export async function recordStats(accountId: number, stats: StatTally, now = Date.now()): Promise<RewardChallenge[]> {
  if (!accountsEnabled()) return [];
  return transaction((c) => recordStatsTx(c, accountId, stats, now));
}

/**
 * Móc chung cho thử thách: cộng `amount` vào số liệu `statKey` (ChallengeStat trong content: "kills", "captures",
 * "revives", "repairs", "winsNaval"...) của tài khoản `accountId`. BattleRoom và tính năng khác gọi lúc hết trận từ số
 * liệu trận của từng người. Trả về các thử thách vừa xong (đã tự nhận thưởng).
 */
export async function recordProgress(accountId: number, statKey: string, amount: number): Promise<RewardChallenge[]> {
  if (!isChallengeStat(statKey)) return [];
  return recordStats(accountId, { [statKey]: amount });
}
