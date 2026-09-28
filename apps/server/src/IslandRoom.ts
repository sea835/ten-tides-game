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
  storyLibrary,
  spawnPoint,
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
  ChronicleState,
  IslandState,
  StoryLineState,
  JoinOptions,
  KICKED_CLOSE_CODE,
  KickMessage,
  MAX_PLAYERS,
  Messages,
  MoveMessage,
  NightActionMessage,
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
  type RejectedMessage,
  type TimedPhase,
} from "@tentides/protocol";
import {
  RuleError,
  createGame,
  isBusy,
  privateView,
  reduce,
  seedFromString,
  type Difficulty,
  type GameAction,
  type GameState,
} from "@tentides/rules";
import { chronicle, createPremise, narrateDawn, narrateDusk, narratePrivate, type Premise, type StoryContext } from "@tentides/story";
import { GameLogWriter, type GameLogFile } from "./gameLog.ts";
import { playerIdFromToken } from "./identity.ts";
import { isPlausibleMove } from "./movement.ts";
import { randomRoomCode } from "./roomCode.ts";
import { syncState } from "./sync.ts";

const RECONNECT_SECONDS = 60;
/** Sai số khoảng cách khi mở thẻ: vị trí trên server trễ hơn client một chút. */
const TRIGGER_TOLERANCE = 1.5;
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
    syncState(this.state, this.game);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const id = this.playerOf(client);
      const player = id && this.state.players.get(id);
      if (!id || !player) return;

      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(id) ?? now);
      // Tạm dừng thì đứng yên; đang trong sự kiện thì đứng yên tới khi chọn xong;
      // bị trói thì không ra khỏi trại được.
      const frozen = this.state.paused || isBusy(this.game, id);
      const leavingCamp = this.game.players[id]?.tied && Math.hypot(move.x - CAMP.x, move.z - CAMP.z) > CAMP_RADIUS;
      if (frozen || leavingCamp || !isPlausibleMove(player, move, elapsed)) {
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
    });

    this.onMessage(Messages.settings, SettingsMessage, (client, settings) => {
      if (!this.hostOnly(client) || !this.lobbyOnly(client)) return;
      if (settings.difficulty) this.state.difficulty = settings.difficulty;
      if (settings.nightSeconds) this.state.nightSeconds = settings.nightSeconds;
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

    this.clock.setInterval(() => this.tick(), 1000);
  }

  onAuth(_client: Client, options: unknown): AuthData {
    const auth = JoinOptions.parse(options);
    const playerId = playerIdFromToken(auth.token);
    if (this.kicked.has(playerId)) throw new Error("Chủ phòng đã mời bạn ra khỏi phòng này.");
    // Ván đã bắt đầu thì chỉ người cũ (cùng token) mới vào lại được.
    if (this.game.phase !== "lobby" && !this.game.players[playerId]) throw new Error("Ván đã bắt đầu, không vào thêm được.");
    return { ...auth, playerId };
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
    } else {
      const spawn = spawnPoint(this.state.players.size);
      const player = new PlayerState();
      player.name = auth.name;
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
    if (phase === "ended") this.state.paused = false;
    this.tellStory(phase);
    void this.logWriter.save();
  }

  /**
   * Bộ sinh truyện: không gọi AI nào. Seed chọn một tổ hợp yếu tố truyện lúc bắt đầu; mỗi bình minh,
   * hoàng hôn và lúc kết thúc, bộ sinh trộn tổ hợp đó với sự thật engine đã ghi để viết lời kể.
   */
  private tellStory(phase: string) {
    if (phase === "create") this.premise = createPremise(this.game.seed, this.game.playerOrder, storyLibrary);
    if (!this.premise) return;
    const ctx: StoryContext = { seed: this.game.seed, premise: this.premise, library: storyLibrary, state: this.game, config: gameConfig };
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
      const c = chronicle(ctx);
      const target = new ChronicleState();
      target.title = c.title;
      target.paragraphs.push(...c.paragraphs);
      this.state.chronicle = target;
    }
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
    const atCamp =
      this.game.phase === "dusk"
        ? [...this.state.players.entries()]
            .filter(([, p]) => Math.hypot(p.x - CAMP.x, p.z - CAMP.z) <= CAMP_RADIUS || !p.connected)
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
