// Tiến trình quân hàm (metagame): điểm kinh nghiệm (XP) theo sự kiện trong trận, 30 cấp quân hàm từ Binh Nhì tới
// Đại Tướng, thẻ tên (calling card) và huy hiệu (emblem) mở khoá theo quân hàm hoặc theo kho skin gacha.
// Dùng chung cho server (cộng XP, kiểm tra quyền lắp thẻ) và client (vẽ huy hiệu quân hàm, thẻ tên).

import { rarityRank, SKIN, type SkinRarity } from "./skins.ts";

// ---------------------------------------------------------------------------- XP

/** Các sự kiện được cộng XP. */
export type XpKind = "kill" | "headshot" | "capture" | "resupply" | "repair" | "revive";

/** XP mỗi sự kiện. Hạ gục bằng phát vào đầu tính "headshot" (thay cho "kill", không cộng dồn). */
export const XP_AWARD: Record<XpKind, number> = {
  kill: 100,
  headshot: 150,
  capture: 400,
  resupply: 50,
  repair: 50,
  revive: 150,
};

/** Nhãn ngắn cho dòng "+100 XP" trên HUD. */
export const XP_LABEL: Record<XpKind, string> = {
  kill: "Hạ gục",
  headshot: "Hạ gục bằng phát vào đầu",
  capture: "Chiếm cứ điểm",
  resupply: "Tiếp tế đạn",
  repair: "Sửa xe tăng",
  revive: "Hồi sinh đồng đội",
};

export function isXpKind(k: string): k is XpKind {
  return Object.prototype.hasOwnProperty.call(XP_AWARD, k);
}

// ---------------------------------------------------------------------------- quân hàm

/** Nhóm quân hàm: mỗi nhóm một kiểu phù hiệu (vạch, sao, viền vàng...). */
export type RankGroup = "enlisted" | "nco" | "warrant" | "company" | "field" | "general";

export interface RankDef {
  /** Số thứ tự 1–30 (cũng là giá trị `rank` đồng bộ trong PlayerState; 0 là khách, không có quân hàm). */
  rank: number;
  name: string;
  /** Tên tiếng Anh tương đương. */
  en: string;
  group: RankGroup;
  /** Số sao trên phù hiệu (cấp uý, tá, tướng). */
  stars: number;
  /** Số vạch chữ V (binh, hạ sĩ quan). */
  chevrons: number;
  /** Bậc phụ trong cùng một quân hàm (I, II, III), 0 là không chia bậc. */
  grade: number;
  /** Tổng XP cần để lên quân hàm này. */
  xp: number;
}

export const RANK_GROUP_NAME: Record<RankGroup, string> = {
  enlisted: "Binh sĩ",
  nco: "Hạ sĩ quan",
  warrant: "Chuẩn uý",
  company: "Cấp uý",
  field: "Cấp tá",
  general: "Cấp tướng",
};

type RankSeed = [name: string, en: string, group: RankGroup, stars: number, chevrons: number, grade: number];

const RANK_SEEDS: readonly RankSeed[] = [
  ["Binh Nhì", "Private", "enlisted", 0, 1, 0],
  ["Binh Nhất", "Private First Class", "enlisted", 0, 2, 0],
  ["Hạ Sĩ I", "Corporal I", "nco", 0, 1, 1],
  ["Hạ Sĩ II", "Corporal II", "nco", 0, 1, 2],
  ["Trung Sĩ I", "Sergeant I", "nco", 0, 2, 1],
  ["Trung Sĩ II", "Sergeant II", "nco", 0, 2, 2],
  ["Thượng Sĩ I", "Staff Sergeant I", "nco", 0, 3, 1],
  ["Thượng Sĩ II", "Staff Sergeant II", "nco", 0, 3, 2],
  ["Chuẩn Uý", "Warrant Officer", "warrant", 0, 0, 0],
  ["Thiếu Uý I", "Second Lieutenant I", "company", 1, 0, 1],
  ["Thiếu Uý II", "Second Lieutenant II", "company", 1, 0, 2],
  ["Trung Uý I", "First Lieutenant I", "company", 2, 0, 1],
  ["Trung Uý II", "First Lieutenant II", "company", 2, 0, 2],
  ["Thượng Uý I", "Senior Lieutenant I", "company", 3, 0, 1],
  ["Thượng Uý II", "Senior Lieutenant II", "company", 3, 0, 2],
  ["Đại Uý I", "Captain I", "company", 4, 0, 1],
  ["Đại Uý II", "Captain II", "company", 4, 0, 2],
  ["Thiếu Tá I", "Major I", "field", 1, 0, 1],
  ["Thiếu Tá II", "Major II", "field", 1, 0, 2],
  ["Trung Tá I", "Lieutenant Colonel I", "field", 2, 0, 1],
  ["Trung Tá II", "Lieutenant Colonel II", "field", 2, 0, 2],
  ["Thượng Tá I", "Senior Colonel I", "field", 3, 0, 1],
  ["Thượng Tá II", "Senior Colonel II", "field", 3, 0, 2],
  ["Đại Tá I", "Colonel I", "field", 4, 0, 1],
  ["Đại Tá II", "Colonel II", "field", 4, 0, 2],
  ["Đại Tá III", "Colonel III", "field", 4, 0, 3],
  ["Thiếu Tướng", "Major General", "general", 1, 0, 0],
  ["Trung Tướng", "Lieutenant General", "general", 2, 0, 0],
  ["Thượng Tướng", "Colonel General", "general", 3, 0, 0],
  ["Đại Tướng", "General", "general", 4, 0, 0],
];

