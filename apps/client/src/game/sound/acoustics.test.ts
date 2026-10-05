import { describe, expect, it } from "vitest";
import {
  CRACK_RANGE,
  ENV_SHAPE,
  MAX_SOUND_DELAY,
  SPEED_OF_SOUND,
  classifyEnvironment,
  closestApproach,
  duckAt,
  echoTaps,
  flybyTiming,
} from "./acoustics.ts";

const INF = Infinity;
const walls = (...w: number[]) => Float32Array.from(w);

describe("closestApproach", () => {
  it("tìm điểm gần tai nhất trên đường đạn", () => {
    const a = closestApproach(0, 0, 0, 100, 0, 0, 40, 0, 3);
    expect(a.t).toBeCloseTo(40);
    expect(a.miss).toBeCloseTo(3);
    expect(a.x).toBeCloseTo(40);
    expect(a.len).toBeCloseTo(100);
  });

  it("kẹp vào đầu đoạn khi tai ở sau lưng người bắn hay sau điểm găm", () => {
    const behind = closestApproach(0, 0, 0, 100, 0, 0, -10, 0, 0);
    expect(behind.t).toBe(0);
    expect(behind.miss).toBeCloseTo(10);
    const past = closestApproach(0, 0, 0, 50, 0, 0, 80, 4, 0);
    expect(past.t).toBeCloseTo(50);
    expect(past.miss).toBeCloseTo(Math.hypot(30, 4));
  });

  it("ghi vào đối tượng có sẵn và không lỗi với đoạn dài 0", () => {
    const out = { t: 9, miss: 9, x: 9, y: 9, z: 9, len: 9 };
    const r = closestApproach(1, 2, 3, 1, 2, 3, 1, 2, 5, out);
    expect(r).toBe(out);
    expect(r.t).toBe(0);
    expect(r.miss).toBeCloseTo(2);
  });
});

describe("flybyTiming", () => {
  it("đạn siêu thanh: tiếng nứt tới trước, tiếng nổ đầu nòng tới sau theo khoảng cách / 343", () => {
    // Bắn từ 200 m, đạn 880 m/s sượt qua cách 2 m.
    const f = flybyTiming(200, 2, true, 200, 880, false);
    expect(f.supersonic).toBe(true);
    expect(f.crackDelay).toBeCloseTo(200 / 880 + 2 / SPEED_OF_SOUND);
    expect(f.reportDelay).toBeCloseTo(200 / SPEED_OF_SOUND);
    expect(f.crackDelay).toBeLessThan(f.reportDelay);
    expect(f.zone).toBe("whiz");
  });

  it("tiếng nứt vẫn tới trước khi độ trễ tiếng nổ bị kẹp trần", () => {
    const f = flybyTiming(600, 3, true, 600, 400, false);
    expect(f.reportDelay).toBe(MAX_SOUND_DELAY);
    expect(f.crackDelay).toBeLessThan(f.reportDelay);
  });

  it("cận âm và giảm thanh: không nứt, chỉ rít khi gần", () => {
    const sub = flybyTiming(30, 6, true, 30, 300, false);
    expect(sub.supersonic).toBe(false);
    expect(sub.zone).toBe("none");
    expect(flybyTiming(30, 2, true, 30, 300, false).zone).toBe("whiz");
    const quiet = flybyTiming(80, 8, true, 80, 880, true);
    expect(quiet.supersonic).toBe(false);
    expect(quiet.zone).toBe("none");
  });

  it("phân vùng theo khoảng sượt: <1 m chát sát tai, 1–4 m rít, tới 12 m nứt", () => {
    expect(flybyTiming(50, 0.6, true, 50, 880, false).zone).toBe("snap");
    expect(flybyTiming(50, 3, true, 50, 880, false).zone).toBe("whiz");
    expect(flybyTiming(50, 9, true, 50, 880, false).zone).toBe("crack");
    expect(flybyTiming(50, CRACK_RANGE + 1, true, 50, 880, false).zone).toBe("none");
    // Đạn găm trước khi bay ngang (không qua điểm gần nhất) thì không nứt.
    expect(flybyTiming(50, 9, false, 50, 880, false).zone).toBe("none");
    // Đứng sát người bắn (đạn chưa bay quá 4 m) thì bỏ qua.
    expect(flybyTiming(2, 0.5, true, 2, 880, false).zone).toBe("none");
  });
});

