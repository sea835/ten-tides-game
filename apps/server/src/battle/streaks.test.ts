import { describe, expect, it } from "vitest";
import { ARTILLERY, JUGGERNAUT, MAX_POINTS, MINIGUN, STREAKS, TACTICAL_POINTS, TOW, UAV, WEAPON, artilleryImpacts, insideBox, minigunRpm, raycastBoxes, towSteer } from "@tentides/content";
import { GroundItemState, Messages, PING_TTL_MS, PlayerState, type PingMessage, type PointsMessage, type StreakFxMessage } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { PING_BURST, validatePing } from "./comms.ts";
import { MatchRewards } from "./rewards.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { awardXp } from "./xp.ts";

// Điểm chi viện chiến thuật: cộng điểm, kiểm tra lần gọi (điểm, thời gian chờ, toạ độ), hẹn giờ mưa pháo, giáp
// Juggernaut + Minigun, tên lửa TOW dẫn đường; và dấu thông minh (đồ dưới đất, vòng chọn) của chuột giữa.

type V3 = [number, number, number];

function makeWar() {
  const room = new BattleRoom();
  const fx: { type: string; msg: unknown }[] = [];
  room.broadcast = ((type: string, msg: unknown) => void fx.push({ type, msg })) as typeof room.broadcast;
  const sent: { to: string; type: string; msg: unknown }[] = [];
  room.clientOf = ((id: string) => ({ send: (type: string, msg: unknown) => sent.push({ to: id, type, msg }) })) as unknown as typeof room.clientOf;
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
    rewards.xp.track(id, p, 0);
  }
  room.war.pickSide("u1", "blue");
  room.war.pickSide("u2", "red");
  room.war.pickSide("u3", "blue");
  room.state.bots = 4;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  for (const [id, q] of room.state.players) if (q.bot) room.state.players.delete(id);
  room.state.vehicles.clear();
  let t = 1_000_000;
  room.streaks.now = () => t;
  let r = 0;
  room.streaks.random = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  return { room, fx, sent, advance: (ms: number) => (t += ms) };
}

/** Một đoạn đất bằng, trống trải dài `len` m theo trục +x. */
function flatLine(room: BattleRoom, len = 60): V3 {
  const w = room.map.world;
  for (let x = -220; x < 220 - len; x += 7)
    for (let z = -200; z < 200; z += 9) {
      const h = w.heightAt(x, z);
      if (h < 1.5) continue;
      let ok = true;
      for (let s = -4; s <= len + 2 && ok; s += 1) {
        for (const dz of [-3, 0, 3]) if (Math.abs(w.heightAt(x + s, z + dz) - h) > 0.15) ok = false;
        if (insideBox(room.map.index, x + s, h + 0.6, z, 3) || insideBox(room.map.index, x + s, h + 1.8, z, 3)) ok = false;
      }
      if (ok && raycastBoxes(room.map.index, [x, h + 1.5, z], [1, 0, 0], len, true) === Infinity && !w.trees.some((tr) => Math.abs(tr.z - z) < 4 && tr.x > x - 4 && tr.x < x + len + 4)) return [x, h, z];
    }
  throw new Error("không tìm được chỗ đất bằng");
}

function place(room: BattleRoom, id: string, at: V3) {
  const p = room.state.players.get(id)!;
  p.alive = true;
  p.hp = 100;
  p.vehicle = "";
  [p.x, p.y, p.z] = at;
  return p;
}

const points = (sent: { to: string; type: string; msg: unknown }[], id: string) => sent.filter((s) => s.to === id && s.type === Messages.points).map((s) => s.msg as PointsMessage);

