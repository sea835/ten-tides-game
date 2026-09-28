import { describe, expect, it } from "vitest";
import { canAct, createGame, isOver, reduce, type EndingId, type GameState } from "./game.ts";
import { nextInt } from "./rng.ts";
import { testConfig as config } from "./testConfig.ts";

/** Bot chơi hết một ván: mỗi ngày mở ngẫu nhiên vài thẻ, chọn bừa, về trại hay không tuỳ may rủi. */
function simulate(seed: number, players: number): { state: GameState; actions: number } {
  let s = createGame(seed);
  let botRng = seed ^ 0x5bd1e995;
  const roll = (max: number) => {
    const r = nextInt(botRng, 0, max);
    botRng = r.rng;
    return r.value;
  };
  let actions = 0;
  const act = (a: Parameters<typeof reduce>[1]) => {
    s = reduce(s, a, config);
    actions++;
  };

  for (let i = 0; i < players; i++) act({ type: "join", playerId: `p${i}`, name: `Bot ${i}` });
  act({ type: "start" });
  while (s.phase !== "ended") {
    if (s.phase === "explore") {
      for (const placed of Object.values(s.anchors)) {
        const actor = s.playerOrder.find((id) => canAct(s, id));
        if (!actor || placed.status !== "open" || roll(2) === 0) continue;
        act({ type: "trigger", playerId: actor, anchorId: placed.anchorId, participants: [actor] });
        const card = config.cards.find((c) => c.id === placed.cardId)!;
        act({ type: "choose", playerId: actor, anchorId: placed.anchorId, choiceId: card.choices[roll(card.choices.length - 1)]!.id });
        if (isOver(s)) break;
      }
    }
    if (isOver(s)) break;
    if (s.phase === "night") {
      const rations = ["full", "normal", "half", "skip"] as const;
      for (const id of s.campers) {
        act({ type: "vote", playerId: id, ballot: "ration", choice: rations[roll(3)]! });
        const others = s.campers.filter((c) => c !== id);
        if (others.length && roll(3) === 0) act({ type: "vote", playerId: id, ballot: "tie", choice: others[roll(others.length - 1)]! });
      }
    }
    const atCamp = s.phase === "dusk" ? s.playerOrder.filter(() => roll(4) > 0) : undefined;
    act({ type: "advance", atCamp });
  }
  return { state: s, actions };
}

describe("mô phỏng bằng bot", () => {
  it("500 ván đều kết thúc, không lỗi, chỉ số luôn trong giới hạn", () => {
    const endings: Record<EndingId, number> = { treasure_home: 0, empty_handed: 0, buried: 0 };
    for (let seed = 1; seed <= 500; seed++) {
      const { state } = simulate(seed, 1 + (seed % 6));
      expect(state.phase).toBe("ended");
      endings[state.ending!]++;
      for (const p of Object.values(state.players)) {
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(p.maxHp);
        expect(p.hunger).toBeGreaterThanOrEqual(0);
        expect(p.morale).toBeLessThanOrEqual(100);
      }
    }
    expect(Object.values(endings).reduce((a, b) => a + b, 0)).toBe(500);
  });

  it("cùng seed thì phát lại ra đúng cùng một ván", () => {
    expect(simulate(42, 4).state).toEqual(simulate(42, 4).state);
  });
});
