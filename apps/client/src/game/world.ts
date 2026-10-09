import { mapForMode, worldFor, type BattleMap, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Thế giới của phòng: sinh từ seed thế giới trong state (đảo nhỏ, hang, hầm, easter egg, bãi sinh vật).
// Mọi máy cùng seed dựng ra cùng một bản đồ; chủ phòng đổi seed ở sảnh chờ thì cảnh dựng lại.

// Phòng Battleground dùng bản đồ riêng (battle.ts): đảo lớn, thành phố, cảng, pháo đài...

/**
 * Khoá bản đồ Battleground của phòng: "solo" (đảo sinh tồn, cả chế độ đồng đội) hay "war:<mã bản đồ>" (chiến
 * trường 50 vs 50 theo bản đồ chủ phòng chọn) hay "naval" (biển hải chiến 3 vs 3). Đổi khoá là phải dựng lại cảnh.
 */
export function mapKeyOf(s: { battleMode: string; settings: { warMap: string } }): string {
  return s.battleMode === "war" ? `war:${s.settings.warMap}` : s.battleMode === "naval" ? "naval" : "solo";
}

/** Bản đồ Battleground theo khoá (mapKeyOf) và seed. */
export function mapOfKey(key: string, seed: number): BattleMap {
  if (key === "naval") return mapForMode("naval", seed || 1);
  return key.startsWith("war") ? mapForMode("war", seed || 1, key.slice(4)) : mapForMode("solo", seed || 1);
}

/** `key`: khoá bản đồ Battleground (mapKeyOf); chiến trường 50 vs 50 dùng bản đồ riêng (rộng hơn, có cứ điểm). */
export function worldOf(mode: string, seed: number, key = "solo"): World {
  return mode === "battle" ? mapOfKey(key, seed).world : worldFor(seed || 1);
}

export function currentWorld(room: IslandRoom): World {
  return worldOf(room.state.mode, room.state.worldSeed, mapKeyOf(room.state));
}

/** Khoá bản đồ Battleground của phòng (đổi khi chủ phòng đổi chế độ, bản đồ). */
export function useMapKey(room: IslandRoom): string {
  return useRoomSnapshot(room, (s) => mapKeyOf(s));
}

export function useWorld(room: IslandRoom): World {
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const mode = useRoomSnapshot(room, (s) => s.mode);
  const key = useMapKey(room);
  return worldOf(mode, seed, key);
}
