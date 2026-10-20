import { WEAPON, loadoutItemPrice, loadoutItems, validateLoadout, type AttachmentId, type WeaponLoadout } from "@tentides/content";
import type { KitState } from "@tentides/protocol";
import { weaponLoadouts } from "../db/accounts.ts";
import { accountsEnabled } from "../db/pool.ts";
import { attOf, attachPartTo, magOf, magSize, priceOf, setMag, setSight, sightOf, type Dropped, type GunSlot } from "./kit.ts";

// Bộ lắp ráp Kho Quân Nhu (Gunsmith) trong trận: server nạp các bộ đã lưu theo tài khoản lúc vào phòng (client không
// bao giờ gửi danh sách phụ kiện), kiểm tra lại từng bộ bằng validateLoadout (bộ cũ trong database có thể không còn
// hợp lệ khi luật lắp ráp đổi). Sinh tồn / Đồng đội: nút "Mua theo cấu hình" mua súng rồi mua từng món của bộ theo giá
// thường, món nào không đủ tiền hay không bán thì bỏ qua. Chiến trường: hồi sinh với súng của lớp lính thì lắp sẵn bộ
// đã lưu cho khẩu đó (chỉ món bán ở cửa hàng; ống ngắm hàng hiếm chỉ khi trùng ống lớp lính vốn được phát).

/** Bộ lắp ráp đã lưu của một tài khoản (khách, database tắt hay lỗi: không có bộ nào). */
export async function savedLoadouts(userId: number | null): Promise<Record<string, WeaponLoadout>> {
  if (userId === null || !accountsEnabled()) return {};
  try {
    return cleanLoadouts(await weaponLoadouts(userId));
  } catch (err) {
    console.warn("Không đọc được bộ lắp ráp Gunsmith, vào trận không có bộ nào:", err instanceof Error ? err.message : err);
    return {};
  }
}

/** Giữ lại các bộ còn hợp lệ (khẩu chỉnh được, mỗi ô lắp vừa khẩu đó), chuẩn hoá đủ năm ô. */
export function cleanLoadouts(raw: Record<string, Partial<Record<string, string>>>): Record<string, WeaponLoadout> {
  const out: Record<string, WeaponLoadout> = {};
  for (const [weaponId, l] of Object.entries(raw)) {
    const checked = validateLoadout(weaponId, l ?? {});
    if (checked.ok) out[weaponId] = checked.loadout;
  }
  return out;
}

/** Món `part` ("sight:…" / "att:…") đã nằm trên khẩu ở ô `slot` chưa. */
function mounted(kit: KitState, slot: GunSlot, part: string): boolean {
  const [kind, id] = part.split(":");
  return kind === "sight" ? sightOf(kit, slot) === id : attOf(kit, slot).split(",").includes(id ?? "");
}

/** Lắp `part` lên đúng khẩu ở ô `slot` (món cũ cùng chỗ rơi vào `dropped`). Băng đang đầy thì lắp băng mở rộng xong vẫn đầy. */
function mount(kit: KitState, slot: GunSlot, part: string, dropped: Dropped) {
  const [kind, id] = part.split(":");
  if (kind === "sight") {
    const old = sightOf(kit, slot);
    if (old) dropped.push(`sight:${old}`);
    setSight(kit, slot, id!);
    return;
  }
  const full = magOf(kit, slot) >= magSize(kit, slot);
  attachPartTo(kit, slot, id as AttachmentId, dropped);
  if (full) setMag(kit, slot, magSize(kit, slot));
}

/**
 * Mua phụ kiện của bộ lắp ráp cho khẩu vừa mua ở ô `slot`: mỗi món theo giá cửa hàng, món đã có sẵn trên súng thì
 * thôi, món không bán (hàng hiếm) hay không đủ tiền thì bỏ qua. Trả về các món đã mua và đã bỏ qua.
 */
export function buyLoadoutParts(kit: KitState, slot: GunSlot, l: WeaponLoadout, dropped: Dropped): { bought: string[]; skipped: string[] } {
  const bought: string[] = [];
  const skipped: string[] = [];
  const def = WEAPON.get(kit[slot]);
  // Kiểm tra lại cả bộ với đúng khẩu đang ở ô này (không tin bộ truyền vào).
  const checked = def ? validateLoadout(def.id, l) : null;
  if (!checked?.ok) return { bought, skipped: loadoutItems(l) };
  for (const part of loadoutItems(checked.loadout)) {
    if (mounted(kit, slot, part)) continue;
    const price = priceOf(part);
    if (price === null || kit.money < price) {
      skipped.push(part);
      continue;
    }
    kit.money -= price;
    mount(kit, slot, part, dropped);
    bought.push(part);
  }
  return { bought, skipped };
}

/**
 * Chiến trường: lắp bộ đã lưu lên súng chính của lớp lính lúc hồi sinh (miễn phí, như đồ lớp lính phát). Luật lớp
 * lính: chỉ khẩu ở ô primary1 (súng của lớp), chỉ món lắp vừa khẩu đó và có bán ở cửa hàng (hàng hiếm như băng mở rộng
 * thay nhanh không phát không); ống ngắm hàng hiếm (8x) chỉ khi lớp lính vốn được phát đúng ống đó. Đồ tháo ra bỏ đi.
 */
export function applyClassLoadout(kit: KitState, l: WeaponLoadout | undefined): string[] {
  const def = WEAPON.get(kit.primary1);
  if (!def || !l) return [];
  const checked = validateLoadout(def.id, l);
  if (!checked.ok) return [];
  const issued = sightOf(kit, "primary1");
  const applied: string[] = [];
  for (const part of loadoutItems(checked.loadout)) {
    const [kind, id] = part.split(":");
    if (!loadoutItemPrice(part) && !(kind === "sight" && id === issued)) continue;
    if (!mounted(kit, "primary1", part)) mount(kit, "primary1", part, []);
    applied.push(part);
  }
  return applied;
}
