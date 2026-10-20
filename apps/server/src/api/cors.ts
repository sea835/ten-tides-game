// CORS: danh sách origin được phép lấy từ CORS_ORIGINS (cách nhau dấu phẩy, vd. "https://tentides.vercel.app,
// https://*.vercel.app"). Không đặt thì giữ như cũ (phản chiếu mọi origin) để bản đang chạy khỏi hỏng, nhưng cảnh báo
// lúc khởi động. Một mục có thể có `*` thay cho một đoạn tên miền con.

export type Allowlist = RegExp[] | null;

/** Đọc CORS_ORIGINS; null nếu không đặt (cho phép mọi origin). */
export function parseOrigins(raw: string | undefined): Allowlist {
  const list = (raw ?? "")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (!list.length) return null;
  return list.map((o) => new RegExp(`^${o.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+(?:\\.[a-z0-9-]+)*")}$`, "i"));
}

export const allowlist: Allowlist = parseOrigins(process.env.CORS_ORIGINS);

/** Giá trị Access-Control-Allow-Origin cho một request có `origin` (không có Origin: không phải trình duyệt gọi chéo). */
export function allowOrigin(origin: string | undefined, list: Allowlist = allowlist): string {
  if (!list) return origin ?? "*";
  if (origin && list.some((re) => re.test(origin))) return origin;
  // Origin lạ: trả "null" để trình duyệt chặn (không phản chiếu).
  return "null";
}

/** Gọi lúc khởi động: cảnh báo nếu đang cho phép mọi origin. */
export function logCorsMode(list: Allowlist = allowlist) {
  if (!list) console.warn("CORS_ORIGINS chưa đặt: đang cho phép mọi origin. Đặt CORS_ORIGINS=https://trang-cua-ban (cách nhau dấu phẩy) khi chạy thật.");
  else console.log(`CORS chỉ cho phép ${list.length} origin theo CORS_ORIGINS.`);
}
