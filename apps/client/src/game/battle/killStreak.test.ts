import { describe, expect, it } from "vitest";
import { CHAIN_WINDOW, newStreak, registerKill, resetLife, type StreakState } from "./killStreak.ts";

/** Hạ lần lượt ở các mốc thời gian, trả về tiêu đề thông báo từng lần (null = không báo). */
function run(times: number[], start: StreakState = newStreak()) {
  let s = start;
  const titles: (string | null)[] = [];
  for (const t of times) {
    const r = registerKill(s, t);
    s = r.state;
    titles.push(r.callout?.title ?? null);
  }
  return { s, titles };
}

describe("chuỗi hạ gục", () => {
  it("liên hoàn trong cửa sổ: double, triple, multi, rampage", () => {
    const { titles, s } = run([1000, 2000, 3000, 4000, 5000]);
    expect(titles.slice(0, 4)).toEqual([null, "DOUBLE KILL", "TRIPLE KILL", "MULTI KILL"]);
    // Lần thứ năm trùng mốc 5 mạng trong một đời: mốc đời thắng, rampage thành dòng phụ.
    expect(titles[4]).toBe("KHÔNG THỂ CẢN PHÁ");
    expect(s.chain).toBe(5);
    expect(s.life).toBe(5);
  });

  it("quá cửa sổ thì chuỗi liên hoàn bắt đầu lại, chuỗi trong mạng vẫn giữ", () => {
    const { titles, s } = run([1000, 1000 + CHAIN_WINDOW + 1, 1000 + CHAIN_WINDOW + 500]);
    expect(titles).toEqual([null, null, "DOUBLE KILL"]);
    expect(s.chain).toBe(2);
    expect(s.life).toBe(3);
  });

  it("đúng mép cửa sổ vẫn tính là liên hoàn", () => {
    expect(run([1000, 1000 + CHAIN_WINDOW]).titles[1]).toBe("DOUBLE KILL");
  });

  it("mốc trong mạng: 5 và 10 mạng không chết, rải rác cũng tính", () => {
    const times = Array.from({ length: 10 }, (_, i) => 1000 + i * 10_000);
    const { titles } = run(times);
    expect(titles[4]).toBe("KHÔNG THỂ CẢN PHÁ");
    expect(titles[9]).toBe("BẤT KHẢ CHIẾN BẠI");
    expect(titles.filter(Boolean)).toHaveLength(2);
  });

  it("rampage dài vẫn thắng mốc đời thấp hơn bậc", () => {
    let s = newStreak();
    for (let i = 0; i < 6; i++) s = registerKill(s, 1000 + i * 100).state;
    const r = registerKill(s, 1700);
    expect(r.callout?.title).toBe("RAMPAGE!");
    expect(r.callout?.sub).toContain("7");
  });

  it("phá nổ xe nhiều mạng một lúc: nhảy qua mốc vẫn báo, xe trống không tính", () => {
    let s = registerKill(newStreak(), 1000, 4).state;
    expect(s.life).toBe(4);
    const r = registerKill(s, 1500, 2);
    expect(r.state.life).toBe(6);
    expect(r.callout?.title).toBe("KHÔNG THỂ CẢN PHÁ");
    expect(r.callout?.sub).toContain("RAMPAGE!");
    s = r.state;
    const empty = registerKill(s, 1600, 0);
    expect(empty.state).toBe(s);
    expect(empty.callout).toBeNull();
  });

  it("chết thì mất chuỗi", () => {
    const { s } = run([1000, 1500, 2000]);
    const dead = resetLife(s);
    expect(dead.life).toBe(0);
    expect(dead.chain).toBe(0);
    expect(registerKill(dead, 2100).callout).toBeNull();
  });
});
