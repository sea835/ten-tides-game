// Danh mục đồ của chế độ Battleground: súng, đạn, lựu đạn, bom khói, mìn, giáp, mũ, đồ hồi máu, trang phục.
// Dùng chung cho server (sát thương, tốc độ bắn, giá) và client (mô hình, âm thanh, cửa hàng).

export type AmmoId = "9mm" | "45acp" | "556" | "762" | "12g" | "300" | "rocket";

export const AMMO: Record<AmmoId, { name: string; price: number; pack: number }> = {
  "9mm": { name: "Đạn 9mm", price: 60, pack: 45 },
  "45acp": { name: "Đạn .45 ACP", price: 80, pack: 50 },
  "556": { name: "Đạn 5.56mm", price: 110, pack: 60 },
  "762": { name: "Đạn 7.62mm", price: 120, pack: 60 },
  "12g": { name: "Đạn 12 Gauge", price: 80, pack: 15 },
  "300": { name: "Đạn .300 Magnum", price: 200, pack: 10 },
  rocket: { name: "Đạn RPG", price: 350, pack: 2 },
};

/** Nhóm súng: quyết định ô đeo, dáng cầm, tiếng nổ. */
export type WeaponClass = "pistol" | "smg" | "ar" | "lmg" | "dmr" | "sniper" | "shotgun" | "launcher";

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
  /**
   * Súng phóng đạn nổ (chống tăng): đạn không dò trúng người như đạn thường, server dò đường bay một lần rồi nổ ở
   * chỗ chạm (bán kính, sát thương nổ vào người ở tâm, sát thương thêm vào xe tăng trúng thẳng).
   */
  explosive?: { radius: number; damage: number; armor: number };
}

/** Sơ tốc đầu nòng (m/s), gần với súng thật. */
const VELOCITY: Record<string, number> = { rpg7: 150, p92: 360, deagle: 420, ump45: 300, vector: 350, m416: 880, akm: 715, scar: 870, m249: 915, s686: 380, sks: 800, kar98k: 760, awm: 945 };

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
  // RPG-7: một quả mỗi lần nạp, bay chậm, rơi nhiều ở xa; nổ phá xe tăng, người đứng gần cũng chết.
  w({ id: "rpg7", name: "RPG-7", class: "launcher", ammo: "rocket", mag: 1, rpm: 40, damage: 0, range: 160, hipSpread: 0.04, adsSpread: 0.006, recoil: 0.05, recoilSide: 0.01, auto: false, reload: 3.4, zoom: 1.4, price: 2200, speed: 0.88, headshot: 1, explosive: { radius: 4.5, damage: 110, armor: 380 } }),
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

/**
 * Thân người, dùng CHUNG cho client và server.
 *
 * Trước đây mỗi bên có một mô hình riêng và chúng lệch nhau ~18 cm ở chiều cao đứng: client
 * dùng cầu đầu bán kính 0,15 tâm ở 1,62 m (biên 1,47–1,77) còn server dùng dải `y > y + h − 0,55`
 * với `h = 1,8` (biên 1,25–1,80). Phát bắn vào khoảng 1,5 m thì client gọi là thân, server gọi là
 * đầu — và server thắng trong im lặng (client không được báo là phát bắn bị từ chối). Nay cả hai
 * bên cùng gọi hàm này nên không thể lệch nữa.
 */
export const HITBOX = {
  /** Bán kính cầu đầu (m). */
  headR: 0.15,
  headY: { stand: 1.62, crouch: 1.12 },
  /** Bán kính trụ thân, và đỉnh trụ. */
  bodyR: 0.3,
  bodyTop: { stand: 1.46, crouch: 0.98 },
  /** Lề mà server chấp nhận cho điểm báo trúng (hộp bao, để tránh từ chối hợp lệ khi lệch mô hình). */
  slackXZ: 1.6,
  slackDown: 0.5,
  slackUp: 0.5,
  /** Lề cho phép điểm trúng vượt qua chỗ tường đã găm (m). */
  wallSlack: 0.6,
} as const;

/** Chiều cao thân người (m) khi đứng / ngồi xổm; dùng cho hộp bao phía server. */
export function hitboxHeight(crouch: boolean): number {
  return crouch ? 1.12 + HITBOX.headR : 1.62 + HITBOX.headR;
}

/**
 * Phân loại điểm trúng (toạ độ đã tính trên đường đạn) theo mô hình chung.
 * Ngưỡng là đáy cầu đầu (`headY − headR`), đúng bằng cái ranh giới dưới của cầu mà client dùng
 * để dò — nên client khai "head" thì server xác nhận, và ngược lại server không tự nâng lên đầu
 * khi client nói thân. `claim` vẫn được kiểm lại thay vì tin thẳng.
 */
