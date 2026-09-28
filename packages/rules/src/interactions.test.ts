import { describe, expect, it } from "vitest";
import { canAssassinate, createGame, privateView, reduce, type GameAction, type GameConfig, type GameState } from "./game/index.ts";
import { testConfig } from "./testConfig.ts";

const config: GameConfig = {
  ...testConfig,
  items: [
    ...testConfig.items.map((i) => (i.id === "rum" ? { ...i, eat: { morale: 12, hunger: 3, dizzy: 8 } } : i)),
    { id: "wood", name: "Khúc gỗ", size: { w: 1, h: 3 }, weightKg: 1.2, price: 0, tags: ["wood"], loot: true },
    { id: "raw_meat", name: "Thịt sống", size: { w: 2, h: 2 }, weightKg: 0.8, price: 0, tags: ["meat"], loot: true, eat: { hunger: 20, hp: -4 } },
  ],
};

function play(actions: GameAction[], seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

const players = ["a", "b", "c", "d"];
const DAWN: GameAction[] = [...players.map((id): GameAction => ({ type: "join", playerId: id, name: id.toUpperCase() })), { type: "start" }, { type: "advance" }, { type: "advance" }];

/** Tìm một seed có kẻ phản bội. */
function withTraitor(): { state: GameState; traitor: string; victim: string } {
  for (let seed = 1; seed < 200; seed++) {
    const state = play(DAWN, seed);
    const traitor = players.find((id) => ["pirate", "con"].includes(state.players[id]!.role));
    if (traitor) return { state, traitor, victim: players.find((id) => id !== traitor && state.players[id]!.role !== "nurse")! };
  }
  throw new Error("không tìm được ván có kẻ phản bội");
}

describe("tương tác với đồ vật", () => {
  it("nhặt vào balo, thả ra khỏi balo; cửa hàng không bán đồ chỉ nhặt được", () => {
    let s = play(DAWN);
    expect(s.shop).not.toContain("wood");
    s = reduce(s, { type: "pickup", playerId: "a", itemId: "wood" }, config);
    const uid = s.players.a!.bag.find((b) => b.itemId === "wood")!.uid;
    expect(s.players.a!.items).toContain("wood");
    s = reduce(s, { type: "drop", playerId: "a", uid }, config);
    expect(s.players.a!.items).not.toContain("wood");
    expect(() => reduce(s, { type: "drop", playerId: "a", uid }, config)).toThrow();
  });

  it("ăn thịt sống: no hơn nhưng mất chút Máu; món không ăn được thì từ chối", () => {
    let s = reduce(play(DAWN), { type: "pickup", playerId: "a", itemId: "raw_meat" }, config);
    const before = s.players.a!;
    const uid = before.bag.find((b) => b.itemId === "raw_meat")!.uid;
    s = reduce(s, { type: "consume", playerId: "a", uid }, config);
    expect(s.players.a!.hunger).toBe(Math.min(100, before.hunger + 20));
    expect(s.players.a!.hp).toBe(before.hp - 4);
    s = reduce(s, { type: "pickup", playerId: "a", itemId: "wood" }, config);
    const wood = s.players.a!.bag.find((b) => b.itemId === "wood")!.uid;
    expect(() => reduce(s, { type: "consume", playerId: "a", uid: wood }, config)).toThrow(/không ăn/);
  });

  it("dựng chòi tiêu vật liệu và thêm chỗ ngủ; thiếu vật liệu thì không dựng được", () => {
    let s = play(DAWN);
    const build: GameAction = { type: "build", playerId: "b", building: "lean_to", cost: { wood: 3 }, shelter: 2 };
    expect(() => reduce(s, build, config)).toThrow(/vật liệu/);
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "pickup", playerId: "b", itemId: "wood" }, config);
    s = reduce(s, build, config);
    expect(s.shelter).toBe(2);
    expect(s.players.b!.items).not.toContain("wood");
    expect(s.log.at(-1)).toMatchObject({ kind: "build", building: "lean_to" });
  });

  it("đủ chỗ ngủ có mái che thì cả trại thêm Tinh thần qua đêm", () => {
    let s = play(DAWN);
    s = { ...s, shelter: 10 };
    s = reduce(s, { type: "advance" }, config);
    s = reduce(s, { type: "advance" }, config);
    s = reduce(s, { type: "advance", atCamp: players }, config);
    const before = s.players.a!.morale;
    s = reduce(s, { type: "nightAction", playerId: "a", action: "repair" }, config);
    s = reduce(s, { type: "advance" }, config);
    expect(s.players.a!.morale).toBeGreaterThanOrEqual(Math.min(100, before + 5));
  });
});

describe("kết liễu", () => {
  it("chỉ kẻ phản bội, mỗi ngày một lần; người bị kết liễu gục; nhật ký không ghi ai ra tay", () => {
    const { state, traitor, victim } = withTraitor();
    expect(privateView(state, traitor, config)!.canAssassinate).toBe(true);
    expect(privateView(state, victim, config)!.canAssassinate).toBe(false);
    expect(() => reduce(state, { type: "assassinate", playerId: victim, target: traitor }, config)).toThrow();
    const s = reduce(state, { type: "assassinate", playerId: traitor, target: victim }, config);
    expect(s.players[victim]!.alive).toBe(false);
    expect(s.kills).toEqual([{ day: 1, by: traitor, target: victim }]);
    expect(JSON.stringify(s.log)).not.toContain(`"by"`);
    expect(canAssassinate(s, traitor)).toBe(false);
    const other = players.find((id) => id !== traitor && id !== victim)!;
    expect(() => reduce(s, { type: "assassinate", playerId: traitor, target: other }, config)).toThrow();
  });
});
