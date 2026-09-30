// Skin súng cho Battleground: danh mục, độ hiếm, luật quay gacha (có bảo hiểm) dùng chung cho server và client.
// Hàm quay là hàm thuần, nhận hàm ngẫu nhiên từ ngoài vào: server dùng crypto, test dùng PRNG có seed.

export type SkinRarity = "common" | "rare" | "epic" | "legendary";

/** Thứ tự từ thường tới hiếm nhất. */
export const SKIN_RARITIES: readonly SkinRarity[] = ["common", "rare", "epic", "legendary"];

export interface RarityInfo {
  name: string;
  /** Màu đại diện (khung thẻ, chữ, ánh sáng lúc lật thẻ). */
  color: string;
  /** Trọng số rơi (tổng các trọng số là 100, đọc thẳng ra phần trăm). */
  weight: number;
}

export const RARITY: Record<SkinRarity, RarityInfo> = {
  common: { name: "Thường", color: "#9aa0a6", weight: 60 },
  rare: { name: "Hiếm", color: "#3d8bfd", weight: 28 },
  epic: { name: "Sử thi", color: "#a855f7", weight: 9.5 },
  legendary: { name: "Huyền thoại", color: "#f5b82e", weight: 2.5 },
};

export function rarityRank(r: SkinRarity): number {
  return SKIN_RARITIES.indexOf(r);
}

/** Vẻ ngoài của skin, client dựa vào đây để dựng vật liệu (3D) hay ô màu xem trước (CSS). */
export type SkinFinish =
  | { kind: "solid"; color: string; metalness: number; roughness: number }
  | { kind: "camo"; palette: string[] }
  | { kind: "gradient"; from: string; to: string }
  | { kind: "pattern"; pattern: SkinPattern; colors: string[] }
  | { kind: "gold" }
  | { kind: "chrome" }
  /** Phát sáng, nhịp sáng tối theo thời gian (chỉ skin huyền thoại). */
  | { kind: "neon"; color: string; glow: number };

export type SkinPattern = "tiger" | "hex" | "digital" | "carbon" | "damascus";

export interface SkinDef {
  id: string;
  name: string;
  rarity: SkinRarity;
  /** Chỉ lắp được lên khẩu này; bỏ trống là khẩu nào cũng lắp được. */
  weapon?: string;
  finish: SkinFinish;
}

/** Các khẩu súng lắp được skin (trùng id với WEAPONS trong battleItems). */
export const SKIN_WEAPON_IDS: readonly string[] = ["p92", "deagle", "ump45", "vector", "m416", "akm", "scar", "m249", "s686", "sks", "kar98k", "awm"];

