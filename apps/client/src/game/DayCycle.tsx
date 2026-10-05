import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Fog, Vector3, type DirectionalLight, type HemisphereLight, type PerspectiveCamera } from "three";
import type { IslandRoom } from "../net.ts";
import { localEnv, localPosition, sky, weatherFx } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";

const PALETTE = {
  dayTop: new Color("#3d8fd1"),
  dayHorizon: new Color("#c4e4f3"),
  duskTop: new Color("#2c3c78"),
  duskHorizon: new Color("#f39a68"),
  nightTop: new Color("#030814"),
  nightHorizon: new Color("#0e1c33"),
};
const SUN_WARM = new Color("#ffb070");
const SUN_NOON = new Color("#fff4e0");
const MOON = new Color("#8fb3ff");
const GROUND_DAY = new Color("#c2a36b");
const GROUND_NIGHT = new Color("#1a2130");
const MOON_SKY = new Color("#4a6aa8");
const UNDERWATER_DAY = new Color("#1d6f86");
const UNDERWATER_NIGHT = new Color("#04161f");
const underwaterFog = new Color();
/** Trời âm u: màu mây mưa pha vào bầu trời và sương mù. */
const OVERCAST = new Color("#8f9aa3");
const STORM_SKY = new Color("#4b5560");
const MIST = new Color("#c9d3d8");
const grey = new Color();
/** Ánh chớp: trắng xanh lạnh, phủ lên nắng và ánh trời trong tích tắc. */
const LIGHTNING = new Color("#dfe8ff");

const UP = new Vector3(0, 1, 0);
const MOON_DIR = new Vector3(-30, 45, 20).normalize();
const axisX = new Vector3();
const axisY = new Vector3();
const center = new Vector3();

/**
 * Đặt đèn mặt trời (hoặc mặt trăng) chiếu từ hướng `dir` vào người chơi, tâm vùng bóng khớp theo lưới điểm ảnh của
 * bản đồ bóng: đi lại thì bóng không lăn tăn ở mép, và bản đồ bóng vẽ thưa hơn khung hình vẫn khớp chỗ.
 */
function aimLight(light: DirectionalLight, dir: Vector3) {
  const cam = light.shadow.camera;
  const texel = (cam.right - cam.left) / light.shadow.mapSize.x;
  // Trục ngang, dọc của camera bóng (giống cách lookAt dựng khi nhìn từ đèn về tâm).
  axisX.crossVectors(UP, dir);
  if (axisX.lengthSq() < 1e-6) axisX.set(1, 0, 0);
  axisX.normalize();
  axisY.crossVectors(dir, axisX);
  center.copy(localPosition);
  const a = center.dot(axisX);
  const b = center.dot(axisY);
  center.addScaledVector(axisX, Math.round(a / texel) * texel - a).addScaledVector(axisY, Math.round(b / texel) * texel - b);
  light.position.copy(center).addScaledVector(dir, 80);
  light.target.position.copy(center);
  light.target.updateMatrixWorld();
}

/**
 * Mặt phẳng xa của camera đi theo tầm sương mù: quá `fog.far` mọi vật đã chìm hẳn vào màu sương (trùng màu nền,
 * chân trời), vẽ thêm chỉ tốn lệnh vẽ và điểm ảnh. Cộng một khoảng đệm, làm tròn theo bậc 10 m để khỏi dựng lại ma
 * trận chiếu mỗi khung hình khi sương đổi dần. Vòm trời vẽ ở đúng mặt phẳng xa (xyww) nên không bị cắt.
 */
const FAR_MARGIN = 15;
const FAR_MIN = 60;

export function farForFog(fogFar: number): number {
  return Math.max(FAR_MIN, Math.ceil((fogFar + FAR_MARGIN) / 10) * 10);
}

/** Mặt trời lặn vào lúc này trong ngày (0–1); phần sau là đêm. */
const SUNSET = 0.82;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Giờ trong ngày (0–1) suy ra từ pha hiện tại và thời gian còn lại của pha. */
export function dayTime(phase: string, remaining: number, duration: number): number {
  const p = duration > 0 ? Math.min(1, Math.max(0, 1 - remaining / duration)) : 0;
  switch (phase) {
    case "dawn":
      return 0.02 + 0.08 * p;
    case "explore":
      return 0.1 + 0.62 * p;
    case "dusk":
      return 0.72 + 0.1 * p;
    case "night":
      return SUNSET + (1 - SUNSET) * p;
    default:
      return 0.35;
  }
}

