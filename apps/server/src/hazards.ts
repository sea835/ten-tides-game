import { CAMP, CAMP_RADIUS, FIRE_RADIUS, LAVA, WATER_LEVEL, makeRand, subSeed, trapDodgeChance, worldCatalog, type Trap, type World, type WorldCatalog } from "@tentides/content";
import type { EncounterEffects, StatId } from "@tentides/rules";

// Nguy hiểm của môi trường, server tính theo vị trí người chơi: hết hơi khi lặn, giẫm phải bẫy,
// bước vào đống lửa trại, rơi xuống hồ dung nham trong miệng núi lửa.
// Kết quả đi vào engine luật qua hành động `encounter` (có seed nên phát lại được).

/** Đầu cách chân chừng này mét: đầu dưới mặt nước là đang lặn, tốn hơi. */
export const HEAD_HEIGHT = 1.5;
/** Hồi hơi mỗi giây khi đầu trên mặt nước. */
const BREATH_REFILL = 35;
/** Hết hơi thì cứ chừng này giây lại mất Máu: đủ nhanh để lặn quá sâu là chết đuối thật. */
const DROWN_INTERVAL = 1.5;
export const DROWN_EFFECTS: EncounterEffects = { hp: -10, morale: -3 };
/** Đứng trong đống lửa: cứ chừng này giây lại bỏng một lần. */
const BURN_INTERVAL = 0.8;
export const BURN_EFFECTS: EncounterEffects = { hp: -10, morale: -3 };
/** Chân chạm tới mặt hồ dung nham (tính từ đáy miệng núi) là rơi vào. */
const LAVA_DEPTH = 1.4;

/** Số giây nín thở được: Thể lực càng cao càng lâu; thủy thủ già lâu hơn hẳn. */
export function breathSeconds(strength: number, background: string): number {
  return (18 + 3 * strength) * (background === "old_sailor" ? 1.6 : 1);
}

export interface Diver {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  strength: number;
  background: string;
  stats: Partial<Record<StatId, number>>;
}

/** Lửa trại hiện tại (dời trại được, đang vác đi thì không có lửa). */
export interface Fire {
  x: number;
  z: number;
  lit: boolean;
}

export interface HazardEvent {
  kind: "drowning" | "trap" | "lava" | "burn";
  playerId: string;
  trap?: Trap;
  dodged?: boolean;
  effects: EncounterEffects;
}

export class Hazards {
  /** Hơi thở của từng người (0–100). */
  readonly breath = new Map<string, number>();
  private readonly drownTimer = new Map<string, number>();
  private readonly burnTimer = new Map<string, number>();
  private readonly lavaY: number;
  private readonly sprung = new Set<string>();
  private readonly rand: ReturnType<typeof makeRand>;

  constructor(
    private readonly world: World,
    readonly traps: readonly Trap[],
    secretSeed: number,
    private readonly catalog: WorldCatalog = worldCatalog,
  ) {
    this.rand = makeRand(subSeed(secretSeed, "dodge"));
    this.lavaY = world.heightAt(LAVA.x, LAVA.z);
  }

  isSprung(trapId: string): boolean {
    return this.sprung.has(trapId);
  }

  /**
   * `active`: đang trong giờ đi lại trên đảo (ban đêm và lúc chuẩn bị không có nguy hiểm).
   * `sea`: mực nước biển lúc này (thủy triều, xem tide.ts).
   */
  step(dt: number, divers: readonly Diver[], active: boolean, fire?: Fire, sea = WATER_LEVEL): HazardEvent[] {
    const events: HazardEvent[] = [];
    for (const d of divers) {
      if (active && d.alive) {
        // Nhảy xuống hồ dung nham: chết ngay.
        if (Math.hypot(d.x - LAVA.x, d.z - LAVA.z) < LAVA.radius && d.y < this.lavaY + LAVA_DEPTH) {
          events.push({ kind: "lava", playerId: d.id, effects: { hp: -100 } });
          continue;
        }
        // Đứng trong đống lửa trại: bỏng từng nhịp (nhịp đầu tiên ngay khi bước vào).
        const ground = this.world.heightAt(d.x, d.z);
        if (fire?.lit && Math.hypot(d.x - fire.x, d.z - fire.z) < FIRE_RADIUS && d.y - ground < 1.2) {
          const t = (this.burnTimer.get(d.id) ?? BURN_INTERVAL) + dt;
          if (t >= BURN_INTERVAL) {
            events.push({ kind: "burn", playerId: d.id, effects: BURN_EFFECTS });
            this.burnTimer.set(d.id, 0);
          } else this.burnTimer.set(d.id, t);
        } else this.burnTimer.delete(d.id);
      }
      let breath = this.breath.get(d.id) ?? 100;
      const underwater = active && d.alive && d.y + HEAD_HEIGHT < sea - 0.05 && !this.world.structureAt(d.x, d.z);
      if (underwater) {
        breath = Math.max(0, breath - (100 / breathSeconds(d.strength, d.background)) * dt);
        if (breath === 0) {
          const t = (this.drownTimer.get(d.id) ?? 0) + dt;
          if (t >= DROWN_INTERVAL) {
            events.push({ kind: "drowning", playerId: d.id, effects: DROWN_EFFECTS });
            this.drownTimer.set(d.id, 0);
          } else this.drownTimer.set(d.id, t);
        }
      } else {
        breath = Math.min(100, breath + BREATH_REFILL * dt);
        this.drownTimer.delete(d.id);
      }
      this.breath.set(d.id, breath);

      if (!active || !d.alive || Math.hypot(d.x - CAMP.x, d.z - CAMP.z) < CAMP_RADIUS) continue;
      for (const trap of this.traps) {
        if (this.sprung.has(trap.id)) continue;
        if (Math.hypot(d.x - trap.x, d.z - trap.z) > trap.radius) continue;
        // Bẫy dưới nước (nhím biển) chỉ đâm người chạm đáy; bẫy trên cạn thì người phải đứng trên mặt đất.
        if (d.y - trap.y > 1.2 || trap.y - d.y > 1.5) continue;
        const def = this.catalog.traps.get(trap.defId);
        if (!def) continue;
        this.sprung.add(trap.id);
        const dodged = this.rand() < trapDodgeChance(d.stats, def.dodge);
        events.push({ kind: "trap", playerId: d.id, trap, dodged, effects: def.effects });
        break;
      }
    }
    return events;
  }
}
