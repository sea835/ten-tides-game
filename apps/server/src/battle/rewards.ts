import { COIN_RULES, addStats, humanFactor, winStat, type StatTally } from "@tentides/content";
import type { PlayerState, RewardMessage } from "@tentides/protocol";
import { userIdOfPlayer } from "../account.ts";
import { addXp, recordMatch, type MatchReward } from "../db/accounts.ts";
import { recordStats } from "../db/challenges.ts";
import { XpLedger, type XpNotify } from "./xp.ts";

// Thưởng xu sau mỗi trận Battleground cho người chơi có tài khoản.
// matchCoins là hàm thuần (dễ test, dễ chỉnh cân bằng); MatchRewards theo dõi hạng trong trận rồi ghi database ở nền.
// Phòng chỉ cần gọi ba chỗ: begin() lúc vào trận, onDeath() khi có người gục, finish() khi trận kết thúc.
// XP (quân hàm) cộng dần trong trận qua sổ `xp` (xem xp.ts), ghi database cùng lúc với xu.
// Xu trận nhân hệ số theo số người thật (một mình với máy: 60%, xem humanFactor) rồi áp giới hạn xu mỗi ngày lúc ghi
// database; số liệu trận (hạ gục, thắng, cứ điểm, hồi sinh...) cộng vào tiến độ thử thách ngày / tuần cùng lúc.
// Ghi xong thì báo riêng từng người (RewardMessage) để bảng tổng kết hiện xu thực nhận, giới hạn ngày, thử thách xong.

export const REWARD = {
  /** Xu tham gia (chơi hết trận là có). */
  base: 30,
  perKill: 20,
  /** Tính tối đa chừng này mạng, tránh cày xu bằng cách hạ máy (bot) mãi. */
  maxKills: 15,
  winner: 150,
  /** Sống càng lâu càng nhiều: người gục đầu tiên 0, người thắng đủ số này. */
  survival: 60,
};

/**
 * @param placement hạng (1 là thắng)
 * @param entrants số người và máy lúc vào trận
 */
export function matchCoins(kills: number, placement: number, entrants: number): number {
  if (entrants < 2) return 0;
  const k = Math.max(0, Math.min(REWARD.maxKills, Math.floor(kills)));
  const place = Math.max(1, Math.min(entrants, Math.floor(placement)));
  const survived = (entrants - place) / (entrants - 1);
  return REWARD.base + k * REWARD.perKill + (place === 1 ? REWARD.winner : 0) + Math.round(REWARD.survival * survived);
}

/** Gửi riêng cho một người kết quả thưởng đã ghi vào tài khoản. */
export type RewardNotify = (playerId: string, msg: RewardMessage) => void;

/** Số liệu thử thách của một dòng kết quả trận: trận đã chơi, hạ gục, thắng (và thắng theo chế độ). */
export function lineStats(line: { kills: number; placement: number }, mode: string): StatTally {
  const out: StatTally = { matches: 1 };
  if (line.kills > 0) out.kills = Math.floor(line.kills);
  if (line.placement === 1) {
    out.wins = 1;
    const w = winStat(mode);
    if (w) out[w] = 1;
  }
  return out;
}

interface Players {
  get(id: string): PlayerState | undefined;
  values(): IterableIterator<PlayerState>;
  entries(): IterableIterator<[string, PlayerState]>;
}

/** Đội của người chơi (chế độ đồng đội, chiến trường). Bản protocol chưa có trường team thì coi như đánh đơn. */
function teamOf(p: PlayerState | undefined): string {
  return (p as { team?: string } | undefined)?.team ?? "";
}

export interface MatchLine {
  playerId: string;
  userId: number;
  kills: number;
  placement: number;
  coins: number;
  /** XP kiếm được trong trận. */
  xp: number;
  /** Số liệu thử thách của trận (hạ gục, thắng, cứ điểm, hồi sinh...). */
  stats: StatTally;
}

export class MatchRewards {
  /** Sổ XP của phòng: track() khi người có tài khoản vào phòng, award() (hay awardXp) khi có sự kiện. */
  readonly xp: XpLedger;

  constructor(
    notify?: XpNotify,
    private readonly reward: RewardNotify = () => {},
  ) {
    this.xp = new XpLedger(notify);
  }

  /** Hạng và số mạng của người đã gục (giữ cả người bỏ đi giữa trận). */
  private placings = new Map<string, { placement: number; kills: number }>();
  private entrants = 0;
  /** Số người thật lúc vào trận (hệ số xu: một mình với máy thì giảm). */
  private humans = 0;

  /** Vào trận: ghi số người (và máy) tham gia, xoá hạng trận trước. */
  begin(players: Players) {
    this.placings.clear();
    this.entrants = 0;
    this.humans = 0;
    for (const p of players.values()) {
      this.entrants++;
      if (!p.bot) this.humans++;
    }
    this.xp.active = true;
    // Số liệu thử thách còn sót từ lúc ngoài trận (không có) hay trận trước: bỏ.
    this.xp.drainStats();
  }

