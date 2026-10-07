import type { XpMessage } from "@tentides/protocol";

// XP trận này của mình (server gửi Messages.xp mỗi lần được cộng, kèm tổng XP của trận). XpFeed ghi vào đây trong trận,
// màn vinh danh cuối trận đọc ra để chạy thanh kinh nghiệm. Khách và máy không có XP (bằng 0).

export const matchXp = { total: 0, rank: 0 };

export function noteXp(m: XpMessage) {
  matchXp.total = Math.max(0, m.match);
  matchXp.rank = m.rank;
}

/** Sang trận mới (về sảnh, chuẩn bị): xoá số cũ. */
export function resetMatchXp() {
  matchXp.total = 0;
  matchXp.rank = 0;
}
