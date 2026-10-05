import type { ReactNode } from "react";
import { EMBLEM, type EmblemShape } from "@tentides/content";

// Huy hiệu (emblem) vẽ bằng SVG: nền tròn, hình biểu tượng ở giữa. Toạ độ trong khung 64 x 64.

function shape(kind: EmblemShape, c: string): ReactNode {
  switch (kind) {
    case "anchor":
      return (
        <g fill="none" stroke={c} strokeWidth={4} strokeLinecap="round">
          <circle cx={32} cy={14} r={5} />
          <path d="M32 19 V52 M22 27 H42 M14 38 Q16 52 32 52 Q48 52 50 38" />
          <path d="M10 42 L14 37 L19 41 M54 42 L50 37 L45 41" />
        </g>
      );
    case "star":
      return <polygon points="32,8 38.5,25 56,25 42,36 47.5,54 32,43 16.5,54 22,36 8,25 25.5,25" fill={c} />;
    case "crosshair":
      return (
        <g fill="none" stroke={c} strokeWidth={3.5} strokeLinecap="round">
          <circle cx={32} cy={32} r={16} />
          <circle cx={32} cy={32} r={3} fill={c} />
          <path d="M32 6 V20 M32 44 V58 M6 32 H20 M44 32 H58" />
        </g>
      );
    case "shield":
      return (
        <g>
          <path d="M32 7 L52 14 V31 Q52 49 32 58 Q12 49 12 31 V14 Z" fill={c} />
          <path d="M32 14 L45 19 V31 Q45 44 32 51 Z" fill="rgba(0,0,0,0.22)" />
        </g>
      );
    case "wings":
      return (
        <g fill={c}>
          <path d="M30 30 Q18 16 4 18 Q10 22 12 26 Q6 27 4 30 Q12 31 14 34 Q9 37 9 40 Q20 40 30 36 Z" />
          <path d="M34 30 Q46 16 60 18 Q54 22 52 26 Q58 27 60 30 Q52 31 50 34 Q55 37 55 40 Q44 40 34 36 Z" />
          <circle cx={32} cy={32} r={5} />
          <path d="M28 38 L32 50 L36 38 Z" />
        </g>
      );
    case "skull":
      return (
        <g>
          <path d="M32 9 C18 9 12 19 12 29 C12 36 16 40 20 42 V50 H44 V42 C48 40 52 36 52 29 C52 19 46 9 32 9 Z" fill={c} />
          <ellipse cx={24} cy={30} rx={5} ry={6} fill="#111" />
          <ellipse cx={40} cy={30} rx={5} ry={6} fill="#111" />
          <path d="M32 36 L29 42 H35 Z" fill="#111" />
          <path d="M26 46 V50 M32 46 V50 M38 46 V50" stroke="#111" strokeWidth={2} />
        </g>
      );
    case "lightning":
      return <polygon points="36,5 14,36 29,36 24,59 50,26 35,26 42,5" fill={c} />;
    case "crown":
      return (
        <g fill={c}>
          <path d="M10 46 L8 18 L21 31 L32 12 L43 31 L56 18 L54 46 Z" />
          <rect x={10} y={48} width={44} height={6} rx={2} />
          <circle cx={8} cy={17} r={3} />
          <circle cx={32} cy={11} r={3} />
          <circle cx={56} cy={17} r={3} />
        </g>
      );
    case "wave":
      return (
        <g fill="none" stroke={c} strokeWidth={4.5} strokeLinecap="round">
          <path d="M6 40 Q14 30 22 40 T38 40 T54 40 T62 38" />
          <path d="M8 28 Q14 14 26 18 Q20 22 22 28 Q30 18 40 24" />
          <path d="M6 50 Q14 44 22 50 T38 50 T56 50" opacity={0.6} />
        </g>
      );
    case "dragon":
      return (
        <g fill={c}>
          <path d="M14 50 Q8 36 20 28 Q30 22 26 12 Q38 16 40 26 L52 22 L46 30 L56 34 L44 36 Q40 48 26 46 Q20 46 20 52 Z" />
          <circle cx={42} cy={28} r={1.8} fill="#111" />
        </g>
      );
  }
}

/** Huy hiệu theo id (rỗng hay không có thì không vẽ gì). */
export function Emblem({ id, size = 32, className = "" }: { id: string; size?: number; className?: string }) {
  const def = EMBLEM.get(id);
  if (!def) return null;
  return (
    <svg className={`emblem ${className}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Huy hiệu ${def.name}`}>
      <title>{def.name}</title>
      <circle cx={32} cy={32} r={31} fill={def.back} stroke={def.color} strokeOpacity={0.55} strokeWidth={2} />
      {shape(def.shape, def.color)}
    </svg>
  );
}
