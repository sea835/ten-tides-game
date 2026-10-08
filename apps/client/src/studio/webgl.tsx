import { Component, type ReactNode } from "react";
import { getGraphics } from "../game/graphics.ts";
import { platform } from "../game/platform.ts";

// Có nên dựng cảnh 3D trang trí (sảnh chờ, bục vinh danh) không: máy đặt đồ hoạ Thấp, trình duyệt không có WebGL 2
// hay đang vẽ bằng CPU thì dùng nền tĩnh. Cảnh 3D lỗi lúc chạy thì cũng lặng lẽ về nền tĩnh.

/** Trình duyệt có WebGL 2 không (three.js bản này không chạy được trên WebGL 1). */
export function hasWebGL(): boolean {
  return platform().webgl2;
}

/** Cảnh 3D trang trí được bật với mức đồ hoạ này không (vẽ bằng CPU thì thôi: chỉ riêng nền sảnh đã đủ giật). */
export function decor3d(quality = getGraphics().quality): boolean {
  return quality !== "low" && hasWebGL() && platform().tier !== "software";
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
