import { useEffect, useState } from "react";
import { ENDING_LABELS, NIGHT_ACTION_LABELS, ROLE_LABELS, content } from "@tentides/content";
import { Messages, type RejectedMessage } from "@tentides/protocol";
import { DIG_ITEM, type EndingId, type NightActionId, type RoleId, type Winner } from "@tentides/rules";
import { itemName } from "./format.ts";
import { myId, type IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

export function InteractPrompt({ room }: { room: IslandRoom }) {
  const { nearAnchor, atDigSite } = useHud();
  const cardId = useRoomSnapshot(room, (s) => (nearAnchor ? (s.anchors.get(nearAnchor)?.cardId ?? null) : null));
  const hasShovel = useRoomSnapshot(room, (s) => [...(s.players.get(myId(room))?.items ?? [])].includes(DIG_ITEM));
  if (atDigSite) {
    return (
      <div className="prompt">
        <kbd>E</kbd> Đào kho báu{!hasShovel && " (bạn không có xẻng)"}
      </div>
    );
  }
  if (!nearAnchor || !cardId) return null;
  return (
    <div className="prompt">
      <kbd>E</kbd> {content.cards.get(cardId)?.title ?? "Điểm sự kiện"}
    </div>
  );
}

export function Toast({ room }: { room: IslandRoom }) {
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

export function PausedOverlay({ room }: { room: IslandRoom }) {
  const paused = useRoomSnapshot(room, (s) => s.paused);
  if (!paused) return null;
  return (
    <div className="paused">
      <div className="panel">Chủ phòng đã tạm dừng ván. Đồng hồ và mọi người đứng yên.</div>
    </div>
  );
}

const WINNER_TEXT: Record<Winner, string> = {
  team: "Phe đội thắng",
  solo: "Một người thắng",
  traitor: "Phe phản bội thắng",
  none: "Không ai thắng",
};

/** Màn lật bài: kết thúc, vai của mọi người, hành động từng đêm, đồ bỏ túi. Khoảnh khắc "hoá ra là mày!". */
export function EndScreen({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const end = useRoomSnapshot(room, (s) => {
    if (s.phase !== "ended") return null;
    const name = (id: string) => s.players.get(id)?.name ?? "?";
    return {
      ending: s.ending as EndingId,
      winner: s.winner as Winner,
      solo: s.soloWinner ? name(s.soloWinner) : "",
      day: s.day,
      treasure: s.treasure,
      players: [...s.players.entries()].map(([id, p]) => ({
        id,
        name: p.name,
        color: p.color,
        alive: p.alive,
        role: (s.reveal.roles.get(id) ?? "villager") as RoleId,
        tied: [...s.reveal.tied].filter((t) => t === id).length,
      })),
      nights: [...s.reveal.nights].map((n) => ({ day: n.day, who: n.playerId, action: n.action as NightActionId, target: n.target ? name(n.target) : "" })),
      loot: [...s.reveal.loot].map((l) => `${name(l.playerId)}: ${itemName(l.itemId)}`),
      signals: s.reveal.signals,
      deceit: s.reveal.deceit,
      chronicle: { title: s.chronicle.title, paragraphs: [...s.chronicle.paragraphs] },
    };
  });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (end && document.pointerLockElement) document.exitPointerLock();
  }, [end]);
  if (!end) return null;
  const label = ENDING_LABELS[end.ending];
  const days = [...new Set(end.nights.map((n) => n.day))];

  return (
    <div className="end-screen">
      <div className="panel end-card">
        <div className="label">
          Kết thúc · ngày {end.day} · {WINNER_TEXT[end.winner]}
          {end.solo && `: ${end.solo}`}
        </div>
        <h1>{label.title}</h1>
        <p>{label.text}</p>

        {end.chronicle.title && (
          <section className="chronicle">
            <div className="label">Biên niên sử · {end.chronicle.title}</div>
            {end.chronicle.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <button
              onClick={() => {
                const text = [`TEN TIDES · ${end.chronicle.title}`, label.title, ...end.chronicle.paragraphs].join("\n\n");
                void navigator.clipboard.writeText(text).then(
                  () => setCopied(true),
                  () => prompt("Sao chép biên niên sử:", text),
                );
              }}
            >
              {copied ? "Đã sao chép!" : "Sao chép biên niên sử để chia sẻ"}
            </button>
          </section>
        )}

        <table className="reveal-table">
          <thead>
            <tr>
              <th>Người chơi</th>
              <th>Vai thật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {end.players.map((p) => (
              <tr key={p.id} className={ROLE_LABELS[p.role].side === "traitor" ? "traitor-row" : ""}>
                <td>
                  <span className="dot" style={{ background: p.color }} />
                  {p.name}
                </td>
                <td>{ROLE_LABELS[p.role].title}</td>
                <td className="hint">
                  {[
                    !p.alive && "đã gục",
                    p.tied > 0 && `bị trói ${p.tied} lần${ROLE_LABELS[p.role].side === "traitor" ? " (trói đúng)" : " (trói oan)"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {days.length > 0 && (
          <details className="timeline">
            <summary>Đêm đó thật ra đã xảy ra gì</summary>
            {days.map((d) => (
              <div key={d} className="timeline-night">
                <strong>Đêm {d}</strong>
                {end.nights
                  .filter((n) => n.day === d)
                  .map((n, i) => (
                    <div key={i} className={["sabotage", "signal", "forge", "pocket"].includes(n.action) ? "traitor-act" : ""}>
                      {end.players.find((p) => p.id === n.who)?.name}: {NIGHT_ACTION_LABELS[n.action]?.title ?? n.action}
                      {n.target && ` → ${n.target}`}
                    </div>
                  ))}
              </div>
            ))}
          </details>
        )}
        {end.loot.length > 0 && <p className="hint">Đồ kẻ lừa đảo bỏ túi: {end.loot.join(" · ")}</p>}
        {(end.signals > 0 || end.deceit > 0) && (
          <p className="hint">
            Tín hiệu gửi cho băng cướp: {end.signals} · số lần lừa: {end.deceit}
          </p>
        )}
        <p className="hint">Tiến độ kho báu cuối cùng: {end.treasure}%</p>
        <button className="primary" onClick={onLeave}>
          Về sảnh
        </button>
      </div>
    </div>
  );
}
