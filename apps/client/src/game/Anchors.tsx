import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { ANCHORS, TREASURE_SITES } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

const OPEN_COLOR = "#ffd166";
const ACTIVE_COLOR = "#ff6b35";

function Marker({ x, y, z, active, color: override }: { x: number; y: number; z: number; active: boolean; color?: string }) {
  const gem = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (gem.current) {
      gem.current.rotation.y = t * 1.5;
      gem.current.position.y = 2.2 + Math.sin(t * 2) * 0.25;
    }
    if (ring.current) {
      // Vòng sáng loang ra trên mặt đất rồi mờ dần, lặp lại.
      const k = (t * 0.6) % 1;
      ring.current.scale.setScalar(0.6 + k * 2.6);
      (ring.current.material as MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }
  });
  const color = override ?? (active ? ACTIVE_COLOR : OPEN_COLOR);
  return (
    <group position={[x, y, z]}>
      {/* Cột sáng không bị sương mù che, để thấy từ xa mà tìm đường: lõi hẹp sáng và quầng rộng mờ. */}
      <mesh position-y={12}>
        <cylinderGeometry args={[0.18, 0.3, 24, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} fog={false} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <mesh position-y={9}>
        <cylinderGeometry args={[0.5, 0.9, 18, 10, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} fog={false} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.08}>
        <ringGeometry args={[0.85, 1, 32]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <group ref={gem}>
        <mesh castShadow>
          <octahedronGeometry args={[0.5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} toneMapped={false} flatShading />
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

  const site = useRoomSnapshot(room, (s) => (s.treasureSite && !s.treasureDug ? s.treasureSite : ""));
  const treasure = TREASURE_SITES.find((t) => t.id === site);

  return (
    <>
      {treasure && <Marker x={treasure.x} y={treasure.y} z={treasure.z} active={false} color="#e63946" />}
      {visible.map(([id, status]) => {
        const anchor = ANCHORS.find((a) => a.id === id);
        return anchor ? <Marker key={id} x={anchor.x} y={anchor.y} z={anchor.z} active={status === "active"} /> : null;
      })}
    </>
  );
}
