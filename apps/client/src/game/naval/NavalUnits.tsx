import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Group, MeshBasicMaterial, MeshStandardMaterial } from "three";
import type { NavalUnitState } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { localPosition } from "../shared.ts";
import { puffs } from "../battle/gpuParticles.ts";
import { myUnit } from "./navalRuntime.ts";

// Vẽ ngư lôi (thân chìm dưới nước, vệt bọt trên mặt nước để thấy mà né), tên lửa (khói đuôi, lửa động cơ), máy bay
// tiêm kích bom (màu phe), mồi nhử (đốm sáng rơi chậm). Đơn vị mình đang lái vẽ theo vị trí dự đoán trên máy mình;
// đơn vị khác đi tiếp theo vận tốc rồi kéo dần về vị trí server.

const TEAM = { blue: "#3f74ff", red: "#e0392f" } as Record<string, string>;

export function NavalUnits({ room }: { room: IslandRoom }) {
  const list = useRoomSnapshot(room, (s) => [...(s.naval?.units.entries() ?? [])].map(([id, u]) => `${id}:${u.kind}:${u.team}`).join(","));
  return (
    <>
      {list
        .split(",")
        .filter(Boolean)
        .map((k) => {
          const [id, kind, team] = k.split(":") as [string, string, string];
          return <Unit key={id} room={room} id={id} kind={kind} team={team} />;
        })}
    </>
  );
}

