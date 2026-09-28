import { describe, expect, it } from "vitest";
import {
  BASE_BUDGET,
  COMPARTMENT,
  activePairs,
  bagWeight,
  canPlace,
  capacityKg,
  checkModifiers,
  createGame,
  firstFit,
  inCompartment,
  lookupFrom,
  reduce,
  visibleItems,
  type GameAction,
  type GameState,
  type Placement,
} from "./game/index.ts";
import { testConfig as config } from "./testConfig.ts";

const lookup = lookupFrom(config.items);
const item = (id: string) => lookup(id)!;
const play = (actions: GameAction[], seed = 1) => actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
const act = (s: GameState, ...actions: GameAction[]) => actions.reduce((acc, a) => reduce(acc, a, config), s);
const toPacking = (seed = 1) =>
  play([{ type: "join", playerId: "a", name: "An" }, { type: "join", playerId: "b", name: "Bình" }, { type: "start" }, { type: "advance" }], seed);

describe("lưới balo", () => {
  it("món 1x6 xoay ngang thì chiếm 6x1; không được ra ngoài lưới hay đè lên món khác", () => {
    const shovel = item("shovel");
    expect(canPlace([], shovel, 0, 10, 0, lookup)).toBe(true);
    expect(canPlace([], shovel, 0, 11, 0, lookup)).toBe(false);
    expect(canPlace([], shovel, 10, 15, 1, lookup)).toBe(true);
    expect(canPlace([], shovel, 11, 15, 1, lookup)).toBe(false);
    const bag: Placement[] = [{ uid: "1", itemId: "rope", x: 0, y: 0, rot: 0 }];
    expect(canPlace(bag, shovel, 1, 0, 0, lookup)).toBe(false);
    expect(canPlace(bag, shovel, 2, 0, 0, lookup)).toBe(true);
  });

  it("chỗ trống đầu tiên tránh ngăn bí mật; đồ nằm trọn trong ngăn thì đồng đội không thấy", () => {
    const spot = firstFit([], item("lantern"), lookup)!;
    expect(spot).toEqual({ x: 0, y: 0, rot: 0 });
    const hidden: Placement = { uid: "2", itemId: "lantern", x: COMPARTMENT.x, y: COMPARTMENT.y, rot: 0 };
    const half: Placement = { uid: "3", itemId: "rope", x: COMPARTMENT.x - 1, y: COMPARTMENT.y, rot: 0 };
    expect(inCompartment(hidden, lookup)).toBe(true);
    expect(inCompartment(half, lookup)).toBe(false);
  });

  it("đèn dầu nằm sát bản đồ thì đọc được bản đồ ban đêm (+2 Trí tuệ); cách một ô thì không", () => {
    const touching: Placement[] = [
      { uid: "1", itemId: "lantern", x: 0, y: 0, rot: 0 },
      { uid: "2", itemId: "old_map", x: 2, y: 0, rot: 0 },
    ];
    const apart: Placement[] = [touching[0]!, { uid: "2", itemId: "old_map", x: 3, y: 0, rot: 0 }];
    expect(activePairs(touching, lookup)).toContain("night_reading");
    expect(activePairs(apart, lookup)).not.toContain("night_reading");
  });

  it("trọng lượng cộng dồn; sức chứa tăng theo Thể lực", () => {
    const bag: Placement[] = [
      { uid: "1", itemId: "shovel", x: 0, y: 0, rot: 0 },
      { uid: "2", itemId: "flintlock", x: 1, y: 0, rot: 0 },
    ];
    expect(bagWeight(bag, lookup)).toBeCloseTo(5.5);
    expect(capacityKg(5)).toBeGreaterThan(capacityKg(1));
  });
});

