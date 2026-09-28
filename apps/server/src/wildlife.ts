import { CAMP, CAMP_RADIUS, WATER_LEVEL, makeRand, subSeed, worldCatalog, type Creature, type CreatureSpawn, type Habitat, type World, type WorldCatalog } from "@tentides/content";
import type { EncounterEffects } from "@tentides/rules";

// Sinh vật trên bản đồ: server cho đi lại (lang thang, bỏ chạy, lại gần, đuổi cắn) và quyết định ai bị cắn.
// Đây là mặt phẳng thời gian thực, giống vị trí người chơi: không nằm trong engine luật. Khi con vật cắn trúng,
// server đưa hệ quả vào engine qua hành động `encounter`, nên event log vẫn đủ để phát lại ván.

export type CreatureMode = "idle" | "walk" | "flee" | "chase" | "attack" | "follow" | "return";

export interface SimCreature {
  id: string;
  def: Creature;
  spawn: CreatureSpawn;
  x: number;
  y: number;
  z: number;
  rotY: number;
  mode: CreatureMode;
  targetX: number;
  targetZ: number;
  /** Giây còn lại của việc đang làm (đứng nghỉ, bỏ chạy, lùi lại sau khi cắn). */
  timer: number;
  cooldown: number;
}

/** Góc nhìn của sinh vật về một người chơi. */
export interface Prey {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  items: readonly string[];
}

export interface Bite {
  creatureId: string;
  species: string;
  playerId: string;
  effects: EncounterEffects;
  deterred: boolean;
}

const WATER: ReadonlySet<Habitat> = new Set(["shallows", "reef", "sea", "lake_water"]);
const INSIDE: ReadonlySet<Habitat> = new Set(["cave", "cave_deep", "mine", "mine_deep"]);
/** Con vật nguy hiểm không đuổi quá chừng này mét ra khỏi vùng của nó. */
const LEASH = 26;
/** Quanh trại là vùng an toàn: không con gì theo vào. */
const SAFE_RADIUS = CAMP_RADIUS + 8;

export class Wildlife {
  readonly creatures: SimCreature[] = [];
  private readonly rand: ReturnType<typeof makeRand>;

  constructor(
    private readonly world: World,
    seed: number,
    catalog: WorldCatalog = worldCatalog,
  ) {
    this.rand = makeRand(subSeed(seed, "wildlife"));
    for (const spawn of world.spawns) {
      const def = catalog.creatures.get(spawn.species);
      if (!def) continue;
      this.creatures.push({
        id: spawn.id,
        def,
        spawn,
        x: spawn.x,
        y: this.heightFor(def, spawn, spawn.x, spawn.z),
        z: spawn.z,
        rotY: this.rand() * Math.PI * 2,
        mode: "idle",
        targetX: spawn.x,
        targetZ: spawn.z,
        timer: this.rand() * 3,
        cooldown: 0,
      });
    }
  }

  /** Những con đã xuất hiện tính tới ngày này (sinh vật lạ và biến dị tới muộn, khi núi lửa thức). */
  active(day: number): SimCreature[] {
    const d = Math.max(1, day);
    return this.creatures.filter((c) => c.def.fromDay <= d);
  }

