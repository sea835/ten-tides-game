import { WATER_LEVEL, makeRand, subSeed, worldCatalog, type Creature, type CreatureSpawn, type Habitat, type StatusEffects, type World, type WorldCatalog } from "@tentides/content";
import type { EncounterEffects } from "@tentides/rules";

// Sinh vật trên bản đồ: server cho đi lại (lang thang, bỏ chạy, lại gần, đuổi cắn) và quyết định ai bị cắn.
// Đây là mặt phẳng thời gian thực, giống vị trí người chơi: không nằm trong engine luật. Khi con vật cắn trúng,
// server đưa hệ quả vào engine qua hành động `encounter`, nên event log vẫn đủ để phát lại ván.
//
// Thú có máu: bị đánh thì con dữ quay lại cắn, con hiền bỏ chạy bằng tài riêng (trèo cây, bay vút lên, lặn sâu).
// Chết thì rơi đồ, sáng hôm sau đàn khác lại tới chỗ cũ. Bơi ra khơi lâu thì cá mập tìm tới.

export type CreatureMode = "idle" | "walk" | "flee" | "chase" | "attack" | "follow" | "return" | "climb" | "perch";

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
  hp: number;
  dead: boolean;
  /** Giây choáng còn lại: đứng im. */
  stun: number;
  /** Độ cao thêm so với chỗ đứng bình thường (đang trên ngọn cây, bay vút lên, lặn sâu xuống). */
  alt: number;
  altTarget: number;
  /** Người vừa đánh nó: con dữ đuổi theo người này dù ở ngoài tầm phát hiện. */
  grudge: string | null;
  grudgeTime: number;
  /** Cá mập tìm tới người bơi ngoài khơi: tự biến mất khi không còn ai dưới nước gần đó. */
  temp: boolean;
  lonely: number;
}

/** Góc nhìn của sinh vật về một người chơi. */
export interface Prey {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  items: readonly string[];
  /** Đang trên cây: thú dưới đất không với tới. */
  climbing?: boolean;
}

export interface Bite {
  creatureId: string;
  species: string;
  playerId: string;
  effects: EncounterEffects;
  status: StatusEffects;
  deterred: boolean;
}

export interface Kill {
  creature: SimCreature;
  drops: string[];
}

/** Cây đang đứng mà thú trèo được. */
export interface Perch {
  x: number;
  z: number;
  height: number;
}

const WATER: ReadonlySet<Habitat> = new Set(["shallows", "reef", "sea", "lake_water"]);
const INSIDE: ReadonlySet<Habitat> = new Set(["cave", "cave_deep", "mine", "mine_deep"]);
/** Con vật nguy hiểm không đuổi quá chừng này mét ra khỏi vùng của nó. */
const LEASH = 26;
/** Bị đánh thì nhớ mặt người đánh chừng này giây. */
const GRUDGE_SECONDS = 12;
/** Thú dữ còn dưới chừng này phần Máu thì bỏ chạy thay vì đánh tiếp. */
const WOUNDED_FLEE = 0.3;
const SHARK_SPECIES = "blackfin_shark";

export class Wildlife {
  readonly creatures: SimCreature[] = [];
  private readonly rand: ReturnType<typeof makeRand>;
  private sharks = 0;

  constructor(
    private readonly world: World,
    seed: number,
    private readonly catalog: WorldCatalog = worldCatalog,
    /** Cây đang đứng, để thú biết trèo lên đâu. */
    private readonly perches: () => readonly Perch[] = () => [],
    /** Trại đang ở đâu (dời được), quanh trại là vùng an toàn. */
    private readonly camp: () => { x: number; z: number; radius: number } = () => ({ x: 0, z: 80, radius: 20 }),
  ) {
    this.rand = makeRand(subSeed(seed, "wildlife"));
    for (const spawn of world.spawns) {
      const def = catalog.creatures.get(spawn.species);
      if (def) this.creatures.push(this.make(spawn, def, false));
    }
  }

  private make(spawn: CreatureSpawn, def: Creature, temp: boolean): SimCreature {
    return {
      id: spawn.id,
      def,
      spawn,
      x: spawn.x,
      y: this.heightFor(def, spawn, spawn.x, spawn.z, 0),
      z: spawn.z,
      rotY: this.rand() * Math.PI * 2,
      mode: "idle",
      targetX: spawn.x,
      targetZ: spawn.z,
      timer: this.rand() * 3,
      cooldown: 0,
      hp: def.hp,
      dead: false,
      stun: 0,
      alt: 0,
      altTarget: 0,
      grudge: null,
      grudgeTime: 0,
      temp,
      lonely: 0,
    };
  }

