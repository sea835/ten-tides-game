import { Vector3 } from "three";

/** Vị trí chân nhân vật của mình, LocalPlayer ghi mỗi khung hình để các phần khác đọc. */
export const localPosition = new Vector3();

/** Mình có đang đi/chạy/ngồi/bơi không, để nhân vật tạo dáng. LocalPlayer ghi mỗi khung hình. */
export const localMotion = { moving: false, running: false, sitting: false, swimming: false };

/**
 * Môi trường quanh mình, LocalPlayer ghi mỗi khung hình: `indoor` là độ sâu trong hang/hầm (0 ngoài trời, 1 sâu nhất),
 * `underwater` là camera đang ở dưới mặt nước, `light` là mình đang cầm đèn dầu hay đuốc.
 */
export const localEnv = { indoor: 0, underwater: false, light: false };

/**
 * Giờ trong ngày (0–1) và độ cao mặt trời (0–1), DayCycle ghi mỗi khung hình để bầu trời,
 * mặt nước, lửa trại... đọc theo mà không cần tự tính lại.
 */
export const sky = { time: 0.35, elevation: 1, night: 0 };

/** Camera tự do khi dev (window.__tentides.debugCam): bật lên thì camera đứng ở `position`, nhìn về `target`. */
export const debugCam = { enabled: false, position: new Vector3(0, 120, 160), target: new Vector3(0, 0, 0) };
