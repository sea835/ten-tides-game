import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameAction } from "@tentides/rules";

/** Nội dung một file log ván: đủ để phát lại (seed + chuỗi hành động) và để AI dùng sau (chat). */
export interface GameLogFile {
  version: 1;
  roomId: string;
  seed: number;
  /** Seed của thế giới (đảo nhỏ, hang, easter egg, sinh vật); bẫy dùng seed của ván. */
  worldSeed?: number;
  createdAt: string;
  actions: GameAction[];
  chat: { day: number; from: string; channel: string; text: string }[];
}

const LOG_DIR = process.env.GAME_LOG_DIR ?? "logs";

/** Ghi log ván ra đĩa. Mỗi lần ghi thay cả file; lần ghi sau chờ lần trước xong. */
export class GameLogWriter {
  readonly path: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly log: GameLogFile) {
    this.path = join(LOG_DIR, `${log.createdAt.replace(/[:.]/g, "-")}-${log.roomId}.json`);
  }

  save(): Promise<void> {
    const body = JSON.stringify(this.log);
    this.pending = this.pending
      .then(async () => {
        await mkdir(LOG_DIR, { recursive: true });
        await writeFile(this.path, body);
      })
      .catch((e) => console.error(`Không ghi được log ván ${this.log.roomId}:`, e));
    return this.pending;
  }
}
