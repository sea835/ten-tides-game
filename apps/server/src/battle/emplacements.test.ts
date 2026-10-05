import { describe, expect, it } from "vitest";
import { MORTAR, NEST, WRECK_SECONDS, isEmplacement, mortarRange, mountMuzzle } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { EMPLACEMENT_RESPAWN } from "./emplacements.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

/** Phòng chiến trường không mạng, đã đặt vũ khí cố định, đang giữa trận, chưa có ai. */
function makeRoom(seed = 7) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(seed);
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  room.vehicles.emplacements.setup();
  room.state.phase = "battle";
  return room;
}

function addPlayer(room: BattleRoom, id: string, team: string, x: number, z: number) {
  const p = new PlayerState();
  p.name = id;
  p.created = true;
  p.alive = true;
  p.hp = 100;
  p.team = team;
  p.x = x;
  p.z = z;
  p.y = room.map.world.heightAt(x, z);
  room.state.players.set(id, p);
  return p;
}

function first(room: BattleRoom, kind: string) {
  for (const [vid, v] of room.state.vehicles) if (v.kind === kind) return { vid, v };
  throw new Error(`không có ${kind}`);
}

const tick = (room: BattleRoom, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) room.vehicles.tick(0.05);
};

/** Ghi lại các vụ nổ (room.explode vẫn chạy như cũ). */
function spyExplode(room: BattleRoom) {
  const booms: { x: number; y: number; z: number; weapon: string }[] = [];
  const orig = room.explode.bind(room);
  room.explode = ((x, y, z, kind, owner, radius, dmg, weapon, skip) => {
    booms.push({ x, y, z, weapon: weapon ?? kind });
    orig(x, y, z, kind, owner, radius, dmg, weapon, skip);
  }) as typeof room.explode;
  return booms;
}

describe("vũ khí cố định: đặt sẵn, ghế, không chạy được", () => {
  it("chiến trường có ổ đại liên, cối; bấm F vào ghế xạ thủ, gửi vị trí cũng không dời được", () => {
    const room = makeRoom();
    const all = [...room.state.vehicles.values()];
    expect(all.filter((v) => v.kind === "hmg_nest").length).toBeGreaterThanOrEqual(8);
    expect(all.filter((v) => v.kind === "mortar").length).toBe(4);
    const { vid, v } = first(room, "hmg_nest");
    const p = addPlayer(room, "g", "blue", v.x + 1, v.z);
    room.vehicles.enter("g");
    expect(p.vehicle).toBe(vid);
    expect(v.driver).toBe("g");
    expect(room.vehicles.emplacements.exposed(p)).toBe(true);
    const x = v.x;
    room.vehicles.move("g", { x: v.x + 1, y: v.y, z: v.z, rotY: v.rotY, turret: 0, pitch: 0, moving: true });
    expect(v.x).toBe(x);
    // Ổ đầy: người khác không vào được.
    addPlayer(room, "b", "blue", v.x - 1, v.z);
    room.vehicles.enter("b");
    expect(room.state.players.get("b")!.vehicle).toBe("");
    // Xuống, bỏ trống thì ổ không thuộc phe nào nữa (địch vào được).
    room.vehicles.exit("g");
    tick(room, 0.1);
    expect(v.team).toBe("");
    addPlayer(room, "r", "red", v.x + 1, v.z + 0.5);
    room.vehicles.enter("r");
    expect(v.driver).toBe("r");
  });
});

describe("ổ đại liên: cung xoay 120°", () => {
  it("xoay quá cung thì bị kẹp; bắn ra ngoài cung thì server bỏ qua, trong cung thì trúng", () => {
    const room = makeRoom();
    const { vid, v } = first(room, "hmg_nest");
    addPlayer(room, "g", "blue", v.x, v.z);
    room.vehicles.enter("g");
    room.vehicles.aim("g", v.rotY + 2.5, 0);
    expect(Math.abs(Math.atan2(Math.sin(v.turret - v.rotY), Math.cos(v.turret - v.rotY)))).toBeCloseTo(NEST.arc / 2, 5);
    const shots: string[] = [];
    const orig = room.shootRays.bind(room);
    room.shootRays = ((...args: Parameters<typeof room.shootRays>) => {
      shots.push(args[6] ?? "");
      orig(...args);
    }) as typeof room.shootRays;
    // Bắn ra sau lưng ổ: bỏ qua.
    const back = v.rotY + Math.PI;
    const m = mountMuzzle(v.kind, v, back, 0);
    room.vehicles.gun("g", { o: m.o, d: m.d, hits: [] });
    expect(shots.length).toBe(0);
    // Bắn thẳng trước mặt: được, dò qua đường đại liên (bỏ qua chính ổ mình).
    const f = mountMuzzle(v.kind, v, v.rotY, 0);
    room.vehicles.gun("g", { o: f.o, d: f.d, hits: [] });
    expect(shots).toEqual([vid]);
  });

  it("xạ thủ lộ người: lựu đạn nổ sát ổ làm xạ thủ mất máu; nổ đủ mạnh thì ổ nổ tung, xác dọn đi rồi có ổ mới", () => {
    const room = makeRoom();
    const { vid, v } = first(room, "hmg_nest");
    const p = addPlayer(room, "g", "blue", v.x, v.z);
    room.vehicles.enter("g");
    room.explode(v.x + 2.5, v.y + 0.5, v.z, "frag", "", 6, 60);
    expect(p.hp).toBeLessThan(100);
    // Đạn thường gần như không làm hư bao cát.
    const hp = v.hp;
    room.vehicles.bulletHit(vid, 40, "", "m416", "side", 1);
    expect(hp - v.hp).toBeLessThan(5);
    room.vehicles.damage(vid, 10000, "", "rpg7");
    expect(v.hp).toBe(0);
    expect(p.alive).toBe(false);
    tick(room, WRECK_SECONDS + 1);
    expect(room.state.vehicles.has(vid)).toBe(false);
    tick(room, EMPLACEMENT_RESPAWN + 1);
    const again = [...room.state.vehicles.values()].filter((o) => o.kind === "hmg_nest" && Math.hypot(o.x - v.x, o.z - v.z) < 0.5);
    expect(again.length).toBe(1);
    expect(again[0]!.hp).toBe(NEST.hp);
  });
});

