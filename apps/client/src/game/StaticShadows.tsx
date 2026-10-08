import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight, Group } from "three";
import type { Profile } from "./graphics.ts";
import { addStaticRoot, releaseStaticRoots, updateStaticShadow } from "./staticShadow.ts";

/** Bản đồ bóng tĩnh phủ rộng gấp rưỡi vùng bóng động (cùng độ nét: cỡ bản đồ cũng gấp rưỡi). */
const REACH = 1.5;

/**
 * Đèn giữ bản đồ bóng tĩnh (cường độ 0, không chiếu sáng), đặt ngay sau đèn mặt trời trong cùng một nhóm: shader coi
 * đèn đổ bóng thứ hai là bóng tĩnh.
 */
export function StaticSun({ sun, profile }: { sun: RefObject<DirectionalLight | null>; profile: Profile }) {
  const keep = useRef<DirectionalLight>(null);
  const e = profile.shadowExtent * REACH;
  const size = Math.min(4096, Math.round(profile.shadowMap * REACH));
  useEffect(() => {
    const k = keep.current;
    if (k) k.shadow.autoUpdate = false;
    return releaseStaticRoots;
  }, []);
  useFrame(({ gl, clock }) => {
    const s = sun.current;
    const k = keep.current;
    // Người chơi đi xa khỏi tâm quá phần dư (vùng tĩnh rộng hơn vùng động) thì vẽ lại, để vùng động luôn nằm gọn trong.
    if (s && k) updateStaticShadow(gl, s, k, e - profile.shadowExtent, clock.elapsedTime);
  });
  return (
    <directionalLight
      ref={keep}
      intensity={0}
      castShadow
      shadow-mapSize={[size, size]}
      shadow-bias={-0.0003}
      shadow-normalBias={0.04}
      shadow-radius={profile.shadowRadius}
      shadow-camera-left={-e}
      shadow-camera-right={e}
      shadow-camera-top={e}
      shadow-camera-bottom={-e}
      shadow-camera-far={180}
    />
  );
}

/** Nhánh cảnh đứng yên (địa hình, cây, nhà, đá): bóng vẽ vào bản đồ tĩnh, không vẽ lại theo từng khung. */
export function StaticShadowRoot({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useEffect(() => (group.current ? addStaticRoot(group.current) : undefined), []);
  return <group ref={group}>{children}</group>;
}