export function hitPart(claim: "head" | "body", py: number, targetY: number, crouch: boolean): "head" | "body" {
  if (claim !== "head") return "body";
  const headBottom = targetY + (crouch ? HITBOX.headY.crouch : HITBOX.headY.stand) - HITBOX.headR;
  return py >= headBottom ? "head" : "body";
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
  x2: { id: "x2", name: "Ống 2x", zoom: 2, scope: true, price: 300, reticle: "chevron" },
  x4: { id: "x4", name: "Ống 4x", zoom: 4, scope: true, price: 700, reticle: "cross" },
  x8: { id: "x8", name: "Ống 8x", zoom: 8, scope: true, price: 0, reticle: "mil" },
};
export const SIGHT_IDS = Object.keys(SIGHTS) as SightId[];

/** Ống ngắm nào lắp được lên súng nào (súng lục chỉ kính phản xạ, shotgun tới 2x, tiểu liên tới 4x). */
export function sightFits(sight: string, def: WeaponDef): boolean {
  if (!(sight in SIGHTS)) return false;
  if (def.class === "launcher") return false;
  const max = def.class === "pistol" ? 1.5 : def.class === "shotgun" ? 2 : def.class === "smg" ? 4 : 8;
  return SIGHTS[sight as SightId].zoom <= max;
}

// ---------------------------------------------------------------------------- phụ kiện khác (như PUBG)

export type AttachmentSlot = "muzzle" | "grip" | "mag" | "stock";
export type AttachmentId = "comp" | "suppressor" | "flashhider" | "choke" | "vgrip" | "agrip" | "halfgrip" | "extmag" | "quickmag" | "extquick" | "tacstock" | "cheekpad";

export interface AttachmentDef {
  id: AttachmentId;
  name: string;
  slot: AttachmentSlot;
  /** Giá ở cửa hàng; 0 là chỉ nhặt được. */
  price: number;
  /** Nhân giật dọc, giật ngang (1 là không đổi), độ toả (shotgun: độ chụm). */
  recoilV?: number;
  recoilH?: number;
  spread?: number;
  /** Băng đạn to hơn (phần trăm, làm tròn) và thay đạn nhanh hơn (nhân thời gian). */
  magBonus?: number;
  reload?: number;
  /** Giảm thanh: tiếng súng nhỏ, nghe gần mới thấy; không loé lửa đầu nòng. */
  suppressed?: boolean;
  /** Che lửa đầu nòng. */
  flashless?: boolean;
  /** Mô tả ngắn cho cửa hàng. */
  desc: string;
}

export const ATTACHMENTS: Record<AttachmentId, AttachmentDef> = {
  comp: { id: "comp", name: "Bù giật (Compensator)", slot: "muzzle", price: 500, recoilV: 0.75, recoilH: 0.8, desc: "giảm 25% giật dọc, 20% giật ngang" },
  suppressor: { id: "suppressor", name: "Giảm thanh", slot: "muzzle", price: 700, recoilV: 0.95, suppressed: true, flashless: true, desc: "tiếng súng nhỏ, không loé lửa, máy nghe gần mới thấy" },
  flashhider: { id: "flashhider", name: "Che lửa", slot: "muzzle", price: 300, recoilV: 0.9, recoilH: 0.9, flashless: true, desc: "không loé lửa, giảm 10% giật" },
  choke: { id: "choke", name: "Choke (shotgun)", slot: "muzzle", price: 300, spread: 0.72, desc: "đạn chùm chụm hơn 28%" },
  vgrip: { id: "vgrip", name: "Tay cầm dọc", slot: "grip", price: 450, recoilV: 0.8, desc: "giảm 20% giật dọc" },
  agrip: { id: "agrip", name: "Tay cầm nghiêng", slot: "grip", price: 450, recoilH: 0.75, spread: 0.9, desc: "giảm 25% giật ngang, chụm hơn khi bắn hông" },
  halfgrip: { id: "halfgrip", name: "Tay cầm nửa", slot: "grip", price: 400, recoilV: 0.9, recoilH: 0.88, desc: "giảm cân bằng giật dọc và ngang" },
  extmag: { id: "extmag", name: "Băng đạn mở rộng", slot: "mag", price: 500, magBonus: 0.35, desc: "thêm khoảng 35% đạn mỗi băng" },
  quickmag: { id: "quickmag", name: "Băng đạn thay nhanh", slot: "mag", price: 400, reload: 0.7, desc: "thay đạn nhanh hơn 30%" },
  extquick: { id: "extquick", name: "Băng mở rộng thay nhanh", slot: "mag", price: 0, magBonus: 0.35, reload: 0.7, desc: "vừa nhiều đạn vừa thay nhanh (hàng hiếm)" },
  tacstock: { id: "tacstock", name: "Báng chiến thuật", slot: "stock", price: 400, recoilV: 0.9, recoilH: 0.9, desc: "giảm 10% giật, ngắm vững hơn" },
  cheekpad: { id: "cheekpad", name: "Đệm má", slot: "stock", price: 400, recoilV: 0.85, desc: "súng bắn tỉa: giảm 15% giật, ngắm vững" },
};
export const ATTACHMENT_IDS = Object.keys(ATTACHMENTS) as AttachmentId[];

