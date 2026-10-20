import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BATTLE_ROOM_NAME, DEFAULT_SERVER_PORT, ROOM_NAME } from "@tentides/protocol";
import { IslandRoom } from "./IslandRoom.ts";
import { BattleRoom } from "./battle/BattleRoom.ts";
import { apiMiddleware } from "./api/api.ts";
import { allowOrigin, logCorsMode } from "./api/cors.ts";
import { proxyTrust } from "./api/clientIp.ts";
import { installJoinThrottle } from "./api/joinThrottle.ts";
import { initDb } from "./db/pool.ts";
import { flushGameLogs } from "./gameLog.ts";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// Bộ đệm mã hoá trạng thái phòng: mặc định 16 KB, trận 100 người (người, xe, đồ rơi) vượt quá nên mỗi lần gửi trọn
// trạng thái cho người mới vào, Colyseus phải cấp bộ đệm lớn hơn rồi mã hoá lại từ đầu. Đặt sẵn đủ lớn.
Encoder.BUFFER_SIZE = 128 * 1024;

// Tài khoản (PostgreSQL) là tuỳ chọn: không có DATABASE_URL hay database lỗi thì vẫn chạy cho khách.
await initDb();

// CORS của cổng matchmaking (/matchmake/...) và mọi request: Colyseus phản chiếu mọi origin; đổi sang danh sách CORS_ORIGINS.
// Không đặt thì giữ như cũ (cảnh báo) để bản đang chạy khỏi hỏng.
logCorsMode();
matchMaker.controller.getCorsHeaders = (headers) => ({ "Access-Control-Allow-Origin": allowOrigin(headers.get("origin") ?? undefined) });
// Dò mã phòng 4 ký tự: mỗi IP thất bại tối đa 20 lần mỗi phút.
installJoinThrottle();
const trust = proxyTrust();
console.log(trust.trusted ? `Tin X-Forwarded-For (mục thứ ${trust.hops} từ bên phải là IP người dùng)` : "Không tin X-Forwarded-For (chạy trực tiếp): đặt TRUST_PROXY=1 khi đứng sau proxy");

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

// Tắt êm (Render gửi SIGTERM khi triển khai bản mới): Colyseus tự bắt SIGINT, SIGTERM (gracefullyShutdown mặc định):
// ngừng nhận phòng mới (matchmaking trả 503), khoá và đóng từng phòng (onDispose ghi nốt log ván, XP đang chờ), ngắt
// kết nối cho client tự nối lại. Việc của ta là chờ log ván ghi xong trước khi thoát: xem onShutdown.
// Render chờ ~30 giây sau SIGTERM rồi SIGKILL; phòng còn người giữ chỗ nối lại có thể kéo dài hơn: tự thoát trước hạn đó.
process.once("SIGTERM", () => setTimeout(() => process.exit(0), 25_000).unref());
server.onShutdown(async () => {
  await flushGameLogs();
  console.log("Đã tắt êm: đóng hết phòng, ghi xong log ván.");
});

await server.listen(port);
console.log(`TEN TIDES server đang chạy ở ws://localhost:${port}`);
