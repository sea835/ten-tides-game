import { describe, expect, it } from "vitest";
import { squadSlots } from "@tentides/content";
import { Messages, PING_MAX_DISTANCE, PlayerState, type PingBroadcast } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { audience, validatePing } from "./comms.ts";
import { Vehicles } from "./vehicles.ts";

/** Dựng phòng không cần mạng; `sent` ghi lại mọi gói server gửi riêng cho từng người. */
function makeRoom(mode: "solo" | "squad", bots: number, humans: number, seed = 12345) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(seed);
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  const sent: { to: string; type: string; msg: unknown }[] = [];
  room.clientOf = ((id: string) => ({ send: (type: string, msg: unknown) => sent.push({ to: id, type, msg }) })) as unknown as typeof room.clientOf;
  for (let h = 0; h < humans; h++) {
    const p = new PlayerState();
    p.name = `P${h}`;
    p.created = true;
    room.state.players.set(`human${h}`, p);
  }
  room.state.battleMode = mode;
  room.state.bots = bots;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return { room, sent };
}

const enemyOf = (room: BattleRoom, team: string) => [...room.state.players.entries()].find(([, p]) => p.alive && p.team !== team)!;

describe("Đánh dấu chuột giữa: server kiểm tra", () => {
  it("dấu chỗ thường hợp lệ; quá xa, ngoài bản đồ, người gửi đã gục thì bỏ", () => {
    const { room } = makeRoom("squad", 10, 1);
    const me = room.state.players.get("human0")!;
    const ok = validatePing(room.state, "human0", { kind: "spot", x: me.x + 20, y: me.y, z: me.z }, room.map.half);
    expect(ok).toMatchObject({ kind: "spot", from: "human0", target: "" });
    expect(validatePing(room.state, "human0", { kind: "spot", x: me.x + PING_MAX_DISTANCE + 5, y: me.y, z: me.z }, 5000)).toBeNull();
    expect(validatePing(room.state, "human0", { kind: "spot", x: 99999, y: 0, z: 0 }, room.map.half)).toBeNull();
    expect(validatePing(room.state, "nobody", { kind: "spot", x: 0, y: 0, z: 0 }, room.map.half)).toBeNull();
    me.alive = false;
    expect(validatePing(room.state, "human0", { kind: "spot", x: me.x, y: me.y, z: me.z }, room.map.half)).toBeNull();
  });

  it("dấu địch: đúng người địch ở gần thì giữ (lấy vị trí trên server), đồng đội hay ở xa thì hạ thành dấu thường", () => {
    const { room } = makeRoom("squad", 10, 1);
    const me = room.state.players.get("human0")!;
    const [eid, enemy] = enemyOf(room, "human0");
    enemy.x = me.x + 30;
    enemy.y = me.y;
    enemy.z = me.z;
    const hit = validatePing(room.state, "human0", { kind: "enemy", x: enemy.x + 2, y: enemy.y + 1, z: enemy.z - 1, target: eid }, room.map.half)!;
    expect(hit).toMatchObject({ kind: "enemy", target: eid, x: enemy.x, z: enemy.z, ttl: 6000 });
    // Đồng đội không phải địch.
    const [mid, mate] = [...room.state.players.entries()].find(([, p]) => p.bot && p.team === "human0")!;
    const friendly = validatePing(room.state, "human0", { kind: "enemy", x: mate.x, y: mate.y, z: mate.z, target: mid }, room.map.half)!;
    expect(friendly).toMatchObject({ kind: "spot", target: "" });
    // Báo địch ở chỗ người đó không đứng.
    const far = validatePing(room.state, "human0", { kind: "enemy", x: enemy.x + 40, y: enemy.y, z: enemy.z, target: eid }, room.map.half)!;
    expect(far.kind).toBe("spot");
  });

  it("tối đa 1 dấu / 0,5 giây; chỉ người cùng đội nhận được", () => {
    const { room, sent } = makeRoom("squad", 10, 2);
    const me = room.state.players.get("human0")!;
    const m = { kind: "danger" as const, x: me.x + 5, y: me.y, z: me.z };
    expect(room.comms.ping("human0", m, 10_000)).not.toBeNull();
    expect(room.comms.ping("human0", m, 10_200)).toBeNull();
    expect(room.comms.ping("human0", m, 10_600)).not.toBeNull();
    const pings = sent.filter((s) => s.type === Messages.ping);
    // Đội human0 chỉ có human0 là người (máy không nhận gói); human1 ở đội khác không thấy.
    expect(pings.map((s) => s.to)).toEqual(["human0", "human0"]);
    expect((pings[0]!.msg as PingBroadcast).kind).toBe("danger");
    expect(audience(room.state, "human1")).toEqual(["human1"]);
  });

  it("solo không có đội: chỉ mình thấy; chiến trường: cả phe", () => {
    const { room } = makeRoom("solo", 5, 2);
    expect(audience(room.state, "human0")).toEqual(["human0"]);
    room.state.players.get("human0")!.team = "blue";
    room.state.players.get("human1")!.team = "blue";
    expect(audience(room.state, "human0").sort()).toEqual(["human0", "human1"]);
  });

  it("bộ đàm: giới hạn nhịp, ra lệnh thì một máy trong đội đáp Rõ", () => {
    const { room, sent } = makeRoom("squad", 10, 1);
    expect(room.comms.radio("human0", "medic", 1000)).toMatchObject({ line: "medic", name: "P0" });
    expect(room.comms.radio("human0", "medic", 1500)).toBeNull();
    const ack = room.comms.acknowledge("human0", 5000);
    expect(ack?.line).toBe("ack");
    expect(room.state.players.get(ack!.from)?.bot).toBe(true);
    expect(sent.filter((s) => s.type === Messages.radio).length).toBe(2);
  });
});

