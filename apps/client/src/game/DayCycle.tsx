import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Fog, type DirectionalLight, type HemisphereLight } from "three";
import type { IslandRoom } from "../net.ts";
import { localEnv, localPosition, sky } from "./shared.ts";
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
}: {
  room: IslandRoom;
  sun: RefObject<DirectionalLight | null>;
  hemi: RefObject<HemisphereLight | null>;
}) {
  const scene = useThree((s) => s.scene);
  const timer = useRef({ timeLeft: -1, at: 0 });

  useFrame(() => {
    const state = room.state;
    // timeLeft chỉ cập nhật mỗi giây; nội suy giữa hai lần để mặt trời đi mượt.
    const now = performance.now();
    if (state.timeLeft !== timer.current.timeLeft) timer.current = { timeLeft: state.timeLeft, at: now };
    const remaining = Math.max(state.timeLeft - 1, state.timeLeft - (now - timer.current.at) / 1000);
    const t = dayTime(state.phase, remaining, state.phaseDuration);

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
        scene.fog.near = 70;
        // Ban đêm sương mù dày hơn một chút cho thấy tối.
        scene.fog.far = 280 - 80 * night;
      }
      if (scene.background instanceof Color) scene.background.copy(horizon);
    }
    // Trong hang, hầm thì nắng và ánh trời lọt vào ít dần theo độ sâu.
    const shade = 1 - 0.82 * localEnv.indoor;

    const azimuth = Math.PI * u;
    const sunDir = skyUniforms.uSunDir.value.set(Math.cos(azimuth) * 70, 8 + elevation * 60, -25).normalize();
    skyUniforms.uMoonDir.value.set(-30, 45, 20).normalize();

    const light = sun.current;
    if (light) {
      if (t < SUNSET) {
        light.intensity = (0.6 + 2.1 * Math.pow(elevation, 0.6)) * shade;
        light.color.copy(SUN_WARM).lerp(SUN_NOON, day);
        light.position.copy(localPosition).addScaledVector(sunDir, 80);
      } else {
        light.intensity = 0.45 * shade;
        light.color.copy(MOON);
        light.position.set(localPosition.x - 30, localPosition.y + 45, localPosition.z + 20);
      }
      light.target.position.copy(localPosition);
      light.target.updateMatrixWorld();
    }
    const h = hemi.current;
    if (h) {
      // Sáng sớm, chạng vạng và ban đêm vẫn phải đủ sáng để đi lại (đêm có ánh trăng xanh nhạt).
      h.intensity = (0.75 + 0.25 * dusk + 0.4 * day) * shade * (localEnv.underwater ? 0.7 : 1);
      h.color.copy(horizon).lerp(MOON_SKY, night * 0.7).lerp(top, 0.25 * day);
      h.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, 0.3 + 0.7 * day);
    }
  });

  return null;
}
