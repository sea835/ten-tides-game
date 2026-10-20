import { describe, expect, it } from "vitest";
import {
  CHALLENGE,
  CHALLENGES,
  CHALLENGES_PER_PERIOD,
  CHALLENGE_STATS,
  addStats,
  advanceChallenges,
  isChallengeStat,
  periodId,
  pickChallenges,
  winStat,
  type ChallengeDef,
} from "./challenges.ts";

describe("danh mục thử thách", () => {
  it("id không trùng, số liệu hợp lệ, mục tiêu và thưởng dương, đủ thử thách cho mỗi kỳ", () => {
    expect(CHALLENGE.size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(isChallengeStat(c.stat)).toBe(true);
      expect(c.target).toBeGreaterThan(0);
      expect(c.coins).toBeGreaterThan(0);
      expect(c.xp).toBeGreaterThan(0);
    }
    for (const period of ["daily", "weekly"] as const) {
      const pool = CHALLENGES.filter((c) => c.period === period && !c.mode);
      expect(new Set(pool.map((c) => c.stat)).size).toBeGreaterThanOrEqual(CHALLENGES_PER_PERIOD);
    }
    // Có đủ các thử thách đã hứa: chiếm cứ điểm, hạ lính, thắng hải chiến, sửa tàu, hồi sinh đồng đội.
    for (const stat of ["captures", "kills", "winsNaval", "repairs", "revives"]) expect(CHALLENGES.some((c) => c.period === "daily" && c.stat === stat)).toBe(true);
  });
});

describe("bốc thử thách", () => {
  it("cố định: cùng tài khoản, cùng ngày luôn ra cùng bộ", () => {
    const a = pickChallenges(42, "daily", "2026-10-12").map((c) => c.id);
    const b = pickChallenges(42, "daily", "2026-10-12").map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(CHALLENGES_PER_PERIOD);
  });

  it("khác người, khác ngày thì bộ khác nhau (phần lớn)", () => {
    const sets = new Set<string>();
    for (let user = 1; user <= 40; user++) sets.add(pickChallenges(user, "daily", "2026-10-12").map((c) => c.id).join(","));
    expect(sets.size).toBeGreaterThan(10);
    const days = new Set<string>();
    for (let d = 10; d <= 28; d++) days.add(pickChallenges(7, "daily", `2026-10-${d}`).map((c) => c.id).join(","));
    expect(days.size).toBeGreaterThan(5);
  });

  it("đúng kỳ, không trùng số liệu, tối đa một thử thách riêng chế độ", () => {
    for (let user = 1; user <= 300; user++) {
      for (const period of ["daily", "weekly"] as const) {
        const set = pickChallenges(user, period, "2026-10-12");
        expect(set).toHaveLength(CHALLENGES_PER_PERIOD);
        expect(set.every((c) => c.period === period)).toBe(true);
        expect(new Set(set.map((c) => c.stat)).size).toBe(set.length);
        expect(set.filter((c) => c.mode).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("thử thách ngày và tuần dùng mã kỳ riêng", () => {
    expect(periodId("daily", "2026-10-12")).toBe("d:2026-10-12");
    expect(periodId("weekly", "2026-10-12")).toBe("w:2026-10-12");
  });
});

describe("cộng tiến độ", () => {
  const defs: ChallengeDef[] = [
    { id: "a", period: "daily", title: "Hạ 15", stat: "kills", target: 15, coins: 100, xp: 500 },
    { id: "b", period: "daily", title: "Chiếm 3", stat: "captures", target: 3, coins: 100, xp: 500 },
    { id: "c", period: "daily", title: "Thắng 1", stat: "wins", target: 1, coins: 100, xp: 500 },
  ];

  it("cộng dồn qua nhiều trận, không vượt mục tiêu, báo đúng lúc vừa xong", () => {
    const progress = new Map<string, number>();
    const apply = (stats: Parameters<typeof advanceChallenges>[2]) => {
      const steps = advanceChallenges(defs, progress, stats);
      for (const s of steps) progress.set(s.def.id, s.after);
      return steps;
    };
    let steps = apply({ kills: 6, captures: 1, matches: 1 });
    expect(steps.map((s) => [s.def.id, s.before, s.after, s.completedNow])).toEqual([
      ["a", 0, 6, false],
      ["b", 0, 1, false],
    ]);
    steps = apply({ kills: 12, wins: 1 });
    expect(steps.map((s) => [s.def.id, s.after, s.completedNow])).toEqual([
      ["a", 15, true],
      ["c", 1, true],
    ]);
    // Đã xong rồi thì cộng thêm không đổi gì, không báo xong lần nữa.
    steps = apply({ kills: 30, wins: 2, captures: 2 });
    expect(steps.map((s) => [s.def.id, s.after, s.completedNow])).toEqual([["b", 3, true]]);
    expect(apply({ kills: 1, captures: 1, wins: 1 })).toEqual([]);
  });

  it("số âm, số lẻ, số liệu lạ bị bỏ qua", () => {
    const steps = advanceChallenges(defs, new Map(), { kills: -3, captures: 1.9, wins: 0 });
    expect(steps.map((s) => [s.def.id, s.after])).toEqual([["b", 1]]);
  });

  it("gộp số liệu, thắng theo chế độ", () => {
    expect(addStats({ kills: 2 }, { kills: 3, revives: 1, captures: 0 })).toEqual({ kills: 5, revives: 1 });
    expect(winStat("naval")).toBe("winsNaval");
    expect(winStat("war")).toBe("winsWar");
    expect(winStat("squad")).toBe("winsSquad");
    expect(winStat("solo")).toBe("winsSolo");
    expect(winStat("story")).toBeNull();
    expect(CHALLENGE_STATS).toContain("revives");
  });
});
