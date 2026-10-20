import { DOWNED, MAX_HP, downedMode } from "@tentides/content";
import type { MoveMessage, PlayerState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { awardXp } from "./xp.ts";

// Trọng thương (Chiến trường, Đồng đội): trúng đòn chí mạng thì nằm gục (`PlayerState.downed` là số giây còn lại trước
// khi chết vì mất máu) thay vì chết ngay. Nằm gục thì vẫn `alive` nhưng không bắn, không ném, không lên xe, không chiếm
// cứ điểm, chỉ bò chậm; máy địch thôi nhắm vào (người thật bắn tiếp thì chết hẳn). Đồng đội (người giữ F, hay máy đứng gần không thấy địch) đứng sát đủ
// DOWNED.revive giây thì cứu dậy với DOWNED.hp máu (được XP "revive"); đang được cứu thì máu thôi chảy. Hết giờ, bị bắn
// tiếp, tự bỏ cuộc thì chết hẳn qua BattleRoom.kill: lúc đó mới mất vé, mạng tính cho người đã bắn gục (nếu có).
// Trúng đầu, nổ quá mạnh, đang ngồi xe, đang bơi thì chết luôn.

/** Ai đã bắn gục, bằng gì, có trúng đầu không (để tính mạng khi chết hẳn). */
interface Downer {
  killer: string;
  weapon: string;
  headshot: boolean;
}

/** Máy nằm gục mà quanh đây chừng này mét không có đồng đội nào đứng được thì bỏ cuộc sớm (đỡ phí thời gian hồi sinh). */
const BOT_ALONE_RANGE = 25;
const BOT_ALONE_SECONDS = 3;
/** Máy đi cứu đồng đội nằm gục trong vòng chừng này mét (không thấy địch), với xác suất này (mỗi lần gục). */
const BOT_RESCUE_RANGE = 15;
const BOT_RESCUE_CHANCE = 0.7;

export class Downed {
  private by = new Map<string, Downer>();
  /** Người nằm gục → ai đang cứu, đã giữ được bao lâu (giây). */
  private rescue = new Map<string, { by: string; t: number }>();
  /** Máy đang đi cứu ai; cặp (máy, người gục) đã bốc thăm rồi (khỏi bốc lại mỗi nhịp). */
  private goals = new Map<string, string>();
  private rolled = new Map<string, boolean>();

  constructor(private readonly room: BattleRoom) {}

  /** Trận mới, về sảnh: xoá hết trạng thái trọng thương. */
  clear() {
    this.by.clear();
    this.rescue.clear();
    this.goals.clear();
    this.rolled.clear();
    for (const p of this.room.state.players.values()) {
      p.downed = 0;
      p.revive = 0;
    }
  }

  /** Người này đang nằm gục (không được bắn, ném, lên xe, băng bó...). */
  blocks(id: string): boolean {
    return (this.room.state.players.get(id)?.downed ?? 0) > 0;
  }

  /**
   * Đòn chí mạng này làm `p` nằm gục (true) hay chết luôn (false). `overkill` là phần sát thương vượt quá số máu còn
   * lại. Đang nằm gục mà trúng tiếp thì chết hẳn.
   */
  tryDown(id: string, p: PlayerState, part: string, overkill: number, attacker: string, weapon: string): boolean {
    const s = this.room.state;
    if (!downedMode(s.battleMode) || s.phase !== "battle" || p.downed > 0) return false;
    if (part === "head" || part === "zone" || p.vehicle || p.swimming) return false;
    if (part === "blast" && overkill > DOWNED.blastOverkill) return false;
    p.downed = DOWNED.seconds;
    p.revive = 0;
    p.hp = 1;
    p.prone = true;
    p.crouching = p.aiming = p.moving = false;
    p.lean = 0;
    p.gait = 0;
    this.room.cancelTimer(id);
    this.by.set(id, { killer: attacker, weapon, headshot: false });
    this.rescue.delete(id);
    this.room.updateAliveCount();
    return true;
  }

  /**
   * BattleRoom.kill gọi khi người đang nằm gục chết hẳn: mạng tính cho người đã bắn gục (nếu có), không phải người
   * bắn phát kết liễu (người đó được tính trợ giúp như thường). Xoá trạng thái trọng thương.
   */
  credit(id: string, killer: string, weapon: string, headshot: boolean): Downer {
    const p = this.room.state.players.get(id);
    const d = this.by.get(id);
    this.forget(id);
    if (p) {
      p.downed = 0;
      p.revive = 0;
    }
    return d && d.killer ? d : { killer: killer || d?.killer || "", weapon: killer ? weapon : d?.weapon || weapon, headshot };
  }

  /** Chết hẳn: hết máu chảy, tự bỏ cuộc (Messages.giveUp), máy nằm một mình. */
  finish(id: string) {
    const p = this.room.state.players.get(id);
    if (!p || !p.alive || p.downed <= 0) return;
    this.room.kill(id, "", "bleed", false);
  }

  /** Người `id` giữ F (on) / buông (off) cạnh đồng đội `target` đang nằm gục. */
  hold(id: string, target: string, on: boolean) {
    const cur = this.rescue.get(target);
    if (!on) {
      if (cur?.by === id) this.rescue.delete(target);
      return;
    }
    if (cur && cur.by !== id && this.canRescue(cur.by, target)) return;
    if (!this.canRescue(id, target)) return;
    this.rescue.set(target, { by: id, t: cur?.by === id ? cur.t : 0 });
  }

  /** `id` cứu được `target` không: còn đứng được, đi bộ, cùng phe, đứng sát. */
  private canRescue(id: string, target: string): boolean {
    const s = this.room.state;
    const p = s.players.get(id);
    const t = s.players.get(target);
    if (!p || !t || id === target || !p.alive || p.downed > 0 || p.vehicle || !t.alive || t.downed <= 0) return false;
    if (!p.team || p.team !== t.team) return false;
    return Math.hypot(p.x - t.x, p.z - t.z) <= DOWNED.range + 0.6 && Math.abs(p.y - t.y) < 1.8;
  }

  /** Cứu dậy: đứng dậy với chút máu, người cứu được XP, điểm hỗ trợ. */
  private revive(id: string, by: string) {
    const p = this.room.state.players.get(id);
    if (!p) return;
    this.forget(id);
    p.downed = 0;
    p.revive = 0;
    p.hp = Math.min(MAX_HP, DOWNED.hp);
    awardXp(by, "revive");
    this.room.updateAliveCount();
  }

  private forget(id: string) {
    this.by.delete(id);
    this.rescue.delete(id);
    for (const [bot, t] of this.goals) if (t === id) this.goals.delete(bot);
    for (const k of this.rolled.keys()) if (k.endsWith(`>${id}`)) this.rolled.delete(k);
  }

  /** Bò khi nằm gục: không nhanh hơn DOWNED.crawl (có dư cho trễ mạng). */
  crawlOk(p: PlayerState, move: MoveMessage, elapsedMs: number): boolean {
    if (p.downed <= 0) return true;
    const seconds = Math.max(elapsedMs, 100) / 1000;
    return Math.hypot(move.x - p.x, move.z - p.z) <= DOWNED.crawl * 2.5 * seconds + 0.3;
  }

  /** Dáng nằm gục: nằm sấp, không ngắm, không nghiêng (gói đi lại báo gì cũng vậy). */
  pose(p: PlayerState) {
    if (p.downed <= 0) return;
    p.prone = true;
    p.crouching = p.aiming = false;
    p.lean = 0;
    p.gait = 0;
  }

  tick(dt: number) {
    const s = this.room.state;
    if (s.phase !== "battle" || !downedMode(s.battleMode)) return;
    for (const [id, p] of s.players) {
      if (!p.alive || p.downed <= 0) continue;
      const r = this.rescue.get(id);
      if (r && this.canRescue(r.by, id)) {
        // Đang được cứu: máu thôi chảy.
        r.t += dt;
        p.revive = Math.min(100, Math.round((r.t / DOWNED.revive) * 100));
        if (r.t >= DOWNED.revive) this.revive(id, r.by);
        continue;
      }
      if (r) this.rescue.delete(id);
      p.revive = 0;
      // Không xuống tới 0 trước khi chết hẳn (kill() dựa vào `downed > 0` để tính mạng cho người bắn gục).
      p.downed = Math.max(0.001, p.downed - dt);
      // Máy nằm một mình (không đồng đội nào gần): bỏ cuộc sớm, về hồi sinh.
      const alone = p.bot && DOWNED.seconds - p.downed > BOT_ALONE_SECONDS && !this.mateNear(id, p, BOT_ALONE_RANGE);
      if (p.downed <= 0.001 || alone) this.finish(id);
    }
  }

  /** Có đồng đội nào còn đứng được trong vòng `range` mét quanh `p` không. */
  private mateNear(id: string, p: PlayerState, range: number): boolean {
    for (const [qid, q] of this.room.state.players)
      if (qid !== id && q.alive && q.downed <= 0 && q.team && q.team === p.team && Math.hypot(q.x - p.x, q.z - p.z) < range) return true;
    return false;
  }

  /**
   * Máy (không thấy địch) đi cứu đồng đội nằm gục gần đó: trả về chỗ cần tới, `near` là đã tới sát (ngồi xuống giữ
   * cứu). Không có ai cần cứu (hay lần này bốc thăm không đi) thì null.
   */
  botRescue(id: string, p: PlayerState): { x: number; z: number; near: boolean } | null {
    const s = this.room.state;
    if (s.phase !== "battle" || !downedMode(s.battleMode) || p.downed > 0 || p.vehicle) return null;
    let tid = this.goals.get(id);
    let t = tid ? s.players.get(tid) : undefined;
    const claimed = (target: string) => {
      const r = this.rescue.get(target);
      return !!r && r.by !== id && this.canRescue(r.by, target);
    };
    if (!t || !tid || !t.alive || t.downed <= 0 || t.team !== p.team || claimed(tid) || Math.hypot(t.x - p.x, t.z - p.z) > BOT_RESCUE_RANGE * 1.4) {
      if (tid) this.goals.delete(id);
      tid = undefined;
      t = undefined;
      let best = BOT_RESCUE_RANGE;
      for (const [qid, q] of s.players) {
        if (qid === id || !q.alive || q.downed <= 0 || !p.team || q.team !== p.team || claimed(qid)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d >= best || Math.abs(q.y - p.y) > 4) continue;
        // Mỗi lần gục chỉ bốc thăm một lần cho mỗi máy: không phải máy nào gần cũng chạy tới.
        const key = `${id}>${qid}`;
        let go = this.rolled.get(key);
        if (go === undefined) {
          go = Math.random() < BOT_RESCUE_CHANCE;
          this.rolled.set(key, go);
        }
        if (!go) continue;
        best = d;
        tid = qid;
        t = q;
      }
      if (!tid || !t) return null;
      this.goals.set(id, tid);
    }
    const near = Math.hypot(t.x - p.x, t.z - p.z) <= DOWNED.range - 0.5 && Math.abs(t.y - p.y) < 1.5;
    if (near) this.hold(id, tid, true);
    return { x: t.x, z: t.z, near };
  }
}
