import { mapForMode, worldFor, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Thế giới của phòng: sinh từ seed thế giới trong state (đảo nhỏ, hang, hầm, easter egg, bãi sinh vật).
// Mọi máy cùng seed dựng ra cùng một bản đồ; chủ phòng đổi seed ở sảnh chờ thì cảnh dựng lại.

// Phòng Battleground dùng bản đồ riêng (battle.ts): đảo lớn, thành phố, cảng, pháo đài...

/** `battleMode`: chiến trường 50 vs 50 dùng bản đồ riêng (rộng hơn, có cứ điểm). */
export function worldOf(mode: string, seed: number, battleMode = "solo"): World {
  return mode === "battle" ? mapForMode(battleMode, seed || 1).world : worldFor(seed || 1);
}

export function currentWorld(room: IslandRoom): World {
  return worldOf(room.state.mode, room.state.worldSeed, room.state.battleMode);
}

export function useWorld(room: IslandRoom): World {
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const mode = useRoomSnapshot(room, (s) => s.mode);
  const battleMode = useRoomSnapshot(room, (s) => (s.battleMode === "war" ? "war" : "solo"));
  return worldOf(mode, seed, battleMode);
}
