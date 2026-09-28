import type { Ref } from "react";
import type { Group } from "three";

/** Nhân vật graybox: thân viên nhộng, balo sau lưng, mũi nhỏ phía trước để thấy hướng nhìn. */
export function Character({ color, opacity = 1, ref }: { color: string; opacity?: number; ref?: Ref<Group> }) {
  const transparent = opacity < 1;
  return (
    <group ref={ref}>
      <mesh castShadow position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.4, 1, 4, 8]} />
        <meshStandardMaterial color={color} flatShading transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh castShadow position={[0, 1.1, -0.42]}>
        <boxGeometry args={[0.55, 0.65, 0.3]} />
        <meshStandardMaterial color="#6b4f2a" flatShading transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh position={[0, 1.45, 0.38]}>
        <boxGeometry args={[0.18, 0.12, 0.12]} />
        <meshStandardMaterial color="#222" transparent={transparent} opacity={opacity} />
      </mesh>
    </group>
  );
}
