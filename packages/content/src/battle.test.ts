import { describe, expect, it } from "vitest";
import { BATTLE_SITES, battleMap, battleSpawn, boxAt, insideBox, raycastBoxes, raycastTerrain } from "./battle.ts";
import { WEAPON, WEAPONS, bulletAt, bulletDrop, falloff, hitPart, hitboxHeight, HITBOX } from "./battleItems.ts";

describe("bản đồ Battleground", () => {
  const map = battleMap(12345);

  it("mọi khu nằm trên đất liền, san phẳng đúng độ cao", () => {
    for (const site of BATTLE_SITES) {
      expect(map.world.heightAt(site.x, site.z)).toBeCloseTo(site.h, 1);
      expect(map.world.surface(site.x, site.z).pad).toBe(true);
    }
  });

  it("có đủ nhà cửa, đồ rơi, cây cối và mìn", () => {
    expect(map.boxes.length).toBeGreaterThan(1500);
    expect(map.loot.length).toBeGreaterThan(80);
    expect(map.loot.some((l) => l.tier === 3)).toBe(true);
    expect(map.world.trees.length).toBeGreaterThan(300);
    expect(map.mines.length).toBeGreaterThan(20);
  });

  it("chỗ xuất phát ở trên cạn, không kẹt trong tường", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 30; k++) {
      const s = battleSpawn(map, rand);
      expect(s.y).toBeGreaterThan(0.9);
      expect(insideBox(map.index, s.x, s.y + 1, s.z)).toBe(false);
    }
  });

  it("đạn bị tường chặn, bắn ra biển thì không trúng gì", () => {
    const city = BATTLE_SITES.find((s) => s.kind === "city")!;
    // Từ ngoài thành phố bắn ngang vào giữa: gặp nhà trước khi tới tâm.
    const o: [number, number, number] = [city.x - city.rx - 20, city.h + 1.5, city.z];
    const hit = raycastBoxes(map.index, o, [1, 0, 0], city.rx * 2 + 40);
    expect(hit).toBeLessThan(city.rx * 2 + 40);
    expect(raycastBoxes(map.index, [0, 30, 230], [0, 0, 1], 50)).toBe(Infinity);
    // Bắn chúc xuống thì gặp đất.
    expect(raycastTerrain(map.world, [city.x, city.h + 10, city.z], [0, -1, 0], 50)).toBeCloseTo(10, 0);
  });

  it("sát thương giảm theo khoảng cách nhưng không dưới một nửa", () => {
    for (const w of WEAPONS) {
      expect(falloff(w, w.range)).toBe(1);
      expect(falloff(w, w.range * 10)).toBe(0.5);
    }
  });
});

describe("hàng rào lưới", () => {
  it("chặn người đi nhưng đạn bay xuyên qua", () => {
    const map = battleMap(12345);
    const fence = map.boxes.find((b) => b.mat === "fence" && b.solid);
    expect(fence).toBeDefined();
    const f = fence!;
    // Bắn ngang qua mặt mỏng của hàng rào, từ ngoài vào giữa.
    const thinX = f.w < f.d;
    const dir: [number, number, number] = thinX ? [Math.cos(f.rot), 0, -Math.sin(f.rot)] : [Math.sin(f.rot), 0, Math.cos(f.rot)];
    const o: [number, number, number] = [f.x - dir[0] * 1.5, f.y, f.z - dir[2] * 1.5];
    const plain = raycastBoxes(map.index, o, dir, 1.6);
    expect(plain).toBeLessThan(1.6);
    expect(raycastBoxes(map.index, o, dir, 1.6, true)).toBe(Infinity);
  });
});

describe("boxAt", () => {
  it("tìm đúng khối chứa điểm (để biết đạn găm vào chất liệu gì)", () => {
    const map = battleMap(1);
    const b = map.boxes.find((x) => x.solid && x.pitch === 0 && x.w > 2 && x.d > 2 && x.h > 2)!;
    expect(boxAt(map.index, b.x, b.y, b.z)).not.toBeNull();
    expect(boxAt(map.index, b.x, b.y + b.h + 50, b.z)).toBeNull();
  });
});