  /**
   * Chạy một bước. `hunting`: đang trong giờ đi lại trên đảo thì con vật nguy hiểm mới tấn công.
   * Trả về những lần cắn trúng để server đưa vào engine luật.
   */
  step(dt: number, day: number, prey: readonly Prey[], hunting: boolean): Bite[] {
    const bites: Bite[] = [];
    for (const c of this.active(day)) {
      c.cooldown = Math.max(0, c.cooldown - dt);
      c.timer -= dt;
      const target = this.nearest(c, prey);
      const def = c.def;

      if (def.temper === "hostile" && hunting && target && target.dist <= (def.aggro ?? 6) && c.mode !== "flee" && this.canReach(c, target.p)) {
        const reach = 0.9 + 0.5 * def.size;
        if (target.dist3 <= reach + 0.6 && c.cooldown === 0) {
          const deterred = (def.deterredBy ?? []).some((item) => target.p.items.includes(item));
          const effects = deterred ? halve(def.attack!.effects) : def.attack!.effects;
          bites.push({ creatureId: c.id, species: def.id, playerId: target.p.id, effects, deterred });
          c.cooldown = def.attack!.cooldown;
          // Cắn xong lùi ra; gặp người cầm đuốc, dao hay súng thì bỏ chạy hẳn.
          this.fleeFrom(c, target.p, deterred ? 6 : 2.2);
        } else if (c.mode !== "attack" || c.timer <= 0) {
          c.mode = "chase";
          c.targetX = target.p.x;
          c.targetZ = target.p.z;
        }
      } else if (def.temper === "neutral" && target && target.dist <= (def.aggro ?? 6) && c.mode !== "flee") {
        this.fleeFrom(c, target.p, 2.5);
      } else if (def.temper === "friendly" && target && target.dist <= 11 && this.canReach(c, target.p) && c.mode !== "flee") {
        // Lại gần người rồi đứng ngắm, không chen vào chân.
        c.mode = target.dist > 2.4 ? "follow" : "idle";
        c.timer = 1;
        c.targetX = target.dist > 2.4 ? target.p.x : c.x;
        c.targetZ = target.dist > 2.4 ? target.p.z : c.z;
        if (c.mode === "idle") c.rotY = Math.atan2(target.p.x - c.x, target.p.z - c.z);
      } else if (c.mode === "chase" || c.mode === "follow" || (c.mode === "flee" && c.timer <= 0)) {
        c.mode = "return";
        this.pickWanderTarget(c);
      } else if ((c.mode === "idle" && c.timer <= 0) || ((c.mode === "walk" || c.mode === "return") && this.arrived(c))) {
        if (c.mode === "idle") {
          c.mode = "walk";
          this.pickWanderTarget(c);
        } else {
          c.mode = "idle";
          c.timer = 1.5 + this.rand() * 4;
        }
      } else if ((c.mode === "walk" || c.mode === "return") && c.timer <= -12) {
        // Kẹt lâu thì đổi hướng.
        this.pickWanderTarget(c);
      }

      const speed =
        c.mode === "chase" ? (def.chaseSpeed ?? def.speed * 2) : c.mode === "flee" ? Math.max(def.speed * 2.2, 2.5) : c.mode === "idle" || c.mode === "attack" ? 0 : c.mode === "follow" ? def.speed * 1.4 : def.speed;
      this.moveToward(c, speed * dt);
      if (c.mode === "chase" && target && target.dist3 <= 0.9 + 0.5 * def.size + 0.6) c.mode = "attack";
    }
    return bites;
  }

