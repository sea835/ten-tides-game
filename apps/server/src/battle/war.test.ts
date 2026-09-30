import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

function makeWar(humans = 1, perSide = 50) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(99);
  for (let h = 0; h < humans; h++) {
    const p = new PlayerState();
    p.name = `P${h}`;
    p.created = true;
    room.state.players.set(`human${h}`, p);
    room.war.assign(`human${h}`);
  }
  room.state.bots = perSide;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return room;
}

describe("chiến trường 50 vs 50", () => {
  it("chia hai phe đủ 50 người, 7 cứ điểm, mỗi phe 3 xe tăng có người lái", () => {
    const room = makeWar(2);
    const players = [...room.state.players.values()];
    expect(players.filter((p) => p.team === "blue").length).toBe(50);
    expect(players.filter((p) => p.team === "red").length).toBe(50);
    expect(room.state.flags.size).toBe(7);
    const tanks = [...room.state.vehicles.values()];
    expect(tanks.filter((v) => v.team === "blue").length).toBe(3);
    expect(tanks.filter((v) => v.team === "red").length).toBe(3);
    expect(tanks.every((v) => v.driver)).toBe(true);
    expect(room.state.ticketsBlue).toBeGreaterThan(0);
  });

  it("máy tự chiếm cứ điểm, gục thì hồi sinh, trận kết thúc khi một phe hết vé; mỗi nhịp đủ nhanh", () => {
    const room = makeWar(1);
    const r = room as unknown as { tick: (dt: number) => void };
    let worst = 0;
    const t0 = performance.now();
    let ticks = 0;
    let captured = 0;
    for (; ticks < 20 * 60 * 30 && room.state.phase === "battle"; ticks++) {
      const a = performance.now();
      r.tick(0.05);
      worst = Math.max(worst, performance.now() - a);
      if (ticks % 200 === 0) captured = Math.max(captured, [...room.state.flags.values()].filter((f) => f.owner).length);
    }
    const avg = (performance.now() - t0) / ticks;
    console.log(`chiến trường: ${(ticks / 20 / 60).toFixed(1)} phút, nhịp ${avg.toFixed(2)} ms (chậm nhất ${worst.toFixed(1)}), cứ điểm có chủ tối đa ${captured}, vé ${room.state.ticketsBlue}/${room.state.ticketsRed}, thắng ${room.state.winner}`);
    expect(captured).toBeGreaterThan(2);
    expect(room.state.phase).toBe("ended");
    expect(avg).toBeLessThan(25);
  }, 120000);
});
