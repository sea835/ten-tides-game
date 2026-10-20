import { useEffect, useRef, useState } from "react";
import { peekInvite, takeInvite } from "../net.ts";

/**
 * Link mời (?join=MÃ): trả về mã phòng đang chờ vào. Có tên rồi (đã nhập hay đăng nhập) và tài khoản đã nạp xong thì tự
 * vào phòng một lần; chưa có tên thì ô mã đã điền sẵn và người chơi nhập tên rồi bấm Vào phòng. Hết một lần dùng.
 * Phiên đang dở (F5 giữa trận) do App nối lại trước; nối được thì App bỏ mã mời, không tự vào phòng khác.
 */
export function useInvite({ ready, name, onJoin }: { ready: boolean; name: string; onJoin: (code: string) => void }): string | null {
  const [code] = useState(peekInvite);
  const done = useRef(false);
  useEffect(() => {
    if (!code || done.current || !ready || !name.trim()) return;
    done.current = true;
    takeInvite();
    onJoin(code);
  }, [code, ready, name, onJoin]);
  return code;
}
