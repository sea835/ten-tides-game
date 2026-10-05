import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  ARMOR,
  FLASH,
  FRAG,
  MELEE,
  HEALS,
  HELMETS,
  KILL_REWARD,
  MAX_HP,
  MINE,
  SMOKE,
  SMOKE_CLEAR,
  ATTACHMENTS,
  ATTACHMENT_IDS,
  SIGHT_IDS,
  START_MONEY,
  WEAPON,
  WEAPONS,
  mapForMode,
  bulletAt,
  bulletSteps,
  battleSpawn,
  checkBodyPoint,
  falloff,
  rayVehicle,
  type WeaponDef,
  SQUAD_BOTS,
  floorBelow,
  HITBOX,
  insideBox,
  makeRand,
  raycastBoxes,
  raycastTerrain,
  raycastTrunksHit,
  bulletThrough,
  bulletWallFactor,
  caliberOf,
  ricochet,
  RICOCHET,
  withDestruction,
  type BattleMap,
  type LootSpot,
} from "@tentides/content";
import {
  BattleBuyMessage,
  BATTLE_TIMES,
  BATTLE_WEATHERS,
  BattleSettingsMessage,
  BattleThrowMessage,
  MeleeMessage,
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
  PossessMessage,
  PickSideMessage,
  RespawnMessage,
  SquadOrderMessage,
  TankFireMessage,
  VehicleMoveMessage,
  VehicleSeatMessage,
  VehicleAimMessage,
  VehicleGunMessage,
  MAX_BATTLE_BOTS,
  type BoomMessage,
  type ChatBroadcast,
  type CorrectMessage,
  type HitMessage,
  type HurtMessage,
  type KnockMessage,
  type ShotMessage,
} from "@tentides/protocol";
import { applySkins, resolveIdentity } from "../account.ts";
import { isPlausibleMove } from "../movement.ts";
import { randomRoomCode } from "../roomCode.ts";
import { Airdrops } from "./airdrops.ts";
import { Destruction } from "./destruction.ts";
import { Bots } from "./bots.ts";
import { MatchRewards } from "./rewards.ts";
import { Vehicles } from "./vehicles.ts";
import { War, type Side } from "./war.ts";
import { addAmmo, ammoOf, attOf, copyKit, everything, isGunSlot, magOf, magSize, priceOf, receive, reloadStep, reloadTime, resetKit, setMag, weaponIn, type GunSlot } from "./kit.ts";

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
  /** Skin súng đang lắp (người có tài khoản). */
  skins: Record<string, string>;
}

interface Thrown {
  id: string;
  kind: "frag" | "smoke" | "flash";
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
  private lastMeleeAt = new Map<string, number>();
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
  /** Thưởng xu sau trận cho người có tài khoản. */
  private rewards = new MatchRewards();
  bots!: Bots;
  vehicles!: Vehicles;
  war!: War;
  /** Thùng thính: bản đồ và bộ số ngẫu nhiên đổi theo trận nên đọc qua getter. */
  airdrops = ((room: BattleRoom) =>
    new Airdrops({
      get state() {
        return room.state;
      },
      get map() {
        return room.map;
      },
      random: () => room.rand(),
      putItem: (itemId, x, y, z) => room.putItem(itemId, x, y, z),
    }))(this);
  /** Tường vỡ, nhà sập, cây đổ trong trận (bản đồ đổi theo trận nên đọc qua getter). */
  destruction = ((room: BattleRoom) =>
    new Destruction({
      get state() {
        return room.state;
      },
      get map() {
        return room.map;
      },
      broadcast: (type, message) => room.broadcast(type, message),
      crush: (id, amount, by) => {
        const dealt = room.damage(id, amount, "blast", by, "collapse");
        if (dealt && by && by !== id) room.clientOf(by)?.send(Messages.hit, { kind: dealt.killed ? "kill" : "body", armor: dealt.armor, amount: Math.round(dealt.amount) } satisfies HitMessage);
      },
    }))(this);
  private weatherLeft = WEATHER_MIN;

