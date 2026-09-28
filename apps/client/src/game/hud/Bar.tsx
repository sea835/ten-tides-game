export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`, background: color }} />
    </div>
  );
}
