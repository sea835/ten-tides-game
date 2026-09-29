// Danh mục đồ của chế độ Battleground: súng, đạn, lựu đạn, bom khói, mìn, giáp, mũ, đồ hồi máu, trang phục.
// Dùng chung cho server (sát thương, tốc độ bắn, giá) và client (mô hình, âm thanh, cửa hàng).

export type AmmoId = "9mm" | "45acp" | "556" | "762" | "12g" | "300";

export const AMMO: Record<AmmoId, { name: string; price: number; pack: number }> = {
  "9mm": { name: "Đạn 9mm", price: 60, pack: 45 },
  "45acp": { name: "Đạn .45 ACP", price: 80, pack: 50 },
  "556": { name: "Đạn 5.56mm", price: 110, pack: 60 },
  "762": { name: "Đạn 7.62mm", price: 120, pack: 60 },
  "12g": { name: "Đạn 12 Gauge", price: 80, pack: 15 },
  "300": { name: "Đạn .300 Magnum", price: 200, pack: 10 },
};

/** Nhóm súng: quyết định ô đeo, dáng cầm, tiếng nổ. */
export type WeaponClass = "pistol" | "smg" | "ar" | "lmg" | "dmr" | "sniper" | "shotgun";

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  ammo: AmmoId;
  /** Băng đạn. */
  mag: number;
  /** Phát mỗi phút. */
  rpm: number;
  /** Sát thương mỗi viên (thân). */
  damage: number;
  /** Số viên mỗi phát (shotgun bắn chùm). */
  pellets: number;
  /** Tầm bắn hiệu quả (m): quá tầm này sát thương giảm dần còn một nửa ở gấp đôi tầm. */
  range: number;
  /** Độ toả (radian) khi bắn từ hông / khi ngắm. */
  hipSpread: number;
  adsSpread: number;
  /** Giật nòng dọc mỗi phát (radian) và giật ngang ngẫu nhiên. */
  recoil: number;
  recoilSide: number;
  auto: boolean;
  /** Thời gian thay đạn (giây). */
  reload: number;
  /** Phóng đại khi ngắm bằng thước ngắm sắt (lắp ống ngắm thì theo ống, xem SIGHTS). */
  zoom: number;
  /** Sơ tốc đầu nòng (m/s): đạn bay càng chậm thì càng rơi nhiều ở xa (xem bulletAt). */
  velocity: number;
  /** Nhân tốc độ chạy khi cầm súng này. */
  speed: number;
  /** Giá ở cửa hàng (0 là chỉ nhặt được ở kho vũ khí). */
  price: number;
  /** Nhân sát thương vào đầu. */
  headshot: number;
  /** Chỉ có trong kho vũ khí (hàng hiếm). */
  rare?: boolean;
}

/** Sơ tốc đầu nòng (m/s), gần với súng thật. */
const VELOCITY: Record<string, number> = { p92: 360, deagle: 420, ump45: 300, vector: 350, m416: 880, akm: 715, scar: 870, m249: 915, s686: 380, sks: 800, kar98k: 760, awm: 945 };

const w = (d: Omit<WeaponDef, "pellets" | "headshot" | "speed" | "velocity"> & Partial<Pick<WeaponDef, "pellets" | "headshot" | "speed">>): WeaponDef => ({
  pellets: 1,
  headshot: 2.2,
  speed: 1,
  velocity: VELOCITY[d.id] ?? 800,
  ...d,
});