describe("xếp balo", () => {
  it("mua trừ tiền vào khay, xếp vào balo, bán lại thì hoàn tiền", () => {
    let s = toPacking();
    const itemId = s.shop.find((id) => id !== "shovel")!;
    const price = item(itemId).price;
    const budget = s.players.a!.budget;
    s = act(s, { type: "buy", playerId: "a", itemId });
    expect(s.players.a!.budget).toBe(budget - price);
    const uid = s.players.a!.tray[0]!.uid;
    const spot = firstFit(s.players.a!.bag, item(itemId), lookup)!;
    s = act(s, { type: "place", playerId: "a", uid, ...spot });
    expect(s.players.a!.items).toContain(itemId);
    s = act(s, { type: "sell", playerId: "a", uid });
    expect(s.players.a!.budget).toBe(budget);
  });

  it("không mua quá ngân sách, không đặt đè, không bán đồ của xuất thân", () => {
    let s = toPacking();
    const p = s.players.a!;
    expect(p.budget).toBeGreaterThanOrEqual(BASE_BUDGET);
    s = { ...s, players: { ...s.players, a: { ...p, budget: 1 } } };
    expect(() => reduce(s, { type: "buy", playerId: "a", itemId: "shovel" }, config)).toThrow(/tiền/);
    const start = p.bag[0]!;
    expect(() => reduce(s, { type: "sell", playerId: "a", uid: start.uid }, config)).toThrow(/xuất thân/);
    s = { ...s, players: { ...s.players, a: { ...p, budget: 100 } } };
    s = act(s, { type: "buy", playerId: "a", itemId: "shovel" });
    const uid = s.players.a!.tray[0]!.uid;
    expect(() => reduce(s, { type: "place", playerId: "a", uid, x: start.x, y: start.y, rot: 0 }, config)).toThrow(/không vừa/);
  });

  it("hết giờ: đồ còn trong khay được nhét vào chỗ trống, đồ ăn trong balo góp vào kho chung", () => {
    let s = toPacking();
    const food = s.food;
    s = { ...s, shop: [...s.shop, "hardtack"] };
    s = act(s, { type: "buy", playerId: "a", itemId: "hardtack" }, { type: "buy", playerId: "a", itemId: "hardtack" });
    const [first] = s.players.a!.tray;
    const spot = firstFit(s.players.a!.bag, item("hardtack"), lookup)!;
    s = act(s, { type: "place", playerId: "a", uid: first!.uid, ...spot }, { type: "advance" });
    expect(s.phase).toBe("dawn");
    expect(s.food).toBe(food + 2);
    expect(s.players.a!.tray).toHaveLength(0);
    expect(s.players.a!.items).not.toContain("hardtack");
  });

  it("đồ trong ngăn bí mật không lộ với đồng đội", () => {
    const s = toPacking();
    const p = { ...s.players.a!, bag: [{ uid: "x", itemId: "rum", x: COMPARTMENT.x, y: COMPARTMENT.y, rot: 0 as const }], items: ["rum"] };
    expect(visibleItems(p, config)).toEqual([]);
  });
});

describe("tạo nhân vật", () => {
  const base = play([{ type: "join", playerId: "a", name: "An" }, { type: "start" }]);
  const stats = { strength: 5, dexterity: 3, intellect: 3, charisma: 3, nerve: 3 };

  it("phải chia đúng 17 điểm (15 + 2 của tật xấu), mỗi thuộc tính 1–5", () => {
    const ok = reduce(base, { type: "createCharacter", playerId: "a", stats, background: "guide", flaw: "fear_dark", bio: "  trốn nợ  " }, config);
    expect(ok.players.a).toMatchObject({ background: "guide", flaw: "fear_dark", bio: "trốn nợ", created: true, maxHp: 110 });
    expect(() => reduce(base, { type: "createCharacter", playerId: "a", stats: { ...stats, strength: 4 }, background: "guide", flaw: "liar", bio: "" }, config)).toThrow(/17/);
    expect(() => reduce(base, { type: "createCharacter", playerId: "a", stats: { ...stats, strength: 6, nerve: 2 }, background: "guide", flaw: "liar", bio: "" }, config)).toThrow();
  });

  it("con nhà giàu có thêm tiền nhưng kém Gan dạ", () => {
    const s = reduce(base, { type: "createCharacter", playerId: "a", stats, background: "rich_kid", flaw: "liar", bio: "" }, config);
    expect(s.players.a!.stats.nerve).toBe(2);
    expect(s.players.a!.budget).toBe(BASE_BUDGET + 30);
  });

  it("xuất thân và tật xấu hiện trong bảng cộng điểm xúc xắc theo vùng", () => {
    const choice = { id: "x", label: "x", check: { stat: "dexterity" as const, dc: 10 }, onSuccess: {}, onFail: {}, successText: "", failText: "" };
    const player = { stats, items: [], hunger: 50, morale: 50, bag: [], background: "guide" as const, flaw: "fear_dark" as const };
    expect(checkModifiers(player, choice, config, "cave")).toEqual([
      { label: "Người dẫn đường", value: 2 },
      { label: "Sợ bóng tối", value: -2 },
    ]);
    expect(checkModifiers(player, choice, config, "beach")).toEqual([]);
  });

  it("mang quá tải thì kiểm tra Thể lực, Khéo léo bị trừ", () => {
    const heavy: Placement[] = Array.from({ length: 6 }, (_, i) => ({ uid: `${i}`, itemId: "flintlock", x: i, y: 0, rot: 0 as const }));
    const choice = { id: "x", label: "x", check: { stat: "strength" as const, dc: 10 }, onSuccess: {}, onFail: {}, successText: "", failText: "" };
    const player = { stats: { ...stats, strength: 1 }, items: [], hunger: 50, morale: 50, bag: heavy, background: "rich_kid" as const, flaw: "liar" as const };
    expect(checkModifiers(player, choice, config)).toContainEqual({ label: "Quá tải", value: -2 });
  });
});
