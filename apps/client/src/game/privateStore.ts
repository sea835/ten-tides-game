import { useSyncExternalStore } from "react";
import { Messages, type PrivateMessage } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

// Thông tin riêng (vai, hành động đêm, ghi chú): server chỉ gửi cho đúng mình, không nằm trong state chung.

let current: PrivateMessage | null = null;
const listeners = new Set<() => void>();

export function listenPrivate(room: IslandRoom): () => void {
  current = null;
  const off = room.onMessage(Messages.private, (view: PrivateMessage) => {
    current = view;
    listeners.forEach((l) => l());
  });
  return () => {
    off();
    current = null;
  };
}

export function usePrivate(): PrivateMessage | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
