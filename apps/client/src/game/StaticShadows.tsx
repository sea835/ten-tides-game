import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { DirectionalLight, type Group } from "three";
import type { Profile } from "./graphics.ts";
import { addStaticRoot, bindStaticShadow, releaseStaticRoots, updateStaticShadow } from "./staticShadow.ts";

/** Bản đồ bóng tĩnh phủ rộng gấp rưỡi vùng bóng động (cùng độ nét: cỡ bản đồ cũng gấp rưỡi). */
const REACH = 1.5;

/**
 * Đèn giữ bản đồ bóng tĩnh (cường độ 0, không chiếu sáng, không nằm trong cảnh): chỉ là chủ của một bản đồ bóng thứ
 * hai, được nhân vào bóng của mặt trời (xem staticShadow.ts). Đèn tạo lại khi đổi mức đồ hoạ (nhóm mặt trời đổi key).
 */
export function StaticSun({ sun, profile }: { sun: RefObject<DirectionalLight | null>; profile: Profile }) {
  const e = profile.shadowExtent * REACH;
  const size = Math.min(4096, Math.round(profile.shadowMap * REACH));
  const keep = useMemo(() => {
    const k = new DirectionalLight(0xffffff, 0);
    k.shadow.mapSize.set(size, size);
    k.shadow.bias = -0.0003;
    k.shadow.normalBias = 0.04;
    k.shadow.radius = profile.shadowRadius;
    const c = k.shadow.camera;
    c.left = c.bottom = -e;
    c.right = c.top = e;
    c.far = 180;
    c.updateProjectionMatrix();
    return k;
  }, [e, size, profile.shadowRadius]);
  useEffect(() => {
    const s = sun.current;
    const unbind = s ? bindStaticShadow(s, keep) : undefined;
    return () => {
      unbind?.();
      releaseStaticRoots();
      keep.dispose();
    };
  }, [sun, keep]);
  useFrame(({ clock }) => {
    const s = sun.current;
    // Người chơi đi xa khỏi tâm quá phần dư (vùng tĩnh rộng hơn vùng động) thì vẽ lại, để vùng động luôn nằm gọn trong.
    if (s) updateStaticShadow(s, keep, e - profile.shadowExtent, clock.elapsedTime);
  });
  return null;
}

/** Nhánh cảnh đứng yên (địa hình, cây, nhà, đá): bóng vẽ vào bản đồ tĩnh, không vẽ lại theo từng khung. */
export function StaticShadowRoot({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useEffect(() => (group.current ? addStaticRoot(group.current) : undefined), []);
  return <group ref={group}>{children}</group>;
}
