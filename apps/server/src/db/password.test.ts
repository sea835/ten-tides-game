import { describe, expect, it } from "vitest";
import { hashPassword, hashSessionToken, newSessionToken, verifyPassword } from "./password.ts";

describe("mật khẩu", () => {
  it("băm có muối ngẫu nhiên, kiểm đúng mật khẩu đúng", async () => {
    const a = await hashPassword("bí-mật-123");
    const b = await hashPassword("bí-mật-123");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("bí-mật-123", a)).toBe(true);
    expect(await verifyPassword("bí-mật-124", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });

  it("chuỗi băm hỏng thì trả false, không ném lỗi", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt$abc$8$1$AAAA$BBBB")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("token phiên", () => {
  it("32 byte ngẫu nhiên, lưu bằng sha256", () => {
    const t = newSessionToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(newSessionToken()).not.toBe(t);
    expect(hashSessionToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(t)).toBe(hashSessionToken(t));
  });
});
