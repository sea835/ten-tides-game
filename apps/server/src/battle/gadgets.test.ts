import { describe, expect, it } from "vitest";
import { ADRENALINE, AMMO_BOX, AT_MINE, CLASSES, GADGET_ID_LIST, GADGETS, REPAIR, SANDBAG, SOLDIER_CLASS_IDS, TANK, XP_AWARD, classOfRole, insideBox, raycastBoxes } from "@tentides/content";
import { GADGET_IDS, MAX_RUN_SPEED, MAX_SPEED_BOOST, PlayerState, SOLDIER_CLASSES, type GadgetMessage } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { receive, resetKit } from "./kit.ts";
import { MatchRewards } from "./rewards.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { isPlausibleMove } from "../movement.ts";

// Khí tài bốn lớp lính: server kiểm tra từng lần dùng (đúng lớp, đang cầm, còn lượt, thời gian chờ, đứng đúng chỗ,
// tầm nhìn) rồi mới tác động lên trận.

type V3 = [number, number, number];

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
    rewards.xp.track(id, p, 0);
  }
  room.war.pickSide("u1", "blue");
  room.war.pickSide("u2", "red");
  room.war.pickSide("u3", "blue");
  room.state.bots = 4;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  // Dọn chiến trường cho thử nghiệm: máy gục hết, xe về chỗ khác.
  for (const [id, q] of room.state.players) if (q.bot) room.state.players.delete(id);
  room.state.vehicles.clear();
  let t = 1_000_000;
  room.gadgets.now = () => t;
  return { room, rewards, advance: (ms: number) => (t += ms) };
}

/** Một đoạn đất bằng, trống trải dài `len` m theo trục +x (để đặt người, bao cát, nhìn xa). */
function flatLine(room: BattleRoom, len = 36): V3 {
  const w = room.map.world;
  for (let x = -220; x < 220 - len; x += 7)
    for (let z = -200; z < 200; z += 9) {
      const h = w.heightAt(x, z);
      if (h < 1.5) continue;
      let ok = true;
      for (let s = -4; s <= len + 2 && ok; s += 1) {
        for (const dz of [-2, 0, 2]) if (Math.abs(w.heightAt(x + s, z + dz) - h) > 0.12) ok = false;
        if (insideBox(room.map.index, x + s, h + 0.6, z, 2.5) || insideBox(room.map.index, x + s, h + 1.8, z, 2.5)) ok = false;
      }
      if (ok && raycastBoxes(room.map.index, [x, h + 0.3, z], [1, 0, 0], len, true) === Infinity) return [x, h, z];
    }
  throw new Error("không tìm được chỗ đất bằng");
}

function soldier(room: BattleRoom, id: string, cls: (typeof SOLDIER_CLASS_IDS)[number], at: V3, rotY = Math.PI / 2) {
  const p = room.state.players.get(id)!;
  p.alive = true;
  p.hp = 100;
  p.vehicle = "";
  [p.x, p.y, p.z] = at;
  p.rotY = rotY;
  room.gadgets.equip(p, cls);
  return p;
}

const use = (room: BattleRoom, id: string, m: GadgetMessage) => room.gadgets.use(id, m);

describe("lớp lính", () => {
  it("danh sách lớp, khí tài trùng giữa content và protocol", () => {
    expect([...SOLDIER_CLASS_IDS]).toEqual([...SOLDIER_CLASSES]);
    expect([...GADGET_ID_LIST]).toEqual([...GADGET_IDS]);
    for (const c of SOLDIER_CLASS_IDS) for (const g of CLASSES[c].gadgets) expect(GADGETS[g]).toBeTruthy();
  });

  it("máy chiến trường mang lớp theo vai: súng trường → Đột Kích, bắn tỉa → Bắn Tỉa (ghillie), súng máy → Quân Nhu, chống tăng → Kỹ Thuật", () => {
    expect(classOfRole("rifle")).toBe("assault");
    expect(classOfRole("sniper")).toBe("recon");
    expect(classOfRole("support")).toBe("support");
    expect(classOfRole("antitank")).toBe("engineer");
    const { room } = makeWar();
    const p = room.state.players.get("u1")!;
    room.war.equip(p, "sniper");
    expect(p.gear.cls).toBe("recon");
    expect(p.kit.outfit).toBe("ghillie");
    room.war.equip(p, "antitank");
    expect(p.gear.cls).toBe("engineer");
    expect(p.gear.n2).toBe(GADGETS.atmine.charges);
    expect(p.kit.primary2).toBe("rpg7");
    room.onDispose();
  });

  it("chỉ cầm được ô khí tài lớp mình có (Bắn Tỉa không có ô 2); sinh tồn solo không có khí tài", () => {
    const { room } = makeWar();
    const p = soldier(room, "u1", "recon", flatLine(room));
    expect(room.gadgets.canHold(p, "gadget1")).toBe(true);
    expect(room.gadgets.canHold(p, "gadget2")).toBe(false);
    room.state.battleMode = "solo";
    expect(room.gadgets.canHold(p, "gadget1")).toBe(false);
    room.onDispose();
  });
});

