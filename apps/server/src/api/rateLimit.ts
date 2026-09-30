// Giới hạn số lần gọi theo khoá (IP), giữ trong bộ nhớ: đủ để chặn dò mật khẩu kiểu đơn giản.

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Ghi một lần gọi; trả về false nếu đã vượt giới hạn trong khung thời gian. */
  take(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    // Dọn khoá cũ thỉnh thoảng cho khỏi phình bộ nhớ.
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => t > since)) this.hits.delete(k);
    return true;
  }
}
