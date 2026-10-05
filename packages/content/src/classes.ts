// Bốn lớp lính của chiến trường (và đội trưởng chế độ Đồng đội): súng mang theo và khí tài đặc thù của từng lớp.
// Dùng chung cho server (trang bị khi hồi sinh, kiểm tra khí tài) và client (màn chọn lớp, ô khí tài, bảng điểm).
// Sinh tồn solo không có lớp lính: mua đồ tự do ở cửa hàng như cũ.

import type { SquadRole } from "./squad.ts";

export const SOLDIER_CLASS_IDS = ["assault", "recon", "support", "engineer"] as const;
export type SoldierClass = (typeof SOLDIER_CLASS_IDS)[number];

export const GADGET_ID_LIST = ["syringe", "m203", "binoculars", "ammobox", "sandbag", "repair", "atmine"] as const;
export type GadgetId = (typeof GADGET_ID_LIST)[number];

export interface GadgetDef {
  id: GadgetId;
  name: string;
  /** Ký hiệu ngắn trên ô khí tài. */
  icon: string;
  /** Số lượt mỗi lần hồi sinh (0: không tính lượt, dùng mãi: ống nhòm, mỏ lết). */
  charges: number;
  /** Giây chờ giữa hai lần dùng (server chặn bấm dồn). */
  cooldown: number;
  /** Cách dùng (hiện ở màn chọn lớp, ô khí tài). */
  info: string;
}

export const GADGETS: Record<GadgetId, GadgetDef> = {
  syringe: { id: "syringe", name: "Bơm tiêm Adrenaline", icon: "💉", charges: 3, cooldown: 20, info: "Chuột trái: chạy nhanh +25% trong 10 giây" },
  m203: { id: "m203", name: "Phóng lựu M203", icon: "⊕", charges: 4, cooldown: 2.4, info: "Chuột trái: bắn lựu đạn 40 mm theo đường cong, phá tường ~50 m" },
  binoculars: { id: "binoculars", name: "Ống nhòm", icon: "⌖", charges: 0, cooldown: 1.5, info: "Chuột phải: nhìn xa · chuột trái: đánh dấu địch, xe cho cả đội 15 giây" },
  ammobox: { id: "ammobox", name: "Hộp tiếp đạn", icon: "▤", charges: 2, cooldown: 3, info: "Chuột trái: đặt xuống, đồng đội đứng gần được nạp đạn, lựu đạn dần" },
  sandbag: { id: "sandbag", name: "Bờ bao cát", icon: "▬", charges: 3, cooldown: 1.2, info: "Chuột trái: dựng công sự chắn đạn trước mặt (bị bắn, nổ thì vỡ)" },
  repair: { id: "repair", name: "Mỏ lết sửa xe", icon: "🔧", charges: 0, cooldown: 0, info: "Giữ chuột trái cạnh xe phe mình bị hư để sửa" },
  atmine: { id: "atmine", name: "Mìn chống tăng", icon: "◉", charges: 3, cooldown: 1, info: "Chuột trái: chôn mìn, chỉ nổ khi xe địch cán qua" },
};

export interface ClassDef {
  id: SoldierClass;
  name: string;
  /** Ký hiệu lớp (bảng điểm, màn chọn lớp). */
  icon: string;
  info: string;
  /** Vai trò của máy tương ứng (khung hành vi của bot). */
  role: SquadRole;
  guns: readonly string[];
  /** Ống ngắm theo súng (thiếu thì dùng `sight`). */
  sight: string;
  sightFor?: Readonly<Record<string, string>>;
  outfit?: string;
  extras: readonly string[];
  /** Khí tài ô 1, ô 2 (Bắn Tỉa chỉ có ống nhòm; áo ghillie là bị động). */
  gadgets: readonly GadgetId[];
}

