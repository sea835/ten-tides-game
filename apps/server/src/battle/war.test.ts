import { describe, expect, it } from "vitest";
import { WAR_MAP_LIST, WATER_LEVEL, floorBelow, insideBox, warRoleOf, warRoles, warSquadLeader } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { WAR_TICKETS, War, bleedOf, timeWinner } from "./war.ts";

function makeWar(humans = 1, perSide = 50, map = "frontier") {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.state.settings.warMap = map;
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

  it("không có vùng bo: vùng an toàn phủ cả bản đồ, căn cứ hai phe ở trong vùng", () => {
    const room = makeWar(1);
    const z = room.state.zone;
    expect(z.r).toBeGreaterThan(1000);
    for (const p of room.state.players.values()) expect(Math.hypot(p.x - z.x, p.z - z.z)).toBeLessThan(z.r);
  });

  it("trừ vé theo cứ điểm: hơn một cứ điểm đã rỉ vé, hơn càng nhiều mất càng nhanh", () => {
    const flags = (b: number, r: number) => Array.from({ length: 7 }, (_, i) => ({ owner: i < b ? "blue" : i < b + r ? "red" : "" }));
    expect(bleedOf(flags(3, 3))).toEqual({ blue: 0, red: 0 });
    expect(bleedOf(flags(0, 0))).toEqual({ blue: 0, red: 0 });
    const lead1 = bleedOf(flags(4, 3)).red;
    const lead3 = bleedOf(flags(5, 2)).red;
    const lead5 = bleedOf(flags(6, 1)).red;
    expect(bleedOf(flags(4, 3)).blue).toBe(0);
    expect(lead1).toBeGreaterThan(0);
    expect(lead3).toBeGreaterThan(lead1 * 2);
    expect(bleedOf(flags(6, 0)).red).toBeGreaterThan(lead5);
    expect(bleedOf(flags(1, 6)).blue).toBe(lead5);
    expect(bleedOf(flags(1, 6)).red).toBe(0);
    const room = makeWar(1);
    const ids = [...room.state.flags.keys()];
    // Mọi người tạm gục (chưa tới lượt hồi sinh): không ai chiếm, không ai bắn, chỉ còn trừ vé theo cứ điểm.
    for (const p of room.state.players.values()) {
      p.alive = false;
      p.respawn = 1e6;
    }
    const drained = (blue: number, seconds: number) => {
      ids.forEach((id, i) => {
        const f = room.state.flags.get(id)!;
        f.owner = i < blue ? "blue" : "red";
        f.progress = i < blue ? 1 : -1;
      });
      room.state.ticketsBlue = room.state.ticketsRed = 300;
      for (let k = 0; k < seconds * 20; k++) room.war.tick(0.05);
      return { red: 300 - room.state.ticketsRed, blue: 300 - room.state.ticketsBlue };
    };
    // 4–3: rỉ chậm (khoảng 2 vé mỗi phút), bên thua mới mất.
    expect(drained(4, 60)).toEqual({ red: 2, blue: 0 });
    // 6–1: nhanh hơn hẳn.
    const fast = drained(6, 60);
    expect(fast.blue).toBe(0);
    expect(fast.red).toBeGreaterThanOrEqual(15);
    expect(fast.red).toBeGreaterThan(lead1 * 5);
  });

  it("hết giờ: phe nhiều vé hơn thắng; bằng vé thì phe giữ nhiều cứ điểm hơn", () => {
    expect(timeWinner(100, 80, [])).toBe("blue");
    expect(timeWinner(80, 100, [{ owner: "blue", progress: 1 }])).toBe("red");
    expect(timeWinner(90, 90, [{ owner: "red", progress: -1 }, { owner: "red", progress: -1 }, { owner: "blue", progress: 1 }])).toBe("red");
    expect(timeWinner(90, 90, [{ owner: "", progress: 0.4 }])).toBe("blue");
    expect(timeWinner(90, 90, [{ owner: "", progress: -0.4 }])).toBe("red");
    // Bản đồ bất đối xứng, hoà hoàn toàn: phe phòng thủ (phe Đỏ ở Omaha) thắng.
    expect(timeWinner(90, 90, [], "normandy")).toBe("red");

    const room = makeWar(1);
    expect(room.state.settings.warMinutes).toBe(20);
    for (const p of room.state.players.values()) {
      p.alive = false;
      p.respawn = 1e6;
    }
    for (let k = 0; k < 20 * 10; k++) room.war.tick(0.05);
    expect(room.state.phaseDuration).toBe(20 * 60);
    expect(room.state.phase).toBe("battle");
    expect(room.state.timeLeft).toBe(20 * 60 - 10);
    // Còn 1 giây: phe Đỏ nhiều vé hơn thì thắng khi hết giờ.
    (room.war as unknown as { clock: number }).clock = 20 * 60 - 1;
    room.state.ticketsBlue = 120;
    room.state.ticketsRed = 200;
    for (let k = 0; k < 21; k++) room.war.tick(0.05);
    expect(room.state.phase).toBe("ended");
    expect(room.state.winner).toBe("red");
  });

  it("giới hạn thời gian theo cài đặt phòng", () => {
    const room = new BattleRoom();
    room.broadcast = (() => {}) as typeof room.broadcast;
    room.state.battleMode = "war";
    room.state.settings.warMinutes = 15;
    room.bots = new Bots(room);
    room.vehicles = new Vehicles(room);
    room.war = new War(room);
    (room as unknown as { setupMap: (seed: number) => void }).setupMap(99);
    const p = new PlayerState();
    p.created = true;
    room.state.players.set("human0", p);
    room.state.bots = 5;
    (room as unknown as { startMatch: () => void }).startMatch();
    (room as unknown as { beginBattle: () => void }).beginBattle();
    for (let k = 0; k < 20; k++) room.war.tick(0.05);
    expect(room.state.phaseDuration).toBe(15 * 60);
    expect(room.state.timeLeft).toBe(15 * 60 - 1);
  });

  it("bản đồ bất đối xứng: phe phòng thủ giữ sẵn cứ điểm phía mình và ít vé hơn; bản đồ đối xứng không đổi", () => {
    const sym = makeWar(1, 50, "frontier");
    expect([...sym.state.flags.values()].every((f) => f.owner === "")).toBe(true);
    expect(sym.state.ticketsBlue).toBe(300);
    expect(sym.state.ticketsRed).toBe(300);
    const omaha = makeWar(1, 50, "normandy");
    const owners = Object.fromEntries([...omaha.state.flags.entries()].map(([id, f]) => [id, f.owner]));
    expect(owners).toEqual({ A: "", B: "", C: "", D: "", E: "red", F: "red", G: "red" });
    expect([...omaha.state.flags.values()].filter((f) => f.owner === "red").every((f) => f.progress === -1)).toBe(true);
    // Phe Xanh tấn công đủ vé, phe Đỏ phòng thủ 80%.
    expect(omaha.state.ticketsBlue).toBe(300);
    expect(omaha.state.ticketsRed).toBe(240);
    expect(warRoleOf("normandy", "blue")).toBe("attack");
    expect(warRoleOf("normandy", "red")).toBe("defend");
    expect(warRoleOf("frontier", "red")).toBe("");
    // Mọi cứ điểm giữ sẵn nằm đúng phía phe phòng thủ (gần căn cứ phe đó hơn căn cứ phe kia).
    const base = (side: "blue" | "red") => omaha.war.base(side);
    for (const f of omaha.state.flags.values()) {
      if (f.owner !== "red") continue;
      expect(Math.hypot(f.x - base("red").x, f.z - base("red").z)).toBeLessThan(Math.hypot(f.x - base("blue").x, f.z - base("blue").z));
    }
    for (const id of WAR_MAP_LIST.filter((m) => m.roles).map((m) => m.id)) {
      const r = warRoles(id)!;
      expect(r.held.length).toBeGreaterThanOrEqual(2);
      expect(r.held.length).toBeLessThanOrEqual(4);
    }
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
    // Vé mặc định (300), giới hạn 20 phút: hai phe máy ngang sức, trừ vé theo cứ điểm khiến trận kết thúc trong
    // khoảng 15–20 phút (hết vé, hay hết giờ thì phe nhiều vé hơn thắng).
    let worst = 0;
    const t0 = performance.now();
    let ticks = 0;
    let captured = 0;
    for (; ticks < 20 * 60 * 25 && room.state.phase === "battle"; ticks++) {
      const a = performance.now();
      r.tick(0.05);
      worst = Math.max(worst, performance.now() - a);
      if (ticks % 200 === 0) captured = Math.max(captured, [...room.state.flags.values()].filter((f) => f.owner).length);
    }
    const avg = (performance.now() - t0) / ticks;
    console.log(`chiến trường: ${(ticks / 20 / 60).toFixed(1)} phút, nhịp ${avg.toFixed(2)} ms (chậm nhất ${worst.toFixed(1)}), cứ điểm có chủ tối đa ${captured}, vé ${room.state.ticketsBlue}/${room.state.ticketsRed}, thắng ${room.state.winner}`);
    expect(captured).toBeGreaterThan(2);
    expect(room.state.phase).toBe("ended");
    expect(["blue", "red"]).toContain(room.state.winner);
    expect(ticks / 20 / 60).toBeGreaterThan(8);
    expect(ticks / 20 / 60).toBeLessThanOrEqual(20.1);
    expect(avg).toBeLessThan(25);
  }, 300000);
});
