import { describe, expect, it } from "vitest";
import type { EventCard } from "./cards.ts";
import { checkModifiers, createGame, reduce, type GameAction, type GameConfig, type GameState } from "./game/index.ts";
import { testConfig } from "./testConfig.ts";

// Bù xui công khai, chia thẻ theo đồ mang theo, nhật ký chỉ số riêng.

function play(actions: GameAction[], config: GameConfig = testConfig, seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

const DAWN: GameAction[] = [
  { type: "join", playerId: "a", name: "An" },
  { type: "join", playerId: "b", name: "Bình" },
  { type: "start" },
  { type: "advance" },
  { type: "advance" },
];

describe("bù xui công khai", () => {
  it("trượt hai lần liền thì được Quyết tâm +1, bốn lần thì +2, qua một lần là hết", () => {
    const s = play(DAWN);
    const p = s.players.a!;
    const choice = testConfig.cards[0]!.choices[0]!;
    const bonus = () => checkModifiers(p, choice, testConfig).find((m) => m.label === "Quyết tâm")?.value ?? 0;
    expect(bonus()).toBe(0);
    p.failStreak = 2;
    expect(bonus()).toBe(1);
    p.failStreak = 4;
    expect(bonus()).toBe(2);
  });

  it("engine đếm số lần trượt liên tiếp của người chọn", () => {
    let s = play(DAWN);
    s = reduce(s, { type: "advance" }, testConfig);
    const placed = Object.values(s.anchors)[0]!;
    s = reduce(s, { type: "trigger", playerId: "a", anchorId: placed.anchorId, participants: ["a"] }, testConfig);
    const card = testConfig.cards.find((c) => c.id === placed.cardId)!;
    s = reduce(s, { type: "choose", playerId: "a", anchorId: placed.anchorId, choiceId: card.choices[0]!.id }, testConfig);
    const check = s.log.findLast((e) => e.kind === "check")!;
    expect(s.players.a!.failStreak).toBe(check.kind === "check" && check.result.success ? 0 : 1);
  });
});

describe("balo là lời khai", () => {
  it("thẻ được cộng điểm nhờ đồ cả đội mang theo xuất hiện thường hơn", () => {
    const base = testConfig.cards[0]!;
    const plain: EventCard = { ...base, id: "plain", choices: base.choices.map((c) => ({ ...c, check: { ...c.check, itemBonus: {} } })) };
    const roped: EventCard = { ...base, id: "roped", choices: base.choices.map((c) => ({ ...c, check: { ...c.check, itemBonus: { rope: 2 } } })) };
    const config: GameConfig = { ...testConfig, anchors: [testConfig.anchors[0]!], cards: [plain, roped] };
    let withRope = 0;
    const games = 300;
    for (let seed = 1; seed <= games; seed++) {
      const s = play(DAWN, config, seed);
      // Cho cả đội cầm dây thừng rồi xem thẻ nào được chia ở ngày kế tiếp.
      for (const p of Object.values(s.players)) p.items = ["rope"];
      let t = reduce(s, { type: "advance" }, config);
      t = reduce(t, { type: "advance" }, config);
      t = reduce(t, { type: "advance", atCamp: ["a", "b"] }, config);
      for (const p of Object.values(t.players)) p.items = ["rope"];
      t.usedCards = [];
      t = reduce(t, { type: "advance" }, config);
      if (Object.values(t.anchors)[0]?.cardId === "roped") withRope++;
    }
    // Trọng số 2:1 thì chừng hai phần ba.
    expect(withRope / games).toBeGreaterThan(0.56);
    expect(withRope / games).toBeLessThan(0.78);
  });
});

describe("nhật ký chỉ số riêng", () => {
  it("ghi ai mất bao nhiêu và vì sao; không ghi lúc chuẩn bị", () => {
    let s = play(DAWN);
    expect(s.statLog.a ?? []).toHaveLength(0);
    s = reduce(s, { type: "encounter", playerId: "a", source: "creature", refId: "c1", defId: "wild_boar", effects: { hp: -12, morale: -3 } }, testConfig);
    expect(s.statLog.a!.at(-1)).toEqual({ day: 1, reason: "encounter:creature:wild_boar", hp: -12, morale: -3 });
    expect(s.statLog.b ?? []).toHaveLength(0);
    // Qua hoàng hôn: đói thêm một ngày.
    s = reduce(s, { type: "advance" }, testConfig);
    s = reduce(s, { type: "advance" }, testConfig);
    s = reduce(s, { type: "advance", atCamp: ["a", "b"] }, testConfig);
    expect(s.statLog.b!.at(-1)).toMatchObject({ reason: "dusk" });
    expect(s.statLog.b!.at(-1)!.hunger).toBeLessThan(0);
  });
});

describe("đêm: lục soát, hồn ma, khảo sát nghi ngờ, khoảnh khắc", () => {
  const trio: GameAction[] = [...DAWN.slice(0, 2), { type: "join", playerId: "c", name: "Chi" }, ...DAWN.slice(2)];
  const night = (): GameState => {
    let s = play(trio);
    s = reduce(s, { type: "advance" }, testConfig);
    s = reduce(s, { type: "advance" }, testConfig);
    return reduce(s, { type: "advance", atCamp: ["a", "b", "c"] }, testConfig);
  };

  it("lục soát thấy cả ngăn bí mật và đồ giấu riêng; người bị lục chỉ biết là có người lục", () => {
    let s = night();
    s.players.b!.loot = ["amulet"];
    s = reduce(s, { type: "nightAction", playerId: "a", action: "search", target: "b" }, testConfig);
    expect(() => reduce(s, { type: "nightAction", playerId: "a", action: "search", target: "a" }, testConfig)).toThrow();
    s = reduce(s, { type: "advance" }, testConfig);
    const seen = s.clues.a!.at(-1)!.text;
    expect(seen).toContain("Bình");
    expect(seen).toContain("Bùa hộ mệnh");
    expect(s.clues.b!.at(-1)!.text).toContain("có người đã lục soát");
    expect(s.clues.b!.at(-1)!.text).not.toContain("An");
  });

  it("hồn ma thì thầm vào giấc mơ, làm lạnh gáy, hay dẫn lối manh mối; người sống thì không làm được", () => {
    let s = night();
    expect(() => reduce(s, { type: "ghostAction", playerId: "a", action: "guide" }, testConfig)).toThrow(/hồn ma/);
    s.players.c!.alive = false;
    s.campers = s.campers.filter((id) => id !== "c");
    s = reduce(s, { type: "ghostAction", playerId: "c", action: "whisper", target: "a", text: "  đừng   tin   Bình  " }, testConfig);
    s = reduce(s, { type: "advance" }, testConfig);
    expect(s.clues.a!.at(-1)!.text).toContain("“đừng tin Bình”");
    expect(s.ghostHistory).toMatchObject([{ playerId: "c", action: "whisper", target: "a" }]);
    expect(s.ghostChoices).toEqual({});
  });

  it("khảo sát nghi ngờ ghi đè trong đêm, và đánh dấu khoảnh khắc không trùng", () => {
    let s = night();
    s = reduce(s, { type: "suspect", playerId: "a", target: "b" }, testConfig);
    s = reduce(s, { type: "suspect", playerId: "a", target: "c" }, testConfig);
    expect(s.suspicions.filter((x) => x.playerId === "a")).toEqual([{ day: 1, playerId: "a", target: "c" }]);
    expect(() => reduce(s, { type: "suspect", playerId: "a", target: "a" }, testConfig)).toThrow();
    s = reduce(s, { type: "star", playerId: "b" }, testConfig);
    expect(s.stars).toEqual([{ day: 1, phase: "night", playerId: "b", logIndex: s.log.length - 1 }]);
    expect(() => reduce(s, { type: "star", playerId: "b" }, testConfig)).toThrow();
  });
});

describe("trao đồ", () => {
  it("đưa món đang cầm cho người khác, giữ nguyên mã món; không đưa cho mình hay người đã gục", () => {
    let s = play(DAWN);
    s = reduce(s, { type: "pickup", playerId: "a", itemId: "rope" }, testConfig);
    const uid = s.players.a!.bag.findLast((b) => b.itemId === "rope")!.uid;
    const before = s.players.b!.items.filter((i) => i === "rope").length;
    expect(() => reduce(s, { type: "give", playerId: "a", target: "a", uid }, testConfig)).toThrow();
    s = reduce(s, { type: "give", playerId: "a", target: "b", uid }, testConfig);
    expect(s.players.a!.bag.some((b) => b.uid === uid)).toBe(false);
    expect(s.players.b!.bag.find((b) => b.uid === uid)?.itemId).toBe("rope");
    expect(s.players.b!.items.filter((i) => i === "rope").length).toBe(before + 1);
    expect(s.log.at(-1)).toMatchObject({ kind: "give", playerId: "a", target: "b", itemId: "rope" });
    s.players.a!.alive = false;
    expect(() => reduce(s, { type: "give", playerId: "b", target: "a", uid }, testConfig)).toThrow(/gục/);
  });
});
