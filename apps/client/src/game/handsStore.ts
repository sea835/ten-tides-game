import { useSyncExternalStore } from "react";
import { Messages } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

// Món mình đang cầm trên tay (uid trong balo). Thanh đồ nghề đổi, điều khiển đọc; mỗi lần đổi báo server
// để mọi người thấy món đó trên tay mình.

let uid = "";
const listeners = new Set<() => void>();

export function getHands(): string {
  return uid;
}

export function setHands(room: IslandRoom, next: string) {
  if (next === uid) return;
  uid = next;
  room.send(Messages.hold, { uid: next });
  listeners.forEach((l) => l());
}

export function useHands(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => uid,
  );
}
