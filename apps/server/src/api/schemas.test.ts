import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit.ts";
import { Credentials, EquipBody, LoginBody, RollBody } from "./schemas.ts";

describe("kiểm tra dữ liệu API", () => {
  it("tên đăng nhập 3–20 ký tự, chữ có dấu được, ký tự lạ thì không", () => {
    expect(Credentials.safeParse({ username: "Hải", password: "123456" }).success).toBe(true);
    expect(Credentials.safeParse({ username: " Minh_Anh.99 ", password: "123456" }).data?.username).toBe("Minh_Anh.99");
    expect(Credentials.safeParse({ username: "ab", password: "123456" }).success).toBe(false);
    expect(Credentials.safeParse({ username: "a".repeat(21), password: "123456" }).success).toBe(false);
    expect(Credentials.safeParse({ username: "có cách", password: "123456" }).success).toBe(false);
    expect(Credentials.safeParse({ username: "<script>", password: "123456" }).success).toBe(false);
    expect(Credentials.safeParse({ username: "hai", password: "12345" }).success).toBe(false);
    expect(Credentials.safeParse({ username: "hai" }).success).toBe(false);
    expect(LoginBody.safeParse({ username: "hai", password: 5 }).success).toBe(false);
  });

  it("chỉ quay 1 hoặc 10 lượt", () => {
    expect(RollBody.safeParse({ count: 1 }).success).toBe(true);
    expect(RollBody.safeParse({ count: 10 }).success).toBe(true);
    for (const count of [0, 2, 11, -1, "10", 1.5]) expect(RollBody.safeParse({ count }).success).toBe(false);
  });

  it("lắp skin: súng phải có thật, skin rỗng là tháo", () => {
    expect(EquipBody.safeParse({ weaponId: "akm", skinId: "gold" }).success).toBe(true);
    expect(EquipBody.safeParse({ weaponId: "akm", skinId: "" }).success).toBe(true);
    expect(EquipBody.safeParse({ weaponId: "bazooka", skinId: "gold" }).success).toBe(false);
    expect(EquipBody.safeParse({ weaponId: "akm" }).success).toBe(false);
  });
});

describe("giới hạn tần suất", () => {
  it("chặn khi vượt giới hạn, mở lại khi hết khung thời gian", () => {
    const rl = new RateLimiter(3, 1000);
    expect([rl.take("ip", 0), rl.take("ip", 10), rl.take("ip", 20), rl.take("ip", 30)]).toEqual([true, true, true, false]);
    expect(rl.take("ip-khác", 30)).toBe(true);
    expect(rl.take("ip", 1015)).toBe(true);
  });
});
