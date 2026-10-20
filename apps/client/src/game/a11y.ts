import { getSettings, subscribeSettings, type Settings } from "./settings.ts";
import { SIDE_PALETTE } from "./teamColors.ts";
import "./a11y.css";

// Hỗ trợ dễ nhìn áp lên cả trang theo Cài đặt: cỡ HUD (biến CSS --hud-scale, các khung HUD phóng theo), màu phe cho
// người mù màu (lớp cb-teams + biến --team-blue / --team-red). App gọi một lần; đổi cài đặt thì áp lại ngay.

export const HUD_SCALE_MIN = 0.8;
export const HUD_SCALE_MAX = 1.3;

/** Cỡ HUD hợp lệ (cài đặt cũ hỏng, ngoài khoảng thì kéo về). */
export function clampHudScale(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  return Math.max(HUD_SCALE_MIN, Math.min(HUD_SCALE_MAX, n));
}

function apply(s: Settings) {
  const root = document.documentElement;
  root.style.setProperty("--hud-scale", String(clampHudScale(s.hudScale)));
  const p = s.colorblind ? SIDE_PALETTE.colorblind : SIDE_PALETTE.normal;
  root.style.setProperty("--team-blue", p.blue);
  root.style.setProperty("--team-red", p.red);
  root.classList.toggle("cb-teams", !!s.colorblind);
}

/** Áp cài đặt dễ nhìn lên trang và theo dõi thay đổi; trả về hàm gỡ. */
export function installA11y(): () => void {
  apply(getSettings());
  return subscribeSettings(() => apply(getSettings()));
}
