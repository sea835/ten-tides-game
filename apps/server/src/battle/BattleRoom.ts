import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  ARMOR,
  FRAG,
  HEALS,
  HELMETS,
  KILL_REWARD,
  MAX_HP,
  MINE,
  SMOKE,
  SIGHT_IDS,
  START_MONEY,
  WEAPON,
  WEAPONS,
  battleMap,
  bulletAt,
  bulletSteps,
  battleSpawn,
  falloff,
  floorBelow,
  insideBox,
  makeRand,
  raycastBoxes,
  raycastTerrain,
  type BattleMap,
  type LootSpot,
} from "@tentides/content";
import {
  BattleBuyMessage,
  BATTLE_TIMES,
  BATTLE_WEATHERS,
  BattleSettingsMessage,
  BattleThrowMessage,
  CHAT_MIN_INTERVAL_MS,
  ChatMessage,
  FireMessage,
  GroundItemState,
  HealMessage,
  IslandState,
  JoinOptions,
  KICKED_CLOSE_CODE,
  KickMessage,
  KillState,
  MAX_PLAYERS,
  Messages,
  MoveMessage,
  PLAYER_COLORS,
  PickupMessage,
  PlayerState,
  ProjectileState,
  SmokeState,
  SwitchMessage,
  type BoomMessage,
  type ChatBroadcast,
  type CorrectMessage,
  type HitMessage,
  type HurtMessage,
  type KnockMessage,
  type ShotMessage,
} from "@tentides/protocol";
import { playerIdFromToken } from "../identity.ts";
import { isPlausibleMove } from "../movement.ts";
import { randomRoomCode } from "../roomCode.ts";
import { Bots } from "./bots.ts";
import { addAmmo, ammoOf, everything, isGunSlot, magOf, priceOf, receive, resetKit, setMag, weaponIn, type GunSlot } from "./kit.ts";

// Phòng Battleground: ai cũng xuất phát ở một chỗ ngẫu nhiên trên đảo, bấm B mua súng, giáp, lựu đạn bằng tiền
// khởi điểm, nhặt đồ trong nhà và kho vũ khí, vùng an toàn thu hẹp dần; người (hoặc máy) cuối cùng còn sống thắng.
// Client tự dò trúng (nhanh, khớp với những gì mình thấy); server kiểm tra lại mọi phát bắn: tốc độ bắn, còn đạn,
// đứng đúng chỗ, mục tiêu có thật ở đó, không có tường hay đồi chắn giữa, rồi mới tính sát thương.

const RECONNECT_SECONDS = 30;
const TICK_MS = 50;
/** Co giãn thời gian (vùng, pha chuẩn bị) khi dev, vd. BATTLE_SCALE=0.3. */
const SCALE = Number(process.env.BATTLE_SCALE ?? 1);
const PREP_SECONDS = 20;
/** Một ngày trôi hết trong chừng này giây (trận chừng 15–20 phút thì trời chuyển độ một buổi). */
const DAY_SECONDS = 60 * 60;
/** Thời tiết giữ ít nhất chừng này giây rồi mới có thể đổi. */
const WEATHER_MIN = 150;
const ENDED_SECONDS = 20;
const GRAVITY = 20;
const PICKUP_RADIUS = 3;

/** Các vòng thu hẹp: chờ bao lâu, thu trong bao lâu, bán kính mới so với bán kính cũ, máu mất mỗi giây ngoài vùng. */
const STAGES = [
  { wait: 60, shrink: 45, frac: 0.55, dps: 1 },
  { wait: 45, shrink: 35, frac: 0.55, dps: 2 },
  { wait: 40, shrink: 30, frac: 0.5, dps: 3 },
  { wait: 35, shrink: 25, frac: 0.5, dps: 5 },
  { wait: 30, shrink: 20, frac: 0.45, dps: 8 },
  { wait: 25, shrink: 20, frac: 0.4, dps: 12 },
  { wait: 20, shrink: 20, frac: 0, dps: 20 },
];

const sec = (s: number) => Math.max(1, s * SCALE);

interface AuthData {
  name: string;
  playerId: string;
}

interface Thrown {
  id: string;
  kind: "frag" | "smoke";
  owner: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  bounced: number;
}

interface Mine {
  x: number;
  y: number;
  z: number;
  owner: string;
  armIn: number;
  /** Đã bị giẫm: nổ sau chừng này giây. */
  fuse: number;
}

interface Timed {
  kind: "reload" | "heal";
  left: number;
  slot?: GunSlot;
  heal?: "bandage" | "medkit";
}

export class BattleRoom extends Room<{ state: IslandState }> {
  maxClients = MAX_PLAYERS + 2;
  state = new IslandState();
  map!: BattleMap;
  private sessions = new Map<string, string>();
  private kicked = new Set<string>();
  private lastMoveAt = new Map<string, number>();
  private lastShotAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  private timers = new Map<string, Timed>();
  private thrown: Thrown[] = [];
  private mines: Mine[] = [];
  private seq = 0;
  private phaseLeft = 0;
  private zoneLeft = 0;
  private zoneFrom = { x: 0, z: 0, r: 0 };
  private secondAcc = 0;
  /** Số người (và máy) lúc vào trận: đấu đơn một mình thì chỉ kết thúc khi mình gục. */
  private entrants = 0;
  private rand = Math.random;
  bots!: Bots;
  private weatherLeft = WEATHER_MIN;

