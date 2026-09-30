import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { MatchRewards, REWARD, matchCoins } from "./rewards.ts";

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
