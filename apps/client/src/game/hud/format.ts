import { content, worldCatalog } from "@tentides/content";
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

const ENCOUNTER_WORDS: Record<string, string> = {
  egg: "Tìm thấy",
  anomaly: "Chạm vào",
  trap: "Sập bẫy",
  creature: "Bị tấn công",
  friend: "Làm quen",
  drowning: "Đuối nước",
  attack: "Bị đánh",
  fall: "Té từ trên cây",
  hunt: "Giết thú hiền",
  page: "Trang nhật ký",
  lava: "Dung nham",
  burn: "Bỏng lửa trại",
};

const REASONS: Record<string, string> = {
  dusk: "Hết ngày (đói thêm, ngủ ngoài)",
  night: "Qua đêm (ăn uống, ngủ)",
  sudden: "Gục ngã đột ngột",
  build: "Dựng nhà",
  stash: "Góp vào kho",
};

/** Dịch mã lý do trong nhật ký chỉ số ra lời, vd. "card:cave_mouth_01" → "Thẻ: Bức vẽ trên vách". */
export function statReason(reason: string): string {
  const [kind, a = "", b = ""] = reason.split(":");
  if (kind === "card") return `Thẻ: ${content.cards.get(a)?.title ?? a}`;
  if (kind === "eat") return `Ăn uống: ${itemName(a)}`;
  if (kind === "encounter") {
    const thing =
      worldCatalog.creatures.get(b)?.name ?? worldCatalog.pois.get(b)?.name ?? worldCatalog.traps.get(b)?.name ?? (b === "fists" ? "" : content.items.get(b)?.name ?? "");
    return [ENCOUNTER_WORDS[a] ?? a, thing].filter(Boolean).join(": ");
  }
  return REASONS[kind ?? ""] ?? reason;
}
