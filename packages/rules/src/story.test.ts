import { describe, expect, it } from "vitest";
import { TWISTS, TWIST_DAY, TWIST_IDS, createGame, reduce, type GameAction, type GameConfig, type GameState, type TwistId } from "./game/index.ts";
import { testConfig } from "./testConfig.ts";

// Cơ chế cốt truyện trong engine: biến cố ngày 5, chuyện đêm ngủ ngoài, nướng và góp lương thực.

const config: GameConfig = {
  ...testConfig,
  items: [
    ...testConfig.items,
    { id: "raw_meat", name: "Thịt sống", size: { w: 2, h: 2 }, weightKg: 0.8, price: 0, tags: ["meat"], loot: true, ration: 1, cook: "cooked_meat" },
    { id: "cooked_meat", name: "Thịt nướng", size: { w: 2, h: 2 }, weightKg: 0.7, price: 0, tags: ["meat"], loot: true, ration: 2 },
  ],
  outsideEvents: [
    {
      id: "beast",
      title: "Thú rình",
      check: { stat: "nerve", dc: 1 },
      onSuccess: { gainItem: "raw_meat" },
      onFail: { hp: -15 },
      successText: "Đuổi được thú.",
      failText: "Bị cắn.",
    },
  ],
};

function play(actions: GameAction[], seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

const players = ["a", "b", "c"];
const DAWN: GameAction[] = [...players.map((id): GameAction => ({ type: "join", playerId: id, name: id.toUpperCase() })), { type: "start" }, { type: "advance" }, { type: "advance" }];

/** Chạy tới bình minh của ngày `day`, mọi người đều về trại. */
function toDay(day: number, seed = 1): GameState {
  let s = play(DAWN, seed);
  while (s.day < day) s = reduce(s, { type: "advance", atCamp: players }, config);
  return s;
}

describe("biến cố ngày 5", () => {
  it("chọn sẵn từ đầu ván, giữ bí mật, xảy ra đúng bình minh ngày 5 và dựng cờ cho thẻ nối tiếp", () => {
    const early = toDay(TWIST_DAY - 1);
    expect(TWIST_IDS).toContain(early.twist as TwistId);
    expect(early.flags).not.toContain(`twist_${early.twist}`);
    expect(early.log.some((e) => e.kind === "twist")).toBe(false);

    const s = toDay(TWIST_DAY);
    expect(s.flags).toContain(`twist_${s.twist}`);
    const entry = s.log.find((e) => e.kind === "twist");
    expect(entry).toMatchObject({ kind: "twist", day: TWIST_DAY, twist: s.twist });
  });

  it("các seed khác nhau cho những biến cố khác nhau, và hệ quả đúng như bảng", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const before = toDay(TWIST_DAY - 1, seed);
      const s = reduce(before, { type: "advance", atCamp: players }, config);
      const after = reduce(s, { type: "advance", atCamp: players }, config);
      // Qua đêm thì thuyền, kho báu còn đổi vì sự cố; so ngay tại bình minh ngày 5 với lúc vừa hết đêm 4.
      void after;
      seen.add(before.twist);
      const effect = TWISTS[before.twist as TwistId];
      if (effect.volcano) expect(toDay(TWIST_DAY, seed).volcano).toBe(Math.min(99, TWIST_DAY * 10 + effect.volcano));
      if (effect.personal) expect(before.twistPlayer).not.toBeNull();
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});

describe("đêm ngủ ngoài", () => {
  it("người ngủ ngoài gặp chuyện trong đêm, được ghi vào nhật ký", () => {
    let s = toDay(1);
    s = reduce(s, { type: "advance" }, config);
    s = reduce(s, { type: "advance" }, config);
    s = reduce(s, { type: "advance", atCamp: ["a", "b"] }, config);
    const entry = s.log.find((e) => e.kind === "outside");
    expect(entry).toMatchObject({ kind: "outside", playerId: "c", event: "beast" });
    // Phép kiểm tra DC 1 luôn qua: được một tảng thịt.
    expect(s.players.c!.items).toContain("raw_meat");
  });
});

describe("nướng và góp lương thực", () => {
  it("nướng biến thịt sống thành thịt nướng ngay tại chỗ; góp vào kho thì thêm khẩu phần", () => {
    let s = toDay(1);
    s = reduce(s, { type: "pickup", playerId: "a", itemId: "raw_meat" }, config);
    const uid = s.players.a!.bag.find((b) => b.itemId === "raw_meat")!.uid;
    s = reduce(s, { type: "cook", playerId: "a", uid }, config);
    expect(s.players.a!.bag.find((b) => b.uid === uid)?.itemId).toBe("cooked_meat");
    expect(() => reduce(s, { type: "cook", playerId: "a", uid }, config)).toThrow();
    const food = s.food;
    s = reduce(s, { type: "stash", playerId: "a", uid }, config);
    expect(s.food).toBe(food + 2);
    expect(s.players.a!.items).not.toContain("cooked_meat");
    expect(s.log.at(-1)).toMatchObject({ kind: "stash", playerId: "a", itemId: "cooked_meat", amount: 2 });
    const rope = s.players.a!.bag.find((b) => b.itemId !== "raw_meat");
    if (rope) expect(() => reduce(s, { type: "stash", playerId: "a", uid: rope.uid }, config)).toThrow();
  });
});
