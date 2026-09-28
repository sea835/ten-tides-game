import { useEffect, useRef, useState } from "react";
import { content } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gameConfig } from "@tentides/content";
import { anchorZone, effectiveDc, successChance, type BackgroundId, type Difficulty, type FlawId, type Stats } from "@tentides/rules";
import { usePrivate } from "../privateStore.ts";
import { describeCheck, describeOutcome, itemName, signed } from "./format.ts";

const RESULT_SECONDS = 12;

/** Xúc xắc lăn một lúc rồi mới dừng ở kết quả thật (engine đã quyết định từ trước). */
function Dice({ roll }: { roll: number }) {
  const [face, setFace] = useState<number | null>(null);
  useEffect(() => {
    const spin = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), 60);
    const stop = setTimeout(() => {
      clearInterval(spin);
      setFace(roll);
    }, 900);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [roll]);
  return <div className={`dice ${face === roll ? "settled" : ""}`}>{face ?? "?"}</div>;
}

function ActiveCard({ room, anchorId, cardId, participants, timeLeft }: {
  room: IslandRoom;
  anchorId: string;
  cardId: string;
  participants: string[];
  timeLeft: number;
}) {
  const card = content.cards.get(cardId);
  const names = useRoomSnapshot(room, (s) => participants.map((id) => s.players.get(id)?.name ?? "?"));
  // Phiếu của mình để tính tỷ lệ thành công: người bấm chọn chính là người tung xúc xắc.
  const pub = useRoomSnapshot(room, (s) => {
    const p = s.players.get(myId(room));
    return {
      hunger: p?.hunger ?? 0,
      morale: p?.morale ?? 0,
      stats: Object.fromEntries(p?.stats.entries() ?? []) as Stats,
      background: (p?.background ?? "old_sailor") as BackgroundId,
      flaw: (p?.flaw ?? "liar") as FlawId,
      difficulty: s.difficulty as Difficulty,
    };
  });
  // Balo đầy đủ (kể cả ngăn bí mật) chỉ có trong thông tin riêng.
  const view = usePrivate();
  const bag = view?.bag ?? [];
  const mine = { ...pub, bag, items: bag.map((b) => b.itemId) };
  const myItems = mine.items;
  const zone = anchorZone(gameConfig, anchorId);
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);

  function choose(choiceId: string) {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    room.send(Messages.choose, { anchorId, choiceId });
  }
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(() => {
    // Nhả chuột để bấm được lựa chọn; phím 1–4 cũng chọn được.
    if (document.pointerLockElement) document.exitPointerLock();
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const choice = card?.choices[Number(e.key) - 1];
      if (choice) chooseRef.current(choice.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  if (!card) return null;
  return (
    <div className="event-card">
      <div className="event-meta">
        <span>{names.join(", ")}</span>
        <span className="event-timer">{timeLeft}s</span>
      </div>
      <h2>{card.title}</h2>
      <p className="event-intro">{card.intro}</p>
      <div className="choices">
        {card.choices.map((choice, i) => {
          const check = describeCheck({ ...choice.check, dc: effectiveDc(choice.check.dc, mine.difficulty) }, myItems);
          const chance = Math.round(100 * successChance(mine, choice, gameConfig, mine.difficulty, zone));
          return (
            <button key={choice.id} className="choice" disabled={sent} onClick={() => choose(choice.id)}>
              <span className="choice-key">{i + 1}</span>
              <span className="choice-body">
                <strong>{choice.label}</strong>
                <span className="choice-check">
                  <span className={chance >= 60 ? "chance good" : chance >= 35 ? "chance" : "chance bad"}>{chance}%</span>
                  {check.text}
                  {check.bonuses.map((b) => (
                    <span key={b.label} className={b.have ? "bonus have" : "bonus"}>
                      {b.label}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="event-hint">Ai đang đứng ở đây cũng chọn được. Hết giờ thì tự chọn lựa chọn đầu.</p>
    </div>
  );
}

interface CheckView {
  index: number;
  playerName: string;
  cardId: string;
  choiceId: string;
  roll: number;
  modifiers: { label: string; value: number }[];
  total: number;
  dc: number;
  success: boolean;
  wouldPassWith: string[];
  rerolledFrom: number;
  dropped: string;
  exploded: boolean;
}

function ResultCard({ entry, onClose }: { entry: CheckView; onClose: () => void }) {
  const card = content.cards.get(entry.cardId);
  const choice = card?.choices.find((c) => c.id === entry.choiceId);
  const [revealed, setRevealed] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const reveal = setTimeout(() => setRevealed(true), 950);
    const close = setTimeout(() => closeRef.current(), RESULT_SECONDS * 1000);
    return () => {
      clearTimeout(reveal);
      clearTimeout(close);
    };
  }, [entry.index]);

  if (!card || !choice) return null;
  const outcome = describeOutcome(entry.success ? choice.onSuccess : choice.onFail);
  return (
    <div className="event-card result">
      <div className="event-meta">
        <span>
          {entry.playerName} chọn: {choice.label}
        </span>
      </div>
      <h2>{card.title}</h2>
      <div className="roll">
        <Dice roll={entry.roll} />
        <div className="breakdown">
          {entry.modifiers.map((m) => (
            <span key={m.label}>
              {m.label} {signed(m.value)}
            </span>
          ))}
          <span className="total">
            = {revealed ? entry.total : "…"} / cần {entry.dc}
          </span>
        </div>
      </div>
      {revealed && (
        <>
          <div className={entry.success ? "verdict success" : "verdict fail"}>{entry.success ? "Thành công" : "Thất bại"}</div>
          <p className="event-intro">{entry.success ? choice.successText : choice.failText}</p>
          {outcome.length > 0 && <p className="outcome">{outcome.join(" · ")}</p>}
          {entry.rerolledFrom > 0 && <p className="why">Tay cờ bạc tung lại (lần đầu ra {entry.rerolledFrom}).</p>}
          {entry.dropped && <p className="why">Hậu đậu: làm rơi mất {itemName(entry.dropped)}.</p>}
          {entry.exploded && <p className="why">Thuốc súng cạnh diêm phát nổ: −15 Máu!</p>}
          {!entry.success && (
            <p className="why">
              Thiếu {entry.dc - entry.total} điểm.
              {entry.wouldPassWith.length > 0 &&
                ` Nếu có ${entry.wouldPassWith
                  .map((id) => `${itemName(id)} (${signed(choice.check.itemBonus?.[id] ?? 0)})`)
                  .join(" hoặc ")} trong balo thì đã qua.`}
            </p>
          )}
        </>
      )}
      <button className="primary" onClick={onClose}>
        Tiếp tục
      </button>
    </div>
  );
}

/** Thẻ sự kiện của mình: đang mở thì hiện lựa chọn, vừa xong thì hiện xúc xắc và kết quả. */
export function EventCard({ room }: { room: IslandRoom }) {
  const active = useRoomSnapshot(room, (s) => {
    for (const [anchorId, a] of s.anchors) {
      const participants = [...a.participants];
      if (a.status === "active" && participants.includes(myId(room))) {
        return { anchorId, cardId: a.cardId, participants, timeLeft: a.timeLeft };
      }
    }
    return null;
  });

  const [seen, setSeen] = useState(() => room.state.log.length);
  const latest = useRoomSnapshot(room, (s): CheckView | null => {
    for (let i = s.log.length - 1; i >= seen; i--) {
      const e = s.log[i]!;
      if (e.kind === "check" && [...e.players].includes(myId(room))) {
        return {
          index: i,
          playerName: s.players.get(e.playerId)?.name ?? "?",
          cardId: e.cardId,
          choiceId: e.choiceId,
          roll: e.roll,
          modifiers: [...e.modifiers].map((m) => ({ label: m.label, value: m.value })),
          total: e.total,
          dc: e.dc,
          success: e.success,
          wouldPassWith: [...e.wouldPassWith],
          rerolledFrom: e.rerolledFrom,
          dropped: e.dropped,
          exploded: e.exploded,
        };
      }
    }
    return null;
  });

  if (active) return <ActiveCard key={active.anchorId} room={room} {...active} />;
  if (latest) return <ResultCard key={latest.index} entry={latest} onClose={() => setSeen(latest.index + 1)} />;
  return null;
}