describe("điểm chiến thuật", () => {
  it("hạ gục, hạ bằng phát vào đầu, chiếm cứ điểm, tiếp tế, phá xe địch được điểm; điểm giữ qua lần gục", () => {
    const { room, sent } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    place(room, "u2", [at[0] + 10, at[1], at[2]]);
    room.kill("u2", "u1", "m416", false);
    expect(u1.gear.tp).toBe(TACTICAL_POINTS.kill);
    place(room, "u2", [at[0] + 10, at[1], at[2]]);
    room.kill("u2", "u1", "m416", true);
    expect(u1.gear.tp).toBe(TACTICAL_POINTS.kill + TACTICAL_POINTS.headshot);
    // Các sự kiện XP khác đi qua awardXp (cả cứ điểm, tiếp tế, sửa xe, hồi sinh).
    awardXp("u1", "capture");
    awardXp("u1", "resupply", 2);
    const before = TACTICAL_POINTS.kill + TACTICAL_POINTS.headshot + TACTICAL_POINTS.capture + 2 * TACTICAL_POINTS.resupply;
    expect(u1.gear.tp).toBe(before);
    // Phá xe phe địch.
    const vid = room.vehicles.spawn(at[0] + 20, at[2], 0, "red");
    room.vehicles.damage(vid, 99999, "u1");
    expect(u1.gear.tp).toBe(before + TACTICAL_POINTS.vehicle);
    expect(points(sent, "u1").at(-1)).toEqual({ kind: "vehicle", amount: TACTICAL_POINTS.vehicle, total: u1.gear.tp });
    // Gục: điểm vẫn còn.
    room.kill("u1", "u2", "m416", false);
    expect(u1.gear.tp).toBe(before + TACTICAL_POINTS.vehicle);
    room.onDispose();
  });

  it("đồng đội hạ nhau, máy, sinh tồn solo, ngoài trận: không có điểm; có trần MAX_POINTS; vào trận mới thì về 0", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    place(room, "u3", [at[0] + 5, at[1], at[2]]);
    room.kill("u3", "u1", "m416", false);
    expect(u1.gear.tp).toBe(0);
    const bot = room.newPlayer();
    bot.bot = true;
    bot.team = "red";
    room.state.players.set("b1", bot);
    expect(room.streaks.earn("b1", "kill")).toBe(0);
    room.state.battleMode = "solo";
    expect(room.streaks.earn("u1", "kill")).toBe(0);
    room.state.battleMode = "war";
    room.state.phase = "prep";
    expect(room.streaks.earn("u1", "kill")).toBe(0);
    room.state.phase = "battle";
    expect(room.streaks.earn("u1", "vehicle", 100)).toBe(MAX_POINTS);
    expect(room.streaks.earn("u1", "kill")).toBe(0);
    room.streaks.clear();
    expect(u1.gear.tp).toBe(0);
    room.onDispose();
  });
});

