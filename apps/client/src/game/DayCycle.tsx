import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Fog, type DirectionalLight, type HemisphereLight } from "three";
import type { IslandRoom } from "../net.ts";
import { localPosition } from "./shared.ts";

const NIGHT = new Color("#0b1a2e");
const TWILIGHT = new Color("#f2a37a");
const DAY = new Color("#bfe3f5");
const SUN_WARM = new Color("#ffc58a");
const SUN_NOON = new Color("#fff6e5");
const MOON = new Color("#8fb3ff");

/** Mặt trời lặn vào lúc này trong ngày (0–1); phần sau là đêm. */
const SUNSET = 0.82;

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

/** Đồng hồ mặt trời: vị trí, màu nắng, màu trời và sương mù chạy theo giờ trong ngày. */
export function DayCycle({
  room,
  sun,
  sky,
}: {
  room: IslandRoom;
  sun: RefObject<DirectionalLight | null>;
  sky: RefObject<HemisphereLight | null>;
}) {
  const scene = useThree((s) => s.scene);
  const timer = useRef({ timeLeft: -1, at: 0 });
  const color = useRef(new Color());

  useFrame(() => {
    const state = room.state;
    // timeLeft chỉ cập nhật mỗi giây; nội suy giữa hai lần để mặt trời đi mượt.
    const now = performance.now();
    if (state.timeLeft !== timer.current.timeLeft) timer.current = { timeLeft: state.timeLeft, at: now };
    const remaining = Math.max(state.timeLeft - 1, state.timeLeft - (now - timer.current.at) / 1000);
    const t = dayTime(state.phase, remaining, state.phaseDuration);

    const u = Math.min(1, t / SUNSET);
    const elevation = t < SUNSET ? Math.sin(Math.PI * u) : 0;

    const c = color.current;
    if (t >= SUNSET) c.copy(NIGHT);
    else if (elevation < 0.45) c.copy(NIGHT).lerp(TWILIGHT, Math.min(1, elevation / 0.15)).lerp(DAY, Math.max(0, (elevation - 0.2) / 0.25));
    else c.copy(DAY);
    if (scene.background instanceof Color) scene.background.copy(c);
    if (scene.fog instanceof Fog) scene.fog.color.copy(c);

    const light = sun.current;
    if (light) {
      if (t < SUNSET) {
        light.intensity = 0.2 + 2.2 * Math.pow(elevation, 0.6);
        light.color.copy(SUN_WARM).lerp(SUN_NOON, elevation);
        const azimuth = Math.PI * u;
        light.position.set(
          localPosition.x + Math.cos(azimuth) * 70,
          localPosition.y + 8 + elevation * 60,
          localPosition.z - 25,
        );
      } else {
        light.intensity = 0.35;
        light.color.copy(MOON);
        light.position.set(localPosition.x - 30, localPosition.y + 60, localPosition.z + 20);
      }
      light.target.position.copy(localPosition);
      light.target.updateMatrixWorld();
    }
    if (sky.current) sky.current.intensity = 0.25 + 0.9 * elevation;
  });

  return null;
}