  async onCreate() {
    this.roomId = await this.uniqueRoomCode();
    this.state.mode = "battle";
    this.state.phase = "lobby";
    this.setupMap((crypto.getRandomValues(new Uint32Array(1))[0]! % 0xfffffff) + 1);
    this.bots = new Bots(this);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p) return;
      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(id) ?? now);
      if (!p.alive || !isPlausibleMove(p, move, elapsed, this.map.world.heightAt)) {
        client.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
        return;
      }
      this.lastMoveAt.set(id, now);
      p.x = move.x;
      p.y = move.y;
      p.z = move.z;
      p.rotY = move.rotY;
      p.moving = move.moving;
      p.sitting = false;
      p.swimming = move.swimming ?? false;
      p.crouching = move.crouching ?? false;
      p.aiming = move.aiming ?? false;
      p.aimPitch = move.aimPitch ?? 0;
    });

    this.onMessage(Messages.start, (client) => {
      if (!this.hostOnly(client)) return;
      if (this.state.phase === "prep" || this.state.phase === "battle") return;
      this.startMatch();
    });

    this.onMessage(Messages.battleSettings, BattleSettingsMessage, (client, s) => {
      if (!this.hostOnly(client) || this.state.phase !== "lobby") return;
      if (s.bots !== undefined) this.state.bots = s.bots;
      if (s.weather !== undefined) this.state.weatherPick = s.weather;
      if (s.time !== undefined) this.state.timePick = s.time;
    });

    this.onMessage(Messages.settings, (client, raw: unknown) => {
      // Chủ phòng gieo lại bản đồ (đổi cây cối, đồ rơi, chỗ gài mìn).
      if (!this.hostOnly(client) || this.state.phase !== "lobby") return;
      const seed = (raw as { worldSeed?: unknown })?.worldSeed;
      if (typeof seed === "number" && Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff) this.setupMap(seed);
    });

    this.onMessage(Messages.kick, KickMessage, (client, { playerId }) => {
      if (!this.hostOnly(client) || playerId === this.playerOf(client)) return;
      this.kicked.add(playerId);
      this.clientOf(playerId)?.leave(KICKED_CLOSE_CODE);
    });

    this.onMessage(Messages.fire, FireMessage, (client, msg) => {
      const id = this.playerOf(client);
      if (id) this.fire(id, msg.weapon, msg.o, msg.rays, msg.hits);
    });

    this.onMessage(Messages.reload, (client) => {
      const id = this.playerOf(client);
      if (id) this.reload(id);
    });

    this.onMessage(Messages.switchSlot, SwitchMessage, (client, { slot }) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p || !p.alive) return;
      const kit = p.kit;
      if (isGunSlot(slot) && !kit[slot]) return;
      if ((slot === "frag" || slot === "smoke" || slot === "mine") && kit[slot] <= 0) return;
      kit.active = slot;
      this.cancelTimer(id);
    });

    this.onMessage(Messages.battleBuy, BattleBuyMessage, (client, { item }) => {
      const id = this.playerOf(client);
      if (id) this.buy(id, item, client);
    });

    this.onMessage(Messages.battleThrow, BattleThrowMessage, (client, msg) => {
      const id = this.playerOf(client);
      if (id) this.throwGrenade(id, msg.kind, msg.o, msg.v);
    });

    this.onMessage(Messages.placeMine, (client) => {
      const id = this.playerOf(client);
      if (id) this.placeMine(id);
    });

    this.onMessage(Messages.heal, HealMessage, (client, { kind }) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p || !p.alive || p.kit[kind] <= 0 || p.hp >= HEALS[kind].cap) return;
      this.cancelTimer(id);
      this.timers.set(id, { kind: "heal", left: HEALS[kind].seconds, heal: kind });
      p.kit.healing = kind;
    });

    this.onMessage(Messages.pickup, PickupMessage, (client, { id: itemKey }) => {
      const id = this.playerOf(client);
      if (id) this.pickup(id, itemKey);
    });

    this.onMessage(Messages.chat, ChatMessage, (client, { text }) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p) return;
      const now = Date.now();
      if (now - (this.lastChatAt.get(id) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      this.lastChatAt.set(id, now);
      this.broadcast(Messages.chat, { from: id, name: p.name, text, channel: "room" } satisfies ChatBroadcast);
    });

    this.clock.setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  onAuth(_client: Client, options: unknown): AuthData {
    const auth = JoinOptions.parse(options);
    const playerId = playerIdFromToken(auth.token);
    if (this.kicked.has(playerId)) throw new Error("Chủ phòng đã mời bạn ra khỏi phòng này.");
    const humans = [...this.state.players.values()].filter((p) => !p.bot).length;
    if (!this.state.players.has(playerId) && humans >= MAX_PLAYERS) throw new Error("Phòng đã đủ người.");
    return { name: auth.name, playerId };
  }

  onJoin(client: Client, _options: unknown, auth: AuthData) {
    const { playerId } = auth;
    const existing = this.state.players.get(playerId);
    if (existing) {
      const old = existing.sessionId;
      existing.sessionId = client.sessionId;
      existing.connected = true;
      this.sessions.delete(old);
      this.clients.find((c) => c.sessionId === old)?.leave();
    } else {
      const p = new PlayerState();
      p.name = auth.name;
      p.color = this.pickColor();
      p.sessionId = client.sessionId;
      p.created = true;
      // Vào giữa trận thì xem (đã gục); ở sảnh thì đi lại tự do.
      const midMatch = this.state.phase === "prep" || this.state.phase === "battle";
      this.placeAtSpawn(p);
      p.hp = midMatch ? 0 : MAX_HP;
      p.maxHp = MAX_HP;
      p.alive = !midMatch;
      resetKit(p.kit, START_MONEY);
      this.state.players.set(playerId, p);
    }
    this.sessions.set(client.sessionId, playerId);
    this.lastMoveAt.set(playerId, Date.now());
    if (!this.state.hostId || this.state.players.get(this.state.hostId)?.bot) this.state.hostId = playerId;
    this.sendMines(playerId);
  }

  async onDrop(client: Client) {
    const id = this.playerOf(client);
    if (!id || this.kicked.has(id)) return;
    const p = this.state.players.get(id);
    if (p && p.sessionId === client.sessionId) p.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const id = this.playerOf(client);
    const p = id && this.state.players.get(id);
    if (!id || !p) return;
    p.connected = true;
    this.lastMoveAt.set(id, Date.now());
    this.sendMines(id);
  }

  onLeave(client: Client) {
    const id = this.playerOf(client);
    this.sessions.delete(client.sessionId);
    const p = id && this.state.players.get(id);
    if (!id || !p || p.sessionId !== client.sessionId) return;
    if (this.state.phase === "lobby" || this.state.phase === "ended" || !p.alive) {
      this.state.players.delete(id);
    } else {
      // Bỏ đi giữa trận: gục tại chỗ, đồ rơi ra.
      this.kill(id, "", "", false);
      this.state.players.delete(id);
    }
    if (this.state.hostId === id) this.state.hostId = [...this.state.players.entries()].find(([, q]) => !q.bot && q.connected)?.[0] ?? "";
    this.updateAlive();
  }

  // -------------------------------------------------------------------------- trận đấu

  private setupMap(seed: number) {
    this.state.worldSeed = seed;
    this.map = battleMap(seed);
    this.rand = makeRand(seed ^ Date.now());
    for (const p of this.state.players.values()) this.placeAtSpawn(p);
  }

  private placeAtSpawn(p: PlayerState) {
    const others = [...this.state.players.values()].filter((q) => q !== p && q.alive).map((q) => ({ x: q.x, z: q.z }));
    const s = battleSpawn(this.map, this.rand, others);
    p.x = s.x;
    p.y = s.y + 0.05;
    p.z = s.z;
    p.rotY = this.rand() * Math.PI * 2;
    const client = this.clientOf(this.playerIdOf(p));
    client?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  private playerIdOf(p: PlayerState): string {
    for (const [id, q] of this.state.players) if (q === p) return id;
    return "";
  }

  private startMatch() {
    const s = this.state;
    // Dọn trận cũ.
    s.groundItems.clear();
    s.projectiles.clear();
    s.smokes.clear();
    s.feed.clear();
    this.thrown = [];
    this.mines = [];
    this.field = null;
    this.usedField.clear();
    this.timers.clear();
    this.bots.sync(s.bots);
    for (const [id, p] of s.players) {
      p.alive = true;
      p.hp = MAX_HP;
      p.maxHp = MAX_HP;
      p.kills = 0;
      p.crouching = p.aiming = false;
      const outfit = p.kit.outfit;
      resetKit(p.kit, START_MONEY);
      p.kit.outfit = outfit;
      this.placeAtSpawn(p);
      this.sendMines(id);
    }
    this.bots.equipAll();
    this.spawnLoot(this.map.loot);
    this.rollSky();
    // Vùng an toàn phủ cả đảo; vòng kế tiếp chọn khi vào trận.
    s.zone.x = s.zone.nx = 0;
    s.zone.z = s.zone.nz = 0;
    s.zone.r = s.zone.nr = 260;
    s.zone.stage = 0;
    s.zone.shrinking = false;
    s.zone.dps = 0;
    s.phase = "prep";
    this.phaseLeft = sec(PREP_SECONDS);
    s.phaseDuration = Math.ceil(this.phaseLeft);
    s.timeLeft = Math.ceil(this.phaseLeft);
    s.winner = "";
    this.entrants = s.players.size;
    this.updateAlive();
  }

  private beginBattle() {
    this.state.phase = "battle";
    this.nextZone();
  }

  private nextZone() {
    const z = this.state.zone;
    const stage = STAGES[z.stage];
    if (!stage) return;
    this.zoneFrom = { x: z.x, z: z.z, r: z.r };
    const nr = Math.max(0, z.r * stage.frac);
    // Tâm vòng mới nằm trong vòng cũ, ưu tiên trên đất liền.
    let best = { x: z.x, z: z.z };
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * Math.max(0, Math.min(z.r - nr, z.stage === 0 ? 90 : z.r - nr));
      const x = z.x + Math.cos(a) * d;
      const zz = z.z + Math.sin(a) * d;
      if (this.map.world.heightAt(x, zz) > 1) {
        best = { x, z: zz };
        break;
      }
    }
    z.nx = best.x;
    z.nz = best.z;
    z.nr = nr;
    z.shrinking = false;
    this.zoneLeft = sec(stage.wait);
    z.timeLeft = Math.ceil(this.zoneLeft);
  }

  private tickZone(dt: number) {
    const z = this.state.zone;
    const stage = STAGES[z.stage];
    if (!stage) return;
    this.zoneLeft -= dt;
    if (z.shrinking) {
      const total = sec(stage.shrink);
      const k = Math.min(1, 1 - this.zoneLeft / total);
      z.x = this.zoneFrom.x + (z.nx - this.zoneFrom.x) * k;
      z.z = this.zoneFrom.z + (z.nz - this.zoneFrom.z) * k;
      z.r = this.zoneFrom.r + (z.nr - this.zoneFrom.r) * k;
      if (this.zoneLeft <= 0) {
        z.stage += 1;
        if (STAGES[z.stage]) this.nextZone();
        else z.shrinking = false;
      }
    } else if (this.zoneLeft <= 0) {
      z.shrinking = true;
      z.dps = stage.dps;
      this.zoneLeft = sec(stage.shrink);
    }
    z.timeLeft = Math.max(0, Math.ceil(this.zoneLeft));
  }

  /** Bốc thăm thời tiết và giờ trong ngày cho trận (theo lựa chọn của chủ phòng nếu có). */
  private rollSky() {
    const s = this.state;
    const weighted = <T extends string>(table: [T, number][]): T => {
      let r = this.rand() * table.reduce((a, [, w]) => a + w, 0);
      for (const [v, w] of table) if ((r -= w) <= 0) return v;
      return table[0]![0];
    };
    s.weather = (BATTLE_WEATHERS as readonly string[]).includes(s.weatherPick)
      ? s.weatherPick
      : weighted([["sunny", 3], ["cloudy", 2], ["rain", 2], ["fog", 1.4], ["storm", 1.2], ["snow", 1.4]]);
    const time = (BATTLE_TIMES as readonly string[]).includes(s.timePick) ? s.timePick : weighted([["day", 5], ["dawn", 1.5], ["dusk", 1.5], ["night", 2]]);
    const base = time === "dawn" ? 0.1 : time === "dusk" ? 0.72 : time === "night" ? 0.88 : 0.25 + this.rand() * 0.3;
    s.clock = base + (time === "day" ? 0 : this.rand() * 0.04);
    this.weatherLeft = WEATHER_MIN + this.rand() * WEATHER_MIN;
  }

  /** Giữa trận thời tiết có thể chuyển (trời quang kéo mây rồi mưa, bão tan...), trời trôi dần theo giờ. */
  private tickSky(dt: number) {
    const s = this.state;
    s.clock = (s.clock + dt / DAY_SECONDS) % 1;
    if (s.weatherPick !== "random") return;
    this.weatherLeft -= dt;
    if (this.weatherLeft > 0) return;
    this.weatherLeft = WEATHER_MIN + this.rand() * WEATHER_MIN;
    const next: Record<string, string[]> = {
      sunny: ["cloudy", "sunny", "fog"],
      cloudy: ["rain", "sunny", "snow", "fog"],
      rain: ["storm", "cloudy", "rain"],
      storm: ["rain", "cloudy"],
      fog: ["cloudy", "sunny", "rain"],
      snow: ["snow", "cloudy", "fog"],
    };
    const list = next[s.weather] ?? ["sunny"];
    s.weather = list[Math.floor(this.rand() * list.length)]!;
  }

  private tick(dt: number) {
    const s = this.state;
    if (s.phase === "prep" || s.phase === "battle") this.tickSky(dt);
    this.secondAcc += dt;
    const second = this.secondAcc >= 1;
    if (second) this.secondAcc -= 1;

    if (s.phase === "prep" || s.phase === "ended") {
      this.phaseLeft -= dt;
      s.timeLeft = Math.max(0, Math.ceil(this.phaseLeft));
      if (this.phaseLeft <= 0) {
        if (s.phase === "prep") this.beginBattle();
        else this.backToLobby();
      }
    }
    if (s.phase === "battle") {
      this.tickZone(dt);
      if (second) this.zoneDamage();
    }
    this.tickTimers(dt);
    this.tickThrown(dt);
    this.tickMines(dt);
    for (const [key, smoke] of s.smokes) {
      smoke.timeLeft -= dt;
      if (smoke.timeLeft <= 0) s.smokes.delete(key);
    }
    this.bots.tick(dt);
  }

  private backToLobby() {
    const s = this.state;
    s.phase = "lobby";
    s.groundItems.clear();
    s.projectiles.clear();
    s.smokes.clear();
    this.mines = [];
    this.thrown = [];
    this.bots.sync(0);
    for (const p of s.players.values()) {
      p.alive = true;
      p.hp = MAX_HP;
      const outfit = p.kit.outfit;
      resetKit(p.kit, START_MONEY);
      p.kit.outfit = outfit;
    }
    this.updateAlive();
  }

  private zoneDamage() {
    const z = this.state.zone;
    if (z.dps <= 0) return;
    for (const [id, p] of this.state.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) this.damage(id, z.dps, "zone", "", "zone");
    }
  }

  // -------------------------------------------------------------------------- bắn

  /** Người bắn (hoặc máy) có ở trận không. */
  fighting(): boolean {
    return this.state.phase === "prep" || this.state.phase === "battle";
  }

  fire(id: string, weaponId: string, o: [number, number, number], rays: [number, number, number][], hits: { target: string; part: "head" | "body"; d: number; ray: number }[]) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    const kit = p.kit;
    const slot = kit.active;
    if (!isGunSlot(slot) || kit[slot] !== weaponId || kit.reloading) return;
    const def = WEAPON.get(weaponId);
    if (!def) return;
    const now = Date.now();
    if (now - (this.lastShotAt.get(id) ?? 0) < (60000 / def.rpm) * 0.8) return;
    const mag = magOf(kit, slot);
    if (mag <= 0) return;
    this.lastShotAt.set(id, now);
    setMag(kit, slot, mag - 1);
    p.shots = (p.shots + 1) % 65536;
    this.cancelHeal(id);
    // Gốc tia phải ở sát người bắn.
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 4 || o[1] < p.y - 1 || o[1] > p.y + 3) return;
    const maxRange = Math.min(600, def.range * 3);
    const dirs = rays.slice(0, def.pellets).map((r) => {
      const l = Math.hypot(r[0], r[1], r[2]) || 1;
      return [r[0] / l, r[1] / l, r[2] / l] as [number, number, number];
    });
    const ends: [number, number, number][] = [];
    // Đạn bay theo đường cong (rơi dần do trọng lực): dò tường từng đoạn dây cung; `walls` là quãng đường `s` tới chỗ găm.
    const steps = bulletSteps(def.velocity, maxRange);
    const walls = dirs.map((d) => {
      for (let i = 1; i < steps.length; i++) {
        const a = bulletAt(o, d, def.velocity, steps[i - 1]!);
        const b = bulletAt(o, d, def.velocity, steps[i]!);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
        const cd: [number, number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
        const t = Math.min(raycastBoxes(this.map.index, a, cd, len), raycastTerrain(this.map.world, a, cd, len));
        if (t < len) return steps[i - 1]! + (t / len) * (steps[i]! - steps[i - 1]!);
      }
      return maxRange;
    });
    const dealt = new Map<string, { amount: number; head: boolean; d: number }>();
    const hitRay = new Map<number, number>();
    for (const h of hits) {
      const d = dirs[h.ray];
      const target = this.state.players.get(h.target);
      if (!d || !target || !target.alive || h.target === id || hitRay.has(h.ray)) continue;
      if (h.d > walls[h.ray]! + 0.6 || h.d > maxRange) continue;
      const [px, py, pz] = bulletAt(o, d, def.velocity, h.d);
      const height = target.crouching ? 1.25 : 1.8;
      if (Math.hypot(px - target.x, pz - target.z) > 1.6 || py < target.y - 0.5 || py > target.y + height + 0.5) continue;
      const head = h.part === "head" && py > target.y + height - 0.55;
      hitRay.set(h.ray, h.d);
      const amount = def.damage * falloff(def, h.d) * (head ? def.headshot : 1);
      const prev = dealt.get(h.target);
      dealt.set(h.target, { amount: (prev?.amount ?? 0) + amount, head: (prev?.head ?? false) || head, d: h.d });
    }
    dirs.forEach((d, i) => {
      const t = hitRay.get(i) ?? walls[i]!;
      ends.push(bulletAt(o, d, def.velocity, t));
    });
    const shot: ShotMessage = { id, w: weaponId, o, e: ends };
    this.broadcast(Messages.shot, shot, { except: this.clientOf(id) });
    if (this.state.phase !== "battle") return;
    for (const [target, hit] of dealt) {
      const result = this.damage(target, hit.amount, hit.head ? "head" : "body", id, weaponId, [p.x, p.z]);
      if (result) this.clientOf(id)?.send(Messages.hit, { kind: result.killed ? "kill" : hit.head ? "head" : "body", armor: result.armor, amount: Math.round(result.amount) } satisfies HitMessage);
      this.bots.onHurt(target, id);
    }
  }

  reload(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    const kit = p.kit;
    const slot = kit.active;
    if (!isGunSlot(slot) || kit.reloading) return;
    const def = weaponIn(kit, slot);
    if (!def || magOf(kit, slot) >= def.mag || ammoOf(kit, def.ammo) <= 0) return;
    this.cancelTimer(id);
    kit.reloading = true;
    this.timers.set(id, { kind: "reload", left: def.reload, slot });
  }

  private cancelHeal(id: string) {
    const t = this.timers.get(id);
    if (t?.kind === "heal") this.cancelTimer(id);
  }

  private cancelTimer(id: string) {
    this.timers.delete(id);
    const p = this.state.players.get(id);
    if (p) {
      p.kit.reloading = false;
      p.kit.healing = "";
    }
  }

  private tickTimers(dt: number) {
    for (const [id, t] of this.timers) {
      t.left -= dt;
      if (t.left > 0) continue;
      this.timers.delete(id);
      const p = this.state.players.get(id);
      if (!p || !p.alive) continue;
      const kit = p.kit;
      if (t.kind === "reload" && t.slot) {
        kit.reloading = false;
        const def = weaponIn(kit, t.slot);
        if (!def || kit.active !== t.slot) continue;
        const need = def.mag - magOf(kit, t.slot);
        const take = Math.min(need, ammoOf(kit, def.ammo));
        kit.ammo.set(def.ammo, ammoOf(kit, def.ammo) - take);
        setMag(kit, t.slot, magOf(kit, t.slot) + take);
      } else if (t.kind === "heal" && t.heal) {
        kit.healing = "";
        const h = HEALS[t.heal];
        if (kit[t.heal] <= 0) continue;
        kit[t.heal] -= 1;
        p.hp = Math.min(Math.max(p.hp, Math.min(h.cap, p.hp + h.amount)), MAX_HP);
      }
    }
  }

  /**
   * Trừ máu (giáp, mũ chặn bớt). Trả về sát thương thật, có trúng giáp không, có hạ gục không.
   * `part`: head, body, blast (nổ: áo giáp chặn), zone (vùng độc: không gì chặn).
   */
  damage(id: string, raw: number, part: "head" | "body" | "blast" | "zone", attacker: string, weapon: string, from?: [number, number]) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return null;
    const kit = p.kit;
    let amount = raw;
    let armor = false;
    if (part === "head" && kit.helmet > 0) {
      const spec = HELMETS[kit.helmet - 1]!;
      const blocked = amount * spec.absorb;
      amount -= blocked;
      kit.helmetHp = Math.max(0, kit.helmetHp - Math.round(blocked * 1.5));
      if (kit.helmetHp <= 0) kit.helmet = 0;
      armor = true;
    } else if ((part === "body" || part === "blast") && kit.armor > 0) {
      const spec = ARMOR[kit.armor - 1]!;
      const blocked = amount * spec.absorb;
      amount -= blocked;
      kit.armorHp = Math.max(0, kit.armorHp - Math.round(blocked * 1.5));
      if (kit.armorHp <= 0) kit.armor = 0;
      armor = true;
    }
    p.hp = Math.max(0, p.hp - Math.max(1, Math.round(amount)));
    const hurt: HurtMessage = { x: from?.[0] ?? p.x, z: from?.[1] ?? p.z, amount: Math.round(amount), armor };
    this.clientOf(id)?.send(Messages.hurt, hurt);
    this.cancelHeal(id);
    const killed = p.hp <= 0;
    if (killed) this.kill(id, attacker, weapon, part === "head");
    return { amount, armor, killed };
  }

  kill(id: string, killer: string, weapon: string, headshot: boolean) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.moving = false;
    this.timers.delete(id);
    // Đồ rơi quanh chỗ gục.
    const items = everything(p.kit);
    this.dropAround(items, p.x, p.y, p.z);
    resetKit(p.kit, 0);
    const k = this.state.players.get(killer);
    if (k && killer !== id) {
      k.kills += 1;
      k.kit.money += KILL_REWARD;
    }
    const entry = new KillState();
    entry.killer = killer;
    entry.victim = id;
    entry.weapon = weapon;
    entry.headshot = headshot;
    entry.n = ++this.seq;
    this.state.feed.push(entry);
    while (this.state.feed.length > 6) this.state.feed.shift();
    this.updateAlive();
  }

  private updateAlive() {
    const s = this.state;
    const alive = [...s.players.entries()].filter(([, p]) => p.alive);
    s.aliveCount = alive.length;
    if (s.phase !== "battle" && s.phase !== "prep") return;
    const over = this.entrants >= 2 ? alive.length <= 1 : alive.length === 0;
    if (!over) return;
    s.winner = alive[0]?.[0] ?? "";
    s.phase = "ended";
    this.phaseLeft = sec(ENDED_SECONDS);
    s.phaseDuration = Math.ceil(this.phaseLeft);
    s.zone.dps = 0;
  }

  // -------------------------------------------------------------------------- đồ

  private buy(id: string, item: string, client: Client) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.state.phase === "ended") return;
    const price = priceOf(item);
    if (price === null) return this.reject(client, "Món này không bán.");
    if (p.kit.money < price) return this.reject(client, "Không đủ tiền.");
    const dropped: string[] = [];
    const weapon = WEAPON.get(item);
    if (!receive(p.kit, item, dropped)) return this.reject(client, item.startsWith("sight:") ? "Chưa có súng nào lắp được ống ngắm này." : "Không mang thêm được.");
    p.kit.money -= price;
    // Mua súng được tặng kèm một hộp đạn.
    if (weapon) addAmmo(p.kit, weapon.ammo, weapon.mag * 2);
    this.cancelTimer(id);
    this.dropAround(dropped, p.x, p.y, p.z);
  }

  private pickup(id: string, key: string) {
    const p = this.state.players.get(id);
    const item = this.state.groundItems.get(key);
    if (!p || !p.alive || !item) return;
    if (Math.hypot(item.x - p.x, item.z - p.z) > PICKUP_RADIUS || Math.abs(item.y - p.y) > 2.5) return;
    const dropped: string[] = [];
    if (!receive(p.kit, item.itemId, dropped)) return;
    this.state.groundItems.delete(key);
    this.cancelTimer(id);
    this.dropAround(dropped, p.x, p.y, p.z);
  }

  private dropAround(items: string[], x: number, y: number, z: number) {
    items.forEach((itemId, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2 + this.rand();
      const r = 0.6 + (i % 3) * 0.35;
      const gx = x + Math.cos(a) * r;
      const gz = z + Math.sin(a) * r;
      this.putItem(itemId, gx, floorBelow(this.map, gx, y + 1, gz), gz);
    });
  }

  private putItem(itemId: string, x: number, y: number, z: number) {
    const g = new GroundItemState();
    g.itemId = itemId;
    g.x = x;
    g.y = y;
    g.z = z;
    this.state.groundItems.set(`g${++this.seq}`, g);
  }

  private spawnLoot(spots: readonly LootSpot[]) {
    const pick = <T>(list: readonly T[]) => list[Math.floor(this.rand() * list.length)]!;
    const byTier = {
      1: WEAPONS.filter((w) => !w.rare && (w.class === "pistol" || w.class === "smg" || w.class === "shotgun")),
      2: WEAPONS.filter((w) => !w.rare && (w.class === "ar" || w.class === "dmr" || w.class === "smg")),
      3: WEAPONS.filter((w) => w.rare || w.class === "sniper"),
    };
    for (const spot of spots) {
      const extras: string[] = [];
      const roll = this.rand();
      if (roll < 0.55 || spot.tier === 3) {
        const w = pick(byTier[spot.tier]);
        extras.push(w.id, `ammo:${w.ammo}`);
      }
      const r2 = this.rand();
      if (spot.tier >= 2 && r2 < 0.4) extras.push(this.rand() < 0.5 ? `armor:${Math.min(3, spot.tier)}` : `helmet:${Math.min(3, spot.tier)}`);
      else if (r2 < 0.3) extras.push(this.rand() < 0.5 ? "armor:1" : "helmet:1");
      // Ống ngắm: chỗ thường ra kính phản xạ, 2x; chỗ khá tới 4x; kho vũ khí có 8x.
      const r4 = this.rand();
      if (r4 < (spot.tier === 1 ? 0.18 : spot.tier === 2 ? 0.3 : 0.6)) {
        const pool = spot.tier === 1 ? SIGHT_IDS.slice(0, 3) : spot.tier === 2 ? SIGHT_IDS.slice(0, 4) : SIGHT_IDS.slice(2);
        extras.push(`sight:${pick(pool)}`);
      }
      const r3 = this.rand();
      if (r3 < 0.25) extras.push(pick(["frag", "smoke", "bandage", "bandage", "medkit"]));
      if (this.rand() < 0.15) extras.push(`money:${100 * (1 + Math.floor(this.rand() * 5))}`);
      extras.forEach((itemId, i) => {
        const a = this.rand() * Math.PI * 2;
        const r = i === 0 ? 0 : 0.7;
        const x = spot.x + Math.cos(a) * r;
        const z = spot.z + Math.sin(a) * r;
        this.putItem(itemId, x, floorBelow(this.map, x, spot.y + 0.6, z), z);
      });
    }
  }

  // -------------------------------------------------------------------------- lựu đạn, khói, mìn

  throwGrenade(id: string, kind: "frag" | "smoke", o: [number, number, number], v: [number, number, number]) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.kit[kind] <= 0 || !this.fighting()) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 3 || Math.abs(o[1] - p.y - 1.4) > 1.5) return;
    const speed = Math.hypot(...v);
    const k = speed > 24 ? 24 / speed : 1;
    p.kit[kind] -= 1;
    if (p.kit[kind] <= 0 && p.kit.active === kind) p.kit.active = p.kit.primary1 ? "primary1" : p.kit.pistol ? "pistol" : "";
    p.act = "throw";
    p.actN = (p.actN + 1) % 65536;
    const g: Thrown = { id: `t${++this.seq}`, kind, owner: id, x: o[0], y: o[1], z: o[2], vx: v[0] * k, vy: v[1] * k, vz: v[2] * k, fuse: kind === "frag" ? FRAG.fuse : SMOKE.fuse, bounced: 0 };
    this.thrown.push(g);
    const ps = new ProjectileState();
    ps.itemId = kind;
    ps.x = g.x;
    ps.y = g.y;
    ps.z = g.z;
    this.state.projectiles.set(g.id, ps);
  }

  private tickThrown(dt: number) {
    const keep: Thrown[] = [];
    for (const g of this.thrown) {
      g.fuse -= dt;
      const steps = 3;
      for (let k = 0; k < steps; k++) {
        const h = dt / steps;
        g.vy -= GRAVITY * h;
        const nx = g.x + g.vx * h;
        const ny = g.y + g.vy * h;
        const nz = g.z + g.vz * h;
        if (insideBox(this.map.index, nx, ny, nz, 0.08)) {
          // Chạm tường, sàn: nảy ngược, mất đà.
          const ceil = insideBox(this.map.index, g.x, ny, g.z, 0.08);
          if (ceil) g.vy = -g.vy * 0.35;
          else {
            g.vx = -g.vx * 0.4;
            g.vz = -g.vz * 0.4;
          }
          g.vx *= 0.8;
          g.vz *= 0.8;
          g.bounced++;
          continue;
        }
        const ground = this.map.world.heightAt(nx, nz);
        if (ny < ground + 0.08) {
          g.x = nx;
          g.z = nz;
          g.y = ground + 0.08;
          g.vy = Math.abs(g.vy) * 0.3;
          g.vx *= 0.55;
          g.vz *= 0.55;
          if (g.vy < 1) g.vy = 0;
          g.bounced++;
          continue;
        }
        g.x = nx;
        g.y = ny;
        g.z = nz;
      }
      const ps = this.state.projectiles.get(g.id);
      if (ps) {
        ps.x = g.x;
        ps.y = g.y;
        ps.z = g.z;
      }
      if (g.fuse > 0) {
        keep.push(g);
        continue;
      }
      this.state.projectiles.delete(g.id);
      if (g.kind === "frag") this.explode(g.x, g.y, g.z, "frag", g.owner, FRAG.radius, FRAG.damage);
      else {
        const s = new SmokeState();
        s.x = g.x;
        s.y = g.y;
        s.z = g.z;
        s.timeLeft = SMOKE.seconds;
        this.state.smokes.set(g.id, s);
        this.broadcast(Messages.boom, { kind: "smoke", x: g.x, y: g.y, z: g.z } satisfies BoomMessage);
      }
    }
    this.thrown = keep;
  }

  explode(x: number, y: number, z: number, kind: "frag" | "mine", owner: string, radius: number, maxDamage: number) {
    this.broadcast(Messages.boom, { kind, x, y, z } satisfies BoomMessage);
    if (this.state.phase !== "battle") return;
    for (const [id, p] of this.state.players) {
      if (!p.alive) continue;
      const cx = p.x;
      const cy = p.y + (p.crouching ? 0.7 : 1.1);
      const cz = p.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > radius) continue;
      // Tường chắn thì an toàn.
      const dir: [number, number, number] = [(cx - x) / (d || 1), (cy - y) / (d || 1), (cz - z) / (d || 1)];
      if (d > 0.5 && raycastBoxes(this.map.index, [x, y + 0.3, z], dir, d - 0.3) < Infinity) continue;
      const k = Math.pow(1 - d / radius, 1.3);
      const dealt = this.damage(id, maxDamage * k, "blast", owner, kind, [x, z]);
      const knock: KnockMessage = { dx: dir[0], dz: dir[2], force: 14 * k };
      this.clientOf(id)?.send(Messages.knock, knock);
      if (dealt && owner && owner !== id) this.clientOf(owner)?.send(Messages.hit, { kind: dealt.killed ? "kill" : "body", armor: dealt.armor, amount: Math.round(dealt.amount) } satisfies HitMessage);
    }
  }

  private placeMine(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.kit.mine <= 0 || !this.fighting()) return;
    p.kit.mine -= 1;
    if (p.kit.mine <= 0 && p.kit.active === "mine") p.kit.active = p.kit.primary1 ? "primary1" : p.kit.pistol ? "pistol" : "";
    this.mines.push({ x: p.x, y: p.y, z: p.z, owner: id, armIn: MINE.arm, fuse: -1 });
    this.sendMines(id);
  }

  private sendMines(id: string) {
    const own = this.mines.filter((m) => m.owner === id && m.fuse < 0).map((m) => ({ x: m.x, y: m.y, z: m.z }));
    this.clientOf(id)?.send(Messages.myMines, own);
  }

  private tickMines(dt: number) {
    if (this.state.phase !== "battle") return;
    // Mìn của bãi mìn (chôn sẵn) và mìn người chơi gài.
    const fieldMines = this.fieldMines();
    const all = [...fieldMines, ...this.mines];
    const exploded = new Set<Mine>();
    for (const m of all) {
      if (m.armIn > 0) {
        m.armIn -= dt;
        continue;
      }
      if (m.fuse < 0) {
        for (const [id, p] of this.state.players) {
          if (!p.alive || id === m.owner) continue;
          if (Math.hypot(p.x - m.x, p.z - m.z) < MINE.trigger && Math.abs(p.y - m.y) < 1.2) {
            m.fuse = 0.35;
            this.broadcast(Messages.mineClick, { x: m.x, y: m.y, z: m.z });
            break;
          }
        }
        continue;
      }
      m.fuse -= dt;
      if (m.fuse <= 0) exploded.add(m);
    }
    for (const m of exploded) {
      this.explode(m.x, m.y + 0.2, m.z, "mine", m.owner, MINE.radius, MINE.damage);
      if (this.mines.includes(m)) {
        this.mines = this.mines.filter((x) => x !== m);
        this.sendMines(m.owner);
      } else this.usedField.add(m);
    }
  }

  private field: Mine[] | null = null;
  private usedField = new Set<Mine>();
  private fieldMines(): Mine[] {
    this.field ??= this.map.mines.map((m) => ({ x: m.x, y: this.map.world.heightAt(m.x, m.z), z: m.z, owner: "", armIn: 0, fuse: -1 }));
    return this.field.filter((m) => !this.usedField.has(m));
  }

  // -------------------------------------------------------------------------- tiện ích

  playerOf(client: Client): string | undefined {
    return this.sessions.get(client.sessionId);
  }

  clientOf(playerId: string): Client | undefined {
    const sessionId = this.state.players.get(playerId)?.sessionId;
    if (!sessionId) return undefined;
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private hostOnly(client: Client): boolean {
    if (this.playerOf(client) === this.state.hostId) return true;
    this.reject(client, "Chỉ chủ phòng mới làm được việc này.");
    return false;
  }

  private reject(client: Client, reason: string) {
    client.send(Messages.rejected, { reason });
  }

  pickColor(): string {
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]!;
  }

  newPlayer(): PlayerState {
    const p = new PlayerState();
    p.maxHp = MAX_HP;
    p.hp = MAX_HP;
    p.created = true;
    return p;
  }

  randomSpawn(p: PlayerState) {
    this.placeAtSpawn(p);
  }

  private async uniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomRoomCode();
      if (!(await matchMaker.getRoomById(code))) return code;
    }
    throw new Error("Không tạo được mã phòng mới");
  }
}