export const WEAPONS: readonly WeaponDef[] = [
  w({ id: "p92", name: "P92", class: "pistol", ammo: "9mm", mag: 15, rpm: 450, damage: 32, range: 45, hipSpread: 0.018, adsSpread: 0.008, recoil: 0.018, recoilSide: 0.006, auto: false, reload: 1.6, zoom: 1.2, price: 250, speed: 1.05 }),
  w({ id: "deagle", name: "Deagle", class: "pistol", ammo: "45acp", mag: 7, rpm: 220, damage: 62, range: 55, hipSpread: 0.025, adsSpread: 0.01, recoil: 0.05, recoilSide: 0.012, auto: false, reload: 1.9, zoom: 1.25, price: 700, speed: 1.05 }),
  w({ id: "ump45", name: "UMP45", class: "smg", ammo: "45acp", mag: 25, rpm: 650, damage: 35, range: 55, hipSpread: 0.022, adsSpread: 0.01, recoil: 0.011, recoilSide: 0.006, auto: true, reload: 2.4, zoom: 1.3, price: 1200, speed: 1.02 }),
  w({ id: "vector", name: "Vector", class: "smg", ammo: "9mm", mag: 25, rpm: 1100, damage: 29, range: 45, hipSpread: 0.024, adsSpread: 0.011, recoil: 0.009, recoilSide: 0.007, auto: true, reload: 2.1, zoom: 1.3, price: 1500, speed: 1.02 }),
  w({ id: "m416", name: "M416", class: "ar", ammo: "556", mag: 30, rpm: 700, damage: 40, range: 120, hipSpread: 0.028, adsSpread: 0.006, recoil: 0.012, recoilSide: 0.006, auto: true, reload: 2.3, zoom: 1.6, price: 2700, speed: 0.95 }),
  w({ id: "akm", name: "AKM", class: "ar", ammo: "762", mag: 30, rpm: 600, damage: 47, range: 110, hipSpread: 0.032, adsSpread: 0.008, recoil: 0.018, recoilSide: 0.01, auto: true, reload: 2.5, zoom: 1.6, price: 2500, speed: 0.95 }),
  w({ id: "scar", name: "SCAR-L", class: "ar", ammo: "556", mag: 30, rpm: 625, damage: 41, range: 120, hipSpread: 0.026, adsSpread: 0.006, recoil: 0.011, recoilSide: 0.005, auto: true, reload: 2.4, zoom: 1.6, price: 2800, speed: 0.95 }),
  w({ id: "m249", name: "M249", class: "lmg", ammo: "556", mag: 100, rpm: 750, damage: 40, range: 110, hipSpread: 0.04, adsSpread: 0.012, recoil: 0.01, recoilSide: 0.008, auto: true, reload: 5.5, zoom: 1.6, price: 0, speed: 0.85, rare: true }),
  w({ id: "s686", name: "S686", class: "shotgun", ammo: "12g", mag: 2, rpm: 200, damage: 24, pellets: 9, range: 22, hipSpread: 0.075, adsSpread: 0.06, recoil: 0.06, recoilSide: 0.02, auto: false, reload: 2.2, zoom: 1.2, price: 1100, headshot: 1.5 }),
  w({ id: "sks", name: "SKS", class: "dmr", ammo: "762", mag: 10, rpm: 330, damage: 55, range: 220, hipSpread: 0.035, adsSpread: 0.003, recoil: 0.03, recoilSide: 0.008, auto: false, reload: 2.9, zoom: 1.5, price: 3200, speed: 0.95, headshot: 2.3 }),
  w({ id: "kar98k", name: "Kar98k", class: "sniper", ammo: "762", mag: 5, rpm: 48, damage: 80, range: 400, hipSpread: 0.05, adsSpread: 0.0008, recoil: 0.06, recoilSide: 0.01, auto: false, reload: 3.8, zoom: 1.5, price: 3800, speed: 0.95, headshot: 2.5 }),
  w({ id: "awm", name: "AWM", class: "sniper", ammo: "300", mag: 5, rpm: 40, damage: 105, range: 500, hipSpread: 0.05, adsSpread: 0.0005, recoil: 0.07, recoilSide: 0.01, auto: false, reload: 4.2, zoom: 1.5, price: 0, speed: 0.93, headshot: 2.5, rare: true }),
];

export const WEAPON: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------- đường đạn

/** Gia tốc trọng trường kéo đạn xuống (m/s²). */
export const BULLET_GRAVITY = 9.81;

