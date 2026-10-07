import { Component, type ReactNode } from "react";
import { getGraphics } from "../game/graphics.ts";

// Có nên dựng cảnh 3D trang trí (sảnh chờ, bục vinh danh) không: máy đặt đồ hoạ Thấp hay trình duyệt không có WebGL
// thì dùng nền tĩnh. Cảnh 3D lỗi lúc chạy thì cũng lặng lẽ về nền tĩnh.

let webgl: boolean | null = null;

/** Trình duyệt có WebGL không (thử một lần). */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Cảnh 3D trang trí được bật với mức đồ hoạ này không. */
export function decor3d(quality = getGraphics().quality): boolean {
  return quality !== "low" && hasWebGL();
}

/** Cảnh 3D lỗi (mất WebGL, hết bộ nhớ...): hiện `fallback`, phần giao diện còn lại vẫn dùng được. */
export class StageBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