  async onCreate() {
    this.roomId = await this.uniqueRoomCode();
    this.state.mode = "battle";
    this.state.phase = "lobby";
    this.setupMap((crypto.getRandomValues(new Uint32Array(1))[0]! % 0xfffffff) + 1);
    this.bots = new Bots(this);
    this.vehicles = new Vehicles(this);
    this.war = new War(this);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p) return;
      // Đang ngồi xe tăng: vị trí đi theo xe (gói vehicleMove), bỏ qua gói đi bộ.
      if (p.vehicle) return;
      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(id) ?? now);
      if (!p.alive || !isPlausibleMove(p, move, elapsed, this.map.world.heightAt, this.map.half)) {
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
      p.prone = (move.prone ?? false) && !p.crouching;
      p.aiming = move.aiming ?? false;
      p.aimPitch = move.aimPitch ?? 0;
      // Nghiêng người: lượng tử 1/8 cho khỏi đồng bộ từng chút; nằm sấp, đang bơi thì không nghiêng.
      p.lean = p.prone || p.swimming ? 0 : Math.round((move.lean ?? 0) * 8) / 8;
    });

    this.onMessage(Messages.start, (client) => {
      if (!this.hostOnly(client)) return;
      if (this.state.phase === "prep" || this.state.phase === "battle") return;
      this.startMatch();
    });

    this.onMessage(Messages.battleSettings, BattleSettingsMessage, (client, s) => {
      if (!this.hostOnly(client) || this.state.phase !== "lobby") return;
      if (s.bots !== undefined) this.state.bots = Math.min(MAX_BATTLE_BOTS, s.bots);
      if (s.mode !== undefined && s.mode !== this.state.battleMode) {
        this.state.battleMode = s.mode;
        // Chiến trường dùng bản đồ riêng (rộng hơn, có cứ điểm): dựng lại bản đồ, chia phe cho người chơi.
        this.setupMap(this.state.worldSeed);
        for (const [id, p] of this.state.players) {
          if (p.bot) continue;
          if (s.mode === "war") this.war.assign(id);
          else {
            p.team = "";
            p.color = this.pickColor();
          }
        }
      }
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
      if (!id || !p || !p.alive || p.vehicle) return;
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

    this.onMessage(Messages.melee, MeleeMessage, (client, msg) => {
      const id = this.playerOf(client);
      if (id) this.melee(id, msg.yaw, msg.target);
    });

    this.onMessage(Messages.placeMine, (client) => {
      const id = this.playerOf(client);
      if (id) this.placeMine(id);
    });

    this.onMessage(Messages.heal, HealMessage, (client, { kind }) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p || !p.alive || p.vehicle || p.kit[kind] <= 0 || p.hp >= HEALS[kind].cap) return;
      this.cancelTimer(id);
      this.timers.set(id, { kind: "heal", left: HEALS[kind].seconds, heal: kind });
      p.kit.healing = kind;
    });

    this.onMessage(Messages.pickup, PickupMessage, (client, { id: itemKey }) => {
      const id = this.playerOf(client);
      if (id) this.pickup(id, itemKey);
    });

    this.onMessage(Messages.vehicleEnter, (client) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.enter(id);
    });

    this.onMessage(Messages.vehicleExit, (client) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.exit(id);
    });

    this.onMessage(Messages.vehicleMove, VehicleMoveMessage, (client, m) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.move(id, m);
    });

    this.onMessage(Messages.tankFire, TankFireMessage, (client, m) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.fire(id, m.turret, m.pitch);
    });

    // Xe trinh sát, thuyền: đổi ghế, xạ thủ xoay và bắn đại liên.
    this.onMessage(Messages.vehicleSeat, VehicleSeatMessage, (client, m) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.switchSeat(id, m.seat);
    });
    this.onMessage(Messages.vehicleAim, VehicleAimMessage, (client, m) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.aim(id, m.turret, m.pitch);
    });
    this.onMessage(Messages.vehicleGun, VehicleGunMessage, (client, m) => {
      const id = this.playerOf(client);
      if (id) this.vehicles.gun(id, m);
    });

    this.onMessage(Messages.squadOrder, SquadOrderMessage, (client, m) => {
      const id = this.playerOf(client);
      const p = id && this.state.players.get(id);
      if (!id || !p || !p.team || p.team !== id) return;
      // Giữ chỗ: ngay chỗ mình đứng; tới điểm: chỗ mình chỉ (không quá xa).
      const x = m.kind === "move" && m.x !== undefined ? m.x : p.x;
      const z = m.kind === "move" && m.z !== undefined ? m.z : p.z;
      if (Math.hypot(x - p.x, z - p.z) > 400) return;
      this.bots.orders.set(id, { kind: m.kind, x, z, rot: p.rotY });
    });

    this.onMessage(Messages.pickSide, PickSideMessage, (client, { side }) => {
      const id = this.playerOf(client);
      if (id && this.state.battleMode === "war" && this.state.phase === "lobby") this.war.pickSide(id, side);
    });

    this.onMessage(Messages.respawn, RespawnMessage, (client, { at, role }) => {
      const id = this.playerOf(client);
      if (id && this.state.battleMode === "war") this.war.respawn(id, at, role);
    });

    this.onMessage(Messages.possess, PossessMessage, (client, { id: botId }) => {
      const id = this.playerOf(client);
      if (id) this.possess(id, botId);
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

    // Chỉ khi thử nghiệm (BATTLE_DEV=1): dịch chuyển tức thời tới (x, z) để kiểm tra nhanh xe tăng, bot.
    if (process.env.BATTLE_DEV === "1")
      this.onMessage("devTeleport", (client, raw: unknown) => {
        const id = this.playerOf(client);
        const p = id && this.state.players.get(id);
        const at = raw as { x?: unknown; z?: unknown };
        if (!id || !p || typeof at?.x !== "number" || typeof at?.z !== "number") return;
        p.x = at.x;
        p.z = at.z;
        p.y = this.map.world.heightAt(at.x, at.z) + 0.1;
        this.lastMoveAt.set(id, Date.now());
        client.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
      });
    if (process.env.BATTLE_DEV === "1")
      this.onMessage("devKill", (client) => {
        const id = this.playerOf(client);
        if (id && this.state.players.get(id)?.alive) this.kill(id, "", "zone", false);
      });

    this.clock.setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  async onAuth(_client: Client, options: unknown): Promise<AuthData> {
    const auth = JoinOptions.parse(options);
    // Có phiên đăng nhập hợp lệ thì gắn với tài khoản (id u<id>, tên tài khoản, skin), không thì là khách như cũ.
    const { playerId, name, skins } = await resolveIdentity(auth);
    if (this.kicked.has(playerId)) throw new Error("Chủ phòng đã mời bạn ra khỏi phòng này.");
    const humans = [...this.state.players.values()].filter((p) => !p.bot).length;
    if (!this.state.players.has(playerId) && humans >= MAX_PLAYERS) throw new Error("Phòng đã đủ người.");
    return { name, playerId, skins };
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
      applySkins(existing, auth.skins);
    } else {
      const p = new PlayerState();
      p.name = auth.name;
      p.color = this.pickColor();
      p.sessionId = client.sessionId;
      p.created = true;
      applySkins(p, auth.skins);
      // Vào giữa trận thì xem (đã gục); ở sảnh thì đi lại tự do.
      const midMatch = this.state.phase === "prep" || this.state.phase === "battle";
      this.placeAtSpawn(p);
      p.hp = midMatch ? 0 : MAX_HP;
      p.maxHp = MAX_HP;
      p.alive = !midMatch;
      resetKit(p.kit, START_MONEY);
      this.state.players.set(playerId, p);
      // Chiến trường: vào phe ít người hơn; vào giữa trận thì chọn chỗ hồi sinh được ngay.
      if (this.state.battleMode === "war") this.war.assign(playerId);
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
    if (p.vehicle) this.vehicles.exit(id);
    this.bots.orders.delete(id);
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
    // Bản riêng của phòng (mặt nạ khối vỡ, cây đổ riêng), không đụng bản đồ trong cache dùng chung.
    this.map = withDestruction(mapForMode(this.state.battleMode, seed));
    this.destruction.reset();
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
    this.vehicles.clear();
    this.airdrops.clear();
    this.destruction.reset();
    const squad = s.battleMode === "squad";
    const war = s.battleMode === "war";
    const humans = [...s.players.entries()].filter(([, p]) => !p.bot).map(([id]) => id);
    if (war) this.bots.clear();
    else if (squad) this.bots.buildSquads(humans, Math.min(MAX_BATTLE_BOTS, Math.max(s.bots, humans.length * SQUAD_BOTS)), SQUAD_BOTS);
    else {
      this.bots.clear();
      this.bots.sync(s.bots);
    }
    for (const p of s.players.values()) {
      if (!squad && !war) p.team = p.role = "";
      p.vehicle = "";
      p.alive = true;
      p.hp = MAX_HP;
      p.maxHp = MAX_HP;
      p.kills = 0;
      p.crouching = p.aiming = p.prone = false;
      p.lean = 0;
      const outfit = p.kit.outfit;
      resetKit(p.kit, START_MONEY);
      p.kit.outfit = outfit;
    }
    if (war) this.war.start(Math.max(5, Math.min(MAX_BATTLE_BOTS, s.bots || MAX_BATTLE_BOTS)));
    else if (squad) this.placeTeams();
    else for (const p of s.players.values()) this.placeAtSpawn(p);
    for (const id of s.players.keys()) this.sendMines(id);
    if (!war) this.bots.equipAll();
    // Xe tăng: chỉ chế độ Đồng đội (chiến trường tự đặt xe ở căn cứ; sinh tồn không có xe tăng).
    if (squad) this.placeTanks(true);
    // Xe trinh sát, thuyền tuần tra bỏ trống trên đảo (chiến trường tự đặt ở căn cứ, bờ biển).
    if (!war) this.vehicles.fleet.setup();
    this.bots.warm();
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
    this.entrants = squad || war ? new Set([...s.players.values()].map((p) => p.team)).size : s.players.size;
    this.rewards.begin(s.players);
    this.updateAlive();
  }

  /** Đồng đội: mỗi đội xuất phát cùng một chỗ (các đội cách xa nhau), người trong đội đứng quanh đội trưởng. */
  private placeTeams() {
    const s = this.state;
    const teams = new Map<string, string[]>();
    for (const [id, p] of s.players) {
      const list = teams.get(p.team) ?? [];
      // Người chơi đứng đầu danh sách (ở giữa đội hình).
      if (!p.bot) list.unshift(id);
      else list.push(id);
      teams.set(p.team, list);
    }
    const centers: { x: number; z: number }[] = [];
    for (const members of teams.values()) {
      const c = battleSpawn(this.map, this.rand, centers);
      centers.push(c);
      members.forEach((id, k) => {
        const p = s.players.get(id)!;
        let x = c.x;
        let z = c.z;
        if (k > 0)
          for (let tries = 0; tries < 20; tries++) {
            const a = this.rand() * Math.PI * 2;
            const r = 2.5 + this.rand() * 4;
            const px = c.x + Math.cos(a) * r;
            const pz = c.z + Math.sin(a) * r;
            const h = this.map.world.heightAt(px, pz);
            if (h < 1 || insideBox(this.map.index, px, h + 1, pz, 0.5)) continue;
            x = px;
            z = pz;
            break;
          }
        p.x = x;
        p.z = z;
        p.y = this.map.world.heightAt(x, z) + 0.05;
        p.rotY = this.rand() * Math.PI * 2;
        this.clientOf(id)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
      });
    }
  }

  /** Xe tăng: Đồng đội thì mỗi đội một chiếc (máy lái tăng ngồi sẵn); solo thì vài chiếc bỏ trống rải trên đảo. */
  private placeTanks(squad: boolean) {
    const s = this.state;
    if (squad) {
      for (const [id, p] of s.players) {
        if (!p.bot || p.role !== "tanker") continue;
        const spot = this.vehicles.findSpot(p.x, p.z, 9, 26, this.rand) ?? this.vehicles.findSpot(p.x, p.z, 20, 60, this.rand);
        if (spot) this.vehicles.spawn(spot.x, spot.z, spot.rotY, p.team, id);
        else p.role = "rifle";
      }
      return;
    }
    for (let k = 0; k < 3; k++) {
      const c = battleSpawn(this.map, this.rand, []);
      const spot = this.vehicles.findSpot(c.x, c.z, 0, 30, this.rand);
      if (spot) this.vehicles.spawn(spot.x, spot.z, spot.rotY, "");
    }
  }

  /**
   * Đồng đội: đã gục thì nhập vào một máy còn sống trong đội mình (máy đó biến mất, mình đứng đúng chỗ nó với đồ, máu,
   * xe tăng của nó; tiền và số mạng hạ gục của mình giữ nguyên).
   */
  private possess(id: string, botId: string) {
    const s = this.state;
    const p = s.players.get(id);
    const b = s.players.get(botId);
    if (!p || p.alive || p.bot || !p.team || !b || !b.bot || !b.alive || b.team !== p.team || !this.fighting() || this.state.battleMode === "war") return;
    const money = p.kit.money;
    copyKit(b.kit, p.kit);
    p.kit.money = money;
    p.x = b.x;
    p.y = b.y;
    p.z = b.z;
    p.rotY = b.rotY;
    p.hp = b.hp;
    p.maxHp = MAX_HP;
    p.crouching = b.crouching;
    p.prone = b.prone;
    p.aiming = false;
    p.alive = true;
    const vid = b.vehicle;
    b.vehicle = "";
    this.timers.delete(botId);
    s.players.delete(botId);
    this.bots.forget(botId);
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (v && v.hp > 0) {
      p.vehicle = vid;
      v.driver = id;
    } else p.vehicle = "";
    this.lastMoveAt.set(id, Date.now());
    this.clientOf(id)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
    this.updateAlive();
  }

  private beginBattle() {
    this.state.phase = "battle";
    if (this.state.battleMode !== "war") this.nextZone();
  }

  /** Chiến trường: một phe hết vé, phe kia thắng. */
  endWar(winner: Side) {
    const s = this.state;
    if (s.phase !== "battle") return;
    s.winner = winner;
    s.phase = "ended";
    this.phaseLeft = sec(ENDED_SECONDS);
    s.phaseDuration = Math.ceil(this.phaseLeft);
    // Thưởng xu cho người có tài khoản: phe thắng hạng nhất, phe thua hạng nhì.
    this.rewards.finish(s.players, winner, "war");
  }

  /** Báo mọi người: phe `side` vừa chiếm cứ điểm `name`. */
  broadcastFlag(name: string, side: Side) {
    this.broadcast(Messages.flag, { name, side });
  }

  updateAliveCount() {
    this.updateAlive();
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
    if (s.phase === "battle" && s.battleMode !== "war") {
      this.tickZone(dt);
      if (second) this.zoneDamage();
      this.airdrops.tick(dt);
    }
    if (s.battleMode === "war") this.war.tick(dt);
    this.tickTimers(dt);
    this.tickThrown(dt);
    this.tickMines(dt);
    for (const p of s.players.values()) if (p.blind > 0) p.blind = Math.max(0, p.blind - dt);
    for (const [key, smoke] of s.smokes) {
      if (smoke.clear > 0) smoke.clear = Math.max(0, smoke.clear - dt);
      smoke.timeLeft -= dt;
      if (smoke.timeLeft <= 0) s.smokes.delete(key);
    }
    this.bots.tick(dt);
    if (s.phase === "prep" || s.phase === "battle") this.vehicles.tick(dt);
  }

  private backToLobby() {
    const s = this.state;
    s.phase = "lobby";
    s.groundItems.clear();
    s.projectiles.clear();
    s.smokes.clear();
    this.mines = [];
    this.thrown = [];
    this.bots.clear();
    this.vehicles.clear();
    this.airdrops.clear();
    this.destruction.reset();
    s.flags.clear();
    for (const [id, p] of s.players) {
      p.alive = true;
      p.hp = MAX_HP;
      p.respawn = 0;
      // Chiến trường: giữ phe đã chọn cho trận sau.
      if (s.battleMode === "war") p.role = p.vehicle = "";
      else p.team = p.role = p.vehicle = "";
      void id;
      p.prone = p.crouching = false;
      p.lean = 0;
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
    if (!p || !p.alive || p.vehicle) return;
    const kit = p.kit;
    const slot = kit.active;
    if (!isGunSlot(slot) || kit[slot] !== weaponId) return;
    const def = WEAPON.get(weaponId);
    if (!def) return;
    // Đang thay đạn thì không bắn được, trừ súng nạp từng viên (S1897): bắn là dừng nạp, giữ các viên đã nhét.
    if (kit.reloading && !def.shell) return;
    const now = Date.now();
    if (now - (this.lastShotAt.get(id) ?? 0) < (60000 / def.rpm) * 0.8) return;
    const mag = magOf(kit, slot);
    if (mag <= 0) return;
    // Kiểm tra gốc tia TRƯỚC khi trừ đạn. Trước đây thứ tự là: trừ đạn → ghi lastShotAt → hủy hồi
    // máu → mới kiểm tra gốc nòng, nên một phát bắn bị từ chối vì gốc sai vẫn mất một viên và vẫn
    // chiếm slot tần số, đồng thời không phát `shot` cho ai: người chơi nghe tiếng và thấy hiệu ứng
    // của một phát bắn không hề tồn tại.
    // Lề 4 m quanh chân đã đủ cho đầu nòng khi nghiêng người (Q/E, đầu lệch LEAN.side ≈ 0,4 m sang bên): phát bắn
    // vòng qua góc tường từ chỗ đã nghiêng vẫn hợp lệ.
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 4 || o[1] < p.y - 1 || o[1] > p.y + 3) return;
    if (kit.reloading) this.cancelTimer(id);
    this.lastShotAt.set(id, now);
    setMag(kit, slot, mag - 1);
    p.shots = (p.shots + 1) % 65536;
    this.cancelHeal(id);
    // Súng phóng đạn nổ (RPG): không dò trúng người, phóng quả đạn nổ theo hướng tia đầu tiên.
    if (def.explosive) {
      const r0 = rays[0]!;
      const l = Math.hypot(r0[0], r0[1], r0[2]) || 1;
      this.vehicles.launch(id, o, [r0[0] / l, r0[1] / l, r0[2] / l], def.velocity, def.explosive, def.id, "", def.boost);
      this.bots.onShot(id, p.x, p.z, 120);
      return;
    }
    this.shootRays(id, def, o, rays, hits, attOf(kit, slot).split(",").includes("suppressor"));
  }

  /**
   * Dò đường đạn thường đã qua kiểm tra (súng cầm tay, đại liên gắn trên xe): tường, đồi, cây, vỏ xe, rồi kiểm tra
   * lại những người máy người bắn báo trúng; trừ máu, làm hư tường, báo mọi người vẽ vệt đạn. `skipVehicle` là xe
   * của chính người bắn (đại liên trên xe không tự găm vào xe mình).
   */
  shootRays(id: string, def: WeaponDef, o: [number, number, number], rays: [number, number, number][], hits: { target: string; part: "head" | "body"; d: number; ray: number }[], suppressed: boolean, skipVehicle = "") {
    const p = this.state.players.get(id);
    if (!p) return;
    const weaponId = def.id;
    const maxRange = Math.min(600, def.range * 3);
    const dirs = rays.slice(0, def.pellets).map((r) => {
      const l = Math.hypot(r[0], r[1], r[2]) || 1;
      return [r[0] / l, r[1] / l, r[2] / l] as [number, number, number];
    });
    const ends: [number, number, number][] = [];
    // Đạn bay theo đường cong (rơi dần do trọng lực): dò tường từng đoạn dây cung; `walls` là quãng đường `s` tới chỗ găm.
    const steps = bulletSteps(def.velocity, maxRange);
    // Tia nào găm vào vỏ xe (id xe, mặt trúng, góc tới), để tính sát thương lên xe theo giáp.
    const tankOf = new Map<number, { vid: string; face: "front" | "side" | "rear" | "top"; cos: number }>();
    // Mỗi tia: găm vào khối nào / cây nào (để làm hư), đã xuyên qua vách mỏng nào (ở quãng `s` bao nhiêu).
    // `rico`: đạn sượt vào kim loại / bê tông thì nảy đi (xem `ricochet`): từ điểm `p` ở quãng `s` bay thẳng theo `d` thêm
    // tối đa `len` mét; người trúng viên nảy chỉ còn `mult` sát thương. Server tự tính lại y hệt client (phản xạ gương
    // qua mặt khối) nên điểm trúng báo về được kiểm tra như phát thường.
    const cal = caliberOf(def);
    const stops = dirs.map(() => ({ box: -1, tree: -1, yaw: 0, pens: [] as { s: number; box: number; mult: number }[], rico: null as null | { s: number; p: [number, number, number]; d: [number, number, number]; len: number; mult: number } }));
    const walls = dirs.map((d, ray) => {
      const st = stops[ray]!;
      for (let i = 1; i < steps.length; i++) {
        const a = bulletAt(o, d, def.velocity, steps[i - 1]!);
        const b = bulletAt(o, d, def.velocity, steps[i]!);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
        const cd: [number, number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
        const sAt = (t: number) => steps[i - 1]! + (t / len) * (steps[i]! - steps[i - 1]!);
        // Vách gỗ, tường vữa mỏng: đạn xuyên qua (mỗi tia tối đa một lần), sát thương giảm.
        const wall = bulletThrough(this.map.index, a, cd, len, 1 - st.pens.length, cal);
        for (const pen of wall.pens) st.pens.push({ s: sAt(pen.t), box: pen.i, mult: pen.mult });
        const trunk = raycastTrunksHit(this.map.world, a, cd, len, this.map.treeDead);
        let t = Math.min(wall.t, raycastTerrain(this.map.world, a, cd, len), trunk.t);
        const box = t === wall.t ? wall.i : -1;
        const tree = t === trunk.t && t < Infinity ? trunk.i : -1;
        // Xe chặn đạn (kể cả xác xe đang cháy; thép dày, đạn thường không xuyên).
        let tank: { vid: string; face: "front" | "side" | "rear" | "top"; cos: number } | null = null;
        for (const [vid, v] of this.state.vehicles) {
          if (vid === skipVehicle || Math.abs(v.x - a[0]) + Math.abs(v.z - a[2]) > len + 10) continue;
          const hv = rayVehicle(v, a, cd, len);
          if (hv && hv.t < t) {
            t = hv.t;
            tank = { vid, face: hv.face, cos: hv.cos };
          }
        }
        if (t < len) {
          if (tank) tankOf.set(ray, tank);
          else {
            st.box = box;
            st.tree = tree;
            st.yaw = Math.atan2(cd[0], cd[2]);
            if (box >= 0) st.rico = this.ricochetPath(box, [a[0] + cd[0] * t, a[1] + cd[1] * t, a[2] + cd[2] * t], cd, sAt(t));
          }
          return sAt(t);
        }
      }
      return maxRange;
    });
    const dealt = new Map<string, { amount: number; head: boolean; d: number }>();
    const hitRay = new Map<number, number>();
    for (const h of hits) {
      const d = dirs[h.ray];
      const target = this.state.players.get(h.target);
      if (!d || !target || !target.alive || target.vehicle || h.target === id || hitRay.has(h.ray)) continue;
      // Không bắn trúng đồng đội.
      if (p.team && target.team === p.team) continue;
      if (h.d > maxRange) continue;
      const body = { x: target.x, y: target.y, z: target.z, rotY: target.rotY, crouch: target.crouching, prone: target.prone, lean: target.lean };
      const rico = stops[h.ray]!.rico;
      // Phát thẳng (trước chỗ găm), hoặc viên nảy (sau chỗ găm, trong quãng bay của viên nảy).
      let check = h.d <= walls[h.ray]! + HITBOX.wallSlack ? checkBodyPoint(bulletAt(o, d, def.velocity, h.d), body, h.part === "head") : null;
      let bounce = 1;
      if (!check && rico && h.d > rico.s && h.d <= rico.s + rico.len + HITBOX.wallSlack) {
        const k = h.d - rico.s;
        check = checkBodyPoint([rico.p[0] + rico.d[0] * k, rico.p[1] + rico.d[1] * k, rico.p[2] + rico.d[2] * k], body, h.part === "head");
        bounce = rico.mult;
      }
      if (!check) continue;
      const head = check.head;
      // Viên nảy: vệt đạn ở máy khác vẽ tới chỗ nảy.
      hitRay.set(h.ray, bounce < 1 ? rico!.s : h.d);
      // Bắn xuyên vách mỏng thì đạn yếu đi tuỳ vật liệu và cỡ đạn, mỗi lớp xuyên qua trước người.
      let through = bounce;
      for (const pen of stops[h.ray]!.pens) if (pen.s < h.d) through *= pen.mult;
      const amount = def.damage * falloff(def, h.d) * (head ? def.headshot : 1) * through;
      const prev = dealt.get(h.target);
      dealt.set(h.target, { amount: (prev?.amount ?? 0) + amount, head: (prev?.head ?? false) || head, d: h.d });
    }
    dirs.forEach((d, i) => {
      const t = hitRay.get(i) ?? walls[i]!;
      ends.push(bulletAt(o, d, def.velocity, t));
    });
    // Máy ở gần nghe tiếng súng (súng to nghe xa hơn, giảm thanh thì chỉ nghe rất gần) thì đi dò về hướng đó.
    const loud = def.class === "sniper" || def.class === "dmr" ? 140 : def.class === "pistol" || def.class === "smg" ? 60 : 90;
    this.bots.onShot(id, p.x, p.z, suppressed ? loud * 0.25 : loud);
    const shot: ShotMessage = { id, w: weaponId, o, e: ends, ...(suppressed ? { s: 1 as const } : {}) };
    this.broadcast(Messages.shot, shot, { except: this.clientOf(id) });
    if (this.state.phase !== "battle") return;
    // Đạn găm vào vỏ xe: xe tăng gần như không xi nhê (thép dày), xe trinh sát, thuyền thì hư dần.
    for (const [ray, hv] of tankOf) {
      if (hitRay.has(ray)) continue;
      const dist = walls[ray]!;
      this.vehicles.bulletHit(hv.vid, def.damage * falloff(def, dist), id, def.id, hv.face, hv.cos);
    }
    // Đạn làm hư tường nó găm vào, vách nó xuyên qua, và thân cây trúng đạn.
    stops.forEach((st, ray) => {
      const stop = hitRay.get(ray) ?? walls[ray]!;
      const power = def.damage * falloff(def, stop) * def.pellets ** -0.3;
      for (const pen of st.pens) if (pen.s < stop) this.destruction.hitBox(pen.box, power * 0.5 * bulletWallFactor(this.map.index.boxes[pen.box]!), id);
      if (hitRay.has(ray)) return;
      if (st.box >= 0) this.destruction.hitBox(st.box, power * bulletWallFactor(this.map.index.boxes[st.box]!), id);
      else if (st.tree >= 0) this.destruction.hitTree(st.tree, power * 0.5, st.yaw);
    });
    for (const [target, hit] of dealt) {
      const result = this.damage(target, hit.amount, hit.head ? "head" : "body", id, weaponId, [p.x, p.z]);
      if (result) this.clientOf(id)?.send(Messages.hit, { kind: result.killed ? "kill" : hit.head ? "head" : "body", armor: result.armor, amount: Math.round(result.amount) } satisfies HitMessage);
      this.bots.onHurt(target, id);
    }
  }

  /**
   * Đạn theo hướng `cd` găm vào khối `box` ở điểm `p` (quãng `s`): nếu sượt đủ để nảy thì dò quãng bay thẳng của viên
   * nảy (tới tường, đất, thân cây gần nhất, tối đa RICOCHET.range mét).
   */
  private ricochetPath(box: number, p: [number, number, number], cd: [number, number, number], s: number) {
    const r = ricochet(this.map.index, box, p, cd);
    if (!r) return null;
    const from: [number, number, number] = [p[0] + r.d[0] * 0.02, p[1] + r.d[1] * 0.02, p[2] + r.d[2] * 0.02];
    const len = Math.min(RICOCHET.range, raycastBoxes(this.map.index, from, r.d, RICOCHET.range, true), raycastTerrain(this.map.world, from, r.d, RICOCHET.range), raycastTrunksHit(this.map.world, from, r.d, RICOCHET.range, this.map.treeDead).t);
    return { s, p, d: r.d, len, mult: r.mult };
  }

  reload(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.vehicle) return;
    const kit = p.kit;
    const slot = kit.active;
    if (!isGunSlot(slot) || kit.reloading) return;
    const def = weaponIn(kit, slot);
    if (!def || magOf(kit, slot) >= magSize(kit, slot) || ammoOf(kit, def.ammo) <= 0) return;
    this.cancelTimer(id);
    kit.reloading = true;
    this.timers.set(id, { kind: "reload", left: reloadTime(kit, slot), slot });
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
    const again: [string, Timed][] = [];
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
        // Súng nạp từng viên: còn thiếu thì hẹn viên kế tiếp (đặt lại sau vòng lặp).
        const next = reloadStep(kit, t.slot);
        if (next > 0) {
          kit.reloading = true;
          again.push([id, { kind: "reload", left: next, slot: t.slot }]);
        }
      } else if (t.kind === "heal" && t.heal) {
        kit.healing = "";
        const h = HEALS[t.heal];
        if (kit[t.heal] <= 0) continue;
        kit[t.heal] -= 1;
        p.hp = Math.min(Math.max(p.hp, Math.min(h.cap, p.hp + h.amount)), MAX_HP);
      }
    }
    for (const [id, t] of again) this.timers.set(id, t);
  }

  /**
   * Trừ máu (giáp, mũ chặn bớt). Trả về sát thương thật, có trúng giáp không, có hạ gục không.
   * `part`: head, body, blast (nổ: áo giáp chặn), zone (vùng độc: không gì chặn).
   */
  damage(id: string, raw: number, part: "head" | "body" | "blast" | "zone", attacker: string, weapon: string, from?: [number, number]) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return null;
    // Ngồi trong xe tăng: đạn, mảnh nổ không tới (xe chịu thay); chỉ vùng độc vẫn làm mất máu.
    if (p.vehicle && part !== "zone") return null;
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
    if (p.vehicle) this.vehicles.leave(id);
    // Chiến trường có hồi sinh: hạng tính theo phe thắng thua, không theo lúc gục.
    if (this.fighting() && this.state.battleMode !== "war") this.rewards.onDeath(id, this.state.players);
    p.alive = false;
    p.hp = 0;
    p.moving = false;
    p.prone = p.crouching = false;
    p.lean = 0;
    this.timers.delete(id);
    // Đồ rơi quanh chỗ gục.
    // Chiến trường: hàng trăm lần gục mỗi trận, không rải đồ (chỉ chút đạn), hồi sinh lại có đồ mới.
    if (this.state.battleMode === "war") {
      const def = WEAPON.get(p.kit.primary1);
      if (def && this.rand() < 0.35) this.dropAround([`ammo:${def.ammo}`], p.x, p.y, p.z);
    } else {
      const items = everything(p.kit);
      this.dropAround(items, p.x, p.y, p.z);
    }
    // Chiến trường: tiền giữ qua các lần hồi sinh.
    resetKit(p.kit, this.state.battleMode === "war" ? p.kit.money : 0);
    const k = this.state.players.get(killer);
    if (k && killer !== id && !(k.team && k.team === p.team)) {
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
    if (this.state.battleMode === "war") this.war.onDeath(id);
    while (this.state.feed.length > 6) this.state.feed.shift();
    this.updateAlive();
  }

  private updateAlive() {
    const s = this.state;
    const alive = [...s.players.entries()].filter(([, p]) => p.alive);
    s.aliveCount = alive.length;
    if (s.phase !== "battle" && s.phase !== "prep") return;
    if (s.battleMode === "war") return;
    // Đồng đội: còn một đội có người sống là hết trận (đội thắng ghi theo id đội).
    const squad = s.battleMode === "squad";
    const teams = new Set(alive.map(([id, p]) => p.team || id));
    const over = this.entrants >= 2 ? (squad ? teams.size <= 1 : alive.length <= 1) : alive.length === 0;
    if (!over) return;
    s.winner = squad ? ([...teams][0] ?? "") : (alive[0]?.[0] ?? "");
    s.phase = "ended";
    this.phaseLeft = sec(ENDED_SECONDS);
    s.phaseDuration = Math.ceil(this.phaseLeft);
    s.zone.dps = 0;
    this.rewards.finish(s.players, s.winner, s.battleMode || "solo");
  }

  // -------------------------------------------------------------------------- đồ

  private buy(id: string, item: string, client: Client) {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    if (this.state.phase === "ended") return;
    if (this.state.battleMode === "solo" && WEAPON.get(item)?.class === "launcher") return this.reject(client, "Chế độ sinh tồn không có xe tăng, không bán súng chống tăng.");
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
    if (!p || !p.alive || p.vehicle || !item) return;
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
      2: WEAPONS.filter((w) => !w.rare && (w.class === "ar" || w.class === "dmr" || w.class === "smg" || w.class === "lmg")),
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
      // Phụ kiện khác: đầu nòng, tay cầm, băng đạn, báng (hàng hiếm ở kho vũ khí).
      if (this.rand() < (spot.tier === 1 ? 0.2 : spot.tier === 2 ? 0.35 : 0.6)) {
        const pool = ATTACHMENT_IDS.filter((a) => spot.tier === 3 || ATTACHMENTS[a].price > 0);
        extras.push(`att:${pick(pool)}`);
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

  /**
   * Đâm dao: ai cũng thấy động tác; trúng thì server kiểm tra lại người bị đâm ở trong tầm với, phía trước mặt,
   * không có tường chắn. Đâm từ sau lưng thì nhân đôi sát thương.
   */
  melee(id: string, yaw: number, targetId?: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.vehicle) return;
    const now = Date.now();
    if (now - (this.lastMeleeAt.get(id) ?? 0) < MELEE.cooldown * 1000 * 0.85) return;
    this.lastMeleeAt.set(id, now);
    this.cancelHeal(id);
    p.act = "stab";
    p.actN = (p.actN + 1) % 65536;
    if (!targetId || this.state.phase !== "battle") return;
    const t = this.state.players.get(targetId);
    if (!t || !t.alive || t.vehicle || targetId === id || (p.team && t.team === p.team)) return;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > MELEE.range + 0.4 || Math.abs(t.y - p.y) > 1.6) return;
    // Hướng nhìn của người đâm: (−sin yaw, −cos yaw) theo quy ước camera.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (d > 0.6 && (dx * fx + dz * fz) / d < 0.35) return;
    const eye: [number, number, number] = [p.x, p.y + 1.3, p.z];
    const dir: [number, number, number] = [dx / (d || 1), (t.y - p.y) / (d || 1), dz / (d || 1)];
    if (d > 0.5 && raycastBoxes(this.map.index, eye, dir, d) < d - 0.2) return;
    // Người bị đâm quay lưng lại (mặt họ cùng hướng với hướng đâm) thì là đâm lén.
    const back = Math.sin(t.rotY) * dir[0] + Math.cos(t.rotY) * dir[2] > 0.5;
    const result = this.damage(targetId, MELEE.damage * (back ? MELEE.backstab : 1), "body", id, "knife", [p.x, p.z]);
    if (result) this.clientOf(id)?.send(Messages.hit, { kind: result.killed ? "kill" : "body", armor: result.armor, amount: Math.round(result.amount) } satisfies HitMessage);
    this.bots.onHurt(targetId, id);
  }

  throwGrenade(id: string, kind: "frag" | "smoke" | "flash", o: [number, number, number], v: [number, number, number]) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.vehicle || p.kit[kind] <= 0 || !this.fighting()) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 3 || Math.abs(o[1] - p.y - 1.4) > 1.5) return;
    const speed = Math.hypot(...v);
    const k = speed > 24 ? 24 / speed : 1;
    p.kit[kind] -= 1;
    if (p.kit[kind] <= 0 && p.kit.active === kind) p.kit.active = p.kit.primary1 ? "primary1" : p.kit.pistol ? "pistol" : "";
    p.act = "throw";
    p.actN = (p.actN + 1) % 65536;
    const g: Thrown = { id: `t${++this.seq}`, kind, owner: id, x: o[0], y: o[1], z: o[2], vx: v[0] * k, vy: v[1] * k, vz: v[2] * k, fuse: kind === "frag" ? FRAG.fuse : kind === "flash" ? FLASH.fuse : SMOKE.fuse, bounced: 0 };
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
      else if (g.kind === "flash") this.flashbang(g.x, g.y, g.z);
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

  /**
   * Bom choáng: ai thấy được chỗ nổ (không tường chắn) trong tầm thì loá mắt; nhìn thẳng vào, đứng gần thì lâu nhất,
   * quay lưng lại thì chỉ loá thoáng qua. Không gây sát thương.
   */
  flashbang(x: number, y: number, z: number) {
    this.broadcast(Messages.boom, { kind: "flash", x, y, z } satisfies BoomMessage);
    for (const p of this.state.players.values()) {
      if (!p.alive || p.vehicle) continue;
      const ey = p.y + (p.prone ? 0.35 : p.crouching ? 1.1 : 1.6);
      const d = Math.hypot(p.x - x, ey - y, p.z - z);
      if (d > FLASH.radius) continue;
      const dir: [number, number, number] = [(p.x - x) / (d || 1), (ey - y) / (d || 1), (p.z - z) / (d || 1)];
      if (d > 0.6 && raycastBoxes(this.map.index, [x, y + 0.15, z], dir, d) < d - 0.3) continue;
      if (d > 0.6 && raycastTerrain(this.map.world, [x, y + 0.15, z], dir, d) < d - 0.3) continue;
      // Hướng nhìn của người này (mặt nhân vật quay theo rotY, ngẩng theo aimPitch) so với hướng tới chỗ nổ.
      const cp = Math.cos(p.aimPitch);
      const look = Math.sin(p.rotY) * cp * -dir[0] + Math.sin(p.aimPitch) * -dir[1] + Math.cos(p.rotY) * cp * -dir[2];
      const facing = 0.2 + 0.8 * Math.max(0, look);
      const near = Math.pow(1 - d / FLASH.radius, 0.6);
      const seconds = FLASH.seconds * near * facing;
      if (seconds > 0.3) p.blind = Math.max(p.blind, seconds);
    }
  }

  explode(x: number, y: number, z: number, kind: "frag" | "mine" | "shell", owner: string, radius: number, maxDamage: number, weapon: string = kind, skipVehicle = "") {
    this.broadcast(Messages.boom, { kind, x, y, z } satisfies BoomMessage);
    // Sức ép thổi tan một khoảng trong đám khói gần đó một lúc.
    for (const smoke of this.state.smokes.values()) {
      if (Math.hypot(smoke.x - x, smoke.z - z) > SMOKE.radius + radius * 0.5) continue;
      smoke.clear = SMOKE_CLEAR.seconds;
      smoke.cx = x;
      smoke.cz = z;
    }
    if (this.state.phase !== "battle") return;
    this.vehicles.blast(x, y, z, radius, maxDamage, owner, weapon, skipVehicle);
    // Sức nổ làm hư, thủng tường gần đó, gãy cây; nổ đủ nhiều thì sập nhà.
    this.destruction.blast(x, y, z, radius, maxDamage, owner);
    for (const [id, p] of this.state.players) {
      if (!p.alive || p.vehicle) continue;
      const cx = p.x;
      const cy = p.y + (p.prone ? 0.25 : p.crouching ? 0.7 : 1.1);
      const cz = p.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > radius) continue;
      // Tường chắn thì an toàn.
      const dir: [number, number, number] = [(cx - x) / (d || 1), (cy - y) / (d || 1), (cz - z) / (d || 1)];
      if (d > 0.5 && raycastBoxes(this.map.index, [x, y + 0.3, z], dir, d - 0.3) < d - 0.3 - 1e-3) continue;
      const k = Math.pow(1 - d / radius, 1.3);
      const dealt = this.damage(id, maxDamage * k, "blast", owner, weapon, [x, z]);
      const knock: KnockMessage = { dx: dir[0], dz: dir[2], force: 14 * k };
      this.clientOf(id)?.send(Messages.knock, knock);
      if (dealt && owner && owner !== id) this.clientOf(owner)?.send(Messages.hit, { kind: dealt.killed ? "kill" : "body", armor: dealt.armor, amount: Math.round(dealt.amount) } satisfies HitMessage);
    }
  }

  private placeMine(id: string) {
    const p = this.state.players.get(id);
    if (!p || !p.alive || p.vehicle || p.kit.mine <= 0 || !this.fighting()) return;
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
        for (const v of this.state.vehicles.values()) {
          if (v.hp <= 0 || v.driver === m.owner || !v.moving) continue;
          if (Math.hypot(v.x - m.x, v.z - m.z) < 2.6) {
            m.fuse = 0.2;
            this.broadcast(Messages.mineClick, { x: m.x, y: m.y, z: m.z });
            break;
          }
        }
        if (m.fuse >= 0) continue;
        for (const [id, p] of this.state.players) {
          if (!p.alive || p.vehicle || id === m.owner) continue;
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