describe("Đột Kích", () => {
  it("bơm Adrenaline: phải đang cầm, có thời gian chờ, hết lượt thì thôi; server nới tốc độ trong lúc chạy nhanh", () => {
    const { room, advance } = makeWar();
    const p = soldier(room, "u1", "assault", flatLine(room));
    p.kit.active = "primary1";
    expect(use(room, "u1", { use: "syringe" })).toBe(false);
    p.kit.active = "gadget1";
    expect(use(room, "u1", { use: "m203" })).toBe(false);
    expect(use(room, "u1", { use: "syringe" })).toBe(true);
    expect(p.gear.boost).toBe(ADRENALINE.seconds);
    expect(p.gear.n1).toBe(GADGETS.syringe.charges - 1);
    expect(use(room, "u1", { use: "syringe" })).toBe(false);
    advance(GADGETS.syringe.cooldown * 1000);
    expect(use(room, "u1", { use: "syringe" })).toBe(true);
    advance(GADGETS.syringe.cooldown * 1000);
    expect(use(room, "u1", { use: "syringe" })).toBe(true);
    advance(GADGETS.syringe.cooldown * 1000);
    expect(p.gear.n1).toBe(0);
    expect(use(room, "u1", { use: "syringe" })).toBe(false);
    // Hết lượt: tay cầm lại súng chính.
    expect(p.kit.active).toBe("primary1");
    room.gadgets.tick(4);
    expect(p.gear.boost).toBeCloseTo(ADRENALINE.seconds - 4);
    // Tốc độ: quãng chạy nhanh hơn mức thường một chút chỉ hợp lệ khi đang có Adrenaline.
    const from = { x: 0, y: 5, z: 0 };
    const dist = MAX_RUN_SPEED * MAX_SPEED_BOOST * 1.5 * 0.2 * 1.15;
    const move = { x: dist, y: 5, z: 0, rotY: 0, moving: true, sitting: false };
    const ground = () => 5;
    expect(isPlausibleMove(from, move, 200, ground, 500)).toBe(false);
    expect(isPlausibleMove(from, move, 200, ground, 500, ADRENALINE.speed)).toBe(true);
    room.onDispose();
  });

  it("M203: đầu nòng phải sát người bắn; lựu đạn nổ phá công sự ở cuối đường bay", () => {
    const { room, advance } = makeWar();
    const at = flatLine(room);
    // Bao cát của địch cách 20 m.
    const sup = soldier(room, "u2", "support", [at[0] + 18.6, at[1], at[2]]);
    sup.kit.active = "gadget2";
    expect(use(room, "u2", { use: "sandbag" })).toBe(true);
    sup.x += 30;
    const p = soldier(room, "u1", "assault", at);
    p.kit.active = "gadget2";
    const o: V3 = [at[0] + 0.5, at[1] + 1.5, at[2]];
    expect(use(room, "u1", { use: "m203", o: [o[0] + 40, o[1], o[2]], d: [1, 0, 0] })).toBe(false);
    expect(use(room, "u1", { use: "m203" })).toBe(false);
    // Bắn thẳng vào bờ bao cát (hơi chúc nòng: bờ chỉ cao 1 m).
    expect(use(room, "u1", { use: "m203", o, d: [1, -0.02, 0] })).toBe(true);
    expect(p.gear.n2).toBe(GADGETS.m203.charges - 1);
    expect(use(room, "u1", { use: "m203", o, d: [1, -0.02, 0] })).toBe(false);
    advance(GADGETS.m203.cooldown * 1000);
    const trap = [...room.state.traps.values()].find((t) => t.defId === "sandbag")!;
    expect(trap.hp).toBe(100);
    for (let k = 0; k < 40; k++) room.vehicles.tick(0.05);
    expect(room.state.traps.size === 0 || trap.hp < 100).toBe(true);
    room.onDispose();
  });
});

