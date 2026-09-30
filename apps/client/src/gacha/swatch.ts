import type { CSSProperties } from "react";
import type { SkinFinish } from "@tentides/content";

// Ô xem trước skin bằng CSS thuần (gradient), dựa trên `finish` của skin. Không cần 3D.

const c = (list: readonly string[], i: number, fallback = "#444") => list[i % Math.max(1, list.length)] ?? fallback;

export function swatchBackground(f: SkinFinish): string {
  switch (f.kind) {
    case "solid": {
      // Kim loại thì có vệt sáng rõ hơn.
      const sheen = 0.08 + f.metalness * 0.3;
      return `linear-gradient(160deg, rgba(255,255,255,${sheen}) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,${0.12 + f.roughness * 0.15}) 100%), ${f.color}`;
    }
    case "camo": {
      const p = f.palette;
      return [
        `radial-gradient(ellipse 30% 22% at 22% 30%, ${c(p, 1)} 0 96%, transparent 100%)`,
        `radial-gradient(ellipse 26% 30% at 70% 62%, ${c(p, 2)} 0 96%, transparent 100%)`,
        `radial-gradient(ellipse 22% 16% at 48% 18%, ${c(p, 3)} 0 96%, transparent 100%)`,
        `radial-gradient(ellipse 18% 24% at 88% 20%, ${c(p, 2)} 0 96%, transparent 100%)`,
        `radial-gradient(ellipse 28% 18% at 30% 84%, ${c(p, 3)} 0 96%, transparent 100%)`,
        `radial-gradient(ellipse 14% 12% at 58% 42%, ${c(p, 1)} 0 96%, transparent 100%)`,
        c(p, 0),
      ].join(", ");
    }
    case "gradient":
      return `linear-gradient(160deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 40%), linear-gradient(115deg, ${f.from}, ${f.to})`;
    case "pattern": {
      const k = f.colors;
      switch (f.pattern) {
        case "tiger":
          return `repeating-linear-gradient(112deg, transparent 0 9px, ${c(k, 1)} 9px 12px, transparent 12px 17px, ${c(k, 1)} 17px 18px, transparent 18px 26px), ${c(k, 0)}`;
        case "hex":
          return `radial-gradient(circle at 50% 50%, ${c(k, 0)} 0 55%, ${c(k, 1)} 58% 64%, transparent 66%) 0 0 / 14px 12px, radial-gradient(circle at 50% 50%, ${c(k, 0)} 0 55%, ${c(k, 1)} 58% 64%, transparent 66%) 7px 6px / 14px 12px, ${c(k, 0)}`;
        case "digital":
          return `conic-gradient(${c(k, 0)} 25%, ${c(k, 1)} 0 50%, ${c(k, 2)} 0 75%, ${c(k, 3)} 0) 0 0 / 12px 12px, ${c(k, 0)}`;
        case "carbon":
          return `repeating-linear-gradient(45deg, ${c(k, 0)} 0 3px, ${c(k, 1)} 3px 5px, ${c(k, 0)} 5px 8px), ${c(k, 0)}`;
        case "damascus":
          return `repeating-radial-gradient(ellipse 140% 60% at 20% 30%, ${c(k, 0)} 0 3px, ${c(k, 1)} 3px 5px, ${c(k, 2, c(k, 0))} 5px 8px)`;
      }
      return c(k, 0);
    }
    case "gold":
      return "linear-gradient(125deg, #7a5410 0%, #f7d774 22%, #b8860b 42%, #ffecb0 58%, #a47414 78%, #f3cf63 100%)";
    case "chrome":
      return "linear-gradient(160deg, #fbfbfc 0%, #8a929c 36%, #eef1f4 52%, #3b4048 76%, #cfd5db 100%)";
    case "neon":
      return `radial-gradient(ellipse 70% 60% at 50% 55%, ${f.color}55 0%, transparent 70%), repeating-linear-gradient(90deg, transparent 0 10px, ${f.color}33 10px 11px), #0a0e14`;
  }
}

export function swatchStyle(f: SkinFinish): CSSProperties & Record<`--${string}`, string> {
  const style: CSSProperties & Record<`--${string}`, string> = { background: swatchBackground(f) };
  if (f.kind === "neon") style["--neon"] = f.color;
  return style;
}
