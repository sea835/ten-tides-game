// Thủy triều của chế độ sinh tồn: mặt biển dâng hạ 2,5 m theo giờ trong ngày. Không thêm trường nào vào state:
// mọi máy (server và client) suy ra giờ trong ngày từ pha hiện tại và số giây còn lại của pha, rồi ra mực nước.
// Triều rút vào giữa buổi khám phá (lộ rạn san hô, xác tàu đắm, cửa hang ngầm), triều cường lúc nửa đêm (ngập bãi
// cát, ai còn ở sát mép nước phải lên chỗ cao). Battleground không có thủy triều: mực nước luôn là WATER_LEVEL.

import type { EncounterEffects } from "@tentides/rules";
import { CAMP, MAP_HALF_SIZE, WATER_LEVEL, shoreRadius } from "./island.ts";
import { makeRand, subSeed, type World } from "./worldgen.ts";

/** Biên độ triều: từ đỉnh triều cường xuống đáy triều rút đúng 2,5 m. */
export const TIDE_RANGE = 2.5;
export const TIDE_AMPLITUDE = TIDE_RANGE / 2;
/** Mực nước trung bình hạ hơn mốc một chút để triều cường không tràn vào trại mặc định (cao chừng 1,2 m). */
export const TIDE_MEAN = WATER_LEVEL - 0.3;
export const TIDE_HIGH = TIDE_MEAN + TIDE_AMPLITUDE;
export const TIDE_LOW = TIDE_MEAN - TIDE_AMPLITUDE;
/** Giờ trong ngày (0–1) lúc triều lên cao nhất; thấp nhất là nửa ngày sau đó. */
export const TIDE_HIGH_AT = 0.9;
/** Các pha có thủy triều (lúc ở sảnh, tạo nhân vật, soạn đồ thì biển đứng yên ở mốc). */
export const TIDAL_PHASES: readonly string[] = ["dawn", "explore", "dusk", "night"];

/** Mặt trời lặn vào lúc này trong ngày (0–1); phần sau là đêm. */
const SUNSET = 0.82;

/** Giờ trong ngày (0–1) suy ra từ pha hiện tại và thời gian còn lại của pha (đồng hồ mặt trời dùng chung). */
export function dayTime(phase: string, remaining: number, duration: number): number {
  const p = duration > 0 ? Math.min(1, Math.max(0, 1 - remaining / duration)) : 0;
  switch (phase) {
    case "dawn":
      return 0.02 + 0.08 * p;
    case "explore":
      return 0.1 + 0.62 * p;
    case "dusk":
      return 0.72 + 0.1 * p;
    case "night":
      return SUNSET + (1 - SUNSET) * p;
    default:
      return 0.35;
  }
}

/** Mực nước biển ở giờ `time` (0–1) trong ngày: một nhịp cos trơn, nối liền từ đêm sang bình minh hôm sau. */
export function tideAt(time: number): number {
  return TIDE_MEAN + TIDE_AMPLITUDE * Math.cos(2 * Math.PI * (time - TIDE_HIGH_AT));
}

export interface TideClock {
  mode: string;
  phase: string;
  timeLeft: number;
  phaseDuration: number;
}

/**
 * Mực nước biển lúc này của phòng chơi. `remaining` cho client nội suy giữa hai nhịp giây của `timeLeft`.
 * Battleground và các pha không có triều trả về WATER_LEVEL.
 */
export function seaLevel(s: TideClock, remaining: number = s.timeLeft): number {
  if (s.mode !== "story" || !TIDAL_PHASES.includes(s.phase)) return WATER_LEVEL;
  return tideAt(dayTime(s.phase, remaining, s.phaseDuration));
}

/** Triều đang lên hay xuống (để HUD báo "triều lên", "triều rút"). */
export function tideRising(s: TideClock, remaining: number = s.timeLeft): boolean {
  if (s.mode !== "story" || !TIDAL_PHASES.includes(s.phase)) return false;
  const t = dayTime(s.phase, remaining, s.phaseDuration);
  return Math.sin(2 * Math.PI * (t - TIDE_HIGH_AT)) < 0;
}

// ---------------------------------------------------------------------------
// Những chỗ chỉ lộ ra khi triều rút
// ---------------------------------------------------------------------------

export interface TidalSite {
  id: string;
  /** wreck: cổ vật trong xác tàu đắm · cave: rương trong cửa hang ngầm · reef: cổ vật mắc trên rạn san hô. */
  kind: "wreck" | "cave" | "reef";
  x: number;
  /** Độ cao đáy chỗ đó: nước rút xuống dưới mức này (cộng chút lội) mới với tới. */
  y: number;
  z: number;
  /** Hướng của xác tàu, cửa hang (radian), cho client dựng mô hình. */
  rot: number;
  name: string;
  text: string;
  effects: EncounterEffects;
}

/** Nước còn ngập chừng này trên đáy vẫn lội vào lục lọi được. */
export const TIDAL_WADE = 0.25;

/** Chỗ này lúc mực nước là `sea` đã lộ ra (hay chỉ còn ngập mắt cá) chưa. */
export function tidalOpen(site: Pick<TidalSite, "y">, sea: number): boolean {
  return sea <= site.y + TIDAL_WADE;
}

/** Xác tàu, cửa hang nằm trên thềm cát ở độ sâu này (so với mốc): lộ ra khoảng một phần ba buổi khám phá. */
const SHELF_TOP = -0.95;
const SHELF_BOTTOM = -1.35;