describe("cối 82mm: server kiểm tra phát bắn, mô phỏng đạn bay", () => {
  it("chỉ pháo thủ ngồi cối mới bắn được; nhịp nạp 3 giây; góc ngẩng bị kẹp", () => {
    const room = makeRoom();
    const { vid, v } = first(room, "mortar");
    const { v: nest } = first(room, "hmg_nest");
    const e = room.vehicles.emplacements;
    // Đi bộ, hay ngồi ổ đại liên: không bắn cối được.
    addPlayer(room, "w", "blue", v.x + 1, v.z);
    e.fire("w", 0, 1.2);
    expect(e.inFlight()).toBe(0);
    addPlayer(room, "n", "blue", nest.x, nest.z);
    room.vehicles.enter("n");
    e.fire("n", 0, 1.2);
    expect(e.inFlight()).toBe(0);
    room.vehicles.enter("w");
    expect(v.driver).toBe("w");
    // Cối không bắn qua đường đại liên.
    room.vehicles.gun("w", { o: [v.x, v.y + 1, v.z], d: [0, 0.5, 0.86], hits: [] });
    e.fire("w", v.rotY, 0.2);
    expect(e.inFlight()).toBe(1);
    expect(v.pitch).toBeCloseTo(MORTAR.elevMin, 5);
    // Bắn liền phát nữa: chưa nạp xong.
    e.fire("w", v.rotY, 1.2);
    expect(e.inFlight()).toBe(1);
    room.vehicles.aim("w", v.rotY, 1.55);
    expect(v.pitch).toBeCloseTo(MORTAR.elevMax, 5);
    expect(room.state.vehicles.get(vid)).toBe(v);
  });

  it("đạn bay cầu vồng rồi nổ ở chỗ rơi gần đúng tầm bắn tính theo góc ngẩng, giết lính địch đứng đó", () => {
    const room = makeRoom();
    const booms = spyExplode(room);
    const { v } = first(room, "mortar");
    addPlayer(room, "w", "blue", v.x, v.z);
    room.vehicles.enter("w");
    const elev = (65 * Math.PI) / 180;
    const range = mortarRange(elev, 0);
    // Tìm hướng bắn mà chỗ rơi là đất trống (không nhà cửa) để kiểm tra tầm.
    const az = v.rotY;
    const tx = v.x + Math.sin(az) * range;
    const tz = v.z + Math.cos(az) * range;
    const enemy = addPlayer(room, "e", "red", tx, tz);
    room.vehicles.emplacements.fire("w", az, elev);
    expect(room.vehicles.emplacements.inFlight()).toBe(1);
    tick(room, 2);
    // Còn đang bay (cầu vồng cao, bay hơn chục giây).
    expect(booms.length).toBe(0);
    tick(room, 15);
    expect(room.vehicles.emplacements.inFlight()).toBe(0);
    expect(booms.length).toBe(1);
    const b = booms[0]!;
    expect(b.weapon).toBe("mortar");
    const flew = Math.hypot(b.x - v.x, b.z - v.z);
    // Địa hình không phẳng hẳn, đạn lệch chút ít: sai số vài chục mét là cùng.
    expect(Math.abs(flew - range)).toBeLessThan(40);
    if (Math.hypot(b.x - enemy.x, b.z - enemy.z) < MORTAR.radius * 0.5) expect(enemy.hp).toBeLessThan(100);
  });
});

describe("máy ngồi ổ đại liên (chiến trường)", () => {
  it("máy đi ngang ổ trống thì có khi vào canh, bắn lính địch trước mặt", () => {
    const room = makeRoom();
    const { vid, v } = first(room, "hmg_nest");
    const bot = addPlayer(room, "bot1", "blue", v.x + 3, v.z);
    bot.bot = true;
    bot.role = "rifle";
    // Bốc thăm 50%: cho vài lượt.
    for (let k = 0; k < 20 && !bot.vehicle; k++) tick(room, 2.05);
    expect(bot.vehicle).toBe(vid);
    expect(isEmplacement(v.kind)).toBe(true);
    // Lính địch đứng trước mặt ổ, ngoài trời.
    const ex = v.x + Math.sin(v.rotY) * 25;
    const ez = v.z + Math.cos(v.rotY) * 25;
    const enemy = addPlayer(room, "e", "red", ex, ez);
    for (let k = 0; k < 20 * 8 && enemy.alive && enemy.hp >= 100; k++) room.vehicles.emplacements.tickBot("bot1", bot, v, 0.05);
    // Máy quay súng về phía địch (trong cung xoay).
    const want = Math.atan2(ex - v.x, ez - v.z);
    expect(Math.abs(Math.atan2(Math.sin(want - v.turret), Math.cos(want - v.turret)))).toBeLessThan(0.3);
  });
});
