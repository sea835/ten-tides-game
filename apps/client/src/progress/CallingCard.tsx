import type { CSSProperties, ReactNode } from "react";
import { CALLING_CARD, CALLING_CARDS, type CallingCardDef, type CardPattern } from "@tentides/content";
import { Emblem } from "./Emblem.tsx";
import { RankBadge } from "./RankBadge.tsx";
import "./progress.css";

// Thẻ tên (calling card): băng rôn nền chuyển màu phủ hoa văn CSS, huy hiệu bên trái, quân hàm và tên.
// Hiện ở bảng tài khoản, màn chọn thẻ, và băng rôn "Bạn bị hạ bởi ..." khi bị hạ.

/** Thẻ mặc định khi chưa lắp thẻ nào. */
const DEFAULT_CARD: CallingCardDef = CALLING_CARDS[0]!;

function patternLayer(p: CardPattern, a: string): string {
  switch (p) {
    case "stripes":
      return `repeating-linear-gradient(135deg, ${a}2e 0 3px, transparent 3px 16px)`;
    case "chevrons":
      return `linear-gradient(135deg, ${a}26 25%, transparent 25%) -12px 0 / 24px 24px, linear-gradient(225deg, ${a}26 25%, transparent 25%) -12px 0 / 24px 24px`;
    case "grid":
      return `repeating-linear-gradient(0deg, ${a}22 0 1px, transparent 1px 14px), repeating-linear-gradient(90deg, ${a}22 0 1px, transparent 1px 14px)`;
    case "rays":
      return `repeating-conic-gradient(from 0deg at 82% 50%, ${a}33 0 7deg, transparent 7deg 20deg)`;
    case "waves":
      return `radial-gradient(circle at 50% 120%, transparent 12px, ${a}2a 13px 15px, transparent 16px) 0 0 / 28px 16px`;
    case "camo":
      return [
        `radial-gradient(ellipse 18% 40% at 20% 30%, ${a}30 0 95%, transparent 100%)`,
        `radial-gradient(ellipse 14% 34% at 55% 70%, ${a}28 0 95%, transparent 100%)`,
        `radial-gradient(ellipse 12% 30% at 80% 25%, #00000040 0 95%, transparent 100%)`,
        `radial-gradient(ellipse 16% 36% at 38% 80%, #00000038 0 95%, transparent 100%)`,
      ].join(", ");
    case "stars":
      return `radial-gradient(circle, ${a}66 0 1.4px, transparent 2px) 0 0 / 18px 14px, radial-gradient(circle, ${a}33 0 1px, transparent 1.5px) 9px 7px / 18px 14px`;
    case "circuit":
      return `repeating-linear-gradient(90deg, transparent 0 22px, ${a}55 22px 23px), repeating-linear-gradient(0deg, transparent 0 15px, #22e4ff44 15px 16px), radial-gradient(ellipse 60% 120% at 80% 50%, ${a}40, transparent 70%)`;
  }
}

export function cardStyle(def: CallingCardDef): CSSProperties {
  return { background: `${patternLayer(def.pattern, def.accent)}, linear-gradient(100deg, ${def.from}, ${def.to})`, ["--card-accent" as string]: def.accent };
}

/**
 * Băng rôn thẻ tên. `cardId` rỗng là thẻ mặc định. `children` thay cho dòng phụ (vd. tên súng đã hạ mình).
 */
export function CallingCard({
  cardId,
  emblemId,
  name,
  rank,
  kicker,
  children,
  size = "md",
}: {
  cardId: string;
  emblemId: string;
  name: string;
  rank: number;
  kicker?: string;
  children?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const def = CALLING_CARD.get(cardId) ?? DEFAULT_CARD;
  return (
    <div className={`calling-card ${size} p-${def.pattern}`} style={cardStyle(def)}>
      <div className="cc-emblem">{emblemId ? <Emblem id={emblemId} size={size === "lg" ? 54 : size === "sm" ? 30 : 42} /> : <span className="cc-initial">{name.slice(0, 1).toUpperCase()}</span>}</div>
      <div className="cc-text">
        {kicker && <div className="cc-kicker">{kicker}</div>}
        <div className="cc-name">
          {rank > 0 && <RankBadge rank={rank} size={size === "lg" ? 24 : 18} />}
          <span>{name}</span>
        </div>
        {children && <div className="cc-sub">{children}</div>}
      </div>
    </div>
  );
}
