import { describe, expect, it } from "vitest";
import { TOTAL_DAYS, createGame, reduce, type GameAction, type GameState } from "./game.ts";
import { STAT_IDS } from "./stats.ts";
import { testConfig as config } from "./testConfig.ts";

function play(actions: GameAction[], seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

const lobby: GameAction[] = [
  { type: "join", playerId: "a", name: "An" },
  { type: "join", playerId: "b", name: "Bình" },
];

describe("sảnh chờ", () => {
  it("chia đúng 15 điểm thuộc tính, mỗi thuộc tính 1–5, và phát 3 món đồ khác nhau", () => {
    const s = play(lobby);
    for (const p of Object.values(s.players)) {
      const values = STAT_IDS.map((id) => p.stats[id]);
      expect(values.reduce((a, b) => a + b, 0)).toBe(15);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...values)).toBeLessThanOrEqual(5);
      expect(new Set(p.items).size).toBe(3);
      expect(p.hp).toBe(p.maxHp);
    }
  });

  it("không cho vào sau khi ván đã bắt đầu", () => {
    const s = play([...lobby, { type: "start" }]);
    expect(() => reduce(s, { type: "join", playerId: "c", name: "Chi" }, config)).toThrow(/đã bắt đầu/);
  });
});

describe("vòng ngày", () => {
  it("bình minh ngày 1: có thời tiết 10 ngày, lương thực theo số người, thẻ đã đặt lên map", () => {
    const s = play([...lobby, { type: "start" }]);
    expect(s.phase).toBe("dawn");
    expect(s.day).toBe(1);
    expect(s.weather).toHaveLength(TOTAL_DAYS);
    expect(s.food).toBe(4);
    expect(Object.keys(s.anchors).length).toBeGreaterThan(0);
    // Hai điểm cùng loại không nhận cùng một thẻ trong một ngày.
    const cardIds = Object.values(s.anchors).map((a) => a.cardId);
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });

  it("đi hết các pha theo thứ tự và kết thúc sau ngày 10", () => {
    let s = play([...lobby, { type: "start" }]);
    const phases: string[] = [];
    while (s.phase !== "ended") {
      phases.push(s.phase);
      s = reduce(s, { type: "advance", atCamp: ["a", "b"] }, config);
    }
    expect(phases.slice(0, 5)).toEqual(["dawn", "explore", "dusk", "night", "dawn"]);
    expect(s.day).toBe(TOTAL_DAYS);
    expect(s.ending).toBe("empty_handed");
  });

  it("hoàng hôn: người ngoài trại ngủ ngoài, không được ngồi quanh đống lửa", () => {
    let s = play([...lobby, { type: "start" }, { type: "advance" }, { type: "advance" }]);
    const before = structuredClone(s.players);
    s = reduce(s, { type: "advance", atCamp: ["a"] }, config);
    expect(s.phase).toBe("night");
    expect(s.campers).toEqual(["a"]);
    expect(s.players.b!.morale).toBe(before.b!.morale - 15);
    expect(s.players.b!.hp).toBe(before.b!.hp - 10);
    expect(s.players.a!.hp).toBe(before.a!.hp);
    expect(s.log.at(-1)).toMatchObject({ kind: "dusk", sleptOutside: ["b"] });
  });
});