describe("gọi chi viện: server kiểm tra", () => {
  it("UAV: đủ điểm mới gọi được, trừ điểm, có thời gian chờ, phe không chồng hai UAV; hết giờ thì tắt", () => {
    const { room, fx, advance } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    const u3 = place(room, "u3", [at[0] + 3, at[1], at[2]]);
    u1.gear.tp = STREAKS.uav.cost - 1;
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(false);
    u1.gear.tp = STREAKS.uav.cost * 3;
    u3.gear.tp = STREAKS.uav.cost;
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(true);
    expect(u1.gear.tp).toBe(STREAKS.uav.cost * 2);
    const uav = [...room.state.traps.values()].find((t) => t.defId === "uav")!;
    expect(uav).toMatchObject({ team: "blue", owner: "u1", hp: UAV.seconds });
    expect(fx.find((f) => f.type === Messages.streakFx && (f.msg as StreakFxMessage).kind === "uav")?.msg).toMatchObject({ team: "blue", t: UAV.seconds });
    // Đồng đội cùng phe gọi thêm: phe đã có UAV đang bay.
    expect(room.streaks.call("u3", { kind: "uav" })).toBe(false);
    expect(u3.gear.tp).toBe(STREAKS.uav.cost);
    for (let i = 0; i < (UAV.seconds + 1) * 20; i++) room.streaks.tick(0.05);
    expect([...room.state.traps.values()].some((t) => t.defId === "uav")).toBe(false);
    // Hết UAV nhưng người gọi vẫn còn trong thời gian chờ.
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(false);
    advance(STREAKS.uav.cooldown * 1000);
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(true);
    room.onDispose();
  });

  it("không gọi được khi đã gục, lúc chuẩn bị, ở sinh tồn solo; toạ độ ngoài bản đồ, mưa pháo sát mình, thùng quá xa thì bỏ", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    u1.gear.tp = 5000;
    u1.alive = false;
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(false);
    u1.alive = true;
    room.state.phase = "prep";
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(false);
    room.state.phase = "battle";
    room.state.battleMode = "solo";
    expect(room.streaks.call("u1", { kind: "uav" })).toBe(false);
    room.state.battleMode = "war";
    expect(room.streaks.call("u1", { kind: "artillery" })).toBe(false);
    expect(room.streaks.call("u1", { kind: "artillery", x: 99999, z: 0 })).toBe(false);
    expect(room.streaks.call("u1", { kind: "artillery", x: at[0] + 5, z: at[2] })).toBe(false);
    expect(room.streaks.call("u1", { kind: "airdrop", x: at[0] + 900, z: at[2], pick: "jugg" })).toBe(false);
    expect(u1.gear.tp).toBe(5000);
    expect(room.streaks.call("u1", { kind: "artillery", x: at[0] + 60, z: at[2] })).toBe(true);
    expect(u1.gear.tp).toBe(5000 - STREAKS.artillery.cost);
    room.onDispose();
  });

  it("mưa pháo: khói đỏ ngay, tiếng rít trước mỗi loạt, các loạt nổ đúng giờ, quanh chỗ chấm; xong thì dọn", () => {
    const { room, fx } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    u1.gear.tp = STREAKS.artillery.cost;
    const booms: { t: number; x: number; z: number; owner: string; weapon: string }[] = [];
    let clock = 0;
    room.explode = ((x: number, _y: number, z: number, _k: string, owner: string, _r: number, _d: number, weapon: string) => void booms.push({ t: clock, x, z, owner, weapon })) as typeof room.explode;
    const tx = at[0] + 80;
    const tz = at[2];
    expect(room.streaks.call("u1", { kind: "artillery", x: tx, z: tz })).toBe(true);
    const marker = [...room.state.traps.values()].find((t) => t.defId === "artillery")!;
    expect(marker).toMatchObject({ x: tx, z: tz, team: "blue" });
    const dt = 0.05;
    const salvoAt: number[] = [];
    for (let i = 0; i < 400; i++) {
      clock += dt;
      const n = fx.length;
      room.streaks.tick(dt);
      for (const f of fx.slice(n)) if ((f.msg as StreakFxMessage).kind === "salvo") salvoAt.push(clock);
    }
    const impacts = artilleryImpacts();
    expect(booms.length).toBe(ARTILLERY.salvos * ARTILLERY.shells);
    // Không nổ trước hết giờ báo động; mỗi loạt nổ trong một tick của giờ đã hẹn.
    expect(Math.min(...booms.map((b) => b.t))).toBeGreaterThanOrEqual(ARTILLERY.warn - 1e-6);
    for (let k = 0; k < ARTILLERY.salvos; k++) {
      const group = booms.slice(k * ARTILLERY.shells, (k + 1) * ARTILLERY.shells);
      for (const b of group) {
        expect(b.t).toBeGreaterThanOrEqual(impacts[k]! - 1e-6);
        expect(b.t).toBeLessThan(impacts[k]! + dt + 1e-6);
        expect(Math.hypot(b.x - tx, b.z - tz)).toBeLessThanOrEqual(ARTILLERY.spread + 1e-6);
        expect(b).toMatchObject({ owner: "u1", weapon: "artillery" });
      }
      // Tiếng rít báo trước chừng ARTILLERY.whistle giây.
      expect(salvoAt[k]!).toBeCloseTo(impacts[k]! - ARTILLERY.whistle, 1);
    }
    expect([...room.state.traps.values()].some((t) => t.defId === "artillery")).toBe(false);
    room.onDispose();
  });
});

