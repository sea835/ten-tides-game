import type { MatchSummaryMessage, MatchSummaryRow, MvpEntry, MvpKind, PlayerState } from "@tentides/protocol";

// Số liệu vinh danh sau trận (MVP Hạ gục, MVP Chiếm cứ điểm, MVP Hỗ trợ) của một phòng: đếm hạ gục, lần gục,
// trợ giúp hạ gục (gây sát thương cho người bị người khác hạ trong vòng 10 giây), góp phần chiếm cứ điểm, hỗ trợ
// (tiếp tế đạn, sửa xe, hồi sinh). Phòng gọi begin() lúc vào trận, onDamage()/onKill() khi đánh nhau, summary() lúc
// hết trận; chiến trường gọi noteCapture(). Tính năng khác chỉ cần gọi noteSupport(playerId): hàm tự tìm phòng.

/** Gây sát thương trong chừng này giây trước khi người đó bị người khác hạ thì tính một lần trợ giúp. */
export const ASSIST_WINDOW_MS = 10_000;
/** Điểm xếp bảng: mỗi hạ gục, trợ giúp, lần góp phần chiếm cứ điểm, lần hỗ trợ. */
export const SCORE = { kill: 100, assist: 50, capture: 200, support: 50 };

interface Line {
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  support: number;
}

interface Players {
  get(id: string): PlayerState | undefined;
  entries(): IterableIterator<[string, PlayerState]>;
}

/** Sổ nào đang giữ người chơi nào: để noteSupport gọi được từ bất cứ đâu chỉ với id người chơi. */
const ROUTE = new Map<string, MatchStats>();

export class MatchStats {
  private lines = new Map<string, Line>();
  /** Người bị đánh → ai đã gây sát thương lúc nào (ms). */
  private hurtBy = new Map<string, Map<string, number>>();
  /** Đang trong trận: ngoài trận (sảnh, hết trận) thì không đếm. */
  active = false;

  constructor(private readonly now: () => number = Date.now) {}

  private line(id: string): Line {
    let l = this.lines.get(id);
    if (!l) {
      l = { kills: 0, deaths: 0, assists: 0, captures: 0, support: 0 };
      this.lines.set(id, l);
    }
    return l;
  }

  /** Người chơi đang ở phòng này (vào phòng, vào trận): noteSupport(id) tìm được tới sổ này. */
  track(id: string) {
    ROUTE.set(id, this);
  }

  /** Vào trận: xoá số liệu trận trước, ghi nhận mọi người (và máy) đang trong phòng. */
  begin(ids: Iterable<string>) {
    this.lines.clear();
    this.hurtBy.clear();
    for (const id of ids) this.track(id);
    this.active = true;
  }

  /** `attacker` vừa gây sát thương cho `victim` (gọi trước khi xét gục). */
  onDamage(victim: string, attacker: string) {
    if (!this.active || !attacker || attacker === victim) return;
    let m = this.hurtBy.get(victim);
    if (!m) {
      m = new Map();
      this.hurtBy.set(victim, m);
    }
    m.set(attacker, this.now());
  }

  /**
   * `victim` gục. `credited`: kẻ hạ được tính một mạng (không phải tự sát, bắn nhầm đồng đội). Người khác cùng gây sát
   * thương trong 10 giây trước (không cùng đội với người gục) được tính trợ giúp.
   */
  onKill(victim: string, killer: string, credited: boolean, players: Players) {
    if (!this.active) return;
    this.line(victim).deaths++;
    if (credited && killer) this.line(killer).kills++;
    const hurt = this.hurtBy.get(victim);
    this.hurtBy.delete(victim);
    if (!hurt) return;
    const team = players.get(victim)?.team ?? "";
    const t = this.now();
    for (const [id, at] of hurt) {
      if (id === killer || id === victim || t - at > ASSIST_WINDOW_MS) continue;
      if (team && players.get(id)?.team === team) continue;
      this.line(id).assists++;
    }
  }

  /** Góp phần chiếm cứ điểm (đứng trong vùng lúc chiếm xong). */
  noteCapture(id: string) {
    if (this.active) this.line(id).captures++;
  }

  /** Hỗ trợ: tiếp tế đạn, sửa xe, hồi sinh đồng đội... */
  noteSupport(id: string, times = 1) {
    const n = Math.max(0, Math.floor(times));
    if (this.active && n) this.line(id).support += n;
  }

  /** Số liệu một người (0 hết nếu chưa có gì). */
  get(id: string): Readonly<Line> {
    return this.lines.get(id) ?? { kills: 0, deaths: 0, assists: 0, captures: 0, support: 0 };
  }

  /** Hết trận: bảng điểm (người còn trong phòng) đã xếp theo điểm, MVP từng hạng mục. Thôi đếm cho tới trận sau. */
  summary(players: Players, winner: string, mode: string): MatchSummaryMessage {
    this.active = false;
    const rows: MatchSummaryRow[] = [];
    for (const [id, p] of players.entries()) {
      const l = this.get(id);
      rows.push({
        id,
        name: p.name,
        team: p.team,
        bot: p.bot,
        rank: p.badge.rank,
        card: p.badge.card,
        emblem: p.badge.emblem,
        ...l,
        score: l.kills * SCORE.kill + l.assists * SCORE.assist + l.captures * SCORE.capture + l.support * SCORE.support,
      });
    }
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { mode, winner, mvp: pickMvp(rows), rows };
  }

  /** Phòng đóng: thôi nhận noteSupport. */
  dispose() {
    this.active = false;
    for (const [id, stats] of ROUTE) if (stats === this) ROUTE.delete(id);
  }
}

const MVP_VALUE: Record<MvpKind, (r: MatchSummaryRow) => number> = {
  kills: (r) => r.kills,
  captures: (r) => r.captures,
  support: (r) => r.assists + r.support,
};

/** Người đứng đầu từng hạng mục (cao nhất, bằng nhau thì xem điểm; 0 là không ai được). `rows` đã xếp theo điểm. */
export function pickMvp(rows: readonly MatchSummaryRow[]): MvpEntry[] {
  const out: MvpEntry[] = [];
  for (const kind of ["kills", "captures", "support"] as const) {
    let best: MatchSummaryRow | undefined;
    for (const r of rows) if (MVP_VALUE[kind](r) > (best ? MVP_VALUE[kind](best) : 0)) best = r;
    if (best) out.push({ kind, id: best.id, value: MVP_VALUE[kind](best) });
  }
  return out;
}

/**
 * Tính một lần hỗ trợ (tiếp tế đạn, sửa xe, hồi sinh đồng đội...) cho người chơi `playerId` ở phòng người đó đang chơi,
 * cho bảng vinh danh MVP Hỗ trợ. Gọi được từ bất cứ tính năng nào phía server (kể cả cho máy, khách).
 * awardXp(id, "resupply" | "repair" | "revive") đã tự gọi hàm này: đừng gọi cả hai cho cùng một việc.
 */
export function noteSupport(playerId: string, times = 1) {
  ROUTE.get(playerId)?.noteSupport(playerId, times);
}
