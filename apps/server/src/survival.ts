import {
  BOMB_FLIGHT,
  BOMB_RADIUS,
  CAMP_RADIUS,
  CRATER_BURN,
  CRATER_BURN_INTERVAL,
  CRATER_RADIUS,
  CRATER_SECONDS,
  FLOW_BURN,
  FLOW_BURN_INTERVAL,
  HOT_SPRING,
  SPRING_BURN,
  SPRING_BURN_INTERVAL,
  TIDE_AMPLITUDE,
  TIDE_MEAN,
  VOLCANO,
  WATER_LEVEL,
  bombDamage,
  bombInterval,
  dayTime,
  flowProgress,
  lavaFlows,
  makeRand,
  onLavaFlow,
  quakeInterval,
  seaLevel,
  springBoiling,
  subSeed,
  tideRising,
  volcanoStage,
  type TideClock,
  type World,
} from "@tentides/content";
import type { VolcanoMessage } from "@tentides/protocol";
import type { EncounterEffects } from "@tentides/rules";

// Đảo sinh tồn biến động theo giờ và theo ngày (server là nguồn sự thật):
// - thủy triều: mực nước biển suy ra từ đồng hồ pha (xem tide.ts), dùng cho hơi thở, đuối nước, đồ ném rơi xuống nước,
//   cá mập; triều cường ngập bãi cát thì sóng cuốn người còn lội ở đó;
// - núi lửa leo thang theo mức núi lửa (xem volcano.ts): động đất, suối sôi, bom nham thạch, hố lửa, dòng dung nham.
// Hệ quả trả về dạng sự kiện để phòng chơi đưa vào engine luật (encounter) và báo cho mọi người.

/** Một người trên đảo, theo vị trí trong state. */
export interface Wader {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export type SurvivalEvent =
  | {
      kind: "hurt";
      playerId: string;
      /** Id mối nguy (lava_bomb, lava_flow, lava_crater, hot_spring, flood_tide) để kể chuyện. */
      defId: string;
      source: "volcanic" | "drowning";
      effects: EncounterEffects;
      title: string;
      text: string;
      /** Chữ hiện lên tại chỗ và cú hất văng (nếu có). */
      word: string;
      knock?: { dx: number; dz: number; force: number };
    }
  | { kind: "volcano"; message: VolcanoMessage };

interface Bomb {
  id: string;
  x: number;
  y: number;
  z: number;
  left: number;
}

interface Crater {
  id: string;
  x: number;
  y: number;
  z: number;
  left: number;
}

/** Triều cường lên quá mức trung bình chừng này thì sóng bắt đầu cuốn người lội trên bãi. */
const FLOOD_ABOVE_MEAN = TIDE_AMPLITUDE * 0.45;
const FLOOD_INTERVAL = 5;
const FLOOD_EFFECTS: EncounterEffects = { hp: -4, morale: -2 };
/** Bom không rơi vào trại (vùng an toàn để còn đường về) và chỉ nhắm người cách trại xa hơn chừng này. */
const BOMB_CAMP_CLEAR = CAMP_RADIUS + 4;

export class Survival {
  /** Mực nước biển lúc này (cập nhật mỗi nhịp). */
  sea = WATER_LEVEL;
  private rand: ReturnType<typeof makeRand>;
  private bombs = new Map<string, Bomb>();
  private craters: Crater[] = [];
  private timers = new Map<string, number>();
  private nextBomb = 6;
  private nextQuake = 10;
  private bombCount = 0;

  constructor(
    private world: World,
    seed: number,
  ) {
    this.rand = makeRand(subSeed(seed, "eruption"));
  }

  reset(world: World, seed: number) {
    this.world = world;
    this.rand = makeRand(subSeed(seed, "eruption"));
    this.bombs.clear();
    this.craters = [];
    this.timers.clear();
  }

  /** Mực nước lúc này của phòng (đồng hồ pha trong state). */
  updateSea(clock: TideClock) {
    this.sea = seaLevel(clock);
  }

