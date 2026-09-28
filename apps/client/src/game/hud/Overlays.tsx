import { useEffect, useState } from "react";
import {
  Armchair,
  Ban,
  Check,
  ChevronDown,
  Copy,
  EyeOff,
  Flame,
  Gem,
  Hammer,
  Hand,
  HandHeart,
  Keyboard,
  LogOut,
  Package,
  Pause,
  ScrollText,
  Search,
  Shovel,
  Skull,
  Sparkles,
  Star,
  Trophy,
  TreePalm,
  TriangleAlert,
  UtensilsCrossed,
} from "lucide-react";
import { ENDING_LABELS, GHOST_ACTION_LABELS, NIGHT_ACTION_LABELS, ROLE_LABELS, content, worldCatalog } from "@tentides/content";
import { Messages, type EncounterMessage, type RejectedMessage } from "@tentides/protocol";
import { DIG_ITEM, type EndingId, type GhostActionId, type NightActionId, type RoleId, type Winner } from "@tentides/rules";
import { describe } from "./Feed.tsx";
import { itemName } from "./format.ts";
import { myId, type IslandRoom } from "../../net.ts";
import { useQuality } from "../graphics.ts";
import { useHud } from "../hudStore.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { localEnv } from "../shared.ts";
import { usePrivate } from "../privateStore.ts";
import { useHands } from "../handsStore.ts";
import { Avatar } from "./ui.tsx";

const TARGET_ICON = { poi: Search, creature: Hand, item: Package, tree: TreePalm, camp: Flame, page: ScrollText, campfire: UtensilsCrossed } as const;

/** Đang chọn chỗ dựng nhà: tên công trình, vật liệu cần (có đủ chưa), chỗ này dựng được không. */
function BuildPrompt({ kind, ok }: { kind: string; ok: boolean }) {
  const view = usePrivate();
  const def = worldCatalog.buildings.get(kind);
  if (!def) return null;
  const have = (id: string) => (view?.bag ?? []).filter((b) => b.itemId === id).length;
  const enough = Object.entries(def.cost).every(([id, n]) => have(id) >= n);
  return (
    <div className={ok && enough ? "prompt build ok" : "prompt build"}>
      <Hammer size={16} aria-hidden />
      <strong>{def.name}</strong>
      <span className="hint">
        {Object.entries(def.cost)
          .map(([id, n]) => `${itemName(id)} ${have(id)}/${n}`)
          .join(" · ")}
        {def.shelter > 0 && ` · ngủ ${def.shelter} người`}
      </span>
      <span className="hint prompt-text">
        {!ok ? "Không dựng được ở đây (quá xa lửa trại, vướng cây hay nhà khác)" : !enough ? "Thiếu vật liệu" : "Chuột trái: dựng"} · lăn chuột: xoay · <kbd>V</kbd> đổi ·{" "}
        <kbd>Esc</kbd> thôi
      </span>
    </div>
  );
}

