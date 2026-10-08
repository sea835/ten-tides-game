// Bàn phím và chuột. Giữ trong biến module để useFrame đọc mỗi khung hình mà không re-render React.

import { clampPitch } from "./camera.ts";
import { aimZoom, getSettings } from "./settings.ts";
import { recoil } from "./battle/runtime.ts";

export const keys = new Set<string>();

/** Góc camera: yaw quay quanh nhân vật, pitch ngẩng lên/cúi xuống. */
export const look = { yaw: 0, pitch: 0.35 };

/**
 * Góc camera thật sự đang vẽ: đuổi theo `look` (chuột, giật súng) theo hàm mũ, nên cú vẩy chuột và các sự kiện chuột
 * đến lệch nhịp khung hình không làm hình giật cục. Mức mượt theo cài đặt; 0 là bám sát tuyệt đối.
 */
export const view = { yaw: 0, pitch: 0.35 };

export function smoothView(dt: number, snap = false) {
  const k = getSettings().smoothing;
  if (snap || k <= 0.001) {
    view.yaw = look.yaw;
    view.pitch = look.pitch;
    return;
  }
  // Hằng số thời gian 8–45 ms: mượt mà không thấy trễ tay.
  const tau = 0.008 + k * 0.037;
  const a = 1 - Math.exp(-dt / tau);
  view.yaw += (look.yaw - view.yaw) * a;
  view.pitch += (look.pitch - view.pitch) * a;
}

const MOUSE_SENSITIVITY = 0.0025;

/**
 * Khoá hướng nhìn (vòng khẩu lệnh bộ đàm đang mở): chuột không xoay camera nữa mà cộng dồn vào `dx`, `dy` để chọn
 * ô trên vòng.
 */
export const lookLock = { active: false, dx: 0, dy: 0 };

/** Phím gõ vào ô chat không được tính là điều khiển nhân vật. */
export function isTyping(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

/**
 * Chuột đang khoá vào vùng chơi (khung bọc hay chính canvas bên trong). Đóng cửa hàng bằng phím khoá chuột vào
 * thẳng canvas (battle/runtime.ts), trước đây chỉ nhận khung bọc nên khoá xong mà xoay chuột không quay được góc nhìn.
 */
function lockedIn(root: HTMLElement): boolean {
  const el = document.pointerLockElement;
  return !!el && root.contains(el);
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
    if (!lockedIn(canvas)) void canvas.requestPointerLock?.();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!lockedIn(canvas)) return;
    // Độ nhạy theo cài đặt; đang ngắm thì chậm lại theo mức phóng đại để nhắm xa không bị giật tay.
    const set = getSettings();
    const zoomed = aimZoom.value > 1.01;
    const k = MOUSE_SENSITIVITY * set.sensitivity * (zoomed ? (aimZoom.value >= 3 ? set.scopeSensitivity : set.adsSensitivity) / Math.sqrt(aimZoom.value) : 1);
    // Bỏ các cú nhảy chuột bất thường (trình duyệt đôi khi trả về một cú movementX khổng lồ khi khoá chuột).
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    if (lookLock.active) {
      lookLock.dx += e.movementX;
      lookLock.dy += e.movementY;
      return;
    }
    const dy = e.movementY * k * (set.invertY ? -1 : 1);
    look.yaw -= e.movementX * k;
    look.pitch = clampPitch(look.pitch + dy);
    // Ghì chuột xuống chống giật: phần đã ghì không bị hồi lại sau loạt bắn nữa.
    if (dy > 0 && recoil.pitch > 0) recoil.pitch = Math.max(0, recoil.pitch - dy);
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
