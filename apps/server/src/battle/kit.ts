import {
  AMMO,
  ARMOR,
  HEALS,
  HELMETS,
  OUTFITS,
  SIGHTS,
  THROWABLES,
  sightFits,
  WEAPON,
  type AmmoId,
  type HealId,
  type ThrowableId,
  type WeaponDef,
} from "@tentides/content";
import type { KitState } from "@tentides/protocol";

// Hành trang Battleground: đọc, ghi các ô súng, băng đạn, đạn dự trữ; mua đồ; nhặt đồ dưới đất.

export type GunSlot = "primary1" | "primary2" | "pistol";
export const GUN_SLOTS: readonly GunSlot[] = ["primary1", "primary2", "pistol"];

export function isGunSlot(slot: string): slot is GunSlot {
  return (GUN_SLOTS as readonly string[]).includes(slot);
}

export function weaponIn(kit: KitState, slot: GunSlot): WeaponDef | undefined {
  return WEAPON.get(kit[slot]);
}

export function magOf(kit: KitState, slot: GunSlot): number {
  return slot === "primary1" ? kit.mag1 : slot === "primary2" ? kit.mag2 : kit.magP;
}

export function setMag(kit: KitState, slot: GunSlot, n: number) {
  if (slot === "primary1") kit.mag1 = n;
  else if (slot === "primary2") kit.mag2 = n;
  else kit.magP = n;
}

/** Ống ngắm đang lắp trên khẩu ở ô này. */
export function sightOf(kit: KitState, slot: GunSlot): string {
  return slot === "primary1" ? kit.sight1 : slot === "primary2" ? kit.sight2 : kit.sightP;
}

export function setSight(kit: KitState, slot: GunSlot, sight: string) {
  if (slot === "primary1") kit.sight1 = sight;
  else if (slot === "primary2") kit.sight2 = sight;
  else kit.sightP = sight;
}

/**
 * Lắp ống ngắm: ưu tiên khẩu đang cầm, rồi khẩu chưa có ống, rồi khẩu đang có ống kém hơn. Ống cũ tháo ra rơi xuống.
 * Không khẩu nào lắp được thì không nhận.
 */
export function attachSight(kit: KitState, sight: string, dropped: Dropped): boolean {
  const fits = GUN_SLOTS.filter((slot) => {
    const def = weaponIn(kit, slot);
    return def && sightFits(sight, def) && sightOf(kit, slot) !== sight;
  });
  if (!fits.length) return false;
  const zoom = (id: string) => (id in SIGHTS ? SIGHTS[id as keyof typeof SIGHTS].zoom : 0);
  const slot =
    fits.find((sl) => sl === kit.active) ??
    fits.find((sl) => !sightOf(kit, sl)) ??
    [...fits].sort((a, b) => zoom(sightOf(kit, a)) - zoom(sightOf(kit, b)))[0]!;
  const old = sightOf(kit, slot);
  if (old) dropped.push(`sight:${old}`);
  setSight(kit, slot, sight);
  return true;
}

export function ammoOf(kit: KitState, ammo: string): number {
  return kit.ammo.get(ammo) ?? 0;
}

export function addAmmo(kit: KitState, ammo: string, n: number) {
  kit.ammo.set(ammo, Math.min(999, ammoOf(kit, ammo) + n));
}

export function resetKit(kit: KitState, money: number) {
  kit.money = money;
  kit.primary1 = kit.primary2 = kit.pistol = "";
  kit.mag1 = kit.mag2 = kit.magP = 0;
  kit.sight1 = kit.sight2 = kit.sightP = "";
  kit.active = "";
  kit.ammo.clear();
  kit.frag = kit.smoke = kit.flash = kit.mine = kit.bandage = kit.medkit = 0;
  kit.armor = kit.armorHp = kit.helmet = kit.helmetHp = 0;
  kit.reloading = false;
  kit.healing = "";
}

/** Món rơi ra đất khi thay đồ: trả về id đồ để bỏ xuống (hoặc null). */
export type Dropped = string[];

