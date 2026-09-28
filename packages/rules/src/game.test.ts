import { describe, expect, it } from "vitest";
import { BACKGROUNDS, DIFFICULTIES, OUTSIDE_MORALE, TOTAL_DAYS, createGame, rationVoteNeeded, reduce, successChance, type FlawId, type GameAction, type GameState } from "./game/index.ts";
import { STAT_IDS } from "./stats.ts";
import { testConfig as config } from "./testConfig.ts";

function play(actions: GameAction[], seed = 1): GameState {
  return actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
}

/** Bắt đầu ván rồi qua hai pha chuẩn bị (tạo nhân vật, xếp balo) để tới bình minh ngày 1. */
const START: GameAction[] = [{ type: "start" }, { type: "advance" }, { type: "advance" }];

const lobby: GameAction[] = [
  { type: "join", playerId: "a", name: "An" },
  { type: "join", playerId: "b", name: "Bình" },
];

describe("sảnh chờ", () => {
  it("ai không kịp tạo nhân vật thì nhận nhân vật ngẫu nhiên hợp lệ, kèm món đồ của xuất thân", () => {
    const s = play([...lobby, ...START]);
    for (const p of Object.values(s.players)) {
      const values = STAT_IDS.map((id) => p.stats[id]);
      expect(values.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(16);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...values)).toBeLessThanOrEqual(5);
      expect(p.items).toContain(BACKGROUNDS[p.background].startItem);
      expect(p.hp).toBe(p.maxHp);
    }
  });

  it("không cho vào sau khi ván đã bắt đầu", () => {
    const s = play([...lobby, ...START]);
    expect(() => reduce(s, { type: "join", playerId: "c", name: "Chi" }, config)).toThrow(/đã bắt đầu/);
  });
});

describe("vòng ngày", () => {
  it("bình minh ngày 1: có thời tiết 10 ngày, lương thực theo số người, thẻ đã đặt lên map", () => {
    const s = play([...lobby, ...START]);
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
    let s = play([...lobby, ...START]);
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
    let s = play([...lobby, ...START, { type: "advance" }, { type: "advance" }]);
    const before = structuredClone(s.players);
    s = reduce(s, { type: "advance", atCamp: ["a"] }, config);
    expect(s.phase).toBe("night");
    expect(s.campers).toEqual(["a"]);
    // Không có chuyện đêm nào trong bộ nội dung test: chỉ mất Tinh thần vì ngủ ngoài và 10 Máu vì lạnh.
    expect(s.players.b!.morale).toBe(before.b!.morale - OUTSIDE_MORALE);
    expect(s.players.b!.hp).toBe(before.b!.hp - 10);
    expect(s.players.a!.hp).toBe(before.a!.hp);
    expect(s.log.at(-1)).toMatchObject({ kind: "dusk", sleptOutside: ["b"] });
  });
});

