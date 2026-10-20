// IP của người gọi, để giới hạn tần suất (đăng nhập, quay gacha, dò mã phòng). Server chạy sau proxy của Render nên
// socket.remoteAddress là địa chỉ của proxy, mọi người dùng chung một xô; phải đọc X-Forwarded-For. Nhưng header đó do
// bất kỳ ai tự gắn được: chỉ tin khi chắc chắn có proxy của mình đứng trước, và chỉ tin những mục do proxy của mình
// thêm vào (từ bên phải sang), không bao giờ tin mục ngoài cùng bên trái.

export interface ProxyTrust {
  /** Có proxy đáng tin đứng trước không. */
  trusted: boolean;
  /**
   * Số mục bên phải X-Forwarded-For là do proxy của mình thêm (mỗi tầng proxy thêm địa chỉ của tầng trước nó vào cuối
   * danh sách). IP người dùng là mục thứ `hops` tính từ bên phải: 1 là mục cuối (một tầng proxy), 2 là mục sát cuối
   * (hai tầng, vd. Cloudflare rồi tới bộ cân bằng tải của Render, mục cuối là địa chỉ Cloudflare)...
   */
  hops: number;
}

/**
 * TRUST_PROXY=1 (hay =0 để tắt hẳn), không đặt thì tự bật khi chạy trên Render (có biến RENDER). TRUST_PROXY_HOPS
 * chỉnh số tầng (mặc định 2 trên Render, 1 nơi khác): xem `ProxyTrust.hops`.
 */
export function proxyTrust(env: NodeJS.ProcessEnv = process.env): ProxyTrust {
  const flag = env.TRUST_PROXY;
  const trusted = flag !== undefined ? flag === "1" || flag.toLowerCase() === "true" : !!env.RENDER;
  const hops = Math.max(1, Math.floor(Number(env.TRUST_PROXY_HOPS ?? (env.RENDER ? 2 : 1))) || 1);
  return { trusted, hops };
}

type Headers = Record<string, string | string[] | undefined> | { get(name: string): string | null };

function header(headers: Headers, name: string): string {
  if (typeof (headers as { get?: unknown }).get === "function") return (headers as { get(n: string): string | null }).get(name) ?? "";
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v.join(",") : (v ?? "");
}

/**
 * IP của người gọi. Có proxy đáng tin thì lấy từ X-Forwarded-For (mục thứ `hops` từ bên phải; ít mục hơn số tầng thì
 * lấy mục đầu, tức không bao giờ lấy ra ngoài danh sách); không thì dùng địa chỉ socket. Không biết thì "?".
 */
export function clientIp(headers: Headers, remoteAddress: string | undefined, trust: ProxyTrust = proxyTrust()): string {
  if (trust.trusted) {
    const list = header(headers, "x-forwarded-for")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (list.length) return list[Math.max(0, list.length - trust.hops)]!;
  }
  return remoteAddress ?? "?";
}