describe("classifyEnvironment", () => {
  it("trong nhà: có mái thấp, tường kín quanh", () => {
    expect(classifyEnvironment({ walls: walls(3, 4, 2, 5, 3, 6, 4, 20), roof: 2.5, trees: 0, rise: 0 })).toBe("indoor");
  });

  it("phố: nhiều vách trong 30 m nhưng trời trống", () => {
    expect(classifyEnvironment({ walls: walls(8, INF, 15, 22, INF, 12, INF, INF), roof: INF, trees: 2, rise: 0 })).toBe("urban");
  });

  it("rừng: nhiều cây, ít vách", () => {
    expect(classifyEnvironment({ walls: walls(INF, INF, INF, INF, INF, INF, INF, INF), roof: INF, trees: 14, rise: 1 })).toBe("forest");
  });

  it("đỉnh đồi trống và bãi trống", () => {
    const empty = walls(INF, INF, INF, INF, INF, INF, INF, INF);
    expect(classifyEnvironment({ walls: empty, roof: INF, trees: 1, rise: 12 })).toBe("hilltop");
    expect(classifyEnvironment({ walls: empty, roof: INF, trees: 1, rise: 1 })).toBe("open");
  });

  it("đỉnh đồi cắt đuôi sớm, trong nhà ùng, phố có tiếng dội", () => {
    expect(ENV_SHAPE.hilltop.hold).toBeLessThan(1);
    expect(ENV_SHAPE.indoor.boom).toBeGreaterThan(0);
    expect(ENV_SHAPE.urban.slap).toBeGreaterThan(0);
    expect(ENV_SHAPE.open.hold).toBe(Infinity);
  });
});

describe("echoTaps", () => {
  it("trễ 2d/343 theo vách gần nhất trước, nhỏ dần theo khoảng cách, tối đa `max` tiếng", () => {
    const taps = echoTaps(walls(10, INF, 20, INF, 30, INF, 35, INF), 0, 1, 3);
    expect(taps).toHaveLength(3);
    expect(taps[0]!.delay).toBeCloseTo(20 / SPEED_OF_SOUND);
    expect(taps[1]!.delay).toBeCloseTo(40 / SPEED_OF_SOUND);
    expect(taps[2]!.delay).toBeCloseTo(60 / SPEED_OF_SOUND);
    expect(taps[0]!.gain).toBeGreaterThan(taps[1]!.gain);
  });

  it("lệch trái phải theo hướng vách so với hướng nhìn", () => {
    // Hướng 0 là +x; yaw 0 thì trục phải của camera là +x.
    const [right] = echoTaps(walls(10, INF, INF, INF, INF, INF, INF, INF), 0, 1);
    expect(right!.pan).toBeGreaterThan(0.5);
    const [left] = echoTaps(walls(INF, INF, INF, INF, 10, INF, INF, INF), 0, 1);
    expect(left!.pan).toBeLessThan(-0.5);
  });

  it("bỏ vách quá sát, tiếng dội trùng nhau, và khi không có tiếng dội", () => {
    expect(echoTaps(walls(0.5, 10, 10.5, INF), 0, 1, 3)).toHaveLength(1);
    expect(echoTaps(walls(10, 12), 0, 0)).toHaveLength(0);
  });
});

describe("duckAt", () => {
  const d = { start: 10, seconds: 3, depth: 0.95, attack: 0.1 };
  it("giảm nhanh, giữ, rồi hồi về 0", () => {
    expect(duckAt(d, 9.9)).toBe(0);
    expect(duckAt(d, 10.05)).toBeCloseTo(0.475);
    expect(duckAt(d, 10.5)).toBeCloseTo(0.95);
    const mid = duckAt(d, 11.95);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.95);
    expect(duckAt(d, 13)).toBe(0);
  });
});