describe("đêm", () => {
  const trio: GameAction[] = [...lobby, { type: "join", playerId: "c", name: "Chi" }];
  const night = (atCamp = ["a", "b", "c"], food?: number): GameState => {
    const s = play([...trio, ...START, { type: "advance" }, { type: "advance" }, { type: "advance", atCamp }]);
    // Tật xấu không ảnh hưởng ban đêm, để lượng ăn uống trong test không phụ thuộc may rủi.
    const players = Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, flaw: "liar" as FlawId }]));
    return { ...s, players, food: food ?? s.food };
  };
  const nightLog = (s: GameState) => [...s.log].reverse().find((e) => e.kind === "night");
  const endNight = (s: GameState) => reduce(s, { type: "advance" }, config);
  const act = (s: GameState, ...actions: GameAction[]) => actions.reduce((acc, a) => reduce(acc, a, config), s);

  it("đủ lương thực thì chia đều, không cần bầu; người ngủ ngoài nhịn", () => {
    const s0 = night(["a", "b"]);
    expect(rationVoteNeeded(s0)).toBe(false);
    expect(() => reduce(s0, { type: "ration", playerId: "a", choice: "half" }, config)).toThrow(/đủ chia/);
    const s = endNight(s0);
    expect(s.food).toBe(s0.food - 2);
    expect(s.players.a!.hunger).toBe(s0.players.a!.hunger + 25);
    expect(s.players.c!.hunger).toBe(s0.players.c!.hunger);
    expect(nightLog(s)).toMatchObject({ kind: "night", ration: "normal", ate: 2, tied: null, nominee: null });
    expect(s.phase).toBe("dawn");
  });

  it("thiếu lương thực thì bầu; ăn dè là hai người chung một khẩu phần", () => {
    let s = night(["a", "b", "c"], 2);
    expect(rationVoteNeeded(s)).toBe(true);
    s = act(
      s,
      { type: "ration", playerId: "a", choice: "half" },
      { type: "ration", playerId: "b", choice: "half" },
      { type: "ration", playerId: "c", choice: "skip" },
    );
    s = endNight(s);
    expect(nightLog(s)).toMatchObject({ ration: "half", ate: 2 });
    expect(s.food).toBe(0);
  });

  it("thiếu mà chia đều thì người đói nhất ăn trước", () => {
    let s = night(["a", "b", "c"], 1);
    s = { ...s, players: { ...s.players, c: { ...s.players.c!, hunger: 5 } } };
    s = endNight(s);
    expect(s.players.c!.hunger).toBe(30);
    expect(nightLog(s)).toMatchObject({ ration: "normal", ate: 1 });
  });

  it("phiếu trói: đề cử, bỏ phiếu kín, đủ người thì tự lật; quá nửa đồng ý thì trói", () => {
    let s = act(night(), { type: "nominate", playerId: "a", target: "c" });
    expect(() => reduce(s, { type: "nominate", playerId: "b", target: "a" }, config)).toThrow(/đã có người bị đề cử/);
    s = act(s, { type: "ballot", playerId: "a", tie: true }, { type: "ballot", playerId: "b", tie: true });
    expect(s.votes.tie!.revealed).toBe(false);
    expect(() => reduce(s, { type: "ballot", playerId: "a", tie: false }, config)).toThrow(/không đổi được/);
    s = act(s, { type: "ballot", playerId: "c", tie: false });
    expect(s.votes.tie!.revealed).toBe(true);
    s = endNight(s);
    expect(s.players.c!.tied).toBe(true);
    expect(nightLog(s)).toMatchObject({ nominee: "c", yes: ["a", "b"], no: ["c"], tied: "c" });
    s = reduce(s, { type: "advance" }, config);
    const anchorId = Object.keys(s.anchors)[0]!;
    expect(() => reduce(s, { type: "trigger", playerId: "c", anchorId, participants: ["c"] }, config)).toThrow();
    // Vẫn bị trói qua hoàng hôn hôm sau (đêm đó không có năng lực), hết đêm mới được thả.
    s = act(s, { type: "advance" }, { type: "advance", atCamp: ["a", "b", "c"] });
    expect(s.players.c!.tied).toBe(true);
    s = endNight(s);
    expect(s.players.c!.tied).toBe(false);
  });

  it("người không bầu tính là không đồng ý; một nửa thì chưa đủ để trói", () => {
    let s = act(night(["a", "b"]), { type: "nominate", playerId: "a", target: "b" }, { type: "ballot", playerId: "a", tie: true });
    s = endNight(s);
    expect(s.players.b!.tied).toBe(false);
    expect(nightLog(s)).toMatchObject({ nominee: "b", yes: ["a"], no: [], tied: null });
  });

  it("server lật phiếu sớm được; đã lật thì không bỏ thêm", () => {
    let s = act(night(), { type: "nominate", playerId: "a", target: "c" }, { type: "ballot", playerId: "a", tie: true }, { type: "revealBallot" });
    expect(s.votes.tie!.revealed).toBe(true);
    expect(() => reduce(s, { type: "ballot", playerId: "b", tie: true }, config)).toThrow(/đã lật/);
  });

  it("người ngủ ngoài không được bầu; không tự đề cử mình; ban ngày không bầu", () => {
    const s = night(["a", "b"], 0);
    expect(() => reduce(s, { type: "ration", playerId: "c", choice: "half" }, config)).toThrow();
    expect(() => reduce(s, { type: "nominate", playerId: "a", target: "a" }, config)).toThrow();
    expect(() => reduce(s, { type: "nominate", playerId: "a", target: "c" }, config)).toThrow();
    const day = endNight(s);
    expect(() => reduce(day, { type: "nominate", playerId: "a", target: "b" }, config)).toThrow();
  });

  it("hết lương thực thì ai No về 0 sẽ mất máu", () => {
    let s = night(["a", "b", "c"], 0);
    s = { ...s, players: { ...s.players, a: { ...s.players.a!, hunger: 0 } } };
    s = endNight(s);
    expect(s.players.a!.hp).toBe(night().players.a!.hp - 15);
    expect(nightLog(s)).toMatchObject({ ate: 0, starving: ["a"] });
  });
});

