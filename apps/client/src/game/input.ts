// Bàn phím và chuột. Giữ trong biến module để useFrame đọc mỗi khung hình mà không re-render React.

import { clampPitch } from "./camera.ts";

export const keys = new Set<string>();

/** Góc camera: yaw quay quanh nhân vật, pitch ngẩng lên/cúi xuống. */
export const look = { yaw: 0, pitch: 0.35 };

const MOUSE_SENSITIVITY = 0.0025;

/** Phím gõ vào ô chat không được tính là điều khiển nhân vật. */
export function isTyping(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

export function bindInput(canvas: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onClick = (e: MouseEvent) => {
    // Chỉ khoá chuột khi bấm vào cảnh 3D, không phải khi bấm nút trên HUD.
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    look.yaw -= e.movementX * MOUSE_SENSITIVITY;
    look.pitch = clampPitch(look.pitch + e.movementY * MOUSE_SENSITIVITY);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("click", onClick);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("click", onClick);
    keys.clear();
  };
}
