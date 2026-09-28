import { describe, expect, it } from "vitest";
import { LAVA, generateTraps, generateWorld } from "@tentides/content";
import { Hazards, breathSeconds } from "./hazards.ts";
import { Wildlife, type Prey } from "./wildlife.ts";

const world = generateWorld(4242);

function run(wildlife: Wildlife, seconds: number, prey: Prey[] = [], hunting = true) {
  const bites = [];
  for (let t = 0; t < seconds; t += 0.1) bites.push(...wildlife.step(0.1, 5, prey, hunting));
  return bites;
}

describe("sinh vật", () => {
  it("cùng seed thế giới thì đi cùng một đường", () => {
    const a = new Wildlife(world, 4242);
    const b = new Wildlife(world, 4242);
    run(a, 20);
    run(b, 20);
    expect(a.creatures.map((c) => [c.x, c.z])).toEqual(b.creatures.map((c) => [c.x, c.z]));
    expect(a.creatures.some((c) => c.x !== c.spawn.x)).toBe(true);
  });

  it("sinh vật lạ và biến dị chỉ xuất hiện khi tới ngày của chúng", () => {
    const w = new Wildlife(world, 1);
    expect(w.active(1).every((c) => c.def.fromDay <= 1)).toBe(true);
    expect(w.active(10).length).toBeGreaterThan(w.active(1).length);
  });

  it("con vật nguy hiểm cắn người đứng sát, người cầm dao bị nhẹ hơn; ngoài giờ khám phá thì không cắn", () => {
    const wildlife = new Wildlife(world, 7);
    const hostile = wildlife.active(5).find((c) => c.def.temper === "hostile" && !c.spawn.structure && c.spawn.habitat === "forest")
      ?? wildlife.active(5).find((c) => c.def.temper === "hostile" && c.def.id === "lava_monitor");
    expect(hostile).toBeDefined();
    const c = hostile!;
    const prey = (items: string[]): Prey[] => [{ id: "p", x: c.x + 0.8, y: c.y, z: c.z, alive: true, items }];
    expect(run(wildlife, 3, prey([]), false)).toHaveLength(0);
    const bites = run(wildlife, 1, prey([]));
    expect(bites.length).toBe(1);
    expect(bites[0]!.effects.hp).toBe(c.def.attack!.effects.hp);

    const armed = new Wildlife(world, 7);
    const c2 = armed.creatures.find((x) => x.id === c.id)!;
    const deterrent = c.def.deterredBy?.[0];
    if (deterrent) {
      const b = run(armed, 1, [{ id: "p", x: c2.x + 0.8, y: c2.y, z: c2.z, alive: true, items: [deterrent] }]);
      expect(b[0]!.deterred).toBe(true);
      expect(Math.abs(b[0]!.effects.hp!)).toBeLessThan(Math.abs(c.def.attack!.effects.hp!));
    }
  });

  it("con vật trung tính bỏ chạy khi người lại gần", () => {
    const wildlife = new Wildlife(world, 3);
    const shy = wildlife.active(1).find((c) => c.def.temper === "neutral" && !c.def.fly)!;
    const start = { x: shy.x, z: shy.z };
    run(wildlife, 1.5, [{ id: "p", x: shy.x + 2, y: shy.y, z: shy.z, alive: true, items: [] }]);
    expect(shy.mode === "flee" || Math.hypot(shy.x - start.x, shy.z - start.z) > 0.5).toBe(true);
  });
});

describe("nguy hiểm của môi trường", () => {
  it("lặn lâu thì hết hơi rồi đuối nước; ngoi lên thì hồi hơi", () => {
    const hazards = new Hazards(world, [], 1);
    const diver = { id: "d", x: 0, y: -8, z: 200, alive: true, strength: 3, background: "gambler", stats: {} };
    let drowned = 0;
    const seconds = breathSeconds(3, "gambler");
    for (let t = 0; t < seconds + 4.5; t += 0.1) drowned += hazards.step(0.1, [diver], true).filter((e) => e.kind === "drowning").length;
    expect(hazards.breath.get("d")).toBe(0);
    expect(drowned).toBeGreaterThanOrEqual(1);
    for (let t = 0; t < 4; t += 0.1) hazards.step(0.1, [{ ...diver, y: -1.3 }], true);
    expect(hazards.breath.get("d")).toBe(100);
    expect(breathSeconds(3, "old_sailor")).toBeGreaterThan(seconds);
  });

  it("rơi vào hồ dung nham thì chết ngay; đứng trên mép miệng núi thì không sao", () => {
    const hazards = new Hazards(world, [], 1);
    const y = world.heightAt(LAVA.x, LAVA.z);
    const inLava = { id: "v", x: LAVA.x + 1, y, z: LAVA.z, alive: true, strength: 3, background: "gambler", stats: {} };
    expect(hazards.step(0.1, [inLava], true).map((e) => e.kind)).toEqual(["lava"]);
    const rim = { ...inLava, x: LAVA.x + 8, y: world.heightAt(LAVA.x + 8, LAVA.z) };
    expect(hazards.step(0.1, [rim], true)).toHaveLength(0);
    // Ban đêm (không trong giờ đi lại) thì không có gì xảy ra.
    expect(hazards.step(0.1, [inLava], false)).toHaveLength(0);
  });

  it("đứng trong lửa trại thì bỏng ngay, rồi cứ gần một giây lại bỏng tiếp; lửa đã nhổ đi thì không sao", () => {
    const hazards = new Hazards(world, [], 1);
    const fire = { x: 0, z: 80, lit: true };
    const camper = { id: "c", x: 0.3, y: world.heightAt(0.3, 80), z: 80, alive: true, strength: 3, background: "gambler", stats: {} };
    expect(hazards.step(0.1, [camper], true, fire).map((e) => e.kind)).toEqual(["burn"]);
    let burns = 0;
    for (let t = 0; t < 2; t += 0.1) burns += hazards.step(0.1, [camper], true, fire).length;
    expect(burns).toBe(2);
    expect(hazards.step(0.1, [camper], true, { ...fire, lit: false })).toHaveLength(0);
    expect(hazards.step(0.1, [{ ...camper, x: 3 }], true, fire)).toHaveLength(0);
  });

  it("giẫm lên bẫy thì bẫy sập đúng một lần", () => {
    const traps = generateTraps(world, 99);
    const land = traps.find((t) => t.y > 0.5)!;
    const hazards = new Hazards(world, traps, 99);
    const walker = { id: "w", x: land.x, y: land.y, z: land.z, alive: true, strength: 3, background: "gambler", stats: { dexterity: 1 } };
    const first = hazards.step(0.1, [walker], true);
    expect(first).toHaveLength(1);
    expect(first[0]!.trap!.id).toBe(land.id);
    expect(hazards.step(0.1, [walker], true)).toHaveLength(0);
    expect(hazards.isSprung(land.id)).toBe(true);
  });
});
