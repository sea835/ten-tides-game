import { useCallback, useRef, useSyncExternalStore } from "react";
import type { IslandState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

/** So sánh sâu dữ liệu thường (số, chuỗi, mảng, object thuần) mà không phải dựng chuỗi JSON. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Đọc một phần state phòng cho React. `select` phải trả về dữ liệu thường (không phải object schema);
 * component chỉ render lại khi phần được chọn thật sự đổi.
 */
export function useRoomSnapshot<T>(room: IslandRoom, select: (state: IslandState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const cache = useRef<{ value: T } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      room.onStateChange(onChange);
      return () => room.onStateChange.remove(onChange);
    },
    [room],
  );

  const getSnapshot = () => {
    const value = selectRef.current(room.state);
    // Giữ nguyên tham chiếu cũ khi nội dung không đổi (useSyncExternalStore so bằng Object.is).
    if (!cache.current || !same(cache.current.value, value)) cache.current = { value };
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
