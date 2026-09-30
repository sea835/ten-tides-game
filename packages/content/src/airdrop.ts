import { insideBox, outside, raycastBoxes, type BattleMap } from "./battle.ts";
import { WEAPON } from "./battleItems.ts";

// Thùng thính (airdrop) của chế độ sinh tồn: giữa trận máy bay thả một thùng đồ xịn bằng dù xuống một chỗ trên
// đất liền trong vùng an toàn. Thùng rơi chậm chừng hai mươi giây (ai cũng thấy, chạy tới tranh nhau), chạm đất thì
// bung khói đỏ và đổ đồ ra quanh thùng: súng hàng hiếm, giáp mũ cấp 3, ống ngắm xa, phụ kiện, đồ hồi máu.
// Dùng chung cho server (chọn chỗ, chọn đồ) và client (vẽ dù, đếm giây).

export const AIRDROP = {
  /** Thùng đầu tiên rơi sau chừng này giây kể từ lúc vào trận. */
  first: 60,
  /** Các thùng sau cách nhau từ `every[0]` tới `every[1]` giây. */
  every: [90, 120] as const,
  /** Tối đa bao nhiêu thùng mỗi trận. */
  max: 4,
  /** Độ cao lúc bung dù (so với mặt đất) và thời gian rơi tới đất (giây). */
  height: 110,
  fall: 22,
  /** Khói đỏ bốc lên bao lâu sau khi chạm đất (giây). */
  smoke: 90,
  /** Đồ đổ ra quanh thùng, cách tâm thùng chừng này mét. */
  ring: 1.4,
} as const;

/** Chỗ thùng rơi có đủ trống không: trên cạn, không trong nhà, không dưới mái, không trúng cây, không trong bãi mìn. */
export function airdropClear(map: BattleMap, x: number, z: number): boolean {
  const h = map.world.heightAt(x, z);
  if (h < 1.2) return false;
  // Không quá xa tâm bản đồ (mép đảo toàn vách và bãi cát sát nước).
  const half = map.half ?? 240;
  if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) return false;
  const mf = map.sites.find((s) => s.kind === "minefield");
  if (mf && outside(mf, x, z, 6) === 0) return false;
  // Thùng rộng chừng 1,2 m, đồ đổ ra vòng quanh: chừa khoảng trống rộng hơn.
  const pad = AIRDROP.ring + 0.8;
  for (const dy of [0.4, 1.2, 2.5]) if (insideBox(map.index, x, h + dy, z, pad)) return false;
  // Không có mái, sàn nào che phía trên (thùng rơi thẳng đứng từ trên trời xuống).
  if (raycastBoxes(map.index, [x, h + 0.5, z], [0, 1, 0], AIRDROP.height + 20) < Infinity) return false;
  if (map.world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.5)) return false;
  // Đất dốc quá thì đồ lăn lung tung: các điểm quanh vòng đồ không chênh nhau nhiều.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    if (Math.abs(map.world.heightAt(x + Math.cos(a) * pad, z + Math.sin(a) * pad) - h) > 1.2) return false;
  }
  return true;
}

/**
 * Chọn chỗ thùng rơi: một điểm ngẫu nhiên trong vùng an toàn (tâm `zx, zz`, bán kính `zr`), ưu tiên phía trong vòng
 * (không sát mép vùng độc). Không tìm được chỗ trống thì trả null (trận đó bỏ qua lượt thả này).
 */
export function airdropSpot(map: BattleMap, zone: { x: number; z: number; r: number }, rand: () => number): { x: number; y: number; z: number } | null {
  const r = Math.max(0, zone.r * 0.8);
  for (let tries = 0; tries < 120; tries++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    const x = zone.x + Math.cos(a) * d;
    const z = zone.z + Math.sin(a) * d;
    if (airdropClear(map, x, z)) return { x, y: map.world.heightAt(x, z), z };
  }
  return null;
}

/** Súng chỉ nên có trong thùng thính: hàng hiếm (AWM, M249), kèm đạn, ống ngắm và phụ kiện hợp với súng. */
const CRATE_GUNS: readonly { gun: string; sight: string; atts: readonly string[] }[] = [
  { gun: "awm", sight: "x8", atts: ["suppressor", "cheekpad", "extquick"] },
  { gun: "m249", sight: "x4", atts: ["tacstock"] },
];

/**
 * Đồ trong một thùng thính (id đồ như dưới đất). Luôn có: một súng hàng hiếm với hai hộp đạn, ống ngắm, phụ kiện;
 * giáp cấp 3, mũ cấp 3; hộp cứu thương, băng gạc. Thêm ngẫu nhiên: một món phụ kiện hiếm cho súng trường, lựu đạn.
 */
export function airdropLoot(rand: () => number): string[] {
  const pick = CRATE_GUNS[Math.floor(rand() * CRATE_GUNS.length)] ?? CRATE_GUNS[0]!;
  const def = WEAPON.get(pick.gun)!;
  const items = [pick.gun, `ammo:${def.ammo}`, `ammo:${def.ammo}`, `sight:${pick.sight}`, ...pick.atts.map((a) => `att:${a}`)];
  items.push("armor:3", "helmet:3", "medkit", "bandage", "bandage");
  if (rand() < 0.5) items.push(rand() < 0.5 ? "att:comp" : "att:vgrip");
  if (rand() < 0.5) items.push("frag");
  return items;
}

/** Thùng đang rơi: độ cao so với mặt đất khi đã rơi được phần `k` (0 lúc bung dù, 1 lúc chạm đất). */
export function airdropAltitude(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  // Dù vừa bung còn rơi nhanh hơn, về sau đều dần: 1 − t^0.85 cho chạm đất êm, không giật.
  return AIRDROP.height * (1 - Math.pow(t, 0.85));
}
