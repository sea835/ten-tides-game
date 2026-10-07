import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BoxGeometry, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3, type Group, type Mesh } from "three";
import { UAV } from "@tentides/content";
import { Messages, type TowSteerMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { puffs } from "./Effects.tsx";
import { stance } from "./runtime.ts";
import { towFlying } from "./streaks.ts";

// Phần trong cảnh 3D của chi viện chiến thuật: máy bay không người lái (UAV) lượn vòng trên cao, khói đỏ đánh dấu chỗ
// mưa pháo sắp dội xuống, tên lửa TOW đang bay (kèm vệt khói), và gửi lệnh lái tên lửa của mình khi còn giữ chuột.

const bodyGeo = new CylinderGeometry(0.35, 0.22, 5, 8).rotateX(Math.PI / 2);
const wingGeo = new BoxGeometry(9, 0.1, 0.9);
const tailGeo = new BoxGeometry(2.6, 0.08, 0.5);
const finGeo = new BoxGeometry(0.08, 1, 0.5);
const lightGeo = new SphereGeometry(0.16, 6, 4);
const greyMat = new MeshStandardMaterial({ color: "#4d555c", roughness: 0.6, metalness: 0.3 });
const blinkMat = new MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false });
const flareGeo = new CylinderGeometry(0.06, 0.06, 0.35, 6);
const flareMat = new MeshBasicMaterial({ color: "#ff3b22", toneMapped: false });
const missileGeo = new CylinderGeometry(0.075, 0.075, 1.1, 8).rotateX(Math.PI / 2);
const missileMat = new MeshStandardMaterial({ color: "#5d6650", roughness: 0.6, metalness: 0.4 });
const flameGeo = new SphereGeometry(0.14, 8, 6);
const flameMat = new MeshBasicMaterial({ color: "#ffb347", toneMapped: false });

/** Nhịp gửi lệnh lái tên lửa (ms). */
const STEER_MS = 60;
const dir = new Vector3();
const ahead = new Vector3();

export function StreakWorld({ room }: { room: IslandRoom }) {
  const sig = useRoomSnapshot(room, (s) => {
    const keys: string[] = [];
    for (const [k, t] of s.traps) if (t.defId === "uav" || t.defId === "artillery") keys.push(`${t.defId}:${k}`);
    for (const [k, p] of s.projectiles) if (p.itemId === "tow") keys.push(`tow:${k}`);
    return keys.join(",");
  });
  const camera = useThree((s) => s.camera);
  const lastSteer = useRef(0);

  // Lệnh lái TOW: tên lửa của mình còn bay, đang cầm TOW và giữ chuột trái thì gửi mắt + hướng ngắm đều đặn.
  useFrame(() => {
    const now = performance.now();
    if (!towFlying(now) || !stance.holdFire || now - lastSteer.current < STEER_MS) return;
    const me = room.state.players.get(myId(room));
    const k = me?.kit;
    const slot = k?.active;
    const held = k && (slot === "primary1" || slot === "primary2" || slot === "pistol") ? k[slot] : "";
    if (!me?.alive || held !== "tow") return;
    lastSteer.current = now;
    camera.getWorldDirection(dir);
    const p = camera.position;
    room.send(Messages.towSteer, { o: [p.x, p.y, p.z], d: [dir.x, dir.y, dir.z] } satisfies TowSteerMessage);
  });

  if (!sig) return null;
  return (
    <>
      {sig.split(",").map((entry) => {
        const [kind, key = ""] = entry.split(":");
        if (kind === "uav") return <Drone key={entry} room={room} id={key} />;
        if (kind === "artillery") return <SmokeMarker key={entry} room={room} id={key} />;
        return <Missile key={entry} room={room} id={key} />;
      })}
    </>
  );
}

