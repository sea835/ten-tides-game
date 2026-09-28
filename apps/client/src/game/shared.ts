import { Vector3 } from "three";

/** Vị trí chân nhân vật của mình, LocalPlayer ghi mỗi khung hình để các phần khác đọc. */
export const localPosition = new Vector3();

/** Mình có đang đi/chạy/ngồi không, để nhân vật tạo dáng. LocalPlayer ghi mỗi khung hình. */
export const localMotion = { moving: false, running: false, sitting: false };

/**
 * Giờ trong ngày (0–1) và độ cao mặt trời (0–1), DayCycle ghi mỗi khung hình để bầu trời,
 * mặt nước, lửa trại... đọc theo mà không cần tự tính lại.
 */
export const sky = { time: 0.35, elevation: 1, night: 0 };
