import { z } from "zod";
import { STAT_IDS, type EncounterEffects } from "@tentides/rules";
import itemsJson from "./data/items.json" with { type: "json" };
import worldJson from "./data/world.json" with { type: "json" };

// Danh mục những thứ bộ sinh thế giới rải lên bản đồ theo seed: sinh vật, easter egg, điểm bất thường, bẫy.
// Chỉ là dữ liệu: vị trí do worldgen.ts chọn theo seed, hệ quả do engine luật áp khi server báo có chạm trán.

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "id chỉ gồm chữ thường, số và dấu gạch dưới");

/**
 * Nơi một thứ được đặt. Trên đảo chính: beach, forest, hilltop, volcano, lake (bờ hồ), palm (gốc dừa);
 * dưới nước: lake_bed, lake_water, shallows, reef, sea (nước sâu), seabed (đáy biển sâu);
 * đảo nhỏ: islet; trong lòng đất: cave, cave_deep, mine, mine_deep.
 */
export const HABITATS = [
  "beach",
  "forest",
  "hilltop",
  "volcano",
  "lake",
  "palm",
  "lake_bed",
  "lake_water",
  "shallows",
  "reef",
  "sea",
  "seabed",
  "islet",
  "cave",
  "cave_deep",
  "mine",
  "mine_deep",
] as const;
export type Habitat = (typeof HABITATS)[number];

export const EffectsSchema = z
  .object({
    hp: z.int().min(-40).max(40),
    morale: z.int().min(-40).max(40),
    hunger: z.int().min(-40).max(40),
    stamina: z.int().min(-60).max(60),
    food: z.int().min(-5).max(5),
    treasure: z.int().min(0).max(10),
    gainItem: id,
  })
  .partial()
  .strict();

/** Thái độ: thân thiện (lại gần được, tương tác được), trung tính (lảng tránh), nguy hiểm (tấn công khi tới gần). */
export const TEMPERS = ["friendly", "neutral", "hostile"] as const;
export type Temper = (typeof TEMPERS)[number];
/** Độ lạ: quen thuộc, lạ lùng, biến dị. Sinh vật càng lạ càng xuất hiện muộn, khi núi lửa đã thức. */
export const STRANGENESS = ["familiar", "strange", "mutant"] as const;
export type Strangeness = (typeof STRANGENESS)[number];

export const CreatureSchema = z.object({
  id,
  name: z.string().min(1),
  temper: z.enum(TEMPERS),
  strangeness: z.enum(STRANGENESS),
  habitats: z.array(z.enum(HABITATS)).min(1),
  /** Khóa mô hình 3D phía client. */
  model: id,
  /** Số con mỗi ván, chọn theo seed trong khoảng này. */
  count: z.tuple([z.int().min(0), z.int().min(1)]),
  /** Từ ngày này mới xuất hiện. */
  fromDay: z.int().min(1).max(10),
  /** Tốc độ lang thang (m/s). */
  speed: z.number().positive(),
  size: z.number().positive(),
  /** Bay ở độ cao này so với mặt đất (dơi). */
  fly: z.number().positive().optional(),
  /** Bán kính phát hiện người chơi: nguy hiểm thì lao tới, trung tính thì bỏ chạy. */
  aggro: z.number().positive().optional(),
  chaseSpeed: z.number().positive().optional(),
  attack: z.object({ effects: EffectsSchema, cooldown: z.number().positive() }).optional(),
  /** Người mang một trong những món này thì bị cắn nhẹ hơn và con vật bỏ chạy lâu hơn. */
  deterredBy: z.array(id).optional(),
  /** Sinh vật thân thiện: nhấn E để vuốt ve, mỗi người mỗi con một lần mỗi ngày. */
  interact: z.object({ effects: EffectsSchema, text: z.string().min(1) }).optional(),
  blurb: z.string().min(1),
});
export type Creature = z.infer<typeof CreatureSchema>;

export const PoiSchema = z.object({
  id,
  /** egg: easter egg, cố định; anomaly: điểm bất thường, kết quả do seed định sẵn (tốt hoặc xấu). */
  kind: z.enum(["egg", "anomaly"]),
  name: z.string().min(1),
  habitats: z.array(z.enum(HABITATS)).min(1),
  model: id,
  /** Chỉ xuất hiện trong đúng một ngày (chọn theo seed). */
  oneDay: z.boolean().optional(),
  effects: EffectsSchema.optional(),
  text: z.string().min(1).optional(),
  outcomes: z.array(z.object({ weight: z.number().positive(), effects: EffectsSchema, text: z.string().min(1) })).min(2).optional(),
});
export type PoiDef = z.infer<typeof PoiSchema>;