export const SKINS: readonly SkinDef[] = [
  // Thường: màu trơn, rằn ri đơn giản.
  { id: "desert-sand", name: "Cát sa mạc", rarity: "common", finish: { kind: "solid", color: "#c2a878", metalness: 0.15, roughness: 0.8 } },
  { id: "olive-drab", name: "Xanh ô liu", rarity: "common", finish: { kind: "solid", color: "#55603f", metalness: 0.15, roughness: 0.75 } },
  { id: "arctic-white", name: "Trắng Bắc Cực", rarity: "common", finish: { kind: "solid", color: "#e4e8ec", metalness: 0.1, roughness: 0.7 } },
  { id: "gunmetal", name: "Thép xám", rarity: "common", finish: { kind: "solid", color: "#4a4f57", metalness: 0.75, roughness: 0.35 } },
  { id: "navy-blue", name: "Xanh hải quân", rarity: "common", finish: { kind: "solid", color: "#23395b", metalness: 0.3, roughness: 0.55 } },
  { id: "rust-red", name: "Gỉ sét", rarity: "common", finish: { kind: "solid", color: "#8a3b24", metalness: 0.35, roughness: 0.85 } },
  { id: "woodland-camo", name: "Rằn ri rừng", rarity: "common", finish: { kind: "camo", palette: ["#3f4a2c", "#6b6a3a", "#2a2419", "#8a7d52"] } },
  { id: "urban-camo", name: "Rằn ri phố", rarity: "common", finish: { kind: "camo", palette: ["#5c5f63", "#8d9094", "#2e3033", "#b8babd"] } },
  { id: "p92-bronze", name: "P92 Đồng thau", rarity: "common", weapon: "p92", finish: { kind: "solid", color: "#9b7340", metalness: 0.8, roughness: 0.4 } },
  { id: "ump45-slate", name: "UMP45 Đá phiến", rarity: "common", weapon: "ump45", finish: { kind: "solid", color: "#3b4450", metalness: 0.2, roughness: 0.7 } },
  { id: "sks-birch", name: "SKS Gỗ bạch dương", rarity: "common", weapon: "sks", finish: { kind: "solid", color: "#c9ab7c", metalness: 0.05, roughness: 0.6 } },

  // Hiếm: hoa văn, chuyển màu.
  { id: "tiger-stripe", name: "Vằn hổ", rarity: "rare", finish: { kind: "pattern", pattern: "tiger", colors: ["#c9822b", "#1b1510"] } },
  { id: "digital-desert", name: "Số hoá sa mạc", rarity: "rare", finish: { kind: "pattern", pattern: "digital", colors: ["#c8b08a", "#9c8360", "#6e5a3f", "#e0cfae"] } },
  { id: "hex-teal", name: "Tổ ong ngọc bích", rarity: "rare", finish: { kind: "pattern", pattern: "hex", colors: ["#0f3d3e", "#2bb3a3"] } },
  { id: "sunset-fade", name: "Hoàng hôn", rarity: "rare", finish: { kind: "gradient", from: "#ff7a45", to: "#6b2d8f" } },
  { id: "tide-fade", name: "Thuỷ triều", rarity: "rare", finish: { kind: "gradient", from: "#0b3d6b", to: "#4fd1c5" } },
  { id: "m416-carbon", name: "M416 Sợi carbon", rarity: "rare", weapon: "m416", finish: { kind: "pattern", pattern: "carbon", colors: ["#1a1b1e", "#3a3d42"] } },
  { id: "akm-siberia", name: "AKM Rằn ri Siberia", rarity: "rare", weapon: "akm", finish: { kind: "camo", palette: ["#dfe4e8", "#9aa3ab", "#5b646c", "#c4cbd1"] } },
  { id: "vector-circuit", name: "Vector Mạch điện", rarity: "rare", weapon: "vector", finish: { kind: "pattern", pattern: "digital", colors: ["#0c1a12", "#1f6f43", "#35c27a", "#0f2f1f"] } },
  { id: "s686-engraved", name: "S686 Chạm bạc", rarity: "rare", weapon: "s686", finish: { kind: "pattern", pattern: "damascus", colors: ["#6e7176", "#c8ccd1"] } },

  // Sử thi: kim loại đặc biệt, hoa văn đậm.
  { id: "damascus", name: "Thép Damascus", rarity: "epic", finish: { kind: "pattern", pattern: "damascus", colors: ["#2d2f33", "#9ea4ab", "#5d6268"] } },
  { id: "chrome", name: "Gương chrome", rarity: "epic", finish: { kind: "chrome" } },
  { id: "crimson-carbon", name: "Carbon đỏ thẫm", rarity: "epic", finish: { kind: "pattern", pattern: "carbon", colors: ["#1a0d0f", "#8e1b24"] } },
  { id: "scar-toxic", name: "SCAR Độc tố", rarity: "epic", weapon: "scar", finish: { kind: "gradient", from: "#101510", to: "#8cff3f" } },
  { id: "kar98k-royal", name: "Kar98k Hoàng gia", rarity: "epic", weapon: "kar98k", finish: { kind: "gradient", from: "#2a0f3d", to: "#c9a14a" } },
  { id: "m249-violet-hex", name: "M249 Tổ ong tím", rarity: "epic", weapon: "m249", finish: { kind: "pattern", pattern: "hex", colors: ["#1c0f2e", "#9b5cff"] } },
  { id: "deagle-gold-tiger", name: "Deagle Hổ vàng", rarity: "epic", weapon: "deagle", finish: { kind: "pattern", pattern: "tiger", colors: ["#e3b341", "#221607"] } },

  // Huyền thoại: vàng ròng, neon phát sáng.
  { id: "gold", name: "Hoàng kim", rarity: "legendary", finish: { kind: "gold" } },
  { id: "neon-tsunami", name: "Neon Sóng Thần", rarity: "legendary", finish: { kind: "neon", color: "#22e4ff", glow: 1.6 } },
  { id: "awm-dragon", name: "AWM Long Thần", rarity: "legendary", weapon: "awm", finish: { kind: "neon", color: "#ff3b3b", glow: 1.8 } },
  { id: "akm-inferno", name: "AKM Hoả Ngục", rarity: "legendary", weapon: "akm", finish: { kind: "neon", color: "#ff8a1f", glow: 1.7 } },
  { id: "m416-glacier", name: "M416 Băng Hà", rarity: "legendary", weapon: "m416", finish: { kind: "neon", color: "#9fd8ff", glow: 1.4 } },
];