/** Nhét một khẩu súng vào hành trang: ô trống trước, hết ô thì thay khẩu đang cầm (khẩu cũ rơi xuống). */
export function giveWeapon(kit: KitState, def: WeaponDef, mag = def.mag): Dropped {
  const dropped: Dropped = [];
  let slot: GunSlot;
  if (def.class === "pistol") slot = "pistol";
  else if (!kit.primary1) slot = "primary1";
  else if (!kit.primary2) slot = "primary2";
  else slot = kit.active === "primary2" ? "primary2" : "primary1";
  const old = kit[slot];
  if (old) {
    dropped.push(old);
    const oldDef = WEAPON.get(old);
    if (oldDef) addAmmo(kit, oldDef.ammo, magOf(kit, slot));
  }
  kit[slot] = def.id;
  setMag(kit, slot, mag);
  // Ống ngắm của khẩu cũ: lắp được lên khẩu mới thì giữ, không thì tháo ra để lại.
  const sight = sightOf(kit, slot);
  if (sight && !sightFits(sight, def)) {
    dropped.push(`sight:${sight}`);
    setSight(kit, slot, "");
  }
  kit.active = slot;
  kit.reloading = false;
  return dropped;
}

/** Nhận một món (mua hoặc nhặt). Trả về false nếu không nhận được (đầy, không tốt hơn...). */
export function receive(kit: KitState, item: string, dropped: Dropped): boolean {
  const def = WEAPON.get(item);
  if (def) {
    dropped.push(...giveWeapon(kit, def));
    return true;
  }
  const [kind, arg, count] = item.split(":");
  if (kind === "ammo" && arg && arg in AMMO) {
    addAmmo(kit, arg, count ? Number(count) : AMMO[arg as AmmoId].pack);
    return true;
  }
  if (kind === "money") {
    kit.money += Number(arg) || 0;
    return true;
  }
  if (kind === "sight" && arg && arg in SIGHTS) return attachSight(kit, arg, dropped);
  if (kind === "armor" || kind === "helmet") {
    const level = Number(arg);
    const table = kind === "armor" ? ARMOR : HELMETS;
    const spec = table[level - 1];
    if (!spec) return false;
    const current = kind === "armor" ? kit.armor : kit.helmet;
    if (current) dropped.push(`${kind}:${current}`);
    if (kind === "armor") {
      kit.armor = level;
      kit.armorHp = spec.durability;
    } else {
      kit.helmet = level;
      kit.helmetHp = spec.durability;
    }
    return true;
  }
  if (kind === "outfit") {
    if (!OUTFITS.some((o) => o.id === arg)) return false;
    kit.outfit = arg!;
    return true;
  }
  if (item in THROWABLES) {
    const t = item as ThrowableId;
    if (kit[t] >= THROWABLES[t].max) return false;
    kit[t] += 1;
    return true;
  }
  if (item in HEALS) {
    const h = item as HealId;
    if (kit[h] >= HEALS[h].max) return false;
    kit[h] += 1;
    return true;
  }
  return false;
}

/** Giá của một món trong cửa hàng (null nếu không bán). */
export function priceOf(item: string): number | null {
  const def = WEAPON.get(item);
  if (def) return def.price > 0 ? def.price : null;
  const [kind, arg] = item.split(":");
  if (kind === "ammo" && arg && arg in AMMO) return AMMO[arg as AmmoId].price;
  if (kind === "armor") return ARMOR[Number(arg) - 1]?.price || null;
  if (kind === "helmet") return HELMETS[Number(arg) - 1]?.price || null;
  if (kind === "outfit") return 0;
  if (kind === "sight") return (arg && arg in SIGHTS && SIGHTS[arg as keyof typeof SIGHTS].price) || null;
  if (item in THROWABLES) return THROWABLES[item as ThrowableId].price;
  if (item in HEALS) return HEALS[item as HealId].price;
  return null;
}

/** Mọi thứ trong hành trang rơi ra đất khi chết. */
export function everything(kit: KitState): string[] {
  const out: string[] = [];
  for (const slot of GUN_SLOTS) {
    const def = weaponIn(kit, slot);
    if (!def) continue;
    out.push(def.id);
    const sight = sightOf(kit, slot);
    if (sight) out.push(`sight:${sight}`);
    const inMag = magOf(kit, slot);
    if (inMag) addAmmo(kit, def.ammo, inMag);
  }
  for (const [ammo, n] of kit.ammo) if (n > 0) out.push(`ammo:${ammo}:${n}`);
  if (kit.armor) out.push(`armor:${kit.armor}`);
  if (kit.helmet) out.push(`helmet:${kit.helmet}`);
  for (const t of ["frag", "smoke", "flash", "mine", "bandage", "medkit"] as const) for (let k = 0; k < kit[t]; k++) out.push(t);
  if (kit.money >= 100) out.push(`money:${Math.floor(kit.money / 2)}`);
  return out;
}
