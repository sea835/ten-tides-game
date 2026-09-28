import { z } from "zod";
import { STAT_IDS, WEATHER_IDS, ZONE_IDS, type EventCard as RulesEventCard } from "@tentides/rules";

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "id chỉ gồm chữ thường, số và dấu gạch dưới");

/** Hệ quả khi đánh hoặc ném trúng: sát thương, tiếng kêu vui vẻ hiện lên màn hình, và hiệu ứng (giây). */
function HitSchema() {
  return z.object({
    damage: z.int().min(0).max(60),
    word: z.string().min(1).optional(),
    stun: z.number().positive().max(5).optional(),
    dizzy: z.number().positive().max(10).optional(),
    blind: z.number().positive().max(10).optional(),
  });
}

export const ItemSchema = z.object({
  id,
  name: z.string().min(1),
  /** Kích thước khối trên lưới balo 16x16, xoay được. */
  size: z.object({ w: z.int().min(1).max(16), h: z.int().min(1).max(16) }),
  weightKg: z.number().positive(),
  /** Giá khởi điểm, sẽ cân bằng qua playtest. */
  price: z.int().nonnegative(),
  tags: z.array(id).min(1),
  /** Móc câu cho AI dựng cảnh. */
  hooks: z.array(z.string().min(1)),
  /** Đồ chỉ nhặt được trên đảo (rơi từ thú, chặt cây...), cửa hàng không bán. */
  loot: z.boolean().optional(),
  /** Cầm trên tay đánh gần: sát thương, tầm với (m), hồi chiêu (giây), hiệu ứng lên người trúng (giây). */
  melee: HitSchema().extend({ reach: z.number().positive().max(4), cooldown: z.number().positive() }).optional(),
  /** Bắn xa (súng, ná): trúng thứ đầu tiên trên đường ngắm trong tầm. */
  ranged: HitSchema().extend({ range: z.number().positive().max(60), cooldown: z.number().positive() }).optional(),
  /** Ném đi được và gây hệ quả khi trúng. `breaks`: vỡ luôn khi chạm, không nằm lại dưới đất. */
  throw: HitSchema().extend({ breaks: z.boolean().optional() }).optional(),
  /** Sức chặt cây mỗi nhát (không có thì chặt bằng tay không, rất chậm). */
  chop: z.int().positive().optional(),
  /** Ăn, uống hoặc dùng ngay (hết món). */
  eat: z
    .object({ hunger: z.int(), hp: z.int(), morale: z.int(), stamina: z.int(), dizzy: z.number().positive() })
    .partial()
    .optional(),
  /** Trồng xuống đất thành cây. */
  plant: z.enum(["palm", "broadleaf"]).optional(),
  /** Vật liệu dựng nhà. */
  build: z.boolean().optional(),
  /** Bộ lửa trại: đặt xuống là dời trại tới đó. */
  camp: z.boolean().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

const Outcome = z
  .object({
    hp: z.int(),
    morale: z.int(),
    hunger: z.int(),
    stamina: z.int(),
    lostUntilDusk: z.boolean(),
    loseRandomItem: z.int().positive(),
    gainItem: id,
    food: z.int(),
    treasure: z.int(),
    hull: z.int(),
    setFlag: id,
  })
  .partial()
  .strict();

const Check = z.object({
  stat: z.enum(STAT_IDS),
  dc: z.int().min(1).max(40),
  itemBonus: z.record(id, z.int()).optional(),
});

export const EventCardSchema = z.object({
  id,
  title: z.string().min(1),
  /** Lời văn mẫu, dùng khi chưa có hoặc lỗi AI. */
  intro: z.string().min(1),
  acts: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).min(1),
  anchorType: id,
  requires: z
    .object({
      zone: z.enum(ZONE_IDS).optional(),
      weather: z.array(z.enum(WEATHER_IDS)).optional(),
      flags: z.array(id).optional(),
      notFlags: z.array(id).optional(),
    })
    .optional(),
  choices: z
    .array(
      z.object({
        id,
        label: z.string().min(1),
        check: Check,
        onSuccess: Outcome,
        onFail: Outcome,
        successText: z.string().min(1),
        failText: z.string().min(1),
      }),
    )
    .min(2)
    .max(4),
  sceneState: z.object({ onAny: id }).optional(),
  narrativeHooks: z.array(z.string().min(1)),
});
export type EventCard = z.infer<typeof EventCardSchema>;

// Bảo đảm dữ liệu đã kiểm tra khớp với kiểu mà engine luật dùng.
type Assignable<T extends U, U> = T;
export type _CardMatchesRules = Assignable<EventCard, RulesEventCard>;

export const STORY_CATEGORIES = [
  "hider",
  "motive",
  "treasure",
  "secret",
  "npc",
  "omen",
  "twist",
  "relic",
  "atmosphere",
  "weather",
  "epilogue",
  "bond",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];

/** Một yếu tố truyện: bộ sinh chọn theo seed rồi trộn với sự thật trong ván. */
export const StoryElementSchema = z.object({
  id,
  category: z.enum(STORY_CATEGORIES),
  /** Cụm danh từ để chèn vào câu, vd. "thuyền trưởng Hắc Triều". */
  name: z.string().min(1).nullable(),
  lines: z.array(z.string().min(1)).min(1),
  tags: z.array(id),
  /** Chỉ chọn được nếu một yếu tố đã chọn trước (người giấu) có ít nhất một thẻ trong đây. */
  requiresAnyTag: z.array(id).optional(),
  act: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  zone: z.enum(ZONE_IDS).optional(),
  weather: z.enum(WEATHER_IDS).optional(),
  /** Lời kết dành cho kết thúc nào ("*" là dùng cho mọi kết thúc). */
  ending: z.string().optional(),
});
export type StoryElement = z.infer<typeof StoryElementSchema>;

/** Mẫu câu ghép truyện: mỗi khóa có nhiều biến thể, bộ sinh chọn theo seed. */
export const StoryTemplatesSchema = z.record(z.string(), z.array(z.string().min(1)).min(1));
export type StoryTemplates = z.infer<typeof StoryTemplatesSchema>;
