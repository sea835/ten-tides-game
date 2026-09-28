import { useState } from "react";
import { MAX_PLAYERS, Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { BACKGROUND_LABELS } from "@tentides/content";
import { itemName } from "./format.ts";

export function RoomPanel({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => ({
    isHost: st.hostId === me,
    lobby: st.phase === "lobby",
    running: st.phase !== "lobby" && st.phase !== "ended",
    paused: st.paused,
    roster: [...st.players.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      alive: p.alive,
      tied: p.tied,
      hp: p.hp,
      maxHp: p.maxHp,
      host: id === st.hostId,
      background: p.background,
      items: [...p.items],
    })),
  }));
  const [copied, setCopied] = useState(false);
  const inviteLink = `${location.origin}${location.pathname}?room=${room.roomId}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Gửi link này cho bạn bè:", inviteLink);
    }
  }

  return (
    <section className="panel room">
      <div className="label">Mã phòng</div>
      <div className="room-code">{room.roomId}</div>
      <button onClick={() => void copyInvite()}>{copied ? "Đã chép link!" : "Chép link mời"}</button>
      <ul className="roster">
        {s.roster.map((p) => (
          <li
            key={p.id}
            className={p.connected && p.alive ? "" : "offline"}
            title={[
              BACKGROUND_LABELS[p.background as keyof typeof BACKGROUND_LABELS]?.title,
              p.items.length ? `Mang theo: ${p.items.map(itemName).join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n")}
          >
            <div className="roster-name">
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              {p.id === me && " (bạn)"}
              {p.host && " ★"}
              {!p.alive && " · đã gục"}
              {p.alive && p.tied && " · bị trói"}
              {p.alive && !p.connected && " · mất kết nối"}
              {s.isHost && s.lobby && p.id !== me && (
                <button className="kick" title="Mời ra khỏi phòng" onClick={() => room.send(Messages.kick, { playerId: p.id })}>
                  ✕
                </button>
              )}
            </div>
            {p.maxHp > 0 && <Bar value={p.hp} max={p.maxHp} color="#e4572e" />}
          </li>
        ))}
      </ul>
      <div className="label">
        {s.roster.length}/{MAX_PLAYERS} người · ★ chủ phòng
      </div>
      {s.isHost && s.running && <button onClick={() => room.send(Messages.pause)}>{s.paused ? "Chơi tiếp" : "Tạm dừng"}</button>}
      <button className="ghost" onClick={onLeave}>
        Rời phòng
      </button>
    </section>
  );
}
