import { describe, expect, it } from "vitest";
import { XP_AWARD } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { MatchRewards } from "./rewards.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

// XP trong phòng thật: hạ gục (thường, vào đầu), đồng đội không tính, chiếm cứ điểm.

function makeWar() {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
  const rewards = (room as unknown as { rewards: MatchRewards }).rewards;
  for (const id of ["u1", "u2", "u3"]) {
    const p = new PlayerState();
    p.name = id;
    p.created = true;
    room.state.players.set(id, p);
    room.war.assign(id);
    rewards.xp.track(id, p, 0);
  }
  room.state.bots = 4;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return { room, rewards };
}

describe("XP trong trận", () => {
  it("hạ gục địch được XP (vào đầu nhiều hơn), hạ đồng đội thì không", () => {
    const { room, rewards } = makeWar();
    const team = (id: string) => room.state.players.get(id)!.team;
    const ids = ["u1", "u2", "u3"];
    const killer = "u1";
    const enemy = ids.find((id) => team(id) !== team(killer));
    const mate = ids.find((id) => id !== killer && team(id) === team(killer));
    for (const id of ids) room.state.players.get(id)!.alive = true;
    if (enemy) {
      room.kill(enemy, killer, "m416", true);
      expect(rewards.xp.pending(killer)).toBe(XP_AWARD.headshot);
    }
    if (mate) {
      const before = rewards.xp.pending(killer);
      room.kill(mate, killer, "m416", false);
      expect(rewards.xp.pending(killer)).toBe(before);
    }
    expect(enemy || mate).toBeTruthy();
    expect(room.state.players.get(killer)!.badge.rank).toBeGreaterThanOrEqual(1);
    room.onDispose();
  });

  it("chiếm xong cứ điểm: người phe mình đứng trong vùng được XP", () => {
    const { room, rewards } = makeWar();
    const p = room.state.players.get("u1")!;
    const side = p.team as "blue" | "red";
    // Dọn hết người khác cho cứ điểm không bị giằng co.
    for (const [id, q] of room.state.players) if (id !== "u1") q.alive = false;
    const flag = [...room.state.flags.values()][0]!;
    p.alive = true;
    p.x = flag.x;
    p.z = flag.z;
    p.y = flag.y;
    flag.owner = "";
    flag.progress = side === "blue" ? 0.999 : -0.999;
    (room as unknown as { tick: (dt: number) => void }).tick(0.5);
    expect(flag.owner).toBe(side);
    expect(rewards.xp.pending("u1")).toBe(XP_AWARD.capture);
    room.onDispose();
  });
});
