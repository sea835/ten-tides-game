import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from "three";
import type { DiaryPage, World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { localPosition } from "./shared.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Trang nhật ký của người xưa: mỗi ngày một trang nằm đâu đó trên đảo, chặn dưới một hòn đá cho khỏi bay,
// mép giấy phần phật trong gió. Có một quầng sáng mờ để ai để ý mới thấy (không rực như điểm sự kiện).

function Page({ page }: { page: DiaryPage }) {
  const flap = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const root = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + page.day * 1.7;
    if (root.current) root.current.visible = Math.hypot(page.x - localPosition.x, page.z - localPosition.z) < 80;
    if (flap.current) flap.current.rotation.x = -0.15 - Math.abs(Math.sin(t * 3.1) * Math.sin(t * 0.7)) * 0.7;
    if (glow.current) (glow.current.material as MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 2) * 0.08;
  });
  return (
    <group ref={root} position={[page.x, page.y + 0.03, page.z]} rotation-y={page.rot}>
      {/* Nửa trang nằm yên dưới hòn đá, nửa kia bị gió lật lên. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0.12]} receiveShadow>
        <planeGeometry args={[0.42, 0.26]} />
        <meshStandardMaterial color="#efe2bd" side={DoubleSide} roughness={0.9} />
      </mesh>
      <group ref={flap} position={[0, 0.012, -0.01]}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, -0.13]} castShadow>
          <planeGeometry args={[0.42, 0.26]} />
          <meshStandardMaterial color="#e6d6aa" side={DoubleSide} roughness={0.9} />
        </mesh>
      </group>
      {/* Mấy dòng chữ mực. */}
      {[0.06, 0.12, 0.18].map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[-0.02, 0.013, z]}>
          <planeGeometry args={[0.3, 0.012]} />
          <meshBasicMaterial color="#5a4632" />
        </mesh>
      ))}
      <mesh position={[0.12, 0.06, 0.18]} castShadow>
        <dodecahedronGeometry args={[0.08, 0]} />
        <meshStandardMaterial color="#7d7a73" flatShading />
      </mesh>
      <mesh ref={glow} rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[0.9, 20]} />
        <meshBasicMaterial color="#fff1c2" transparent opacity={0.2} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Pages({ room, world }: { room: IslandRoom; world: World }) {
  const view = useRoomSnapshot(room, (s) => ({ day: s.day, found: [...s.discovered].filter((id) => id.startsWith("page")), phase: s.phase }));
  const shown = useMemo(
    () => (["dawn", "explore", "dusk"].includes(view.phase) ? world.pages.filter((p) => p.day === view.day && !view.found.includes(p.id)) : []),
    [world, view],
  );
  return (
    <>
      {shown.map((p) => (
        <Page key={p.id} page={p} />
      ))}
    </>
  );
}
