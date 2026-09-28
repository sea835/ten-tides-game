import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Group } from "three";
import { ANCHORS } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

const OPEN_COLOR = "#ffd166";
const ACTIVE_COLOR = "#ff6b35";

function Marker({ x, y, z, active }: { x: number; y: number; z: number; active: boolean }) {
  const gem = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!gem.current) return;
    gem.current.rotation.y = clock.elapsedTime * 1.5;
    gem.current.position.y = 2.2 + Math.sin(clock.elapsedTime * 2) * 0.25;
  });
  const color = active ? ACTIVE_COLOR : OPEN_COLOR;
  return (
    <group position={[x, y, z]}>
      {/* Cột sáng không bị sương mù che, để thấy từ xa mà tìm đường. */}
      <mesh position-y={10}>
        <cylinderGeometry args={[0.25, 0.45, 20, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} fog={false} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <group ref={gem}>
        <mesh>
          <octahedronGeometry args={[0.5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/** Điểm sự kiện có thẻ đang chờ hiện thành cột sáng; đang có người mở thì đổi màu. */
export function Anchors({ room }: { room: IslandRoom }) {
  const visible = useRoomSnapshot(room, (s) => {
    if (s.phase !== "dawn" && s.phase !== "explore") return [];
    return [...s.anchors.entries()].filter(([, a]) => a.status !== "resolved").map(([id, a]) => [id, a.status] as const);
  });

  return (
    <>
      {visible.map(([id, status]) => {
        const anchor = ANCHORS.find((a) => a.id === id);
        return anchor ? <Marker key={id} x={anchor.x} y={anchor.y} z={anchor.z} active={status === "active"} /> : null;
      })}
    </>
  );
}