  /** Gọi khi một người gục trong lúc đang đánh, trước khi đánh dấu người đó đã gục. Lần gục đầu mới tính. */
  onDeath(id: string, players: Players) {
    if (this.placings.has(id)) return;
    const p = players.get(id);
    if (!p) return;
    // Hạng = số người còn sống ngay trước khi gục (kể cả mình).
    let alive = 0;
    for (const q of players.values()) if (q.alive) alive++;
    this.placings.set(id, { placement: Math.max(1, alive), kills: p.kills });
  }

  /**
   * Tính thưởng khi hết trận. `winner` là id người thắng (đánh đơn), id đội (đồng đội) hoặc phe (chiến trường).
   * Chiến trường có hồi sinh nên hạng chỉ là thắng (1) hay thua (2).
   */
  settle(players: Players, winner: string, mode: string): MatchLine[] {
    const lines: MatchLine[] = [];
    const factor = this.factorFor(players);
    const add = (playerId: string, kills: number, placement: number, entrants: number) => {
      const userId = userIdOfPlayer(playerId);
      if (userId === null) return;
      const coins = Math.round(matchCoins(kills, placement, entrants) * factor);
      lines.push({ playerId, userId, kills, placement, coins, xp: 0, stats: lineStats({ kills, placement }, mode) });
    };
    if (mode === "war" || mode === "naval") {
      for (const [id, p] of players.entries()) if (teamOf(p)) add(id, p.kills, teamOf(p) === winner ? 1 : 2, 2);
    } else {
      const won = (id: string, p: PlayerState | undefined) => !!winner && (id === winner || (!!teamOf(p) && teamOf(p) === winner));
      const seen = new Set<string>();
      for (const [id, p] of players.entries()) {
        if (!won(id, p)) continue;
        seen.add(id);
        add(id, p.kills, 1, this.entrants);
      }
      for (const [id, placing] of this.placings) {
        if (seen.has(id)) continue;
        // Còn trong phòng thì lấy số mạng mới nhất (lựu đạn, mìn của người đã gục vẫn có thể hạ người khác).
        const kills = players.get(id)?.kills ?? placing.kills;
        // Người thắng đã tính hạng 1, người gục xếp sau.
        add(id, kills, Math.max(2, placing.placement), this.entrants);
      }
    }
    this.placings.clear();
    return lines;
  }

  /** Hết trận: tính thưởng (xu, XP) rồi ghi database ở nền. Lỗi database chỉ in ra, không bao giờ làm sập phòng. */
  finish(players: Players, winner: string, mode: string): MatchLine[] {
    const earned = this.xp.drain();
    const counted = this.xp.drainStats();
    this.xp.active = false;
    const factor = this.factorFor(players);
    const lines = this.settle(players, winner, mode);
    for (const l of lines) {
      l.xp = earned.get(l.playerId)?.xp ?? 0;
      earned.delete(l.playerId);
      const more = counted.get(l.playerId);
      if (more) addStats(l.stats, more.stats);
      counted.delete(l.playerId);
    }
    const kept = lines.filter((l) => l.coins > 0 || l.xp > 0);
    if (kept.length) {
      const rows: MatchReward[] = kept.map(({ userId, kills, placement, coins, xp, stats }) => ({ userId, kills, placement, coins, xp, stats }));
      const byUser = new Map(kept.map((l) => [l.userId, l.playerId]));
      recordMatch(mode, rows)
        .then((done) => {
          for (const d of done) {
            const id = byUser.get(d.userId);
            if (id) this.reward(id, { coins: d.coins, earned: d.earned, factor, capped: d.capped, today: d.today, cap: COIN_RULES.dailyCap, challenges: d.challenges });
          }
        })
        .catch((err) => console.warn("Không ghi được thưởng xu sau trận:", err instanceof Error ? err.message : err));
    }
    // XP và số liệu thử thách của người đã rời phòng giữa trận (không có dòng kết quả) vẫn được ghi.
    this.saveXp([...earned.values()]);
    for (const { userId, stats } of counted.values()) {
      recordStats(userId, stats).catch((err) => console.warn("Không ghi được tiến độ thử thách:", err instanceof Error ? err.message : err));
    }
    return kept;
  }

  /**
   * Hệ số xu của trận: theo số người thật lớn nhất lúc vào trận và lúc hết trận (người vào giữa trận chiến trường
   * cũng tính). Một mình với máy thì giảm.
   */
  private factorFor(players: Players): number {
    let humansNow = 0;
    for (const p of players.values()) if (!p.bot) humansNow++;
    return humanFactor(Math.max(this.humans, humansNow));
  }

  /** Phòng đóng (có thể giữa trận): ghi nốt XP đang chờ. */
  dispose() {
    this.saveXp([...this.xp.drain().values()]);
    this.xp.dispose();
  }

  private saveXp(rows: { userId: number; xp: number }[]) {
    if (rows.length) addXp(rows).catch((err) => console.warn("Không ghi được XP:", err instanceof Error ? err.message : err));
  }
}