describe("đêm", () => {
  const trio: GameAction[] = [...lobby, { type: "join", playerId: "c", name: "Chi" }];
  const night = (atCamp = ["a", "b", "c"]) =>
    play([...trio, { type: "start" }, { type: "advance" }, { type: "advance" }, { type: "advance", atCamp }]);
  const endNight = (s: GameState) => reduce(s, { type: "advance" }, config);

  it("không ai bầu thì chia đều: mỗi người trong trại một khẩu phần, người ngủ ngoài nhịn", () => {
    const s0 = night(["a", "b"]);
    const s = endNight(s0);
    expect(s.food).toBe(s0.food - 2);
    expect(s.players.a!.hunger).toBe(s0.players.a!.hunger + 25);
    expect(s.players.c!.hunger).toBe(s0.players.c!.hunger);
    expect(s.log.at(-1)).toMatchObject({ kind: "night", ration: "normal", ate: 2, tied: null });
    expect(s.phase).toBe("dawn");
  });

  it("theo phiếu đa số: ăn dè thì hai người chung một khẩu phần", () => {
    let s = night();
    s = reduce(s, { type: "vote", playerId: "a", ballot: "ration", choice: "half" }, config);
    s = reduce(s, { type: "vote", playerId: "b", ballot: "ration", choice: "half" }, config);
    s = reduce(s, { type: "vote", playerId: "c", ballot: "ration", choice: "full" }, config);
    const food = s.food;
    s = endNight(s);
    expect(s.log.at(-1)).toMatchObject({ ration: "half", ate: 2 });
    expect(s.food).toBe(food - 2);
  });

  it("đổi phiếu được, phiếu sau cùng mới tính; hoà thì chia đều", () => {
    let s = night();
    s = reduce(s, { type: "vote", playerId: "a", ballot: "ration", choice: "skip" }, config);
    s = reduce(s, { type: "vote", playerId: "a", ballot: "ration", choice: "full" }, config);
    s = reduce(s, { type: "vote", playerId: "b", ballot: "ration", choice: "skip" }, config);
    expect(endNight(s).log.at(-1)).toMatchObject({ ration: "normal" });
  });

  it("trói khi quá nửa trại đồng ý; người bị trói không mở được sự kiện hôm sau", () => {
    let s = night();
    s = reduce(s, { type: "vote", playerId: "a", ballot: "tie", choice: "c" }, config);
    s = reduce(s, { type: "vote", playerId: "b", ballot: "tie", choice: "c" }, config);
    s = endNight(s);
    expect(s.players.c!.tied).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ tied: "c" });
    s = reduce(s, { type: "advance" }, config);
    const anchorId = Object.keys(s.anchors)[0]!;
    expect(() => reduce(s, { type: "trigger", playerId: "c", anchorId, participants: ["c"] }, config)).toThrow();
    // Hoàng hôn hôm sau thì được thả.
    s = reduce(reduce(s, { type: "advance" }, config), { type: "advance", atCamp: ["a", "b", "c"] }, config);
    expect(s.players.c!.tied).toBe(false);
  });

  it("một nửa số phiếu thì chưa đủ để trói", () => {
    let s = night(["a", "b"]);
    s = reduce(s, { type: "vote", playerId: "a", ballot: "tie", choice: "b" }, config);
    expect(endNight(s).players.b!.tied).toBe(false);
  });

  it("người ngủ ngoài không được bỏ phiếu; không tự trói mình; ban ngày không bỏ phiếu", () => {
    const s = night(["a", "b"]);
    expect(() => reduce(s, { type: "vote", playerId: "c", ballot: "ration", choice: "full" }, config)).toThrow();
    expect(() => reduce(s, { type: "vote", playerId: "a", ballot: "tie", choice: "a" }, config)).toThrow();
    expect(() => reduce(s, { type: "vote", playerId: "a", ballot: "tie", choice: "c" }, config)).toThrow();
    const day = endNight(s);
    expect(() => reduce(day, { type: "vote", playerId: "a", ballot: "ration", choice: "full" }, config)).toThrow();
  });

  it("hết lương thực thì ai No về 0 sẽ mất máu", () => {
    let s = night();
    s = { ...s, food: 0, players: { ...s.players, a: { ...s.players.a!, hunger: 0 } } };
    s = endNight(s);
    expect(s.players.a!.hp).toBe(night().players.a!.hp - 15);
    expect(s.log.at(-1)).toMatchObject({ ate: 0, starving: ["a"] });
  });
});