describe("điểm sự kiện", () => {
  const explore: GameAction[] = [...lobby, ...START, { type: "advance" }];

  function withCard(cardId: string): { s: GameState; anchorId: string } {
    for (let seed = 1; seed < 200; seed++) {
      const s = play(explore, seed);
      const placed = Object.values(s.anchors).find((a) => a.cardId === cardId);
      if (placed) return { s, anchorId: placed.anchorId };
    }
    throw new Error(`Không seed nào đặt thẻ ${cardId}`);
  }

  it("chỉ mở được trong giờ khám phá", () => {
    const s = play([...lobby, ...START]);
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

  it("thua thì ghi lại những món đồ mà nếu mang theo thì đã qua", () => {
    for (let seed = 1; seed < 400; seed++) {
      const s0 = play(explore, seed);
      const placed = Object.values(s0.anchors).find((a) => a.cardId === "coconut");
      if (!placed || s0.players.a!.items.includes("rope")) continue;
      let s = reduce(s0, { type: "trigger", playerId: "a", anchorId: placed.anchorId, participants: ["a"] }, config);
      s = reduce(s, { type: "choose", playerId: "a", anchorId: placed.anchorId, choiceId: "climb" }, config);
      const entry = s.log.at(-1)!;
      if (entry.kind !== "check" || entry.result.success || entry.result.total + 2 < entry.result.dc) continue;
      expect(entry.wouldPassWith).toEqual(["rope"]);
      return;
    }
    throw new Error("Không tìm được seed thua sát nút mà không có dây thừng");
  });

  it("độ khó cộng vào DC và đổi lương thực khởi đầu", () => {
    const hard = play([...lobby, { type: "start", difficulty: "hard" }, { type: "advance" }, { type: "advance" }]);
    expect(hard.food).toBe(2 * DIFFICULTIES.hard.foodPerPlayer);
    const card = config.cards.find((c) => c.id === "coconut")!;
    const p = hard.players.a!;
    expect(successChance(p, card.choices[0]!, config, "hard")).toBeCloseTo(successChance(p, card.choices[0]!, config, "normal") - 0.1);
  });

  it("tỷ lệ thành công khớp với d20: DC 10 và +3 thì cần 7 trở lên, tức 70%", () => {
    const player = {
      stats: { strength: 1, dexterity: 3, intellect: 1, charisma: 1, nerve: 1 },
      items: [] as string[],
      hunger: 50,
      morale: 50,
      background: "rich_kid" as const,
      flaw: "greedy" as const,
      bag: [],
    };
    const choice = config.cards.find((c) => c.id === "coconut")!.choices[0]!;
    expect(successChance(player, choice, config, "normal")).toBeCloseTo(0.7);
    expect(successChance({ ...player, items: ["rope"] }, choice, config, "normal")).toBeCloseTo(0.8);
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
    expect(s.players.a!.items).toHaveLength(Math.max(0, s0.players.a!.items.length - 1));
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
