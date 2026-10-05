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
        case "woodland":
          return [
            `linear-gradient(28deg, transparent 46%, ${c(k, 3)} 46% 52%, transparent 52%) 0 0 / 34px 22px`,
            `radial-gradient(ellipse 34% 26% at 25% 35%, ${c(k, 1)} 0 96%, transparent 100%)`,
            `radial-gradient(ellipse 30% 30% at 72% 66%, ${c(k, 2)} 0 96%, transparent 100%)`,
            `radial-gradient(ellipse 26% 20% at 80% 22%, ${c(k, 1)} 0 96%, transparent 100%)`,
            `radial-gradient(ellipse 22% 26% at 30% 82%, ${c(k, 2)} 0 96%, transparent 100%)`,
            c(k, 0),
          ].join(", ");
        case "chip":
          return [
            `radial-gradient(circle at 30% 40%, ${c(k, 3)} 0 1.6px, transparent 2px) 0 0 / 13px 11px`,
            `radial-gradient(circle at 46% 30%, ${c(k, 4)} 0 1.2px, transparent 1.6px) 0 0 / 13px 11px`,
            `radial-gradient(ellipse 40% 22% at 30% 40%, ${c(k, 1)} 0 96%, transparent 100%)`,
            `radial-gradient(ellipse 34% 20% at 70% 72%, ${c(k, 2)} 0 96%, transparent 100%)`,
            c(k, 0),
          ].join(", ");
        case "marpat":
          return `conic-gradient(${c(k, 1)} 25%, ${c(k, 0)} 0 50%, ${c(k, 2)} 0 75%, ${c(k, 3)} 0) 0 0 / 6px 6px, conic-gradient(${c(k, 0)} 25%, ${c(k, 2)} 0 50%, ${c(k, 1)} 0 75%, ${c(k, 0)} 0) 0 0 / 16px 16px`;
        case "snow":
          return `repeating-linear-gradient(-28deg, transparent 0 7px, ${c(k, 1)}88 7px 11px, transparent 11px 19px, ${c(k, 2)}55 19px 21px), ${c(k, 0)}`;
        case "filigree":
          return `repeating-radial-gradient(circle at 25% 50%, ${c(k, 0)} 0 3px, ${c(k, 1)} 3px 4px, ${c(k, 2)} 4px 5px) 0 0 / 16px 16px, ${c(k, 0)}`;
      }
      return c(k, 0);
    }
    case "gold":
      return "linear-gradient(125deg, #7a5410 0%, #f7d774 22%, #b8860b 42%, #ffecb0 58%, #a47414 78%, #f3cf63 100%)";
    case "chrome":
      return "linear-gradient(160deg, #fbfbfc 0%, #8a929c 36%, #eef1f4 52%, #3b4048 76%, #cfd5db 100%)";
    case "neon":
      if (f.accent)
        return `radial-gradient(ellipse 60% 50% at 35% 55%, ${f.color}55 0%, transparent 70%), radial-gradient(ellipse 50% 45% at 72% 40%, ${f.accent}44 0%, transparent 70%), repeating-linear-gradient(90deg, transparent 0 10px, ${f.color}33 10px 11px, transparent 11px 20px, ${f.accent}33 20px 21px), #0a0612`;
      return `radial-gradient(ellipse 70% 60% at 50% 55%, ${f.color}55 0%, transparent 70%), repeating-linear-gradient(90deg, transparent 0 10px, ${f.color}33 10px 11px), #0a0e14`;
  }
}

export function swatchStyle(f: SkinFinish): CSSProperties & Record<`--${string}`, string> {
  const style: CSSProperties & Record<`--${string}`, string> = { background: swatchBackground(f) };
  if (f.kind === "neon") style["--neon"] = f.color;
  return style;
}
