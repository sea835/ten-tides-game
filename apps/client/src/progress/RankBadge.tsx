import { rankDef, type RankGroup } from "@tentides/content";

// Phù hiệu quân hàm vẽ bằng SVG (cầu vai): mỗi nhóm một kiểu nền và dấu hiệu.
// Binh sĩ: nền ô liu, vạch chữ V vàng. Hạ sĩ quan: nền đỏ, vạch V vàng. Chuẩn uý: một vạch ngang vàng.
// Cấp uý: nền vàng, một vạch dọc đỏ, 1–4 sao. Cấp tá: nền vàng, hai vạch dọc, 1–4 sao.
// Cấp tướng: nền đỏ thẫm viền hoa văn vàng, sao vàng to. Bậc I/II/III là chấm nhỏ ở chân cầu vai.

interface GroupStyle {
  board: string;
  edge: string;
  ink: string;
  stripe?: string;
}

const STYLE: Record<RankGroup, GroupStyle> = {
  enlisted: { board: "#55603f", edge: "#2b3220", ink: "#f2c94c" },
  nco: { board: "#9b1c1c", edge: "#4c0d0d", ink: "#f2c94c" },
  warrant: { board: "#3f4a5a", edge: "#1e2530", ink: "#f2c94c" },
  company: { board: "#e8bd3a", edge: "#7a5a0e", ink: "#ffffff", stripe: "#b3261e" },
  field: { board: "#e8bd3a", edge: "#7a5a0e", ink: "#ffffff", stripe: "#b3261e" },
  general: { board: "#7f1010", edge: "#f5c84a", ink: "#ffd84d" },
};

/** Đa giác ngôi sao năm cánh tâm (cx, cy) bán kính r. */
function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(" ");
}

const BOARD = "M2 27 V7.5 L10 1.5 L18 7.5 V27 Z";

export function RankBadge({ rank, size = 18, className = "" }: { rank: number; size?: number; className?: string }) {
  const def = rankDef(rank);
  if (!def) return null;
  const st = STYLE[def.group];
  const general = def.group === "general";
  const starR = general ? 3.1 : 2.6;
  const step = general ? 5.2 : 4.9;
  // Sao xếp dọc, căn giữa cầu vai (chừa chỗ chấm bậc ở chân).
  const mid = general ? 15.5 : 14;
  const stars = Array.from({ length: def.stars }, (_, i) => mid + ((def.stars - 1) / 2 - i) * step);
  return (
    <svg className={`rank-badge ${def.group} ${className}`} width={(size * 20) / 28} height={size} viewBox="0 0 20 28" role="img" aria-label={`Quân hàm ${def.name}`}>
      <title>{`${def.name} (${def.en})`}</title>
      <path d={BOARD} fill={st.board} stroke={st.edge} strokeWidth={general ? 1.6 : 1.1} strokeLinejoin="round" />
      {general && <path d="M3.6 25.5 V8.3 L10 3.4 L16.4 8.3 V25.5" fill="none" stroke={st.edge} strokeWidth={0.7} strokeDasharray="1.2 0.9" />}
      {def.group === "company" && <rect x={9} y={4} width={2} height={23} fill={st.stripe} />}
      {def.group === "field" && (
        <>
          <rect x={5.6} y={6.5} width={1.8} height={20.5} fill={st.stripe} />
          <rect x={12.6} y={6.5} width={1.8} height={20.5} fill={st.stripe} />
        </>
      )}
      {def.group === "warrant" && <rect x={4} y={14} width={12} height={3} rx={0.6} fill={st.ink} />}
      {Array.from({ length: def.chevrons }, (_, i) => (
        <path key={i} d={`M4.5 ${11 + i * 4.2} L10 ${15 + i * 4.2} L15.5 ${11 + i * 4.2}`} fill="none" stroke={st.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {stars.map((y, i) => (
        <polygon key={i} points={starPoints(10, y, starR)} fill={st.ink} stroke={general ? "#8a5a00" : "#6b3f00"} strokeWidth={general ? 0.35 : 0.6} />
      ))}
      {Array.from({ length: def.grade }, (_, i) => (
        <circle key={i} cx={10 + (i - (def.grade - 1) / 2) * 3} cy={25} r={0.95} fill={def.group === "company" || def.group === "field" ? "#3a2a00" : st.ink} />
      ))}
    </svg>
  );
}
