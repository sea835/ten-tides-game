import { afterEach, describe, expect, it, vi } from "vitest";
import { DOWNED, MAX_HP } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { magOf } from "./kit.ts";
import { War } from "./war.ts";

function makeWar(perSide = 10) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(99);
  for (const id of ["human0", "human1"]) {
    const p = new PlayerState();
    p.name = id;
    p.created = true;
    room.state.players.set(id, p);
    room.war.assign(id);
  }
  room.state.bots = perSide;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return room;
}

/** Hai người chơi cùng phe, một máy phe địch; mọi máy khác đứng yên ở xa (khỏi can thiệp). */
function setup() {
  const room = makeWar();
  const s = room.state;
  const a = s.players.get("human0")!;
  const b = s.players.get("human1")!;
  b.team = a.team;
  const enemy = [...s.players.entries()].find(([, p]) => p.bot && p.team !== a.team && !p.vehicle)!;
  // Dọn các máy khác ra khỏi trận để thử một mình.
  for (const [id, p] of [...s.players]) if (p.bot && id !== enemy[0]) s.players.delete(id);
  for (const p of [a, b]) {
    p.x = 0;
    p.z = 0;
    p.y = room.map.world.heightAt(0, 0);
  }
  b.x = 1.2;
  enemy[1].x = 300;
  enemy[1].z = 300;
  return { room, a, b, enemy: enemy[0] };
}

const shoot = (room: BattleRoom, id: string, enemy: string, part: "head" | "body" | "blast" = "body", amount = 500) => room.damage(id, amount, part, enemy, "m416");
const run = (room: BattleRoom, seconds: number) => {
  for (let k = 0; k < seconds * 20; k++) room.war.tick(0.05), room.downed.tick(0.05);
};

afterEach(() => vi.restoreAllMocks());

