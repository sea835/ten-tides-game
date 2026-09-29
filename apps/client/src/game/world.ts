import { battleMap, worldFor, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Thế giới của phòng: sinh từ seed thế giới trong state (đảo nhỏ, hang, hầm, easter egg, bãi sinh vật).
// Mọi máy cùng seed dựng ra cùng một bản đồ; chủ phòng đổi seed ở sảnh chờ thì cảnh dựng lại.

// Phòng Battleground dùng bản đồ riêng (battle.ts): đảo lớn, thành phố, cảng, pháo đài...

export function worldOf(mode: string, seed: number): World {
  return mode === "battle" ? battleMap(seed || 1).world : worldFor(seed || 1);
}

export function currentWorld(room: IslandRoom): World {
  return worldOf(room.state.mode, room.state.worldSeed);
}

export function useWorld(room: IslandRoom): World {
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const mode = useRoomSnapshot(room, (s) => s.mode);
  return worldOf(mode, seed);
}