/**
 * Điểm trên đường đạn sau khi đi được `s` mét theo hướng bắn `d` (vector đơn vị) từ `o`: bay thẳng theo hướng bắn
 * và rơi dần xuống do trọng lực (rơi g·t²/2 với t = s / sơ tốc), càng xa rơi càng nhanh. Server và máy người bắn tính
 * cùng một hàm nên kiểm tra trúng đích khớp nhau.
 */
export function bulletAt(o: readonly [number, number, number], d: readonly [number, number, number], velocity: number, s: number): [number, number, number] {
  const t = s / velocity;
  return [o[0] + d[0] * s, o[1] + d[1] * s - 0.5 * BULLET_GRAVITY * t * t, o[2] + d[2] * s];
}

/** Đạn rơi bao nhiêu mét so với đường thẳng khi đã bay `s` mét. */
export function bulletDrop(velocity: number, s: number): number {
  const t = s / velocity;
  return 0.5 * BULLET_GRAVITY * t * t;
}

/** Chia đường đạn thành các đoạn thẳng ngắn (để dò tường, dò người): mốc `s` từ 0 tới `max`. */
export function bulletSteps(velocity: number, max: number): number[] {
  // Đạn nhanh thì đoạn dài hơn (đường cong thoải); sai lệch giữa dây cung và cung dưới 2 cm.
  const seg = Math.max(12, Math.min(60, velocity / 18));
  const out = [0];
  for (let s = seg; s < max; s += seg) out.push(s);
  out.push(max);
  return out;
}

// ---------------------------------------------------------------------------- ống ngắm

export type SightId = "reddot" | "holo" | "x2" | "x4" | "x8";
export interface SightDef {
  id: SightId;
  name: string;
  /** Phóng đại khi ngắm. */
  zoom: number;
  /** Ống kính (nhìn qua ống, khung đen quanh) hay kính phản xạ (chấm đỏ nổi trên kính, vẫn thấy xung quanh). */
  scope: boolean;
  /** Giá ở cửa hàng; 0 là chỉ nhặt được. */
  price: number;
  /** Kiểu tâm: chấm, vòng holo, chữ thập có vạch, chữ V (ACOG), vạch mil. */
  reticle: "dot" | "holo" | "cross" | "chevron" | "mil";
}
export const SIGHTS: Record<SightId, SightDef> = {
  reddot: { id: "reddot", name: "Red Dot", zoom: 1.35, scope: false, price: 150, reticle: "dot" },
  holo: { id: "holo", name: "Holo", zoom: 1.35, scope: false, price: 150, reticle: "holo" },
  x2: { id: "x2", name: "Ống 2x", zoom: 2, scope: true, price: 300, reticle: "cross" },
  x4: { id: "x4", name: "Ống 4x (ACOG)", zoom: 4, scope: true, price: 700, reticle: "chevron" },
  x8: { id: "x8", name: "Ống 8x", zoom: 8, scope: true, price: 0, reticle: "mil" },
};
export const SIGHT_IDS = Object.keys(SIGHTS) as SightId[];

/** Ống ngắm nào lắp được lên súng nào (súng lục chỉ kính phản xạ, shotgun tới 2x, tiểu liên tới 4x). */
export function sightFits(sight: string, def: WeaponDef): boolean {
  if (!(sight in SIGHTS)) return false;
  const max = def.class === "pistol" ? 1.5 : def.class === "shotgun" ? 2 : def.class === "smg" ? 4 : 8;
  return SIGHTS[sight as SightId].zoom <= max;
}

/** Phóng đại khi ngắm: theo ống ngắm đang lắp, không có thì theo thước ngắm sắt của súng. */
export function zoomOf(def: WeaponDef, sight: string): number {
  return sight in SIGHTS ? SIGHTS[sight as SightId].zoom : def.zoom;
}

/** Ô đeo súng: hai súng chính và một súng lục. */
export type WeaponSlot = "primary1" | "primary2" | "pistol";
export function slotsFor(def: WeaponDef): WeaponSlot[] {
  return def.class === "pistol" ? ["pistol"] : ["primary1", "primary2"];
}

