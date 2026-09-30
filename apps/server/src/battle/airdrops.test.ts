import { describe, expect, it } from "vitest";
import { AIRDROP, battleMap } from "@tentides/content";
import { IslandState } from "@tentides/protocol";
import { Airdrops } from "./airdrops.ts";

function setup() {
  const state = new IslandState();
  state.phase = "battle";
  state.battleMode = "solo";
  state.zone.r = 260;
  let seed = 99;
  const put: { itemId: string; x: number; y: number; z: number }[] = [];
  const drops = new Airdrops({
    state,
    map: battleMap(777),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    putItem: (itemId, x, y, z) => put.push({ itemId, x, y, z }),
  });
  return { state, drops, put };
}

/** Chạy mô phỏng `seconds` giây, mỗi nhịp 0,05 s như phòng thật. */
function run(drops: Airdrops, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) drops.tick(0.05);
}

describe("thùng thính trong phòng", () => {
  it("thùng đầu tiên thả sau một phút, rơi chậm rồi chạm đất và đổ đồ ra quanh thùng", () => {
    const { state, drops, put } = setup();
    run(drops, AIRDROP.first - 1);
    expect(state.airdrops.size).toBe(0);
    run(drops, 1.5);
    expect(state.airdrops.size).toBe(1);
    const a = [...state.airdrops.values()][0]!;
    expect(a.landed).toBe(false);
    expect(a.y - a.ground).toBeGreaterThan(AIRDROP.height * 0.9);
    run(drops, AIRDROP.fall / 2);
    expect(a.landed).toBe(false);
    expect(a.y).toBeGreaterThan(a.ground);
    expect(put).toHaveLength(0);
    run(drops, AIRDROP.fall / 2 + 0.5);
    expect(a.landed).toBe(true);
    expect(a.y).toBe(a.ground);
    expect(a.smoke).toBeGreaterThan(0);
    expect(put.some((p) => p.itemId === "armor:3")).toBe(true);
    for (const p of put) expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeLessThan(AIRDROP.ring + 1);
  });

  it("thả tối đa vài thùng mỗi trận, chiến trường và ngoài pha đánh nhau thì không thả", () => {
    const { state, drops } = setup();
    run(drops, AIRDROP.first + AIRDROP.every[1] * (AIRDROP.max + 2));
    expect(state.airdrops.size).toBe(AIRDROP.max);
    drops.clear();
    expect(state.airdrops.size).toBe(0);
    state.battleMode = "war";
    run(drops, AIRDROP.first + 5);
    expect(state.airdrops.size).toBe(0);
    state.battleMode = "solo";
    state.phase = "prep";
    run(drops, AIRDROP.first + 5);
    expect(state.airdrops.size).toBe(0);
  });
});