const WRECK_LOOT: readonly { name: string; text: string; effects: EncounterEffects }[] = [
  { name: "Hòm la bàn của thuyền trưởng", text: "Dưới lớp hà bám, chiếc la bàn đồng vẫn chỉ đúng hướng bắc.", effects: { gainItem: "compass", treasure: 3 } },
  { name: "Rương bùa hộ mệnh", text: "Chiếc bùa ngà kẹt giữa hai tấm ván mục, lấp lánh khi nước rút.", effects: { gainItem: "amulet", treasure: 4, morale: 4 } },
  { name: "Ống nhòm của hoa tiêu", text: "Ống nhòm bọc da cá đuối, kính vẫn còn trong vắt.", effects: { gainItem: "spyglass", treasure: 3 } },
];

/** Tìm một điểm trên thềm cát quanh đảo chính, hướng `angle`, có độ sâu trong khoảng [SHELF_BOTTOM, SHELF_TOP]. */
function shelfPoint(world: World, angle: number): { x: number; y: number; z: number } | null {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const shore = shoreRadius(dx * 100, dz * 100);
  for (let r = shore - 2; r < shore + 30; r += 0.5) {
    const x = dx * r;
    const z = dz * r;
    const h = world.heightAt(x, z);
    if (h > SHELF_TOP) continue;
    if (h < SHELF_BOTTOM || world.structureAt(x, z) || world.surface(x, z).islet) return null;
    return { x, y: h, z };
  }
  return null;
}

/** Cổ vật xác tàu nằm lệch khỏi trục thân tàu chừng này mét về phía biển. */
export const WRECK_LOOT_OFFSET = 1.8;

const cache = new WeakMap<World, readonly TidalSite[]>();

/**
 * Những chỗ chỉ với tới khi triều rút, theo seed thế giới (mọi máy ra giống nhau): một xác tàu đắm với ba món cổ vật,
 * một cửa hang ngầm có rương, và cổ vật mắc trên đỉnh vài rạn san hô. Bản đồ Battleground không có.
 */
export function tidalSites(world: World): readonly TidalSite[] {
  const cached = cache.get(world);
  if (cached) return cached;
  const out: TidalSite[] = [];
  if (world.kind !== "battle") {
    const rand = makeRand(subSeed(world.seed, "tide"));
    // Tránh phía nam (bến thuyền, trại mặc định): góc của trại so với tâm đảo.
    const campAngle = Math.atan2(CAMP.z, CAMP.x);
    const farFromCamp = (a: number) => Math.abs(Math.atan2(Math.sin(a - campAngle), Math.cos(a - campAngle))) > 0.6;
    const place = (kind: "wreck" | "cave") => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const a = rand() * Math.PI * 2;
        if (!farFromCamp(a)) continue;
        const at = shelfPoint(world, a);
        if (!at) continue;
        if (out.some((s) => Math.hypot(s.x - at.x, s.z - at.z) < 40)) continue;
        return { ...at, rot: a };
      }
      return null;
    };
    const wreck = place("wreck");
    if (wreck) {
      // Xác tàu nằm dọc bờ; ba món cổ vật rải dọc thân tàu.
      // Cổ vật nằm dọc mạn tàu phía biển (khỏi bị thân tàu che).
      const along = { x: -Math.sin(wreck.rot), z: Math.cos(wreck.rot) };
      const seaward = { x: Math.cos(wreck.rot) * WRECK_LOOT_OFFSET, z: Math.sin(wreck.rot) * WRECK_LOOT_OFFSET };
      WRECK_LOOT.forEach((loot, k) => {
        const off = (k - 1) * 2.6;
        const x = wreck.x + along.x * off + seaward.x;
        const z = wreck.z + along.z * off + seaward.z;
        out.push({ id: `tide_wreck_${k}`, kind: "wreck", x, y: Math.max(wreck.y - 0.25, world.heightAt(x, z)), z, rot: wreck.rot, ...loot });
      });
    }
    const cave = place("cave");
    if (cave) {
      out.push({
        id: "tide_cave",
        kind: "cave",
        ...cave,
        name: "Rương trong hang ngầm",
        text: "Triều rút để lộ cửa hang ngầm. Trong hốc đá khô có chiếc rương nhỏ của dân buôn lậu.",
        effects: { gainItem: "crystal_shard", treasure: 5, morale: 3 },
      });
    }
    // Cổ vật trên đỉnh rạn: chỗ cao nhất của mỗi rạn (dò lưới), chỉ lấy rạn nào triều rút thì đỉnh nhô lên được.
    for (const reef of world.reefs.slice(0, 3)) {
      let best = { x: reef.x, y: -Infinity, z: reef.z };
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          const x = reef.x + (i / 4) * reef.radius * 0.6;
          const z = reef.z + (j / 4) * reef.radius * 0.6;
          const h = world.heightAt(x, z);
          if (h > best.y) best = { x, y: h, z };
        }
      }
      const half = world.half ?? MAP_HALF_SIZE;
      if (best.y < -1.5 || best.y > SHELF_TOP + 0.6 || Math.abs(best.x) > half - 5 || Math.abs(best.z) > half - 5) continue;
      out.push({
        id: `tide_${reef.id}`,
        kind: "reef",
        ...best,
        rot: 0,
        name: "Cổ vật trên rạn san hô",
        text: "Một chiếc bình gốm cổ kẹt giữa các nhánh san hô, chỉ với tới được khi triều rút cạn.",
        effects: { treasure: 5, morale: 3 },
      });
    }
  }
  cache.set(world, out);
  return out;
}
