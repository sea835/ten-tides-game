import { useEffect, useState } from "react";
import { Callbacks } from "@colyseus/sdk";
import { ZONE_LABELS } from "@tentides/content";
import { MAX_PLAYERS } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { useHud } from "./hudStore.ts";

interface Roster {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

function useRoster(room: IslandRoom): Roster[] {
  const [roster, setRoster] = useState<Roster[]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () =>
      setRoster(
        [...room.state.players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, connected: p.connected })),
      );
    // onAdd gọi ngay cho cả những người đã có trong phòng, nên mảng phải tồn tại trước.
    const offs: (() => void)[] = [];
    offs.push(
      callbacks.onAdd("players", (player) => {
        refresh();
        offs.push(callbacks.listen(player, "connected", refresh));
      }),
      callbacks.onRemove("players", refresh),
    );
    refresh();
    return () => offs.forEach((off) => off());
  }, [room]);
  return roster;
}

export function Hud({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const { zone, deepWater } = useHud();
  const roster = useRoster(room);
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
    <div className="hud">
      <section className="panel room">
        <div className="label">Mã phòng</div>
        <div className="room-code">{room.roomId}</div>
        <button onClick={() => void copyInvite()}>{copied ? "Đã chép link!" : "Chép link mời"}</button>
        <ul className="roster">
          {roster.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              {p.id === room.sessionId && " (bạn)"}
            </li>
          ))}
        </ul>
        <div className="label">
          {roster.length}/{MAX_PLAYERS} người
        </div>
        <button className="ghost" onClick={onLeave}>
          Rời phòng
        </button>
      </section>

      <section className="panel zone">
        <div className="label">Ngày 1 · Graybox</div>
        <div className="zone-name">{ZONE_LABELS[zone]}</div>
        {deepWater && <div className="warning">Nước sâu quá, chưa bơi được.</div>}
      </section>

      <section className="panel help">
        Bấm vào màn hình để xoay camera bằng chuột · WASD di chuyển · Shift chạy · Space nhảy · Esc thả chuột
      </section>
    </div>
  );
}
