// Chỉ số dùng chung cho tương tác thời gian thực (server tính, client hiển thị): đánh tay không,
// chặt cây, cây mọc lại, leo cây. Chỉ số của từng món đồ nằm trong items.json.

import { content } from "./content.ts";
import type { Item } from "./schema.ts";
import type { TreeKind } from "./worldgen.ts";

export type HitStats = NonNullable<Item["melee"]>;

/** Tay không: đấm nhẹ, nhanh, vui là chính. */
export const FISTS: HitStats = { damage: 5, reach: 1.6, cooldown: 0.5, word: "BỤP!" };

/** Đòn đánh gần khi cầm món này (không cầm gì, hoặc món không dùng để đánh được, thì là tay không). */
export function meleeOf(itemId: string | null | undefined): HitStats {
  return (itemId && content.items.get(itemId)?.melee) || FISTS;
}

/** Chặt bằng tay không thì mỗi nhát chỉ được chừng này. */
export const UNARMED_CHOP = 4;

export const TREE_KINDS: Record<TreeKind, { name: string; hp: number; wood: number; drops: { item: string; chance: number }[] }> = {
  palm: { name: "Cây dừa", hp: 60, wood: 2, drops: [{ item: "coconut", chance: 0.8 }, { item: "palm_sprout", chance: 0.7 }] },
  broadleaf: { name: "Cây rừng", hp: 90, wood: 3, drops: [{ item: "sapling", chance: 0.7 }] },
};

/** Cây mới trồng lớn hẳn sau chừng này giây (tính cả ban đêm); lớn quá nửa thì leo được. */
export const GROW_SECONDS = 180;
export const CLIMBABLE_GROWTH = 0.6;
/** Đứng cách thân cây chừng này thì leo được. */
export const CLIMB_REACH = 1.6;
/** Rơi từ cây bị chặt: mất Máu theo độ cao (mỗi mét), tối đa chừng này. */
export const FALL_DAMAGE_PER_M = 3;
export const FALL_DAMAGE_MAX = 25;
/** Tầm với để nhặt đồ dưới đất và để kết liễu. */
export const PICKUP_RADIUS = 2.2;
export const ASSASSINATE_RADIUS = 2.2;
/** Công trình phải dựng trong bán kính này quanh lửa trại. */
export const BUILD_RADIUS = 28;
