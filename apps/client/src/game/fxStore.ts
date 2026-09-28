import { useEffect, useRef } from "react";
import { Messages, type FxMessage } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

// Hiệu ứng server báo (trúng đòn, cây đổ, thú chết...): một chỗ nghe message, nhiều chỗ vẽ.

type Listener = (fx: FxMessage) => void;
const listeners = new Set<Listener>();

export function listenFx(room: IslandRoom): () => void {
  return room.onMessage(Messages.fx, (fx: FxMessage) => listeners.forEach((l) => l(fx)));
}

/** Gọi `callback` mỗi khi có hiệu ứng mới. */
export function useFx(callback: Listener) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const l: Listener = (fx) => ref.current(fx);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}