  /**
   * Một nhịp thời gian thực. `active`: đang trong giờ đi lại (bình minh, khám phá, hoàng hôn) — chỉ khi đó mới có
   * sát thương. `camp`: lửa trại hiện tại (bom không rơi vào trại).
   */
  step(dt: number, clock: TideClock & { volcano: number; day: number }, people: readonly Wader[], active: boolean, camp: { x: number; z: number }): SurvivalEvent[] {
    this.updateSea(clock);
    const events: SurvivalEvent[] = [];
    const level = clock.volcano;
    const stage = volcanoStage(level);
    const inPlay = clock.mode === "story" && ["dawn", "explore", "dusk", "night"].includes(clock.phase);

    // Động đất: ngày 5 trở đi, cả ban đêm (mặt đất rung dưới đống lửa).
    const [qMin, qMax] = quakeInterval(level);
    if (inPlay && Number.isFinite(qMin)) {
      this.nextQuake -= dt;
      if (this.nextQuake <= 0) {
        this.nextQuake = qMin + this.rand() * (qMax - qMin);
        events.push({ kind: "volcano", message: { kind: "quake", duration: stage === 3 ? 3.2 : 2.4, strength: stage === 3 ? 1 : 0.6 } });
      }
    }

    // Bom nham thạch: chỉ khi phun trào và đang trong giờ đi lại.
    if (active && inPlay && stage === 3) {
      this.nextBomb -= dt;
      if (this.nextBomb <= 0) {
        this.nextBomb = bombInterval(level) * (0.7 + this.rand() * 0.6);
        const bomb = this.launch(people.filter((p) => p.alive), camp);
        if (bomb) {
          this.bombs.set(bomb.id, bomb);
          events.push({ kind: "volcano", message: { kind: "bomb", id: bomb.id, x: bomb.x, y: bomb.y, z: bomb.z, flight: BOMB_FLIGHT } });
        }
      }
    }
    for (const bomb of [...this.bombs.values()]) {
      bomb.left -= dt;
      if (bomb.left > 0) continue;
      this.bombs.delete(bomb.id);
      this.craters.push({ id: bomb.id, x: bomb.x, y: bomb.y, z: bomb.z, left: CRATER_SECONDS });
      events.push({ kind: "volcano", message: { kind: "land", id: bomb.id, x: bomb.x, y: bomb.y, z: bomb.z, seconds: CRATER_SECONDS } });
      if (!active) continue;
      for (const p of people) {
        if (!p.alive || Math.abs(p.y - bomb.y) > 4) continue;
        const d = Math.hypot(p.x - bomb.x, p.z - bomb.z);
        const damage = bombDamage(d);
        if (damage <= 0) continue;
        const len = d || 1;
        events.push({
          kind: "hurt",
          playerId: p.id,
          defId: "lava_bomb",
          source: "volcanic",
          effects: { hp: -damage, morale: -3 },
          title: "Bom nham thạch!",
          text: "Một khối đá nóng đỏ từ miệng núi rơi sầm xuống ngay cạnh bạn, đá vụn và lửa văng tung tóe.",
          word: "ẦM!",
          knock: { dx: (p.x - bomb.x) / len || 1, dz: (p.z - bomb.z) / len, force: 9 * (1 - d / BOMB_RADIUS) + 4 },
        });
      }
    }
    for (const c of this.craters) c.left -= dt;
    this.craters = this.craters.filter((c) => c.left > 0);

    if (!active || !inPlay) return events;
    const flows = lavaFlows(this.world, clock.day, level);
    const progress = flowProgress(dayTime(clock.phase, clock.timeLeft, clock.phaseDuration));
    const boiling = springBoiling(level);
    const rising = tideRising(clock);
    for (const p of people) {
      if (!p.alive) continue;
      const ground = this.world.heightAt(p.x, p.z);
      const onGround = p.y - ground < 1;
      // Dòng dung nham: lội vào là bỏng nặng.
      if (flows.length > 0 && onGround && onLavaFlow(flows, p.x, p.z, progress)) {
        if (this.every(`flow:${p.id}`, dt, FLOW_BURN_INTERVAL)) {
          events.push({ kind: "hurt", playerId: p.id, defId: "lava_flow", source: "volcanic", effects: { hp: -FLOW_BURN }, title: "Dòng dung nham!", text: "Dung nham đặc quánh bám lấy chân bạn. Mau ra khỏi dòng chảy!", word: "XÈÈO!" });
        }
      } else this.timers.delete(`flow:${p.id}`);
      // Hố lửa bom để lại.
      if (onGround && this.craters.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < CRATER_RADIUS)) {
        if (this.every(`crater:${p.id}`, dt, CRATER_BURN_INTERVAL)) {
          events.push({ kind: "hurt", playerId: p.id, defId: "lava_crater", source: "volcanic", effects: { hp: -CRATER_BURN }, title: "Hố lửa", text: "Đáy hố bom vẫn còn đỏ rực, đế giày bạn bốc khói.", word: "NÓNG!" });
        }
      } else this.timers.delete(`crater:${p.id}`);
      // Suối nước nóng sôi sục từ ngày 5: ngâm mình là bỏng.
      if (boiling && p.y - ground < 1.2 && Math.hypot(p.x - HOT_SPRING.x, p.z - HOT_SPRING.z) < HOT_SPRING.radius) {
        if (this.every(`spring:${p.id}`, dt, SPRING_BURN_INTERVAL)) {
          events.push({ kind: "hurt", playerId: p.id, defId: "hot_spring", source: "volcanic", effects: { hp: -SPRING_BURN }, title: "Suối sôi sục", text: "Nước suối giờ sôi ùng ục, bốc mùi lưu huỳnh. Da bạn đỏ rát.", word: "BỎNG!" });
        }
      } else this.timers.delete(`spring:${p.id}`);
      // Triều cường đang lên ngập bãi cát (chỗ bình thường khô ráo): sóng cuốn người còn lội ở đó.
      const flooded = this.sea > TIDE_MEAN + FLOOD_ABOVE_MEAN && rising && ground > TIDE_MEAN && this.sea - ground > 0.4 && p.y < this.sea;
      if (flooded) {
        if (this.every(`flood:${p.id}`, dt, FLOOD_INTERVAL)) {
          // Sóng đánh vào bờ: hất người về phía đất liền (dốc lên).
          const gx = this.world.heightAt(p.x + 2, p.z) - this.world.heightAt(p.x - 2, p.z);
          const gz = this.world.heightAt(p.x, p.z + 2) - this.world.heightAt(p.x, p.z - 2);
          const g = Math.hypot(gx, gz) || 1;
          events.push({
            kind: "hurt",
            playerId: p.id,
            defId: "flood_tide",
            source: "drowning",
            effects: FLOOD_EFFECTS,
            title: "Triều cường",
            text: "Nước dâng ngập bãi, từng con sóng xô bạn ngã dúi dụi. Lên chỗ cao mau!",
            word: "ÀO!",
            knock: { dx: gx / g, dz: gz / g, force: 5 },
          });
        }
      } else this.timers.delete(`flood:${p.id}`);
    }
    return events;
  }

