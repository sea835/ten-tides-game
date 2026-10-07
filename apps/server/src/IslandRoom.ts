import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  ANCHORS,
  ANCHOR_PARTICIPANT_RADIUS,
  ANCHOR_TRIGGER_RADIUS,
  CAMP,
  CAMP_RADIUS,
  DIG_RADIUS,
  TREASURE_SITES,
  gameConfig,
  generateTraps,
  storyLibrary,
  spawnPoint,
  subSeed,
  tidalOpen,
  tidalSites,
  worldCatalog,
  worldFor,
  type World,
} from "@tentides/content";
import {
  BallotMessage,
  BuyMessage,
  CreateCharacterMessage,
  PLAYER_COLORS,
  PlaceMessage,
  SellMessage,
  UnplaceMessage,
  CHAT_MIN_INTERVAL_MS,
  ChatMessage,
  ChooseMessage,
  EVENT_TIMEOUT_SECONDS,
  AwardState,
  ChronicleState,
  CreatureState,
  INTERACT_RADIUS,
  InteractMessage,
  IslandState,
  TrapState,
  StoryLineState,
  SurvivalMessages,
  JoinOptions,
  KICKED_CLOSE_CODE,
  KickMessage,
  MAX_PLAYERS,
  Messages,
  MoveMessage,
  NightActionMessage,
  GhostActionMessage,
  SuspectMessage,
  NominateMessage,
  PHASE_SECONDS,
  PlayerState,
  READY_WRAP_UP_SECONDS,
  RationMessage,
  SettingsMessage,
  TriggerMessage,
  type ChatBroadcast,
  type ChatChannel,
  type CorrectMessage,
  type FxMessage,
  type KnockMessage,
  type EncounterMessage,
  type RejectedMessage,
  type TimedPhase,
} from "@tentides/protocol";
import {
  ENCOUNTER_PHASES,
  RuleError,
  createGame,
  isBusy,
  privateView,
  reduce,
  seedFromString,
  type Difficulty,
  type EncounterEffects,
  type EncounterSource,
  type GameAction,
  type GameState,
} from "@tentides/rules";
import { chronicle, createPremise, diaryPage, narrateDawn, narrateDusk, narratePrivate, type Premise, type StoryContext } from "@tentides/story";
import { computeAwards } from "./awards.ts";
import { GameLogWriter, type GameLogFile } from "./gameLog.ts";
import { Hazards, type HazardEvent } from "./hazards.ts";
import { applySkins, resolveIdentity } from "./account.ts";
import { isPlausibleMove } from "./movement.ts";
import { randomRoomCode } from "./roomCode.ts";
import { syncState } from "./sync.ts";
import { Wildlife, type Bite } from "./wildlife.ts";
import { PlayController, type PlayHost } from "./playRoom.ts";
import { Survival, type SurvivalEvent } from "./survival.ts";

const RECONNECT_SECONDS = 60;
/** Nhịp của mặt phẳng thời gian thực: sinh vật đi lại, hơi thở khi lặn, bẫy. */
const REALTIME_STEP_MS = 100;
/** Sai số khoảng cách khi mở thẻ: vị trí trên server trễ hơn client một chút. */
const TRIGGER_TOLERANCE = 1.5;
/** Mỗi trang nhật ký nhặt được thêm chừng này tiến độ kho báu. */
const PAGE_TREASURE = 4;
/** Co giãn thời lượng các pha khi dev, vd. PHASE_SCALE=0.1 để một ngày chỉ còn 30 giây. */
const PHASE_SCALE = Number(process.env.PHASE_SCALE ?? 1);

function isTimed(phase: string): phase is TimedPhase {
  return phase in PHASE_SECONDS;
}

function scaled(seconds: number): number {
  return Math.max(1, Math.round(seconds * PHASE_SCALE));
}

interface AuthData extends JoinOptions {
  playerId: string;
  /** Skin súng đang lắp (người có tài khoản). */
  skins: Record<string, string>;
}

export class IslandRoom extends Room<{ state: IslandState }> {
  maxClients = MAX_PLAYERS;
  state = new IslandState();

  /** Engine luật là nguồn sự thật; state của Colyseus chỉ là bản chiếu công khai. */
  private game!: GameState;
  /** Event sourcing: seed + chuỗi hành động (và biên bản chat) được ghi ra file để phát lại. */
  private logFile!: GameLogFile;
  private logWriter!: GameLogWriter;
  /** Phiên kết nối → id người chơi. Id ổn định qua các lần rớt mạng; phiên thì không. */
  private sessions = new Map<string, string>();
  private kicked = new Set<string>();
  private lastMoveAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  private eventTimers = new Map<string, number>();
  /** Ai đã bấm sẵn sàng. Chỉ công khai con số, không công khai là ai. */
  private ready = new Set<string>();
  /** Bản thông tin riêng lần gần nhất đã gửi cho từng người, để chỉ gửi khi có thay đổi. */
  private sentPrivate = new Map<string, string>();
  /** Cốt truyện của ván (chọn theo seed lúc bắt đầu) và lời kể riêng từng người. */
  private premise: Premise | null = null;
  private privateStory = new Map<string, { day: number; text: string }[]>();
  /** Thế giới sinh theo seed (công khai), bẫy (theo seed bí mật của ván), sinh vật. */
  private world!: World;
  private hazards!: Hazards;
  private wildlife!: Wildlife;
  /** Ai đã vuốt ve con nào trong ngày nào: mỗi người mỗi con một lần mỗi ngày. */
  private petted = new Set<string>();
  private realtimeTicks = 0;
  /** Cầm đồ, đánh, ném, cây cối, trại và nhà cửa. */
  private playCtl!: PlayController;
  /** Thủy triều và núi lửa leo thang. */
  private survival!: Survival;

