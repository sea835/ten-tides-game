import { worldFor, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Thế giới của phòng: sinh từ seed thế giới trong state (đảo nhỏ, hang, hầm, easter egg, bãi sinh vật).
// Mọi máy cùng seed dựng ra cùng một bản đồ; chủ phòng đổi seed ở sảnh chờ thì cảnh dựng lại.

export function currentWorld(room: IslandRoom): World {
  return worldFor(room.state.worldSeed || 1);
}

export function useWorld(room: IslandRoom): World {
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  return worldFor(seed || 1);
}
