import { useEffect, useRef, useState, type FormEvent } from "react";
import { NIGHT_ACTION_LABELS, RATION_LABELS } from "@tentides/content";
import { CHAT_MAX_LENGTH, Messages, type ChatChannel } from "@tentides/protocol";
import { RATION_IDS } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useChat } from "../chatStore.ts";
import { usePrivate } from "../privateStore.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

const CHANNEL_TAGS: Partial<Record<ChatChannel, string>> = { ghost: "hồn ma" };

/** Khung chat. Enter để gõ, Enter lần nữa để gửi, Esc để quay lại điều khiển nhân vật. */
function ChatBox({ room, placeholder, channels }: { room: IslandRoom; placeholder: string; channels: ChatChannel[] }) {
  const lines = useChat().filter((l) => channels.includes(l.channel));
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
            <strong>{l.name}:</strong> {l.text}
          </div>
        ))}
      </div>
      <form onSubmit={send}>
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        />
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
  if (!ghost) return null;
  return (
    <section className="panel ghost-chat">
      <div className="label">Hồn ma · ban đêm nghe được cả trại, nhưng chỉ hồn ma nghe thấy bạn</div>
      <ChatBox room={room} channels={["camp", "ghost"]} placeholder="Nhấn Enter để nói với các hồn ma khác" />
    </section>
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
        <span key={c.id} className="dot" title={c.name} style={{ background: c.color }} />
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
        Bạn đang ngủ ngoài một mình. Không nghe được cả trại đang bàn gì, cũng không được chia phần ăn tối nay.
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
      <div className="campfire-votes">
        <div className="label">Khẩu phần · kho còn {night.food}</div>
        {night.rationNeeded ? (
          <>
            <div className="hint">Không đủ mỗi người một phần ({night.campers.length} người). Cả trại bầu cách chia:</div>
            <div className="vote-grid">
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

        <div className="label">Trói người bị nghi · cần {needed} phiếu đồng ý</div>
        {!tie.nominee && (
          <>
            <div className="hint">Nghi ai thì đề cử. Mỗi đêm chỉ đề cử được một lần.</div>
            <div className="vote-grid">
              {night.campers
                .filter((c) => c.id !== me)
                .map((c) => (
                  <button key={c.id} className="vote" onClick={() => room.send(Messages.nominate, { target: c.id })}>
                    <strong>Đề cử trói {c.name}</strong>
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
              <button className="vote" disabled={iCast} onClick={() => room.send(Messages.ballot, { tie: true })}>
                <strong>Trói</strong>
              </button>
              <button className="vote" disabled={iCast} onClick={() => room.send(Messages.ballot, { tie: false })}>
                <strong>Không trói</strong>
              </button>
            </div>
            <div className="hint">
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

        {view && view.nightActions.length > 0 && (
          <>
            <div className="label secret">Việc làm đêm nay · chỉ mình bạn biết</div>
            <div className="vote-grid">
              {view.nightActions
                .filter((a) => a !== "protect")
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
            <div className="hint">Không chọn gì thì coi như ngủ bù.</div>
          </>
        )}

        <button className={imReady ? "primary" : ""} onClick={toggleReady}>
          {imReady ? "Đã sẵn sàng đi ngủ" : "Đi ngủ"} ({night.readyCount}/{night.readyNeeded})
        </button>
      </div>
      <ChatBox room={room} channels={["camp"]} placeholder="Nhấn Enter để nói với cả trại" />
    </section>
  );
}
