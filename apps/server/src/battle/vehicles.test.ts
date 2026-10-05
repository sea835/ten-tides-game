import { describe, expect, it } from "vitest";
import { HMG, JEEP, MINE, TANK, TRACKS_SECONDS, WEAPON, WRECK_SECONDS, makeRand, mountMuzzle, seatPos } from "@tentides/content";
import { PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";

/** Phòng Battleground không mạng, đang giữa trận (đồng đội), chưa có ai. */
function makeRoom(seed = 4242) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(seed);
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.state.battleMode = "squad";
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

const tick = (room: BattleRoom, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) room.vehicles.tick(0.05);
};

describe("xe tăng: giáp theo góc, đứt xích, xác xe cháy", () => {
  it("2 phát RPG vào đuôi xe đầy máu là nổ; vào giáp trước thì chỉ xước", () => {
    const room = makeRoom();
    const spot = room.vehicles.findSpot(0, 0, 0, 150, makeRand(1))!;
    const vid = room.vehicles.spawn(spot.x, spot.z, spot.rotY, "red");
    const v = room.state.vehicles.get(vid)!;
    addPlayer(room, "at", "blue", spot.x + 200, spot.z);
    const rpg = WEAPON.get("rpg7")!;
    const shoot = (from: number) => {
      // Bắn từ sát vỏ xe (đuôi: from = −1, mũi: from = 1) thẳng vào thân, ngang hông xe.
      const fx = Math.sin(v.rotY) * from;
      const fz = Math.cos(v.rotY) * from;
      const o: [number, number, number] = [v.x + fx * (TANK.half[2] + 6), v.y + 1.2, v.z + fz * (TANK.half[2] + 6)];
      room.vehicles.launch("at", o, [-fx, 0, -fz], rpg.velocity, rpg.explosive!, rpg.id);
      tick(room, 0.3);
    };
    shoot(1);
    expect(v.hp).toBeGreaterThan(TANK.hp - rpg.explosive!.armor * 0.5);
    expect(v.hp).toBeLessThan(TANK.hp);
    v.hp = TANK.hp;
    shoot(-1);
    expect(v.hp).toBeGreaterThan(0);
    shoot(-1);
    expect(v.hp).toBe(0);
    // Xác xe nằm lại cháy một lúc (vẫn còn trong state để chặn đạn) rồi mới dọn đi.
    tick(room, WRECK_SECONDS - 5);
    expect(room.state.vehicles.has(vid)).toBe(true);
    tick(room, 6);
    expect(room.state.vehicles.has(vid)).toBe(false);
  });

  it("mìn nổ dưới xích: đứt xích TRACKS_SECONDS giây, người lái không chạy đi được (chỉ quay)", () => {
    const room = makeRoom();
    const spot = room.vehicles.findSpot(0, 0, 0, 150, makeRand(2))!;
    addPlayer(room, "drv", "blue", spot.x, spot.z);
    const vid = room.vehicles.spawn(spot.x, spot.z, spot.rotY, "blue", "drv");
    const v = room.state.vehicles.get(vid)!;
    room.explode(v.x + Math.cos(v.rotY) * TANK.half[0], v.y + 0.2, v.z - Math.sin(v.rotY) * TANK.half[0], "mine", "", MINE.radius, MINE.damage);
    expect(v.tracks).toBe(TRACKS_SECONDS);
    expect(v.hp).toBeGreaterThan(0);
    const before = { x: v.x, z: v.z };
    room.vehicles.move("drv", { x: v.x + Math.sin(v.rotY) * 1.5, y: v.y, z: v.z + Math.cos(v.rotY) * 1.5, rotY: v.rotY, turret: 0, pitch: 0, moving: true });
    expect(v.x).toBe(before.x);
    room.vehicles.move("drv", { x: v.x, y: v.y, z: v.z, rotY: v.rotY + 0.3, turret: 0, pitch: 0, moving: false });
    expect(v.rotY).toBeCloseTo(spot.rotY + 0.3, 5);
    tick(room, TRACKS_SECONDS + 0.2);
    expect(v.tracks).toBe(0);
  });
});

