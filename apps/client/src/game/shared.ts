import { Vector3 } from "three";

/** Vị trí chân nhân vật của mình, LocalPlayer ghi mỗi khung hình để các phần khác đọc. */
export const localPosition = new Vector3();

/** Mình có đang đi/chạy/ngồi/bơi không, để nhân vật tạo dáng. LocalPlayer ghi mỗi khung hình. */
export const localMotion = {
  moving: false,
  running: false,
  sitting: false,
  swimming: false,
  climbing: false,
  sliding: false,
  // Battleground: ngồi xổm, ngắm, góc ngắm lên xuống, bộ đếm phát bắn (để giật súng).
  crouching: false,
  /** Nằm sấp. */
  prone: false,
  aiming: false,
  aimPitch: 0,
  /** Nghiêng người (Q/E): −1 trái … 1 phải. */
  lean: 0,
  firing: 0,
  /** Súng dí sát vật cản (0–1): dựng nòng lên. */
  wall: 0,
  /** Tốc độ ngang thật (m/s), để nhịp bước khớp tốc độ; không có thì theo cờ đi / chạy. */
  speed: undefined as number | undefined,
  /**
   * Bộ đếm nhịp chân (mỗi lần chạm đất là 1). LocalPlayer cộng dồn cùng phase với camera bob,
   * Soundscape phát tiếng khi số này tăng — trước đây tiếng chân chạy timer riêng nên lệch ~3×.
   */
  steps: 0,
  /** Nhịp bước vừa phát trong khung này, để không phát tiếng hai lần cho một nhịp. */
  stepHit: false,
  /** Nhịp bước này là do bước trên mặt đất (để biết có nên dùng bộ đếm hay timer riêng). */
  groundStep: false,
};

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

/** Rung màn hình: cường độ giảm dần theo thời gian (bị đánh, cây đổ gần, nổ). */
export const shake = { amount: 0 };

/**
 * Bị áp chế (đạn sượt sát đầu, 0–1): Effects cộng vào khi có đạn bay dưới 1 m, lớp phủ Suppression đọc để tối mép
 * màn hình và mờ nhẹ rồi tự giảm dần.
 */
export const suppression = { amount: 0 };

/** Đẩy lùi khi bị đánh trúng: vận tốc ngang giảm dần, LocalPlayer cộng vào chuyển động. */
export const knock = { vx: 0, vz: 0 };

/** Bóng công trình đang ngắm để dựng (Camp tính mỗi khung hình, Controls gửi lên server khi bấm). */
export const buildGhost = { x: 0, z: 0, rot: 0, turn: 0, ok: false, kind: "" };

/** Leo cây: LocalPlayer vừa bấm E xin leo cây này, chờ server đồng ý. */
export const climbRequest = { treeId: "" };

/** Vừa đánh hay ném theo hướng camera: LocalPlayer quay người về hướng này một lúc. */
export const localAim = { yaw: 0, at: 0 };

/**
 * Thời tiết đang hiện trên màn hình (0–1, chuyển dần khi đổi ngày), Weather ghi mỗi khung hình để bầu trời,
 * ánh sáng, sương mù, gió đọc theo: độ phủ mây, mưa, sương, bão, động đất, và chớp (lóe sáng trong tích tắc).
 */
export const weatherFx = { cloud: 0.15, rain: 0, fog: 0, storm: 0, quake: 0, flash: 0, snow: 0 };
