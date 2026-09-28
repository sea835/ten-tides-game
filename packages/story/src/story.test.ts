import { describe, expect, it } from "vitest";
import { gameConfig, storyLibrary } from "@tentides/content";
import { playBotGame, type GameState } from "@tentides/rules";
import { chronicle, createPremise, narrateDawn, narrateDusk, narratePrivate, type StoryContext } from "./index.ts";

function storyOf(seed: number, players = 5): { ctx: StoryContext; state: GameState } {
  const { state } = playBotGame(seed, players, gameConfig);
  const premise = createPremise(state.seed, state.playerOrder, storyLibrary);
  return { ctx: { seed: state.seed, premise, library: storyLibrary, state, config: gameConfig }, state };
}

function allText(ctx: StoryContext, days: number): string[] {
  const out: string[] = [];
  for (let day = 1; day <= days; day++) {
    out.push(...narrateDawn(ctx, day), ...narrateDusk(ctx, day));
    for (const id of ctx.state.playerOrder) out.push(...narratePrivate(ctx, id, day));
  }
  const c = chronicle(ctx);
  out.push(c.title, ...c.paragraphs);
  return out;
}

describe("thư viện truyện", () => {
  it("có hơn 100 yếu tố, đủ mọi nhóm, mỗi hồi đều có điềm báo", () => {
    expect(storyLibrary.elements.length).toBeGreaterThanOrEqual(100);
    for (const act of [1, 2, 3]) expect(storyLibrary.elements.some((e) => e.category === "omen" && e.act === act)).toBe(true);
  });
});

describe("cốt truyện theo seed", () => {
  it("cùng seed thì ra cùng câu chuyện; khác seed thì khác", () => {
    const a = storyOf(7);
    const b = storyOf(7);
    expect(allText(a.ctx, 10)).toEqual(allText(b.ctx, 10));
    const c = storyOf(8);
    expect(allText(c.ctx, 10)).not.toEqual(allText(a.ctx, 10));
  });

  it("động cơ luôn hợp với người giấu", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const premise = createPremise(seed, ["a", "b", "c", "d"], storyLibrary);
      const hider = storyLibrary.elements.find((e) => e.id === premise.hider)!;
      const motive = storyLibrary.elements.find((e) => e.id === premise.motive)!;
      if (motive.requiresAnyTag) expect(motive.requiresAnyTag.some((t) => hider.tags.includes(t))).toBe(true);
    }
  });

  it("300 ván: không câu nào còn sót chỗ trống, và nhiều tổ hợp khác nhau xuất hiện", () => {
    const premises = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const { ctx } = storyOf(seed, 2 + (seed % 5));
      premises.add(`${ctx.premise.hider}/${ctx.premise.motive}/${ctx.premise.treasure}/${ctx.premise.twist}`);
      for (const line of allText(ctx, ctx.state.day)) {
        expect(line).not.toMatch(/[{}]|undefined|null/);
        // Câu nào cũng bắt đầu bằng chữ hoa.
        expect(line).not.toMatch(/[.!?]\s+\p{Ll}/u);
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
    expect(premises.size).toBeGreaterThan(200);
  });

  it("ngày 5 luôn có twist; ngày đầu kể truyền thuyết", () => {
    const { ctx } = storyOf(3);
    const twist = storyLibrary.elements.find((e) => e.id === ctx.premise.twist)!;
    expect(narrateDawn(ctx, 5).join(" ")).toContain(twist.lines[0]!.split("{")[0]!.slice(0, 15));
    expect(narrateDawn(ctx, 1).join(" ")).toContain(storyLibrary.elements.find((e) => e.id === ctx.premise.hider)!.name!);
  });

  it("biên niên sử nhắc tên mọi người chơi và có lời kết", () => {
    const { ctx, state } = storyOf(11);
    const text = chronicle(ctx).paragraphs.join(" ");
    for (const id of state.playerOrder) expect(text).toContain(state.players[id]!.name);
    expect(chronicle(ctx).title).toMatch(/^Đoàn /);
  });

  it("lời kể riêng của người thường không bao giờ lộ vai của kẻ phản bội", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { ctx, state } = storyOf(seed, 5);
      for (const id of state.playerOrder.filter((x) => state.players[x]!.role === "villager")) {
        for (let day = 1; day <= state.day; day++) {
          const text = narratePrivate(ctx, id, day).join(" ");
          expect(text).not.toMatch(/Cướp biển|Kẻ lừa đảo|phản bội/);
        }
      }
    }
  });
});