describe("điểm sự kiện", () => {
  const explore = [...lobby, { type: "start" } as const, { type: "advance" } as const];

  function withCard(cardId: string): { s: GameState; anchorId: string } {
    for (let seed = 1; seed < 200; seed++) {
      const s = play(explore, seed);
      const placed = Object.values(s.anchors).find((a) => a.cardId === cardId);
      if (placed) return { s, anchorId: placed.anchorId };
    }
    throw new Error(`Không seed nào đặt thẻ ${cardId}`);
  }

  it("chỉ mở được trong giờ khám phá", () => {
    const s = play([...lobby, { type: "start" }]);
    const anchorId = Object.keys(s.anchors)[0]!;
    expect(() => reduce(s, { type: "trigger", playerId: "a", anchorId, participants: ["a"] }, config)).toThrow();
  });

  it("người đứng đó tham gia; kết quả tung xúc xắc được ghi công khai kèm các khoản cộng", () => {
    const { s: s0, anchorId } = withCard("coconut");
    let s = reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a", "b"] }, config);
    expect(s.anchors[anchorId]).toMatchObject({ status: "active", participants: ["a", "b"] });
    expect(() => reduce(s, { type: "trigger", playerId: "b", anchorId, participants: ["b"] }, config)).toThrow();

    s = reduce(s, { type: "choose", playerId: "b", anchorId, choiceId: "climb" }, config);
    expect(s.anchors[anchorId]!.status).toBe("resolved");
    const entry = s.log.at(-1)!;
    expect(entry.kind).toBe("check");
    if (entry.kind !== "check") return;
    expect(entry.result.modifiers[0]).toEqual({ label: "Khéo léo", value: s.players.b!.stats.dexterity });
    expect(entry.result.modifiers.some((m) => m.label === "Dây thừng")).toBe(s0.players.b!.items.includes("rope"));
    if (entry.result.success) expect(s.food).toBe(s0.food + 2);
    else for (const id of ["a", "b"]) expect(s.players[id]!.hp).toBe(s0.players[id]!.hp - 10);
  });

  it("người không có mặt không được chọn thay", () => {
    const { s: s0, anchorId } = withCard("coconut");
    const s = reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a"] }, config);
    expect(() => reduce(s, { type: "choose", playerId: "b", anchorId, choiceId: "climb" }, config)).toThrow();
  });

  it("chết khi máu về 0; cả đội chết thì ván kết thúc", () => {
    const { s: s0, anchorId } = withCard("deadly");
    let s = reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a", "b"] }, config);
    s = reduce(s, { type: "choose", playerId: "a", anchorId, choiceId: "jump" }, config);
    expect(s.players.a!.alive).toBe(false);
    expect(s.players.a!.items).toHaveLength(2);
    expect(s.phase).toBe("ended");
    expect(s.ending).toBe("buried");
  });

  it("đặt cờ, trạng thái cảnh và tiến độ kho báu", () => {
    const { s: s0, anchorId } = withCard("deadly");
    let s = reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a"] }, config);
    s = reduce(s, { type: "choose", playerId: "a", anchorId, choiceId: "map" }, config);
    expect(s.flags).toContain("found_path");
    expect(s.sceneStates[anchorId]).toBe("tunnel_explored");
    expect(s.treasure).toBe(60);
  });

  it("hết giờ khám phá thì sự kiện dở dang tự chọn lựa chọn đầu", () => {
    const { s: s0, anchorId } = withCard("coconut");
    let s = reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a"] }, config);
    s = reduce(s, { type: "advance" }, config);
    expect(s.phase).toBe("dusk");
    expect(s.log.at(-1)).toMatchObject({ kind: "check", choiceId: "climb", playerId: "a" });
  });

  it("không sửa state đầu vào", () => {
    const s0 = play(explore);
    const snapshot = JSON.stringify(s0);
    const anchorId = Object.keys(s0.anchors)[0]!;
    reduce(s0, { type: "trigger", playerId: "a", anchorId, participants: ["a"] }, config);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
