import { describe, expect, it } from "vitest";
import { Messages, PlayerState, type HitMessage } from "@tentides/protocol";
import { WEAPON } from "@tentides/content";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { receive } from "./kit.ts";
import { Vehicles } from "./vehicles.ts";

// Tin Messages.hit báo riêng người bắn: phát hạ gục phải nói rõ có trúng đầu không (chuông kim loại, đầu lâu vàng).

type V3 = [number, number, number];
/** Đặt hai người lơ lửng thật cao trên đảo: không tường, không đồi chắn đường đạn ngang. */
const Y = 260;

function makeRoom() {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "solo";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(4242);
  room.state.phase = "battle";
  const sent: { to: string; type: string; msg: unknown }[] = [];
  room.clientOf = ((id: string) => ({ send: (type: string, msg: unknown) => sent.push({ to: id, type, msg }), leave: () => {} })) as unknown as typeof room.clientOf;
  return { room, sent };
}

function addPlayer(room: BattleRoom, id: string, at: V3, gun?: string) {
  const p = new PlayerState();
  p.name = id;
  p.created = true;
  p.alive = true;
  p.hp = 100;
  [p.x, p.y, p.z] = at;
  room.state.players.set(id, p);
  if (gun) {
    receive(p.kit, gun, []);
    p.kit.active = "primary1";
    p.kit.ammo.set(WEAPON.get(gun)!.ammo, 30);
  }
  return p;
}

function shoot(gun: string, part: "head" | "body") {
  const { room, sent } = makeRoom();
  addPlayer(room, "shooter", [0, Y, 0], gun);
  const target = addPlayer(room, "target", [10, Y, 0]);
  // Ngang tầm đầu (1.6 m): khai "head" thì server xác nhận đầu; khai "body" thì server không tự nâng lên đầu.
  room.fire("shooter", gun, [0, Y + 1.6, 0], [[1, 0, 0]], [{ target: "target", part, d: 10, ray: 0 }]);
  const hits = sent.filter((s) => s.to === "shooter" && s.type === Messages.hit).map((s) => s.msg as HitMessage);
  return { target, hits };
}

describe("tin trúng đích cho người bắn", () => {
  it("hạ gục bằng phát trúng đầu: kind kill kèm head", () => {
    const { target, hits } = shoot("kar98k", "head");
    expect(target.alive).toBe(false);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("kill");
    expect(hits[0]!.head).toBe(1);
  });

  it("hạ gục bằng phát trúng thân: kind kill, không có head", () => {
    const { target, hits } = shoot("awm", "body");
    expect(target.alive).toBe(false);
    expect(hits[0]!.kind).toBe("kill");
    expect(hits[0]!.head).toBeUndefined();
  });

  it("trúng đầu chưa chết: vẫn kind head như cũ, không có cờ head của phát hạ", () => {
    const { target, hits } = shoot("m416", "head");
    expect(target.alive).toBe(true);
    expect(hits[0]!.kind).toBe("head");
    expect(hits[0]!.head).toBeUndefined();
  });
});
