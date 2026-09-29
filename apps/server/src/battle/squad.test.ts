import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";

/** Dựng một phòng Battleground không cần mạng: gọi thẳng các bước của trận. */
function makeRoom(seed = 12345) {
  const room = new BattleRoom();
  // Không gửi gì ra mạng.
  room.broadcast = (() => {}) as typeof room.broadcast;
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(seed);
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  return room;
}

function start(room: BattleRoom, mode: "solo" | "squad", bots: number, humans = 1) {
  for (let h = 0; h < humans; h++) {
    const p = new PlayerState();
    p.name = `P${h}`;
    p.created = true;
    room.state.players.set(`human${h}`, p);
  }
  room.state.battleMode = mode;
  room.state.bots = bots;
  (room as unknown as { startMatch: () => void }).startMatch();
}

describe("Battleground: đồng đội, xe tăng, 50 máy", () => {
  it("chế độ Đồng đội: mỗi người có 5 máy cùng đội, đủ vai, mỗi đội một xe tăng có máy lái", () => {
    const room = makeRoom();
    start(room, "squad", 20, 2);
    const players = [...room.state.players.entries()];
    const mine = players.filter(([, p]) => p.team === "human0");
    expect(mine.length).toBe(6);
    expect(mine.filter(([, p]) => p.bot).map(([, p]) => p.role).sort()).toEqual(["rifle", "rifle", "sniper", "support", "tanker"]);
    // 2 người × 5 máy = 10, còn 10 máy chia thành đội máy.
    expect(players.filter(([, p]) => p.bot).length).toBe(20);
    const tanks = [...room.state.vehicles.values()];
    expect(tanks.length).toBeGreaterThanOrEqual(3);
    for (const v of tanks) expect(room.state.players.get(v.driver)?.role).toBe("tanker");
  });

  it("50 máy chạy một phút trận không lỗi, mỗi nhịp đủ nhanh", () => {
    const room = makeRoom(777);
    start(room, "squad", 50, 1);
    const r = room as unknown as { tick: (dt: number) => void; beginBattle: () => void };
    r.beginBattle();
    const t0 = performance.now();
    let worst = 0;
    for (let k = 0; k < 20 * 60; k++) {
      const a = performance.now();
      r.tick(0.05);
      for (const [id, p] of room.state.players) if (!Number.isFinite(p.x)) throw new Error(`NaN ${id} tick ${k}`);
      for (const [id, v] of room.state.vehicles) if (!Number.isFinite(v.x) || !Number.isFinite(v.turret)) throw new Error(`NaN tank ${id} tick ${k}`);
      worst = Math.max(worst, performance.now() - a);
    }
    const avg = (performance.now() - t0) / 1200;
    console.log(`nhịp trung bình ${avg.toFixed(2)} ms, chậm nhất ${worst.toFixed(1)} ms, còn sống ${room.state.aliveCount}`);
    expect(avg).toBeLessThan(25);
    for (const p of room.state.players.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    }
  });

  it("gục rồi thì nhập được vào máy cùng đội", () => {
    const room = makeRoom();
    start(room, "squad", 10, 1);
    const r = room as unknown as { beginBattle: () => void; possess: (a: string, b: string) => void };
    r.beginBattle();
    room.kill("human0", "", "", false);
    expect(room.state.players.get("human0")!.alive).toBe(false);
    const [botId, bot] = [...room.state.players.entries()].find(([, p]) => p.bot && p.team === "human0" && p.role === "sniper")!;
    const x = bot.x;
    r.possess("human0", botId);
    const me = room.state.players.get("human0")!;
    expect(me.alive).toBe(true);
    expect(me.x).toBe(x);
    expect(room.state.players.has(botId)).toBe(false);
    expect(me.kit.primary1).not.toBe("");
  });

  it("đạn không trúng đồng đội; người nằm sấp trúng theo thân nằm", () => {
    const room = makeRoom();
    start(room, "squad", 10, 1);
    (room as unknown as { beginBattle: () => void }).beginBattle();
    const me = room.state.players.get("human0")!;
    const mate = [...room.state.players.values()].find((p) => p.bot && p.team === "human0" && !p.vehicle)!;
    const hp = mate.hp;
    me.kit.primary1 = "m416";
    me.kit.mag1 = 30;
    me.kit.active = "primary1";
    const id = [...room.state.players.entries()].find(([, p]) => p === mate)![0];
    const o: [number, number, number] = [me.x, me.y + 1.4, me.z];
    const d = Math.hypot(mate.x - me.x, mate.y - me.y, mate.z - me.z);
    room.fire("human0", "m416", o, [[mate.x - o[0], mate.y + 1.2 - o[1], mate.z - o[2]]], [{ target: id, part: "body", d, ray: 0 }]);
    expect(mate.hp).toBe(hp);
    // Địch nằm sấp: báo trúng ở tầm ngực người đứng thì server không nhận (đạn bay qua trên lưng).
    const [enemyId, enemy] = [...room.state.players.entries()].find(([, p]) => p.bot && p.team !== "human0" && !p.vehicle)!;
    enemy.x = me.x + 12;
    enemy.z = me.z;
    enemy.y = me.y;
    enemy.prone = true;
    const ehp = enemy.hp;
    (room as unknown as { lastShotAt: Map<string, number> }).lastShotAt.clear();
    room.fire("human0", "m416", o, [[12, enemy.y + 1.2 - o[1], 0]], [{ target: enemyId, part: "body", d: 12, ray: 0 }]);
    expect(enemy.hp).toBe(ehp);
  });
});

describe("Battleground: cả trận Đồng đội", () => {
  it("các đội đánh nhau tới khi còn một đội (máy tự chơi, có bắn pháo)", () => {
    const room = makeRoom(4242);
    start(room, "squad", 40, 1);
    // Người chơi đứng yên ở chỗ xuất phát (máy trong đội vẫn tự đánh).
    const r = room as unknown as { tick: (dt: number) => void; beginBattle: () => void };
    r.beginBattle();
    let shots = 0;
    for (let k = 0; k < 20 * 60 * 12 && room.state.phase === "battle"; k++) {
      r.tick(0.05);
      if (k % 20 === 0) shots = [...room.state.vehicles.values()].reduce((a, v) => a + v.shots, 0);
    }
    console.log(`kết thúc: ${room.state.phase}, đội thắng ${room.state.winner}, còn sống ${room.state.aliveCount}, phát pháo ${shots}`);
    expect(room.state.phase).toBe("ended");
  });
});
