import { useState } from "react";
import { RATION_LABELS, content } from "@tentides/content";
import type { IslandState, LogEntryState } from "@tentides/protocol";
import type { RationId } from "@tentides/rules";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { itemName, signed } from "./format.ts";

interface Line {
  day: number;
  ok: boolean;
  text: string;
}

function describe(e: LogEntryState, s: IslandState): Line {
  const name = (id: string) => s.players.get(id)?.name ?? "?";
  if (e.kind === "check") {
    const card = content.cards.get(e.cardId);
    const choice = card?.choices.find((c) => c.id === e.choiceId);
    const bonus = [...e.modifiers].reduce((sum, m) => sum + m.value, 0);
    return {
      day: e.day,
      ok: e.success,
      text: `${name(e.playerId)} · ${card?.title ?? e.cardId} · ${choice?.label ?? e.choiceId}: ${e.roll} ${signed(bonus)} = ${e.total} / ${e.dc} ${e.success ? "✓" : "✗"}`,
    };
  }
  if (e.kind === "dusk") {
    const outside = [...e.players].map(name);
    return {
      day: e.day,
      ok: outside.length === 0,
      text: outside.length ? `Hoàng hôn: ${outside.join(", ")} ngủ ngoài` : "Hoàng hôn: cả đội về trại đủ",
    };
  }
  if (e.kind === "night") {
    const starving = [...e.starving].map(name);
    const ballot = e.nominee
      ? `đề cử trói ${name(e.nominee)}: ${e.players.length} đồng ý, ${e.others.length} không${e.playerId ? " → bị trói" : ""}`
      : "";
    return {
      day: e.day,
      ok: starving.length === 0 && !e.playerId,
      text: [`Đêm: ${RATION_LABELS[e.ration as RationId]?.title ?? e.ration}, ăn ${e.amount} khẩu phần`, ballot, starving.length ? `đói lả: ${starving.join(", ")}` : ""]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (e.kind === "incident") {
    const parts = [...e.effects].map((x) => {
      switch (x.type) {
        case "hull":
          return `thuyền hư hại ${x.amount}`;
        case "repair":
          return `thuyền được vá thêm +${x.amount}`;
        case "food":
          return `kho mất ${-x.amount} khẩu phần`;
        case "treasure":
          return `manh mối kho báu hoá ra sai, tiến độ ${x.amount}`;
        case "itemMissing":
          return `${itemName(x.itemId)} của ${name(x.playerId)} biến mất`;
        case "strangeLight":
          return "có ánh lửa lạ ngoài khơi";
        case "rescued":
          return `${name(x.playerId)} suýt chết nhưng qua khỏi`;
        default:
          return x.type;
      }
    });
    const bad = [...e.effects].some((x) => x.type !== "repair" && x.type !== "rescued");
    return { day: e.day, ok: !bad, text: `Sáng ra: ${parts.join(" · ")}` };
  }
  if (e.kind === "dig") return { day: e.day, ok: true, text: `${name(e.playerId)} đã đào được rương kho báu!` };
  if (e.kind === "departure") {
    const behind = [...e.others].map(name);
    return {
      day: e.day,
      ok: behind.length === 0 && e.success,
      text: `Thuyền rời bến${e.success ? " cùng kho báu" : ""}${behind.length ? ` · bị bỏ lại: ${behind.join(", ")}` : ""}`,
    };
  }
  return { day: e.day, ok: false, text: `${name(e.playerId)} đã gục ngã.` };
}

/** Nhật ký công khai: 6 dòng gần nhất, bấm để xem lại cả ván. */
export function Feed({ room }: { room: IslandRoom }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useRoomSnapshot(room, (s) => [...s.log].map((e) => describe(e, s)));
  if (lines.length === 0) return null;
  const shown = expanded ? lines : lines.slice(-6);
  return (
    <section className={expanded ? "panel feed expanded" : "panel feed"}>
      <button className="ghost feed-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Thu gọn" : `Xem cả nhật ký (${lines.length})`}
      </button>
      <div className="feed-lines">
        {shown.map((l, i) => (
          <div key={i} className={l.ok ? "feed-line ok" : "feed-line bad"}>
            <span className="feed-day">N{l.day}</span> {l.text}
          </div>
        ))}
      </div>
    </section>
  );
}
