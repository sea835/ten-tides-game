import { useEffect, useSyncExternalStore } from "react";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { getKillFeedback, resetKillStreak, subscribeKillFeedback } from "./killConfirm.ts";
import "./kills.css";

// Đầu lâu kim loại nảy dưới tâm ngắm mỗi lần hạ (viền vàng khi trúng đầu, đỏ khi trúng thân), xếp thành dãy khi hạ
// liên tiếp; thông báo chuỗi hạ (DOUBLE KILL, RAMPAGE!, KHÔNG THỂ CẢN PHÁ...) đập vào phía trên tâm ngắm.

/** Đầu lâu thép: sọ, hai hốc mắt, hốc mũi, hàm răng; thân tô dải kim loại, viền theo loại phát hạ. */
function SkullIcon({ head }: { head: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        className="sk-bone"
        d="M32 5C17 5 8 15 8 28c0 8 4 13 9 16v7c0 3 2 5 5 5h20c3 0 5-2 5-5v-7c5-3 9-8 9-16C56 15 47 5 32 5Z"
        fill="url(#sk-metal)"
        stroke={head ? "url(#sk-gold)" : "#e0322e"}
      />
      <path d="M14 22c3-9 10-13 18-13" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="22" cy="30" rx="6" ry="7" fill="#0d0f12" />
      <ellipse cx="42" cy="30" rx="6" ry="7" fill="#0d0f12" />
      <path d="M32 37l-4 7h8Z" fill="#0d0f12" />
      <path d="M25 49v7M32 49v7M39 49v7" stroke="#0d0f12" strokeWidth="2" />
    </svg>
  );
}

export function KillSkulls({ room }: { room: IslandRoom }) {
  const fb = useSyncExternalStore(subscribeKillFeedback, getKillFeedback);
  const alive = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.alive ?? false);
  // Gục thì mất chuỗi trong mạng; rời trận cũng vậy.
  useEffect(() => {
    if (!alive) resetKillStreak();
  }, [alive]);
  useEffect(() => () => resetKillStreak(), []);
  const shout = fb.shout;
  return (
    <>
      {/* Dải màu kim loại dùng chung cho mọi đầu lâu. */}
      <svg className="b-skull-defs" aria-hidden="true">
        <defs>
          <linearGradient id="sk-metal" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor="#fbfcfd" />
            <stop offset="0.38" stopColor="#aeb6be" />
            <stop offset="0.55" stopColor="#eef1f4" />
            <stop offset="1" stopColor="#59616a" />
          </linearGradient>
          <linearGradient id="sk-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1a8" />
            <stop offset="0.5" stopColor="#f2b51c" />
            <stop offset="1" stopColor="#9a6408" />
          </linearGradient>
        </defs>
      </svg>
      {fb.skulls.length > 0 && (
        <div key={fb.lastAt} className="b-skulls">
          {fb.skulls.map((s) => (
            <span key={s.id} className={s.head ? "head" : "body"}>
              <SkullIcon head={s.head} />
            </span>
          ))}
        </div>
      )}
      {shout && (
        <div key={shout.id} className={`b-streak t${shout.callout.tier}`} aria-live="polite">
          <b>{shout.callout.title}</b>
          <small>{shout.callout.sub}</small>
        </div>
      )}
    </>
  );
}
