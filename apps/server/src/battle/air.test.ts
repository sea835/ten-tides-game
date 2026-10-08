import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELI, IGLA_LOCK, MISSILE, WAR_HELIPADS, heliGround, isBoat } from "@tentides/content";
import { PlayerState, type VehicleState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { receive } from "./kit.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

/** Chiến trường không mạng, đã bày xe, đang giữa trận. */
function warRoom() {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
  room.state.bots = 4;
  (room as unknown as { startMatch: () => void }).startMatch();
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

function heliOf(room: BattleRoom, team: string): [string, VehicleState] {
  const e = [...room.state.vehicles.entries()].find(([, v]) => v.kind === "heli" && v.team === team);
  if (!e) throw new Error("không có trực thăng");
  return e;
}

const tick = (room: BattleRoom, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) room.vehicles.tick(0.05);
};

let now = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  now = 1_000_000;
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const advance = (ms: number) => {
  now += ms;
  vi.setSystemTime(now);
};

/** Đưa trực thăng `v` (phi công `pid`) bay lên độ cao `alt` qua các gói vị trí hợp lệ. */
function climb(room: BattleRoom, pid: string, v: VehicleState, alt: number) {
  const top = heliGround(room.map, v.x, v.z) + alt;
  while (v.y < top - 0.01) {
    advance(100);
    room.vehicles.move(pid, { x: v.x, y: Math.min(top, v.y + 0.85), z: v.z, rotY: v.rotY, turret: 0, pitch: 0, moving: true, tilt: 0, roll: 0, impact: 0 });
  }
}

describe("chiến trường: trực thăng ở sân đỗ, xuồng cao tốc ở bờ biển", () => {
  it("mỗi phe một trực thăng ở sân đỗ căn cứ (đầy rocket, pháo sáng), có xuồng cao tốc trên nước", () => {
    const room = warRoom();
    for (const side of ["blue", "red"] as const) {
      const [, v] = heliOf(room, side);
      expect(Math.hypot(v.x - WAR_HELIPADS[side].x, v.z - WAR_HELIPADS[side].z)).toBeLessThan(30);
      expect(v.rockets).toBe(HELI.rockets);
      expect(v.flares).toBe(HELI.flares);
      expect(v.driver).toBe("");
    }
    const rhibs = [...room.state.vehicles.values()].filter((v) => v.kind === "rhib");
    expect(rhibs.length).toBeGreaterThanOrEqual(1);
    for (const r of rhibs) expect(room.map.world.heightAt(r.x, r.z)).toBeLessThan(-0.3);
    expect(isBoat("rhib")).toBe(true);
  });

  it("tắt xe cơ giới thì không có trực thăng", () => {
    const room = new BattleRoom();
    room.broadcast = (() => {}) as typeof room.broadcast;
    room.state.battleMode = "war";
    room.state.settings.vehiclesEnabled = false;
    room.bots = new Bots(room);
    room.vehicles = new Vehicles(room);
    room.war = new War(room);
    (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
    room.state.bots = 4;
    (room as unknown as { startMatch: () => void }).startMatch();
    expect([...room.state.vehicles.values()].some((v) => v.kind === "heli" || v.kind === "rhib")).toBe(false);
  });
});

describe("trực thăng: tổ lái, bay, va chạm, rocket", () => {
  it("phi công + hai xạ thủ cửa; súng cửa phải xoay riêng, chỉ trong cung bắn của cửa", () => {
    const room = warRoom();
    const [vid, v] = heliOf(room, "blue");
    for (const id of ["p", "g1", "g2"]) addPlayer(room, id, "blue", v.x + 2, v.z);
    room.vehicles.enter("p");
    room.vehicles.enter("g1");
    room.vehicles.enter("g2");
    expect(v.driver).toBe("p");
    expect(room.vehicles.seatOf(v, "g1")).toBe(1);
    expect(room.vehicles.seatOf(v, "g2")).toBe(2);
    expect(room.state.players.get("g2")!.vehicle).toBe(vid);
    // Cửa phải (ghế 2) nhìn về bên phải thân: rotY − π/2; ngắm sang trái thì bị kẹp về mép cung.
    room.vehicles.aim("g2", v.rotY - Math.PI / 2 + 0.2, -0.6);
    expect(v.turret2).toBeCloseTo(v.rotY - Math.PI / 2 + 0.2, 4);
    expect(v.pitch2).toBeCloseTo(-0.6, 4);
    const before = v.turret;
    room.vehicles.aim("g2", v.rotY + Math.PI / 2, 0);
    expect(Math.abs(Math.atan2(Math.sin(v.turret2 - (v.rotY - Math.PI / 2)), Math.cos(v.turret2 - (v.rotY - Math.PI / 2))))).toBeLessThanOrEqual(1.36);
    expect(v.turret).toBe(before);
  });

  it("server nhận gói bay hợp lệ, kéo lại gói quá nhanh; rơi mạnh xuống đất thì nổ, tổ lái chết", () => {
    const room = warRoom();
    const [, v] = heliOf(room, "red");
    addPlayer(room, "p", "red", v.x + 2, v.z);
    addPlayer(room, "g", "red", v.x - 2, v.z);
    room.vehicles.enter("p");
    room.vehicles.enter("g");
    climb(room, "p", v, 30);
    expect(v.y - heliGround(room.map, v.x, v.z)).toBeGreaterThan(29);
    // Người ngồi bay theo.
    expect(room.state.players.get("g")!.y).toBeGreaterThan(v.y);
    const x0 = v.x;
    advance(100);
    room.vehicles.move("p", { x: v.x + 40, y: v.y, z: v.z, rotY: v.rotY, turret: 0, pitch: 0, moving: true });
    expect(v.x).toBe(x0);
    // Lao thẳng xuống: máy phi công báo va chạm 25 m/s.
    advance(100);
    room.vehicles.move("p", { x: v.x, y: Math.max(heliGround(room.map, v.x, v.z), v.y - 1.5), z: v.z, rotY: v.rotY, turret: 0, pitch: 0, moving: true, impact: 25 });
    expect(v.hp).toBe(0);
    expect(room.state.players.get("p")!.alive).toBe(false);
    expect(room.state.players.get("g")!.alive).toBe(false);
  });

  it("phi công bắn rocket mũi: trừ rocket, giãn cách giữa hai quả; đáp ở sân đỗ nhà thì nạp lại", () => {
    const room = warRoom();
    const [, v] = heliOf(room, "blue");
    addPlayer(room, "p", "blue", v.x + 2, v.z);
    room.vehicles.enter("p");
    room.vehicles.fire("p", 0, 0);
    expect(v.rockets).toBe(HELI.rockets - 1);
    room.vehicles.fire("p", 0, 0);
    expect(v.rockets).toBe(HELI.rockets - 1);
    advance(HELI.rocketGap * 1000 + 10);
    room.vehicles.fire("p", 0, 0);
    expect(v.rockets).toBe(HELI.rockets - 2);
    v.rockets = 0;
    v.flares = 0;
    tick(room, 5);
    expect(v.rockets).toBeGreaterThan(0);
    expect(v.flares).toBeGreaterThan(0);
  });
});

describe("IGLA: khoá mục tiêu, cảnh báo, tên lửa, pháo sáng", () => {
  /** Trực thăng đỏ bay cao, lính xanh cầm IGLA đứng cách 120 m. */
  function setup() {
    const room = warRoom();
    const [vid, v] = heliOf(room, "red");
    addPlayer(room, "pilot", "red", v.x + 2, v.z);
    room.vehicles.enter("pilot");
    climb(room, "pilot", v, 45);
    const shooter = addPlayer(room, "aa", "blue", v.x - 120, v.z);
    shooter.y = room.map.world.heightAt(shooter.x, shooter.z);
    receive(shooter.kit, "igla", []);
    receive(shooter.kit, "ammo:missile:2", []);
    return { room, vid, v, shooter };
  }

  /** Giữ tâm ngắm liên tục `seconds` giây (gói 5 lần / giây). */
  function hold(room: BattleRoom, vid: string, seconds: number) {
    room.vehicles.air.lock("aa", vid);
    for (let t = 0; t < seconds; t += 0.2) {
      advance(200);
      room.vehicles.air.lock("aa", vid);
    }
  }

  it("giữ tâm ~1,5 giây: tổ lái thấy cảnh báo đang ngắm rồi bị khoá; bắn thì tên lửa đuổi trúng trực thăng", () => {
    const { room, vid, v, shooter } = setup();
    expect(room.vehicles.air.canLock("aa", vid)).toBe(true);
    room.vehicles.air.lock("aa", vid);
    advance(200);
    room.vehicles.air.lock("aa", vid);
    expect(v.alert).toBe(1);
    hold(room, vid, IGLA_LOCK.time);
    expect(v.alert).toBe(2);
    // Hết pháo sáng (không tự thả được): tên lửa đuổi trúng.
    v.flares = 0;
    // Bắn qua đường bắn chung (BattleRoom.fire): hướng hơi lệch, tên lửa tự bẻ về mục tiêu.
    const o: [number, number, number] = [shooter.x, shooter.y + 1.5, shooter.z];
    const d = [v.x - o[0], v.y + 10 - o[1], v.z + 15 - o[2]];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    room.fire("aa", "igla", o, [[d[0]! / l, d[1]! / l, d[2]! / l]], []);
    expect(room.vehicles.air.flying.length).toBe(1);
    room.vehicles.tick(0.05);
    expect(v.alert).toBe(3);
    tick(room, 3);
    expect(room.vehicles.air.flying.length).toBe(0);
    expect(v.hp).toBeLessThanOrEqual(HELI.hp - MISSILE.armor);
    expect(v.alert).toBe(0);
  });

  it("tên lửa bay tới gần mà phi công chưa thả pháo sáng: tự thả, tên lửa bị mồi, trực thăng không mất máu", () => {
    const { room, vid, v } = setup();
    hold(room, vid, IGLA_LOCK.time + 0.1);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const flares = v.flares;
    room.vehicles.air.fireMissile("aa", [v.x - 118, v.y - 40, v.z], [0.94, 0.33, 0]);
    expect(room.vehicles.air.flying[0]!.target).toBe(vid);
    tick(room, 4);
    expect(v.flares).toBe(flares - 1);
    expect(v.hp).toBe(HELI.hp);
  });

  it("chưa khoá đủ lâu thì tên lửa bay thẳng, không đuổi; đồng đội không khoá được trực thăng phe mình", () => {
    const { room, vid, v } = setup();
    hold(room, vid, 0.4);
    room.vehicles.air.fireMissile("aa", [v.x - 118, v.y, v.z + 30], [1, 0, 0]);
    expect(room.vehicles.air.flying[0]!.target).toBe("");
    const mate = addPlayer(room, "mate", "red", v.x - 100, v.z);
    receive(mate.kit, "igla", []);
    expect(room.vehicles.air.canLock("mate", vid)).toBe(false);
  });

  it("thả pháo sáng: cắt khoá đang giữ, mồi tên lửa đang bay (trực thăng không mất máu)", () => {
    const { room, vid, v } = setup();
    hold(room, vid, IGLA_LOCK.time + 0.1);
    expect(v.alert).toBe(2);
    room.vehicles.air.fireMissile("aa", [v.x - 118, v.y - 40, v.z], [0.94, 0.33, 0]);
    expect(room.vehicles.air.flying[0]!.target).toBe(vid);
    vi.spyOn(Math, "random").mockReturnValue(0);
    room.vehicles.air.flare("pilot");
    expect(v.flares).toBe(HELI.flares - 1);
    expect(room.vehicles.air.flying[0]!.target).toBe("");
    expect(room.vehicles.air.lockOf("aa")).toBeNull();
    // Trong lúc pháo sáng cháy không khoá lại được; pháo sáng có thời gian chờ.
    expect(room.vehicles.air.canLock("aa", vid)).toBe(false);
    room.vehicles.air.flare("pilot");
    expect(v.flares).toBe(HELI.flares - 1);
    // Trực thăng bay ngang đi chỗ khác, tên lửa đuổi theo đám pháo sáng rồi nổ.
    for (let k = 0; k < 10; k++) {
      advance(100);
      room.vehicles.move("pilot", { x: v.x, y: v.y, z: v.z + 4, rotY: v.rotY, turret: 0, pitch: 0, moving: true, tilt: 0.2, roll: 0, impact: 0 });
      tick(room, 0.1);
    }
    tick(room, 6);
    expect(room.vehicles.air.flying.length).toBe(0);
    expect(v.hp).toBe(HELI.hp);
  });
});
