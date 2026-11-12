import { WebGPURenderer } from "three/webgpu";

// Mọi canvas của game (trận đấu, sảnh 3D, Kho quân nhu, bục vinh danh) dựng hình bằng WebGPURenderer của three.js:
// chạy WebGPU khi trình duyệt có, tự lùi về WebGL 2 khi không. Vật liệu, hiệu ứng viết bằng TSL (three/tsl) nên cùng
// một mã chạy trên cả hai nền. Thêm `?webgl` vào địa chỉ để ép nền WebGL 2 (kiểm tra máy không có WebGPU).

export interface RendererOptions {
  antialias?: boolean;
  alpha?: boolean;
  stencil?: boolean;
  powerPreference?: "high-performance" | "low-power";
}

const FORCE_WEBGL = typeof location !== "undefined" && new URLSearchParams(location.search).has("webgl");

/** Renderer đang chạy của canvas trận đấu (để công cụ kiểm tra và bảng F3 đọc). */
export const rendererInfo = { backend: "" as "" | "webgpu" | "webgl2" };

/**
 * Hàm tạo renderer cho prop `gl` của <Canvas> (R3F chờ được hàm async): `gl={makeRenderer({ antialias: true })}`.
 * R3F truyền vào canvas và các thông số mặc định; `options` đè lên.
 */
export function makeRenderer(options: RendererOptions = {}) {
  return async (props: unknown) => {
    const renderer = new WebGPURenderer({ ...(props as object), ...options, forceWebGL: FORCE_WEBGL } as ConstructorParameters<typeof WebGPURenderer>[0]);
    await renderer.init();
    rendererInfo.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
    // R3F khai báo kiểu theo WebGLRenderer; WebGPURenderer cùng giao diện ở những chỗ R3F dùng.
    return renderer as never;
  };
}
