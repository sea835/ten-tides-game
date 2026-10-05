import { describe, expect, it } from "vitest";
import { WATER_LEVEL, floorBelow, insideBox, warSquadLeader } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { WAR_TICKETS, War, bleedOf } from "./war.ts";

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
    const tanks = [...room.state.vehicles.values()].filter((v) => v.kind === "tank");
    expect(tanks.filter((v) => v.team === "blue").length).toBe(3);
    expect(tanks.filter((v) => v.team === "red").length).toBe(3);
    expect(tanks.every((v) => v.driver)).toBe(true);
    expect(room.state.ticketsBlue).toBe(WAR_TICKETS);
    expect(WAR_TICKETS).toBe(300);
  });

  it("trừ vé: phe giữ quá 4/7 cứ điểm làm đối phương mất 1 vé mỗi nhịp 3 giây", () => {
    const flags = (b: number, r: number) => Array.from({ length: 7 }, (_, i) => ({ owner: i < b ? "blue" : i < b + r ? "red" : "" }));
    expect(bleedOf(flags(4, 3))).toEqual({ blue: 0, red: 0 });
    expect(bleedOf(flags(5, 2))).toEqual({ blue: 0, red: 1 });
    expect(bleedOf(flags(1, 6))).toEqual({ blue: 1, red: 0 });
    expect(bleedOf(flags(4, 0))).toEqual({ blue: 0, red: 0 });
    const room = makeWar(1);
    const ids = [...room.state.flags.keys()];
    // Mọi người tạm gục (chưa tới lượt hồi sinh): không ai chiếm, không ai bắn, chỉ còn trừ vé theo cứ điểm.
    for (const p of room.state.players.values()) {
      p.alive = false;
      p.respawn = 1e6;
    }
    ids.forEach((id, i) => {
      const f = room.state.flags.get(id)!;
      f.owner = i < 5 ? "blue" : "red";
      f.progress = i < 5 ? 1 : -1;
    });
    const red = room.state.ticketsRed;
    const blue = room.state.ticketsBlue;
    for (let k = 0; k < 70; k++) room.war.tick(0.05);
    expect(room.state.ticketsRed).toBe(red - 1);
    expect(room.state.ticketsBlue).toBe(blue);
  });

  it("chỗ hồi sinh (căn cứ, cứ điểm, cạnh đội trưởng) không kẹt trong khối, không dưới nước", () => {
    const room = makeWar(1);
    const war = room.war as unknown as { spawnPoint: (side: string, at: string) => { x: number; z: number } };
    const map = room.map;
    for (const f of room.state.flags.values()) f.owner = "blue";
    for (const side of ["blue", "red"])
      for (const at of ["hq", ...room.state.flags.keys()])
        for (let k = 0; k < 20; k++) {
          const pt = war.spawnPoint(side, at);
          const h = map.world.heightAt(pt.x, pt.z);
          expect(h, `${side} ${at}`).toBeGreaterThan(WATER_LEVEL + 0.5);
          expect(insideBox(map.index, pt.x, h + 1, pt.z, 0.3), `${side} ${at}`).toBe(false);
        }
    // Hồi sinh cạnh đội trưởng: người chơi gục, đội trưởng tổ (máy) còn sống.
    const me = room.state.players.get("human0")!;
    const mates = [...room.state.players.entries()].filter(([id, p]) => p.team === me.team && id !== "human0");
    // Người chơi đứng đầu tổ là đội trưởng của chính mình: cho một người chơi khác làm đội trưởng.
    const lead = new PlayerState();
    lead.name = "Lead";
    lead.team = me.team;
    lead.alive = true;
    room.state.players.set("a-lead", lead);
    expect(warSquadLeader(room.state.players.entries(), "human0")).toBe("a-lead");
    // Đội trưởng đứng trên quảng trường bắc ngang kênh ở thị trấn: hồi sinh cạnh đó, trên mặt sàn.
    lead.x = room.state.flags.get("D")!.x + 3;
    lead.z = room.state.flags.get("D")!.z + 3;
    lead.y = floorBelow(map, lead.x, 50, lead.z);
    expect(lead.y).toBeGreaterThan(WATER_LEVEL + 3);
    expect(mates.length).toBeGreaterThan(10);
    me.alive = false;
    me.respawn = 0;
    room.war.respawn("human0", "lead", "rifle");
    expect(me.alive).toBe(true);
    expect(Math.hypot(me.x - lead.x, me.z - lead.z)).toBeLessThan(8);
    expect(Math.abs(me.y - lead.y)).toBeLessThan(1.6);
    // Đội trưởng gục: về căn cứ.
    lead.alive = false;
    me.alive = false;
    room.war.respawn("human0", "lead", "rifle");
    expect(Math.hypot(me.x - lead.x, me.z - lead.z)).toBeGreaterThan(100);
  });

  it("máy tự chiếm cứ điểm, gục thì hồi sinh, trận kết thúc khi một phe hết vé; mỗi nhịp đủ nhanh", () => {
    const room = makeWar(1);
    const r = room as unknown as { tick: (dt: number) => void };
    // Vé ít hơn mặc định (300) cho trận thử ngắn lại: chỉ cần kiểm tra trận kết thúc khi một phe hết vé.
    room.state.ticketsBlue = room.state.ticketsRed = 120;
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
  }, 300000);
});
