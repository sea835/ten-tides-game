import { useEffect, useState, type ReactNode } from "react";
import { ENDING_LABELS, PHASE_LABELS, RATION_LABELS, ZONE_LABELS, content } from "@tentides/content";
import { MAX_PLAYERS, Messages, type RejectedMessage } from "@tentides/protocol";
import { STAT_IDS, STAT_LABELS, TOTAL_DAYS, WEATHER_LABELS, type EndingId, type Phase, type RationId, type WeatherId } from "@tentides/rules";
import type { IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { listenChat } from "../chatStore.ts";
import { Campfire, LobbyChat } from "./Campfire.tsx";
import { EventCard } from "./EventCard.tsx";
import { itemName, signed } from "./format.ts";

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

function RoomPanel({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const roster = useRoomSnapshot(room, (s) =>
    [...s.players.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      alive: p.alive,
      hp: p.hp,
      maxHp: p.maxHp,
    })),
  );
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
        {roster.map((p) => (
          <li key={p.id} className={p.connected && p.alive ? "" : "offline"}>
            <div className="roster-name">
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              {p.id === room.sessionId && " (bạn)"}
              {!p.alive && " · đã gục"}
              {p.alive && !p.connected && " · mất kết nối"}
            </div>
            {p.maxHp > 0 && <Bar value={p.hp} max={p.maxHp} color="#e4572e" />}
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
  );
}

function StatusPanel({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase as Phase,
    day: st.day,
    timeLeft: st.timeLeft,
    weather: st.weather as WeatherId | "",
    volcano: st.volcano,
    food: st.food,
    treasure: st.treasure,
    hull: st.hull,
  }));
  const { zone, deepWater } = useHud();
  const started = s.phase !== "lobby";

  return (
    <section className="panel status">
      <div className="label">
        {started ? `Ngày ${s.day}/${TOTAL_DAYS} · ` : ""}
        {PHASE_LABELS[s.phase]}
        {s.timeLeft > 0 && ` · ${s.timeLeft}s`}
      </div>
      <div className="zone-name">{ZONE_LABELS[zone]}</div>
      {deepWater && <div className="warning">Nước sâu quá, chưa bơi được.</div>}
      {started && (
        <dl className="team">
          <dt>Thời tiết</dt>
          <dd>{s.weather ? WEATHER_LABELS[s.weather] : "–"}</dd>
          <dt>Núi lửa</dt>
          <dd>
            <Bar value={s.volcano} max={100} color="#ff6b35" />
          </dd>
          <dt>Lương thực</dt>
          <dd>{s.food} khẩu phần</dd>
          <dt>Kho báu</dt>
          <dd>
            <Bar value={s.treasure} max={100} color="#f3a712" />
          </dd>
          <dt>Thuyền</dt>
          <dd>
            <Bar value={s.hull} max={100} color="#669bbc" />
          </dd>
        </dl>
      )}
    </section>
  );
}

function SelfPanel({ room }: { room: IslandRoom }) {
  const me = useRoomSnapshot(room, (s) => {
    const p = s.players.get(room.sessionId);
    if (!p || p.maxHp === 0) return null;
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      hunger: p.hunger,
      morale: p.morale,
      stamina: p.stamina,
      alive: p.alive,
      lost: p.lost,
      tied: p.tied,
      stats: STAT_IDS.map((id) => [id, p.stats.get(id) ?? 0] as const),
      items: [...p.items],
    };
  });
  if (!me) return null;

  return (
    <section className="panel self">
      {!me.alive && <div className="warning">Bạn đã gục ngã. Giờ bạn chỉ còn xem đồng đội.</div>}
      {me.lost && <div className="warning">Bạn đang lạc, không mở được sự kiện nào tới hoàng hôn.</div>}
      {me.tied && <div className="warning">Bạn bị cả trại trói: không ra khỏi trại, không mở được sự kiện, tới hoàng hôn mới được thả.</div>}
      <div className="vitals">
        <span>Máu</span>
        <Bar value={me.hp} max={me.maxHp} color="#e4572e" />
        <span>No</span>
        <Bar value={me.hunger} max={100} color="#f3a712" />
        <span>Tinh thần</span>
        <Bar value={me.morale} max={100} color="#8a4fff" />
        <span>Sức bền</span>
        <Bar value={me.stamina} max={100} color="#2a9d8f" />
      </div>
      <div className="stats">
        {me.stats.map(([id, v]) => (
          <span key={id}>
            {STAT_LABELS[id]} <strong>{v}</strong>
          </span>
        ))}
      </div>
      <div className="label">Balo tạm</div>
      <div className="items">{me.items.length ? me.items.map((id, i) => <span key={i}>{itemName(id)}</span>) : "Trống"}</div>
    </section>
  );
}