  private nearest(c: SimCreature, prey: readonly Prey[]) {
    let best: { p: Prey; dist: number; dist3: number } | null = null;
    for (const p of prey) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - CAMP.x, p.z - CAMP.z) < SAFE_RADIUS) continue;
      const dist = Math.hypot(p.x - c.x, p.z - c.z);
      if (best && dist >= best.dist) continue;
      // Tính tới độ cao: dơi bay, cá bơi ở độ sâu khác người.
      const dy = p.y + 0.9 - c.y;
      best = { p, dist, dist3: Math.hypot(dist, dy) };
    }
    return best;
  }

  /** Con vật chỉ theo người vào đúng loại địa hình của nó: cá mập không lên bờ, heo rừng không xuống biển. */
  private canReach(c: SimCreature, p: Prey): boolean {
    const hab = c.spawn.habitat;
    if (INSIDE.has(hab)) return this.world.structureAt(p.x, p.z)?.structure.id === c.spawn.structure;
    const ground = this.world.heightAt(p.x, p.z);
    if (WATER.has(hab)) return ground < -0.6 && p.y < WATER_LEVEL;
    if (this.world.structureAt(p.x, p.z)) return false;
    return ground > 0.2 && Math.hypot(p.x - c.spawn.x, p.z - c.spawn.z) < c.spawn.range + LEASH;
  }

  private valid(c: SimCreature, x: number, z: number): boolean {
    const hab = c.spawn.habitat;
    if (INSIDE.has(hab)) return this.world.structureAt(x, z)?.structure.id === c.spawn.structure;
    if (Math.abs(x) > 235 || Math.abs(z) > 235) return false;
    const h = this.world.heightAt(x, z);
    if (WATER.has(hab)) return hab === "sea" ? h < -3 : h < -0.8;
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < SAFE_RADIUS) return false;
    return h > 0.35 && !this.world.structureAt(x, z);
  }

  private pickWanderTarget(c: SimCreature) {
    const s = c.spawn;
    c.timer = 0;
    for (let i = 0; i < 10; i++) {
      let x: number;
      let z: number;
      if (s.structure) {
        const structure = this.world.structures.find((st) => st.id === s.structure);
        if (!structure) break;
        const [ci, cj] = structure.cells[Math.floor(this.rand() * structure.cells.length)]!;
        const u = ci * structure.cellSize + (this.rand() - 0.5) * structure.cellSize * 0.5;
        const v = (cj + 0.5) * structure.cellSize + (this.rand() - 0.5) * structure.cellSize * 0.5;
        const cs = Math.cos(structure.rot);
        const sn = Math.sin(structure.rot);
        x = structure.x + u * cs + v * sn;
        z = structure.z - u * sn + v * cs;
      } else {
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * s.range;
        x = s.x + Math.cos(a) * r;
        z = s.z + Math.sin(a) * r;
      }
      if (this.valid(c, x, z)) {
        c.targetX = x;
        c.targetZ = z;
        return;
      }
    }
    c.targetX = s.x;
    c.targetZ = s.z;
  }

  private fleeFrom(c: SimCreature, p: Prey, seconds: number) {
    c.mode = "flee";
    c.timer = seconds;
    const a = Math.atan2(c.z - p.z, c.x - p.x) + (this.rand() - 0.5) * 0.8;
    c.targetX = c.x + Math.cos(a) * 20;
    c.targetZ = c.z + Math.sin(a) * 20;
  }

  private arrived(c: SimCreature): boolean {
    return Math.hypot(c.targetX - c.x, c.targetZ - c.z) < 0.6;
  }

  private moveToward(c: SimCreature, step: number) {
    const dx = c.targetX - c.x;
    const dz = c.targetZ - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) c.rotY = Math.atan2(dx, dz);
    if (step <= 0 || dist < 0.05) {
      c.y = this.heightFor(c.def, c.spawn, c.x, c.z);
      return;
    }
    const k = Math.min(1, step / dist);
    const nx = c.x + dx * k;
    const nz = c.z + dz * k;
    if (this.valid(c, nx, nz)) {
      c.x = nx;
      c.z = nz;
    } else if (c.mode === "flee" || c.mode === "walk" || c.mode === "return") {
      // Gặp bờ, vách hay mép vùng thì quay về phía nhà.
      c.targetX = c.spawn.x;
      c.targetZ = c.spawn.z;
      if (c.mode === "flee") c.timer = 0;
      if (!this.valid(c, c.x, c.z)) {
        c.x = c.spawn.x;
        c.z = c.spawn.z;
      }
    }
    c.y = this.heightFor(c.def, c.spawn, c.x, c.z);
  }

  /** Độ cao vẽ con vật: trên mặt đất, lơ lửng giữa hang (dơi), hoặc giữa làn nước (cá, sứa, rùa). */
  private heightFor(def: Creature, spawn: CreatureSpawn, x: number, z: number): number {
    const ground = this.world.heightAt(x, z);
    if (spawn.structure) {
      const s = this.world.structures.find((st) => st.id === spawn.structure);
      const floor = s?.floor ?? ground;
      return floor + (def.fly ?? 0);
    }
    if (WATER.has(spawn.habitat)) {
      const depth = WATER_LEVEL - ground;
      if (def.model === "dolphin" || def.model === "shark") return WATER_LEVEL - Math.min(1.6, depth * 0.3);
      if (def.model === "jellyfish") return WATER_LEVEL - Math.min(1.8, depth * 0.45);
      return ground + Math.min(0.5, depth * 0.3);
    }
    return ground + (def.fly ?? 0);
  }
}

function halve(effects: EncounterEffects): EncounterEffects {
  const out: EncounterEffects = {};
  for (const [k, v] of Object.entries(effects) as [keyof EncounterEffects, number | string][]) {
    if (typeof v === "number") (out as Record<string, number>)[k] = Math.trunc(v / 2);
  }
  return out;
}
