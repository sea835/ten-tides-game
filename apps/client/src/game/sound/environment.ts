import { raycastBoxes, type BattleMap } from "@tentides/content";
import { PROBE_DIRS, PROBE_REACH, classifyEnvironment, type Acoustic } from "./acoustics.ts";

// Ước lượng môi trường âm thanh quanh một điểm trên bản đồ đấu súng (phố, đồi trống, rừng, trong nhà) bằng vài tia
// dò khối nhà, đếm cây và so độ cao địa hình. Kết quả nhớ theo ô lưới 6 m (và tầng 4 m) nên mỗi ô chỉ dò một lần
// (làm mới sau ít giây vì tường có thể bị phá).

export interface AcousticCell {
  kind: Acoustic;
  /** Khoảng cách tới vách theo từng hướng (xem PROBE_DIRS), Infinity nếu không có. */
  walls: Float32Array;
}

const CELL = 6;
const FLOOR = 4;
/** Ô cũ hơn chừng này giây thì dò lại (tường, nhà có thể đã sập). */
const TTL = 15;
const MAX_CELLS = 2048;

let getMap: (() => BattleMap | null) | null = null;
let cacheMap: BattleMap | null = null;
const cache = new Map<number, { cell: AcousticCell; at: number }>();

/** Gắn bản đồ hiện tại (gọi khi vào trận; null khi rời). */
export function setAcousticMap(get: (() => BattleMap | null) | null) {
  getMap = get;
}

const origin: [number, number, number] = [0, 0, 0];
const dir: [number, number, number] = [0, 0, 0];
const UP: readonly [number, number, number] = [0, 1, 0];

function probe(map: BattleMap, x: number, y: number, z: number): AcousticCell {
  const world = map.world;
  const ground = world.heightAt(x, z);
  // Dò ở tầm tai (tối thiểu 1,4 m trên mặt đất).
  origin[0] = x;
  origin[1] = Math.max(y, ground + 1.4);
  origin[2] = z;
  const walls = new Float32Array(PROBE_DIRS);
  for (let k = 0; k < PROBE_DIRS; k++) {
    const a = (k / PROBE_DIRS) * Math.PI * 2;
    dir[0] = Math.cos(a);
    dir[1] = 0;
    dir[2] = Math.sin(a);
    walls[k] = raycastBoxes(map.index, origin, dir, PROBE_REACH);
  }
  const roof = raycastBoxes(map.index, origin, UP, 12);
  let trees = 0;
  const list = world.trees;
  for (let i = 0; i < list.length; i++) {
    if (map.treeDead?.[i]) continue;
    const t = list[i]!;
    const dx = t.x - x;
    const dz = t.z - z;
    if (dx * dx + dz * dz < 225) trees++;
  }
  let around = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    around += world.heightAt(x + Math.cos(a) * 35, z + Math.sin(a) * 35);
  }
  const rise = ground - around / 8;
  return { kind: classifyEnvironment({ walls, roof, trees, rise }), walls };
}

/** Môi trường quanh điểm (x, y, z), hoặc null khi chưa có bản đồ (ngoài trận). Lỗi gì cũng trả null. */
export function acousticAt(x: number, y: number, z: number): AcousticCell | null {
  try {
    const map = getMap?.() ?? null;
    if (!map) return null;
    if (map !== cacheMap) {
      cache.clear();
      cacheMap = map;
    }
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    const gy = Math.floor(y / FLOOR);
    const key = ((gx + 512) * 1024 + (gz + 512)) * 256 + ((gy + 64) & 255);
    const now = performance.now() / 1000;
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL) return hit.cell;
    if (cache.size >= MAX_CELLS) cache.clear();
    // Dò ở chính điểm đầu tiên hỏi tới ô (tâm ô có thể nằm trong tường); các điểm khác trong ô dùng chung kết quả.
    const cell = probe(map, x, y, z);
    cache.set(key, { cell, at: now });
    return cell;
  } catch {
    return null;
  }
}
