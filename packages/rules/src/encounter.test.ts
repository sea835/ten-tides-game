import { describe, expect, it } from "vitest";
import { createGame, reduce, type GameAction, type GameState } from "./game/index.ts";
import { testConfig as config } from "./testConfig.ts";

function play(actions: GameAction[], seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

const DAWN: GameAction[] = [
  { type: "join", playerId: "a", name: "An" },
  { type: "join", playerId: "b", name: "Bình" },
  { type: "start" },
  { type: "advance" },
  { type: "advance" },
];

describe("chạm trán ngoài bản đồ", () => {
  it("easter egg: cộng tiến độ kho báu cho cả đội, nhặt được đồ, chỉ tìm được một lần", () => {
    const egg: GameAction = { type: "encounter", playerId: "a", source: "egg", refId: "poi1", defId: "shipwreck", effects: { treasure: 6, gainItem: "rope" }, once: true };
    const s = play([...DAWN, egg]);
    expect(s.treasure).toBe(6);
    expect(s.players.a!.items.filter((i) => i === "rope").length).toBeGreaterThanOrEqual(1);
    expect(s.discovered).toContain("poi1");
    expect(s.log.at(-1)).toMatchObject({ kind: "encounter", source: "egg", defId: "shipwreck", gained: "rope" });
    expect(() => reduce(s, { ...egg, playerId: "b" }, config)).toThrow(/tìm thấy/);
  });

  it("sinh vật cắn tới chết thì người đó gục", () => {
    let s = play(DAWN);
    const bite: GameAction = { type: "encounter", playerId: "b", source: "creature", refId: "c1", defId: "wild_boar", effects: { hp: -40 } };
    for (let i = 0; i < 10 && s.players.b!.alive; i++) s = reduce(s, bite, config);
    expect(s.players.b!.alive).toBe(false);
    expect(s.log.some((e) => e.kind === "death" && e.playerId === "b")).toBe(true);
    expect(() => reduce(s, bite, config)).toThrow(/gục/);
  });

  it("nhảy vào dung nham thì chết ngay, y tá che chở cũng không cứu được; lửa trại chỉ làm bỏng", () => {
    let s = play(DAWN);
    s.players.a!.protected = true;
    s = reduce(s, { type: "encounter", playerId: "a", source: "lava", refId: "volcano", defId: "lava", effects: { hp: -100 }, fatal: true }, config);
    expect(s.players.a!.alive).toBe(false);
    expect(s.log.find((e) => e.kind === "encounter" && e.source === "lava")).toMatchObject({ effects: { hp: -s.players.a!.maxHp } });
    s = reduce(s, { type: "encounter", playerId: "b", source: "burn", refId: "camp", defId: "campfire", effects: { hp: -10 } }, config);
    expect(s.players.b!.hp).toBe(s.players.b!.maxHp - 10);
    expect(s.players.b!.alive).toBe(true);
  });

  it("né được bẫy thì không mất gì nhưng bẫy vẫn tính là đã sập", () => {
    const s = play([...DAWN, { type: "encounter", playerId: "a", source: "trap", refId: "trap3", defId: "spike_pit", effects: { hp: -14 }, once: true, dodged: true }]);
    expect(s.players.a!.hp).toBe(s.players.a!.maxHp);
    expect(s.discovered).toContain("trap3");
  });

  it("hệ quả bị giới hạn và chỉ có trong giờ đi lại trên đảo", () => {
    const s = play([...DAWN, { type: "encounter", playerId: "a", source: "anomaly", refId: "poi2", defId: "x", effects: { treasure: 500 }, once: true }]);
    expect(s.treasure).toBeLessThanOrEqual(60);
    const lobby = play([{ type: "join", playerId: "a", name: "An" }]);
    expect(() => reduce(lobby, { type: "encounter", playerId: "a", source: "friend", refId: "c2", defId: "dolphin", effects: { morale: 5 } }, config)).toThrow();
  });
});
