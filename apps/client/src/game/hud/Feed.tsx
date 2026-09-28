import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Dices,
  Gem,
  Hammer,
  Moon,
  PawPrint,
  Sailboat,
  Skull,
  Sparkles,
  Sunset,
  Swords,
  TreePalm,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { RATION_LABELS, content, worldCatalog } from "@tentides/content";
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

const KIND_ICONS: Record<string, LucideIcon> = {
  check: Dices,
  dusk: Sunset,
  night: Moon,
  incident: TriangleAlert,
  dig: Gem,
  departure: Sailboat,
  death: Skull,
  encounter: Sparkles,
  build: Hammer,
};

const ENCOUNTER_ICONS: Record<string, LucideIcon> = {
  egg: Sparkles,
  anomaly: Sparkles,
  trap: TriangleAlert,
  creature: PawPrint,
  friend: PawPrint,
  drowning: Skull,
  attack: Swords,
  fall: TreePalm,
  hunt: PawPrint,
};

const EFFECT_WORDS: Record<string, string> = { hp: "Máu", morale: "Tinh thần", hunger: "No", stamina: "Sức bền", food: "lương thực", treasure: "kho báu" };

function encounterLine(e: LogEntryState, name: (id: string) => string): Line {
  const who = name(e.playerId);
  const effects = [...e.effects]
    .map((x) => (x.type === "gain" ? `nhặt được ${itemName(x.itemId)}` : `${signed(x.amount)} ${EFFECT_WORDS[x.type] ?? x.type}`))
    .join(", ");
  const tail = effects ? ` (${effects})` : "";
  const poi = worldCatalog.pois.get(e.defId);
  const creature = worldCatalog.creatures.get(e.defId);
  const trap = worldCatalog.traps.get(e.defId);
  switch (e.source) {
    case "egg":
      return { day: e.day, ok: true, text: `${who} tìm thấy ${poi?.name.toLowerCase() ?? "một bí mật"}${tail}` };
    case "anomaly":
      return { day: e.day, ok: ![...e.effects].some((x) => x.amount < 0), text: `${who} chạm vào ${poi?.name.toLowerCase() ?? "điều gì đó lạ"}${tail}` };
    case "trap":
      return e.dodged
        ? { day: e.day, ok: true, text: `${who} né được ${trap?.name.toLowerCase() ?? "một cái bẫy"}` }
        : { day: e.day, ok: false, text: `${who} sập ${trap?.name.toLowerCase() ?? "bẫy"}${tail}` };
    case "creature":
      return { day: e.day, ok: false, text: `${creature?.name ?? "Thú dữ"} tấn công ${who}${tail}` };
    case "friend":
      return { day: e.day, ok: true, text: `${who} làm quen với ${creature?.name.toLowerCase() ?? "một con vật"}${tail}` };
    case "attack": {
      const weapon = e.defId === "fists" ? "tay không" : itemName(e.defId);
      return { day: e.day, ok: false, text: `${name(e.refId)} đánh ${who} bằng ${weapon}${tail}` };
    }
    case "fall":
      return { day: e.day, ok: false, text: `${who} ngã từ trên cây bị đốn${tail}` };
    case "hunt":
      return { day: e.day, ok: false, text: `${who} giết ${creature?.name.toLowerCase() ?? "một con vật hiền lành"}${tail}` };
    default:
      return { day: e.day, ok: false, text: `${who} suýt đuối nước${tail}` };
  }
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
  if (e.kind === "encounter") return encounterLine(e, name);
  if (e.kind === "build") {
    const b = worldCatalog.buildings.get(e.building);
    return { day: e.day, ok: true, text: `${name(e.playerId)} dựng ${b?.name.toLowerCase() ?? "một công trình"} ở trại` };
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

/** Nhật ký công khai: vài dòng gần nhất, bấm để xem lại cả ván. */
export function Feed({ room }: { room: IslandRoom }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useRoomSnapshot(room, (s) => [...s.log].map((e) => ({ ...describe(e, s), kind: e.kind, source: e.source })));
  if (lines.length === 0) return null;
  const shown = expanded ? lines : lines.slice(-4);
  return (
    <section className={expanded ? "panel feed expanded" : "panel feed"}>
      <button className="feed-toggle" onClick={() => setExpanded(!expanded)}>
        <span>Nhật ký</span>
        <span className="hint">{expanded ? "Thu gọn" : `${lines.length} dòng`}</span>
        {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
      </button>
      <div className="feed-lines">
        {shown.map((l, i) => {
          const Icon = (l.kind === "encounter" ? ENCOUNTER_ICONS[l.source] : KIND_ICONS[l.kind]) ?? TriangleAlert;
          return (
            <div key={expanded ? i : lines.length - shown.length + i} className={l.ok ? "feed-line ok" : "feed-line bad"}>
              <Icon size={13} aria-hidden />
              <span className="feed-day">N{l.day}</span>
              <span>{l.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
