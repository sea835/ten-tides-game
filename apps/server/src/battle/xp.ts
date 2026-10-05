import { XP_AWARD, rankOf, type XpKind } from "@tentides/content";
import type { PlayerState, XpMessage } from "@tentides/protocol";
import { userIdOfPlayer } from "../account.ts";
import { noteSupport } from "./mvp.ts";

// Sổ XP của một phòng: cộng XP theo sự kiện trong trận (hạ gục, chiếm cứ điểm, tiếp tế, sửa xe, hồi sinh đồng đội)
// cho người có tài khoản, cập nhật quân hàm trong PlayerState ngay (người khác thấy huy hiệu lên cấp), báo riêng
// cho người đó dòng "+100 XP". XP chỉ ghi database lúc hết trận (MatchRewards.finish) hay khi phòng đóng.
// Khách, máy: không có XP. Ngoài lúc đang đánh (sảnh chờ, hết trận): không cộng.
//
// Tính năng khác (hồi sinh, tiếp tế, sửa xe...) chỉ cần gọi awardXp(playerId, kind): hàm tự tìm phòng người đó đang ở.

interface Entry {
  userId: number;
  /** XP đã có trong database lúc vào phòng (cộng cả phần đã ghi sau mỗi trận). */
  base: number;
  /** XP kiếm được từ lúc ghi database lần cuối. */
  earned: number;
  player: PlayerState;
}

/** Gửi riêng cho một người (phòng truyền vào: tìm client theo id người chơi rồi send). */
export type XpNotify = (playerId: string, msg: XpMessage) => void;

/** Sổ nào đang giữ người chơi nào: để awardXp gọi được từ bất cứ đâu chỉ với id người chơi. */
const ROUTE = new Map<string, XpLedger>();

export class XpLedger {
  private entries = new Map<string, Entry>();
  /** Đang trong trận (MatchRewards bật lúc vào trận, tắt lúc hết trận). */
  active = false;

  constructor(private readonly notify: XpNotify = () => {}) {}

  /**
   * Người có tài khoản vào phòng (hoặc vào lại): ghi XP gốc, chép quân hàm vào state. Vào lại thì giữ XP đang chờ ghi.
   * Khách và máy thì bỏ qua (quân hàm 0).
   */
  track(playerId: string, player: PlayerState, baseXp: number) {
    const userId = userIdOfPlayer(playerId);
    if (userId === null) return;
    const old = this.entries.get(playerId);
    const e: Entry = old ? { ...old, player } : { userId, base: Math.max(0, baseXp), earned: 0, player };
    this.entries.set(playerId, e);
    ROUTE.set(playerId, this);
    player.badge.rank = rankOf(e.base + e.earned);
  }

  /** Cộng XP cho một sự kiện. Trả về số XP đã cộng (0 nếu không được: khách, máy, ngoài trận). */
  award(playerId: string, kind: XpKind, times = 1): number {
    if (!this.active) return 0;
    const e = this.entries.get(playerId);
    const n = Math.max(0, Math.floor(times));
    if (!e || !n) return 0;
    const amount = XP_AWARD[kind] * n;
    e.earned += amount;
    e.player.badge.rank = rankOf(e.base + e.earned);
    this.notify(playerId, { kind, amount, match: e.earned, rank: e.player.badge.rank });
    return amount;
  }

  /** XP đang chờ ghi của một người. */
  pending(playerId: string): number {
    return this.entries.get(playerId)?.earned ?? 0;
  }

  /** Lấy hết XP chờ ghi (theo id người chơi) và dồn vào XP gốc, để ghi database. */
  drain(): Map<string, { userId: number; xp: number }> {
    const out = new Map<string, { userId: number; xp: number }>();
    for (const [id, e] of this.entries) {
      if (e.earned <= 0) continue;
      out.set(id, { userId: e.userId, xp: e.earned });
      e.base += e.earned;
      e.earned = 0;
    }
    return out;
  }

  /** Phòng đóng: thôi nhận XP qua awardXp. */
  dispose() {
    this.active = false;
    for (const id of this.entries.keys()) if (ROUTE.get(id) === this) ROUTE.delete(id);
  }
}

/**
 * Cộng XP cho người chơi `playerId` ở phòng người đó đang chơi. Gọi được từ bất cứ tính năng nào phía server
 * (hồi sinh đồng đội: "revive", tiếp tế đạn: "resupply", sửa xe tăng: "repair"...). Trả về số XP đã cộng.
 */
export function awardXp(playerId: string, kind: XpKind, times = 1): number {
  // Việc hỗ trợ (cả của máy, khách: không có XP) tính luôn vào bảng vinh danh MVP Hỗ trợ.
  if (kind === "resupply" || kind === "repair" || kind === "revive") noteSupport(playerId, times);
  return ROUTE.get(playerId)?.award(playerId, kind, times) ?? 0;
}
