import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_SERVER_PORT, ROOM_NAME } from "@tentides/protocol";
import { IslandRoom } from "./IslandRoom.ts";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    [ROOM_NAME]: defineRoom(IslandRoom),
  },
});

await server.listen(port);
console.log(`TEN TIDES server đang chạy ở ws://localhost:${port}`);