  /** Bom đang bay và hố lửa còn cháy (cho người vào lại giữa chừng thấy). */
  snapshot(): VolcanoMessage[] {
    return [
      ...[...this.bombs.values()].map((b) => ({ kind: "bomb" as const, id: b.id, x: b.x, y: b.y, z: b.z, flight: b.left })),
      ...this.craters.map((c) => ({ kind: "land" as const, id: c.id, x: c.x, y: c.y, z: c.z, seconds: c.left })),
    ];
  }

  /** Nhịp đều: lần đầu chạm là có ngay, rồi cứ `interval` giây một lần. */
  private every(key: string, dt: number, interval: number): boolean {
    const t = (this.timers.get(key) ?? interval) + dt;
    if (t >= interval) {
      this.timers.set(key, 0);
      return true;
    }
    this.timers.set(key, t);
    return false;
  }

  /** Chọn chỗ bom rơi: phần nhiều nhắm quanh một người ngoài trại (cách vài mét), còn lại rơi bừa quanh sườn núi. */
  private launch(alive: readonly Wader[], camp: { x: number; z: number }): Bomb | null {
    const outside = alive.filter((p) => Math.hypot(p.x - camp.x, p.z - camp.z) > BOMB_CAMP_CLEAR);
    for (let attempt = 0; attempt < 8; attempt++) {
      let x: number;
      let z: number;
      if (outside.length > 0 && this.rand() < 0.65) {
        const target = outside[Math.floor(this.rand() * outside.length)]!;
        const a = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 12;
        x = target.x + Math.cos(a) * r;
        z = target.z + Math.sin(a) * r;
      } else {
        const a = this.rand() * Math.PI * 2;
        const r = VOLCANO.craterRadius + 4 + this.rand() * VOLCANO.radius * 1.4;
        x = VOLCANO.x + Math.cos(a) * r;
        z = VOLCANO.z + Math.sin(a) * r;
      }
      const y = this.world.heightAt(x, z);
      if (y < this.sea + 0.2 || this.world.structureAt(x, z) || Math.hypot(x - camp.x, z - camp.z) < BOMB_CAMP_CLEAR) continue;
      return { id: `b${++this.bombCount}`, x, y, z, left: BOMB_FLIGHT };
    }
    return null;
  }
}