  /** Những con còn sống và đã xuất hiện tính tới ngày này (sinh vật lạ và biến dị tới muộn, khi núi lửa thức). */
  active(day: number): SimCreature[] {
    const d = Math.max(1, day);
    return this.creatures.filter((c) => !c.dead && c.def.fromDay <= d);
  }

  find(id: string): SimCreature | undefined {
    return this.creatures.find((c) => c.id === id && !c.dead);
  }

  /** Sáng ra, đàn khác lại tới chỗ những con đã bị giết. */
  respawn() {
    for (const c of this.creatures) {
      if (!c.dead || c.temp) continue;
      Object.assign(c, this.make(c.spawn, c.def, false));
    }
    this.creatures.splice(0, this.creatures.length, ...this.creatures.filter((c) => !c.temp || !c.dead));
  }

  /**
   * Bị đánh: mất máu, choáng nếu đòn có choáng. Con dữ nhớ mặt người đánh; con hiền bỏ chạy bằng tài riêng.
   * Trả về đồ rơi ra nếu con vật chết.
   */
  damage(id: string, amount: number, from: { id: string; x: number; z: number }, stun = 0): Kill | null {
    const c = this.find(id);
    if (!c) return null;
    c.hp -= amount;
    c.stun = Math.max(c.stun, stun);
    if (c.hp <= 0) {
      c.dead = true;
      c.hp = 0;
      const drops = c.def.drops.filter((d) => this.rand() < d.chance).map((d) => d.item);
      return { creature: c, drops };
    }
    // Thú dữ bị thương nặng thì cụp đuôi bỏ chạy (tay không vẫn có cửa thắng nếu đánh đủ nhanh).
    if (c.def.temper === "hostile" && c.hp <= c.def.hp * WOUNDED_FLEE) {
      c.grudge = null;
      c.grudgeTime = 0;
      this.fleeFrom(c, from, 9);
    } else if (c.def.temper === "hostile") {
      c.grudge = from.id;
      c.grudgeTime = GRUDGE_SECONDS;
      c.mode = "chase";
    } else {
      this.fleeFrom(c, from, 6);
    }
    return null;
  }

  /** Cá mập tìm tới người đang bơi ngoài khơi, xuất hiện ở chỗ nước sâu cách người đó một quãng. */
  spawnShark(near: { x: number; z: number }): SimCreature | null {
    const def = this.catalog.creatures.get(SHARK_SPECIES);
    if (!def || this.creatures.filter((c) => c.temp && !c.dead).length >= 4) return null;
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = 18 + this.rand() * 10;
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      if (this.world.heightAt(x, z) > -4 || Math.abs(x) > 230 || Math.abs(z) > 230) continue;
      const spawn: CreatureSpawn = { id: `shark${this.sharks++}`, species: def.id, habitat: "sea", x, z, range: 30, structure: null };
      const c = this.make(spawn, def, true);
      this.creatures.push(c);
      return c;
    }
    return null;
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
      c.grudgeTime = Math.max(0, c.grudgeTime - dt);
      if (c.grudgeTime === 0) c.grudge = null;
      if (c.temp && this.despawnIfLonely(c, prey, dt)) continue;
      if (c.stun > 0) {
        c.stun = Math.max(0, c.stun - dt);
        this.settleAltitude(c, dt);
        continue;
      }
      const target = this.nearest(c, prey);
      const def = c.def;
      const grudge = c.grudge ? prey.find((p) => p.id === c.grudge && p.alive) : undefined;
      const foe = grudge ? this.measure(c, grudge) : target;

