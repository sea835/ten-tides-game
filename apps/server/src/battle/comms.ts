import { MAP_HALF_SIZE } from "@tentides/content";
import {
  Messages,
  PING_MAX_DISTANCE,
  PING_MIN_INTERVAL_MS,
  PING_TTL_MS,
  RADIO_MIN_INTERVAL_MS,
  type IslandState,
  type PingBroadcast,
  type PingMessage,
  type PlayerState,
  type RadioBroadcast,
  type RadioLine,
} from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";

// Liên lạc trong đội: đánh dấu chuột giữa (chỗ thường, địch, nguy hiểm) và câu bộ đàm (vòng khẩu lệnh). Server kiểm
// tra (nhịp gửi, tầm xa, người bị đánh dấu có thật là địch, ở gần chỗ đánh dấu) rồi chỉ chuyển cho người cùng đội
// (đội của người chơi ở chế độ Đồng đội, phe ở Chiến trường). Solo không có đội: chỉ mình thấy dấu của mình.

/** Người bị đánh dấu "địch" phải ở gần chỗ đánh dấu chừng này mét (bù độ trễ, nội suy trên máy người đánh dấu). */
export const PING_TARGET_SLACK = 6;
/** Câu tấn công / phòng thủ: gắn tên cứ điểm gần nhất trong tầm này (m). */
const FLAG_NEAR = 140;

/** Hai người có phải địch của nhau không (không đội là địch của mọi người). */
export function hostile(a: PlayerState, b: PlayerState): boolean {
  return !a.team || a.team !== b.team;
}

/**
 * Kiểm tra một dấu: người gửi còn sống, điểm đánh dấu hợp lệ (trong bản đồ, không quá xa người gửi). Dấu địch: người
 * bị đánh dấu phải còn sống, là địch, ở gần chỗ đánh dấu, không thì hạ xuống thành dấu chỗ thường. Trả về dấu để
 * chuyển đi (dấu địch lấy đúng vị trí người đó trên server), hay null nếu bỏ.
 */
export function validatePing(state: IslandState, id: string, m: PingMessage, half = MAP_HALF_SIZE): PingBroadcast | null {
  const p = state.players.get(id);
  if (!p || !p.alive) return null;
  if (Math.abs(m.x) > half + 40 || Math.abs(m.z) > half + 40 || m.y < -60 || m.y > 400) return null;
  if (Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) > PING_MAX_DISTANCE) return null;
  let kind = m.kind;
  let x = m.x;
  let y = m.y;
  let z = m.z;
  let target = "";
  if (kind === "enemy") {
    const t = m.target && m.target !== id ? state.players.get(m.target) : undefined;
    if (t && t.alive && hostile(p, t) && Math.hypot(t.x - m.x, t.z - m.z) <= PING_TARGET_SLACK && Math.abs(t.y - m.y) <= PING_TARGET_SLACK) {
      target = m.target!;
      x = t.x;
      y = t.y;
      z = t.z;
    } else kind = "spot";
  }
  return { from: id, name: p.name, kind, x, y, z, target, ttl: PING_TTL_MS[kind] };
}

/** Những người nghe được người `id`: cả đội (cùng `team`), không đội thì chỉ mình. */
export function audience(state: IslandState, id: string): string[] {
  const p = state.players.get(id);
  if (!p) return [];
  if (!p.team) return [id];
  const out: string[] = [];
  for (const [qid, q] of state.players) if (q.team === p.team && !q.bot) out.push(qid);
  return out;
}

export class Comms {
  private lastPing = new Map<string, number>();
  private lastRadio = new Map<string, number>();

  constructor(private readonly room: BattleRoom) {}

  clear() {
    this.lastPing.clear();
    this.lastRadio.clear();
  }

  private send(to: string[], type: string, msg: unknown) {
    for (const id of to) this.room.clientOf(id)?.send(type, msg);
  }

  /** Người `id` đánh dấu. Trả về dấu đã chuyển đi (để thử nghiệm), hay null nếu bị bỏ. */
  ping(id: string, m: PingMessage, now = Date.now()): PingBroadcast | null {
    if (!this.room.fighting()) return null;
    if (now - (this.lastPing.get(id) ?? -Infinity) < PING_MIN_INTERVAL_MS) return null;
    const out = validatePing(this.room.state, id, m, this.room.map?.half ?? MAP_HALF_SIZE);
    if (!out) return null;
    this.lastPing.set(id, now);
    this.send(audience(this.room.state, id), Messages.ping, out);
    return out;
  }

  /** Người (hay máy) `id` nói một câu bộ đàm. `force`: máy trả lời lệnh, khỏi tính nhịp gửi. */
  radio(id: string, line: RadioLine, now = Date.now(), force = false): RadioBroadcast | null {
    const s = this.room.state;
    const p = s.players.get(id);
    if (!p || !p.alive || !this.room.fighting()) return null;
    if (!force && now - (this.lastRadio.get(id) ?? -Infinity) < RADIO_MIN_INTERVAL_MS) return null;
    this.lastRadio.set(id, now);
    let flag = "";
    if ((line === "attack" || line === "defend") && s.battleMode === "war") {
      let best = FLAG_NEAR;
      for (const [fid, f] of s.flags) {
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        if (d < best) {
          best = d;
          flag = fid;
        }
      }
    }
    const out: RadioBroadcast = { from: id, name: p.name.replace("🤖 ", ""), line, flag };
    this.send(audience(s, id), Messages.radio, out);
    return out;
  }

  /** Đội trưởng vừa ra lệnh: một máy còn sống trong đội đáp "Rõ" qua bộ đàm (không quá 1 lần / 1,5 giây mỗi đội). */
  acknowledge(team: string, now = Date.now(), prefer = "") {
    const key = `team:${team}`;
    if (now - (this.lastRadio.get(key) ?? -Infinity) < 1500) return null;
    let bot = "";
    for (const [id, q] of this.room.state.players) {
      if (!q.bot || !q.alive || q.team !== team) continue;
      if (!bot || id === prefer) bot = id;
      if (id === prefer) break;
    }
    if (!bot) return null;
    this.lastRadio.set(key, now);
    return this.radio(bot, "ack", now, true);
  }
}