describe("Bắn Tỉa", () => {
  it("ống nhòm: đánh dấu địch thấy được cho cả phe; đồng đội, người khuất sau bao cát thì không", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const p = soldier(room, "u1", "recon", at);
    p.kit.active = "gadget1";
    const enemy = soldier(room, "u2", "assault", [at[0] + 30, at[1], at[2]]);
    soldier(room, "u3", "assault", [at[0] + 2, at[1], at[2] + 3]);
    expect(use(room, "u1", { use: "binoculars", target: "u3" })).toBe(false);
    const ping = room.gadgets.spot("u1", "u2");
    expect(ping?.kind).toBe("spotted");
    expect(ping?.target).toBe("u2");
    expect(ping?.ttl).toBe(15000);
    expect(use(room, "u1", { use: "binoculars", target: "u2" })).toBe(true);
    // Bao cát dựng giữa hai người, cả hai nằm sấp: khuất tầm nhìn.
    const helper = soldier(room, "u3", "support", [at[0] + 12, at[1], at[2]]);
    helper.kit.active = "gadget2";
    expect(use(room, "u3", { use: "sandbag" })).toBe(true);
    helper.x -= 6;
    helper.z += 4;
    p.prone = true;
    enemy.prone = true;
    expect(room.gadgets.spot("u1", "u2")).toBeNull();
    room.onDispose();
  });
});

describe("Quân Nhu", () => {
  it("hộp tiếp đạn: đồng đội đứng gần được nạp đạn, người đặt được XP tiếp tế (giới hạn nhịp)", () => {
    const { room, rewards, advance } = makeWar();
    const at = flatLine(room);
    const sup = soldier(room, "u1", "support", at);
    sup.kit.active = "gadget1";
    const mate = soldier(room, "u3", "assault", [at[0] + 1.5, at[1], at[2]]);
    resetKit(mate.kit, 0);
    receive(mate.kit, "m416", []);
    mate.kit.ammo.set("556", 10);
    mate.kit.frag = 0;
    mate.gear.n2 = 1;
    const enemy = soldier(room, "u2", "assault", [at[0] - 1.5, at[1], at[2]]);
    resetKit(enemy.kit, 0);
    receive(enemy.kit, "m416", []);
    enemy.kit.ammo.set("556", 10);
    expect(use(room, "u1", { use: "ammobox" })).toBe(true);
    expect([...room.state.traps.values()].some((t) => t.defId === "ammobox" && t.team === sup.team)).toBe(true);
    room.gadgets.tick(0.05);
    expect(mate.kit.ammo.get("556")).toBe(40);
    expect(mate.kit.frag).toBe(1);
    expect(mate.gear.n2).toBe(2);
    expect(enemy.kit.ammo.get("556")).toBe(10);
    expect(rewards.xp.pending("u1")).toBe(XP_AWARD.resupply);
    advance(AMMO_BOX.every * 1000);
    room.gadgets.tick(AMMO_BOX.every);
    expect(mate.kit.ammo.get("556")).toBe(70);
    // Cùng người nhận trong 20 giây: không thêm XP.
    expect(rewards.xp.pending("u1")).toBe(XP_AWARD.resupply);
    advance(AMMO_BOX.xpEvery * 1000);
    mate.kit.ammo.set("556", 0);
    room.gadgets.tick(AMMO_BOX.every);
    expect(rewards.xp.pending("u1")).toBe(XP_AWARD.resupply * 2);
    room.onDispose();
  });

  it("bờ bao cát: chặn đạn (dò tia), không dựng đè lên người, giới hạn mỗi người, bắn nhiều thì vỡ", () => {
    const { room, advance } = makeWar();
    const at = flatLine(room);
    const sup = soldier(room, "u1", "support", at);
    sup.kit.active = "gadget2";
    const eye: V3 = [at[0] - 2, at[1] + 0.6, at[2]];
    expect(raycastBoxes(room.map.index, eye, [1, 0, 0], 10, true)).toBe(Infinity);
    // Có người đứng đúng chỗ dựng: không được.
    const other = soldier(room, "u3", "assault", [at[0] + SANDBAG.ahead, at[1], at[2]]);
    expect(use(room, "u1", { use: "sandbag" })).toBe(false);
    other.z += 6;
    expect(use(room, "u1", { use: "sandbag" })).toBe(true);
    const hit = raycastBoxes(room.map.index, eye, [1, 0, 0], 10, true);
    expect(hit).toBeGreaterThan(2 + SANDBAG.ahead - SANDBAG.d);
    expect(hit).toBeLessThan(2 + SANDBAG.ahead);
    // Mỗi người tối đa SANDBAG.max bờ; ba lượt mỗi lần hồi sinh.
    sup.gear.n2 = 9;
    for (let k = 0; k < SANDBAG.max + 1; k++) {
      advance(GADGETS.sandbag.cooldown * 1000);
      sup.rotY = Math.PI / 2 + (k + 1) * 0.9;
      use(room, "u1", { use: "sandbag" });
    }
    expect([...room.state.traps.values()].filter((t) => t.defId === "sandbag").length).toBeLessThanOrEqual(SANDBAG.max);
    // Bắn mãi thì vỡ: hết chặn, biến khỏi state.
    room.gadgets.clear();
    sup.rotY = Math.PI / 2;
    advance(GADGETS.sandbag.cooldown * 1000);
    sup.gear.n2 = 1;
    expect(use(room, "u1", { use: "sandbag" })).toBe(true);
    const slot = room.map.index.dynamicFrom!;
    room.destruction.hitBox(slot, 200);
    expect([...room.state.traps.values()][0]!.hp).toBeLessThan(100);
    expect(room.state.broken.size).toBe(0);
    room.destruction.hitBox(slot, 5000);
    expect(room.state.traps.size).toBe(0);
    expect(raycastBoxes(room.map.index, eye, [1, 0, 0], 10, true)).toBe(Infinity);
    room.onDispose();
  });
});