describe("xe trinh sát: ghế, đại liên, đạn thường làm hư", () => {
  it("lên xe vào ghế lái, đồng đội vào ghế trống, đổi ghế, địch không lên được", () => {
    const room = makeRoom();
    const spot = room.vehicles.findSpot(0, 0, 0, 150, makeRand(3), "jeep")!;
    const vid = room.vehicles.spawn(spot.x, spot.z, spot.rotY, "", "", "jeep");
    const v = room.state.vehicles.get(vid)!;
    addPlayer(room, "a", "t1", spot.x + 1, spot.z);
    addPlayer(room, "b", "t1", spot.x - 1, spot.z);
    addPlayer(room, "e", "t2", spot.x, spot.z + 1);
    room.vehicles.enter("a");
    expect(v.driver).toBe("a");
    room.vehicles.enter("b");
    expect(room.vehicles.seatOf(v, "b")).toBe(1);
    room.vehicles.enter("e");
    expect(room.state.players.get("e")!.vehicle).toBe("");
    room.vehicles.switchSeat("b", 2);
    expect(room.vehicles.seatOf(v, "b")).toBe(2);
    // Ghế đang có người thì không đổi vào được.
    room.vehicles.switchSeat("b", 0);
    expect(room.vehicles.seatOf(v, "b")).toBe(2);
    // Người ngồi đi theo ghế của mình.
    tick(room, 0.05);
    const at = seatPos("jeep", v, 2);
    expect(Math.hypot(room.state.players.get("b")!.x - at[0], room.state.players.get("b")!.z - at[2])).toBeLessThan(0.01);
    // Lái quá tốc độ xe thì bị kéo lại.
    room.vehicles.move("a", { x: v.x + Math.sin(v.rotY) * 40, y: v.y, z: v.z + Math.cos(v.rotY) * 40, rotY: v.rotY, turret: 0, pitch: 0, moving: true });
    expect(v.x).toBe(spot.x);
    // Xuống xe: ra ngoài thân xe.
    room.vehicles.exit("a");
    const pa = room.state.players.get("a")!;
    expect(v.driver).toBe("");
    expect(pa.vehicle).toBe("");
    expect(Math.hypot(pa.x - v.x, pa.z - v.z)).toBeGreaterThan(JEEP.half[0]);
  });

  it("xạ thủ bắn đại liên trúng lính địch (server dò lại), đạn thường làm hư xe trinh sát; xe nổ thì người trên xe chết", () => {
    const room = makeRoom();
    const spot = room.vehicles.findSpot(0, 0, 0, 150, makeRand(5), "jeep")!;
    const vid = room.vehicles.spawn(spot.x, spot.z, spot.rotY, "", "", "jeep");
    const v = room.state.vehicles.get(vid)!;
    addPlayer(room, "g", "t1", spot.x, spot.z);
    room.vehicles.enter("g");
    room.vehicles.switchSeat("g", 2);
    const m = mountMuzzle("jeep", v, 0, 0);
    // Lính địch đứng ngay bên cạnh xe, ngang tầm nòng.
    const ex = m.pivot[0] + 6;
    const ez = m.pivot[2];
    const enemy = addPlayer(room, "e", "t2", ex, ez);
    enemy.y = m.pivot[1] - 1.2;
    const o = mountMuzzle("jeep", v, Math.PI / 2, 0).o;
    const d: [number, number, number] = [ex - o[0], enemy.y + 1.2 - o[1], ez - o[2]];
    const len = Math.hypot(...d);
    room.vehicles.gun("g", { o, d, hits: [{ target: "e", part: "body", d: len - 0.3, ray: 0 }] });
    expect(enemy.hp).toBeLessThan(100);
    expect(enemy.hp).toBeGreaterThan(100 - HMG.damage - 1);
    // Bắn ngay phát nữa: quá nhịp bắn, bỏ qua.
    const hp = enemy.hp;
    room.vehicles.gun("g", { o, d, hits: [{ target: "e", part: "body", d: len - 0.3, ray: 0 }] });
    expect(enemy.hp).toBe(hp);
    // Ghế khác không bắn đại liên được.
    addPlayer(room, "p", "t1", spot.x, spot.z);
    room.vehicles.enter("p");
    expect(room.vehicles.seatOf(v, "p")).toBe(0);
    // Đạn súng trường găm vỏ xe trinh sát: mất máu rõ rệt (xe tăng thì gần như không).
    const before = v.hp;
    room.vehicles.bulletHit(vid, 40, "e", "m416", "side", 1);
    expect(before - v.hp).toBeGreaterThan(10);
    room.vehicles.damage(vid, 10000, "e", "rpg7");
    expect(v.hp).toBe(0);
    expect(room.state.players.get("g")!.alive).toBe(false);
    expect(room.state.players.get("p")!.alive).toBe(false);
  });
});

describe("chiến trường: xe trinh sát ở căn cứ, thuyền ngoài bờ biển", () => {
  it("mỗi phe 2 xe trinh sát, 2 thuyền nằm trên nước, xe tăng vẫn đủ người lái", () => {
    const room = new BattleRoom();
    room.broadcast = (() => {}) as typeof room.broadcast;
    room.state.battleMode = "war";
    room.bots = new Bots(room);
    room.vehicles = new Vehicles(room);
    room.war = new War(room);
    (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
    room.state.bots = 10;
    (room as unknown as { startMatch: () => void }).startMatch();
    const all = [...room.state.vehicles.values()];
    const jeeps = all.filter((v) => v.kind === "jeep");
    const boats = all.filter((v) => v.kind === "boat");
    expect(jeeps.filter((v) => v.team === "blue").length).toBe(2);
    expect(jeeps.filter((v) => v.team === "red").length).toBe(2);
    expect(boats.length).toBe(2);
    for (const b of boats) expect(room.map.world.heightAt(b.x, b.z)).toBeLessThan(-0.5);
    // Một thuyền neo gần Nhà máy Xi măng (G).
    expect(boats.some((b) => Math.hypot(b.x - 160, b.z + 125) < 180)).toBe(true);
    for (const v of all.filter((x) => x.kind === "tank")) expect(v.driver).not.toBe("");
    for (const v of [...jeeps, ...boats]) expect(v.driver).toBe("");
  });
});

describe("đảo sinh tồn: xe trinh sát, thuyền bỏ trống", () => {
  it("có xe trinh sát trên đất, thuyền trên biển; máy không tự lên xe trinh sát", () => {
    const room = makeRoom(99);
    room.state.phase = "lobby";
    const p = new PlayerState();
    p.name = "P";
    p.created = true;
    room.state.players.set("human0", p);
    room.state.bots = 10;
    (room as unknown as { startMatch: () => void }).startMatch();
    const all = [...room.state.vehicles.values()];
    expect(all.filter((v) => v.kind === "jeep").length).toBeGreaterThanOrEqual(2);
    expect(all.filter((v) => v.kind === "boat").length).toBeGreaterThanOrEqual(1);
    for (const v of all.filter((x) => x.kind === "boat")) expect(room.map.world.heightAt(v.x, v.z)).toBeLessThan(-0.5);
    const r = room as unknown as { tick: (dt: number) => void; beginBattle: () => void };
    r.beginBattle();
    for (let k = 0; k < 20 * 20; k++) r.tick(0.05);
    for (const v of room.state.vehicles.values()) if (v.kind !== "tank") expect(v.driver).toBe("");
  });
});