describe("thùng chi viện: Juggernaut, Minigun, TOW", () => {
  it("thả dù tới chỗ chọn, chạm đất đổ đúng đồ; nhặt giáp Juggernaut: chịu đòn gấp ba, có Minigun; gục thì mất, Minigun không rơi", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    u1.gear.tp = STREAKS.airdrop.cost;
    expect(room.streaks.call("u1", { kind: "airdrop", x: at[0] + 30, z: at[2], pick: "jugg" })).toBe(true);
    expect(u1.gear.tp).toBe(0);
    expect(room.state.airdrops.size).toBe(1);
    for (let i = 0; i < 30 * 20; i++) room.airdrops.tick(0.05);
    const drop = [...room.state.airdrops.values()][0]!;
    expect(drop.landed).toBe(true);
    expect(Math.hypot(drop.x - (at[0] + 30), drop.z - at[2])).toBeLessThan(35);
    const key = [...room.state.groundItems.entries()].find(([, g]) => g.itemId === "jugg")?.[0];
    expect(key).toBeTruthy();
    const g = room.state.groundItems.get(key!)!;
    place(room, "u1", [g.x, g.y, g.z]);
    (room as unknown as { pickup: (id: string, key: string) => void }).pickup("u1", key!);
    expect(u1.gear.jugg).toBe(true);
    expect([u1.kit.primary1, u1.kit.primary2]).toContain("minigun");
    expect(room.state.groundItems.has(key!)).toBe(false);
    // Đã mặc rồi thì không nhặt thêm bộ nữa.
    expect(room.streaks.wear(u1)).toBeNull();
    // Chịu đòn gấp ba (bỏ áo giáp thường ra cho dễ tính).
    const u2 = place(room, "u2", [at[0] + 50, at[1], at[2]]);
    u1.kit.armor = u1.kit.helmet = 0;
    room.damage("u1", 60, "body", "u2", "m416");
    expect(u1.hp).toBe(100 - Math.round(60 / JUGGERNAUT.soak));
    // Vùng độc thì không đỡ.
    room.damage("u1", 10, "zone", "", "zone");
    expect(u1.hp).toBe(100 - Math.round(60 / JUGGERNAUT.soak) - 10);
    room.kill("u1", "u2", "m416", false);
    void u2;
    expect(u1.gear.jugg).toBe(false);
    expect([...room.state.groundItems.values()].some((x) => x.itemId === "minigun")).toBe(false);
    room.onDispose();
  });

  it("Minigun: không mặc giáp thì không bắn được; đầu loạt bắn chậm, tăng dần tới đủ tốc độ; thả cò lâu thì quay lại từ đầu", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const u1 = place(room, "u1", at);
    const def = WEAPON.get("minigun")!;
    expect(room.streaks.allowShot("u1", u1, def, 0)).toBe(false);
    u1.gear.jugg = true;
    const full = 60000 / def.rpm;
    expect(room.streaks.allowShot("u1", u1, def, 1000)).toBe(true);
    // Phát hai ngay theo nhịp tối đa: nòng chưa quay đủ nhanh.
    expect(room.streaks.allowShot("u1", u1, def, 1000 + full)).toBe(false);
    expect(room.streaks.allowShot("u1", u1, def, 1000 + 60000 / minigunRpm(def.rpm, 0))).toBe(true);
    let t = 1000 + 60000 / minigunRpm(def.rpm, 0);
    while (t < 1000 + MINIGUN.ramp) {
      t += 60000 / minigunRpm(def.rpm, t - 1000);
      expect(room.streaks.allowShot("u1", u1, def, t)).toBe(true);
    }
    // Đủ vòng quay: bắn đúng nhịp tối đa.
    t += full;
    expect(room.streaks.allowShot("u1", u1, def, t)).toBe(true);
    // Thả cò lâu: loạt mới lại chậm.
    t += MINIGUN.idle + 50;
    expect(room.streaks.allowShot("u1", u1, def, t)).toBe(true);
    expect(room.streaks.allowShot("u1", u1, def, t + full)).toBe(false);
    // Súng thường không bị ảnh hưởng.
    expect(room.streaks.allowShot("u1", u1, WEAPON.get("m416")!, 0)).toBe(true);
    expect(minigunRpm(def.rpm, 0)).toBeCloseTo(def.rpm * MINIGUN.start);
    expect(minigunRpm(def.rpm, MINIGUN.ramp * 2)).toBe(def.rpm);
    room.onDispose();
  });

  it("TOW: tên lửa bay theo tâm ngắm khi còn giữ dây, mất dây thì bay thẳng; trúng xe tăng thì xe mất máu, nổ", () => {
    const { room } = makeWar();
    const at = flatLine(room, 70);
    const u1 = place(room, "u1", at);
    u1.kit.primary1 = "tow";
    u1.kit.active = "primary1";
    const tow = WEAPON.get("tow")!;
    const eye: V3 = [at[0], at[1] + 1.5, at[2]];
    // Phóng thẳng theo +x, rồi ngắm lệch sang +z: tên lửa bẻ lái theo.
    expect(room.streaks.guided("u1", tow, eye, [1, 0, 0])).toBe(true);
    const ps = [...room.state.projectiles.values()].find((p) => p.itemId === "tow")!;
    expect(ps).toBeTruthy();
    const aim: V3 = [Math.cos(0.15), 0, Math.sin(0.15)];
    for (let i = 0; i < 6; i++) {
      expect(room.streaks.steer("u1", { o: eye, d: aim })).toBe(true);
      room.streaks.tick(0.05);
    }
    expect(ps.z).toBeGreaterThan(at[2] + 0.2);
    // Lệnh lái từ chỗ khác xa người bắn: bỏ.
    expect(room.streaks.steer("u1", { o: [eye[0] + 40, eye[1], eye[2]], d: aim })).toBe(false);
    room.state.projectiles.clear();
    room.streaks.tick(0.05);

    // Mất dây (thả chuột, không gửi lệnh lái): bay thẳng.
    expect(room.streaks.guided("u1", tow, eye, [1, 0, 0])).toBe(true);
    const ps2 = [...room.state.projectiles.values()].find((p) => p.itemId === "tow")!;
    for (let i = 0; i < 12; i++) room.streaks.tick(0.05);
    expect(Math.abs(ps2.z - at[2])).toBeLessThan(1e-3);
    room.state.projectiles.clear();
    room.streaks.tick(0.05);

    // Xe tăng địch phía trước: tên lửa đâm vào, xe mất máu theo giáp hông.
    const vid = room.vehicles.spawn(at[0] + 40, at[2], 0, "red");
    const v = room.state.vehicles.get(vid)!;
    const hp = v.hp;
    const booms: string[] = [];
    const explode = room.explode.bind(room);
    room.explode = ((...args: Parameters<typeof room.explode>) => {
      booms.push(args[7] ?? "");
      explode(...args);
    }) as typeof room.explode;
    expect(room.streaks.guided("u1", tow, [eye[0], at[1] + 1.4, eye[2]], [1, 0, 0])).toBe(true);
    for (let i = 0; i < TOW.life * 20 && !booms.length; i++) room.streaks.tick(0.05);
    expect(booms).toEqual(["tow"]);
    expect(v.hp).toBeLessThan(hp - tow.explosive!.armor * 0.5);
    expect([...room.state.projectiles.values()].some((p) => p.itemId === "tow")).toBe(false);
    room.onDispose();
  });

  it("towSteer: bẻ lái không quá giới hạn mỗi nhịp, tới đúng hướng thì giữ", () => {
    const dir: V3 = [1, 0, 0];
    const out = towSteer(dir, [10, 0, 0], [0, 0, 0], [0, 0, 1], 0.1);
    expect(Math.acos(out[0] * dir[0] + out[1] * dir[1] + out[2] * dir[2])).toBeCloseTo(0.1, 2);
    expect(Math.hypot(...out)).toBeCloseTo(1);
    const straight = towSteer(dir, [10, 0, 0], [0, 0, 0], [1, 0, 0], 0.1);
    expect(straight[0]).toBeCloseTo(1);
  });
});

