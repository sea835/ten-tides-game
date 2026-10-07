import { CLASSES, EMPTY_LOADOUT, GUNSMITH_WEAPON_IDS, SKIN, isSoldierClass, loadoutAtts, rarityRank } from "@tentides/content";
import { PLAYER_COLORS } from "@tentides/protocol";
import type { Profile } from "../account/account.ts";
import type { StudioLook } from "./studioTypes.ts";

// Ngoại hình nhân vật đứng trên bục ở sảnh: ngoài sảnh lấy theo tài khoản (khẩu có skin hiếm nhất đã lắp, bộ phụ kiện
// Gunsmith của khẩu đó), trong phòng lấy theo lớp lính đã chọn và trang phục, skin của mình trong phòng.

/** Màu người chơi theo tên (cùng tên thì cùng mặt mũi, kiểu tóc). */
export function colorForName(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length]!;
}

/** Khẩu trưng bày: khẩu có skin hiếm nhất đang lắp, không có thì M416. */
function showcaseWeapon(profile: Profile | null): string {
  let best = "";
  let bestRank = -1;
  for (const [weapon, skinId] of Object.entries(profile?.equipped ?? {})) {
    const def = SKIN.get(skinId);
    if (!def || !GUNSMITH_WEAPON_IDS.includes(weapon)) continue;
    const r = rarityRank(def.rarity);
    if (r > bestRank) {
      best = weapon;
      bestRank = r;
    }
  }
  return best || "m416";
}

/** Sảnh ngoài: nhân vật theo tài khoản (khách thì M416 trơn, ống ngắm chấm đỏ). */
export function lobbyLook(name: string, profile: Profile | null): StudioLook {
  const weapon = showcaseWeapon(profile);
  const loadout = { ...EMPTY_LOADOUT, ...(profile?.loadouts?.[weapon] ?? {}) };
  return {
    color: colorForName(name || "Tân binh"),
    outfit: "woodland",
    armor: 2,
    helmet: 2,
    weapon,
    sight: loadout.sight || "reddot",
    atts: loadoutAtts(loadout),
    skin: profile?.equipped[weapon] ?? "",
  };
}

/**
 * Trong phòng: súng chính của lớp lính đã chọn (chưa chọn thì súng đang có, không thì M416), trang phục theo lớp
 * (Bắn Tỉa mặc ghillie), skin mình đã lắp cho khẩu đó, phụ kiện Gunsmith từ tài khoản.
 */
export function roomLook(p: { color: string; cls: string; outfit: string; primary: string; armor: number; helmet: number; skins: Readonly<Record<string, string>> }, profile: Profile | null): StudioLook {
  const cls = isSoldierClass(p.cls) ? CLASSES[p.cls] : null;
  const weapon = cls?.guns[0] ?? (p.primary || "m416");
  const loadout = { ...EMPTY_LOADOUT, ...(profile?.loadouts?.[weapon] ?? {}) };
  return {
    color: p.color,
    outfit: cls?.outfit ?? (p.outfit || "woodland"),
    armor: p.armor || 2,
    helmet: p.helmet || 2,
    weapon,
    sight: loadout.sight || (cls ? (cls.sightFor?.[weapon] ?? cls.sight) : "reddot"),
    atts: loadoutAtts(loadout),
    skin: p.skins[weapon] ?? profile?.equipped[weapon] ?? "",
  };
}
