import { Room, matchMaker, type Client } from "@colyseus/core";
import { spawnPoint } from "@tentides/content";
import {
  IslandState,
  JoinOptions,
  MAX_PLAYERS,
  Messages,
  MoveMessage,
  PlayerState,
  type CorrectMessage,
} from "@tentides/protocol";
import { seedFromString } from "@tentides/rules";
import { isPlausibleMove } from "./movement.ts";
import { randomRoomCode } from "./roomCode.ts";

const PLAYER_COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#8a4fff", "#2a9d8f"];
const RECONNECT_SECONDS = 30;

export class IslandRoom extends Room<{ state: IslandState }> {
  maxClients = MAX_PLAYERS;
  state = new IslandState();

  /** Thời điểm nhận vị trí hợp lệ gần nhất của từng người, để tính tốc độ. */
  private lastMoveAt = new Map<string, number>();

  async onCreate() {
    this.roomId = await this.uniqueRoomCode();
    this.state.seed = seedFromString(`${this.roomId}:${Date.now()}`);

    this.onMessage(Messages.move, MoveMessage, (client, move) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      const elapsed = now - (this.lastMoveAt.get(client.sessionId) ?? now);
      if (!isPlausibleMove(player, move, elapsed)) {
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
  }

  onAuth(_client: Client, options: unknown) {
    // Tên người chơi chỉ là dữ liệu: cắt khoảng trắng, giới hạn độ dài.
    return JoinOptions.parse(options);
  }

  onJoin(client: Client, _options: unknown, auth: JoinOptions) {
    const index = this.state.players.size;
    const spawn = spawnPoint(index);
    const player = new PlayerState();
    player.name = auth.name;
    player.color = this.pickColor();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.rotY = Math.PI; // quay mặt vào đảo (hướng bắc)
    this.state.players.set(client.sessionId, player);
    this.lastMoveAt.set(client.sessionId, Date.now());
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
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
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
