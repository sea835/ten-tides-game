import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Crown, Link, Lock, LogOut, Music, Pause, Play, Skull, Volume2, VolumeX, WifiOff, X } from "lucide-react";
import { audio } from "../sound/engine.ts";
import { BACKGROUND_LABELS } from "@tentides/content";
import { MAX_PLAYERS, Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { itemName } from "./format.ts";
import { Avatar } from "./ui.tsx";

/** Rời phòng giữa ván phải bấm hai lần, tránh lỡ tay bỏ cả đoàn. */
function LeaveButton({ onLeave, confirm }: { onLeave: () => void; confirm: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={armed ? "icon-btn danger armed" : "icon-btn"}
      title="Rời phòng"
      onClick={() => (confirm && !armed ? setArmed(true) : onLeave())}
    >
      <LogOut size={16} aria-hidden />
      {armed && <span>Bấm lần nữa để rời</span>}
    </button>
  );
}

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

  const roster = (
    <ul className="roster">
      {s.roster.map((p) => (
        <li
          key={p.id}
          className={[p.id === me && "me", !p.alive && "dead", !p.connected && "offline"].filter(Boolean).join(" ")}
          title={
            s.lobby
              ? undefined
              : [
                  BACKGROUND_LABELS[p.background as keyof typeof BACKGROUND_LABELS]?.title,
                  p.items.length ? `Mang theo: ${p.items.map(itemName).join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")
          }
        >
          <Avatar name={p.name} color={p.color} size="sm" dim={!p.alive || !p.connected} />
          <div className="roster-body">
            <div className="roster-name">
              <span className="name">{p.name}</span>
              {p.id === me && <span className="you">bạn</span>}
              {p.host && <Crown size={13} className="i-host" aria-label="Chủ phòng" />}
              {!p.alive && <Skull size={13} className="i-dead" aria-label="Đã gục" />}
              {p.alive && p.tied && <Lock size={13} className="i-tied" aria-label="Bị trói" />}
              {p.alive && !p.connected && <WifiOff size={13} className="i-off" aria-label="Mất kết nối" />}
              {s.isHost && s.lobby && p.id !== me && (
                <button className="kick" title={`Mời ${p.name} ra khỏi phòng`} onClick={() => room.send(Messages.kick, { playerId: p.id })}>
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
            {!s.lobby && p.maxHp > 0 && <Bar value={p.hp} max={p.maxHp} color="var(--hp)" size="sm" />}
          </div>
        </li>
      ))}
      {s.lobby &&
        Array.from({ length: MAX_PLAYERS - s.roster.length }, (_, i) => (
          <li key={`empty${i}`} className="empty">
            <span className="avatar sm slot" />
            <span className="hint">Chỗ trống</span>
          </li>
        ))}
    </ul>
  );

  if (s.lobby) {
    return (
      <section className="panel room lobby-room">
        <div className="label">Mã phòng</div>
        <div className="room-code">{room.roomId}</div>
        <button onClick={() => void copyInvite()}>
          {copied ? <Check size={16} aria-hidden /> : <Link size={16} aria-hidden />}
          {copied ? "Đã chép link" : "Chép link mời"}
        </button>
        <div className="label">
          Người chơi · {s.roster.length}/{MAX_PLAYERS}
        </div>
        {roster}
        <button className="ghost" onClick={onLeave}>
          <LogOut size={14} aria-hidden /> Rời phòng
        </button>
      </section>
    );
  }

  return (
    <section className="panel room">
      <header className="room-head">
        <button className="room-chip" title="Chép link mời" onClick={() => void copyInvite()}>
          {copied ? <Check size={13} aria-hidden /> : <Link size={13} aria-hidden />}
          <span className="room-code">{room.roomId}</span>
        </button>
        <div className="room-actions">
          {s.isHost && s.running && (
            <button className="icon-btn" title={s.paused ? "Chơi tiếp" : "Tạm dừng"} onClick={() => room.send(Messages.pause)}>
              {s.paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            </button>
          )}
          <SoundButtons />
          <LeaveButton onLeave={onLeave} confirm={s.running} />
        </div>
      </header>
      {roster}
    </section>
  );
}

/** Bật/tắt âm thanh (M) và nhạc nền (N). */
function SoundButtons() {
  const settings = useSyncExternalStore(audio.subscribe, () => audio.settings);
  return (
    <>
      <button className={settings.music && !settings.muted ? "icon-btn" : "icon-btn off"} title={settings.music ? "Tắt nhạc (N)" : "Bật nhạc (N)"} onClick={() => audio.setMusic(!settings.music)}>
        <Music size={15} aria-hidden />
      </button>
      <button className="icon-btn" title={settings.muted ? "Bật âm thanh (M)" : "Tắt âm thanh (M)"} onClick={() => audio.setMuted(!settings.muted)}>
        {settings.muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
      </button>
    </>
  );
}