/** Phụ kiện nào lắp được lên súng nào (giống PUBG: súng lục chỉ giảm thanh + băng; shotgun chỉ choke; M249 chỉ báng). */
export function attachmentFits(att: string, def: WeaponDef): boolean {
  const a = ATTACHMENTS[att as AttachmentId];
  if (!a) return false;
  const c = def.class;
  // Súng phóng rocket không lắp phụ kiện.
  if (c === "launcher") return false;
  switch (a.slot) {
    case "muzzle":
      if (a.id === "choke") return c === "shotgun";
      if (c === "shotgun" || c === "lmg") return false;
      if (c === "pistol") return a.id === "suppressor";
      return true;
    case "grip":
      return c === "ar" || c === "smg" || c === "dmr";
    case "mag":
      if (c === "shotgun" || def.id === "kar98k") return false;
      return c !== "lmg";
    case "stock":
      if (a.id === "cheekpad") return c === "sniper" || c === "dmr";
      return c === "ar" || c === "smg" || c === "lmg";
  }
}

/** Danh sách phụ kiện lắp trên một khẩu (chuỗi "comp,vgrip" trong KitState). */
export function parseAttachments(list: string): AttachmentDef[] {
  if (!list) return [];
  return list
    .split(",")
    .map((id) => ATTACHMENTS[id as AttachmentId])
    .filter((a): a is AttachmentDef => !!a);
}

/** Chỉ số thật của khẩu súng khi lắp các phụ kiện (băng, thời gian thay đạn, hệ số giật, toả, giảm thanh). */
export function withAttachments(def: WeaponDef, list: string) {
  const atts = parseAttachments(list).filter((a) => attachmentFits(a.id, def));
  let mag = def.mag;
  let reload = def.reload;
  let recoilV = 1;
  let recoilH = 1;
  let spread = 1;
  let suppressed = false;
  let flashless = false;
  for (const a of atts) {
    if (a.magBonus) mag = Math.round(def.mag * (1 + a.magBonus));
    if (a.reload) reload *= a.reload;
    recoilV *= a.recoilV ?? 1;
    recoilH *= a.recoilH ?? 1;
    spread *= a.spread ?? 1;
    suppressed ||= !!a.suppressed;
    flashless ||= !!a.flashless;
  }
  return { mag, reload, recoilV, recoilH, spread, suppressed, flashless, atts };
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

export type ThrowableId = "frag" | "smoke" | "flash" | "mine";
export const THROWABLES: Record<ThrowableId, { name: string; price: number; max: number }> = {
  frag: { name: "Lựu đạn", price: 300, max: 4 },
  smoke: { name: "Bom khói", price: 200, max: 4 },
  flash: { name: "Bom choáng", price: 250, max: 3 },
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
  if (kind === "att") return ATTACHMENTS[arg as AttachmentId]?.name ?? id;
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
/**
 * Khối khói che tầm nhìn: quả cầu bán kính `radius` m, tâm cao hơn chỗ bom khói `lift` m (nửa dưới chìm trong đất nên
 * nhìn như vòm bán cầu). Khớp với phép thử tầm nhìn của bot trên server (bots.ts `visible`); client vẽ khối khói đặc
 * đúng cỡ này để người chơi cũng không nhìn xuyên qua được.
 */
export const SMOKE_SIGHT = { radius: 6, lift: 1.5 };
/** Bom choáng: nổ sau `fuse` giây, loá mắt ai nhìn thấy trong `radius` m (nhìn thẳng vào thì lâu nhất `seconds` giây). */
export const FLASH = { fuse: 1.6, radius: 28, seconds: 5 };
/** Lựu đạn nổ trong đám khói thì thổi tan một khoảng bán kính `radius` m trong `seconds` giây rồi khói mới lấp lại. */
export const SMOKE_CLEAR = { radius: 6, seconds: 6 };
/** Cận chiến bằng dao: tầm với, sát thương (đâm sau lưng nhân đôi), thời gian hồi. */
export const MELEE = { range: 2.4, damage: 50, backstab: 2, cooldown: 0.7 };