describe("Kỹ Thuật", () => {
  it("mỏ lết: sửa xe phe mình bị hư theo thời gian thật, được XP; xe địch, đứng xa thì không", () => {
    const { room, rewards, advance } = makeWar();
    const at = flatLine(room);
    const eng = soldier(room, "u1", "engineer", at);
    eng.kit.active = "gadget1";
    const vid = room.vehicles.spawn(at[0] + 6, at[2], 0, eng.team);
    const v = room.state.vehicles.get(vid)!;
    v.hp = 400;
    // Đứng xa xe: không sửa được.
    eng.x -= 10;
    expect(use(room, "u1", { use: "repair", target: vid })).toBe(false);
    eng.x = at[0] + 6 - TANK.half[0] - 1;
    let healed = 0;
    for (let k = 0; k < 30; k++) {
      advance(300);
      const before = v.hp;
      use(room, "u1", { use: "repair", target: vid });
      healed += v.hp - before;
    }
    expect(healed).toBeGreaterThan(REPAIR.rate * 4);
    expect(healed).toBeLessThanOrEqual(REPAIR.rate * 9 + 30);
    expect(rewards.xp.pending("u1")).toBe(XP_AWARD.repair * Math.floor(healed / REPAIR.xpPer));
    // Gửi dồn dập không sửa nhanh hơn.
    const before = v.hp;
    for (let k = 0; k < 20; k++) use(room, "u1", { use: "repair", target: vid });
    expect(v.hp - before).toBeLessThan(1);
    // Xe địch: không.
    v.team = eng.team === "blue" ? "red" : "blue";
    advance(300);
    expect(use(room, "u1", { use: "repair", target: vid })).toBe(false);
    room.onDispose();
  });

  it("mìn chống tăng: người đi qua không nổ, xe phe mình không nổ, xe địch cán qua thì mất nhiều máu", () => {
    const { room } = makeWar();
    const at = flatLine(room);
    const eng = soldier(room, "u1", "engineer", at);
    eng.kit.active = "gadget2";
    expect(use(room, "u1", { use: "atmine" })).toBe(true);
    expect(eng.gear.n2).toBe(GADGETS.atmine.charges - 1);
    eng.x += 20;
    const tickMines = (dt: number) => (room as unknown as { tickMines: (dt: number) => void }).tickMines(dt);
    tickMines(AT_MINE.arm + 0.1);
    // Lính địch giẫm lên: không nổ.
    const enemy = soldier(room, "u2", "assault", [at[0], at[1], at[2]]);
    for (let k = 0; k < 10; k++) tickMines(0.1);
    expect(enemy.hp).toBe(100);
    // Xe phe mình chạy qua: không nổ.
    const own = room.vehicles.spawn(at[0], at[2], 0, eng.team);
    room.state.vehicles.get(own)!.moving = true;
    for (let k = 0; k < 10; k++) tickMines(0.1);
    expect(room.state.vehicles.get(own)!.hp).toBe(TANK.hp);
    room.state.vehicles.delete(own);
    enemy.x += 30;
    const foe = room.vehicles.spawn(at[0] + 0.5, at[2], 0, enemy.team);
    const fv = room.state.vehicles.get(foe)!;
    fv.moving = true;
    for (let k = 0; k < 10; k++) tickMines(0.1);
    expect(fv.hp).toBeLessThanOrEqual(TANK.hp - AT_MINE.armor);
    room.onDispose();
  });
});
