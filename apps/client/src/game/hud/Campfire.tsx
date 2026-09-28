import { useEffect, useRef, useState, type FormEvent } from "react";
import { RATION_LABELS } from "@tentides/content";
import { CHAT_MAX_LENGTH, Messages } from "@tentides/protocol";
import { NO_TIE, RATION_IDS, rationResult, tieResult, type RationId } from "@tentides/rules";
import type { IslandRoom } from "../../net.ts";
import { useChat } from "../chatStore.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

/** Khung chat. Enter để gõ, Enter lần nữa để gửi, Esc để quay lại điều khiển nhân vật. */
function ChatBox({ room, placeholder }: { room: IslandRoom; placeholder: string }) {
  const lines = useChat();
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
  }, [lines]);

  function send(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    room.send(Messages.chat, { text: trimmed });
    setText("");
  }

  return (
    <div className="chat">
      <div className="chat-lines" ref={list}>
        {lines.length === 0 && <div className="chat-empty">Chưa ai nói gì.</div>}
        {lines.map((l) => (
          <div key={l.id} className={l.from === room.sessionId ? "chat-line mine" : "chat-line"}>
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
      <ChatBox room={room} placeholder="Nhấn Enter để chat với cả phòng" />
    </section>
  );
}

interface Camper {
  id: string;
  name: string;
  color: string;
  ration: string;
  tie: string;
}

/** Đêm quanh đống lửa: bỏ phiếu chia khẩu phần, bỏ phiếu trói người bị nghi, và chat. */
export function Campfire({ room }: { room: IslandRoom }) {
  const night = useRoomSnapshot(room, (s) => {
    if (s.phase !== "night") return null;
    const campers = [...s.campers].map((id): Camper => {
      const p = s.players.get(id);
      const v = s.votes.get(id);
      return { id, name: p?.name ?? "?", color: p?.color ?? "#fff", ration: v?.ration ?? "", tie: v?.tie ?? "" };
    });
    return {
      campers,
      amCamper: campers.some((c) => c.id === room.sessionId),
      alive: s.players.get(room.sessionId)?.alive ?? false,
      food: s.food,
    };
  });

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

  const votes = {
    ration: Object.fromEntries(night.campers.filter((c) => c.ration).map((c) => [c.id, c.ration as RationId])),
    tie: Object.fromEntries(night.campers.filter((c) => c.tie).map((c) => [c.id, c.tie])),
  };
  const leadingRation = rationResult(votes);
  const leadingTie = tieResult(votes, night.campers.map((c) => c.id));
  const nameOf = (id: string) => night.campers.find((c) => c.id === id)?.name ?? "?";
  const me = night.campers.find((c) => c.id === room.sessionId)!;
  const needed = Math.floor(night.campers.length / 2) + 1;

  const voters = (match: (c: Camper) => boolean) => (
    <span className="voters">
      {night.campers.filter(match).map((c) => (
        <span key={c.id} className="dot" title={c.name} style={{ background: c.color }} />
      ))}
    </span>
  );

  return (
    <section className="panel campfire">
      <div className="campfire-votes">
        <div className="label">Chia lương thực · kho còn {night.food} khẩu phần</div>
        <div className="vote-grid">
          {RATION_IDS.map((id) => (
            <button
              key={id}
              className={me.ration === id ? "vote selected" : "vote"}
              onClick={() => room.send(Messages.vote, { ballot: "ration", choice: id })}
            >
              <strong>{RATION_LABELS[id].title}</strong>
              <span>{RATION_LABELS[id].detail}</span>
              {voters((c) => c.ration === id)}
            </button>
          ))}
        </div>

        <div className="label">Trói người bị nghi · cần {needed} phiếu</div>
        <div className="vote-grid">
          {night.campers
            .filter((c) => c.id !== room.sessionId)
            .map((c) => (
              <button
                key={c.id}
                className={me.tie === c.id ? "vote selected" : "vote"}
                onClick={() => room.send(Messages.vote, { ballot: "tie", choice: c.id })}
              >
                <strong>Trói {c.name}</strong>
                {voters((v) => v.tie === c.id)}
              </button>
            ))}
          <button
            className={me.tie === NO_TIE ? "vote selected" : "vote"}
            onClick={() => room.send(Messages.vote, { ballot: "tie", choice: NO_TIE })}
          >
            <strong>Không trói ai</strong>
            {voters((v) => v.tie === NO_TIE)}
          </button>
        </div>

        <div className="leading">
          Đang dẫn: <strong>{RATION_LABELS[leadingRation].title}</strong>
          {leadingTie ? (
            <>
              {" "}
              · trói <strong>{nameOf(leadingTie)}</strong>
            </>
          ) : (
            " · chưa trói ai"
          )}
        </div>
      </div>
      <ChatBox room={room} placeholder="Nhấn Enter để nói với cả trại" />
    </section>
  );
}
