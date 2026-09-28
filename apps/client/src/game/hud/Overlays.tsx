import { useEffect, useState } from "react";
import { Armchair, Ban, Check, ChevronDown, Copy, EyeOff, Gem, Keyboard, LogOut, Pause, Shovel, Sparkles } from "lucide-react";
import { ENDING_LABELS, NIGHT_ACTION_LABELS, ROLE_LABELS, content } from "@tentides/content";
import { Messages, type RejectedMessage } from "@tentides/protocol";
import { DIG_ITEM, type EndingId, type NightActionId, type RoleId, type Winner } from "@tentides/rules";
import { itemName } from "./format.ts";
import { myId, type IslandRoom } from "../../net.ts";
import { useQuality } from "../graphics.ts";
import { useHud } from "../hudStore.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Avatar } from "./ui.tsx";

export function InteractPrompt({ room }: { room: IslandRoom }) {
  const { nearAnchor, atDigSite } = useHud();
  const cardId = useRoomSnapshot(room, (s) => (nearAnchor ? (s.anchors.get(nearAnchor)?.cardId ?? null) : null));
  const hasShovel = useRoomSnapshot(room, (s) => [...(s.players.get(myId(room))?.items ?? [])].includes(DIG_ITEM));
  if (atDigSite) {
    return (
      <div className={hasShovel ? "prompt treasure" : "prompt"}>
        <kbd>E</kbd>
        <Shovel size={16} aria-hidden />
        Đào kho báu{!hasShovel && <span className="hint"> · bạn không có xẻng</span>}
      </div>
    );
  }
  if (!nearAnchor || !cardId) return null;
  return (
    <div className="prompt">
      <kbd>E</kbd>
      <Sparkles size={16} aria-hidden />
      {content.cards.get(cardId)?.title ?? "Điểm sự kiện"}
    </div>
  );
}

/** Nhãn tư thế: đang ngồi (nghỉ, hồi sức nhanh), hoặc đang nấp trong cỏ cao. */
export function PostureBadge() {
  const { sitting, hidden } = useHud();
  if (!sitting) return null;
  return (
    <div className={hidden ? "posture hidden" : "posture"}>
      {hidden ? <EyeOff size={15} aria-hidden /> : <Armchair size={15} aria-hidden />}
      {hidden ? "Đang nấp trong cỏ: người khác không thấy tên và chấm của bạn" : "Đang ngồi nghỉ, hồi sức nhanh hơn"}
      <span className="hint">
        <kbd>C</kbd> đứng dậy
      </span>
    </div>
  );
}

export function Toast({ room }: { room: IslandRoom }) {
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = room.onMessage(Messages.rejected, (m: RejectedMessage) => {
      setMessage({ text: m.reason, key: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [room]);
  return message ? (
    <div key={message.key} className="toast" role="status">
      <Ban size={16} aria-hidden />
      {message.text}
    </div>
  ) : null;
}

export function PausedOverlay({ room }: { room: IslandRoom }) {
  const paused = useRoomSnapshot(room, (s) => s.paused);
  if (!paused) return null;
  return (
    <div className="paused">
      <div className="paused-card">
        <Pause size={28} aria-hidden />
        <strong>Tạm dừng</strong>
        <span className="hint">Chủ phòng đã tạm dừng ván. Đồng hồ và mọi người đứng yên.</span>
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["WASD", "Di chuyển"],
  ["Shift", "Chạy"],
  ["Space", "Nhảy"],
  ["C", "Ngồi · đứng"],
  ["E", "Mở sự kiện · đào"],
  ["B", "Xem balo"],
  ["J", "Sổ truyện"],
  ["Enter", "Chat"],
  ["Esc", "Thả chuột"],
  ["1–4", "Chọn lựa chọn"],
];
const HELP_KEY = "tentides.help";

/** Bảng phím tắt, H để bật tắt. Lần đầu chơi thì mở sẵn, lần sau nhớ lựa chọn của người chơi. */
export function KeyHints() {
  const quality = useQuality();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HELP_KEY, open ? "open" : "closed");
    } catch {
      // Không lưu được thì lần sau lại mở sẵn, không sao.
    }
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e) && e.code === "KeyH") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button className="panel keys-chip" onClick={() => setOpen(true)}>
        <Keyboard size={14} aria-hidden /> Phím tắt <kbd>H</kbd>
      </button>
    );
  }
  return (
    <section className="panel keys">
      <button className="keys-close" title="Ẩn (H)" onClick={() => setOpen(false)}>
        <ChevronDown size={14} aria-hidden />
      </button>
      <div className="hint">Bấm vào màn hình để xoay camera</div>
      <div className="keys-grid">
        {KEYS.map(([k, label]) => (
          <div key={k} className="key-row">
            <kbd>{k}</kbd>
            <span>{label}</span>
          </div>
        ))}
        <div className="key-row">
          <kbd>G</kbd>
          <span>Đồ họa: {quality === "high" ? "Cao" : "Thấp"}</span>
        </div>
      </div>
    </section>
  );
}

