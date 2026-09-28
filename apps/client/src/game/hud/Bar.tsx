/** Thanh đo. `marker` vẽ một vạch ngưỡng (vd. độ bền thuyền cần để rời đảo). */
export function Bar({ value, max, color, marker, size = "md" }: { value: number; max: number; color: string; marker?: number; size?: "sm" | "md" }) {
  const pct = (n: number) => Math.max(0, Math.min(100, (n / Math.max(1, max)) * 100));
  return (
    <div className={`bar ${size}`}>
      <div className="bar-fill" style={{ width: `${pct(value)}%`, background: color }} />
      {marker !== undefined && <div className="bar-marker" style={{ left: `${pct(marker)}%` }} />}
    </div>
  );
}