/** UAV: máy bay không người lái lượn vòng quanh tâm bản đồ trên cao, đèn đỏ nháy. */
function Drone({ room, id }: { room: IslandRoom; id: string }) {
  const g = useRef<Group>(null);
  const blink = useRef<Mesh>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame(({ clock }) => {
    const t = room.state.traps.get(id);
    const grp = g.current;
    if (!t || !grp) return;
    const a = clock.elapsedTime * 0.12 + phase.current;
    grp.position.set(t.x + Math.cos(a) * UAV.orbit, UAV.height, t.z + Math.sin(a) * UAV.orbit);
    // Mũi máy bay theo hướng tiếp tuyến vòng lượn, nghiêng cánh vào trong.
    grp.rotation.set(0, -a, 0);
    grp.rotateZ(0.18);
    if (blink.current) blink.current.visible = clock.elapsedTime % 1 < 0.15;
  });
  return (
    <group ref={g}>
      <mesh geometry={bodyGeo} material={greyMat} />
      <mesh geometry={wingGeo} material={greyMat} position={[0, 0.15, 0.2]} />
      <mesh geometry={tailGeo} material={greyMat} position={[0, 0.1, -2.3]} />
      <mesh geometry={finGeo} material={greyMat} position={[0, 0.5, -2.3]} />
      <mesh ref={blink} geometry={lightGeo} material={blinkMat} position={[0, -0.4, 0]} />
    </group>
  );
}

/** Mưa pháo: pháo sáng đỏ cắm ở chỗ chấm, cột khói đỏ bốc cao cho mọi người thấy mà chạy. */
function SmokeMarker({ room, id }: { room: IslandRoom; id: string }) {
  const g = useRef<Group>(null);
  const acc = useRef(0);
  useFrame((_, rawDt) => {
    const t = room.state.traps.get(id);
    const grp = g.current;
    if (!t || !grp) return;
    grp.position.set(t.x, t.y, t.z);
    acc.current += Math.min(rawDt, 0.05);
    const rate = 7;
    while (acc.current > 1 / rate) {
      acc.current -= 1 / rate;
      const shade = 0.85 + Math.random() * 0.15;
      puffs.push({
        x: t.x + (Math.random() - 0.5) * 0.5,
        y: t.y + 0.3,
        z: t.z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 3 + Math.random() * 1.5,
        vz: (Math.random() - 0.5) * 0.8,
        size: 1.1,
        grow: 1.3,
        life: 6 + Math.random() * 2,
        age: 0,
        r: shade,
        g: 0.12 * shade,
        b: 0.1 * shade,
        alpha: 0.8,
        dense: false,
      });
    }
  });
  return (
    <group ref={g}>
      <mesh geometry={flareGeo} material={flareMat} position-y={0.18} />
    </group>
  );
}

/** Tên lửa TOW: thân ô liu, lửa đuôi, vệt khói xám; hướng mũi theo đường bay. */
function Missile({ room, id }: { room: IslandRoom; id: string }) {
  const g = useRef<Group>(null);
  const started = useRef(false);
  const acc = useRef(0);
  useFrame((_, rawDt) => {
    const p = room.state.projectiles.get(id);
    const grp = g.current;
    if (!p || !grp) return;
    const dt = Math.min(rawDt, 0.05);
    if (!started.current) {
      grp.position.set(p.x, p.y, p.z);
      started.current = true;
      return;
    }
    ahead.set(p.x, p.y, p.z);
    if (ahead.distanceToSquared(grp.position) > 1e-4) grp.lookAt(ahead);
    grp.position.lerp(ahead, Math.min(1, dt * 16));
    acc.current += dt;
    while (acc.current > 1 / 24) {
      acc.current -= 1 / 24;
      const grey = 0.7 + Math.random() * 0.15;
      puffs.push({ x: grp.position.x, y: grp.position.y, z: grp.position.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.2 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.3, size: 0.35, grow: 0.8, life: 1.8 + Math.random(), age: 0, r: grey, g: grey, b: grey, alpha: 0.5, dense: false });
    }
  });
  return (
    <group ref={g}>
      <mesh geometry={missileGeo} material={missileMat} />
      <mesh geometry={flameGeo} material={flameMat} position={[0, 0, -0.6]} />
    </group>
  );
}
