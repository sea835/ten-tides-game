import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  ANCHORS,
  ANCHOR_PARTICIPANT_RADIUS,
  ANCHOR_TRIGGER_RADIUS,
  CAMP,
  CAMP_RADIUS,
  gameConfig,
  spawnPoint,
} from "@tentides/content";
import {
  CHAT_MIN_INTERVAL_MS,
  ChatMessage,
  ChooseMessage,
  EVENT_TIMEOUT_SECONDS,
  IslandState,
  JoinOptions,
  MAX_PLAYERS,
  Messages,
  MoveMessage,
  PHASE_SECONDS,
  PlayerState,
  TriggerMessage,
  VoteMessage,
  type ChatBroadcast,
  type CorrectMessage,
  type RejectedMessage,
  type TimedPhase,
} from "@tentides/protocol";
import {
  RuleError,
  createGame,
  isBusy,
  reduce,
  seedFromString,
  type GameAction,
  type GameState,
} from "@tentides/rules";
import { isPlausibleMove } from "./movement.ts";
import { randomRoomCode } from "./roomCode.ts";
import { syncState } from "./sync.ts";

const PLAYER_COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#8a4fff", "#2a9d8f"];
const RECONNECT_SECONDS = 30;
/** Sai số khoảng cách khi mở thẻ: vị trí trên server trễ hơn client một chút. */
const TRIGGER_TOLERANCE = 1.5;
/** Co giãn thời lượng các pha khi dev, vd. PHASE_SCALE=0.1 để một ngày chỉ còn 30 giây. */
const PHASE_SCALE = Number(process.env.PHASE_SCALE ?? 1);
/** Cả trại đã bầu xong thì đêm rút ngắn còn chừng này giây. */
const NIGHT_WRAP_UP_SECONDS = 5;

function isTimed(phase: string): phase is TimedPhase {
  return phase in PHASE_SECONDS;
}

export class IslandRoom extends Room<{ state: IslandState }> {
  maxClients = MAX_PLAYERS;
  state = new IslandState();

  /** Engine luật là nguồn sự thật; state của Colyseus chỉ là bản chiếu công khai. */
  private game!: GameState;
  /** Event sourcing: seed + chuỗi hành động là đủ để phát lại cả ván. */
  readonly actions: GameAction[] = [];
  private lastMoveAt = new Map<string, number>();
  private eventTimers = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  /** Biên bản chat từng đêm, để sau này AI dùng làm dữ liệu kể chuyện (không nằm trong state đồng bộ). */
  readonly chatLog: { day: number; from: string; text: string }[] = [];