      const wounded = def.temper === "hostile" && c.hp <= def.hp * WOUNDED_FLEE;
      if (wounded && foe && foe.dist <= (def.aggro ?? 6) && c.mode !== "flee") {
        this.fleeFrom(c, foe.p, 4);
      } else if (def.temper === "hostile" && hunting && foe && (foe.dist <= (def.aggro ?? 6) || grudge) && c.mode !== "flee" && this.canReach(c, foe.p)) {
        const reach = 0.9 + 0.5 * def.size;
        if (foe.dist3 <= reach + 0.6 && c.cooldown === 0) {
          const deterred = (def.deterredBy ?? []).some((item) => foe.p.items.includes(item));
          const effects = deterred ? halve(def.attack!.effects) : def.attack!.effects;
          bites.push({ creatureId: c.id, species: def.id, playerId: foe.p.id, effects, status: deterred ? {} : (def.attack!.status ?? {}), deterred });
          c.cooldown = def.attack!.cooldown;
          // Cắn xong lùi ra; gặp người cầm đuốc, dao hay súng thì bỏ chạy hẳn.
          this.fleeFrom(c, foe.p, deterred ? 6 : 2.2);
        } else if (c.mode !== "attack" || c.timer <= 0) {
          c.mode = "chase";
          c.targetX = foe.p.x;
          c.targetZ = foe.p.z;
        }
      } else if (def.temper === "neutral" && target && target.dist <= (def.aggro ?? 6) && c.mode !== "flee" && c.mode !== "climb" && c.mode !== "perch") {
        this.fleeFrom(c, target.p, 2.5);
      } else if (
        def.temper === "friendly" &&
        target &&
        target.dist <= 11 &&
        this.canReach(c, target.p) &&
        c.mode !== "flee" &&
        c.mode !== "climb" &&
        c.mode !== "perch"
      ) {
        // Lại gần người rồi đứng ngắm, không chen vào chân.
        c.mode = target.dist > 2.4 ? "follow" : "idle";
        c.timer = 1;
        c.targetX = target.dist > 2.4 ? target.p.x : c.x;
        c.targetZ = target.dist > 2.4 ? target.p.z : c.z;
        if (c.mode === "idle") c.rotY = Math.atan2(target.p.x - c.x, target.p.z - c.z);
      } else if (c.mode === "climb" && this.arrived(c)) {
        // Tới gốc cây thì leo lên ngọn, ngồi đó một lúc.
        c.mode = "perch";
        c.timer = 7 + this.rand() * 6;
      } else if (c.mode === "perch") {
        if (c.timer <= 0) {
          c.altTarget = 0;
          c.mode = "return";
          this.pickWanderTarget(c);
        }
      } else if (c.mode === "chase" || c.mode === "follow" || (c.mode === "flee" && c.timer <= 0)) {
        c.mode = "return";
        c.altTarget = 0;
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
        c.mode === "chase"
          ? (def.chaseSpeed ?? def.speed * 2)
          : c.mode === "flee" || c.mode === "climb"
            ? Math.max(def.speed * 2.2, 2.5)
            : c.mode === "idle" || c.mode === "attack" || c.mode === "perch"
              ? 0
              : c.mode === "follow"
                ? def.speed * 1.4
                : def.speed;
      this.moveToward(c, speed * dt);
      this.settleAltitude(c, dt);
      if (c.mode === "chase" && foe && foe.dist3 <= 0.9 + 0.5 * def.size + 0.6) c.mode = "attack";
    }
    return bites;
  }

  private despawnIfLonely(c: SimCreature, prey: readonly Prey[], dt: number): boolean {
    const swimmerNear = prey.some((p) => p.alive && p.y < WATER_LEVEL - 0.5 && Math.hypot(p.x - c.x, p.z - c.z) < 60);
    c.lonely = swimmerNear ? 0 : c.lonely + dt;
    if (c.lonely < 20) return false;
    c.dead = true;
    return true;
  }

  private settleAltitude(c: SimCreature, dt: number) {
    c.alt += (c.altTarget - c.alt) * Math.min(1, dt * (c.mode === "perch" ? 1.2 : 2));
    c.y = this.heightFor(c.def, c.spawn, c.x, c.z, c.alt);
  }

  private measure(c: SimCreature, p: Prey) {
    const dist = Math.hypot(p.x - c.x, p.z - c.z);
    // Tính tới độ cao: dơi bay, cá bơi ở độ sâu khác người.
    const dy = p.y + 0.9 - c.y;
    return { p, dist, dist3: Math.hypot(dist, dy) };
  }

  private nearest(c: SimCreature, prey: readonly Prey[]) {
    const camp = this.camp();
    let best: ReturnType<Wildlife["measure"]> | null = null;
    for (const p of prey) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - camp.x, p.z - camp.z) < camp.radius) continue;
      const m = this.measure(c, p);
      if (!best || m.dist < best.dist) best = m;
    }
    return best;
  }

  /** Con vật chỉ theo người vào đúng loại địa hình của nó: cá mập không lên bờ, heo rừng không xuống biển, không leo cây. */
  private canReach(c: SimCreature, p: Prey): boolean {
    const hab = c.spawn.habitat;
    if (INSIDE.has(hab)) return this.world.structureAt(p.x, p.z)?.structure.id === c.spawn.structure;
    const ground = this.world.heightAt(p.x, p.z);
    if (WATER.has(hab)) return ground < -0.6 && p.y < WATER_LEVEL;
    if (this.world.structureAt(p.x, p.z)) return false;
    if (p.climbing && !c.def.abilities.includes("climb") && !c.def.fly) return false;
    const camp = this.camp();
    if (Math.hypot(p.x - camp.x, p.z - camp.z) < camp.radius) return false;
    return ground > 0.2 && (c.temp || Math.hypot(p.x - c.spawn.x, p.z - c.spawn.z) < c.spawn.range + LEASH);
  }

  private valid(c: SimCreature, x: number, z: number): boolean {
    const hab = c.spawn.habitat;
    if (INSIDE.has(hab)) return this.world.structureAt(x, z)?.structure.id === c.spawn.structure;
    if (Math.abs(x) > 235 || Math.abs(z) > 235) return false;
    const h = this.world.heightAt(x, z);
    if (WATER.has(hab)) return hab === "sea" ? h < -3 : h < -0.8;
    const camp = this.camp();
    if (Math.hypot(x - camp.x, z - camp.z) < camp.radius) return false;
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
        x = (c.temp ? c.x : s.x) + Math.cos(a) * r;
        z = (c.temp ? c.z : s.z) + Math.sin(a) * r;
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

  /** Bỏ chạy: con biết trèo thì chạy tới gốc cây gần nhất; con biết bay thì vút lên; con biết lặn thì lặn sâu. */
  private fleeFrom(c: SimCreature, p: { x: number; z: number }, seconds: number) {
    c.mode = "flee";
    c.timer = seconds;
    const a = Math.atan2(c.z - p.z, c.x - p.x) + (this.rand() - 0.5) * 0.8;
    c.targetX = c.x + Math.cos(a) * 20;
    c.targetZ = c.z + Math.sin(a) * 20;
    const abilities = c.def.abilities;
    if (abilities.includes("climb") && !c.spawn.structure && !WATER.has(c.spawn.habitat)) {
      let best: Perch | null = null;
      for (const t of this.perches()) {
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        if (d < 16 && (!best || d < Math.hypot(best.x - c.x, best.z - c.z))) best = t;
      }
      if (best) {
        c.mode = "climb";
        c.targetX = best.x;
        c.targetZ = best.z;
        c.altTarget = best.height * 0.8;
        return;
      }
    }
    if (abilities.includes("fly")) {
      const structure = c.spawn.structure && this.world.structures.find((s) => s.id === c.spawn.structure);
      c.altTarget = structure ? Math.max(0, structure.height - 0.6 - (c.def.fly ?? 0)) : 6 + this.rand() * 3;
    } else if (abilities.includes("dive") && WATER.has(c.spawn.habitat)) {
      // Lặn sát đáy (độ cao thêm âm).
      c.altTarget = -Math.max(0, c.y - this.world.heightAt(c.x, c.z) - 0.4);
    }
  }

  private arrived(c: SimCreature): boolean {
    return Math.hypot(c.targetX - c.x, c.targetZ - c.z) < 0.6;
  }

  private moveToward(c: SimCreature, step: number) {
    const dx = c.targetX - c.x;
    const dz = c.targetZ - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) c.rotY = Math.atan2(dx, dz);
    if (step <= 0 || dist < 0.05) return;
    const k = Math.min(1, step / dist);
    const nx = c.x + dx * k;
    const nz = c.z + dz * k;
    if (this.valid(c, nx, nz)) {
      c.x = nx;
      c.z = nz;
    } else if (c.mode === "flee" || c.mode === "walk" || c.mode === "return" || c.mode === "climb") {
      // Gặp bờ, vách hay mép vùng thì quay về phía nhà.
      c.targetX = c.spawn.x;
      c.targetZ = c.spawn.z;
      if (c.mode === "flee" || c.mode === "climb") {
        c.timer = 0;
        c.mode = "flee";
        c.altTarget = 0;
      }
      if (!this.valid(c, c.x, c.z)) {
        c.x = c.spawn.x;
        c.z = c.spawn.z;
      }
    }
  }

  /** Độ cao vẽ con vật: trên mặt đất, lơ lửng giữa hang (dơi), giữa làn nước (cá, sứa, rùa), cộng độ cao thêm. */
  private heightFor(def: Creature, spawn: CreatureSpawn, x: number, z: number, alt: number): number {
    const ground = this.world.heightAt(x, z);
    if (spawn.structure) {
      const s = this.world.structures.find((st) => st.id === spawn.structure);
      const floor = s?.floor ?? ground;
      return floor + (def.fly ?? 0) + alt;
    }
    if (WATER.has(spawn.habitat)) {
      const depth = WATER_LEVEL - ground;
      let y: number;
      if (def.model === "dolphin" || def.model === "shark") y = WATER_LEVEL - Math.min(1.6, depth * 0.3);
      else if (def.model === "jellyfish") y = WATER_LEVEL - Math.min(1.8, depth * 0.45);
      else y = ground + Math.min(0.5, depth * 0.3);
      return Math.max(ground + 0.3, y + alt);
    }
    return ground + (def.fly ?? 0) + alt;
  }
}

function halve(effects: EncounterEffects): EncounterEffects {
  const out: EncounterEffects = {};
  for (const [k, v] of Object.entries(effects) as [keyof EncounterEffects, number | string][]) {
    if (typeof v === "number") (out as Record<string, number>)[k] = Math.trunc(v / 2);
  }
  return out;
}