describe("trọng thương và cứu đồng đội", () => {
  it("trúng đòn chí mạng thì nằm gục chứ chưa chết: còn sống, chưa mất vé, chưa lên bảng hạ gục", () => {
    const { room, a, enemy } = setup();
    const s = room.state;
    const before = s.ticketsBlue + s.ticketsRed;
    const r = shoot(room, "human0", enemy);
    expect(r?.killed).toBe(true);
    expect(a.alive).toBe(true);
    expect(a.downed).toBe(DOWNED.seconds);
    expect(a.prone).toBe(true);
    expect(a.hp).toBe(1);
    expect(s.ticketsBlue + s.ticketsRed).toBe(before);
    expect(s.feed.length).toBe(0);
    expect(s.players.get(enemy)!.kills).toBe(0);
    // Nằm gục thì không bắn, không băng bó được.
    const mag = magOf(a.kit, "primary1");
    room.fire("human0", a.kit.primary1, [a.x, a.y + 1.5, a.z], [[0, 0, 1]], []);
    expect(magOf(a.kit, "primary1")).toBe(mag);
  });

  it("trúng đầu, nổ quá mạnh, ngồi xe: chết luôn; bản đồ khác chế độ (sinh tồn) chết luôn", () => {
    const { room, a, b, enemy } = setup();
    shoot(room, "human0", enemy, "head");
    expect(a.alive).toBe(false);
    expect(a.downed).toBe(0);
    shoot(room, "human1", enemy, "blast", 1000);
    expect(b.alive).toBe(false);
    // Nổ vừa phải thì chỉ nằm gục.
    const room2 = setup();
    room2.a.kit.armor = 0;
    room2.a.hp = 10;
    room2.room.damage("human0", 30, "blast", room2.enemy, "frag");
    expect(room2.a.alive).toBe(true);
    expect(room2.a.downed).toBeGreaterThan(0);
    const solo = setup();
    solo.room.state.battleMode = "solo";
    shoot(solo.room, "human0", solo.enemy);
    expect(solo.a.alive).toBe(false);
  });

  it("đồng đội giữ F đủ thời gian thì cứu dậy với 30% máu, được XP cứu người", () => {
    const { room, a, b, enemy } = setup();
    shoot(room, "human0", enemy);
    const support = room.stats.get("human1").support;
    room.downed.hold("human1", "human0", true);
    run(room, 1);
    expect(a.downed).toBe(DOWNED.seconds);
    expect(a.revive).toBeGreaterThan(30);
    run(room, DOWNED.revive);
    expect(a.downed).toBe(0);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(DOWNED.hp);
    expect(room.stats.get("human1").support).toBe(support + 1);
    expect(b.alive).toBe(true);
    // Đứng dậy rồi bị bắn gục lại thì lại nằm gục.
    shoot(room, "human0", enemy);
    expect(a.downed).toBe(DOWNED.seconds);
  });

  it("đang cứu mà đứng xa, buông phím, hay người cứu cũng gục thì không cứu được", () => {
    const { room, a, b, enemy } = setup();
    shoot(room, "human0", enemy);
    b.x = 30;
    room.downed.hold("human1", "human0", true);
    run(room, 4);
    expect(a.revive).toBe(0);
    expect(a.downed).toBeLessThan(DOWNED.seconds - 3);
    b.x = 1.2;
    room.downed.hold("human1", "human0", true);
    run(room, 1);
    room.downed.hold("human1", "human0", false);
    run(room, 3);
    expect(a.alive).toBe(true);
    expect(a.downed).toBeGreaterThan(0);
    expect(a.revive).toBe(0);
  });

  it("chảy máu hết giờ thì chết hẳn: mất một vé, mạng tính cho người đã bắn gục", () => {
    const { room, a, enemy } = setup();
    const s = room.state;
    const e = s.players.get(enemy)!;
    const tickets = a.team === "blue" ? s.ticketsBlue : s.ticketsRed;
    shoot(room, "human0", enemy);
    run(room, DOWNED.seconds - 1);
    expect(a.alive).toBe(true);
    expect(e.kills).toBe(0);
    run(room, 2);
    expect(a.alive).toBe(false);
    expect(a.downed).toBe(0);
    expect(a.respawn).toBeGreaterThan(0);
    expect(a.team === "blue" ? s.ticketsBlue : s.ticketsRed).toBe(tickets - 1);
    expect(e.kills).toBe(1);
    expect(s.feed.length).toBe(1);
    expect(s.feed[0]!.killer).toBe(enemy);
    expect(s.feed[0]!.victim).toBe("human0");
  });

  it("người khác bắn tiếp kết liễu: mạng vẫn tính cho người bắn gục ban đầu", () => {
    const { room, a, enemy } = setup();
    const s = room.state;
    const e = s.players.get(enemy)!;
    // Người chơi thứ hai sang phe địch làm kẻ kết liễu.
    const foe = s.players.get("human1")!;
    foe.team = a.team === "blue" ? "red" : "blue";
    shoot(room, "human0", enemy);
    room.damage("human0", 10, "body", "human1", "m416");
    expect(a.alive).toBe(false);
    expect(e.kills).toBe(1);
    expect(foe.kills).toBe(0);
    expect(s.feed[0]!.killer).toBe(enemy);
  });

  it("bỏ cuộc (giveUp) thì chết hẳn, hồi sinh được", () => {
    const { room, a, enemy } = setup();
    shoot(room, "human0", enemy);
    room.downed.finish("human0");
    expect(a.alive).toBe(false);
    expect(a.downed).toBe(0);
    // Còn khoẻ mạnh mà bấm bỏ cuộc thì không có gì xảy ra.
    const { room: r2, b } = setup();
    r2.downed.finish("human1");
    expect(b.alive).toBe(true);
    // Chết hẳn rồi: chọn chỗ hồi sinh bình thường.
    a.respawn = 0;
    room.war.respawn("human0", "hq", "rifle");
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(MAX_HP);
    expect(a.downed).toBe(0);
  });

  it("máy không thấy địch chạy tới cứu đồng đội nằm gục gần đó", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const room = makeWar(6);
    const s = room.state;
    const mates = [...s.players.entries()].filter(([, p]) => p.bot && p.team === "blue" && !p.vehicle);
    const enemies = [...s.players.entries()].filter(([, p]) => p.team === "red");
    // Địch đứng im ở rất xa; đồng đội ở chỗ trống giữa bản đồ.
    for (const [, p] of enemies) {
      p.x = 200;
      p.z = 200;
      p.y = room.map.world.heightAt(200, 200);
    }
    for (const [id, p] of s.players) if (p.team === "blue" && id !== mates[0]![0] && id !== mates[1]![0]) s.players.delete(id);
    const [downedId, down] = mates[0]!;
    const [medicId, medic] = mates[1]!;
    down.x = medic.x = -150;
    down.z = -30;
    medic.z = -20;
    down.y = medic.y = room.map.world.heightAt(-150, -25);
    room.bots.commands.clear();
    room.damage(downedId, 500, "body", enemies[0]![0], "m416");
    expect(down.downed).toBeGreaterThan(0);
    const room_ = room as unknown as { tick: (dt: number) => void };
    for (let k = 0; k < 20 * 12 && down.downed > 0; k++) room_.tick(0.05);
    expect(down.alive).toBe(true);
    expect(down.downed).toBe(0);
    // Cứu dậy với 30% máu (máy tự băng bó thêm sau đó).
    expect(down.hp).toBeGreaterThanOrEqual(DOWNED.hp);
    expect(medic.alive).toBe(true);
    void medicId;
  });

  it("máy nằm gục một mình (không đồng đội nào gần) thì bỏ cuộc sớm", () => {
    const { room, a, enemy } = setup();
    const s = room.state;
    const bot = s.players.get(enemy)!;
    // Đổi máy địch thành đồng đội của người chơi, nằm gục một mình.
    bot.team = a.team;
    a.x = 150;
    shoot(room, enemy, "human0");
    expect(bot.downed).toBeGreaterThan(0);
    run(room, 5);
    expect(bot.alive).toBe(false);
  });
});
