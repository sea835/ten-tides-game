import { describe, expect, it } from "vitest";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { Naval } from "./naval.ts";

function navalRoom(blue: string, red: string) {
  const room = new BattleRoom();
  const fx: { k: string }[] = [];
  room.broadcast = ((type: string, msg: { k: string }) => {
    if (type === "navalFx") fx.push(msg);
  }) as typeof room.broadcast;
  room.state.mode = "battle";
  room.state.battleMode = "naval";
  room.state.settings.shipBlue = blue;
  room.state.settings.shipRed = red;
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(5);
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  room.naval = new Naval(room);
  (room as unknown as { startMatch: () => void }).startMatch();
  room.state.phase = "battle";
  return { room, fx };
}

describe("hải chiến (mô phỏng máy đấu máy)", () => {
  for (const [blue, red] of [
    ["battleship", "destroyer"],
    ["carrier", "cruiser"],
    ["submarine", "battleship"],
    ["destroyer", "submarine"],
    ["cruiser", "battleship"],
    ["carrier", "destroyer"],
  ] as const) {
    it(`${blue} vs ${red}: tàu chạy, bắn, trúng, cháy`, () => {
      const { room, fx } = navalRoom(blue, red);
      const ns = room.state.naval;
      const b = ns.ships.get("blue")!;
      const r = ns.ships.get("red")!;
      const start = { bx: b.x, rx: r.x };
      const counts = () => fx.reduce<Record<string, number>>((m, f) => ((m[f.k] = (m[f.k] ?? 0) + 1), m), {});
      let t = 0;
      const ticks = (s: number) => {
        for (let k = 0; k < s / 0.05; k++) {
          (room as unknown as { tick: (dt: number) => void }).tick(0.05);
          t += 0.05;
          if (room.state.phase !== "battle") return;
        }
      };
      ticks(Number(process.env.NAVAL_SIM_SECONDS ?? 360));
      const c = counts();
      console.log(`${blue} vs ${red} t=${t.toFixed(0)} phase=${room.state.phase} winner=${room.state.winner} hp blue ${b.hp}/${b.maxHp} red ${r.hp}/${r.maxHp} fires b${b.fires.size} r${r.fires.size} parts b${[...b.parts.entries()].map(([k, v]) => k + v).join(",")} r${[...r.parts.entries()].map(([k, v]) => k + v).join(",")} moved b${Math.hypot(b.x - start.bx).toFixed(0)} r${Math.hypot(r.x - start.rx).toFixed(0)} units=${ns.units.size}`, JSON.stringify(c));
      expect(Math.abs(b.x - start.bx) + Math.abs(r.x - start.rx)).toBeGreaterThan(100);
      expect(b.hp < b.maxHp || r.hp < r.maxHp).toBe(true);
      // Mọi người trên tàu đều ở vị trí (máy) hay còn sống.
      for (const p of room.state.players.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    });
  }
});

describe("hải chiến: đổi vị trí với máy", () => {
  it("người vào vị trí máy đang đứng: máy sang vị trí người bỏ trống", () => {
    const { room } = navalRoom("battleship", "destroyer");
    const naval = room.naval as unknown as { station: (id: string, k: number) => void; seatOf: (p: unknown) => { station: number } | null };
    const ship = room.state.naval.ships.get("blue")!;
    // Biến máy thuyền trưởng thành "người": rời vị trí 0, đứng cạnh bàn vị trí 1.
    const me = room.state.players.get("nb_blue0")!;
    me.bot = false;
    naval.station("nb_blue0", -1);
    expect(ship.crew.has("0")).toBe(false);
    const st = room.naval.cls(ship).roles[1]!.station;
    const pose = room.naval.pose(ship);
    const c = Math.cos(pose.rotY);
    const s = Math.sin(pose.rotY);
    me.x = pose.x + c * st[0] + s * st[2];
    me.y = pose.y + st[1];
    me.z = pose.z - s * st[0] + c * st[2];
    naval.station("nb_blue0", 1);
    expect(naval.seatOf(me)?.station).toBe(1);
    const bot = room.state.players.get("nb_blue1")!;
    expect(naval.seatOf(bot)?.station).toBe(0);
    expect(ship.crew.get("0")).toBe("nb_blue1");
    expect(ship.crew.get("1")).toBe("nb_blue0");
  });
});
