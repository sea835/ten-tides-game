import { useCallback, useRef, useSyncExternalStore } from "react";
import type { IslandState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";

/**
 * Đọc một phần state phòng cho React. `select` phải trả về dữ liệu thường (không phải object schema);
 * component chỉ render lại khi phần được chọn thật sự đổi.
 *
 * `getSnapshot` chạy mỗi lần render *và* mỗi lần state đổi, mà client có ~34 chỗ gọi, nên so
 * sánh bằng `JSON.stringify` mỗi lần là tốn kém và lặp lại nhiều. Ở đây ta cache theo hai tầng:
 *  1. chữ ký rẻ của state (đếm Map/Set + các trường vảy) — nếu không đổi thì trả lại đúng kết quả
 *     cũ mà không gọi `select` lẫn không stringify;
 *  2. nếu chữ ký đã đổi thì mới gọi `select` và so sánh nội dung kết quả để quyết định có render
 *     lại không (giữ lại object cũ nếu nội dung tương đương, để `useSyncExternalStore` ổn định).
 */
export function useRoomSnapshot<T>(room: IslandRoom, select: (state: IslandState) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  // Tầng 1: chữ ký state + kết quả tương ứng.
  const bySig = useRef<{ sig: string; value: T } | null>(null);
  // Tầng 2: kết quả đã xác nhận là khác lần trước, kèm chuỗi so sánh nội dung.
  const last = useRef<{ json: string; value: T } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      room.onStateChange(onChange);
      return () => room.onStateChange.remove(onChange);
    },
    [room],
  );

  const getSnapshot = () => {
    const state = room.state;
    const sig =
      `${state.phase}|${state.mode}|${state.clock}|${state.campX}|${state.campZ}|` +
      `${state.treasureSite}|${state.treasureDug}|${state.stumps.length}|${state.plants.size}|${state.buildings.size}|` +
      `${state.players.size}|${state.anchors.size}|${state.groundItems.size}|${state.discovered.length}|${state.traps.size}`;
    if (bySig.current?.sig === sig) return bySig.current.value;

    const value = selectRef.current(state);
    const json = JSON.stringify(value ?? null);
    // Nội dung tương đương thì giữ object cũ: useSyncExternalStore so sánh tham chiếu, trả object
    // mới sẽ khiến component render lại dù dữ liệu không đổi.
    const out = last.current?.json === json ? last.current.value : value;
    last.current = { json, value: out };
    bySig.current = { sig, value: out };
    return out;
  };

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function isBusy(state: IslandState, playerId: string): boolean {
  for (const anchor of state.anchors.values()) {
    if (anchor.status === "active" && [...anchor.participants].includes(playerId)) return true;
  }
  return false;
}