describe("Nhập xác: phím 1–5 chọn máy theo vai", () => {
  it("ô theo thứ tự vai; máy trùng vai lấp vào ô trống", () => {
    expect(
      squadSlots([
        { id: "bot5", role: "antitank" },
        { id: "bot2", role: "sniper" },
        { id: "bot1", role: "rifle" },
        { id: "bot4", role: "support" },
        { id: "bot3", role: "tanker" },
      ]),
    ).toEqual(["bot1", "bot2", "bot3", "bot4", "bot5"]);
    // Lái tăng không có xe thành tay súng trường: lấp vào ô 3 (ô lái tăng còn trống).
    expect(
      squadSlots([
        { id: "bot1", role: "rifle" },
        { id: "bot3", role: "rifle" },
        { id: "bot2", role: "sniper" },
      ]),
    ).toEqual(["bot1", "bot2", "bot3", null, null]);
  });

  it("gục rồi bấm 2 thì nhập vào máy bắn tỉa; ô của máy đã gục không nhập được", () => {
    const { room } = makeRoom("squad", 10, 1);
    room.kill("human0", "", "", false);
    const sniper = room.squadSlotBot("human0", 2);
    expect(room.state.players.get(sniper)?.role).toBe("sniper");
    const support = room.squadSlotBot("human0", 4);
    room.state.players.get(support)!.alive = false;
    room.possess("human0", support);
    expect(room.state.players.get("human0")!.alive).toBe(false);
    const x = room.state.players.get(sniper)!.x;
    room.possess("human0", sniper);
    const me = room.state.players.get("human0")!;
    expect(me.alive).toBe(true);
    expect(me.x).toBe(x);
    expect(room.state.players.has(sniper)).toBe(false);
    // Máy còn lại giữ nguyên ô (súng máy vẫn ở ô 4 dù máy bắn tỉa đã nhập).
    expect(room.squadSlotBot("human0", 4)).toBe(support);
    expect(room.squadSlotBot("human0", 2)).toBe("");
  });
});

describe("Lệnh lên xe tăng", () => {
  it("máy trong đội chạy tới xe tăng trống cùng đội rồi lên lái", () => {
    const { room } = makeRoom("squad", 5, 1, 4242);
    const r = room as unknown as { tick: (dt: number) => void };
    const me = room.state.players.get("human0")!;
    const [, bot] = [...room.state.players.entries()].find(([, p]) => p.bot && p.team === "human0" && !p.vehicle)!;
    const spot = room.vehicles.findSpot(bot.x, bot.z, 6, 20, Math.random)!;
    expect(spot).not.toBeNull();
    const vid = room.vehicles.spawn(spot.x, spot.z, spot.rotY, "human0");
    me.x = bot.x;
    me.z = bot.z;
    const who = room.bots.orderBoard("human0", vid);
    expect(who).not.toBe("");
    for (let k = 0; k < 20 * 20 && !room.state.vehicles.get(vid)!.driver; k++) r.tick(0.05);
    expect(room.state.vehicles.get(vid)!.driver).toBe(who);
    expect(room.state.players.get(who)!.vehicle).toBe(vid);
  });
});