export type ThrowableId = "frag" | "smoke" | "mine";
export const THROWABLES: Record<ThrowableId, { name: string; price: number; max: number }> = {
  frag: { name: "Lựu đạn", price: 300, max: 4 },
  smoke: { name: "Bom khói", price: 200, max: 4 },
  mine: { name: "Mìn", price: 450, max: 3 },
};

/** Giáp và mũ: cấp 1–3. `absorb` là phần sát thương chặn được, `durability` là số sát thương chịu được trước khi vỡ. */
export const ARMOR = [
  { level: 1, name: "Áo giáp cấp 1", absorb: 0.3, durability: 200, price: 400 },
  { level: 2, name: "Áo giáp cấp 2", absorb: 0.4, durability: 220, price: 900 },
  { level: 3, name: "Áo giáp cấp 3", absorb: 0.55, durability: 250, price: 0 },
] as const;
export const HELMETS = [
  { level: 1, name: "Mũ cấp 1", absorb: 0.3, durability: 80, price: 300 },
  { level: 2, name: "Mũ cấp 2", absorb: 0.4, durability: 150, price: 700 },
  { level: 3, name: "Mũ cấp 3", absorb: 0.55, durability: 230, price: 0 },
] as const;

export type HealId = "bandage" | "medkit";
export const HEALS: Record<HealId, { name: string; price: number; amount: number; cap: number; seconds: number; max: number }> = {
  bandage: { name: "Băng gạc", price: 100, amount: 15, cap: 75, seconds: 2.5, max: 10 },
  medkit: { name: "Hộp cứu thương", price: 600, amount: 100, cap: 100, seconds: 6, max: 3 },
};

/** Trang phục ngụy trang (miễn phí, chọn trong cửa hàng). */
export const OUTFITS = [
  { id: "woodland", name: "Rừng rậm" },
  { id: "desert", name: "Sa mạc" },
  { id: "urban", name: "Thành phố" },
  { id: "digital", name: "Kỹ thuật số" },
  { id: "snow", name: "Tuyết" },
  { id: "ghillie", name: "Ghillie (nấp cỏ)" },
] as const;
export type OutfitId = (typeof OUTFITS)[number]["id"];

/** Mọi món có thể nằm dưới đất trong Battleground: id súng, "ammo:<id>", "armor:<cấp>", "helmet:<cấp>", ném, hồi máu. */
export type BattleLootId = string;

export function lootLabel(id: BattleLootId): string {
  const weapon = WEAPON.get(id);
  if (weapon) return weapon.name;
  const [kind, arg] = id.split(":");
  if (kind === "ammo") return AMMO[arg as AmmoId]?.name ?? id;
  if (kind === "armor") return ARMOR[Number(arg) - 1]?.name ?? id;
  if (kind === "helmet") return HELMETS[Number(arg) - 1]?.name ?? id;
  if (kind === "money") return `${arg}$`;
  if (kind === "sight") return SIGHTS[arg as SightId]?.name ?? id;
  if (id in THROWABLES) return THROWABLES[id as ThrowableId].name;
  if (id in HEALS) return HEALS[id as HealId].name;
  return id;
}

/** Tiền lúc xuất phát, tiền thưởng mỗi mạng hạ gục. */
export const START_MONEY = 4000;
export const KILL_REWARD = 800;
export const MAX_HP = 100;

/** Sát thương giảm theo khoảng cách: đủ trong tầm, giảm dần còn một nửa ở gấp đôi tầm. */
export function falloff(def: WeaponDef, distance: number): number {
  if (distance <= def.range) return 1;
  return Math.max(0.5, 1 - ((distance - def.range) / def.range) * 0.5);
}

/** Lựu đạn: bán kính sát thương, sát thương tối đa ở tâm; mìn mạnh hơn nhưng gần hơn. */
export const FRAG = { fuse: 3.5, radius: 8, damage: 120 };
export const MINE = { trigger: 1.2, arm: 2, radius: 5, damage: 150 };
export const SMOKE = { fuse: 2, seconds: 20, radius: 7 };
