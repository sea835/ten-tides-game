import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { BedDouble, Check, EyeOff, Flame, Ghost, Lock, Moon, Search, Send, Wheat } from "lucide-react";
import { GHOST_ACTION_LABELS, NIGHT_ACTION_LABELS, RATION_LABELS } from "@tentides/content";
import { CHAT_MAX_LENGTH, Messages, type ChatChannel } from "@tentides/protocol";
import { GHOST_ACTION_IDS, GHOST_WHISPER_MAX, RATION_IDS, TARGETED_NIGHT_ACTIONS, type GhostActionId } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useChat } from "../chatStore.ts";
import { usePrivate } from "../privateStore.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { useStory } from "./Story.tsx";
import { Avatar, SectionLabel } from "./ui.tsx";

const CHANNEL_TAGS: Partial<Record<ChatChannel, string>> = { ghost: "hồn ma" };

/** Khung chat. Enter để gõ, Enter lần nữa để gửi, Esc để quay lại điều khiển nhân vật. */
function ChatBox({ room, placeholder, channels }: { room: IslandRoom; placeholder: string; channels: ChatChannel[] }) {
  const lines = useChat().filter((l) => channels.includes(l.channel));
  const colors = useRoomSnapshot(room, (s) => Object.fromEntries([...s.players.entries()].map(([id, p]) => [id, p.color])));
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isTyping(e)) {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines.length]);

  function send(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    room.send(Messages.chat, { text: trimmed });
    setText("");
  }

  const me = myId(room);
  return (
    <div className="chat">
      <div className="chat-lines" ref={list}>
        {lines.length === 0 && <div className="chat-empty">Chưa ai nói gì.</div>}
        {lines.map((l) => (
          <div key={l.id} className={l.from === me ? "chat-line mine" : "chat-line"}>
            {CHANNEL_TAGS[l.channel] && <span className="chat-tag">{CHANNEL_TAGS[l.channel]}</span>}
            <strong style={{ "--c": colors[l.from] } as CSSProperties}>{l.name}</strong> {l.text}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="chat-form">
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        />
        <button className="icon-btn" disabled={!text.trim()} title="Gửi">
          <Send size={16} aria-hidden />
        </button>
      </form>
    </div>
  );
}

export function LobbyChat({ room }: { room: IslandRoom }) {
  const lobby = useRoomSnapshot(room, (s) => s.phase === "lobby");
  if (!lobby) return null;
  return (
    <section className="panel lobby-chat">
      <ChatBox room={room} channels={["room"]} placeholder="Nhấn Enter để chat với cả phòng" />
    </section>
  );
}

/** Người đã gục vẫn ở lại ván: nghe được cả trại ban đêm và nói chuyện với nhau. */
export function GhostChat({ room }: { room: IslandRoom }) {
  const ghost = useRoomSnapshot(room, (s) => s.phase !== "lobby" && s.phase !== "ended" && s.players.get(myId(room))?.alive === false);
  const night = useRoomSnapshot(room, (s) => s.phase === "night");
  if (!ghost) return null;
  return (
    <section className="panel ghost-chat">
      <SectionLabel icon={Ghost}>Hồn ma · ban đêm nghe được cả trại, nhưng chỉ hồn ma nghe thấy bạn</SectionLabel>
      {night && <GhostActions room={room} />}
      <ChatBox room={room} channels={["camp", "ghost"]} placeholder="Nhấn Enter để nói với các hồn ma khác" />
    </section>
  );
}

/** Mỗi đêm hồn ma làm được một việc nhỏ: thì thầm vào giấc mơ ai đó, làm ai đó lạnh gáy, hay dẫn lối manh mối. */
function GhostActions({ room }: { room: IslandRoom }) {
  const living = useRoomSnapshot(room, (s) => [...s.players.entries()].filter(([, p]) => p.alive).map(([id, p]) => ({ id, name: p.name })));
  const choice = usePrivate()?.ghostChoice ?? null;
  const [action, setAction] = useState<GhostActionId>(choice?.action ?? "whisper");
  const [target, setTarget] = useState(choice?.target ?? living[0]?.id ?? "");
  const [text, setText] = useState("");
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    room.send(Messages.ghostAction, action === "guide" ? { action } : action === "whisper" ? { action, target, text } : { action, target });
  };
  return (
    <form className="ghost-actions" onSubmit={submit}>
      <div className="vote-grid three">
        {GHOST_ACTION_IDS.map((id) => (
          <button type="button" key={id} className={action === id ? "vote selected" : "vote"} onClick={() => setAction(id)} title={GHOST_ACTION_LABELS[id].detail}>
            <strong>{GHOST_ACTION_LABELS[id].title}</strong>
            <span>{GHOST_ACTION_LABELS[id].detail}</span>
          </button>
        ))}
      </div>
      {action !== "guide" && (
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Chọn người">
          {living.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {action === "whisper" && (
        <input value={text} maxLength={GHOST_WHISPER_MAX} placeholder="Lời thì thầm (ngắn thôi)" onChange={(e) => setText(e.target.value)} />
      )}
      <button className="primary" disabled={action === "whisper" && !text.trim()}>
        <Ghost size={15} aria-hidden /> {choice ? "Đổi việc đêm nay" : "Làm việc này đêm nay"}
      </button>
      {choice && (
        <div className="hint">
          Đêm nay: {GHOST_ACTION_LABELS[choice.action].title}
          {choice.target && ` · ${living.find((p) => p.id === choice.target)?.name ?? ""}`}
          {choice.text && ` · “${choice.text}”`}
        </div>
      )}
    </form>
  );
}

interface Person {
  id: string;
  name: string;
  color: string;
}

function Dots({ people }: { people: Person[] }) {
  return (
    <span className="voters">
      {people.map((c) => (
        <span key={c.id} title={c.name}>
          <Avatar name={c.name} color={c.color} size="xs" />
        </span>
      ))}
    </span>
  );
}

/** Đêm quanh đống lửa: chia khẩu phần khi thiếu, đề cử và bỏ phiếu kín để trói, chat, rồi đi ngủ. */
export function Campfire({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const night = useRoomSnapshot(room, (s) => {
    if (s.phase !== "night") return null;
    const person = (id: string): Person => ({ id, name: s.players.get(id)?.name ?? "?", color: s.players.get(id)?.color ?? "#fff" });
    const campers = [...s.campers].map((id) => ({ ...person(id), ration: s.rations.get(id) ?? "" }));
    return {
      campers,
      amCamper: campers.some((c) => c.id === me),
      alive: s.players.get(me)?.alive ?? false,
      food: s.food,
      rationNeeded: s.rationNeeded,
      tie: {
        nominator: s.tie.nominator,
        nominee: s.tie.nominee,
        cast: [...s.tie.cast].map(person),
        revealed: s.tie.revealed,
        yes: [...s.tie.yes].map(person),
        no: [...s.tie.no].map(person),
      },
      readyCount: s.readyCount,
      readyNeeded: s.readyNeeded,
      day: s.day,
    };
  });

  const view = usePrivate();
  const story = useStory(room, night?.day ?? 0, "dusk");
  // Chỉ con số người sẵn sàng là công khai; mình đã bấm hay chưa thì client tự nhớ, qua đêm mới thì quên.
  const [readyDay, setReadyDay] = useState(0);
  const amCamper = night?.amCamper ?? false;
  useEffect(() => {
    // Ngồi quanh đống lửa thì nhả chuột để bấm phiếu và gõ chat.
    if (amCamper && document.pointerLockElement) document.exitPointerLock();
  }, [amCamper]);

  if (!night || !night.alive) return null;
  if (!night.amCamper) {
    return (
      <section className="panel campfire outside">
        <Moon size={18} aria-hidden />
        <span>Bạn đang ngủ ngoài một mình. Không nghe được cả trại đang bàn gì, cũng không được chia phần ăn tối nay.</span>
      </section>
    );
  }

  const nameOf = (id: string) => night.campers.find((c) => c.id === id)?.name ?? "?";
  const mine = night.campers.find((c) => c.id === me)!;
  const tie = night.tie;
  const needed = Math.floor(night.campers.length / 2) + 1;
  const iCast = tie.cast.some((c) => c.id === me);
  const tied = tie.revealed && tie.yes.length >= needed;
  const imReady = readyDay === night.day;
  const nightChoice = view?.nightChoice ?? null;
  const toggleReady = () => {
    setReadyDay(imReady ? 0 : night.day);
    room.send(Messages.ready);
  };

  return (
    <section className="panel campfire">
      <header className="campfire-head">
        <Flame size={20} aria-hidden />
        <h2>Quanh đống lửa</h2>
        <span className="hint">
          {night.campers.length} người ở trại · kho còn {night.food} khẩu phần
        </span>
      </header>
      {story && <p className="story campfire-story">{story}</p>}
      <div className="campfire-body">
      <div className="campfire-votes">
        <div className="camp-section">
          <SectionLabel icon={Wheat}>Khẩu phần</SectionLabel>
          {night.rationNeeded ? (
            <>
              <div className="hint">Không đủ mỗi người một phần ({night.campers.length} người). Cả trại bầu cách chia:</div>
              <div className="vote-grid three">
                {RATION_IDS.map((id) => (
                  <button
                    key={id}
                    className={mine.ration === id ? "vote selected" : "vote"}
                    onClick={() => room.send(Messages.ration, { choice: id })}
                  >
                    <strong>{RATION_LABELS[id].title}</strong>
                    <span>{RATION_LABELS[id].detail}</span>
                    <Dots people={night.campers.filter((c) => c.ration === id)} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="hint">Đủ ăn: mỗi người một khẩu phần, khỏi phải bầu.</div>
          )}
        </div>

        <div className="camp-section">
          <SectionLabel icon={Lock}>Trói người bị nghi · cần {needed} phiếu đồng ý</SectionLabel>
          {!tie.nominee && (
            <>
              <div className="hint">Nghi ai thì đề cử. Mỗi đêm chỉ đề cử được một lần.</div>
              <div className="nominees">
                {night.campers
                  .filter((c) => c.id !== me)
                  .map((c) => (
                    <button key={c.id} className="nominee" title={`Đề cử trói ${c.name}`} onClick={() => room.send(Messages.nominate, { target: c.id })}>
                      <Avatar name={c.name} color={c.color} size="sm" />
                      <span>Đề cử trói {c.name}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
          {tie.nominee && !tie.revealed && (
            <>
              <div className="hint">
                {nameOf(tie.nominator)} đề cử trói <strong>{nameOf(tie.nominee)}</strong>. Phiếu kín, lật khi mọi người bầu xong.
              </div>
              <div className="vote-grid">
                <button className="vote yes" disabled={iCast} onClick={() => room.send(Messages.ballot, { tie: true })}>
                  <strong>Trói</strong>
                </button>
                <button className="vote no" disabled={iCast} onClick={() => room.send(Messages.ballot, { tie: false })}>
                  <strong>Không trói</strong>
                </button>
              </div>
              <div className="hint cast">
                Đã bầu {tie.cast.length}/{night.campers.length} <Dots people={tie.cast} />
                {iCast && " · bạn đã bỏ phiếu"}
              </div>
            </>
          )}
          {tie.revealed && (
            <div className={tied ? "reveal tied" : "reveal"}>
              <div>
                Đồng ý trói {nameOf(tie.nominee)}: {tie.yes.map((p) => p.name).join(", ") || "không ai"}
              </div>
              <div>Không đồng ý: {tie.no.map((p) => p.name).join(", ") || "không ai"}</div>
              <strong>{tied ? `${nameOf(tie.nominee)} sẽ bị trói tới hoàng hôn mai.` : "Không đủ phiếu, không trói ai."}</strong>
            </div>
          )}
        </div>

        {view && view.nightActions.length > 0 && (
          <div className="camp-section secret">
            <SectionLabel icon={EyeOff} tone="secret">
              Việc làm đêm nay · chỉ mình bạn biết
            </SectionLabel>
            <div className="vote-grid">
              {view.nightActions
                .filter((a) => !TARGETED_NIGHT_ACTIONS.includes(a))
                .map((a) => (
                  <button
                    key={a}
                    className={nightChoice?.action === a ? "vote selected" : "vote"}
                    onClick={() => room.send(Messages.nightAction, { action: a })}
                  >
                    <strong>{NIGHT_ACTION_LABELS[a].title}</strong>
                    <span>{NIGHT_ACTION_LABELS[a].detail}</span>
                  </button>
                ))}
            </div>
            {view.nightActions.includes("protect") && (
              <div className="vote-grid">
                {night.campers.map((c) => (
                  <button
                    key={c.id}
                    className={nightChoice?.action === "protect" && nightChoice.target === c.id ? "vote selected" : "vote"}
                    onClick={() => room.send(Messages.nightAction, { action: "protect", target: c.id })}
                  >
                    <strong>Che chở {c.id === me ? "bản thân" : c.name}</strong>
                  </button>
                ))}
              </div>
            )}
            {view.nightActions.includes("search") && (
              <>
                <div className="hint">
                  <Search size={12} aria-hidden /> {NIGHT_ACTION_LABELS.search.title}: {NIGHT_ACTION_LABELS.search.detail}
                </div>
                <div className="vote-grid">
                  {night.campers
                    .filter((c) => c.id !== me)
                    .map((c) => (
                      <button
                        key={c.id}
                        className={nightChoice?.action === "search" && nightChoice.target === c.id ? "vote selected" : "vote"}
                        onClick={() => room.send(Messages.nightAction, { action: "search", target: c.id })}
                      >
                        <strong>Lục balo {c.name}</strong>
                      </button>
                    ))}
                </div>
              </>
            )}
            <div className="hint">Không chọn gì thì coi như ngủ bù.</div>
          </div>
        )}

        <div className="camp-section secret">
          <SectionLabel icon={EyeOff} tone="secret">
            Bạn đang nghi ai? · khảo sát kín, chỉ lộ ở màn lật bài
          </SectionLabel>
          <div className="nominees">
            {[...night.campers.filter((c) => c.id !== me), null].map((c) => (
              <button
                key={c?.id ?? "none"}
                className={view?.suspicion === (c?.id ?? null) ? "nominee selected" : "nominee"}
                onClick={() => room.send(Messages.suspect, { target: c?.id ?? null })}
              >
                {c && <Avatar name={c.name} color={c.color} size="sm" />}
                <span>{c ? c.name : "Không nghi ai"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="campfire-chat">
        <ChatBox room={room} channels={["camp"]} placeholder="Nhấn Enter để nói với cả trại" />
        <button className={imReady ? "ready done" : "primary"} onClick={toggleReady}>
          {imReady ? <Check size={16} aria-hidden /> : <BedDouble size={16} aria-hidden />}
          {imReady ? "Đã sẵn sàng đi ngủ" : "Đi ngủ"}
          <span className="count">
            {night.readyCount}/{night.readyNeeded}
          </span>
        </button>
      </div>
      </div>
    </section>
  );
}
