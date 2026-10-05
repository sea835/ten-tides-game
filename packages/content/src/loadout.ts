// Gunsmith: bộ lắp ráp ưa thích của mỗi khẩu súng (đầu nòng, tay cầm, băng đạn, báng, ống ngắm), lưu theo tài khoản.
// Hàm thuần dùng chung: server kiểm tra trước khi ghi database, client liệt kê lựa chọn và dựng mô hình súng.

import { ATTACHMENTS, SIGHTS, SIGHT_IDS, ATTACHMENT_IDS, WEAPON, attachmentFits, sightFits, type AttachmentSlot } from "./battleItems.ts";
import { SKIN_WEAPON_IDS } from "./skins.ts";

export type LoadoutSlot = AttachmentSlot | "sight";

/** Thứ tự các ô trong Gunsmith. */
export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ["muzzle", "grip", "mag", "stock", "sight"];

export const LOADOUT_SLOT_NAME: Record<LoadoutSlot, string> = {
  muzzle: "Đầu nòng",
  grip: "Tay cầm",
  mag: "Băng đạn",
  stock: "Báng",
  sight: "Kính ngắm",
};

/** Bộ lắp ráp của một khẩu: id phụ kiện / ống ngắm ở mỗi ô, rỗng là để trống. */
export type WeaponLoadout = Record<LoadoutSlot, string>;

export const EMPTY_LOADOUT: Readonly<WeaponLoadout> = { muzzle: "", grip: "", mag: "", stock: "", sight: "" };

/** Các khẩu chỉnh được trong Gunsmith (cũng là các khẩu lắp được skin). */
export const GUNSMITH_WEAPON_IDS: readonly string[] = SKIN_WEAPON_IDS;

/** Những lựa chọn lắp được vào ô `slot` của khẩu `weaponId` (không gồm "để trống"). */
export function loadoutOptions(weaponId: string, slot: LoadoutSlot): string[] {
  const def = WEAPON.get(weaponId);
  if (!def) return [];
  if (slot === "sight") return SIGHT_IDS.filter((s) => sightFits(s, def));
  return ATTACHMENT_IDS.filter((a) => ATTACHMENTS[a].slot === slot && attachmentFits(a, def));
}

/** Tên hiển thị của một lựa chọn. */
export function loadoutItemName(slot: LoadoutSlot, id: string): string {
  if (!id) return "Trống";
  if (slot === "sight") return SIGHTS[id as keyof typeof SIGHTS]?.name ?? id;
  return ATTACHMENTS[id as keyof typeof ATTACHMENTS]?.name ?? id;
}

/**
 * Kiểm tra một bộ lắp ráp gửi lên: khẩu phải chỉnh được, mỗi ô chỉ nhận món đúng ô và lắp vừa khẩu đó.
 * Trả về bộ đã chuẩn hoá (đủ năm ô), hoặc null kèm lý do.
 */
export function validateLoadout(weaponId: string, raw: Partial<Record<string, string>>): { ok: true; loadout: WeaponLoadout } | { ok: false; reason: string } {
  if (!GUNSMITH_WEAPON_IDS.includes(weaponId) || !WEAPON.has(weaponId)) return { ok: false, reason: "Không có khẩu súng này." };
  const out: WeaponLoadout = { ...EMPTY_LOADOUT };
  for (const slot of LOADOUT_SLOTS) {
    const id = raw[slot] ?? "";
    if (!id) continue;
    if (!loadoutOptions(weaponId, slot).includes(id)) return { ok: false, reason: `${LOADOUT_SLOT_NAME[slot]}: "${id}" không lắp được lên khẩu này.` };
    out[slot] = id;
  }
  return { ok: true, loadout: out };
}

/** Chuỗi phụ kiện (không gồm ống ngắm) theo kiểu KitState / GunModel: "comp,vgrip,extmag". */
export function loadoutAtts(l: Partial<WeaponLoadout>): string {
  return (["muzzle", "grip", "mag", "stock"] as const)
    .map((s) => l[s] ?? "")
    .filter(Boolean)
    .join(",");
}
