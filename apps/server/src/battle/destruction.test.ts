import { describe, expect, it } from "vitest";
import { battleMap, boxDurability, bulletThrough, raycastBoxes, raycastTrunks, withDestruction } from "@tentides/content";
import { IslandState, PlayerState } from "@tentides/protocol";
import { BROKEN, COLLAPSE_DAMAGE, Destruction } from "./destruction.ts";

function setup() {
  const state = new IslandState();
  state.phase = "battle";
  const map = withDestruction(battleMap(4242));
  const sent: { type: string; message: unknown }[] = [];
  const crushed: { id: string; amount: number }[] = [];
  const d = new Destruction({ state, map, broadcast: (type, message) => sent.push({ type, message }), crush: (id, amount) => crushed.push({ id, amount }) });
  d.reset();
  return { state, map, d, sent, crushed };
}

describe("phá huỷ công trình", () => {
  it("tường mất độ bền theo đạn, vỡ thì đạn đi xuyên qua chỗ đó", () => {
    const { state, map, d } = setup();
    const i = map.boxes.findIndex((b) => b.part === "wall" && b.mat === "brick" && b.h > 2 && boxDurability(b) > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const b = map.boxes[i]!;
    // Bắn thẳng vào mặt tường (theo pháp tuyến mặt mỏng).
    const thinU = b.w < b.d;
    const n: [number, number, number] = thinU ? [Math.cos(b.rot), 0, -Math.sin(b.rot)] : [Math.sin(b.rot), 0, Math.cos(b.rot)];
    const o: [number, number, number] = [b.x - n[0] * 3, b.y, b.z - n[2] * 3];
    expect(raycastBoxes(map.index, o, n, 3)).toBeLessThan(3);
    d.hitBox(i, boxDurability(b) * 0.5);
    expect(state.broken.get(String(i))).toBeGreaterThan(100);
    expect(map.index.dead![i]).toBe(0);
    d.hitBox(i, boxDurability(b));
    expect(state.broken.get(String(i))).toBe(BROKEN);
    expect(map.index.dead![i]).toBe(1);
    // Tia qua đúng chỗ tường cũ giờ không chạm khối đó nữa.
    const t = raycastBoxes(map.index, o, n, 3.2);
    expect(t === Infinity || t > 3.2 - 0.01).toBe(true);
    // Bản đồ gốc trong cache (phòng khác) vẫn nguyên.
    expect(battleMap(4242).index.dead?.[i] ?? 0).toBe(0);
  });

  it("vỡ đủ nhiều tường thì cả toà nhà sập, người trong nhà bị đè", () => {
    const { state, map, d, sent, crushed } = setup();
    const wall = map.boxes.find((b) => b.part === "wall" && b.building !== undefined)!;
    const id = wall.building!;
    const own = map.boxes.map((b, i) => ({ b, i })).filter((x) => x.b.building === id);
    const base = own.find((x) => x.b.part === "base")!.b;
    // Một người đứng giữa nhà.
    const q = new PlayerState();
    q.alive = true;
    q.x = base.x;
    q.z = base.z;
    q.y = base.y + base.h / 2 + 0.05;
    state.players.set("x", q);
    for (const { b, i } of own) if (b.part === "wall" && boxDurability(b) > 0) d.hitBox(i, 1e6);
    expect(sent.some((m) => m.type === "collapse")).toBe(true);
    for (const { b, i } of own) expect(map.index.dead![i]).toBe(b.part === "base" ? 0 : 1);
    expect(crushed).toEqual([{ id: "x", amount: COLLAPSE_DAMAGE }]);
  });

  it("vách vữa mỏng cho đạn xuyên qua (yếu đi), tường gạch thì không", () => {
    const { map } = setup();
    const probe = (mat: string) => {
      const i = map.boxes.findIndex((b) => b.mat === mat && b.part === "wall" && Math.min(b.w, b.d) < 0.3 && b.h > 2);
      const b = map.boxes[i]!;
      const thinU = b.w < b.d;
      const n: [number, number, number] = thinU ? [Math.cos(b.rot), 0, -Math.sin(b.rot)] : [Math.sin(b.rot), 0, Math.cos(b.rot)];
      const o: [number, number, number] = [b.x - n[0] * 1.5, b.y, b.z - n[2] * 1.5];
      return { i, r: bulletThrough(map.index, o, n, 1.6) };
    };
    const plaster = probe("plaster");
    expect(plaster.r.pens.map((p) => p.i)).toContain(plaster.i);
    expect(plaster.r.mult).toBeLessThan(1);
    const brick = probe("brick");
    expect(brick.r.i).toBe(brick.i);
    expect(brick.r.pens).toHaveLength(0);
  });

  it("cây trúng nổ gần thì gãy đổ, đạn đi qua chỗ cây cũ", () => {
    const { state, map, d, sent } = setup();
    const t = map.world.trees[0]!;
    const y = map.world.heightAt(t.x, t.z) + 1.2;
    expect(raycastTrunks(map.world, [t.x - 5, y, t.z], [1, 0, 0], 10, map.treeDead)).toBeLessThan(10);
    d.blast(t.x + 1, y, t.z, 4, 120);
    expect(state.stumps).toContain(t.id);
    expect(sent.some((m) => m.type === "fx" && (m.message as { kind: string }).kind === "fell")).toBe(true);
    const after = raycastTrunks(map.world, [t.x - 5, y, t.z], [1, 0, 0], 10, map.treeDead);
    expect(after === Infinity || after > 5).toBe(true);
  });
});
