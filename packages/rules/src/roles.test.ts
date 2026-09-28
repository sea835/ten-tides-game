import { describe, expect, it } from "vitest";
import {
  HULL_TO_SAIL,
  SIGNALS_TO_WIN,
  TOTAL_DAYS,
  createGame,
  isTraitor,
  privateView,
  reduce,
  type GameAction,
  type GameState,
  type RoleId,
} from "./game/index.ts";
import { testConfig as config } from "./testConfig.ts";

const ids = ["a", "b", "c", "d", "e"];
const START: GameAction[] = [{ type: "start" }, { type: "advance" }, { type: "advance" }];
const joinAll = (n: number): GameAction[] => ids.slice(0, n).map((id) => ({ type: "join", playerId: id, name: id.toUpperCase() }));
const play = (actions: GameAction[], seed = 1) => actions.reduce((s, a) => reduce(s, a, config), createGame(seed));
const act = (s: GameState, ...actions: GameAction[]) => actions.reduce((acc, a) => reduce(acc, a, config), s);
const withRoles = (s: GameState, roles: Record<string, RoleId>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, role: roles[id] ?? "villager" }])),
});
/** Tới đêm đầu, mọi người ở trại, gán vai theo ý. */
const firstNight = (roles: Record<string, RoleId>, n = 4, seed = 1) =>
  act(withRoles(play([...joinAll(n), ...START], seed), roles), { type: "advance" }, { type: "advance" }, { type: "advance", atCamp: ids.slice(0, n) });
const endNight = (s: GameState) => reduce(s, { type: "advance" }, config);

describe("chia vai", () => {
  it("dưới 4 người thì không có vai ẩn", () => {
    for (let seed = 1; seed < 50; seed++) {
      const s = play([...joinAll(3), ...START], seed);
      expect(Object.values(s.players).every((p) => p.role === "villager")).toBe(true);
    }
  });

  it("từ 4 người: có ván có kẻ phản bội, có ván không; không bao giờ quá một", () => {
    let withTraitor = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = play([...joinAll(4), ...START], seed);
      const traitors = Object.values(s.players).filter((p) => isTraitor(p.role));
      expect(traitors.length).toBeLessThanOrEqual(1);
      withTraitor += traitors.length;
    }
    expect(withTraitor).toBeGreaterThan(60);
    expect(withTraitor).toBeLessThan(140);
  });

  it("mỗi người chỉ biết vai của mình", () => {
    const s = firstNight({ a: "pirate", b: "nurse" });
    expect(privateView(s, "a", config)).toMatchObject({ role: "pirate", goal: { current: 0, needed: SIGNALS_TO_WIN } });
    expect(privateView(s, "b", config)).toMatchObject({ role: "nurse", goal: null });
    expect(JSON.stringify(privateView(s, "c", config))).not.toContain("pirate");
    expect(privateView(s, "a", config)!.nightActions).toContain("sabotage");
    expect(privateView(s, "c", config)!.nightActions).not.toContain("sabotage");
  });
});

describe("hành động đêm", () => {
  it("người thường không phá hoại được; không chọn thì coi như ngủ", () => {
    const s = firstNight({});
    expect(() => reduce(s, { type: "nightAction", playerId: "a", action: "sabotage" }, config)).toThrow();
    const after = endNight(s);
    expect(after.nightHistory.filter((h) => h.day === 1).every((h) => h.action === "sleep")).toBe(true);
  });

  it("phá thuyền và sửa thuyền hiện ra thành báo cáo không kèm tên", () => {
    let s = firstNight({ a: "pirate" });
    const hull = s.hull;
    s = act(s, { type: "nightAction", playerId: "a", action: "sabotage" }, { type: "nightAction", playerId: "b", action: "repair" });
    s = endNight(s);
    const report = s.log.find((e) => e.kind === "incident");
    expect(report).toBeDefined();
    expect(JSON.stringify(report)).not.toContain('"a"');
    expect(s.hull).toBeLessThan(hull);
  });

  it("có người canh gác thì phá hoại nhẹ hơn, và người canh gác có ghi chú riêng", () => {
    let s = firstNight({ a: "pirate" });
    s = act(s, { type: "nightAction", playerId: "a", action: "sabotage" }, { type: "nightAction", playerId: "b", action: "guard" });
    s = endNight(s);
    const hullEffects = s.log.flatMap((e) => (e.kind === "incident" ? e.effects : [])).filter((e) => e.type === "hull");
    expect(hullEffects[0]).toEqual({ type: "hull", amount: -10 });
    expect(privateView(s, "b", config)!.clues.length).toBe(1);
    expect(privateView(s, "c", config)!.clues.length).toBe(0);
  });

  it("y tá che chở thì người sắp gục còn lại 1 Máu", () => {
    let s = firstNight({ a: "nurse" });
    s = { ...s, food: 0, players: { ...s.players, c: { ...s.players.c!, hp: 5, hunger: 0 } } };
    s = act(s, { type: "nightAction", playerId: "a", action: "protect", target: "c" });
    s = endNight(s);
    expect(s.players.c!.alive).toBe(true);
    expect(s.players.c!.hp).toBe(1);
  });

  it("kẻ phản bội bị trói thì đêm sau mất năng lực", () => {
    let s = firstNight({ a: "pirate" });
    s = act(
      s,
      { type: "nominate", playerId: "b", target: "a" },
      { type: "ballot", playerId: "b", tie: true },
      { type: "ballot", playerId: "c", tie: true },
      { type: "ballot", playerId: "d", tie: true },
      { type: "ballot", playerId: "a", tie: false },
    );
    s = endNight(s);
    expect(s.players.a!.tied).toBe(true);
    s = act(s, { type: "advance" }, { type: "advance" }, { type: "advance", atCamp: ids.slice(0, 4) });
    expect(privateView(s, "a", config)!.nightActions).toEqual(["sleep"]);
    expect(() => reduce(s, { type: "nightAction", playerId: "a", action: "sabotage" }, config)).toThrow();
  });
});

