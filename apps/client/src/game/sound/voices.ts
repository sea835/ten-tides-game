// Bộ giới hạn tiếng toàn cục: đại chiến 50v50 có thể nổ hàng trăm phát súng một lúc, mỗi phát vài chục nút Web
// Audio; quá nhiều nút cùng chạy thì luồng âm thanh của trình duyệt quá tải (rè, giật tiếng). Mọi tiếng lẻ (một phát
// súng, một bước chân, một vụ nổ...) phải xin một chỗ ở đây trước khi dựng nút; đầy chỗ thì tiếng kém ưu tiên nhất,
// nhỏ nhất bị cướp, hoặc tiếng mới bị bỏ luôn nếu nó còn kém hơn mọi tiếng đang phát.
// Tiếng giao diện (bus "ui") và các vòng lặp nền dựng một lần (động cơ, gió, mưa) không qua đây.

/**
 * Mức ưu tiên (số nhỏ = quan trọng hơn):
 * 0 — tiếng của chính mình (súng mình bắn, nạp đạn, đổi súng);
 * 1 — bước chân, đạn bay sượt tai (thông tin sống còn);
 * 2 — vụ nổ, động cơ, tiếng súng người khác trong 150 m, va chạm;
 * 3 — tiếng súng xa ngoài 150 m, tiếng nền lẻ tẻ.
 */
export type VoicePriority = 0 | 1 | 2 | 3;

/** Số tiếng lẻ tối đa cùng phát. */
export const MAX_VOICES = 32;
/** Xa hơn chừng này mét thì tiếng súng thuộc mức 3. */
export const DISTANT_GUNFIRE = 150;
/** Nhỏ hơn mức này thì không ai nghe: bỏ trước khi dựng nút. */
export const INAUDIBLE = 0.004;

export interface VoiceSlot {
  readonly prio: VoicePriority;
  /** Độ to thực (sau khi tính khoảng cách). */
  readonly level: number;
  /** Độ "đáng giữ" lúc `now` (giây theo đồng hồ AudioContext): to và còn dài thì giữ. */
  score(now: number): number;
  /** Hết hẳn lúc nào (giây theo đồng hồ AudioContext). */
  readonly end: number;
  /** Tắt nhanh rồi tháo nút (bị cướp). */
  kill(): void;
}

/** Kết quả xin chỗ: được phát (có thể kèm tiếng phải nhường chỗ) hay bị bỏ. */
export type Admission = { ok: true; victim: VoiceSlot | null } | { ok: false };

const REJECT: Admission = { ok: false };
const FREE: Admission = { ok: true, victim: null };

export class VoiceLimiter {
  private slots: VoiceSlot[] = [];
  /** Số lần cướp / bỏ (để đo đạc). */
  stolen = 0;
  dropped = 0;

  constructor(readonly cap = MAX_VOICES) {}

  get count(): number {
    return this.slots.length;
  }

  /** Bỏ khỏi danh sách các tiếng đã hết mà chưa kịp tự trả chỗ. */
  private prune(now: number) {
    const list = this.slots;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.end + 0.1 < now) list.splice(i, 1);
  }

  /**
   * Xét một tiếng mới (chưa dựng nút): còn chỗ thì cho; đầy thì tìm tiếng kém ưu tiên nhất (cùng mức thì tiếng có
   * độ "đáng giữ" thấp nhất). Tiếng đó kém ưu tiên hơn tiếng mới, hoặc cùng mức mà nhỏ hơn rõ, thì phải nhường;
   * không thì bỏ tiếng mới. Không đổi gì cho tới khi gọi `add` (người gọi còn có thể đổi ý).
   */
  admit(prio: VoicePriority, level: number, now: number): Admission {
    if (!(level >= INAUDIBLE)) {
      this.dropped++;
      return REJECT;
    }
    this.prune(now);
    if (this.slots.length < this.cap) return FREE;
    let victim: VoiceSlot | null = null;
    let victimScore = Infinity;
    for (const s of this.slots) {
      const sc = s.score(now);
      if (!victim || s.prio > victim.prio || (s.prio === victim.prio && sc < victimScore)) {
        victim = s;
        victimScore = sc;
      }
    }
    if (!victim || victim.prio < prio || (victim.prio === prio && victimScore > level * 1.5)) {
      this.dropped++;
      return REJECT;
    }
    return { ok: true, victim };
  }

  /** Ghi nhận tiếng vừa dựng (sau `admit`), cướp chỗ của `victim` nếu có. */
  add(slot: VoiceSlot, victim: VoiceSlot | null) {
    if (victim && this.slots.includes(victim)) {
      this.stolen++;
      victim.kill();
      this.remove(victim);
    }
    this.slots.push(slot);
  }

  /** Trả chỗ (tiếng hết, hoặc bị tắt). */
  remove(slot: VoiceSlot) {
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
  }
}

/** Bộ giới hạn dùng chung cho cả engine.output() lẫn tiếng súng (guns.ts). */
export const voices = new VoiceLimiter();

/** Mức ưu tiên mặc định cho một tiếng theo bus và khoảng cách (khi nơi gọi không nói rõ). */
export function defaultPriority(bus: string, distance: number | null): VoicePriority {
  if (bus === "ambience") return 3;
  if (distance === null) return 1;
  return distance > DISTANT_GUNFIRE ? 3 : 2;
}
