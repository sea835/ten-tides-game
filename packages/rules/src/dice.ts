import { nextInt, type RngState } from "./rng.ts";
import { STAT_LABELS, type StatId, type Stats } from "./stats.ts";

export interface Modifier {
  label: string;
  value: number;
}

export interface CheckInput {
  stat: StatId;
  dc: number;
  stats: Stats;
  /** Các khoản cộng khác: đồ trong balo, trạng thái... */
  modifiers?: Modifier[];
}

/** Kết quả tung xúc xắc, đủ chi tiết để hiện công khai cho cả đội. */
export interface CheckResult {
  roll: number;
  modifiers: Modifier[];
  total: number;
  dc: number;
  success: boolean;
  /** Mặt xúc xắc lần đầu, nếu được tung lại (Tay cờ bạc). */
  rerolledFrom?: number;
}

/** Tung d20 + thuộc tính + các khoản cộng, so với độ khó (DC). */
export function rollCheck(rng: RngState, input: CheckInput): { result: CheckResult; rng: RngState } {
  const d20 = nextInt(rng, 1, 20);
  const modifiers: Modifier[] = [
    { label: STAT_LABELS[input.stat], value: input.stats[input.stat] },
    ...(input.modifiers ?? []),
  ];
  const total = d20.value + modifiers.reduce((sum, m) => sum + m.value, 0);
  return {
    result: { roll: d20.value, modifiers, total, dc: input.dc, success: total >= input.dc },
    rng: d20.rng,
  };
}
