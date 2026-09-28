import { describe, expect, it } from "vitest";
import { createGame, missingMaterials, reduce, type GameAction, type GameConfig, type GameState } from "./game/index.ts";
import { testConfig } from "./testConfig.ts";

// Chế tạo đồ từ nguyên liệu trong balo, và đóng ván vá thuyền.

const config: GameConfig = {
  ...testConfig,
  items: [
    ...testConfig.items,
    { id: "wood", name: "Khúc gỗ", size: { w: 1, h: 3 }, weightKg: 1.2, price: 0, tags: ["wood"], loot: true },
    { id: "stone", name: "Hòn đá", size: { w: 1, h: 1 }, weightKg: 0.4, price: 0, tags: ["rock"], loot: true },
    { id: "stone_axe", name: "Rìu đá", size: { w: 2, h: 3 }, weightKg: 2, price: 0, tags: ["tool"], loot: true, craft: { needs: { wood: 1, stone: 2 } } },
    { id: "torch_x", name: "Đuốc", size: { w: 1, h: 3 }, weightKg: 1, price: 0, tags: ["light"], loot: true, craft: { needs: { wood: 1 }, fire: true } },
    { id: "plank", name: "Ván", size: { w: 2, h: 5 }, weightKg: 3, price: 0, tags: ["wood"], loot: true, hull: 5, craft: { needs: { wood: 3 } } },
    { id: "boulder", name: "Tảng đá", size: { w: 16, h: 16 }, weightKg: 1, price: 0, tags: ["rock"], loot: true, craft: { needs: { stone: 1 } } },
  ],
};

const DAWN: GameAction[] = [
  { type: "join", playerId: "a", name: "An" },
  { type: "join", playerId: "b", name: "Bình" },
  { type: "start" },
  { type: "advance" },
  { type: "advance" },
];

function withLoot(...items: string[]): GameState {
  let s = DAWN.reduce((st, a) => reduce(st, a, config), createGame(1));
  for (const itemId of items) s = reduce(s, { type: "pickup", playerId: "a", itemId }, config);
  return s;
}

const count = (s: GameState, itemId: string) => s.players.a!.items.filter((i) => i === itemId).length;

describe("chế tạo", () => {
  it("đủ nguyên liệu thì mất nguyên liệu, được món mới trong balo và ghi nhật ký", () => {
    let s = withLoot("wood", "stone", "stone", "stone");
    s = reduce(s, { type: "craft", playerId: "a", itemId: "stone_axe" }, config);
    expect(count(s, "stone_axe")).toBe(1);
    expect(count(s, "wood")).toBe(0);
    expect(count(s, "stone")).toBe(1);
    expect(s.log.at(-1)).toMatchObject({ kind: "craft", playerId: "a", itemId: "stone_axe" });
  });

  it("thiếu nguyên liệu thì từ chối và báo thiếu gì", () => {
    const s = withLoot("wood", "stone");
    expect(missingMaterials(s.players.a!.items, { wood: 1, stone: 2 })).toEqual({ stone: 1 });
    expect(() => reduce(s, { type: "craft", playerId: "a", itemId: "stone_axe" }, config)).toThrow(/nguyên liệu/);
    expect(() => reduce(s, { type: "craft", playerId: "a", itemId: "wood" }, config)).toThrow(/không chế tạo/);
  });

  it("công thức cần lửa thì phải đứng cạnh lửa trại", () => {
    const s = withLoot("wood");
    expect(() => reduce(s, { type: "craft", playerId: "a", itemId: "torch_x" }, config)).toThrow(/lửa trại/);
    const done = reduce(s, { type: "craft", playerId: "a", itemId: "torch_x", atFire: true }, config);
    expect(count(done, "torch_x")).toBe(1);
  });

  it("balo không còn chỗ cho món mới thì giữ nguyên nguyên liệu", () => {
    const s = withLoot("stone");
    expect(() => reduce(s, { type: "craft", playerId: "a", itemId: "boulder" }, config)).toThrow(/chỗ/);
    expect(count(s, "stone")).toBe(1);
  });

  it("ván vá thuyền góp ở lửa trại làm thuyền bền thêm", () => {
    let s = withLoot("wood", "wood", "wood");
    s = reduce(s, { type: "craft", playerId: "a", itemId: "plank" }, config);
    s.hull = 50;
    const uid = s.players.a!.bag.find((b) => b.itemId === "plank")!.uid;
    s = reduce(s, { type: "repair", playerId: "a", uid }, config);
    expect(s.hull).toBe(55);
    expect(count(s, "plank")).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ kind: "repair", amount: 5 });
    const wood = withLoot("wood");
    expect(() => reduce(wood, { type: "repair", playerId: "a", uid: wood.players.a!.bag.find((b) => b.itemId === "wood")!.uid }, config)).toThrow();
  });
});