export const CLASSES: Record<SoldierClass, ClassDef> = {
  assault: {
    id: "assault",
    name: "Đột Kích",
    icon: "▲",
    info: "M416 / AKM / SCAR-L · Adrenaline, phóng lựu M203",
    role: "rifle",
    guns: ["m416", "akm", "scar"],
    sight: "reddot",
    extras: ["frag", "bandage", "bandage"],
    gadgets: ["syringe", "m203"],
  },
  recon: {
    id: "recon",
    name: "Bắn Tỉa",
    icon: "◎",
    info: "Kar98k / SKS / AWM ống 4x–8x · Ghillie, ống nhòm",
    role: "sniper",
    guns: ["kar98k", "sks", "awm"],
    sight: "x8",
    sightFor: { sks: "x4" },
    outfit: "ghillie",
    extras: ["smoke", "bandage"],
    gadgets: ["binoculars"],
  },
  support: {
    id: "support",
    name: "Quân Nhu",
    icon: "■",
    info: "M249 / DP-28 · Hộp tiếp đạn, bờ bao cát",
    role: "support",
    guns: ["m249", "dp28"],
    sight: "holo",
    extras: ["smoke", "bandage", "bandage"],
    gadgets: ["ammobox", "sandbag"],
  },
  engineer: {
    id: "engineer",
    name: "Kỹ Thuật",
    icon: "✹",
    info: "Vector / UMP45 + RPG-7 · Mỏ lết sửa xe, mìn chống tăng",
    role: "antitank",
    guns: ["vector", "ump45"],
    sight: "reddot",
    extras: ["rpg7", "ammo:rocket:4", "bandage", "bandage"],
    gadgets: ["repair", "atmine"],
  },
};

export function isSoldierClass(c: string): c is SoldierClass {
  return (SOLDIER_CLASS_IDS as readonly string[]).includes(c);
}

/** Lớp lính của một vai trò máy / lựa chọn hồi sinh: súng trường → Đột Kích, bắn tỉa → Bắn Tỉa, súng máy → Quân Nhu, chống tăng (và lái tăng) → Kỹ Thuật. */
export function classOfRole(role: string): SoldierClass {
  return role === "sniper" ? "recon" : role === "support" ? "support" : role === "antitank" || role === "tanker" ? "engineer" : "assault";
}

/** Ống ngắm cho khẩu `gun` của lớp. */
export function classSight(c: ClassDef, gun: string): string {
  return c.sightFor?.[gun] ?? c.sight;
}

/** Khí tài ở ô "gadget1" / "gadget2" của lớp (rỗng nếu lớp không có ô đó). */
export function gadgetIn(cls: string, slot: string): GadgetId | "" {
  if (!isSoldierClass(cls)) return "";
  const k = slot === "gadget1" ? 0 : slot === "gadget2" ? 1 : -1;
  return k < 0 ? "" : (CLASSES[cls].gadgets[k] ?? "");
}

// ---------------------------------------------------------------------------- số liệu khí tài

/** Adrenaline: thời gian, hệ số tốc độ chạy (server nới mức kiểm tra tốc độ đúng chừng này). */
export const ADRENALINE = { seconds: 10, speed: 1.25 };
/**
 * Phóng lựu M203: sơ tốc (m/s, bay cong theo trọng lực: rơi ~3 m ở 50 m), sức nổ (bán kính, sát thương người ở tâm,
 * sát thương thêm khi trúng thẳng xe). Nổ phá tường như lựu đạn (destruction.blast).
 */
export const M203 = { velocity: 62, radius: 4.2, damage: 95, armor: 140 };
/** Ống nhòm: tầm đánh dấu, thời gian dấu tồn tại, độ phóng đại. */
export const SPOT = { range: 420, seconds: 15, zoom: 4 };
/** Hộp tiếp đạn: bán kính, nhịp nạp (giây), tồn tại bao lâu, XP tiếp tế mỗi người nhận tối đa một lần / khoảng này (giây). */
export const AMMO_BOX = { radius: 3, every: 2, life: 120, xpEvery: 20 };
/** Bờ bao cát: kích thước khối (ngang, cao, dày), đặt cách chân bao xa, mỗi người tối đa bao nhiêu bờ cùng lúc. */
export const SANDBAG = { w: 1.8, h: 1.0, d: 0.55, ahead: 1.4, max: 3 };
/** Mỏ lết: máu xe hồi mỗi giây, tầm với (m, tính từ mép thân xe), mỗi chừng này máu sửa được một lần XP. */
export const REPAIR = { rate: 70, reach: 2.2, xpPer: 250 };
/** Mìn chống tăng: bán kính kích nổ khi xe cán, sát thương vào xe, sức nổ vào người, thời gian chờ kích hoạt. */
export const AT_MINE = { trigger: 2.6, armor: 650, radius: 4, damage: 70, arm: 2 };