describe("kho báu và kết thúc", () => {
  const toLastDusk = (s: GameState): GameState => {
    let out = s;
    while (!(out.day === TOTAL_DAYS && out.phase === "dusk")) {
      out = reduce(out, { type: "advance", atCamp: out.phase === "dusk" ? out.playerOrder : undefined }, config);
    }
    return out;
  };

  it("đào cần biết chỗ và có xẻng; mang rương về trại rồi rời đảo là kho báu về tay", () => {
    let s = act(play([...joinAll(3), ...START]), { type: "advance" });
    const digger = s.playerOrder[0]!;
    expect(() => reduce(s, { type: "dig", playerId: digger }, config)).toThrow(/chỗ đào/);
    s = { ...s, treasure: 100, players: { ...s.players, [digger]: { ...s.players[digger]!, items: [] } } };
    expect(() => reduce(s, { type: "dig", playerId: digger }, config)).toThrow(/xẻng/);
    s = { ...s, players: { ...s.players, [digger]: { ...s.players[digger]!, items: ["shovel"] } } };
    s = act(s, { type: "dig", playerId: digger });
    expect(s.treasureCarrier).toBe(digger);
    s = toLastDusk(s);
    s = reduce({ ...s, hull: 100 }, { type: "advance", atCamp: s.playerOrder }, config);
    expect(s.phase).toBe("ended");
    expect(["treasure_home", "bloody_treasure"]).toContain(s.ending);
    expect(s.winner).toBe("team");
  });

  it("thuyền quá nát thì không ai rời được đảo", () => {
    let s = toLastDusk(play([...joinAll(3), ...START]));
    s = reduce({ ...s, hull: HULL_TO_SAIL - 1 }, { type: "advance", atCamp: s.playerOrder }, config);
    expect(s.ending).toBe("buried");
  });

  it("không có kho báu mà vẫn rời đảo kịp là tay trắng trở về", () => {
    let s = toLastDusk(play([...joinAll(3), ...START]));
    s = reduce({ ...s, hull: 100 }, { type: "advance", atCamp: s.playerOrder }, config);
    expect(s.ending).toBe("empty_handed");
    expect(s.winner).toBe("none");
  });

  it("cướp biển gửi đủ tín hiệu thì chiếm thuyền lúc rời đảo", () => {
    let s = withRoles(play([...joinAll(4), ...START]), { a: "pirate" });
    s = toLastDusk(s);
    s = reduce({ ...s, hull: 100, signals: SIGNALS_TO_WIN }, { type: "advance", atCamp: s.playerOrder }, config);
    expect(s.ending).toBe("pirates_win");
    expect(s.winner).toBe("traitor");
  });

  it("thuyền nát khi có cướp biển thì cướp biển thắng ngay", () => {
    let s = firstNight({ a: "pirate" });
    s = { ...s, hull: 5 };
    s = act(s, { type: "nightAction", playerId: "a", action: "sabotage" });
    s = endNight(s);
    expect(s.ending).toBe("pirates_win");
  });

  it("chỉ một người lên thuyền cùng kho báu thì người đó thắng một mình", () => {
    let s = toLastDusk(play([...joinAll(3), ...START]));
    const solo = s.playerOrder[0]!;
    s = { ...s, hull: 100, treasureDug: true, treasureSafe: true };
    s = reduce(s, { type: "advance", atCamp: [solo] }, config);
    expect(s.ending).toBe("sole_survivor");
    expect(s.soloWinner).toBe(solo);
  });
});
