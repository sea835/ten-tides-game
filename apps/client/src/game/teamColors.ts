import { getSettings } from "./settings.ts";

// Màu hai phe (Đại chiến, Hải chiến) gom một chỗ: lá cờ, vòng cứ điểm, xe, chiến hạm, bản đồ nhỏ, bảng điểm đều đọc ở
// đây. Bật "Màu phe cho người mù màu" trong Cài đặt thì phe Đỏ đổi sang cam (xanh dương / cam phân biệt được với cả
// mù màu đỏ - lục lẫn xanh - vàng); phần CSS đổi theo lớp `cb-teams` trên gốc trang (a11y.ts, a11y.css).

export const SIDE_PALETTE = {
  normal: { blue: "#2f6bff", red: "#e0332b" },
  colorblind: { blue: "#2f6bff", red: "#ff8c1a" },
} as const;

/** Màu chưa phe nào giữ (cờ trắng). */
export const NEUTRAL_SIDE = "#e8e8e0";

/** Màu một phe ("blue" / "red"); phe khác (đội tiểu đội, rỗng) trả về `fallback`. */
export function sideColor(side: string, fallback = NEUTRAL_SIDE, colorblind = getSettings().colorblind): string {
  const p = colorblind ? SIDE_PALETTE.colorblind : SIDE_PALETTE.normal;
  return side === "blue" ? p.blue : side === "red" ? p.red : fallback;
}
