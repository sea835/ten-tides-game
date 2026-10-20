// Trọng thương (Chiến trường, Đồng đội): trúng đòn chí mạng thì chưa chết ngay mà nằm gục, bò chậm, máu chảy dần;
// đồng đội đứng sát giữ F một lúc thì cứu dậy với chút máu. Hết giờ chảy máu, bị bắn tiếp, hay tự bỏ cuộc thì mới
// chết thật (mất vé, tính mạng cho người đã bắn gục). Trúng đầu, nổ quá mạnh, chết theo xe thì chết luôn.
// Server (apps/server/src/battle/downed.ts) và client dùng chung các số dưới đây.

export const DOWNED = {
  /** Thời gian chảy máu tối đa (giây) trước khi chết hẳn. */
  seconds: 15,
  /** Giữ F bao lâu (giây) để cứu dậy, đứng cách người gục tối đa bao xa (m). */
  revive: 2.5,
  range: 2.2,
  /** Máu sau khi được cứu (trên MAX_HP 100). */
  hp: 30,
  /** Tốc độ bò khi trọng thương (m/s). */
  crawl: 0.6,
  /** Nổ mạnh hơn mức chí mạng chừng này máu thì chết luôn, không kịp nằm gục. */
  blastOverkill: 35,
  /** Giữ phím bỏ cuộc (Space) bao lâu (giây) thì chết hẳn để hồi sinh. */
  giveUpHold: 1,
} as const;

/** Chế độ có trọng thương: Chiến trường, Đồng đội (sinh tồn solo, hải chiến thì chết luôn). */
export function downedMode(mode: string): boolean {
  return mode === "war" || mode === "squad";
}
