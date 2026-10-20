import { describe, expect, it } from "vitest";
import { clientIp, proxyTrust } from "./clientIp.ts";
import { allowOrigin, parseOrigins } from "./cors.ts";
import { RateLimiter } from "./rateLimit.ts";
import { TickBudget, TickStats, summarize } from "../tickStats.ts";

describe("IP người gọi", () => {
  const direct = { trusted: false, hops: 1 };
  const one = { trusted: true, hops: 1 };
  const two = { trusted: true, hops: 2 };

  it("không có proxy đáng tin thì bỏ qua X-Forwarded-For (ai cũng giả được)", () => {
    expect(clientIp({ "x-forwarded-for": "6.6.6.6" }, "10.0.0.1", direct)).toBe("10.0.0.1");
  });

  it("một tầng proxy: mục cuối, không tin mục do người dùng tự gắn ở đầu", () => {
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "10.0.0.1", one)).toBe("203.0.113.9");
  });

  it("hai tầng proxy: mục sát cuối; ít mục hơn số tầng thì lấy mục đầu", () => {
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 172.70.0.1" }, "10.0.0.1", two)).toBe("203.0.113.9");
    expect(clientIp({ "x-forwarded-for": "203.0.113.9" }, "10.0.0.1", two)).toBe("203.0.113.9");
  });

  it("không có header thì dùng địa chỉ socket; đọc được cả Headers của web", () => {
    expect(clientIp({}, "10.0.0.1", one)).toBe("10.0.0.1");
    expect(clientIp({}, undefined, one)).toBe("?");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), undefined, one)).toBe("1.2.3.4");
  });

  it("cấu hình: tự bật trên Render, TRUST_PROXY chỉnh được", () => {
    expect(proxyTrust({})).toEqual({ trusted: false, hops: 1 });
    expect(proxyTrust({ RENDER: "true" })).toEqual({ trusted: true, hops: 2 });
    expect(proxyTrust({ RENDER: "true", TRUST_PROXY: "0" }).trusted).toBe(false);
    expect(proxyTrust({ TRUST_PROXY: "1", TRUST_PROXY_HOPS: "3" })).toEqual({ trusted: true, hops: 3 });
  });
});

describe("CORS", () => {
  it("không đặt CORS_ORIGINS thì như cũ: phản chiếu origin", () => {
    expect(parseOrigins(undefined)).toBeNull();
    expect(allowOrigin("https://anything.example", null)).toBe("https://anything.example");
    expect(allowOrigin(undefined, null)).toBe("*");
  });

  it("danh sách cho phép: khớp đúng origin, có thể dùng * thay tên miền con", () => {
    const list = parseOrigins("https://game.example, https://*.vercel.app/");
    expect(allowOrigin("https://game.example", list)).toBe("https://game.example");
    expect(allowOrigin("https://ten-tides-git-x.vercel.app", list)).toBe("https://ten-tides-git-x.vercel.app");
    expect(allowOrigin("https://evil.example", list)).toBe("null");
    expect(allowOrigin("https://game.example.evil.com", list)).toBe("null");
    expect(allowOrigin("http://game.example", list)).toBe("null");
  });
});

describe("giới hạn tần suất", () => {
  it("full / record không đụng tới nhau, take vẫn như cũ", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.full("a", 0)).toBe(false);
    rl.record("a", 0);
    rl.record("a", 1);
    expect(rl.full("a", 2)).toBe(false);
    rl.record("a", 2);
    expect(rl.full("a", 3)).toBe(true);
    expect(rl.full("b", 3)).toBe(false);
    expect(rl.full("a", 2000)).toBe(false);
    expect([1, 2, 3, 4].map((i) => rl.take("c", i))).toEqual([true, true, true, false]);
  });
});

describe("đo nhịp", () => {
  it("p50, p95, max", () => {
    const s = summarize(Float64Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s).toMatchObject({ n: 100, p50: 51, p95: 96, max: 100 });
  });

  it("vòng đệm giữ giá trị mới nhất, chia phần, đo gửi trừ nhịp chạy bên trong", () => {
    const t = new TickStats();
    for (let i = 0; i < 1500; i++) {
      t.begin();
      t.mark("a");
      t.end();
    }
    expect(t.tick.size).toBe(1200);
    expect(t.summary().phases.a!.n).toBe(1200);
    expect(t.patch(() => 42)).toBe(42);
  });

  it("giảm tải: quá hạn thì nâng bậc, ổn lại thì hạ, có giãn cách giữa hai lần đổi", () => {
    const b = new TickBudget(35, 20, 3, 1000);
    expect(b.update(10, 0)).toBe(0);
    expect(b.update(50, 0)).toBe(1);
    expect(b.update(60, 500)).toBe(0);
    expect(b.update(60, 1500)).toBe(1);
    expect(b.level).toBe(2);
    expect(b.update(25, 3000)).toBe(0);
    expect(b.update(10, 3000)).toBe(-1);
    expect(b.level).toBe(1);
  });
});