function Unit({ room, id, kind, team }: { room: IslandRoom; id: string; kind: string; team: string }) {
  const g = useRef<Group>(null);
  const st = useRef({ x: NaN, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, sx: NaN, sz: NaN, sy: NaN, age: 0, trail: 0 });
  const color = TEAM[team] ?? "#cccccc";
  const mats = useMemo(
    () => ({
      body: new MeshStandardMaterial({ color: kind === "plane" ? "#7d858c" : kind === "missile" ? "#e8e6df" : "#2c3136", roughness: 0.5, metalness: 0.4 }),
      team: new MeshStandardMaterial({ color, roughness: 0.6 }),
      glow: new MeshBasicMaterial({
        color: kind === "decoy" ? "#fff2c0" : "#ffb25a",
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [kind, color],
  );
  useMemo(() => {
    mats.body.userData.detail = "metal";
    mats.body.userData.detailSpace = "object";
    mats.team.userData.detail = "none";
  }, [mats]);
  useMemo(() => mats.glow.color.multiplyScalar(kind === "decoy" ? 5 : 2.4), [mats, kind]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const u: NavalUnitState | undefined = room.state.naval?.units.get(id);
    const o = g.current;
    if (!u || !o) return;
    const s = st.current;
    const own = myUnit.id === id;
    if (own) {
      s.x = myUnit.x;
      s.y = myUnit.y;
      s.z = myUnit.z;
      s.yaw = myUnit.yaw;
      s.pitch = myUnit.pitch;
      s.roll = myUnit.roll;
    } else {
      if (Number.isNaN(s.x)) {
        s.x = u.x;
        s.y = u.y;
        s.z = u.z;
        s.yaw = u.yaw;
        s.pitch = u.pitch;
      }
      // Gói mới: tính lại tuổi từ lúc server báo.
      if (u.x !== s.sx || u.z !== s.sz || u.y !== s.sy) {
        s.sx = u.x;
        s.sz = u.z;
        s.sy = u.y;
        s.age = 0;
      } else s.age = Math.min(0.3, s.age + dt);
      const cp = Math.cos(u.pitch);
      const tx = u.x + Math.sin(u.yaw) * cp * u.speed * s.age;
      const ty = u.y + Math.sin(u.pitch) * u.speed * s.age;
      const tz = u.z + Math.cos(u.yaw) * cp * u.speed * s.age;
      const sp = Math.cos(s.pitch);
      s.x += Math.sin(s.yaw) * sp * u.speed * dt;
      s.y += Math.sin(s.pitch) * u.speed * dt;
      s.z += Math.cos(s.yaw) * sp * u.speed * dt;
      const k = Math.min(1, dt * 8);
      if (Math.hypot(tx - s.x, tz - s.z) > 40) {
        s.x = tx;
        s.y = ty;
        s.z = tz;
      } else {
        s.x += (tx - s.x) * k;
        s.y += (ty - s.y) * k;
        s.z += (tz - s.z) * k;
      }
      s.yaw += Math.atan2(Math.sin(u.yaw - s.yaw), Math.cos(u.yaw - s.yaw)) * k;
      s.pitch += (u.pitch - s.pitch) * k;
      s.roll += (u.roll - s.roll) * k;
    }
    o.position.set(s.x, s.y, s.z);
    o.rotation.set(0, 0, 0);
    o.rotateY(s.yaw);
    o.rotateX(-s.pitch);
    o.rotateZ(s.roll);
    // Vệt: bọt trên mặt nước sau ngư lôi, khói sau tên lửa, khói mỏng sau máy bay.
    s.trail += dt;
    const far = Math.hypot(s.x - localPosition.x, s.z - localPosition.z) > 900;
    if (far) return;
    if ((kind === "torpedo" || kind === "gtorpedo") && s.trail > 0.08) {
      s.trail = 0;
      puffs.push({
        x: s.x - Math.sin(s.yaw) * 3,
        y: 0.12,
        z: s.z - Math.cos(s.yaw) * 3,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 0.9,
        grow: 0.9,
        life: 6,
        age: 0,
        r: 0.95,
        g: 0.98,
        b: 1,
        alpha: 0.55,
        dense: false,
      });
    } else if (kind === "missile" && s.trail > 0.03) {
      s.trail = 0;
      puffs.push({
        x: s.x - Math.sin(s.yaw) * 2.6,
        y: s.y - Math.sin(s.pitch) * 2.6,
        z: s.z - Math.cos(s.yaw) * 2.6,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.3,
        vz: (Math.random() - 0.5) * 0.4,
        size: 0.7,
        grow: 1.1,
        life: 3.2,
        age: 0,
        r: 0.86,
        g: 0.86,
        b: 0.85,
        alpha: 0.5,
        dense: false,
      });
    } else if (kind === "plane" && s.trail > 0.12 && u.hp < 130) {
      // Máy bay trúng đạn: kéo khói đen.
      s.trail = 0;
      puffs.push({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0.4, vz: 0, size: 1.4, grow: 1.6, life: 4, age: 0, r: 0.1, g: 0.1, b: 0.1, alpha: 0.6, dense: false });
    }
  });

  return (
    <group ref={g}>
      {kind === "torpedo" || kind === "gtorpedo" ? (
        <mesh material={mats.body} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.28, 0.28, 6, 8]} />
        </mesh>
      ) : kind === "missile" ? (
        <>
          <mesh material={mats.body} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.32, 0.32, 5, 10]} />
          </mesh>
          <mesh material={mats.team} position={[0, 0, 2.9]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.32, 0.9, 10]} />
          </mesh>
          <mesh material={mats.body} position={[0, 0, -2]}>
            <boxGeometry args={[1.5, 0.06, 0.6]} />
          </mesh>
          <mesh material={mats.body} position={[0, 0, -2]}>
            <boxGeometry args={[0.06, 1.5, 0.6]} />
          </mesh>
          <mesh material={mats.glow} position={[0, 0, -2.75]} scale={[0.17, 0.17, 0.45]}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
        </>
      ) : kind === "plane" ? (
        <>
          <mesh material={mats.body} castShadow>
            <boxGeometry args={[1.3, 1.3, 11]} />
          </mesh>
          <mesh material={mats.body} position={[0, 0, 6]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.65, 2, 8]} />
          </mesh>
          <mesh material={mats.glow} position={[0, 0.5, 3]} scale={[0.5, 0.35, 1.1]}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
          <mesh material={mats.team} position={[0, -0.1, 0.3]} castShadow>
            <boxGeometry args={[11, 0.18, 3]} />
          </mesh>
          <mesh material={mats.team} position={[0, 0.2, -4.6]}>
            <boxGeometry args={[4.4, 0.14, 1.6]} />
          </mesh>
          <mesh material={mats.body} position={[0, 1.4, -4.6]}>
            <boxGeometry args={[0.14, 2.2, 1.8]} />
          </mesh>
          {/* Bom treo dưới cánh. */}
          <mesh material={mats.body} position={[2.2, -0.6, 0.6]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.25, 0.25, 2, 8]} />
          </mesh>
          <mesh material={mats.body} position={[-2.2, -0.6, 0.6]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.25, 0.25, 2, 8]} />
          </mesh>
          <mesh material={mats.glow} position={[0, 0, -5.7]} scale={[0.32, 0.32, 0.6]}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
        </>
      ) : (
        <mesh material={mats.glow} scale={2.4}>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
      )}
    </group>
  );
}
