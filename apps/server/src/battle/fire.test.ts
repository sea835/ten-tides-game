import { describe, expect, it } from "vitest";
import { PlayerState } from "@tentides/protocol";
import { RICOCHET, WEAPON, boxSpan, insideBox, penetration, raycastBoxes, ricochet, type BattleBox } from "@tentides/content";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { receive } from "./kit.ts";
import { Vehicles } from "./vehicles.ts";

// Server kiểm tra phát bắn: xuyên vách theo vật liệu / cỡ đạn, đạn nảy, bắn ngắt lần nạp từng viên.

type V3 = [number, number, number];

function makeRoom() {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = "solo";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(4242);
  room.state.phase = "battle";
  return room;
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

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Pháp tuyến mặt mỏng của tấm tường đứng. */
function wallNormal(b: BattleBox): V3 {
  return b.w < b.d ? [Math.cos(b.rot), 0, -Math.sin(b.rot)] : [Math.sin(b.rot), 0, Math.cos(b.rot)];
}

describe("server kiểm tra phát bắn", () => {
  it("vách gỗ: súng trường xuyên qua đủ sát thương; vách vữa thì mất bớt", () => {
    for (const [mat, expectKeep] of [
      ["wood", 1],
      ["plaster", 0.8],
    ] as const) {
      const room = makeRoom();
      const idx = room.map.index;
      // Tấm tường đứng mỏng, cao, phía sau trống một khoảng để đặt người.
      const i = room.map.boxes.findIndex((b, k) => {
        if (b.mat !== mat || !b.solid || b.part !== "wall" || b.pitch || Math.min(b.w, b.d) > 0.3 || b.h < 2.2 || Math.max(b.w, b.d) < 1.5) return false;
        const n = wallNormal(b);
        const foot = b.y - b.h / 2;
        const o: V3 = [b.x - n[0] * 1.5, foot + 1.1, b.z - n[2] * 1.5];
        const behind = add(o, n, 2.8);
        return raycastBoxes(idx, add(o, n, 1.7), n, 1.4, true) === Infinity && !insideBox(idx, behind[0], foot + 0.5, behind[2]) && k >= 0;
      });
      expect(i, mat).toBeGreaterThanOrEqual(0);
      const b = room.map.boxes[i]!;
      const n = wallNormal(b);
      const foot = b.y - b.h / 2;
      const o: V3 = [b.x - n[0] * 1.5, foot + 1.1, b.z - n[2] * 1.5];
      const [tin, tout] = boxSpan(idx, i, o, n);
      expect(penetration(b, "rifle", tout - tin)).toBe(expectKeep);
      addPlayer(room, "shooter", [o[0], foot, o[2]], "m416");
      const target = addPlayer(room, "target", [o[0] + n[0] * 2.8, foot, o[2] + n[2] * 2.8]);
      room.fire("shooter", "m416", o, [n], [{ target: "target", part: "body", d: 2.55, ray: 0 }]);
      const dmg = WEAPON.get("m416")!.damage;
      expect(100 - target.hp, mat).toBe(Math.round(dmg * expectKeep));
    }
  });

  it("đạn sượt sàn thép / bê tông nảy lên, trúng người phía sau với nửa sát thương (server tự tính lại đường nảy)", () => {
    const room = makeRoom();
    const idx = room.map.index;
    const rad = (5 * Math.PI) / 180;
    // Tìm tấm phẳng to (sàn tàu, sân bê tông) và một chỗ trên mặt mà cả hai đoạn đường đạn đều trống.
    let found: { o: V3; d: V3; hit: V3; tgt: V3; s: number; k: number } | null = null;
    for (let i = 0; i < room.map.boxes.length && !found; i++) {
      const b = room.map.boxes[i]!;
      if ((b.mat !== "metal" && b.mat !== "concrete") || !b.solid || b.pitch || b.h > 0.5 || Math.min(b.w, b.d) < 6) continue;
      const a = idx.axes;
      const u: V3 = [a[i * 9]!, a[i * 9 + 1]!, a[i * 9 + 2]!];
      const v: V3 = [a[i * 9 + 6]!, a[i * 9 + 7]!, a[i * 9 + 8]!];
      for (const off of [0, -0.25, 0.25]) for (const along of [0, 0.25]) {
        if (found) break;
        const hit: V3 = add(add([b.x, b.y + b.h / 2, b.z], v, off * b.d), u, along * b.w);
        const back = Math.min(12, b.w * (0.5 + along) - 0.5);
        const d: V3 = [u[0] * Math.cos(rad), -Math.sin(rad), u[2] * Math.cos(rad)];
        const o = add(hit, d, -back / Math.cos(rad));
        const r = ricochet(idx, i, hit, d);
        if (!r) continue;
        const k = 4;
        const tgt = add(hit, r.d, k);
        const s = back / Math.cos(rad);
        const leg1 = raycastBoxes(idx, o, d, s + 1, true);
        const leg2 = raycastBoxes(idx, add(hit, r.d, 0.05), r.d, k + 0.5, true);
        if (Math.abs(leg1 - s) > 0.05 || leg2 !== Infinity || insideBox(idx, tgt[0], tgt[1] + 0.6, tgt[2])) continue;
        found = { o, d, hit, tgt, s, k };
      }
    }
    expect(found).not.toBeNull();
    const { o, d, tgt, s, k } = found!;
    addPlayer(room, "shooter", [o[0], o[1] - 1.5, o[2]], "awm");
    // Người đứng sao cho điểm nảy tới (cao ~0,56 m trên sàn) nằm giữa thân.
    const target = addPlayer(room, "target", [tgt[0], tgt[1] - 0.9, tgt[2]]);
    room.fire("shooter", "awm", o, [d], [{ target: "target", part: "body", d: s + k - 0.25, ray: 0 }]);
    expect(100 - target.hp).toBe(Math.round(WEAPON.get("awm")!.damage * RICOCHET.damage));
    // Bắn dốc hơn (30°) vào đúng chỗ đó: găm lại, không nảy; người đứng ở chỗ viên nảy "lẽ ra" tới thì không mất máu.
    const room2 = makeRoom();
    const steep = (30 * Math.PI) / 180;
    const h = Math.hypot(d[0], d[2]);
    const d2: V3 = [(d[0] / h) * Math.cos(steep), -Math.sin(steep), (d[2] / h) * Math.cos(steep)];
    const o2 = add(found!.hit, d2, -4);
    const mirror = add(found!.hit, [d2[0], -d2[1], d2[2]], k);
    addPlayer(room2, "shooter", [o2[0], o2[1] - 1.5, o2[2]], "awm");
    const t2 = addPlayer(room2, "target", [mirror[0], mirror[1] - 0.9, mirror[2]]);
    room2.fire("shooter", "awm", o2, [d2], [{ target: "target", part: "body", d: 4 + k - 0.25, ray: 0 }]);
    expect(t2.hp).toBe(100);
  });

  it("S1897: bắn giữa lúc nạp từng viên thì dừng nạp, giữ các viên đã nhét", () => {
    const room = makeRoom();
    const p = addPlayer(room, "shooter", [0, 50, 0], "s1897");
    const def = WEAPON.get("s1897")!;
    p.kit.mag1 = 1;
    p.kit.ammo.set("12g", 10);
    room.reload("shooter");
    expect(p.kit.reloading).toBe(true);
    const tick = (dt: number) => (room as unknown as { tickTimers: (dt: number) => void }).tickTimers(dt);
    tick(def.reload + def.shell! + 0.01);
    expect(p.kit.mag1).toBe(2);
    expect(p.kit.reloading).toBe(true);
    tick(def.shell! + 0.01);
    expect(p.kit.mag1).toBe(3);
    const rays: V3[] = Array.from({ length: def.pellets }, () => [1, 0, 0] as V3);
    room.fire("shooter", "s1897", [0, 51.5, 0], rays, []);
    expect(p.kit.mag1).toBe(2);
    expect(p.kit.reloading).toBe(false);
    expect(p.kit.ammo.get("12g")).toBe(8);
    // Súng thay cả băng thì vẫn không bắn được lúc đang thay.
    const q = addPlayer(room, "rifle", [10, 50, 0], "m416");
    q.kit.mag1 = 5;
    room.reload("rifle");
    room.fire("rifle", "m416", [10, 51.5, 0], [[1, 0, 0]], []);
    expect(q.kit.mag1).toBe(5);
  });
});
