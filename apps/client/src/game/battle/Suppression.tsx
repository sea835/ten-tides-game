import { useEffect, useRef } from "react";
import { suppression } from "../shared.ts";

/**
 * Bị áp chế (đạn sượt sát đầu): mép màn hình tối lại và mờ nhẹ một thoáng rồi tan dần. Đọc `suppression.amount`
 * (Effects cộng vào), tự giảm dần; ghi thẳng vào style (không render lại React mỗi khung hình), ẩn hẳn khi hết để
 * không tốn bộ lọc mờ.
 */
export function Suppression() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Tan trong chừng một giây.
      suppression.amount = suppression.amount > 0.01 ? suppression.amount * Math.exp(-dt * 3.2) : 0;
      const a = Math.round(suppression.amount * 50) / 50;
      const div = el.current;
      if (div && a !== shown) {
        shown = a;
        div.style.display = a > 0 ? "block" : "none";
        div.style.opacity = String(Math.min(1, a * 1.2));
        div.style.backdropFilter = a > 0.15 ? `blur(${(a * 2).toFixed(1)}px)` : "";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      suppression.amount = 0;
    };
  }, []);
  return (
    <div
      ref={el}
      style={{
        display: "none",
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 50%, transparent 0, transparent 38%, rgba(8, 8, 10, 0.55) 78%, rgba(0, 0, 0, 0.85) 100%)",
        // Chỉ mờ phần mép (giữa trong suốt): mặt nạ theo cùng dải với lớp tối.
        maskImage: "radial-gradient(ellipse at 50% 50%, transparent 0, transparent 30%, #000 70%)",
        WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, transparent 0, transparent 30%, #000 70%)",
      }}
    />
  );
}
