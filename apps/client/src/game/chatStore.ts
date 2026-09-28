import { useSyncExternalStore } from "react";
import { Messages, type ChatBroadcast } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

// Tin nhắn chat không nằm trong state đồng bộ: server chỉ gửi cho đúng người được nghe,
// nên client tự giữ lại để hiện trong khung chat và bong bóng trên đầu nhân vật.

export interface ChatLine extends ChatBroadcast {
  id: number;
  at: number;
}

const MAX_LINES = 60;
let lines: ChatLine[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function listenChat(room: IslandRoom): () => void {
  lines = [];
  const off = room.onMessage(Messages.chat, (m: ChatBroadcast) => {
    lines = [...lines.slice(-(MAX_LINES - 1)), { ...m, id: nextId++, at: performance.now() }];
    listeners.forEach((l) => l());
  });
  return () => {
    off();
    lines = [];
  };
}

export function getChat(): readonly ChatLine[] {
  return lines;
}

export function useChat(): readonly ChatLine[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lines,
  );
}
