import { useCallback, useRef, useSyncExternalStore } from "react";
import type { IslandState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

/**
 * Đọc một phần state phòng cho React. `select` phải trả về dữ liệu thường (không phải object schema);
 * component chỉ render lại khi phần được chọn thật sự đổi.
 */
export function useRoomSnapshot<T>(room: IslandRoom, select: (state: IslandState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const cache = useRef<{ json: string; value: T } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      room.onStateChange(onChange);
      return () => room.onStateChange.remove(onChange);
    },
    [room],
  );

  const getSnapshot = () => {
    const value = selectRef.current(room.state);
    const json = JSON.stringify(value);
    if (cache.current?.json !== json) cache.current = { json, value };
    return cache.current.value;
  };

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function isBusy(state: IslandState, playerId: string): boolean {
  for (const anchor of state.anchors.values()) {
    if (anchor.status === "active" && [...anchor.participants].includes(playerId)) return true;
  }
  return false;
}
