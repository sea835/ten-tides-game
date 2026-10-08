import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

function makeWar() {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(99);
  const p = new PlayerState();
  p.name = "P0";
  p.created = true;
  room.state.players.set("human0", p);
  room.war.assign("human0");
  room.state.bots = 50;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return room;
}

describe("chỉ huy lính trên bản đồ (chiến trường)", () => {
  it("máy được giao vùng đánh chiếm thì kéo về vùng đó, thả lệnh thì thôi", () => {
    const room = makeWar();
    const tick = (room as unknown as { tick: (dt: number) => void }).tick.bind(room);
    const side = room.state.players.get("human0")!.team;
    // Vùng đích: cứ điểm xa căn cứ phe mình nhất ở bờ bên mình (đi tới được trong vài chục giây).
    const flags = [...room.state.flags.values()];
    const ids = [...room.state.players.entries()].filter(([, q]) => q.bot && q.team === side && q.role !== "tanker" && q.alive).slice(0, 6).map(([id]) => id);
    const mean = (x: number, z: number) => ids.reduce((a, id) => { const q = room.state.players.get(id)!; return a + Math.hypot(q.x - x, q.z - z); }, 0) / ids.length;
    const area = flags.sort((a, b) => mean(a.x, a.z) - mean(b.x, b.z))[1]!;
    const start = mean(area.x, area.z);
    for (const id of ids) room.bots.commands.set(id, { kind: "attack", x: area.x, z: area.z, r: 16, by: "human0", until: Date.now() + 60_000 });
    for (let k = 0; k < 20 * 40; k++) tick(0.05);
    const alive = ids.filter((id) => room.state.players.get(id)!.alive);
    const end = alive.reduce((a, id) => { const q = room.state.players.get(id)!; return a + Math.hypot(q.x - area.x, q.z - area.z); }, 0) / Math.max(1, alive.length);
    expect(end).toBeLessThan(Math.max(30, start * 0.5));
    for (const id of ids) room.bots.commands.delete(id);
    expect(room.bots.commands.size).toBe(0);
  }, 120_000);
});
