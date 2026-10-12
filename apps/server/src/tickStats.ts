// Đo thời gian nhịp của phòng: mỗi nhịp ghi vào vòng đệm cố định (không cấp phát thêm), chia theo từng phần (máy,
// xe, hải chiến...), cộng thời gian Colyseus mã hoá và gửi trạng thái. Đủ rẻ để bật luôn khi chạy thật: mỗi phần chỉ
// một lần gọi performance.now(). Đọc ra p50/p95/max để in tóm tắt mỗi phút và trả cho /health.

/** 60 giây ở 20 nhịp mỗi giây. */
const CAPACITY = 1200;

/** Vòng đệm số thực: giữ `capacity` giá trị gần nhất. */
export class Ring {
  private readonly buf: Float64Array;
  private next = 0;
  private count = 0;

  constructor(readonly capacity = CAPACITY) {
    this.buf = new Float64Array(capacity);
  }

  push(v: number) {
    this.buf[this.next] = v;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get size(): number {
    return this.count;
  }

  /** `k` giá trị gần nhất (mặc định: tất cả đang giữ), bản sao. */
  recent(k = this.count): Float64Array {
    const n = Math.min(k, this.count);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.buf[(this.next - n + i + this.capacity) % this.capacity]!;
    return out;
  }

  clear() {
    this.next = 0;
    this.count = 0;
  }
}

export interface Summary {
  n: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

/** p50/p95/max/trung bình của một dãy số (ms), làm tròn 0,01. */
export function summarize(values: Float64Array): Summary {
  const n = values.length;
  if (!n) return { n: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = values.slice().sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i]!;
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n, avg: r(sum / n), p50: r(at(0.5)), p95: r(at(0.95)), max: r(sorted[n - 1]!) };
}

export class TickStats {
  /** Cả nhịp (ms). */
  readonly tick = new Ring();
  /** Colyseus mã hoá và gửi trạng thái (broadcastPatch, trừ phần nhịp chạy bên trong). */
  readonly sync = new Ring();
  readonly phases = new Map<string, Ring>();
  private start = 0;
  private lap = 0;
  /** Thời gian nhịp chạy bên trong lần gửi trạng thái đang đo (đồng hồ phòng chạy trong broadcastPatch). */
  private nested = 0;

  begin() {
    this.start = this.lap = performance.now();
  }

  /** Kết thúc một phần của nhịp: thời gian từ lần đánh dấu trước tới giờ. */
  mark(phase: string) {
    const now = performance.now();
    let ring = this.phases.get(phase);
    if (!ring) this.phases.set(phase, (ring = new Ring()));
    ring.push(now - this.lap);
    this.lap = now;
  }

  /** Kết thúc nhịp; trả về thời gian cả nhịp (ms). */
  end(): number {
    const ms = performance.now() - this.start;
    this.tick.push(ms);
    this.nested += ms;
    return ms;
  }

  /** Đo một lần gửi trạng thái `send` (phần nhịp chạy bên trong không tính vào). */
  patch<T>(send: () => T): T {
    const t0 = performance.now();
    this.nested = 0;
    try {
      return send();
    } finally {
      this.sync.push(Math.max(0, performance.now() - t0 - this.nested));
    }
  }

  /** Tóm tắt `k` nhịp gần nhất (mặc định cả vòng đệm, chừng 60 giây). */
  summary(k?: number): { tick: Summary; sync: Summary; phases: Record<string, Summary> } {
    const phases: Record<string, Summary> = {};
    for (const [name, ring] of this.phases) phases[name] = summarize(ring.recent(k));
    return { tick: summarize(this.tick.recent(k)), sync: summarize(this.sync.recent(k)), phases };
  }
}

/**
 * Giữ nhịp trong hạn: p95 vượt `budget` ms thì nâng một bậc (máy suy nghĩ thưa hơn), xuống dưới `relax` ms đủ lâu thì
 * hạ một bậc. Bậc 0 là bình thường.
 */
export class TickBudget {
  level = 0;
  private changedAt = -Infinity;

  constructor(
    readonly budget = 35,
    readonly relax = 20,
    readonly maxLevel = 3,
    /** Đổi bậc cách nhau ít nhất chừng này ms (chờ số đo mới phản ánh bậc vừa đổi). */
    readonly holdMs = 5000,
  ) {}

  /** Xét p95 mới; trả về +1 nếu vừa nâng bậc, -1 nếu vừa hạ, 0 nếu giữ nguyên. */
  update(p95: number, now: number): -1 | 0 | 1 {
    if (now - this.changedAt < this.holdMs) return 0;
    if (p95 > this.budget && this.level < this.maxLevel) {
      this.level++;
      this.changedAt = now;
      return 1;
    }
    if (p95 < this.relax && this.level > 0) {
      this.level--;
      this.changedAt = now;
      return -1;
    }
    return 0;
  }
}

/** Ảnh chụp sức khoẻ một phòng cho /health (không có mã phòng: mã là chìa khoá để vào phòng). */
export interface RoomHealth {
  kind: string;
  mode: string;
  phase: string;
  clients: number;
  humans: number;
  bots: number;
  tick: Summary;
  sync: Summary;
  /** Bậc giảm tải máy (0 = bình thường). */
  load: number;
}

/** Các phòng đang chạy trên tiến trình này (phòng tự thêm lúc tạo, tự bỏ lúc đóng). */
export const liveRooms = new Set<{ health(): RoomHealth }>();