export const TrapSchema = z.object({
  id,
  name: z.string().min(1),
  habitats: z.array(z.enum(HABITATS)).min(1),
  model: id,
  effects: EffectsSchema,
  /** Thuộc tính giúp né bẫy: mỗi điểm thêm 8% cơ hội né. */
  dodge: z.enum(STAT_IDS),
  text: z.string().min(1),
  dodgeText: z.string().min(1),
});
export type TrapDef = z.infer<typeof TrapSchema>;

export const WorldCatalogSchema = z.object({
  creatures: z.array(CreatureSchema).min(1),
  pois: z.array(PoiSchema).min(1),
  traps: z.array(TrapSchema).min(1),
  names: z.object({
    islets: z.array(z.string().min(1)).min(8),
    caves: z.array(z.string().min(1)).min(4),
    mines: z.array(z.string().min(1)).min(3),
  }),
});

export interface WorldCatalog {
  creatures: ReadonlyMap<string, Creature>;
  pois: ReadonlyMap<string, PoiDef>;
  traps: ReadonlyMap<string, TrapDef>;
  names: { islets: readonly string[]; caves: readonly string[]; mines: readonly string[] };
}

// Bảo đảm hệ quả trong dữ liệu khớp đúng kiểu mà engine luật nhận.
type Assignable<T extends U, U> = T;
export type _EffectsMatchRules = Assignable<z.infer<typeof EffectsSchema>, EncounterEffects>;

/** Kiểm tra danh mục: id không trùng, mọi món đồ được nhắc tới đều có thật, easter egg và bất thường có đủ hệ quả. */
export function loadWorldCatalog(raw: unknown, itemIds: ReadonlySet<string>): WorldCatalog {
  const data = WorldCatalogSchema.parse(raw);
  const index = <T extends { id: string }>(kind: string, list: T[]) => {
    const map = new Map<string, T>();
    for (const entry of list) {
      if (map.has(entry.id)) throw new Error(`${kind} trùng id: ${entry.id}`);
      map.set(entry.id, entry);
    }
    return map;
  };
  const checkItems = (where: string, effects: z.infer<typeof EffectsSchema> | undefined) => {
    if (effects?.gainItem && !itemIds.has(effects.gainItem)) throw new Error(`${where}: tham chiếu đồ không tồn tại "${effects.gainItem}"`);
  };
  for (const c of data.creatures) {
    if (c.count[0] > c.count[1]) throw new Error(`Sinh vật ${c.id}: khoảng số lượng ngược`);
    if (c.temper === "hostile" && !c.attack) throw new Error(`Sinh vật ${c.id}: nguy hiểm mà không có đòn tấn công`);
    if (c.temper === "friendly" && !c.interact) throw new Error(`Sinh vật ${c.id}: thân thiện mà không tương tác được`);
    for (const item of c.deterredBy ?? []) if (!itemIds.has(item)) throw new Error(`Sinh vật ${c.id}: tham chiếu đồ không tồn tại "${item}"`);
    checkItems(`Sinh vật ${c.id}`, c.attack?.effects);
    checkItems(`Sinh vật ${c.id}`, c.interact?.effects);
  }
  for (const p of data.pois) {
    if (p.kind === "egg" && (!p.effects || !p.text)) throw new Error(`Easter egg ${p.id}: thiếu hệ quả hoặc lời kể`);
    if (p.kind === "anomaly" && !p.outcomes) throw new Error(`Điểm bất thường ${p.id}: thiếu các kết quả`);
    checkItems(`Điểm ${p.id}`, p.effects);
    for (const o of p.outcomes ?? []) checkItems(`Điểm ${p.id}`, o.effects);
  }
  for (const t of data.traps) checkItems(`Bẫy ${t.id}`, t.effects);
  return {
    creatures: index("Sinh vật", data.creatures),
    pois: index("Điểm bí mật", data.pois),
    traps: index("Bẫy", data.traps),
    names: data.names,
  };
}

export const worldCatalog: WorldCatalog = loadWorldCatalog(worldJson, new Set(itemsJson.map((i) => i.id)));

export const TEMPER_LABELS: Record<Temper, string> = { friendly: "Thân thiện", neutral: "Trung tính", hostile: "Nguy hiểm" };
export const STRANGENESS_LABELS: Record<Strangeness, string> = { familiar: "Quen thuộc", strange: "Lạ", mutant: "Biến dị" };