describe("đường đạn", () => {
  it("đạn rơi dần theo quãng bay, súng bắn tỉa ở 400 m rơi cỡ một mét rưỡi", () => {
    const kar = WEAPON.get("kar98k")!;
    expect(bulletDrop(kar.velocity, 50)).toBeLessThan(0.05);
    expect(bulletDrop(kar.velocity, 400)).toBeGreaterThan(1);
    expect(bulletDrop(kar.velocity, 400)).toBeLessThan(2);
    const p = bulletAt([0, 10, 0], [1, 0, 0], kar.velocity, 200);
    expect(p[0]).toBe(200);
    expect(p[1]).toBeCloseTo(10 - bulletDrop(kar.velocity, 200), 6);
    // Đạn chậm (tiểu liên .45) rơi nhiều hơn đạn nhanh ở cùng tầm.
    expect(bulletDrop(WEAPON.get("ump45")!.velocity, 100)).toBeGreaterThan(bulletDrop(WEAPON.get("m416")!.velocity, 100) * 5);
  });
});

describe("mô hình trúng (dùng chung client và server)", () => {
  it("ngưỡng đầu là đáy cầu đầu, nên bắn vào giữa thân không bị nâng thành đầu", () => {
    // Đứng: cầu đầu tâm 1,62 bán kính 0,15 ⇒ đáy ở 1,47.
    const standBottom = HITBOX.headY.stand - HITBOX.headR;
    const crouchBottom = HITBOX.headY.crouch - HITBOX.headR;
    expect(standBottom).toBeCloseTo(1.47, 6);
    expect(hitPart("head", 1.6, 0, false)).toBe("head");
    expect(hitPart("head", standBottom + 0.01, 0, false)).toBe("head");
    expect(hitPart("head", standBottom - 0.01, 0, false)).toBe("body");
    // Ngồi xổm: tâm 1,12 ⇒ đáy 0,97.
    expect(hitPart("head", 1.05, 0, true)).toBe("head");
    expect(hitPart("head", crouchBottom + 0.01, 0, true)).toBe("head");
    expect(hitPart("head", crouchBottom - 0.01, 0, true)).toBe("body");
    // Client khai thân thì server không tự nâng lên đầu.
    expect(hitPart("body", 1.7, 0, false)).toBe("body");
  });

  it("chiều cao thân bao trọn cả cầu đầu", () => {
    expect(hitboxHeight(false)).toBeCloseTo(HITBOX.headY.stand + HITBOX.headR, 6);
    expect(hitboxHeight(true)).toBeCloseTo(HITBOX.headY.crouch + HITBOX.headR, 6);
  });
});

describe("mái nhà dốc", () => {
  it("hai tấm mái chụm lên nóc (hình chữ Λ), không chúc xuống giữa", () => {
    const map = battleMap(1);
    const roofs = map.boxes.filter((b) => b.mat === "roof" && b.pitch !== 0);
    expect(roofs.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < roofs.length; i += 2) {
      const a = roofs[i]!;
      const b = roofs[i + 1]!;
      // Đầu mép của tấm a ở phía tấm b phải cao hơn tâm tấm (dốc lên phía nóc).
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz);
      const probe = { x: a.x + (dx / l) * 1, z: a.z + (dz / l) * 1 };
      // Trục v của khối: (sin rot, cos rot); đi 1 m về phía b theo trục v thì độ cao đổi −sin(pitch)·(hướng).
      const along = (probe.x - a.x) * Math.sin(a.rot) + (probe.z - a.z) * Math.cos(a.rot);
      expect(-Math.sin(a.pitch) * along).toBeGreaterThan(0);
    }
  });
});
