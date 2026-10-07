import { defineRoom, defineServer } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BATTLE_ROOM_NAME, DEFAULT_SERVER_PORT, ROOM_NAME } from "@tentides/protocol";
import { IslandRoom } from "./IslandRoom.ts";
import { BattleRoom } from "./battle/BattleRoom.ts";
import { apiMiddleware } from "./api/api.ts";
import { initDb } from "./db/pool.ts";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// Bộ đệm mã hoá trạng thái phòng: mặc định 16 KB, trận 100 người (người, xe, đồ rơi) vượt quá nên mỗi lần gửi trọn
// trạng thái cho người mới vào, Colyseus phải cấp bộ đệm lớn hơn rồi mã hoá lại từ đầu. Đặt sẵn đủ lớn.
Encoder.BUFFER_SIZE = 128 * 1024;

// Tài khoản (PostgreSQL) là tuỳ chọn: không có DATABASE_URL hay database lỗi thì vẫn chạy cho khách.
await initDb();

const server = defineServer({
  transport: new WebSocketTransport(),
  // API tài khoản, gacha (/api/...) chạy chung cổng với Colyseus.
  express: (app) => {
    app.use(apiMiddleware);
  },
  rooms: {
    [ROOM_NAME]: defineRoom(IslandRoom),
    [BATTLE_ROOM_NAME]: defineRoom(BattleRoom),
  },
});

await server.listen(port);
console.log(`TEN TIDES server đang chạy ở ws://localhost:${port}`);