describe("dấu thông minh (chuột giữa)", () => {
  it("dấu đồ dưới đất: món đồ còn ở đó thì báo đúng món, không thì thành dấu chỗ; các ô vòng chọn giữ nguyên loại", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    place(room, "u1", at);
    const g = new GroundItemState();
    g.itemId = "armor:3";
    [g.x, g.y, g.z] = [at[0] + 10, at[1], at[2]];
    room.state.groundItems.set("g900", g);
    const m: PingMessage = { kind: "loot", x: at[0] + 10.5, y: at[1], z: at[2], item: "g900" };
    expect(validatePing(room.state, "u1", m, room.map.half)).toMatchObject({ kind: "loot", item: "armor:3", x: g.x, z: g.z, ttl: PING_TTL_MS.loot });
    expect(validatePing(room.state, "u1", { ...m, item: "g901" }, room.map.half)).toMatchObject({ kind: "spot" });
    expect(validatePing(room.state, "u1", { ...m, x: at[0] + 30 }, room.map.half)).toMatchObject({ kind: "spot" });
    expect(validatePing(room.state, "u1", { ...m, x: at[0] + 30 }, room.map.half)?.item).toBeUndefined();
    for (const kind of ["attack", "defend", "coming", "armor", "seen", "careful"] as const)
      expect(validatePing(room.state, "u1", { kind, x: at[0] + 20, y: at[1], z: at[2] }, room.map.half)).toMatchObject({ kind, ttl: PING_TTL_MS[kind] });
    room.onDispose();
  });

  it("chặn spam: tối đa PING_BURST.count dấu trong PING_BURST.ms", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    place(room, "u1", at);
    const m: PingMessage = { kind: "attack", x: at[0] + 20, y: at[1], z: at[2] };
    let t = 50_000;
    for (let i = 0; i < PING_BURST.count; i++, t += 600) expect(room.comms.ping("u1", m, t)).not.toBeNull();
    expect(room.comms.ping("u1", m, t)).toBeNull();
    expect(room.comms.ping("u1", m, t + PING_BURST.ms)).not.toBeNull();
    room.onDispose();
  });
});
