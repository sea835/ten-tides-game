import { describe, expect, it } from "vitest";
import { gameConfig, storyLibrary } from "@tentides/content";
import { playBotGame, type GameState } from "@tentides/rules";
import { chronicle, createPremise, diaryPage, narrateDawn, narrateDusk, narratePrivate, type StoryContext } from "./index.ts";

function storyOf(seed: number, players = 5): { ctx: StoryContext; state: GameState } {
  const { state } = playBotGame(seed, players, gameConfig);
  const premise = createPremise(state.seed, state.playerOrder, storyLibrary, { id: state.twist, player: state.twistPlayer });
  return { ctx: { seed: state.seed, premise, library: storyLibrary, state, config: gameConfig }, state };
}

function allText(ctx: StoryContext, days: number): string[] {
  const out: string[] = [];
  for (let day = 1; day <= days; day++) {
    out.push(...narrateDawn(ctx, day), ...narrateDusk(ctx, day));
    for (const id of ctx.state.playerOrder) out.push(...narratePrivate(ctx, id, day));
    const page = diaryPage(ctx, day);
    out.push(page.title, page.text);
  }
  const c = chronicle(ctx, [{ playerId: ctx.state.playerOrder[0]!, title: "Tiều phu", detail: "đốn 3 cây" }]);
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

  it("kể lại chạm trán ngoài bản đồ (easter egg, bẫy, sinh vật, đuối nước) trọn câu, và biên niên sử nhắc bí mật đã tìm", () => {
    const { ctx, state } = storyOf(21, 4);
    const [a, b] = state.playerOrder as [string, string];
    const base = { day: 1, refId: "x", gained: null, dodged: false };
    state.log.push(
      { kind: "encounter", ...base, playerId: a, source: "egg", defId: "shipwreck", effects: { treasure: 6 } },
      { kind: "encounter", ...base, playerId: a, source: "anomaly", defId: "fairy_ring", effects: { morale: -10 } },
      { kind: "encounter", ...base, playerId: b, source: "trap", defId: "spike_pit", effects: {}, dodged: true },
      { kind: "encounter", ...base, playerId: b, source: "creature", defId: "wild_boar", effects: { hp: -12 } },
      { kind: "encounter", ...base, playerId: b, source: "creature", defId: "wild_boar", effects: { hp: -12 } },
      { kind: "encounter", ...base, playerId: a, source: "friend", defId: "dolphin", effects: { morale: 6 } },
    );
    const dusk = narrateDusk(ctx, 1).join(" ");
    expect(dusk.toLowerCase()).toContain("xác tàu cổ");
    expect(dusk.toLowerCase()).toContain("hố chông");
    expect(dusk.match(/heo rừng/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    for (const line of [...narrateDusk(ctx, 1), ...chronicle(ctx).paragraphs]) expect(line).not.toMatch(/[{}]|undefined|null/);
    expect(chronicle(ctx).paragraphs.join(" ").toLowerCase()).toContain("xác tàu cổ");
  });
});

describe("cơ chế cốt truyện", () => {
  it("cốt truyện dựng quanh đúng biến cố engine đã chọn, và bình minh ngày 5 kể cả hệ quả", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { ctx, state } = storyOf(seed, 4);
      expect(ctx.premise.twist).toBe(state.twist);
      if (state.day >= 5) {
        const dawn = narrateDawn(ctx, 5);
        expect(dawn.length).toBeGreaterThan(3);
        for (const line of dawn) expect(line).not.toMatch(/[{}]|undefined|null/);
      }
    }
  });

  it("mỗi ngày một trang nhật ký khác, không lộ biến cố ngày 5", () => {
    const { ctx } = storyOf(5);
    const texts = new Set<string>();
    for (let day = 1; day <= 10; day++) {
      const page = diaryPage(ctx, day);
      expect(page.text).not.toMatch(/[{}]|undefined|null/);
      texts.add(page.text);
      const twist = storyLibrary.elements.find((e) => e.id === ctx.premise.twist)!;
      expect(page.text).not.toContain(twist.lines[0]!.slice(0, 20));
    }
    expect(texts.size).toBeGreaterThanOrEqual(7);
  });

  it("kể lại chuyện đêm ngủ ngoài và việc góp lương thực", () => {
    const { ctx, state } = storyOf(9, 4);
    const [a] = state.playerOrder as [string];
    state.log.push(
      { kind: "outside", day: 1, playerId: a, event: "beast_prowl", result: { roll: 15, modifiers: [], total: 18, dc: 12, success: true } },
      { kind: "stash", day: 1, playerId: a, itemId: "coconut", amount: 1 },
    );
    expect(narrateDusk(ctx, 1).join(" ")).toContain("trái dừa");
    expect(narrateDawn(ctx, 2).join(" ").toLowerCase()).toContain("thú rình");
    expect(narratePrivate(ctx, a, 2).join(" ")).toContain("Đêm qua bạn ngủ ngoài trại");
  });
});