function Feed({ room }: { room: IslandRoom }) {
  const lines = useRoomSnapshot(room, (s) => {
    const name = (id: string) => s.players.get(id)?.name ?? "?";
    return [...s.log].slice(-6).map((e) => {
      if (e.kind === "check") {
        const card = content.cards.get(e.cardId);
        const bonus = [...e.modifiers].reduce((sum, m) => sum + m.value, 0);
        return {
          ok: e.success,
          text: `${name(e.playerId)} · ${card?.title ?? e.cardId}: ${e.roll} ${signed(bonus)} = ${e.total} / ${e.dc}`,
        };
      }
      if (e.kind === "dusk") {
        const outside = [...e.players].map(name);
        return {
          ok: outside.length === 0,
          text: outside.length ? `Hoàng hôn ngày ${e.day}: ${outside.join(", ")} ngủ ngoài` : `Hoàng hôn ngày ${e.day}: cả đội về trại đủ`,
        };
      }
      if (e.kind === "night") {
        const starving = [...e.starving].map(name);
        return {
          ok: starving.length === 0 && !e.playerId,
          text: [
            `Đêm ${e.day}: ${RATION_LABELS[e.ration as RationId]?.title ?? e.ration}, ăn ${e.amount} khẩu phần`,
            e.playerId ? `trói ${name(e.playerId)}` : "",
            starving.length ? `đói lả: ${starving.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }
      return { ok: false, text: `${name(e.playerId)} đã gục ngã.` };
    });
  });
  if (lines.length === 0) return null;
  return (
    <section className="panel feed">
      {lines.map((l, i) => (
        <div key={i} className={l.ok ? "feed-line ok" : "feed-line bad"}>
          {l.text}
        </div>
      ))}
    </section>
  );
}

function PhaseBanner({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    day: st.day,
    timeLeft: st.timeLeft,
    weather: st.weather as WeatherId | "",
    volcano: st.volcano,
    isHost: st.hostId === room.sessionId,
    hostName: st.players.get(st.hostId)?.name ?? "",
    players: st.players.size,
  }));

  let body: ReactNode = null;
  if (s.phase === "lobby") {
    body = s.isHost ? (
      <>
        <div>Đợi đủ bạn rồi bắt đầu. Một ngày kéo dài khoảng 5 phút.</div>
        <button className="primary" onClick={() => room.send(Messages.start)}>
          Bắt đầu ván ({s.players} người)
        </button>
      </>
    ) : (
      <div>Đang chờ {s.hostName} bắt đầu ván…</div>
    );
  } else if (s.phase === "dawn") {
    body = (
      <>
        <strong>
          Ngày {s.day} · {s.weather ? WEATHER_LABELS[s.weather] : ""} · Núi lửa {s.volcano}%
        </strong>
        <div>Cột sáng là nơi có chuyện đang chờ. Chia nhau ra mà đi, còn {s.timeLeft}s là trời sáng hẳn.</div>
      </>
    );
  } else if (s.phase === "dusk") {
    body = (
      <>
        <strong>Hoàng hôn · về trại trong {s.timeLeft}s</strong>
        <div>Ai ở ngoài lúc trời tối phải ngủ ngoài: mất sức, không được ăn, không được ngồi bàn với cả trại.</div>
      </>
    );
  } else if (s.phase === "night") {
    body = (
      <>
        <strong>Đêm · còn {s.timeLeft}s</strong>
        <div>Quây quần bên đống lửa: bàn chuyện, chia khẩu phần, và quyết định có trói ai không.</div>
      </>
    );
  }
  if (!body) return null;
  return <section className="panel banner">{body}</section>;
}

function InteractPrompt({ room }: { room: IslandRoom }) {
  const { nearAnchor } = useHud();
  const cardId = useRoomSnapshot(room, (s) => (nearAnchor ? (s.anchors.get(nearAnchor)?.cardId ?? null) : null));
  if (!nearAnchor || !cardId) return null;
  return (
    <div className="prompt">
      <kbd>E</kbd> {content.cards.get(cardId)?.title ?? "Điểm sự kiện"}
    </div>
  );
}

function Toast({ room }: { room: IslandRoom }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = room.onMessage(Messages.rejected, (m: RejectedMessage) => {
      setMessage(m.reason);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [room]);
  return message ? <div className="toast">{message}</div> : null;
}

function EndScreen({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const end = useRoomSnapshot(room, (s) =>
    s.phase === "ended"
      ? {
          ending: s.ending as EndingId,
          day: s.day,
          treasure: s.treasure,
          survivors: [...s.players.values()].filter((p) => p.alive).map((p) => p.name),
          fallen: [...s.players.values()].filter((p) => !p.alive).map((p) => p.name),
        }
      : null,
  );
  useEffect(() => {
    if (end && document.pointerLockElement) document.exitPointerLock();
  }, [end]);
  if (!end) return null;
  const label = ENDING_LABELS[end.ending];
  return (
    <div className="end-screen">
      <div className="panel end-card">
        <div className="label">Kết thúc · ngày {end.day}</div>
        <h1>{label.title}</h1>
        <p>{label.text}</p>
        <p>Tiến độ kho báu: {end.treasure}%</p>
        {end.survivors.length > 0 && <p>Sống sót: {end.survivors.join(", ")}</p>}
        {end.fallen.length > 0 && <p>Nằm lại đảo: {end.fallen.join(", ")}</p>}
        <button className="primary" onClick={onLeave}>
          Về sảnh
        </button>
      </div>
    </div>
  );
}

export function Hud({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  useEffect(() => listenChat(room), [room]);
  return (
    <div className="hud">
      <RoomPanel room={room} onLeave={onLeave} />
      <StatusPanel room={room} />
      <PhaseBanner room={room} />
      <SelfPanel room={room} />
      <Feed room={room} />
      <InteractPrompt room={room} />
      <EventCard room={room} />
      <Campfire room={room} />
      <LobbyChat room={room} />
      <Toast room={room} />
      <EndScreen room={room} onLeave={onLeave} />
      <section className="panel help">
        Bấm vào màn hình để xoay camera · WASD di chuyển · Shift chạy · Space nhảy · E mở sự kiện · Enter chat · Esc thả chuột
      </section>
    </div>
  );
}
