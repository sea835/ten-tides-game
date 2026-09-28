import { describe, expect, it } from "vitest";
import { ANCHORS, CAMP, TREASURE_SITES, heightAt as islandHeightAt } from "./island.ts";
import { loadWorldCatalog, worldCatalog } from "./worldCatalog.ts";
import { cellCenter, generateTraps, generateWorld, structureSlabs } from "./worldgen.ts";

const UNDERWATER = new Set(["lake_bed", "lake_water", "shallows", "reef", "sea", "seabed"]);
const INSIDE = new Set(["cave", "cave_deep", "mine", "mine_deep"]);
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);

/** Phần dữ liệu của thế giới (bỏ các hàm) để so sánh. */
function data(seed: number) {
  const w = generateWorld(seed);
  return JSON.stringify({ islets: w.islets, reefs: w.reefs, structures: w.structures, pois: w.pois, spawns: w.spawns, palms: w.palms });
}

describe("worldgen", () => {
  it("cùng seed ra cùng thế giới, khác seed ra thế giới khác", () => {
    expect(data(20260928)).toBe(data(20260928));
    expect(data(1)).not.toBe(data(2));
  });

  it("không đụng tới những chỗ cố định của đảo chính", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const w = generateWorld(seed);
      for (const p of [CAMP, ...ANCHORS, ...TREASURE_SITES]) {
        expect(w.heightAt(p.x, p.z), `seed ${seed}`).toBeCloseTo(islandHeightAt(p.x, p.z), 5);
        expect(w.structureAt(p.x, p.z)).toBeNull();
      }
    }
  });

  it("đảo nhỏ nằm ngoài khơi, trong vùng chơi, có đất liền và bãi cạn", () => {
    for (const seed of SEEDS) {
      const w = generateWorld(seed);
      expect(w.islets.length).toBeGreaterThanOrEqual(3);
      for (const it of w.islets) {
        // Đảo vòng có vụng nước ở giữa: đo trên vành đai.
        const probe = it.kind === "atoll" ? { x: it.x + it.radius * 0.8, z: it.z } : it;
        const land = Array.from({ length: 16 }, (_, k) => w.heightAt(it.x + Math.cos(k) * it.radius * 0.8, it.z + Math.sin(k) * it.radius * 0.8));
        expect(Math.max(w.heightAt(probe.x, probe.z), ...land), `${seed} ${it.name}`).toBeGreaterThan(0.3);
        expect(Math.hypot(it.x, it.z)).toBeGreaterThan(130);
        const x = it.x + it.radius * 0.1;
        if (!w.structureAt(x, it.z)) expect(w.regionAt(x, it.z)).toContain(it.name);
      }
      expect(new Set(w.islets.map((i) => i.name)).size).toBe(w.islets.length);
    }
  });

  it("hang và hầm mỏ: có cửa trên mặt đất, mọi ô nằm trong lòng hang, vách khép kín", () => {
    let caves = 0;
    let mines = 0;
    for (const seed of SEEDS) {
      const w = generateWorld(seed);
      for (const s of w.structures) {
        if (s.kind === "cave") caves++;
        else mines++;
        expect(s.floor).toBeGreaterThanOrEqual(1.2);
        expect(s.depth.every((d) => Number.isFinite(d))).toBe(true);
        s.cells.forEach((_, k) => {
          const c = cellCenter(s, k);
          expect(w.structureAt(c.x, c.z)?.cell).toBe(k);
          expect(w.heightAt(c.x, c.z)).toBeCloseTo(s.floor, 3);
        });
        const walls = structureSlabs(s).filter((b) => b.part === "wall").length;
        expect(walls).toBeGreaterThanOrEqual(s.cells.length + 2);
      }
    }
    // Trung bình mỗi ván có ít nhất 2 hang và 1 hầm mỏ.
    expect(caves / SEEDS.length).toBeGreaterThanOrEqual(1.5);
    expect(mines / SEEDS.length).toBeGreaterThanOrEqual(1);
  });

  it("easter egg, điểm bất thường và sinh vật nằm đúng môi trường sống", () => {
    for (const seed of SEEDS) {
      const w = generateWorld(seed);
      expect(w.pois.filter((p) => p.kind === "egg").length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(w.pois.filter((p) => p.kind === "anomaly").length).toBeGreaterThanOrEqual(4);
      expect(new Set(w.pois.map((p) => p.defId)).size).toBe(w.pois.length);
      for (const p of w.pois) {
        const def = worldCatalog.pois.get(p.defId)!;
        expect(def.habitats).toContain(p.habitat);
        if (UNDERWATER.has(p.habitat)) expect(p.y, `${seed} ${p.defId}`).toBeLessThan(-0.8);
        else expect(p.y, `${seed} ${p.defId}`).toBeGreaterThan(0.3);
        if (INSIDE.has(p.habitat)) expect(w.structureAt(p.x, p.z)?.structure.id).toBe(p.structure);
        if (def.kind === "anomaly") expect(def.outcomes![p.outcome]).toBeDefined();
        expect(Math.hypot(p.x - CAMP.x, p.z - CAMP.z)).toBeGreaterThan(20);
      }
      expect(w.spawns.length).toBeGreaterThan(25);
      for (const c of w.spawns) {
        const h = w.heightAt(c.x, c.z);
        if (UNDERWATER.has(c.habitat)) expect(h, `${seed} ${c.species}`).toBeLessThan(-0.8);
        else if (!INSIDE.has(c.habitat)) expect(h, `${seed} ${c.species}`).toBeGreaterThan(0.3);
        else expect(w.structureAt(c.x, c.z)).not.toBeNull();
      }
    }
  });

  it("cây leo được, chặt được: id không trùng, mọc trên đất liền, không đè lên hang hay trại", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const w = generateWorld(seed);
      expect(w.trees.filter((t) => t.kind === "broadleaf").length).toBeGreaterThan(20);
      expect(new Set(w.trees.map((t) => t.id)).size).toBe(w.trees.length);
      for (const t of w.trees) {
        expect(w.heightAt(t.x, t.z), `${seed} ${t.id}`).toBeGreaterThan(0.3);
        expect(w.structureAt(t.x, t.z)).toBeNull();
        expect(Math.hypot(t.x - CAMP.x, t.z - CAMP.z)).toBeGreaterThan(8);
      }
    }
  });

  it("bẫy theo seed bí mật: đổi seed bí mật thì đổi chỗ, không nằm trong trại", () => {
    const w = generateWorld(99);
    const a = generateTraps(w, 1);
    const b = generateTraps(w, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(generateTraps(w, 1)));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    for (const seed of SEEDS.slice(0, 20)) {
      const traps = generateTraps(generateWorld(seed), seed);
      expect(traps.length).toBeGreaterThanOrEqual(8);
      for (const t of traps) expect(Math.hypot(t.x - CAMP.x, t.z - CAMP.z)).toBeGreaterThan(20);
    }
  });

  it("danh mục báo lỗi khi tham chiếu đồ không có thật", () => {
    const raw = JSON.parse(
      JSON.stringify({
        ...worldCatalog,
        creatures: [...worldCatalog.creatures.values()],
        pois: [...worldCatalog.pois.values()],
        traps: [...worldCatalog.traps.values()],
        buildings: [...worldCatalog.buildings.values()],
      }),
    );
    raw.pois[0].effects = { gainItem: "unicorn" };
    raw.pois[0].kind = "egg";
    raw.pois[0].text = "x";
    const items = new Set(["rope", "machete", "flintlock", "torch", "lantern", "spyglass", "compass", "gunpowder", "matches", "amulet", "raw_meat", "feather", "coconut", "hide", "bone", "ink_sac", "fish", "crystal_shard", "wood"]);
    expect(() => loadWorldCatalog(raw, items)).toThrow(/unicorn/);
  });
});
