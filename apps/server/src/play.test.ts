import { describe, expect, it } from "vitest";
import { TREE_KINDS, generateWorld } from "@tentides/content";
import { Play, pickTarget, type Target } from "./play.ts";
import { Wildlife } from "./wildlife.ts";

const world = generateWorld(777);

describe("đánh và ném", () => {
  it("đánh gần trúng thứ trước mặt trong tầm với, không trúng thứ sau lưng", () => {
    const from = { x: 0, y: 0, z: 0 };
    // yaw = 0 là nhìn về phía -z.
    const front: Target = { kind: "creature", id: "a", x: 0, y: 0, z: -1.5 };
    const behind: Target = { kind: "creature", id: "b", x: 0, y: 0, z: 1.2 };
    const far: Target = { kind: "player", id: "c", x: 0, y: 0, z: -6 };
    expect(pickTarget(from, 0, 0, 2, [behind, front, far])?.id).toBe("a");
    expect(pickTarget(from, Math.PI, 0, 2, [front, far])).toBeNull();
    // Bắn xa trúng thứ đầu tiên nằm trên đường ngắm.
    expect(pickTarget(from, 0, 0, 20, [far], true)?.id).toBe("c");
  });

  it("ném đi thì bay vòng cung rồi trúng người đứng trên đường bay, hoặc rơi xuống đất", () => {
    const play = new Play(world, 1);
    const t = world.trees[0]!;
    const y = world.heightAt(t.x + 3, t.z);
    play.throw("me", "stone", { x: t.x + 3, y, z: t.z }, 0, 0, 1, { damage: 7 });
    const victim: Target = { kind: "player", id: "you", x: t.x + 3, y: world.heightAt(t.x + 3, t.z - 4), z: t.z - 4 };
    const events = [];
    for (let i = 0; i < 40 && play.projectiles.size > 0; i++) events.push(...play.stepProjectiles(0.1, [victim]));
    expect(events[0]).toMatchObject({ kind: "hit", target: { id: "you" } });

    play.throw("me", "stone", { x: t.x + 3, y, z: t.z }, 0, 0.3, 1, { damage: 7 });
    const landed = [];
    for (let i = 0; i < 80 && play.projectiles.size > 0; i++) landed.push(...play.stepProjectiles(0.1, []));
    expect(landed[0]?.kind).toBe("land");
  });
});

describe("cây", () => {
  it("chặt đủ nhát thì cây đổ, rơi gỗ; người đang leo bị rơi theo; trồng cây non lớn dần tới leo được", () => {
    const play = new Play(world, 2);
    const tree = world.trees.find((t) => t.kind === "palm")!;
    play.climbers.set("monkeyboy", tree.id);
    let result = null;
    let hits = 0;
    while (!result && hits < 50) {
      result = play.chop(tree.id, 22);
      hits++;
    }
    expect(hits).toBe(Math.ceil(TREE_KINDS.palm.hp / 22));
    expect(result!.drops.filter((d) => d === "wood").length).toBe(TREE_KINDS.palm.wood);
    expect(result!.riders).toEqual(["monkeyboy"]);
    expect(play.tree(tree.id)).toBeUndefined();

    const spot = world.trees.find((t) => t.kind === "broadleaf")!;
    const x = spot.x + 4;
    const z = spot.z + 4;
    if (play.canPlant(x, z)) {
      const id = play.plant("broadleaf", x, z);
      expect(play.climbable(play.tree(id)!)).toBe(false);
      for (let i = 0; i < 200; i++) play.tick(1);
      expect(play.climbable(play.tree(id)!)).toBe(true);
    }
  });
});

describe("thú", () => {
  it("đánh chết thì rơi đồ theo danh mục, sáng hôm sau đàn khác tới", () => {
    const wildlife = new Wildlife(world, 5);
    const boar = wildlife.active(3).find((c) => c.def.id === "wild_boar") ?? wildlife.active(3)[0]!;
    const hp = boar.def.hp;
    expect(wildlife.damage(boar.id, hp - 1, { id: "p", x: boar.x + 1, z: boar.z })).toBeNull();
    const kill = wildlife.damage(boar.id, 5, { id: "p", x: boar.x + 1, z: boar.z })!;
    expect(kill).not.toBeNull();
    for (const d of kill.drops) expect(boar.def.drops.map((x) => x.item)).toContain(d);
    expect(wildlife.find(boar.id)).toBeUndefined();
    wildlife.respawn();
    expect(wildlife.find(boar.id)?.hp).toBe(hp);
  });

  it("bị đánh thì con dữ đuổi theo người đánh, con hiền bỏ chạy", () => {
    const wildlife = new Wildlife(world, 6);
    const shy = wildlife.active(5).find((c) => c.def.temper !== "hostile" && c.def.hp > 10)!;
    wildlife.damage(shy.id, 1, { id: "p", x: shy.x + 1, z: shy.z });
    expect(["flee", "climb"]).toContain(shy.mode);
    const mean = wildlife.active(5).find((c) => c.def.temper === "hostile" && c.def.hp > 10)!;
    wildlife.damage(mean.id, 1, { id: "p", x: mean.x + 1, z: mean.z });
    expect(mean.grudge).toBe("p");
  });

  it("cá mập tìm tới chỗ nước sâu gần người bơi, rồi bỏ đi khi không còn ai dưới nước", () => {
    const wildlife = new Wildlife(world, 7);
    const deep = { x: 0, z: 200 };
    const shark = wildlife.spawnShark(deep);
    expect(shark).not.toBeNull();
    expect(world.heightAt(shark!.x, shark!.z)).toBeLessThan(-4);
    for (let t = 0; t < 25; t += 0.5) wildlife.step(0.5, 3, [], true);
    expect(wildlife.find(shark!.id)).toBeUndefined();
  });
});
