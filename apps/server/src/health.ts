import { monitorEventLoopDelay } from "node:perf_hooks";
import { matchMaker } from "@colyseus/core";
import { liveRooms, type RoomHealth } from "./tickStats.ts";

// GET /health: số liệu gọn cho người vận hành (Render, curl): số phòng, số người, nhịp p95 từng phòng, bộ nhớ, độ trễ
// vòng lặp sự kiện. Chỉ có số tổng hợp, không có mã phòng hay tên người chơi (mã phòng là chìa khoá vào phòng).

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const startedAt = Date.now();

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
// Histogram đo cả độ phân giải của bộ hẹn giờ (20 ms): trừ ra, còn lại là độ trễ thật.
const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6 - 20) * 100) / 100);

export function healthReport() {
  const rooms: RoomHealth[] = [];
  for (const room of liveRooms) rooms.push(room.health());
  const mem = process.memoryUsage();
  const report = {
    ok: matchMaker.state !== matchMaker.MatchMakerState.SHUTTING_DOWN,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    rooms: rooms.length,
    ccu: rooms.reduce((n, r) => n + r.clients, 0),
    // Tồi nhất trong các phòng đang chạy: nhìn một con số là biết server có đang quá tải không.
    worstTickP95: rooms.reduce((m, r) => Math.max(m, r.tick.p95), 0),
    eventLoopLagMs: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) },
    memoryMb: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), external: mb(mem.external) },
    byRoom: rooms,
  };
  loop.reset();
  return report;
}
