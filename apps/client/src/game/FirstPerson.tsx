import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { myId, type IslandRoom } from "../net.ts";
import { useCameraView } from "./camera.ts";
import { ItemModel, LONG_ITEMS } from "./ItemModel.tsx";
import { localMotion } from "./shared.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

/**
 * Góc nhìn thứ nhất: thân mình bị ẩn nên vẽ riêng bàn tay phải và món đang cầm ở góc dưới màn hình,
 * lắc nhẹ khi đi và vung lên mỗi lần đánh, ném, ăn (theo bộ đếm động tác server gửi về).
 */
export function FirstPersonHands({ room }: { room: IslandRoom }) {
  const view = useCameraView();
  const me = myId(room);
  const held = useRoomSnapshot(room, (s) => s.players.get(me)?.held ?? "");
  const actN = useRoomSnapshot(room, (s) => s.players.get(me)?.actN ?? 0);
  const alive = useRoomSnapshot(room, (s) => s.players.get(me)?.alive ?? false);
  const root = useRef<Group>(null);
  const hand = useRef<Group>(null);
  const swing = useRef(0);
  const lastAct = useRef(actN);
  useEffect(() => {
    if (actN !== lastAct.current) {
      lastAct.current = actN;
      swing.current = 1;
    }
  }, [actN]);
  useFrame(({ camera, clock }, dt) => {
    const g = root.current;
    const h = hand.current;
    if (!g || !h) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    swing.current = Math.max(0, swing.current - dt * 3.2);
    const k = Math.sin(swing.current * Math.PI);
    const t = clock.elapsedTime * (localMotion.running ? 13 : 9);
    const bob = localMotion.moving ? 1 : 0;
    h.position.set(0.2 + Math.cos(t * 0.5) * 0.012 * bob, -0.2 + Math.abs(Math.sin(t)) * 0.02 * bob + k * 0.08, -0.55 - k * 0.12);
    h.rotation.set(-k * 1.1, 0.15, 0);
  });
  if (view !== "first" || !alive) return null;
  const long = LONG_ITEMS.has(held);
  return (
    <group ref={root}>
      <group ref={hand}>
        <mesh>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshStandardMaterial color="#d9a77c" roughness={0.8} userData={{ detail: "skin", detailSpace: "object" }} />
        </mesh>
        {held && (
          <group position={[0, 0.02, -0.02]} rotation={long ? [-Math.PI / 2 + 0.5, 0, 0] : [Math.PI, 0, 0]}>
            <ItemModel itemId={held} scale={long ? 0.9 : 0.8} />
          </group>
        )}
      </group>
    </group>
  );
}
