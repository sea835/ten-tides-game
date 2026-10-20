import { useSyncExternalStore } from "react";
import type { RewardMessage } from "@tentides/protocol";

// Thưởng hết trận của mình (server gửi Messages.reward sau khi ghi vào tài khoản: xu thực nhận, giới hạn ngày, thử
// thách vừa xong). BattleProgress ghi vào đây, màn vinh danh cuối trận đọc ra. Khách không nhận gì (null).

let current: RewardMessage | null = null;
const listeners = new Set<() => void>();

export function noteReward(m: RewardMessage) {
  current = m;
  for (const l of listeners) l();
}

/** Sang trận mới (về sảnh, chuẩn bị): xoá thưởng cũ. */
export function resetMatchReward() {
  if (!current) return;
  current = null;
  for (const l of listeners) l();
}

export function useMatchReward(): RewardMessage | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