  async onCreate() {
    this.roomId = await this.uniqueRoomCode();
    this.game = createGame(seedFromString(`${this.roomId}:${Date.now()}`));
    syncState(this.state, this.game);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(client.sessionId) ?? now);
      // Người đang trong sự kiện phải đứng yên tại chỗ cho tới khi chọn xong;
      // người bị trói không ra khỏi trại được.
      const frozen = isBusy(this.game, client.sessionId);
      const leavingCamp = this.game.players[client.sessionId]?.tied && Math.hypot(move.x - CAMP.x, move.z - CAMP.z) > CAMP_RADIUS;
      if (frozen || leavingCamp || !isPlausibleMove(player, move, elapsed)) {
        client.send(Messages.correct, { x: player.x, y: player.y, z: player.z } satisfies CorrectMessage);
        return;
      }
      this.lastMoveAt.set(client.sessionId, now);
      player.x = move.x;
      player.y = move.y;
      player.z = move.z;
      player.rotY = move.rotY;
      player.moving = move.moving;
    });

    this.onMessage(Messages.start, (client) => {
      if (client.sessionId !== this.state.hostId) return this.reject(client, "Chỉ chủ phòng mới bắt đầu được ván.");
      if (this.dispatch({ type: "start" }, client)) void this.lock();
    });

    this.onMessage(Messages.trigger, TriggerMessage, (client, { anchorId }) => {
      const anchor = ANCHORS.find((a) => a.id === anchorId);
      const player = this.state.players.get(client.sessionId);
      if (!anchor || !player) return;
      if (Math.hypot(player.x - anchor.x, player.z - anchor.z) > ANCHOR_TRIGGER_RADIUS + TRIGGER_TOLERANCE) {
        return this.reject(client, "Hãy đứng sát điểm sự kiện hơn.");
      }
      const participants = [...this.state.players.entries()]
        .filter(([, p]) => p.connected && Math.hypot(p.x - anchor.x, p.z - anchor.z) <= ANCHOR_PARTICIPANT_RADIUS)
        .map(([id]) => id);
      if (this.dispatch({ type: "trigger", playerId: client.sessionId, anchorId, participants }, client)) {
        this.eventTimers.set(anchorId, EVENT_TIMEOUT_SECONDS);
        this.syncEventTimers();
      }
    });

    this.onMessage(Messages.choose, ChooseMessage, (client, { anchorId, choiceId }) => {
      if (this.dispatch({ type: "choose", playerId: client.sessionId, anchorId, choiceId }, client)) {
        this.eventTimers.delete(anchorId);
      }
    });

    this.onMessage(Messages.vote, VoteMessage, (client, vote) => {
      if (!this.dispatch({ type: "vote", playerId: client.sessionId, ...vote }, client)) return;
      // Ai đang có mặt cũng đã bầu cả hai phiếu thì không cần chờ hết đêm.
      const everyoneVoted = this.game.campers
        .filter((id) => this.state.players.get(id)?.connected)
        .every((id) => this.game.votes.ration[id] && this.game.votes.tie[id]);
      if (everyoneVoted) this.state.timeLeft = Math.min(this.state.timeLeft, NIGHT_WRAP_UP_SECONDS);
    });

    this.onMessage(Messages.chat, ChatMessage, (client, { text }) => {
      const listeners = this.chatAudience(client.sessionId);
      if (!listeners) {
        const outside = this.game.phase === "night";
        return this.reject(client, outside ? "Bạn đang ngủ ngoài, không ai ở trại nghe thấy bạn." : "Chỉ nói chuyện được ở sảnh chờ hoặc quanh đống lửa ban đêm.");
      }
      const now = Date.now();
      if (now - (this.lastChatAt.get(client.sessionId) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      this.lastChatAt.set(client.sessionId, now);

      const name = this.state.players.get(client.sessionId)?.name ?? "?";
      this.chatLog.push({ day: this.game.day, from: client.sessionId, text });
      const message: ChatBroadcast = { from: client.sessionId, name, text };
      for (const c of this.clients) if (listeners.includes(c.sessionId)) c.send(Messages.chat, message);
    });

    this.clock.setInterval(() => this.tick(), 1000);
  }

  onAuth(_client: Client, options: unknown) {
    if (this.game.phase !== "lobby") throw new Error("Ván đã bắt đầu, không vào thêm được.");
    // Tên người chơi chỉ là dữ liệu: cắt khoảng trắng, giới hạn độ dài.
    return JoinOptions.parse(options);
  }

  onJoin(client: Client, _options: unknown, auth: JoinOptions) {
    const spawn = spawnPoint(this.state.players.size);
    const player = new PlayerState();
    player.name = auth.name;
    player.color = this.pickColor();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.rotY = Math.PI; // quay mặt vào đảo (hướng bắc)
    this.state.players.set(client.sessionId, player);
    this.lastMoveAt.set(client.sessionId, Date.now());
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.dispatch({ type: "join", playerId: client.sessionId, name: auth.name });
  }

  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.lastMoveAt.set(client.sessionId, Date.now());
  }

  onLeave(client: Client) {
    this.lastMoveAt.delete(client.sessionId);
    if (this.game.phase === "lobby") {
      this.dispatch({ type: "leave", playerId: client.sessionId });
      this.state.players.delete(client.sessionId);
    } else {
      // Ván đã bắt đầu: nhân vật ở lại, coi như bot ngồi yên trong trại.
      const player = this.state.players.get(client.sessionId);
      if (player) player.connected = false;
    }
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = [...this.state.players.entries()].find(([, p]) => p.connected)?.[0] ?? "";
    }
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
    this.actions.push(action);
    if (this.game.phase !== phaseBefore) this.enterPhase();
    syncState(this.state, this.game);
    return true;
  }

  /**
   * Ai được nghe một tin nhắn: ở sảnh chờ thì cả phòng; ban đêm thì chỉ những người đang ngồi quanh
   * đống lửa (người ngủ ngoài không biết cả trại bàn gì). Trả về null nếu người gửi không được nói lúc này.
   */
  private chatAudience(sender: string): string[] | null {
    if (this.game.phase === "lobby") return [...this.state.players.keys()];
    if (this.game.phase !== "night") return null;
    const campers = this.game.campers.filter((id) => this.game.players[id]?.alive);
    return campers.includes(sender) ? campers : null;
  }

  private reject(client: Client, reason: string) {
    client.send(Messages.rejected, { reason } satisfies RejectedMessage);
  }

  private enterPhase() {
    const phase = this.game.phase;
    const seconds = isTimed(phase) ? Math.max(1, Math.round(PHASE_SECONDS[phase] * PHASE_SCALE)) : 0;
    this.state.timeLeft = seconds;
    this.state.phaseDuration = seconds;
    if (phase !== "explore") this.eventTimers.clear();
  }

  private tick() {
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