/** XP cần cho quân hàm thứ i (0 là Binh Nhì): tăng dần, làm tròn trăm. Đại Tướng chừng 330 nghìn XP. */
function rankThreshold(i: number): number {
  if (i <= 0) return 0;
  return Math.round((800 * i + 260 * i ** 2.1) / 100) * 100;
}

export const RANKS: readonly RankDef[] = RANK_SEEDS.map(([name, en, group, stars, chevrons, grade], i) => ({
  rank: i + 1,
  name,
  en,
  group,
  stars,
  chevrons,
  grade,
  xp: rankThreshold(i),
}));

export const MAX_RANK = RANKS.length;

/** Quân hàm (1–30) ứng với tổng XP. */
export function rankOf(xp: number): number {
  const x = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let lo = 0;
  let hi = RANKS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (RANKS[mid]!.xp <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Thông tin quân hàm theo số thứ tự 1–30, null nếu không có (khách, máy). */
export function rankDef(rank: number): RankDef | null {
  return RANKS[Math.floor(rank) - 1] ?? null;
}

/** Tiến độ lên quân hàm kế: XP đã có trong cấp này, XP cần cho cả cấp (0 khi đã là Đại Tướng), tỷ lệ 0–1. */
export function rankProgress(xp: number): { rank: number; into: number; span: number; ratio: number; next: RankDef | null } {
  const rank = rankOf(xp);
  const cur = RANKS[rank - 1]!;
  const next = RANKS[rank] ?? null;
  const x = Math.max(0, xp);
  if (!next) return { rank, into: x - cur.xp, span: 0, ratio: 1, next };
  const span = next.xp - cur.xp;
  return { rank, into: x - cur.xp, span, ratio: Math.min(1, (x - cur.xp) / span), next };
}

// ---------------------------------------------------------------------------- thẻ tên, huy hiệu

/** Điều kiện mở khoá: có sẵn, đạt quân hàm, hay sở hữu đủ skin (từ gacha) ở độ hiếm nào đó trở lên. */
export type UnlockRule = { kind: "free" } | { kind: "rank"; rank: number } | { kind: "skins"; rarity: SkinRarity; count: number };

export type CardPattern = "stripes" | "chevrons" | "grid" | "rays" | "waves" | "camo" | "stars" | "circuit";

export interface CallingCardDef {
  id: string;
  name: string;
  unlock: UnlockRule;
  /** Nền chuyển màu, hoa văn phủ lên, màu nhấn. */
  from: string;
  to: string;
  pattern: CardPattern;
  accent: string;
}

export type EmblemShape = "anchor" | "star" | "crosshair" | "shield" | "wings" | "skull" | "lightning" | "crown" | "wave" | "dragon";

export interface EmblemDef {
  id: string;
  name: string;
  unlock: UnlockRule;
  shape: EmblemShape;
  color: string;
  /** Màu nền tròn sau hình. */
  back: string;
}

export const CALLING_CARDS: readonly CallingCardDef[] = [
  { id: "recruit", name: "Tân binh", unlock: { kind: "free" }, from: "#2b3a2a", to: "#4f6340", pattern: "stripes", accent: "#d8c27a" },
  { id: "tide", name: "Sóng triều", unlock: { kind: "free" }, from: "#0b2e4f", to: "#1a7a8c", pattern: "waves", accent: "#8fe9ff" },
  { id: "jungle", name: "Rừng rậm", unlock: { kind: "rank", rank: 5 }, from: "#1d2b17", to: "#3d5a2a", pattern: "camo", accent: "#a3c46b" },
  { id: "steel-rain", name: "Mưa thép", unlock: { kind: "rank", rank: 9 }, from: "#1c2026", to: "#4b5563", pattern: "chevrons", accent: "#e5e7eb" },
  { id: "officer", name: "Sĩ quan", unlock: { kind: "rank", rank: 14 }, from: "#3a1414", to: "#7f1d1d", pattern: "stars", accent: "#facc15" },
  { id: "command", name: "Bộ chỉ huy", unlock: { kind: "rank", rank: 20 }, from: "#111827", to: "#1e3a8a", pattern: "grid", accent: "#93c5fd" },
  { id: "marshal", name: "Thống soái", unlock: { kind: "rank", rank: 27 }, from: "#2a1d05", to: "#a16207", pattern: "rays", accent: "#fde68a" },
  { id: "collector", name: "Nhà sưu tầm", unlock: { kind: "skins", rarity: "common", count: 10 }, from: "#2e1065", to: "#6d28d9", pattern: "chevrons", accent: "#e9d5ff" },
  { id: "epic-hunter", name: "Thợ săn sử thi", unlock: { kind: "skins", rarity: "epic", count: 3 }, from: "#3b0764", to: "#a855f7", pattern: "rays", accent: "#f5d0fe" },
  { id: "golden-legend", name: "Huyền thoại vàng", unlock: { kind: "skins", rarity: "legendary", count: 1 }, from: "#3d2a00", to: "#f5b82e", pattern: "rays", accent: "#fff7d6" },
  { id: "neon-city", name: "Thành phố neon", unlock: { kind: "skins", rarity: "legendary", count: 3 }, from: "#0a0420", to: "#1b0b3a", pattern: "circuit", accent: "#ff3df2" },
];

export const EMBLEMS: readonly EmblemDef[] = [
  { id: "anchor", name: "Mỏ neo", unlock: { kind: "free" }, shape: "anchor", color: "#e8f1ff", back: "#1b3a5c" },
  { id: "star", name: "Sao vàng", unlock: { kind: "free" }, shape: "star", color: "#facc15", back: "#9b1c1c" },
  { id: "wave", name: "Ngọn sóng", unlock: { kind: "free" }, shape: "wave", color: "#7dd3fc", back: "#0c2a44" },
  { id: "crosshair", name: "Tâm ngắm", unlock: { kind: "rank", rank: 3 }, shape: "crosshair", color: "#f87171", back: "#1f2937" },
  { id: "shield", name: "Khiên thép", unlock: { kind: "rank", rank: 8 }, shape: "shield", color: "#cbd5e1", back: "#334155" },
  { id: "wings", name: "Cánh đại bàng", unlock: { kind: "rank", rank: 18 }, shape: "wings", color: "#fde68a", back: "#3f2d0a" },
  { id: "crown", name: "Vương miện", unlock: { kind: "rank", rank: 30 }, shape: "crown", color: "#ffd84d", back: "#4a1d0a" },
  { id: "skull", name: "Đầu lâu", unlock: { kind: "skins", rarity: "epic", count: 2 }, shape: "skull", color: "#f4f4f5", back: "#18181b" },
  { id: "lightning", name: "Tia chớp", unlock: { kind: "skins", rarity: "legendary", count: 1 }, shape: "lightning", color: "#22e4ff", back: "#0b1530" },
  { id: "dragon", name: "Long thần", unlock: { kind: "skins", rarity: "legendary", count: 2 }, shape: "dragon", color: "#ff5a3c", back: "#2a0a06" },
];

export const CALLING_CARD: ReadonlyMap<string, CallingCardDef> = new Map(CALLING_CARDS.map((c) => [c.id, c]));
export const EMBLEM: ReadonlyMap<string, EmblemDef> = new Map(EMBLEMS.map((e) => [e.id, e]));

/** Đã đạt điều kiện mở khoá chưa. `owned` là kho skin (id skin, có thì tính một, không cộng bản trùng). */
export function isUnlocked(rule: UnlockRule, rank: number, owned: readonly string[]): boolean {
  switch (rule.kind) {
    case "free":
      return true;
    case "rank":
      return rank >= rule.rank;
    case "skins": {
      const min = rarityRank(rule.rarity);
      let n = 0;
      for (const id of new Set(owned)) {
        const s = SKIN.get(id);
        if (s && rarityRank(s.rarity) >= min) n++;
      }
      return n >= rule.count;
    }
  }
}

/** Mô tả điều kiện mở khoá cho giao diện. */
export function unlockText(rule: UnlockRule): string {
  switch (rule.kind) {
    case "free":
      return "Có sẵn";
    case "rank":
      return `Đạt quân hàm ${rankDef(rule.rank)?.name ?? rule.rank}`;
    case "skins": {
      const label = rule.rarity === "common" ? "skin" : rule.rarity === "rare" ? "skin Hiếm trở lên" : rule.rarity === "epic" ? "skin Sử thi trở lên" : "skin Huyền thoại";
      return `Sở hữu ${rule.count} ${label} (Gacha)`;
    }
  }
}

/** Thẻ tên được lắp: có thật và đã mở khoá. Rỗng là thẻ mặc định. */
export function canUseCard(cardId: string, rank: number, owned: readonly string[]): boolean {
  if (!cardId) return true;
  const c = CALLING_CARD.get(cardId);
  return !!c && isUnlocked(c.unlock, rank, owned);
}

export function canUseEmblem(emblemId: string, rank: number, owned: readonly string[]): boolean {
  if (!emblemId) return true;
  const e = EMBLEM.get(emblemId);
  return !!e && isUnlocked(e.unlock, rank, owned);
}
