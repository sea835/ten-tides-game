// PRNG có seed (mulberry32). Trạng thái là một số uint32 nên lưu được vào event log,
// và mọi hàm đều thuần: nhận trạng thái cũ, trả về giá trị kèm trạng thái mới.

export type RngState = number;

export interface Rolled<T> {
  value: T;
  rng: RngState;
}

/** Băm một chuỗi (vd. mã phòng + thời điểm) thành seed uint32 (FNV-1a). */
export function seedFromString(input: string): RngState {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Số thực trong [0, 1). */
export function nextFloat(rng: RngState): Rolled<number> {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, rng: next };
}

/** Số nguyên trong [min, max], tính cả hai đầu. */
export function nextInt(rng: RngState, min: number, max: number): Rolled<number> {
  const r = nextFloat(rng);
  return { value: min + Math.floor(r.value * (max - min + 1)), rng: r.rng };
}

export function pick<T>(rng: RngState, items: readonly T[]): Rolled<T> {
  if (items.length === 0) throw new Error("pick() cần mảng không rỗng");
  const r = nextInt(rng, 0, items.length - 1);
  return { value: items[r.value]!, rng: r.rng };
}

/** Xáo trộn Fisher–Yates, trả mảng mới. */
export function shuffle<T>(rng: RngState, items: readonly T[]): Rolled<T[]> {
  const out = items.slice();
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(state, 0, i);
    state = r.rng;
    [out[i], out[r.value]] = [out[r.value]!, out[i]!];
  }
  return { value: out, rng: state };
}
