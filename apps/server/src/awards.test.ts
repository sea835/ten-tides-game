import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "@tentides/rules";
import { computeAwards, type Feats } from "./awards.ts";

function game(): GameState {
  const g = createGame(1);
  g.playerOrder = ["a", "b", "c"];
  const base = { day: 1, refId: "x", gained: null, dodged: false, effects: {} };
  g.log.push(
    { kind: "encounter", ...base, playerId: "c", source: "page", defId: "diary_page" },
    { kind: "encounter", ...base, playerId: "c", source: "page", defId: "diary_page" },
    { kind: "encounter", ...base, playerId: "b", source: "trap", defId: "spike_pit" },
  );
  return g;
}

describe("danh hiệu cuối ván", () => {
  it("mỗi danh hiệu cho người làm nhiều nhất, mỗi người một danh hiệu, đủ ngưỡng mới trao", () => {
    const feats = new Map<string, Feats>([
      ["a", { beasts: 3, trees: 5, damage: 4 }],
      ["b", { trees: 2 }],
      ["c", {}],
    ]);
    const awards = computeAwards(game(), feats);
    // a được "Thợ săn" trước nên "Tiều phu" về tay b; sát thương 4 chưa đủ ngưỡng.
    expect(awards).toContainEqual({ playerId: "a", title: "Thợ săn", detail: "hạ 3 con thú" });
    expect(awards).toContainEqual({ playerId: "b", title: "Tiều phu", detail: "đốn 2 cây" });
    expect(awards).toContainEqual({ playerId: "c", title: "Nhà sử học", detail: "nhặt 2 trang nhật ký" });
    expect(awards.map((x) => x.title)).not.toContain("Tay đấm máu mặt");
    expect(new Set(awards.map((x) => x.playerId)).size).toBe(awards.length);
  });
});
