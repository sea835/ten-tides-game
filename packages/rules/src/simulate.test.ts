import { describe, expect, it } from "vitest";
import { playBotGame } from "./bot.ts";
import { createGame, reduce, type EndingId } from "./game/index.ts";
import { testConfig as config } from "./testConfig.ts";

describe("mô phỏng bằng bot", () => {
  it("500 ván đều kết thúc, không lỗi, chỉ số luôn trong giới hạn", () => {
    const endings = new Map<EndingId, number>();
    for (let seed = 1; seed <= 500; seed++) {
      const { state } = playBotGame(seed, 1 + (seed % 6), config);
      expect(state.phase).toBe("ended");
      endings.set(state.ending!, (endings.get(state.ending!) ?? 0) + 1);
      for (const p of Object.values(state.players)) {
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(p.maxHp);
        expect(p.hunger).toBeGreaterThanOrEqual(0);
        expect(p.morale).toBeLessThanOrEqual(100);
      }
    }
    expect([...endings.values()].reduce((a, b) => a + b, 0)).toBe(500);
    // Với đủ vai ẩn và nhiều ván, phải thấy nhiều loại kết thúc khác nhau.
    expect(endings.size).toBeGreaterThanOrEqual(4);
  });

  it("phát lại chuỗi hành động từ seed ra đúng cùng một ván (event sourcing)", () => {
    const game = playBotGame(42, 4, config);
    const replayed = game.actions.reduce((s, a) => reduce(s, a, config), createGame(42));
    expect(replayed).toEqual(game.state);
  });
});
