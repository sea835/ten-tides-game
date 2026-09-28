import {
  CAMP,
  CLIMBABLE_GROWTH,
  GROW_SECONDS,
  TREE_KINDS,
  WATER_LEVEL,
  makeRand,
  subSeed,
  type HitStats,
  type StatusEffects,
  type TreeKind,
  type World,
} from "@tentides/content";

// Những thứ người chơi làm được bằng tay trên đảo, server giữ và làm trọng tài: đồ nằm dưới đất, đồ đang bay,
// hiệu ứng choáng / chóng mặt / mù, cây bị chặt và cây mới trồng, người đang leo cây, trại và nhà cửa.
// Mọi thay đổi balo, Máu, chỉ số vẫn đi qua engine luật (IslandRoom gọi dispatch), nên log ván phát lại được.

export interface GroundItem {
  itemId: string;
  x: number;
  y: number;
  z: number;
}

export interface Projectile {
  itemId: string;
  owner: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  hit: Omit<HitStats, "reach" | "cooldown"> & { breaks?: boolean };
}

export interface StandingTree {
  id: string;
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  height: number;
  /** Cây mới trồng: 0–1; cây của bản đồ: 1. */
  growth: number;
}

export interface Planted {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  growth: number;
}

export interface Building {
  kind: string;
  dx: number;
  dz: number;
  rot: number;
}

export interface Status {
  stun: number;
  dizzy: number;
  blind: number;
}

/** Thứ bị ném trúng: người hay thú. */
export interface Target {
  kind: "player" | "creature";
  id: string;
  x: number;
  y: number;
  z: number;
}

export type ProjectileEvent =
  | { kind: "hit"; projectile: Projectile; target: Target }
  | { kind: "land"; projectile: Projectile; x: number; y: number; z: number; water: boolean };

const GRAVITY = 20;
export const THROW_SPEED = 17;
/** Nhiều nhất chừng này món nằm dưới đất; quá thì món cũ nhất biến mất (sóng cuốn, thú tha đi). */
const MAX_GROUND_ITEMS = 150;
const HIT_RADIUS = 0.8;

export class Play {
  readonly ground = new Map<string, GroundItem>();
  readonly projectiles = new Map<string, Projectile>();
  readonly status = new Map<string, Status>();
  readonly cooldown = new Map<string, number>();
  /** Máu còn lại của cây đang bị chặt dở. */
  readonly treeHp = new Map<string, number>();
  readonly felled = new Set<string>();
  readonly planted = new Map<string, Planted>();
  readonly climbers = new Map<string, string>();
  readonly buildings = new Map<string, Building>();
  camp: { x: number; z: number; packed: boolean } = { x: CAMP.x, z: CAMP.z, packed: false };
  /** Món trên tay mỗi người: uid trong balo. */
  readonly held = new Map<string, string>();
  readonly rand: ReturnType<typeof makeRand>;
  private nextId = 1;
  private clock = 0;

  constructor(
    private readonly world: World,
    seed: number,
  ) {
    this.rand = makeRand(subSeed(seed, "play"));
  }

