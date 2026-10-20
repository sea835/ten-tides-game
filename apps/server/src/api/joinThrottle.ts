import { ServerError, matchMaker } from "@colyseus/core";
import { clientIp, proxyTrust } from "./clientIp.ts";
import { RateLimiter } from "./rateLimit.ts";

// Mã phòng chỉ 4 ký tự (~923 nghìn tổ hợp) để dễ gõ; đổi lại phải chặn dò mã hàng loạt. Mỗi IP chỉ được thất bại một số
// lần vào phòng theo mã mỗi phút (mã sai, phòng khoá, phòng đầy, bị mời ra...); quá hạn mức thì mọi lần thử tiếp đều bị từ
// chối ngay, kể cả mã đúng, cho tới khi hết phút. Lần vào thành công không bị tính.

/** Số lần vào theo mã thất bại tối đa mỗi phút mỗi IP. */
export const JOIN_FAIL_LIMIT = 20;

type AuthContext = { ip?: string; headers?: { get(name: string): string | null } };

/** Gắn bộ chặn vào cổng matchmaking của Colyseus (joinById đi qua `controller.invokeMethod`). */
export function installJoinThrottle(limiter = new RateLimiter(JOIN_FAIL_LIMIT, 60_000)) {
  const controller = matchMaker.controller;
  const original = controller.invokeMethod.bind(controller);
  const trust = proxyTrust();
  controller.invokeMethod = async (method: string, roomName: string, clientOptions?: unknown, authOptions?: unknown) => {
    if (method !== "joinById") return original(method, roomName, clientOptions as never, authOptions as never);
    // Không tin `ip` do Colyseus suy ra (lấy mục đầu X-Forwarded-For, ai cũng giả được): tự tính theo luật của mình.
    const ctx = (authOptions ?? {}) as AuthContext;
    const key = ctx.headers ? clientIp(ctx.headers, undefined, trust) : "?";
    if (limiter.full(key)) throw new ServerError(429, "Thử quá nhiều mã phòng sai, đợi một phút rồi thử lại.");
    try {
      return await original(method, roomName, clientOptions as never, authOptions as never);
    } catch (err) {
      limiter.record(key);
      throw err;
    }
  };
}