const WINNER_TEXT: Record<Winner, string> = {
  team: "Phe đội thắng",
  solo: "Một người thắng",
  traitor: "Phe phản bội thắng",
  none: "Không ai thắng",
};

const TRAITOR_ACTIONS = new Set(["sabotage", "signal", "forge", "pocket"]);

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
  const copyChronicle = () => {
    const text = [`TEN TIDES · ${end.chronicle.title}`, label.title, ...end.chronicle.paragraphs].join("\n\n");
    void navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => prompt("Sao chép biên niên sử:", text),
    );
  };

  return (
    <div className="end-screen">
      <div className={`end-card winner-${end.winner}`}>
        <header className="end-head">
          <div className="end-badge">
            {WINNER_TEXT[end.winner]}
            {end.solo && `: ${end.solo}`}
          </div>
          <h1>{label.title}</h1>
          <p className="end-text">{label.text}</p>
          <div className="end-meta">
            <span>Ngày {end.day}</span>
            <span>
              <Gem size={14} aria-hidden /> Kho báu {end.treasure}%
            </span>
            {(end.signals > 0 || end.deceit > 0) && (
              <span>
                Tín hiệu cho băng cướp {end.signals} · lần lừa {end.deceit}
              </span>
            )}
          </div>
        </header>

        <div className="end-body">
          <section className="end-reveal">
            <div className="label">Lật bài</div>
            <div className="reveal-grid">
              {end.players.map((p) => {
                const role = ROLE_LABELS[p.role];
                return (
                  <div key={p.id} className={`reveal-card ${role.side}`}>
                    <Avatar name={p.name} color={p.color} size="md" dim={!p.alive} />
                    <div>
                      <strong>{p.name}</strong>
                      <div className="reveal-role">{role.title}</div>
                      <div className="hint">
                        {[!p.alive && "đã gục", p.tied > 0 && `bị trói ${p.tied} lần${role.side === "traitor" ? " (trói đúng)" : " (trói oan)"}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {days.length > 0 && (
              <details className="timeline">
                <summary>
                  <ChevronDown size={14} aria-hidden /> Đêm đó thật ra đã xảy ra gì
                </summary>
                {days.map((d) => (
                  <div key={d} className="timeline-night">
                    <strong>Đêm {d}</strong>
                    {end.nights
                      .filter((n) => n.day === d)
                      .map((n, i) => (
                        <div key={i} className={TRAITOR_ACTIONS.has(n.action) ? "traitor-act" : ""}>
                          {end.players.find((p) => p.id === n.who)?.name}: {NIGHT_ACTION_LABELS[n.action]?.title ?? n.action}
                          {n.target && ` → ${n.target}`}
                        </div>
                      ))}
                  </div>
                ))}
              </details>
            )}
            {end.loot.length > 0 && <p className="hint">Đồ kẻ lừa đảo bỏ túi: {end.loot.join(" · ")}</p>}
          </section>

          {end.chronicle.title && (
            <section className="chronicle">
              <div className="chronicle-kicker">Biên niên sử</div>
              <h2>{end.chronicle.title}</h2>
              {end.chronicle.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          )}
        </div>

        <footer className="end-actions">
          {end.chronicle.title && (
            <button onClick={copyChronicle}>
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied ? "Đã sao chép!" : "Sao chép biên niên sử để chia sẻ"}
            </button>
          )}
          <button className="primary" onClick={onLeave}>
            <LogOut size={16} aria-hidden /> Về sảnh
          </button>
        </footer>
      </div>
    </div>
  );
}