/** Đồng hồ mặt trời: vị trí, màu nắng, màu trời, sương mù và sao chạy theo giờ trong ngày. */
export function DayCycle({
  room,
  sun,
  hemi,
  ibl = false,
}: {
  room: IslandRoom;
  sun: RefObject<DirectionalLight | null>;
  hemi: RefObject<HemisphereLight | null>;
  /** Có ánh sáng môi trường lấy từ bầu trời: ánh trời phần lớn đến từ đó, đèn bán cầu chỉ còn đỡ thêm, nắng gắt hơn. */
  ibl?: boolean;
}) {
  const sunScale = ibl ? 1.4 : 1;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const timer = useRef({ timeLeft: -1, at: 0 });

  useFrame(() => {
    const state = room.state;
    // timeLeft chỉ cập nhật mỗi giây; nội suy giữa hai lần để mặt trời đi mượt.
    const now = performance.now();
    if (state.timeLeft !== timer.current.timeLeft) timer.current = { timeLeft: state.timeLeft, at: now };
    const remaining = Math.max(state.timeLeft - 1, state.timeLeft - (now - timer.current.at) / 1000);
    // Battleground: giờ trong ngày do server bốc thăm mỗi trận (sáng sớm, trưa, chiều tà, đêm) rồi trôi chậm.
    const battle = state.mode === "battle";
    const t = battle ? state.clock : dayTime(state.phase, remaining, state.phaseDuration);

    const u = Math.min(1, t / SUNSET);
    const elevation = t < SUNSET ? Math.sin(Math.PI * u) : 0;
    const dusk = smoothstep(0, 0.12, elevation);
    const day = smoothstep(0.15, 0.5, elevation);
    const night = t >= SUNSET ? 1 : 1 - smoothstep(0, 0.1, elevation);
    sky.time = t;
    sky.elevation = elevation;
    sky.night = night;

    const top = skyUniforms.uTop.value.copy(PALETTE.nightTop).lerp(PALETTE.duskTop, dusk).lerp(PALETTE.dayTop, day);
    const horizon = skyUniforms.uHorizon.value.copy(PALETTE.nightHorizon).lerp(PALETTE.duskHorizon, dusk).lerp(PALETTE.dayHorizon, day);
    // Mây dày thì trời xám lại (ban đêm vẫn tối như thường); sương mù thì chân trời trắng đục.
    const w = weatherFx;
    const overcast = Math.max(0, w.cloud - 0.3) / 0.7;
    grey.copy(OVERCAST).lerp(STORM_SKY, w.storm).multiplyScalar(0.25 + 0.75 * (1 - night));
    top.lerp(grey, overcast * (0.75 + 0.2 * w.storm));
    horizon.lerp(grey, overcast * (0.55 + 0.3 * w.storm));
    if (w.fog > 0) horizon.lerp(grey.copy(MIST).multiplyScalar(0.2 + 0.8 * (1 - night)), w.fog * 0.8);
    // Chớp: cả bầu trời lóe trắng trong tích tắc.
    if (w.flash > 0) {
      top.lerp(MIST, w.flash * 0.8);
      horizon.lerp(MIST, w.flash * 0.8);
    }
    skyUniforms.uSunColor.value.copy(SUN_WARM).lerp(SUN_NOON, day);
    skyUniforms.uNight.value = night;
    if (localEnv.underwater) {
      // Dưới nước: sương xanh đặc, nhìn không xa, sâu thì tối dần.
      underwaterFog.copy(UNDERWATER_NIGHT).lerp(UNDERWATER_DAY, 1 - night * 0.85);
      if (scene.fog instanceof Fog) {
        scene.fog.color.copy(underwaterFog);
        scene.fog.near = 1;
        scene.fog.far = 38 - 12 * night;
      }
      if (scene.background instanceof Color) scene.background.copy(underwaterFog);
    } else {
      if (scene.fog instanceof Fog) {
        scene.fog.color.copy(horizon);
        // Ban đêm sương mù dày hơn một chút cho thấy tối; trời sương, mưa thì nhìn không xa.
        const murk = Math.max(w.fog, w.rain * 0.55);
        scene.fog.near = 70 - 62 * murk;
        scene.fog.far = (280 - 80 * night) * (1 - 0.76 * murk);
      }
      if (scene.background instanceof Color) scene.background.copy(horizon);
    }
    if (scene.fog instanceof Fog) {
      const far = farForFog(scene.fog.far);
      if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }
    // Trong hang, hầm thì nắng và ánh trời lọt vào ít dần theo độ sâu.
    const shade = 1 - 0.82 * localEnv.indoor;

    const azimuth = Math.PI * u;
    const sunDir = skyUniforms.uSunDir.value.set(Math.cos(azimuth) * 70, 8 + elevation * 60, -25).normalize();
    skyUniforms.uMoonDir.value.copy(MOON_DIR);

    const light = sun.current;
    if (light) {
      if (t < SUNSET) {
        light.intensity = (0.6 + 2.1 * Math.pow(elevation, 0.6)) * sunScale * shade * (1 - 0.6 * overcast - 0.2 * w.storm) + w.flash * 3;
        light.color.copy(SUN_WARM).lerp(SUN_NOON, day);
        aimLight(light, sunDir);
      } else {
        // Đêm Battleground: trăng sáng hơn cho vẫn đánh nhau được (bóng người vẫn thấy, xa thì chìm vào tối).
        light.intensity = (battle ? 0.8 : 0.45) * shade * (1 - 0.5 * overcast) + w.flash * 3;
        light.color.copy(MOON);
        aimLight(light, MOON_DIR);
      }
      // Chớp: cả đảo bừng sáng trắng xanh (cùng nhịp với tia chớp và tiếng sấm trong Weather.tsx).
      if (w.flash > 0) light.color.lerp(LIGHTNING, Math.min(1, w.flash));
    }
    const h = hemi.current;
    if (h) {
      // Sáng sớm, chạng vạng và ban đêm vẫn phải đủ sáng để đi lại (đêm có ánh trăng xanh nhạt).
      // Có ánh trời môi trường thì ban ngày đèn bán cầu chỉ đỡ thêm; đêm trời tối đen nên vẫn cần đèn như cũ.
      const hemiScale = ibl ? 0.4 + 0.6 * night : 1;
      h.intensity = (0.75 + 0.25 * dusk + 0.4 * day) * hemiScale * shade * (localEnv.underwater ? 0.7 : 1) * (1 - 0.15 * overcast) + w.flash * 1.5;
      h.color.copy(horizon).lerp(MOON_SKY, night * 0.7).lerp(top, 0.25 * day);
      h.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, 0.3 + 0.7 * day);
      if (w.flash > 0) {
        h.color.lerp(LIGHTNING, Math.min(1, w.flash));
        h.groundColor.lerp(LIGHTNING, Math.min(1, w.flash) * 0.4);
      }
    }
  });

  return null;
}