export function InteractPrompt({ room }: { room: IslandRoom }) {
  const { nearAnchor, atDigSite, nearTarget, climbing, victim, build, buildOk, giveTo } = useHud();
  const held = useHands();
  const heldName = usePrivate()?.bag.find((b) => b.uid === held)?.itemId;
  const cardId = useRoomSnapshot(room, (s) => (nearAnchor ? (s.anchors.get(nearAnchor)?.cardId ?? null) : null));
  const hasShovel = useRoomSnapshot(room, (s) => [...(s.players.get(myId(room))?.items ?? [])].includes(DIG_ITEM));
  if (build) return <BuildPrompt kind={build} ok={buildOk} />;
  if (climbing) {
    return (
      <div className="prompt">
        <TreePalm size={16} aria-hidden />
        <span className="prompt-text">
          Leo cây · <kbd>W</kbd>
          <kbd>S</kbd> lên xuống · <kbd>A</kbd>
          <kbd>D</kbd> vòng quanh · <kbd>Space</kbd> nhảy · <kbd>E</kbd> buông
        </span>
      </div>
    );
  }
  if (victim) {
    return (
      <div className="prompt victim">
        <kbd>F</kbd>
        <Skull size={16} aria-hidden />
        Kết liễu {victim.name}
        <span className="hint"> · một lần mỗi ngày, không ai biết là bạn</span>
      </div>
    );
  }
  if (giveTo && heldName && !nearTarget && !nearAnchor) {
    return (
      <div className="prompt">
        <kbd>G</kbd>
        <HandHeart size={16} aria-hidden />
        Đưa {itemName(heldName).toLowerCase()} cho {giveTo.name}
      </div>
    );
  }
  if (atDigSite) {
    return (
      <div className={hasShovel ? "prompt treasure" : "prompt"}>
        <kbd>E</kbd>
        <Shovel size={16} aria-hidden />
        Đào kho báu{!hasShovel && <span className="hint"> · bạn không có xẻng</span>}
      </div>
    );
  }
  if (!nearAnchor && nearTarget) {
    return (
      <div className="prompt">
        <kbd>E</kbd>
        {(() => {
          const Icon = TARGET_ICON[nearTarget.kind];
          return <Icon size={16} aria-hidden />;
        })()}
        {nearTarget.label}
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

const EFFECT_LABELS: Record<string, string> = {
  hp: "Máu",
  morale: "Tinh thần",
  hunger: "No",
  stamina: "Sức bền",
  food: "Lương thực",
  treasure: "Kho báu",
};

/** Kết quả chạm trán vừa rồi (chỉ mình thấy): tìm được gì, bị gì, kèm lời kể ngắn. */
export function EncounterToast({ room }: { room: IslandRoom }) {
  const [msg, setMsg] = useState<(EncounterMessage & { key: number }) | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = room.onMessage(Messages.encounter, (m: EncounterMessage) => {
      setMsg({ ...m, key: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 7000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [room]);
  if (!msg) return null;
  const Icon = msg.tone === "good" ? Sparkles : msg.tone === "bad" ? (msg.effects.hp && msg.effects.hp < 0 ? Skull : TriangleAlert) : Search;
  const chips = Object.entries(msg.effects)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] !== 0)
    .map(([k, v]) => ({ k, v, text: `${v > 0 ? "+" : "−"}${Math.abs(v)} ${EFFECT_LABELS[k] ?? k}` }));
  return (
    <div key={msg.key} className={`encounter ${msg.tone}`} role="status">
      <div className="encounter-head">
        <Icon size={17} aria-hidden />
        {msg.title}
      </div>
      <div className="encounter-text">{msg.text}</div>
      {(chips.length > 0 || msg.gained) && (
        <div className="encounter-effects">
          {chips.map((c) => (
            <span key={c.k} className={c.v > 0 ? "up" : "down"}>
              {c.text}
            </span>
          ))}
          {msg.gained && <span className="up">Nhặt được: {itemName(msg.gained)}</span>}
          {msg.effects.gainItem && !msg.gained && <span className="down">Balo đầy, phải bỏ lại {itemName(msg.effects.gainItem)}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Trong hang, hầm: màn hình tối dần theo độ sâu. Gan dạ cao thì đỡ tối hơn; mang đèn dầu hay đuốc thì sáng hẳn.
 * Dưới nước: phủ một lớp xanh mờ.
 */
export function EnvironmentOverlay({ room }: { room: IslandRoom }) {
  const { zone, underwater } = useHud();
  const nerve = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.stats.get("nerve") ?? 3);
  const light = useRoomSnapshot(room, (s) => {
    const items = [...(s.players.get(myId(room))?.items ?? [])];
    return items.includes("lantern") || items.includes("torch");
  });
  const indoor = useIndoor();
  const darkness = zone === "cave" ? indoor * Math.max(0.15, 0.95 - nerve * 0.1 - (light ? 0.45 : 0)) : 0;
  return (
    <>
      <div className="darkness" style={{ opacity: darkness }} />
      {underwater && <div className="underwater-tint" />}
    </>
  );
}

/** Độ sâu trong hang (0–1) đọc từ vòng lặp 3D vài lần mỗi giây, đủ mượt cho lớp tối. */
function useIndoor(): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setValue(Math.round(localEnv.indoor * 20) / 20), 200);
    return () => clearInterval(timer);
  }, []);
  return value;
}

const SINKING_TEXT = {
  breath: "Hết hơi! Đang đuối nước, giữ Space mà ngoi lên",
  tired: "Kiệt sức, đang chìm dần. Giữ Space để đạp nước",
  heavy: "Balo quá nặng, đang chìm! Giữ Space để đạp nước hoặc bỏ bớt đồ (X)",
} as const;

/** Nhãn tư thế: đang ngồi (nghỉ, hồi sức nhanh), hoặc đang nấp trong cỏ cao; bơi mà đang chìm thì cảnh báo. */
export function PostureBadge() {
  const { sitting, hidden, sinking } = useHud();
  if (sinking) {
    return (
      <div className="posture sinking" role="alert">
        <TriangleAlert size={15} aria-hidden />
        {SINKING_TEXT[sinking]}
      </div>
    );
  }
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
  const [message, setMessage] = useState<{ text: string; key: number; star?: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (text: string, star = false) => {
      setMessage({ text, key: Date.now(), star });
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3000);
    };
    const off = room.onMessage(Messages.rejected, (m: RejectedMessage) => show(m.reason));
    const offStar = room.onMessage(Messages.starred, (m: { count: number }) => show(`Đã đánh dấu khoảnh khắc (${m.count}). Xem lại ở màn lật bài.`, true));
    return () => {
      off();
      offStar();
      clearTimeout(timer);
    };
  }, [room]);
  return message ? (
    <div key={message.key} className={message.star ? "toast star" : "toast"} role="status">
      {message.star ? <Star size={16} aria-hidden /> : <Ban size={16} aria-hidden />}
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
  ["Space", "Nhảy · ngoi lên"],
  ["C", "Ngồi · giữ để lặn"],
  ["E", "Sự kiện · đào · nhặt · leo cây"],
  ["Chuột trái", "Đánh · chặt · ăn · trồng"],
  ["Giữ chuột phải", "Ném món đang cầm"],
  ["Q · lăn chuột", "Đổi món cầm"],
  ["X", "Đặt đồ xuống"],
  ["V", "Dựng nhà"],
  ["G", "Đưa món đang cầm cho người bên cạnh"],
  ["K", "Đánh dấu ⭐ khoảnh khắc"],
  ["B", "Xem balo"],
  ["J", "Sổ truyện"],
  ["Enter", "Chat"],
  ["M · N", "Tắt âm thanh · tắt nhạc"],
  ["Esc", "Thả chuột"],
  ["1–4", "Chọn lựa chọn"],
];
const HELP_KEY = "tentides.help";
/** Vài phím cần nhất cho người mới; phần còn lại mở bằng "Tất cả phím". */
const ESSENTIAL_KEYS = new Set(["WASD", "Shift", "E", "Chuột trái", "Q · lăn chuột", "B"]);

/** Bảng phím tắt, H để bật tắt. Lần đầu chơi thì mở sẵn, lần sau nhớ lựa chọn của người chơi. */
export function KeyHints() {
  const quality = useQuality();
  const [all, setAll] = useState(false);
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
      <div className="hint">Bấm vào màn hình để xoay camera · theo mũi tên vàng để tới sự kiện</div>
      <div className="keys-grid">
        {KEYS.filter(([k]) => all || ESSENTIAL_KEYS.has(k)).map(([k, label]) => (
          <div key={k} className="key-row">
            <kbd>{k}</kbd>
            <span>{label}</span>
          </div>
        ))}
        {all && (
          <div className="key-row">
            <kbd>P</kbd>
            <span>Đồ họa: {quality === "high" ? "Cao" : "Thấp"}</span>
          </div>
        )}
        <button className="ghost small keys-more" onClick={() => setAll(!all)}>
          {all ? "Thu gọn" : `Tất cả phím (${KEYS.length + 1})`}
        </button>
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

const TRAITOR_ACTIONS = new Set(["sabotage", "signal", "forge", "pocket", "assassinate"]);

/** Tên việc làm trong dòng thời gian đêm: hành động đêm, kết liễu, hay việc của hồn ma. */
function actionLabel(action: string): string {
  if (action === "assassinate") return "Kết liễu giữa ban ngày";
  if (action.startsWith("ghost_")) return `Hồn ma ${GHOST_ACTION_LABELS[action.slice(6) as GhostActionId]?.title.toLowerCase() ?? ""}`;
  return NIGHT_ACTION_LABELS[action as NightActionId]?.title ?? action;
}

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
      nights: [...s.reveal.nights].map((n) => ({ day: n.day, who: n.playerId, action: n.action as NightActionId, target: n.target ? name(n.target) : "", text: n.text })),
      // Khảo sát kín: mỗi đêm bao nhiêu người nghi đúng kẻ phản bội.
      suspicionDays: (() => {
        const traitors = new Set([...s.reveal.roles.entries()].filter(([, r]) => r === "pirate" || r === "con").map(([id]) => id));
        const byDay = new Map<number, { right: number; total: number; guesses: string[] }>();
        for (const x of s.reveal.suspicions) {
          const d = byDay.get(x.day) ?? { right: 0, total: 0, guesses: [] };
          d.total++;
          if (x.target && traitors.has(x.target)) d.right++;
          d.guesses.push(`${name(x.playerId)} → ${x.target ? name(x.target) : "không ai"}`);
          byDay.set(x.day, d);
        }
        return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, d]) => ({ day, ...d, anyTraitor: traitors.size > 0 }));
      })(),
      moments: [...s.reveal.stars].map((st) => {
        const entry = s.log[Number(st.target)];
        return { who: name(st.playerId), day: st.day, text: entry ? describe(entry, s).text : "Lúc ván vừa bắt đầu" };
      }),
      loot: [...s.reveal.loot].map((l) => `${name(l.playerId)}: ${itemName(l.itemId)}`),
      signals: s.reveal.signals,
      deceit: s.reveal.deceit,
      chronicle: { title: s.chronicle.title, paragraphs: [...s.chronicle.paragraphs] },
      awards: [...s.reveal.awards].map((a) => ({ name: name(a.playerId), color: s.players.get(a.playerId)?.color ?? "#888", title: a.title, detail: a.detail })),
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
                          {end.players.find((p) => p.id === n.who)?.name}: {actionLabel(n.action)}
                          {n.target && ` → ${n.target}`}
                          {n.text && ` · “${n.text}”`}
                        </div>
                      ))}
                  </div>
                ))}
              </details>
            )}
            {end.loot.length > 0 && <p className="hint">Đồ kẻ lừa đảo bỏ túi: {end.loot.join(" · ")}</p>}
            {end.suspicionDays.length > 0 && (
              <details className="timeline">
                <summary>
                  <ChevronDown size={14} aria-hidden /> Mỗi đêm cả đoàn nghi ai
                </summary>
                {end.suspicionDays.map((d) => (
                  <div key={d.day} className="timeline-night">
                    <strong>
                      Đêm {d.day}
                      {d.anyTraitor ? ` · ${d.right}/${d.total} người nghi đúng` : ""}
                    </strong>
                    <div className="hint">{d.guesses.join(" · ")}</div>
                  </div>
                ))}
              </details>
            )}
            {end.moments.length > 0 && (
              <div className="moments">
                <div className="label">
                  <Star size={13} aria-hidden /> Khoảnh khắc được đánh dấu
                </div>
                {end.moments.map((m, i) => (
                  <div key={i} className="moment">
                    <span className="feed-day">N{m.day}</span> <strong>{m.who}</strong>: {m.text}
                  </div>
                ))}
              </div>
            )}
            {end.awards.length > 0 && (
              <div className="awards">
                <div className="label">
                  <Trophy size={13} aria-hidden /> Danh hiệu
                </div>
                <div className="award-grid">
                  {end.awards.map((a) => (
                    <div key={a.title} className="award">
                      <Avatar name={a.name} color={a.color} size="sm" />
                      <div>
                        <strong>{a.title}</strong>
                        <div className="hint">
                          {a.name} · {a.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
