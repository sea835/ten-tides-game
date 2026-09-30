import type { PlayerState } from "@tentides/protocol";
import { userIdOfPlayer } from "../account.ts";
import { recordMatch, type MatchReward } from "../db/accounts.ts";

// Thưởng xu sau mỗi trận Battleground cho người chơi có tài khoản.
// matchCoins là hàm thuần (dễ test, dễ chỉnh cân bằng); MatchRewards theo dõi hạng trong trận rồi ghi database ở nền.
// Phòng chỉ cần gọi ba chỗ: begin() lúc vào trận, onDeath() khi có người gục, finish() khi trận kết thúc.

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
}

export class MatchRewards {
  /** Hạng và số mạng của người đã gục (giữ cả người bỏ đi giữa trận). */
  private placings = new Map<string, { placement: number; kills: number }>();
  private entrants = 0;

  /** Vào trận: ghi số người (và máy) tham gia, xoá hạng trận trước. */
  begin(players: Players) {
    this.placings.clear();
    this.entrants = 0;
    for (const _ of players.values()) this.entrants++;
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
    const add = (playerId: string, kills: number, placement: number, entrants: number) => {
      const userId = userIdOfPlayer(playerId);
      if (userId === null) return;
      lines.push({ playerId, userId, kills, placement, coins: matchCoins(kills, placement, entrants) });
    };
    if (mode === "war") {
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

  /** Hết trận: tính thưởng rồi ghi database ở nền. Lỗi database chỉ in ra, không bao giờ làm sập phòng. */
  finish(players: Players, winner: string, mode: string): MatchLine[] {
    const lines = this.settle(players, winner, mode).filter((l) => l.coins > 0);
    if (lines.length) {
      const rows: MatchReward[] = lines.map(({ userId, kills, placement, coins }) => ({ userId, kills, placement, coins }));
      recordMatch(mode, rows).catch((err) => console.warn("Không ghi được thưởng xu sau trận:", err instanceof Error ? err.message : err));
    }
    return lines;
  }
}
