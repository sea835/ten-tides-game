import { content } from "@tentides/content";
import { STAT_LABELS, type Check, type Outcome } from "@tentides/rules";

export function itemName(id: string): string {
  return content.items.get(id)?.name ?? id;
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Mô tả một phép kiểm tra cho người chơi, vd. "Khéo léo · DC 10 · Dây thừng +2". */
export function describeCheck(check: Check, myItems: readonly string[]): { text: string; bonuses: { label: string; have: boolean }[] } {
  const bonuses = Object.entries(check.itemBonus ?? {}).map(([id, bonus]) => ({
    label: `${itemName(id)} ${signed(bonus)}`,
    have: myItems.includes(id),
  }));
  return { text: `${STAT_LABELS[check.stat]} · DC ${check.dc}`, bonuses };
}

/** Kết quả dạng ngắn gọn, vd. ["+2 lương thực", "-10 máu"]. */
export function describeOutcome(outcome: Outcome): string[] {
  const parts: string[] = [];
  if (outcome.hp) parts.push(`${signed(outcome.hp)} máu`);
  if (outcome.morale) parts.push(`${signed(outcome.morale)} tinh thần`);
  if (outcome.hunger) parts.push(`${signed(outcome.hunger)} no`);
  if (outcome.stamina) parts.push(`${signed(outcome.stamina)} sức bền`);
  if (outcome.food) parts.push(`${signed(outcome.food)} lương thực chung`);
  if (outcome.treasure) parts.push(`${signed(outcome.treasure)} tiến độ kho báu`);
  if (outcome.hull) parts.push(`${signed(outcome.hull)} độ bền thuyền`);
  if (outcome.gainItem) parts.push(`nhận ${itemName(outcome.gainItem)}`);
  if (outcome.loseRandomItem) parts.push(`mất ${outcome.loseRandomItem} món đồ`);
  if (outcome.lostUntilDusk) parts.push("lạc tới hoàng hôn");
  if (outcome.setFlag) parts.push("mở ra điều gì đó mới");
  return parts;
}