  get actions(): readonly GameAction[] {
    return this.logFile.actions;
  }

  async onCreate() {
    this.roomId = await this.uniqueRoomCode();
    const seed = seedFromString(`${this.roomId}:${Date.now()}`);
    this.game = createGame(seed);
    this.logFile = { version: 1, roomId: this.roomId, seed, createdAt: new Date().toISOString(), actions: [], chat: [] };
    this.logWriter = new GameLogWriter(this.logFile);
    this.state.duskSeconds = scaled(PHASE_SECONDS.dusk);
    this.setupWorld(crypto.getRandomValues(new Uint32Array(1))[0]! || 1);
    this.playCtl.register();
    syncState(this.state, this.game);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const id = this.playerOf(client);
      const player = id && this.state.players.get(id);
      if (!id || !player) return;

      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(id) ?? now);
      // Tạm dừng thì đứng yên; đang trong sự kiện thì đứng yên tới khi chọn xong;
      // bị trói thì không ra khỏi trại được.
      // Đang choáng thì đứng hình.
      const frozen = this.state.paused || isBusy(this.game, id) || this.playCtl.play.stunned(id);
      const camp = this.playCtl.camp();
      const leavingCamp = this.game.players[id]?.tied && Math.hypot(move.x - camp.x, move.z - camp.z) > CAMP_RADIUS;
      if (frozen || leavingCamp || !isPlausibleMove(player, move, elapsed, this.world.heightAt)) {
        client.send(Messages.correct, { x: player.x, y: player.y, z: player.z } satisfies CorrectMessage);
        return;
      }
      this.lastMoveAt.set(id, now);
      player.x = move.x;
      player.y = move.y;
      player.z = move.z;
      player.rotY = move.rotY;
      player.moving = move.moving;
      player.sitting = move.sitting && !move.moving;
      player.swimming = move.swimming ?? false;
      this.playCtl.checkClimber(id, move.x, move.z);
    });

    this.onMessage(Messages.settings, SettingsMessage, (client, settings) => {
      if (!this.hostOnly(client) || !this.lobbyOnly(client)) return;
      if (settings.difficulty) this.state.difficulty = settings.difficulty;
      if (settings.nightSeconds) this.state.nightSeconds = settings.nightSeconds;
      if (settings.worldSeed && settings.worldSeed !== this.state.worldSeed) this.setupWorld(settings.worldSeed);
    });

    this.onMessage(Messages.createCharacter, CreateCharacterMessage, (client, { color, ...choice }) => {
      const id = this.playerOf(client);
      if (!id) return;
      const taken = [...this.state.players.entries()].some(([other, p]) => other !== id && p.color === color);
      if (taken) return this.reject(client, "Màu áo này đã có người chọn.");
      if (this.dispatch({ type: "createCharacter", playerId: id, ...choice }, client)) {
        this.state.players.get(id)!.color = color;
      }
    });

    this.onMessage(Messages.buy, BuyMessage, (client, { itemId }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "buy", playerId: id, itemId }, client);
    });

    this.onMessage(Messages.sell, SellMessage, (client, { uid }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "sell", playerId: id, uid }, client);
    });

    this.onMessage(Messages.place, PlaceMessage, (client, { uid, x, y, rot }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "place", playerId: id, uid, x, y, rot }, client);
    });

    this.onMessage(Messages.unplace, UnplaceMessage, (client, { uid }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "unplace", playerId: id, uid }, client);
    });

    this.onMessage(Messages.kick, KickMessage, (client, { playerId }) => {
      if (!this.hostOnly(client) || !this.lobbyOnly(client)) return;
      if (playerId === this.playerOf(client)) return this.reject(client, "Không tự mời mình ra được.");
      this.kicked.add(playerId);
      this.clientOf(playerId)?.leave(KICKED_CLOSE_CODE);
    });

    this.onMessage(Messages.start, (client) => {
      if (!this.hostOnly(client)) return;
      // Không lock() phòng: phòng khoá thì người cũ cũng không vào lại được. onAuth đã chặn người mới.
      this.dispatch({ type: "start", difficulty: this.state.difficulty as Difficulty }, client);
    });

    this.onMessage(Messages.pause, (client) => {
      if (!this.hostOnly(client)) return;
      if (!isTimed(this.game.phase)) return this.reject(client, "Chỉ tạm dừng được khi ván đang chạy.");
      this.state.paused = !this.state.paused;
    });

    this.onMessage(Messages.ready, (client) => {
      const id = this.playerOf(client);
      if (!id || !this.readyEligible().includes(id)) return this.reject(client, "Lúc này chưa cần bấm sẵn sàng.");
      if (this.ready.has(id)) this.ready.delete(id);
      else this.ready.add(id);
      this.checkEveryoneReady();
    });

    this.onMessage(Messages.trigger, TriggerMessage, (client, { anchorId }) => {
      const id = this.playerOf(client);
      const anchor = ANCHORS.find((a) => a.id === anchorId);
      const player = id && this.state.players.get(id);
      if (!id || !anchor || !player || this.state.paused) return;
      if (Math.hypot(player.x - anchor.x, player.z - anchor.z) > ANCHOR_TRIGGER_RADIUS + TRIGGER_TOLERANCE) {
        return this.reject(client, "Hãy đứng sát điểm sự kiện hơn.");
      }
      const participants = [...this.state.players.entries()]
        .filter(([, p]) => p.connected && Math.hypot(p.x - anchor.x, p.z - anchor.z) <= ANCHOR_PARTICIPANT_RADIUS)
        .map(([pid]) => pid);
      if (this.dispatch({ type: "trigger", playerId: id, anchorId, participants }, client)) {
        this.eventTimers.set(anchorId, EVENT_TIMEOUT_SECONDS);
        this.syncEventTimers();
      }
    });

    this.onMessage(Messages.choose, ChooseMessage, (client, { anchorId, choiceId }) => {
      const id = this.playerOf(client);
      if (id && this.dispatch({ type: "choose", playerId: id, anchorId, choiceId }, client)) this.eventTimers.delete(anchorId);
    });

    this.onMessage(Messages.ration, RationMessage, (client, { choice }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "ration", playerId: id, choice }, client);
    });

    this.onMessage(Messages.nominate, NominateMessage, (client, { target }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "nominate", playerId: id, target }, client);
    });

    this.onMessage(Messages.ballot, BallotMessage, (client, { tie }) => {
      const id = this.playerOf(client);
      if (!id || !this.dispatch({ type: "ballot", playerId: id, tie }, client)) return;
      // Người đang có mặt đã bỏ phiếu hết thì lật luôn, không chờ người mất kết nối.
      const ballot = this.game.votes.tie;
      const present = this.game.campers.filter((pid) => this.game.players[pid]?.alive && this.state.players.get(pid)?.connected);
      if (ballot && !ballot.revealed && present.every((pid) => pid in ballot.votes)) this.dispatch({ type: "revealBallot" });
    });

    this.onMessage(Messages.nightAction, NightActionMessage, (client, { action, target }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "nightAction", playerId: id, action, target }, client);
    });

    this.onMessage(Messages.ghostAction, GhostActionMessage, (client, { action, target, text }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "ghostAction", playerId: id, action, target, text }, client);
    });

    this.onMessage(Messages.suspect, SuspectMessage, (client, { target }) => {
      const id = this.playerOf(client);
      if (id) this.dispatch({ type: "suspect", playerId: id, target }, client);
    });

    this.onMessage(Messages.star, (client) => {
      const id = this.playerOf(client);
      if (id && this.dispatch({ type: "star", playerId: id }, client)) client.send(Messages.starred, { count: this.game.stars.filter((s) => s.playerId === id).length });
    });

    this.onMessage(Messages.dig, (client) => {
      const id = this.playerOf(client);
      const player = id && this.state.players.get(id);
      const site = TREASURE_SITES.find((s) => s.id === this.state.treasureSite);
      if (!id || !player || this.state.paused) return;
      if (!site) return this.reject(client, "Chưa biết chính xác chỗ đào.");
      if (Math.hypot(player.x - site.x, player.z - site.z) > DIG_RADIUS + TRIGGER_TOLERANCE) {
        return this.reject(client, "Phải đứng đúng chỗ mới đào được.");
      }
      this.dispatch({ type: "dig", playerId: id }, client);
    });

    this.onMessage(Messages.interact, InteractMessage, (client, { targetId }) => {
      const id = this.playerOf(client);
      const player = id && this.state.players.get(id);
      if (!id || !player || this.state.paused) return;
      if (isBusy(this.game, id)) return this.reject(client, "Đang bận với sự kiện trước mặt.");
      const near = (x: number, y: number, z: number, vertical = 3.5) =>
        Math.hypot(player.x - x, player.z - z) <= INTERACT_RADIUS + TRIGGER_TOLERANCE && Math.abs(player.y - y) <= vertical;

      const poi = this.world.pois.find((p) => p.id === targetId);
      if (poi) {
        const def = worldCatalog.pois.get(poi.defId)!;
        if (poi.day !== 0 && poi.day !== this.game.day) return this.reject(client, "Ở đây chẳng có gì cả.");
        if (!near(poi.x, poi.y, poi.z)) return this.reject(client, "Hãy lại gần hơn.");
        if (this.game.discovered.includes(poi.id)) return this.reject(client, "Đã có người tìm thấy chỗ này rồi.");
        const outcome = def.outcomes?.[poi.outcome];
        const effects = outcome?.effects ?? def.effects ?? {};
        this.encounter(id, poi.kind, poi.id, def.id, effects, { once: true }, { title: def.name, text: outcome?.text ?? def.text ?? "" }, client);
        return;
      }
      // Trang nhật ký của người xưa: chỉ hiện đúng ngày của nó; nhặt được thì thêm manh mối và ghi vào sổ truyện riêng.
      const page = this.world.pages.find((p) => p.id === targetId);
      if (page) {
        const ctx = this.storyContext();
        if (page.day !== this.game.day || !ctx) return this.reject(client, "Ở đây chẳng có gì cả.");
        if (!near(page.x, page.y, page.z)) return this.reject(client, "Hãy lại gần hơn.");
        if (this.game.discovered.includes(page.id)) return this.reject(client, "Đã có người nhặt trang này rồi.");
        const { title, text } = diaryPage(ctx, page.day);
        if (this.encounter(id, "page", page.id, "diary_page", { treasure: PAGE_TREASURE }, { once: true }, { title, text }, client)) {
          this.privateStory.set(id, [...(this.privateStory.get(id) ?? []), { day: this.game.day, text: `${title}. ${text}` }]);
          this.sendPrivate();
          this.broadcast(Messages.fx, { kind: "page", x: page.x, y: page.y + 1, z: page.z, word: "SỘT SOẠT" } satisfies FxMessage);
        }
        return;
      }
      // Cổ vật trong xác tàu đắm, rương trong hang ngầm, trên rạn san hô: chỉ với tới khi triều rút.
      const tidal = tidalSites(this.world).find((s) => s.id === targetId);
      if (tidal) {
        if (!near(tidal.x, tidal.y, tidal.z, 4)) return this.reject(client, "Hãy lại gần hơn.");
        if (!tidalOpen(tidal, this.survival.sea)) return this.reject(client, "Nước còn ngập sâu quá, chờ triều rút đã.");
        if (this.game.discovered.includes(tidal.id)) return this.reject(client, "Đã có người lấy mất rồi.");
        this.encounter(id, "egg", tidal.id, `tidal_${tidal.kind}`, tidal.effects, { once: true }, { title: tidal.name, text: tidal.text }, client);
        return;
      }
      const creature = this.wildlife.active(this.game.day).find((c) => c.id === targetId);
      if (creature?.def.interact) {
        if (!near(creature.x, creature.y, creature.z, 4)) return this.reject(client, "Hãy lại gần hơn.");
        const key = `${id}:${creature.id}:${this.game.day}`;
        if (this.petted.has(key)) return this.reject(client, `${creature.def.name} đã quen mặt bạn hôm nay rồi.`);
        const { effects, text } = creature.def.interact;
        if (this.encounter(id, "friend", creature.id, creature.def.id, effects, {}, { title: creature.def.name, text }, client)) this.petted.add(key);
        return;
      }
      this.reject(client, "Không có gì để xem ở đây.");
    });

    this.onMessage(Messages.chat, ChatMessage, (client, { text }) => {
      const id = this.playerOf(client);
      if (!id) return;
      const route = this.chatRoute(id);
      if (!route) {
        const outside = this.game.phase === "night";
        return this.reject(
          client,
          outside ? "Bạn đang ngủ ngoài, không ai ở trại nghe thấy bạn." : "Chỉ nói chuyện được ở sảnh chờ hoặc quanh đống lửa ban đêm.",
        );
      }
      const now = Date.now();
      if (now - (this.lastChatAt.get(id) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      this.lastChatAt.set(id, now);

      const name = this.state.players.get(id)?.name ?? "?";
      this.logFile.chat.push({ day: this.game.day, from: id, channel: route.channel, text });
      const message: ChatBroadcast = { from: id, name, text, channel: route.channel };
      for (const listener of route.to) this.clientOf(listener)?.send(Messages.chat, message);
    });

    // Cảnh núi lửa vừa dựng xong (vào giữa chừng, tải lại trang) thì xin lại bom đang bay, hố lửa còn cháy.
    this.onMessage(SurvivalMessages.volcano, (client) => {
      for (const message of this.survival.snapshot()) client.send(SurvivalMessages.volcano, message);
    });

    this.clock.setInterval(() => this.tick(), 1000);
    this.clock.setInterval(() => this.realtimeTick(REALTIME_STEP_MS / 1000), REALTIME_STEP_MS);
  }

  async onAuth(_client: Client, options: unknown): Promise<AuthData> {
    const auth = JoinOptions.parse(options);
    // Có phiên đăng nhập hợp lệ thì gắn với tài khoản (id u<id>, tên tài khoản), không thì là khách như cũ.
    const { playerId, name, skins } = await resolveIdentity(auth);
    if (this.kicked.has(playerId)) throw new Error("Chủ phòng đã mời bạn ra khỏi phòng này.");
    // Ván đã bắt đầu thì chỉ người cũ (cùng token) mới vào lại được.
    if (this.game.phase !== "lobby" && !this.game.players[playerId]) throw new Error("Ván đã bắt đầu, không vào thêm được.");
    return { ...auth, name, playerId, skins };
  }

  onJoin(client: Client, _options: unknown, auth: AuthData) {
    const { playerId } = auth;
    const existing = this.state.players.get(playerId);
    if (existing) {
      // Vào lại đúng nhân vật cũ (tải lại trang, đổi mạng). Phiên cũ nếu còn thì cho ra.
      const old = existing.sessionId;
      existing.sessionId = client.sessionId;
      existing.connected = true;
      this.sessions.delete(old);
      this.clients.find((c) => c.sessionId === old)?.leave();
      applySkins(existing, auth.skins);
    } else {
      const spawn = spawnPoint(this.state.players.size);
      const player = new PlayerState();
      player.name = auth.name;
      applySkins(player, auth.skins);
      player.color = this.pickColor();
      player.sessionId = client.sessionId;
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
      player.rotY = Math.PI; // quay mặt vào đảo (hướng bắc)
      this.state.players.set(playerId, player);
      this.dispatch({ type: "join", playerId, name: auth.name });
    }
    this.sessions.set(client.sessionId, playerId);
    this.lastMoveAt.set(playerId, Date.now());
    if (!this.state.hostId) this.state.hostId = playerId;
    this.sentPrivate.delete(playerId);
    this.sendPrivate();
    this.updateReadyCount();
  }

  async onDrop(client: Client) {
    const id = this.playerOf(client);
    // Bị chủ phòng mời ra thì không giữ chỗ: đi thẳng tới onLeave.
    if (!id || this.kicked.has(id)) return;
    const player = this.state.players.get(id);
    if (player && player.sessionId === client.sessionId) player.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const id = this.playerOf(client);
    const player = id && this.state.players.get(id);
    if (!id || !player) return;
    player.connected = true;
    this.lastMoveAt.set(id, Date.now());
    this.sentPrivate.delete(id);
    this.sendPrivate();
  }

  onLeave(client: Client) {
    const id = this.playerOf(client);
    this.sessions.delete(client.sessionId);
    const player = id && this.state.players.get(id);
    // Phiên đã bị phiên mới của cùng người chơi thay thế thì không đụng gì nữa.
    if (!id || !player || player.sessionId !== client.sessionId) return;

    if (this.game.phase === "lobby") {
      this.dispatch({ type: "leave", playerId: id });
      this.state.players.delete(id);
    } else {
      // Ván đã bắt đầu: nhân vật ở lại, coi như bot ngồi yên trong trại. Vào lại bằng cùng token là tiếp tục.
      player.connected = false;
    }
    if (this.state.hostId === id) {
      this.state.hostId = [...this.state.players.entries()].find(([, p]) => p.connected)?.[0] ?? "";
    }
  }

  onDispose() {
    return this.logWriter.save();
  }

  /**
   * Dựng thế giới cho seed này: đảo nhỏ, hang, hầm, easter egg, sinh vật (công khai, theo seed thế giới)
   * và bẫy (theo seed bí mật của ván, nên biết seed thế giới cũng không đoán được bẫy nằm đâu).
   */
  private setupWorld(worldSeed: number) {
    this.state.worldSeed = worldSeed;
    this.logFile.worldSeed = worldSeed;
    this.world = worldFor(worldSeed);
    const secret = subSeed(this.game.seed, `world:${worldSeed}`);
    this.hazards = new Hazards(this.world, generateTraps(this.world, secret), secret);
    if (this.playCtl) this.playCtl.reset(this.world, worldSeed);
    else this.playCtl = new PlayController(this.playHost(), this.world, worldSeed);
    if (this.survival) this.survival.reset(this.world, secret);
    else this.survival = new Survival(this.world, secret);
    this.wildlife = new Wildlife(
      this.world,
      worldSeed,
      worldCatalog,
      () => this.playCtl.perches(),
      () => ({ ...this.playCtl.camp(), radius: CAMP_RADIUS + 8 }),
    );
    this.state.creatures.clear();
    this.state.traps.clear();
  }

  /** Những gì hệ thống tương tác được dùng từ phòng chơi. */
  private playHost(): PlayHost {
    const room = this;
    return {
      get state() {
        return room.state;
      },
      game: () => room.game,
      world: () => room.world,
      wildlife: () => room.wildlife,
      playerOf: (client) => room.playerOf(client),
      clientOf: (id) => room.clientOf(id),
      dispatch: (action, client) => room.dispatch(action, client),
      reject: (client, reason) => room.reject(client, reason),
      broadcast: (type, message) => room.broadcast(type, message),
      encounter: (playerId, source, refId, defId, effects, opts, message) => room.encounter(playerId, source, refId, defId, effects, opts, message),
      onMessage: ((type: string, a: unknown, b?: unknown) => (b ? room.onMessage(type, a as never, b as never) : room.onMessage(type, a as never))) as PlayHost["onMessage"],
    };
  }

  /** Mặt phẳng thời gian thực: sinh vật đi lại và cắn, hơi thở khi lặn, bẫy, cầm đánh ném, cây cối. */
  private realtimeTick(dt: number) {
    if (this.state.paused) return;
    const active = ENCOUNTER_PHASES.includes(this.game.phase);
    const people = [...this.state.players.entries()]
      .map(([id, p]) => ({ id, p, sheet: this.game.players[id] }))
      .filter((e) => e.sheet && e.p.connected);
    // Thủy triều: mọi hệ thống dưới đây đọc cùng một mực nước.
    this.survival.updateSea(this.state);
    const sea = this.survival.sea;
    this.wildlife.seaLevel = sea;
    this.playCtl.play.seaLevel = sea;

    const bites = this.wildlife.step(
      dt,
      this.game.day,
      people.map(({ id, p, sheet }) => ({ id, x: p.x, y: p.y, z: p.z, alive: sheet!.alive, items: sheet!.items, climbing: !!p.climbing })),
      active,
    );
    const hazards = this.hazards.step(
      dt,
      people.map(({ id, p, sheet }) => ({
        id,
        x: p.x,
        y: p.y,
        z: p.z,
        alive: sheet!.alive,
        strength: sheet!.stats.strength,
        background: sheet!.background,
        stats: sheet!.stats,
      })),
      active,
      { x: this.playCtl.play.camp.x, z: this.playCtl.play.camp.z, lit: !this.playCtl.play.camp.packed },
      sea,
    );
    const survival = this.survival.step(
      dt,
      this.state,
      people.map(({ id, p, sheet }) => ({ id, x: p.x, y: p.y, z: p.z, alive: sheet!.alive })),
      active,
      this.playCtl.play.camp,
    );
    for (const event of survival) this.onSurvival(event);
    if (active) {
      for (const bite of bites) this.onBite(bite);
      for (const event of hazards) this.onHazard(event);
    }
    for (const { id, p } of people) {
      const breath = Math.round(this.hazards.breath.get(id) ?? 100);
      if (p.breath !== breath) p.breath = breath;
    }
    this.playCtl.tick(dt, active);
    // Vị trí sinh vật chỉ gửi 5 lần mỗi giây (client tự nội suy), đỡ tốn băng thông và đỡ bắt HUD tính lại.
    if (++this.realtimeTicks % 2 === 0) this.syncCreatures();
  }

  /** Núi lửa, triều cường: báo hiệu ứng cho mọi người, sát thương đi vào engine luật. */
  private onSurvival(event: SurvivalEvent) {
    if (event.kind === "volcano") {
      this.broadcast(SurvivalMessages.volcano, event.message);
      return;
    }
    const p = this.state.players.get(event.playerId);
    this.encounter(event.playerId, event.source, event.defId, event.defId, event.effects, {}, { title: event.title, text: event.text });
    if (!p) return;
    this.broadcast(Messages.fx, { kind: event.source === "drowning" ? "splash" : "burn", x: p.x, y: p.y + 1.4, z: p.z, word: event.word, amount: -(event.effects.hp ?? 0) } satisfies FxMessage);
    if (event.knock) this.clientOf(event.playerId)?.send(Messages.knock, event.knock satisfies KnockMessage);
  }

  private onBite(bite: Bite) {
    const def = worldCatalog.creatures.get(bite.species)!;
    const text = bite.deterred
      ? `${def.name} lao tới nhưng chùn lại trước thứ bạn đang cầm, chỉ kịp cào một đường rồi bỏ chạy.`
      : `${def.name} bất ngờ tấn công bạn. ${def.blurb}`;
    this.encounter(bite.playerId, "creature", bite.creatureId, bite.species, bite.effects, {}, { title: `${def.name} tấn công!`, text });
    this.playCtl.play.applyStatus(bite.playerId, bite.status);
    const p = this.state.players.get(bite.playerId);
    if (p) this.broadcast(Messages.fx, { kind: "hit", x: p.x, y: p.y + 1.6, z: p.z, word: "NGOẠM!", amount: -(bite.effects.hp ?? 0) });
  }

  private onHazard(event: HazardEvent) {
    const p = this.state.players.get(event.playerId);
    if (event.kind === "drowning") {
      this.encounter(event.playerId, "drowning", "sea", "drowning", event.effects, {}, {
        title: "Đuối nước",
        text: "Hết hơi, nước mặn tràn vào mũi. Mau ngoi lên!",
      });
      if (p) this.broadcast(Messages.fx, { kind: "drown", x: p.x, y: p.y + 1.5, z: p.z, word: "ỤC ỤC...", amount: -(event.effects.hp ?? 0) } satisfies FxMessage);
      return;
    }
    if (event.kind === "lava") {
      if (p) this.broadcast(Messages.fx, { kind: "lava", x: p.x, y: p.y + 0.8, z: p.z, word: "XÈÈÈO!" } satisfies FxMessage);
      this.encounter(event.playerId, "lava", "volcano", "lava", event.effects, { fatal: true }, {
        title: "Rơi vào dung nham",
        text: "Hơi nóng táp vào mặt, rồi không còn gì nữa. Hòn đảo đã nuốt trọn bạn.",
      });
      return;
    }
    if (event.kind === "burn") {
      this.encounter(event.playerId, "burn", "camp", "campfire", event.effects, {}, {
        title: "Bỏng!",
        text: "Bạn giẫm thẳng vào đống lửa. Mùi khét bốc lên từ gấu quần.",
      });
      if (!p) return;
      this.broadcast(Messages.fx, { kind: "burn", x: p.x, y: p.y + 1.4, z: p.z, word: "NÓNG! NÓNG!", amount: -(event.effects.hp ?? 0) } satisfies FxMessage);
      // Bị lửa hất bật ra ngoài.
      const camp = this.playCtl.play.camp;
      const d = Math.hypot(p.x - camp.x, p.z - camp.z) || 1;
      this.clientOf(event.playerId)?.send(Messages.knock, { dx: (p.x - camp.x) / d || 1, dz: (p.z - camp.z) / d, force: 10 } satisfies KnockMessage);
      return;
    }
    const trap = event.trap!;
    const def = worldCatalog.traps.get(trap.defId)!;
    const sprung = new TrapState();
    sprung.defId = trap.defId;
    sprung.x = trap.x;
    sprung.y = trap.y;
    sprung.z = trap.z;
    this.state.traps.set(trap.id, sprung);
    this.encounter(event.playerId, "trap", trap.id, trap.defId, event.effects, { once: true, dodged: event.dodged }, {
      title: def.name,
      text: event.dodged ? def.dodgeText : def.text,
    });
  }

  /**
   * Đưa một lần chạm trán vào engine luật, rồi báo riêng cho người đó kết quả kèm lời kể ngắn.
   * Trả về false nếu engine từ chối (vd. người đã gục, điểm đã có người tìm thấy).
   */
  private encounter(
    playerId: string,
    source: EncounterSource,
    refId: string,
    defId: string,
    effects: EncounterEffects,
    opts: { once?: boolean; dodged?: boolean; fatal?: boolean },
    message: { title: string; text: string },
    client = this.clientOf(playerId),
  ): boolean {
    const before = this.game.log.length;
    if (!this.dispatch({ type: "encounter", playerId, source, refId, defId, effects, ...opts }, client)) return false;
    const entry = this.game.log.slice(before).find((e) => e.kind === "encounter");
    if (!entry || entry.kind !== "encounter") return true;
    const values = Object.values(entry.effects).filter((v): v is number => typeof v === "number");
    const tone = values.some((v) => v < 0) ? "bad" : values.some((v) => v > 0) || entry.gained ? "good" : "neutral";
    client?.send(Messages.encounter, { ...message, tone, effects: entry.effects, gained: entry.gained } satisfies EncounterMessage);
    return true;
  }

  /** Chép vị trí sinh vật sang state: chỉ những con đã xuất hiện tính tới hôm nay. */
  private syncCreatures() {
    const active = this.wildlife.active(this.game.day);
    const ids = new Set(active.map((c) => c.id));
    for (const id of [...this.state.creatures.keys()]) if (!ids.has(id)) this.state.creatures.delete(id);
    for (const c of active) {
      let target = this.state.creatures.get(c.id);
      if (!target) {
        target = new CreatureState();
        target.species = c.def.id;
        this.state.creatures.set(c.id, target);
      }
      // Làm tròn cho đỡ gửi thừa khi con vật đứng yên.
      const round = (v: number) => Math.round(v * 100) / 100;
      if (target.x !== round(c.x)) target.x = round(c.x);
      if (target.y !== round(c.y)) target.y = round(c.y);
      if (target.z !== round(c.z)) target.z = round(c.z);
      if (target.rotY !== round(c.rotY)) target.rotY = round(c.rotY);
      if (target.mode !== c.mode) target.mode = c.mode;
      const hp = Math.round((c.hp / c.def.hp) * 100);
      if (target.hp !== hp) target.hp = hp;
      const stunned = c.stun > 0;
      if (target.stunned !== stunned) target.stunned = stunned;
    }
  }

  private playerOf(client: Client): string | undefined {
    return this.sessions.get(client.sessionId);
  }

  private clientOf(playerId: string): Client | undefined {
    const sessionId = this.state.players.get(playerId)?.sessionId;
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private hostOnly(client: Client): boolean {
    if (this.playerOf(client) === this.state.hostId) return true;
    this.reject(client, "Chỉ chủ phòng mới làm được việc này.");
    return false;
  }

  private lobbyOnly(client: Client): boolean {
    if (this.game.phase === "lobby") return true;
    this.reject(client, "Chỉ đổi được khi ván chưa bắt đầu.");
    return false;
  }

  /** Chạy một hành động qua engine luật. Hành động sai luật bị từ chối và báo lại cho người gửi. */
  private dispatch(action: GameAction, client?: Client): boolean {
    const phaseBefore = this.game.phase;
    try {
      this.game = reduce(this.game, action, gameConfig);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      if (client) this.reject(client, e.message);
      return false;
    }
    this.logFile.actions.push(action);
    if (this.game.phase !== phaseBefore) this.enterPhase();
    syncState(this.state, this.game);
    this.sendPrivate();
    return true;
  }

  /** Gửi phần thông tin riêng (vai, hành động đêm, ghi chú) cho đúng từng người, chỉ khi có thay đổi. */
  private sendPrivate() {
    for (const [id, player] of this.state.players) {
      const base = privateView(this.game, id, gameConfig);
      const view = base && { ...base, story: this.privateStory.get(id) ?? [] };
      const client = this.clients.find((c) => c.sessionId === player.sessionId);
      if (!view || !client) continue;
      const json = JSON.stringify(view);
      if (this.sentPrivate.get(id) === json) continue;
      this.sentPrivate.set(id, json);
      client.send(Messages.private, view);
    }
  }

  /**
   * Tin nhắn của một người đi tới đâu. Sảnh chờ: cả phòng. Ban đêm: người quanh đống lửa nói thì cả trại
   * và hồn ma nghe (người ngủ ngoài không biết cả trại bàn gì). Hồn ma chỉ nói được với hồn ma.
   */
  private chatRoute(sender: string): { channel: ChatChannel; to: string[] } | null {
    const players = Object.values(this.game.players);
    if (this.game.phase === "lobby") return { channel: "room", to: [...this.state.players.keys()] };
    const ghosts = players.filter((p) => !p.alive).map((p) => p.id);
    if (ghosts.includes(sender)) return { channel: "ghost", to: ghosts };
    if (this.game.phase !== "night") return null;
    const campers = this.game.campers.filter((id) => this.game.players[id]?.alive);
    return campers.includes(sender) ? { channel: "camp", to: [...campers, ...ghosts] } : null;
  }

  private reject(client: Client, reason: string) {
    client.send(Messages.rejected, { reason } satisfies RejectedMessage);
  }

  private enterPhase() {
    const phase = this.game.phase;
    const base = phase === "night" ? this.state.nightSeconds : isTimed(phase) ? PHASE_SECONDS[phase] : 0;
    this.state.shop.clear();
    this.state.shop.push(...this.game.shop);
    const seconds = base ? scaled(base) : 0;
    this.state.timeLeft = seconds;
    this.state.phaseDuration = seconds;
    this.ready.clear();
    this.updateReadyCount();
    if (phase !== "explore") this.eventTimers.clear();
    // Sáng ra, đàn thú khác tới thế chỗ những con đã bị giết.
    if (phase === "dawn") this.wildlife.respawn();
    if (phase === "ended") this.state.paused = false;
    this.tellStory(phase);
    void this.logWriter.save();
  }

  /**
   * Bộ sinh truyện: không gọi AI nào. Seed chọn một tổ hợp yếu tố truyện lúc bắt đầu; mỗi bình minh,
   * hoàng hôn và lúc kết thúc, bộ sinh trộn tổ hợp đó với sự thật engine đã ghi để viết lời kể.
   */
  private tellStory(phase: string) {
    if (phase === "create") {
      this.premise = createPremise(this.game.seed, this.game.playerOrder, storyLibrary, { id: this.game.twist, player: this.game.twistPlayer });
    }
    const ctx = this.storyContext();
    if (!ctx) return;
    const day = this.game.day;
    const publish = (kind: string, lines: string[]) => {
      const line = new StoryLineState();
      line.day = day;
      line.kind = kind;
      line.text = lines.join(" ");
      this.state.story.push(line);
    };
    if (phase === "dawn") {
      publish("dawn", narrateDawn(ctx, day));
      for (const id of this.game.playerOrder) {
        const lines = narratePrivate(ctx, id, day);
        if (lines.length > 0) this.privateStory.set(id, [...(this.privateStory.get(id) ?? []), { day, text: lines.join(" ") }]);
      }
      this.sendPrivate();
    }
    if (phase === "night" || phase === "ended") publish("dusk", narrateDusk(ctx, day));
    if (phase === "ended") {
      const awards = computeAwards(this.game, this.playCtl.feats);
      this.state.reveal.awards.clear();
      for (const a of awards) {
        const award = new AwardState();
        award.playerId = a.playerId;
        award.title = a.title;
        award.detail = a.detail;
        this.state.reveal.awards.push(award);
      }
      const c = chronicle(ctx, awards);
      const target = new ChronicleState();
      target.title = c.title;
      target.paragraphs.push(...c.paragraphs);
      this.state.chronicle = target;
    }
  }

  private storyContext(): StoryContext | null {
    if (!this.premise) return null;
    return { seed: this.game.seed, premise: this.premise, library: storyLibrary, state: this.game, config: gameConfig };
  }

  /** Ai cần bấm sẵn sàng: lúc chuẩn bị và bình minh là mọi người còn sống; ban đêm là người quanh đống lửa. */
  private readyEligible(): string[] {
    const present = (id: string) => this.game.players[id]?.alive && this.state.players.get(id)?.connected;
    if (["create", "pack", "dawn"].includes(this.game.phase)) return this.game.playerOrder.filter(present);
    if (this.game.phase === "night") return this.game.campers.filter(present);
    return [];
  }

  private updateReadyCount() {
    const eligible = this.readyEligible();
    this.state.readyNeeded = eligible.length;
    this.state.readyCount = eligible.filter((id) => this.ready.has(id)).length;
  }

  private checkEveryoneReady() {
    this.updateReadyCount();
    if (this.state.readyNeeded > 0 && this.state.readyCount === this.state.readyNeeded) {
      this.state.timeLeft = Math.min(this.state.timeLeft, READY_WRAP_UP_SECONDS);
    }
  }

  private tick() {
    if (this.state.paused) return;
    for (const [anchorId, left] of this.eventTimers) {
      if (left > 1) {
        this.eventTimers.set(anchorId, left - 1);
        continue;
      }
      // Không ai chọn: người mở thẻ coi như chọn lựa chọn đầu tiên.
      this.eventTimers.delete(anchorId);
      const placed = this.game.anchors[anchorId];
      const card = placed && gameConfig.cards.find((c) => c.id === placed.cardId);
      if (placed?.status === "active" && card) {
        this.dispatch({ type: "choose", playerId: placed.participants[0]!, anchorId, choiceId: card.choices[0]!.id });
      }
    }
    this.syncEventTimers();

    if (!isTimed(this.game.phase)) return;
    if (this.state.timeLeft > 1) {
      this.state.timeLeft--;
      return;
    }
    if (this.game.phase === "dusk") this.playCtl.ensureCamp();
    const camp = this.playCtl.camp();
    const atCamp =
      this.game.phase === "dusk"
        ? [...this.state.players.entries()]
            .filter(([, p]) => Math.hypot(p.x - camp.x, p.z - camp.z) <= CAMP_RADIUS || !p.connected)
            .map(([id]) => id)
        : undefined;
    this.dispatch({ type: "advance", atCamp });
  }

  private syncEventTimers() {
    for (const [anchorId, anchor] of this.state.anchors) {
      anchor.timeLeft = anchor.status === "active" ? (this.eventTimers.get(anchorId) ?? 0) : 0;
    }
  }

  private pickColor(): string {
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0]!;
  }

  private async uniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomRoomCode();
      if (!(await matchMaker.getRoomById(code))) return code;
    }
    throw new Error("Không tạo được mã phòng mới");
  }
}
