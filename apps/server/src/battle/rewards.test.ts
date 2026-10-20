import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { MatchRewards, REWARD, lineStats, matchCoins } from "./rewards.ts";
import { XpLedger } from "./xp.ts";

describe("thưởng xu sau trận", () => {
  it("người thắng được thưởng thắng và đủ phần sống sót", () => {
    expect(matchCoins(3, 1, 8)).toBe(REWARD.base + 3 * REWARD.perKill + REWARD.winner + REWARD.survival);
  });
  it("gục đầu tiên chỉ có xu tham gia và xu hạ gục", () => {
    expect(matchCoins(0, 8, 8)).toBe(REWARD.base);
    expect(matchCoins(1, 8, 8)).toBe(REWARD.base + REWARD.perKill);
  });
  it("sống lâu hơn thì nhiều xu hơn, số mạng có trần", () => {
    expect(matchCoins(0, 3, 8)).toBeGreaterThan(matchCoins(0, 6, 8));
    expect(matchCoins(100, 5, 8)).toBe(matchCoins(REWARD.maxKills, 5, 8));
  });
  it("chơi một mình thì không có xu", () => {
    expect(matchCoins(0, 1, 1)).toBe(0);
  });
});

describe("theo dõi hạng trong trận", () => {
  const make = (ids: string[]) => {
    const m = new Map<string, PlayerState>();
    for (const id of ids) {
      const p = new PlayerState();
      p.alive = true;
      m.set(id, p);
    }
    return m;
  };

  it("đánh đơn: người gục trước hạng thấp hơn, người thắng hạng 1, khách không có xu", () => {
    const players = make(["u1", "u2", "abcdef123456", "u3"]);
    const r = new MatchRewards();
    r.begin(players);
    for (const id of ["u2", "abcdef123456"]) {
      r.onDeath(id, players);
      players.get(id)!.alive = false;
    }
    r.onDeath("u3", players);
    players.get("u3")!.alive = false;
    players.delete("u3"); // bỏ đi giữa trận vẫn được tính
    players.get("u1")!.kills = 3;
    const lines = r.settle(players, "u1", "battle");
    const by = Object.fromEntries(lines.map((l) => [l.playerId, l]));
    expect(Object.keys(by).sort()).toEqual(["u1", "u2", "u3"]);
    expect(by.u1!.placement).toBe(1);
    expect(by.u1!.coins).toBe(matchCoins(3, 1, 4));
    expect(by.u2!.placement).toBe(4);
    expect(by.u3!.placement).toBe(2);
  });
});

describe("xu phòng một người, số liệu thử thách", () => {
  const make = (ids: string[], bots: string[] = []) => {
    const m = new Map<string, PlayerState>();
    for (const id of ids) {
      const p = new PlayerState();
      p.alive = true;
      m.set(id, p);
    }
    for (const id of bots) {
      const p = new PlayerState();
      p.alive = true;
      p.bot = true;
      m.set(id, p);
    }
    return m;
  };

  it("một người thật với máy chỉ nhận 60% xu trận; có bạn cùng chơi thì đủ", () => {
    const solo = make(["u1"], ["b1", "b2", "b3"]);
    const r = new MatchRewards();
    r.begin(solo);
    solo.get("u1")!.kills = 2;
    const lines = r.settle(solo, "u1", "battle");
    expect(lines[0]!.coins).toBe(Math.round(matchCoins(2, 1, 4) * 0.6));

    const duo = make(["u1", "u2"], ["b1", "b2"]);
    const r2 = new MatchRewards();
    r2.begin(duo);
    duo.get("u1")!.kills = 2;
    duo.get("u2")!.alive = false;
    r2.onDeath("u2", duo);
    const by = Object.fromEntries(r2.settle(duo, "u1", "battle").map((l) => [l.playerId, l]));
    expect(by.u1!.coins).toBe(matchCoins(2, 1, 4));
  });

  it("số liệu trận: trận đã chơi, hạ gục, thắng theo chế độ", () => {
    expect(lineStats({ kills: 5, placement: 1 }, "naval")).toEqual({ matches: 1, kills: 5, wins: 1, winsNaval: 1 });
    expect(lineStats({ kills: 0, placement: 2 }, "war")).toEqual({ matches: 1 });
    expect(lineStats({ kills: 3, placement: 1 }, "battle")).toMatchObject({ wins: 1, winsSolo: 1 });
  });

  it("sổ XP đếm số liệu thử thách theo sự kiện, stat() cho việc không có XP, drainStats lấy rồi xoá", () => {
    const ledger = new XpLedger();
    ledger.active = true;
    ledger.track("u9", new PlayerState(), 0);
    ledger.award("u9", "capture", 2);
    ledger.award("u9", "revive");
    ledger.award("u9", "headshot");
    ledger.award("u9", "kill");
    expect(ledger.stat("u9", "repairs", 3)).toBe(true);
    expect(ledger.stat("bot", "repairs")).toBe(false);
    const got = ledger.drainStats();
    expect(got.get("u9")).toEqual({ userId: 9, stats: { captures: 2, revives: 1, headshots: 1, repairs: 3 } });
    expect(ledger.drainStats().size).toBe(0);
    ledger.active = false;
    expect(ledger.stat("u9", "revives")).toBe(false);
    ledger.dispose();
  });
});
