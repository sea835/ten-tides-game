import { describe, expect, it } from "vitest";
import { CALLING_CARD, CALLING_CARDS, EMBLEM, EMBLEMS, MAX_RANK, RANKS, XP_AWARD, canUseCard, canUseEmblem, isUnlocked, isXpKind, rankDef, rankOf, rankProgress } from "./progression.ts";
import { EMPTY_LOADOUT, GUNSMITH_WEAPON_IDS, LOADOUT_SLOTS, loadoutAtts, loadoutOptions, validateLoadout } from "./loadout.ts";
import { SKIN } from "./skins.ts";

describe("quân hàm", () => {
  it("30 cấp từ Binh Nhì tới Đại Tướng, XP tăng dần", () => {
    expect(RANKS).toHaveLength(30);
    expect(MAX_RANK).toBe(30);
    expect(RANKS[0]).toMatchObject({ rank: 1, name: "Binh Nhì", en: "Private", xp: 0 });
    expect(RANKS[29]).toMatchObject({ rank: 30, name: "Đại Tướng", en: "General", group: "general", stars: 4 });
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.xp).toBeGreaterThan(RANKS[i - 1]!.xp);
    expect(new Set(RANKS.map((r) => r.name)).size).toBe(30);
  });

  it("rankOf đúng mốc, chặn giá trị lạ", () => {
    expect(rankOf(0)).toBe(1);
    expect(rankOf(-50)).toBe(1);
    expect(rankOf(Number.NaN)).toBe(1);
    for (const r of RANKS) {
      expect(rankOf(r.xp)).toBe(r.rank);
      if (r.xp > 0) expect(rankOf(r.xp - 1)).toBe(r.rank - 1);
    }
    expect(rankOf(1e12)).toBe(30);
  });

  it("tiến độ trong cấp, cấp cuối thì đầy", () => {
    const r2 = RANKS[1]!;
    const r3 = RANKS[2]!;
    const mid = Math.round((r2.xp + r3.xp) / 2);
    const p = rankProgress(mid);
    expect(p.rank).toBe(2);
    expect(p.span).toBe(r3.xp - r2.xp);
    expect(p.ratio).toBeGreaterThan(0.4);
    expect(p.ratio).toBeLessThan(0.6);
    expect(rankProgress(RANKS[29]!.xp + 5).ratio).toBe(1);
    expect(rankDef(0)).toBeNull();
    expect(rankDef(31)).toBeNull();
  });

  it("XP mỗi sự kiện theo thiết kế", () => {
    expect(XP_AWARD).toMatchObject({ kill: 100, headshot: 150, capture: 400, resupply: 50, repair: 50, revive: 150 });
    expect(isXpKind("revive")).toBe(true);
    expect(isXpKind("toString")).toBe(false);
  });
});

describe("thẻ tên, huy hiệu", () => {
  it("id không trùng, có thẻ và huy hiệu miễn phí", () => {
    expect(CALLING_CARD.size).toBe(CALLING_CARDS.length);
    expect(EMBLEM.size).toBe(EMBLEMS.length);
    expect(CALLING_CARDS.some((c) => c.unlock.kind === "free")).toBe(true);
    expect(EMBLEMS.some((e) => e.unlock.kind === "free")).toBe(true);
  });

  it("mở khoá theo quân hàm và theo kho skin (bản trùng không tính hai lần)", () => {
    expect(isUnlocked({ kind: "rank", rank: 10 }, 9, [])).toBe(false);
    expect(isUnlocked({ kind: "rank", rank: 10 }, 10, [])).toBe(true);
    const legend = [...SKIN.values()].filter((s) => s.rarity === "legendary").map((s) => s.id);
    expect(isUnlocked({ kind: "skins", rarity: "legendary", count: 2 }, 1, [legend[0]!, legend[0]!])).toBe(false);
    expect(isUnlocked({ kind: "skins", rarity: "legendary", count: 2 }, 1, legend.slice(0, 2))).toBe(true);
    // Huyền thoại cũng tính cho điều kiện "sử thi trở lên".
    expect(isUnlocked({ kind: "skins", rarity: "epic", count: 1 }, 1, [legend[0]!])).toBe(true);
    expect(isUnlocked({ kind: "skins", rarity: "common", count: 1 }, 1, ["không-có"])).toBe(false);
  });

  it("kiểm tra quyền lắp", () => {
    expect(canUseCard("", 1, [])).toBe(true);
    expect(canUseCard("recruit", 1, [])).toBe(true);
    expect(canUseCard("marshal", 1, [])).toBe(false);
    expect(canUseCard("marshal", 30, [])).toBe(true);
    expect(canUseCard("không-có", 30, [])).toBe(false);
    expect(canUseEmblem("crown", 29, [])).toBe(false);
    expect(canUseEmblem("crown", 30, [])).toBe(true);
  });
});

describe("Gunsmith", () => {
  it("lựa chọn đúng ô, đúng khẩu", () => {
    expect(loadoutOptions("m416", "muzzle")).toContain("comp");
    expect(loadoutOptions("m416", "muzzle")).not.toContain("choke");
    expect(loadoutOptions("s686", "muzzle")).toEqual(["choke"]);
    expect(loadoutOptions("p92", "sight")).toEqual(["reddot", "holo"]);
    expect(loadoutOptions("awm", "sight")).toContain("x8");
    expect(loadoutOptions("không-có", "grip")).toEqual([]);
    for (const w of GUNSMITH_WEAPON_IDS) for (const s of LOADOUT_SLOTS) expect(Array.isArray(loadoutOptions(w, s))).toBe(true);
  });

  it("validateLoadout nhận bộ hợp lệ, từ chối món sai ô hay không vừa", () => {
    const ok = validateLoadout("m416", { muzzle: "comp", grip: "vgrip", sight: "x4" });
    expect(ok).toEqual({ ok: true, loadout: { ...EMPTY_LOADOUT, muzzle: "comp", grip: "vgrip", sight: "x4" } });
    expect(validateLoadout("m416", { muzzle: "vgrip" }).ok).toBe(false);
    expect(validateLoadout("p92", { sight: "x8" }).ok).toBe(false);
    expect(validateLoadout("không-có", {}).ok).toBe(false);
    expect(loadoutAtts({ muzzle: "comp", grip: "", mag: "extmag", sight: "x4" })).toBe("comp,extmag");
  });
});
