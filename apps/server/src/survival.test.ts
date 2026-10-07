import { describe, expect, it } from "vitest";
import { CAMP, HOT_SPRING, TIDE_HIGH, TIDE_LOW, generateWorld, lavaFlows, shoreRadius } from "@tentides/content";
import type { VolcanoMessage } from "@tentides/protocol";
import { Hazards } from "./hazards.ts";
import { Survival, type SurvivalEvent, type Wader } from "./survival.ts";

const world = generateWorld(777);
const clock = (phase: string, timeLeft: number, day: number, extra: Partial<{ phaseDuration: number; volcano: number; mode: string }> = {}) => ({
  mode: "story",
  phase,
  timeLeft,
  phaseDuration: 180,
  day,
  volcano: Math.min(99, day * 10),
  ...extra,
});

function run(s: Survival, seconds: number, c: ReturnType<typeof clock>, people: Wader[], active = true) {
  const out: SurvivalEvent[] = [];
  for (let t = 0; t < seconds; t += 0.1) out.push(...s.step(0.1, c, people, active, CAMP));
  return out;
}
const volcanoMessages = (events: SurvivalEvent[]) => events.flatMap((e) => (e.kind === "volcano" ? [e.message] : [])) as VolcanoMessage[];
const hurts = (events: SurvivalEvent[]) => events.flatMap((e) => (e.kind === "hurt" ? [e] : []));

describe("thủy triều trên server", () => {
  it("mực nước theo đồng hồ pha, Battleground thì đứng yên", () => {
    const s = new Survival(world, 1);
    s.updateSea(clock("explore", 90, 2));
    expect(s.sea).toBeLessThan(TIDE_LOW + 0.3);
    s.updateSea(clock("night", 30, 2, { phaseDuration: 60 }));
    expect(s.sea).toBeGreaterThan(TIDE_HIGH - 0.3);
    s.updateSea(clock("explore", 90, 2, { mode: "battle" }));
    expect(s.sea).toBe(0);
  });

  it("lặn: đầu dưới mặt nước theo triều mới tốn hơi", () => {
    const hazards = new Hazards(world, [], 1);
    // Đứng trên đáy sâu 1 m dưới mốc: triều cường thì ngập đầu, triều rút thì khô ráo.
    const diver = { id: "a", x: 0, y: -1.2, z: 0, alive: true, strength: 2, background: "", stats: {} };
    hazards.step(1, [diver], true, undefined, 0.6);
    expect(hazards.breath.get("a")).toBeLessThan(100);
    const dry = new Hazards(world, [], 1);
    dry.step(1, [diver], true, undefined, -1.5);
    expect(dry.breath.get("a")).toBe(100);
  });

  it("triều cường đang lên ngập bãi cát: sóng cuốn người còn lội ở đó, hất vào bờ", () => {
    const s = new Survival(world, 1);
    // Bãi cát phía đông đảo chính, cao chừng 0,2 m.
    const r = shoreRadius(100, 0) - 2;
    const beach = { id: "a", x: r, y: world.heightAt(r, 0), z: 0, alive: true };
    // Hoàng hôn: triều đang lên cao.
    const events = hurts(run(s, 6, clock("dusk", 1, 3, { phaseDuration: 30 }), [beach]));
    expect(events.some((e) => e.defId === "flood_tide" && e.source === "drowning")).toBe(true);
    // Giữa buổi khám phá triều rút: không sao.
    expect(hurts(run(new Survival(world, 1), 6, clock("explore", 90, 3), [beach]))).toEqual([]);
  });
});

describe("núi lửa leo thang trên server", () => {
  const far = { id: "far", x: 60, y: world.heightAt(60, 40), z: 40, alive: true };

  it("ngày 1–4 yên ả: không động đất, không bom", () => {
    const events = run(new Survival(world, 1), 120, clock("explore", 90, 3), [far]);
    expect(volcanoMessages(events)).toEqual([]);
  });

  it("ngày 5–7: có động đất nhưng chưa có bom; suối nước nóng sôi", () => {
    const spring = { id: "s", x: HOT_SPRING.x, y: world.heightAt(HOT_SPRING.x, HOT_SPRING.z), z: HOT_SPRING.z, alive: true };
    const events = run(new Survival(world, 1), 120, clock("explore", 90, 6), [far, spring]);
    const msgs = volcanoMessages(events);
    expect(msgs.some((m) => m.kind === "quake")).toBe(true);
    expect(msgs.some((m) => m.kind === "bomb")).toBe(false);
    expect(hurts(events).some((e) => e.playerId === "s" && e.defId === "hot_spring")).toBe(true);
    // Ngày 3 suối còn hiền.
    expect(hurts(run(new Survival(world, 1), 10, clock("explore", 90, 3), [spring]))).toEqual([]);
  });

  it("ngày 8–10: bom rơi, nổ trúng người đứng gần, để lại hố lửa; không rơi vào trại", () => {
    const s = new Survival(world, 3);
    const events = run(s, 90, clock("explore", 90, 9), [far]);
    const msgs = volcanoMessages(events);
    const bombs = msgs.filter((m) => m.kind === "bomb");
    expect(bombs.length).toBeGreaterThan(5);
    expect(msgs.filter((m) => m.kind === "land").length).toBeGreaterThan(3);
    for (const b of bombs) expect(Math.hypot(b.x - CAMP.x, b.z - CAMP.z)).toBeGreaterThan(12);
    expect(hurts(events).some((e) => e.defId === "lava_bomb" && (e.effects.hp ?? 0) < 0 && !!e.knock)).toBe(true);
    // Người vào giữa chừng nhận lại bom đang bay và hố lửa còn cháy.
    expect(s.snapshot().length).toBeGreaterThan(0);
  });

  it("ban đêm không có bom, không ai bị thương", () => {
    const events = run(new Survival(world, 3), 60, clock("night", 30, 9, { phaseDuration: 60 }), [far], false);
    expect(volcanoMessages(events).some((m) => m.kind === "bomb")).toBe(false);
    expect(hurts(events)).toEqual([]);
  });

  it("lội vào dòng dung nham là bỏng", () => {
    const [flow] = lavaFlows(world, 9, 90);
    const p = flow!.points[2]!;
    const events = run(new Survival(world, 5), 2, clock("explore", 90, 9), [{ id: "x", x: p.x, y: p.y, z: p.z, alive: true }]);
    expect(hurts(events).some((e) => e.defId === "lava_flow")).toBe(true);
  });
});
