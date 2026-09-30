import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Băm mật khẩu bằng scrypt (có sẵn trong node:crypto, không cần thư viện ngoài), muối ngẫu nhiên từng người.
// Chuỗi lưu: scrypt$N$r$p$<muối base64>$<băm base64>, để sau này tăng độ khó mà mật khẩu cũ vẫn kiểm được.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (expected.length === 0) return false;
  const key = await scryptAsync(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Băm giả để người dò tên không phân biệt được "không có tài khoản" với "sai mật khẩu" qua thời gian trả lời. */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("không-có-tài-khoản-này");
  await verifyPassword(password, await dummy);
}

// ---------------------------------------------------------------------------- phiên đăng nhập

export const SESSION_DAYS = 30;

/** Token phiên: 32 byte ngẫu nhiên. Chỉ trả cho client; database chỉ giữ bản băm sha256. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
