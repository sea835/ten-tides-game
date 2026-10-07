import { describe, expect, it } from "vitest";
import { isEmplacement } from "@tentides/content";
import { BattleSettingsMessage, IslandState, PlayerState, WAR_TICKETS_MAX, WAR_TICKETS_MIN } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { applyBattleSettings, clampBots, clampTickets, convertBots } from "./settings.ts";

/** Số xe cơ giới (bỏ qua vũ khí cố định — ổ đại liên, cối — luôn có dù tắt xe). */
const motorized = (room: BattleRoom) => [...room.state.vehicles.values()].filter((v) => !isEmplacement(v.kind)).length;

function makeRoom(mode: "solo" | "squad" | "war", setup: (s: IslandState) => void) {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = mode;
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
  const p = new PlayerState();
  p.name = "Chỉ huy";
  p.created = true;
  room.state.players.set("human0", p);
  if (mode === "war") room.war.assign("human0");
  setup(room.state);
  (room as unknown as { startMatch: () => void }).startMatch();
  return room;
}

describe("cài đặt phòng: kẹp giá trị", () => {
  it("số máy 10–100; chiến trường tính mỗi phe 5–50", () => {
    expect(clampBots("solo", 0)).toBe(10);
    expect(clampBots("solo", 250)).toBe(100);
    expect(clampBots("squad", 37.4)).toBe(37);
    expect(clampBots("war", 2)).toBe(5);
    expect(clampBots("war", 80)).toBe(50);
    expect(clampBots("solo", Number.NaN)).toBe(10);
  });

  it("vé quân 150–500", () => {
    expect(clampTickets(10)).toBe(WAR_TICKETS_MIN);
    expect(clampTickets(9999)).toBe(WAR_TICKETS_MAX);
    expect(clampTickets(333.6)).toBe(334);
  });

  it("đổi chế độ thì số máy về mặc định của chế độ mới", () => {
    expect(convertBots("solo", "war", 20)).toBe(50);
    expect(convertBots("war", "squad", 40)).toBe(20);
    expect(convertBots("solo", "squad", 30)).toBe(30);
    expect(convertBots("war", "war", 80)).toBe(50);
  });

  it("khung tin nhắn chặn số vô lý và kiểu sai", () => {
    expect(BattleSettingsMessage.safeParse({ bots: 100, tickets: 400, vehicles: false }).success).toBe(true);
    expect(BattleSettingsMessage.safeParse({ bots: -1 }).success).toBe(false);
    expect(BattleSettingsMessage.safeParse({ bots: 2.5 }).success).toBe(false);
    expect(BattleSettingsMessage.safeParse({ tickets: 1e6 }).success).toBe(false);
    expect(BattleSettingsMessage.safeParse({ vehicles: "no" }).success).toBe(false);
    expect(BattleSettingsMessage.safeParse({ weather: "lava" }).success).toBe(false);
  });

  it("áp cài đặt vào state", () => {
    const s = new IslandState();
    s.battleMode = "solo";
    s.bots = 20;
    expect(applyBattleSettings(s, { bots: 3, tickets: 900, vehicles: false, weather: "snow", time: "night" })).toBe(null);
    expect(s.bots).toBe(10);
    expect(s.settings.warTickets).toBe(500);
    expect(s.settings.vehiclesEnabled).toBe(false);
    expect(s.settings.weatherPick).toBe("snow");
    expect(s.settings.timePick).toBe("night");
    // Đổi chế độ cùng lúc với số máy: số máy kẹp theo chế độ mới.
    expect(applyBattleSettings(s, { mode: "war", bots: 99 })).toBe("war");
    expect(s.battleMode).toBe("war");
    expect(s.bots).toBe(50);
  });
});

describe("cài đặt phòng: vào trận", () => {
  it("chiến trường dùng vé quân chủ phòng chọn; tắt xe thì không có xe tăng, không có máy lái tăng", () => {
    const room = makeRoom("war", (s) => {
      s.bots = 10;
      s.settings.warTickets = 420;
      s.settings.vehiclesEnabled = false;
    });
    expect(room.state.ticketsBlue).toBe(420);
    expect(room.state.ticketsRed).toBe(420);
    expect(motorized(room)).toBe(0);
    expect([...room.state.players.values()].some((p) => p.role === "tanker")).toBe(false);
    // Hết giờ hồi xe tăng cũng không có xe mới.
    (room as unknown as { beginBattle: () => void }).beginBattle();
    const r = room as unknown as { tick: (dt: number) => void };
    for (let k = 0; k < 20 * 60; k++) r.tick(0.05);
    expect(motorized(room)).toBe(0);
  });

  it("bật xe thì chiến trường vẫn có xe tăng như cũ", () => {
    const room = makeRoom("war", (s) => {
      s.bots = 10;
    });
    expect([...room.state.vehicles.values()].filter((v) => v.kind === "tank").length).toBe(6);
    expect(room.state.ticketsBlue).toBe(300);
  });

  it("đồng đội tắt xe: máy lái tăng thành lính súng trường", () => {
    const room = makeRoom("squad", (s) => {
      s.bots = 10;
      s.settings.vehiclesEnabled = false;
    });
    expect(motorized(room)).toBe(0);
    expect([...room.state.players.values()].some((p) => p.role === "tanker")).toBe(false);
  });

  it("sinh tồn với 100 máy vẫn chạy đủ nhanh", () => {
    const room = makeRoom("solo", (s) => {
      s.bots = 100;
    });
    expect([...room.state.players.values()].filter((p) => p.bot).length).toBe(100);
    (room as unknown as { beginBattle: () => void }).beginBattle();
    const r = room as unknown as { tick: (dt: number) => void };
    const t0 = performance.now();
    const ticks = 20 * 30;
    for (let k = 0; k < ticks; k++) r.tick(0.05);
    expect((performance.now() - t0) / ticks).toBeLessThan(25);
  });
});
