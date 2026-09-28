import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  Backpack,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Compass,
  EyeOff,
  Feather,
  Flag,
  Info,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Phase, WeatherId } from "@tentides/rules";

// Mảnh giao diện dùng chung cho mọi khung HUD: icon theo pha và thời tiết, avatar màu áo,
// khung cảnh báo, phím tắt.

export const WEATHER_ICONS: Record<WeatherId, LucideIcon> = {
  sunny: Sun,
  cloudy: Cloud,
  rain: CloudRain,
  fog: CloudFog,
  storm: CloudLightning,
  quake: Activity,
};

export const PHASE_ICONS: Record<Phase, LucideIcon> = {
  lobby: Users,
  create: Feather,
  pack: Backpack,
  dawn: Sunrise,
  explore: Compass,
  dusk: Sunset,
  night: Moon,
  ended: Flag,
};

/** 75 → "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Chữ đen hay trắng thì đọc rõ trên nền màu này. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#fff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a1408" : "#fff";
}

/** Vòng tròn màu áo với chữ cái đầu của tên. */
export function Avatar({ name, color, size = "md", dim = false }: { name: string; color: string; size?: "xs" | "sm" | "md" | "lg"; dim?: boolean }) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span className={`avatar ${size}${dim ? " dim" : ""}`} style={{ "--c": color, color: inkOn(color) } as CSSProperties} aria-hidden>
      {initial}
    </span>
  );
}

const CALLOUT_ICONS = { danger: TriangleAlert, caution: TriangleAlert, info: Info, secret: EyeOff } as const;

/** Khung báo ngắn có icon: nguy hiểm (đỏ), lưu ý (vàng), thông tin, hoặc bí mật (tím, chỉ mình thấy). */
export function Callout({ tone, children, icon }: { tone: keyof typeof CALLOUT_ICONS; children: ReactNode; icon?: LucideIcon }) {
  const Icon = icon ?? CALLOUT_ICONS[tone];
  return (
    <div className={`callout ${tone}`}>
      <Icon size={16} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Tiêu đề nhỏ của một nhóm, có icon. */
export function SectionLabel({ icon: Icon, children, tone }: { icon?: LucideIcon; children: ReactNode; tone?: "secret" }) {
  return (
    <div className={tone ? `label ${tone}` : "label"}>
      {Icon && <Icon size={13} aria-hidden />}
      {children}
    </div>
  );
}
