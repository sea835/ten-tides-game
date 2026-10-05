import type { BattleBox, BoxIndex, BoxMat } from "./battle.ts";
import type { WeaponDef } from "./battleItems.ts";

// Đạn gặp vật cản: xuyên qua tấm mỏng (tuỳ vật liệu và cỡ đạn) hay nảy đi (bắn sượt vào kim loại, bê tông).
// Client (Shooter: lỗ đạn, tia lửa, báo trúng) và server (BattleRoom.fire: kiểm tra trúng, tính sát thương) cùng gọi các
// hàm ở đây với cùng khối hộp của bản đồ, nên quyết định xuyên / nảy khớp nhau ở hai bên.

/**
 * Cỡ đạn theo sức xuyên: `heavy` đạn 7.62 / .300 (AKM, SKS, Kar98k, AWM, DP-28), `rifle` đạn 5.56, `light` đạn súng lục
 * và tiểu liên (9mm, .45), `pellet` từng viên chì shotgun.
 */
export type Caliber = "heavy" | "rifle" | "light" | "pellet";

export function caliberOf(def: Pick<WeaponDef, "ammo" | "pellets">): Caliber {
  if (def.pellets > 1 || def.ammo === "12g") return "pellet";
  if (def.ammo === "762" || def.ammo === "300") return "heavy";
  if (def.ammo === "556") return "rifle";
  return "light";
}

/** Đạn cỡ này xuyên được tấm dày tối đa chừng này mét (đo dọc đường đạn bên trong tấm). */
export const PEN_THICK: Record<Caliber, number> = { heavy: 0.5, rifle: 0.45, light: 0.3, pellet: 0.2 };

/** Tấm kim loại mỏng hơn chừng này (m) là tôn, vách thép mỏng: súng trường xuyên được. */
export const SHEET_METAL = 0.12;

/**
 * Phần sát thương còn lại sau khi xuyên một lớp vật liệu (0: đạn găm lại). Theo kế hoạch: vách gỗ mỏng, tôn, biển báo
 * thì đạn súng trường đi qua gần như nguyên vẹn; vữa ăn bớt; đạn súng lục / tiểu liên yếu hơn nhiều; bao cát, gạch,
 * bê tông dày, đá thì chặn hẳn.
 */
const PEN_TABLE: Partial<Record<BoxMat | "sheet", Record<Caliber, number>>> = {
  wood: { heavy: 1, rifle: 1, light: 0.7, pellet: 0.45 },
  sign: { heavy: 1, rifle: 1, light: 0.75, pellet: 0.5 },
  plaster: { heavy: 0.9, rifle: 0.8, light: 0.5, pellet: 0 },
  sheet: { heavy: 0.9, rifle: 0.8, light: 0, pellet: 0 },
};

/** Vật liệu của khối khi xét xuyên đạn (kim loại đủ mỏng là "tôn"). */
function penMat(b: BattleBox): BoxMat | "sheet" {
  if ((b.mat === "metal" || b.mat === "rust" || b.mat === "container") && Math.min(b.w, b.h, b.d) <= SHEET_METAL) return "sheet";
  return b.mat;
}

/** Phần sát thương còn lại khi đạn cỡ `cal` xuyên qua khối `b` dày `thick` mét theo đường đạn (0: không xuyên). */
export function penetration(b: BattleBox, cal: Caliber, thick: number): number {
  if (thick > PEN_THICK[cal]) return 0;
  return PEN_TABLE[penMat(b)]?.[cal] ?? 0;
}

/** Khối này có thể cho đạn (cỡ nào đó) xuyên không, bất kể độ dày. */
export function penetrableBy(b: BattleBox, cal: Caliber): boolean {
  return (PEN_TABLE[penMat(b)]?.[cal] ?? 0) > 0;
}

// ---------------------------------------------------------------------------- đạn nảy

/**
 * Đạn nảy: bắn sượt (góc giữa đường đạn và mặt phẳng nhỏ hơn `metal` độ) vào kim loại thì nảy đi tóe lửa, bê tông, đá,
 * đường nhựa thì góc phải sượt hơn (`hard`). Viên nảy bay thẳng tối đa `range` mét nữa, sát thương còn `damage` phần.
 */
export const RICOCHET = { metal: 15, hard: 8, range: 25, damage: 0.5 } as const;

/** Góc sượt tối đa (radian) để đạn nảy trên vật liệu này; 0 là không nảy. */
export function ricochetLimit(mat: BoxMat): number {
  if (mat === "metal" || mat === "container" || mat === "hull" || mat === "rust" || mat === "sign") return (RICOCHET.metal * Math.PI) / 180;
  if (mat === "concrete" || mat === "stone" || mat === "road") return (RICOCHET.hard * Math.PI) / 180;
  return 0;
}

/** Pháp tuyến (hướng ra ngoài) của mặt khối `i` gần điểm `p` nhất (điểm đạn chạm, toạ độ thế giới). */
export function boxNormalAt(index: BoxIndex, i: number, p: readonly [number, number, number]): [number, number, number] {
  const b = index.boxes[i]!;
  const a = index.axes;
  const k = i * 9;
  const rx = p[0] - b.x;
  const ry = p[1] - b.y;
  const rz = p[2] - b.z;
  let best = -Infinity;
  let axis = 0;
  let sign = 1;
  for (let j = 0; j < 3; j++) {
    const o = k + j * 3;
    const l = rx * a[o]! + ry * a[o + 1]! + rz * a[o + 2]!;
    const half = (j === 0 ? b.w : j === 1 ? b.h : b.d) / 2;
    // Mặt gần nhất: toạ độ cục bộ sát nửa cạnh nhất (điểm chạm nằm trên mặt nào thì khoảng cách tới mặt đó ≈ 0).
    const q = Math.abs(l) - half;
    if (q > best) {
      best = q;
      axis = j;
      sign = l >= 0 ? 1 : -1;
    }
  }
  const o = k + axis * 3;
  return [a[o]! * sign, a[o + 1]! * sign, a[o + 2]! * sign];
}

/**
 * Đạn theo hướng `d` (vector đơn vị) chạm khối `i` ở điểm `p`: có nảy không, nảy theo hướng nào (phản xạ gương qua mặt
 * khối, hoàn toàn tất định để server tính lại đúng như client). Trả null nếu găm lại.
 */
export function ricochet(
  index: BoxIndex,
  i: number,
  p: readonly [number, number, number],
  d: readonly [number, number, number],
): { d: [number, number, number]; n: [number, number, number]; mult: number } | null {
  const b = index.boxes[i];
  if (!b) return null;
  const limit = ricochetLimit(b.mat);
  if (limit <= 0) return null;
  const n = boxNormalAt(index, i, p);
  const dn = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  // Đạn phải đi vào mặt (dn < 0) và sượt dưới góc giới hạn: sin(góc sượt) = |d·n|.
  if (dn >= 0 || -dn >= Math.sin(limit)) return null;
  const r: [number, number, number] = [d[0] - 2 * dn * n[0], d[1] - 2 * dn * n[1], d[2] - 2 * dn * n[2]];
  const l = Math.hypot(r[0], r[1], r[2]) || 1;
  return { d: [r[0] / l, r[1] / l, r[2] / l], n, mult: RICOCHET.damage };
}