export const SKIN: ReadonlyMap<string, SkinDef> = new Map(SKINS.map((s) => [s.id, s]));

/** Skin này lắp được lên khẩu này không. */
export function skinFitsWeapon(skinId: string, weaponId: string): boolean {
  const s = SKIN.get(skinId);
  if (!s || !SKIN_WEAPON_IDS.includes(weaponId)) return false;
  return !s.weapon || s.weapon === weaponId;
}

// ---------------------------------------------------------------------------- gacha

export const GACHA = {
  /** Giá một lượt quay. */
  cost1: 100,
  /** Giá mười lượt quay một lần (rẻ hơn một lượt). */
  cost10: 900,
  /** Trong mỗi chừng này lượt chắc chắn có ít nhất một skin sử thi trở lên. */
  epicPity: 10,
  /** Trong mỗi chừng này lượt chắc chắn có một skin huyền thoại. */
  legendaryPity: 60,
} as const;

export function gachaCost(count: 1 | 10): number {
  return count === 10 ? GACHA.cost10 : GACHA.cost1;
}

/** Bộ đếm bảo hiểm của một người: đã quay bao nhiêu lượt liền chưa ra sử thi+ / huyền thoại. */
export interface PityState {
  sinceEpic: number;
  sinceLegendary: number;
}

export interface RollResult {
  skinId: string;
  rarity: SkinRarity;
}

const BY_RARITY: Record<SkinRarity, SkinDef[]> = { common: [], rare: [], epic: [], legendary: [] };
for (const s of SKINS) BY_RARITY[s.rarity].push(s);

function pickWeighted(rarities: readonly SkinRarity[], r: number): SkinRarity {
  const total = rarities.reduce((sum, k) => sum + RARITY[k].weight, 0);
  let x = r * total;
  for (const k of rarities) {
    x -= RARITY[k].weight;
    if (x < 0) return k;
  }
  return rarities[rarities.length - 1]!;
}

/** Một lượt quay. Trả về kết quả và bộ đếm bảo hiểm mới (không sửa bộ đếm cũ). */
export function rollOnce(pity: PityState, rng: () => number): { result: RollResult; pity: PityState } {
  let pool: readonly SkinRarity[] = SKIN_RARITIES;
  // Lượt này là lượt thứ 60 liền chưa ra huyền thoại: chắc chắn huyền thoại.
  if (pity.sinceLegendary + 1 >= GACHA.legendaryPity) pool = ["legendary"];
  // Lượt thứ 10 liền chưa ra sử thi+: chỉ còn sử thi hoặc huyền thoại (giữ đúng tỷ lệ giữa hai loại).
  else if (pity.sinceEpic + 1 >= GACHA.epicPity) pool = ["epic", "legendary"];
  const rarity = pickWeighted(pool, rng());
  const list = BY_RARITY[rarity];
  const skin = list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
  const rank = rarityRank(rarity);
  return {
    result: { skinId: skin.id, rarity },
    pity: {
      sinceEpic: rank >= rarityRank("epic") ? 0 : pity.sinceEpic + 1,
      sinceLegendary: rarity === "legendary" ? 0 : pity.sinceLegendary + 1,
    },
  };
}

/** Quay nhiều lượt liền (1 hoặc 10), bộ đếm bảo hiểm chuyền qua từng lượt. */
export function rollSkins(count: number, pity: PityState, rng: () => number): { results: RollResult[]; pity: PityState } {
  const results: RollResult[] = [];
  let state: PityState = { sinceEpic: Math.max(0, pity.sinceEpic | 0), sinceLegendary: Math.max(0, pity.sinceLegendary | 0) };
  for (let i = 0; i < count; i++) {
    const out = rollOnce(state, rng);
    results.push(out.result);
    state = out.pity;
  }
  return { results, pity: state };
}