  id(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  now(): number {
    return this.clock;
  }

  // ------------------------------------------------------------------ đồ dưới đất

  /** Đặt một món xuống đất (dưới nước thì chìm xuống đáy). Trả về id. */
  place(itemId: string, x: number, z: number, y?: number): string {
    const ground = this.world.heightAt(x, z);
    const id = this.id("g");
    this.ground.set(id, { itemId, x, z, y: Math.max(ground, y ?? ground) });
    if (this.ground.size > MAX_GROUND_ITEMS) this.ground.delete(this.ground.keys().next().value!);
    return id;
  }

  /** Rải mấy món quanh một chỗ (thú chết, cây đổ). */
  scatter(items: readonly string[], x: number, z: number, radius = 1.2) {
    for (const itemId of items) {
      const a = this.rand() * Math.PI * 2;
      const r = radius * (0.4 + this.rand() * 0.6);
      this.place(itemId, x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }

  // ------------------------------------------------------------------ hiệu ứng

  statusOf(id: string): Status {
    let s = this.status.get(id);
    if (!s) {
      s = { stun: 0, dizzy: 0, blind: 0 };
      this.status.set(id, s);
    }
    return s;
  }

  applyStatus(id: string, effects: StatusEffects) {
    const s = this.statusOf(id);
    if (effects.stun) s.stun = Math.max(s.stun, effects.stun);
    if (effects.dizzy) s.dizzy = Math.max(s.dizzy, effects.dizzy);
    if (effects.blind) s.blind = Math.max(s.blind, effects.blind);
  }

  stunned(id: string): boolean {
    return (this.status.get(id)?.stun ?? 0) > 0;
  }

  /** Còn phải chờ hồi chiêu không; không thì đặt hồi chiêu mới. */
  ready(id: string, cooldown: number): boolean {
    if ((this.cooldown.get(id) ?? 0) > this.clock) return false;
    this.cooldown.set(id, this.clock + cooldown);
    return true;
  }

  // ------------------------------------------------------------------ cây

  /** Mọi cây đang đứng: cây của bản đồ chưa bị đốn và cây mới trồng. */
  standingTrees(): StandingTree[] {
    const out: StandingTree[] = [];
    for (const t of this.world.trees) {
      if (this.felled.has(t.id)) continue;
      out.push({ id: t.id, kind: t.kind, x: t.x, z: t.z, y: this.world.heightAt(t.x, t.z), height: t.height, growth: 1 });
    }
    for (const [id, p] of this.planted) {
      const full = p.kind === "palm" ? 7 : 5.5;
      out.push({ id, kind: p.kind, x: p.x, z: p.z, y: p.y, height: full * Math.max(0.15, p.growth), growth: p.growth });
    }
    return out;
  }

  tree(id: string): StandingTree | undefined {
    return this.standingTrees().find((t) => t.id === id);
  }

  climbable(t: StandingTree): boolean {
    return t.growth >= CLIMBABLE_GROWTH;
  }

  /**
   * Chặt một nhát. Hết máu thì cây đổ: trả về cây đó, gỗ và đồ rơi ra, cùng những người đang leo trên cây.
   */
  chop(treeId: string, power: number): { felled: StandingTree; drops: string[]; riders: string[] } | null {
    const t = this.tree(treeId);
    if (!t) return null;
    const full = TREE_KINDS[t.kind].hp * Math.max(0.2, t.growth);
    const hp = (this.treeHp.get(treeId) ?? full) - power;
    if (hp > 0) {
      this.treeHp.set(treeId, hp);
      return null;
    }
    this.treeHp.delete(treeId);
    if (this.planted.has(treeId)) this.planted.delete(treeId);
    else this.felled.add(treeId);
    const def = TREE_KINDS[t.kind];
    // Cây non chặt ra ít gỗ hơn.
    const wood = Math.max(1, Math.round(def.wood * t.growth));
    const drops = [...Array.from({ length: wood }, () => "wood"), ...def.drops.filter((d) => t.growth >= 0.9 && this.rand() < d.chance).map((d) => d.item)];
    const riders = [...this.climbers.entries()].filter(([, tree]) => tree === treeId).map(([pid]) => pid);
    for (const pid of riders) this.climbers.delete(pid);
    return { felled: t, drops, riders };
  }

  plant(kind: TreeKind, x: number, z: number): string {
    const id = this.id("n");
    this.planted.set(id, { kind, x, z, y: this.world.heightAt(x, z), growth: 0.05 });
    return id;
  }

  /** Chỗ trồng cây được: đất liền, không trong hang, không sát cây khác hay công trình. */
  canPlant(x: number, z: number): boolean {
    const h = this.world.heightAt(x, z);
    if (h < 0.5 || this.world.structureAt(x, z)) return false;
    if (this.standingTrees().some((t) => Math.hypot(t.x - x, t.z - z) < 2.5)) return false;
    if (Math.hypot(x - this.camp.x, z - this.camp.z) < 4) return false;
    return !this.buildingAt(x, z, 1);
  }

  // ------------------------------------------------------------------ trại và nhà

  buildingWorld(b: Building): { x: number; z: number } {
    return { x: this.camp.x + b.dx, z: this.camp.z + b.dz };
  }

  buildingAt(x: number, z: number, margin: number): boolean {
    for (const b of this.buildings.values()) {
      const at = this.buildingWorld(b);
      if (Math.hypot(at.x - x, at.z - z) < 2.4 + margin) return true;
    }
    return false;
  }

  /** Chỗ dựng lửa trại được: đất khô, bằng tương đối, không trong hang. */
  canCamp(x: number, z: number): boolean {
    const h = this.world.heightAt(x, z);
    if (h < 0.5 || this.world.structureAt(x, z)) return false;
    const around = [0, 1, 2, 3].map((k) => this.world.heightAt(x + Math.cos((k * Math.PI) / 2) * 4, z + Math.sin((k * Math.PI) / 2) * 4));
    return around.every((a) => a > 0.3 && Math.abs(a - h) < 2.5);
  }

  // ------------------------------------------------------------------ ném

  throw(owner: string, itemId: string, from: { x: number; y: number; z: number }, yaw: number, pitch: number, power: number, hit: Projectile["hit"]): string {
    const speed = THROW_SPEED * (0.55 + 0.45 * power);
    // Ném theo hướng nhìn, hất lên một chút cho có đường vòng cung.
    const up = Math.min(1.2, Math.max(-0.6, pitch + 0.25));
    const dx = -Math.sin(yaw) * Math.cos(up);
    const dz = -Math.cos(yaw) * Math.cos(up);
    const dy = Math.sin(up);
    const id = this.id("j");
    this.projectiles.set(id, { itemId, owner, x: from.x, y: from.y + 1.5, z: from.z, vx: dx * speed, vy: dy * speed, vz: dz * speed, age: 0, hit });
    return id;
  }

  /** Cho đồ đang bay đi tiếp; trả về các lần trúng người, thú, hoặc chạm đất. */
  stepProjectiles(dt: number, targets: readonly Target[]): ProjectileEvent[] {
    const events: ProjectileEvent[] = [];
    const sub = 4;
    for (const [id, p] of this.projectiles) {
      let done = false;
      for (let k = 0; k < sub && !done; k++) {
        const h = dt / sub;
        const inWater = p.y < WATER_LEVEL;
        // Dưới nước thì chậm hẳn.
        const drag = inWater ? 0.85 : 1;
        p.vx *= drag;
        p.vz *= drag;
        p.vy = inWater ? p.vy * 0.8 - 3 * h : p.vy - GRAVITY * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.z += p.vz * h;
        p.age += h;
        for (const t of targets) {
          if (t.kind === "player" && t.id === p.owner && p.age < 0.4) continue;
          const cy = t.y + (t.kind === "player" ? 1 : 0.4);
          if (Math.hypot(t.x - p.x, cy - p.y, t.z - p.z) < HIT_RADIUS + (t.kind === "player" ? 0.3 : 0)) {
            events.push({ kind: "hit", projectile: p, target: t });
            done = true;
            break;
          }
        }
        if (done) break;
        const ground = this.world.heightAt(p.x, p.z);
        if (p.y <= ground + 0.05 || Math.abs(p.x) > 238 || Math.abs(p.z) > 238 || p.age > 6) {
          events.push({ kind: "land", projectile: p, x: p.x, y: ground, z: p.z, water: ground < WATER_LEVEL });
          done = true;
        }
      }
      if (done) this.projectiles.delete(id);
    }
    return events;
  }

  // ------------------------------------------------------------------ nhịp thời gian

  /** Hiệu ứng hết dần, cây non lớn dần. */
  tick(dt: number) {
    this.clock += dt;
    for (const s of this.status.values()) {
      s.stun = Math.max(0, s.stun - dt);
      s.dizzy = Math.max(0, s.dizzy - dt);
      s.blind = Math.max(0, s.blind - dt);
    }
    for (const p of this.planted.values()) p.growth = Math.min(1, p.growth + dt / GROW_SECONDS);
  }
}

/**
 * Tìm thứ bị đánh trúng: gần nhất trong tầm với, ở phía trước mặt (lệch không quá 65°).
 * `ranged`: bắn theo đường ngắm (`pitch` dương là ngắm lên), trúng thứ đầu tiên nằm sát đường đạn.
 */
export function pickTarget(
  from: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  reach: number,
  targets: readonly Target[],
  ranged = false,
): Target | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best: Target | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const ty = t.y + (t.kind === "player" ? 1 : 0.4);
    const dy = ty - (from.y + 1.4);
    if (ranged) {
      // `pitch` là góc ngắm (dương là ngắm lên), client suy ra từ góc camera.
      const dir = [fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch)];
      // Chiếu lên đường ngắm, rồi đo khoảng cách vuông góc.
      const along = dx * dir[0]! + dy * dir[1]! + dz * dir[2]!;
      if (along < 0 || along > reach) continue;
      const px = dx - dir[0]! * along;
      const py = dy - dir[1]! * along;
      const pz = dz - dir[2]! * along;
      const off = Math.hypot(px, py, pz);
      if (off > 0.9 + along * 0.02) continue;
      if (along < bestScore) {
        best = t;
        bestScore = along;
      }
      continue;
    }
    const dist = Math.hypot(dx, dz);
    if (dist > reach + 0.5 || Math.abs(dy) > 2.2) continue;
    const facing = dist < 0.6 ? 1 : (dx * fx + dz * fz) / dist;
    if (facing < Math.cos((65 * Math.PI) / 180)) continue;
    const score = dist - facing;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}
