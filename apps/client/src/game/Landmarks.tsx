import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { DoubleSide, Object3D, type InstancedMesh } from "three";
import { ANCHORS, type Anchor, type World } from "@tentides/content";
import { mulberry32 } from "./nature.ts";

// Cảnh cố định ở các điểm sự kiện mới, để điểm nào nhìn cũng ra điểm đó dù hôm nay không có thẻ:
// xác tàu nằm nghiêng trên cát, phế tích đá phủ rêu giữa rừng, mỏm đá đầy tổ chim, suối nước nóng bốc hơi.

/** Hướng từ tâm đảo ra biển tại một điểm (để xác tàu, mỏm đá quay ra biển). */
function seaward(a: Anchor): number {
  return Math.atan2(a.x, a.z);
}

function Shipwreck({ a, world }: { a: Anchor; world: World }) {
  const dir = seaward(a);
  const x = a.x + Math.sin(dir) * 4;
  const z = a.z + Math.cos(dir) * 4;
  const y = world.heightAt(x, z);
  return (
    <group position={[x, y - 0.4, z]} rotation={[0, dir + Math.PI / 2, 0.32]}>
      {/* Thân tàu: hai mạn ván cong và đáy tàu, một bên vỡ toác. */}
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[9, 0.35, 2.6]} />
        <meshStandardMaterial color="#5b4630" flatShading roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side === 1 ? 0.3 : -0.4, 1.8, side * 1.3]} rotation-x={side * 0.25} castShadow receiveShadow>
          <boxGeometry args={[side === 1 ? 8.4 : 6.2, 1.8, 0.2]} />
          <meshStandardMaterial color="#6e5639" flatShading roughness={1} />
        </mesh>
      ))}
      {/* Mũi tàu nhọn. */}
      <mesh position={[5, 1.6, 0]} rotation-z={-0.5} castShadow>
        <coneGeometry args={[1.4, 2.6, 4]} />
        <meshStandardMaterial color="#5b4630" flatShading roughness={1} />
      </mesh>
      {/* Cột buồm gãy, mẩu buồm rách. */}
      <mesh position={[-0.5, 3.8, 0]} rotation-z={0.25} castShadow>
        <cylinderGeometry args={[0.13, 0.17, 5.5, 6]} />
        <meshStandardMaterial color="#4a3a28" flatShading />
      </mesh>
      <mesh position={[-1.3, 4.5, 0.05]} rotation-z={0.25}>
        <planeGeometry args={[1.6, 2.2, 3, 3]} />
        <meshStandardMaterial color="#d9ccae" side={DoubleSide} flatShading roughness={1} />
      </mesh>
      {/* Mấy cái xương sườn tàu lộ ra ở chỗ vỡ. */}
      {[-3.2, -2.4, -1.6].map((rx) => (
        <mesh key={rx} position={[rx, 1.9, -1.3]} rotation-x={0.4}>
          <torusGeometry args={[1.2, 0.08, 4, 8, Math.PI]} />
          <meshStandardMaterial color="#4a3a28" flatShading />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[4.5, 1.4, 1.4]} position={[0, 1.5, 0]} />
      </RigidBody>
    </group>
  );
}

function Ruin({ a, world }: { a: Anchor; world: World }) {
  const pillars = useMemo(() => {
    const rand = mulberry32(a.id.length * 97 + Math.round(a.x));
    return Array.from({ length: 7 }, (_, i) => {
      const angle = (i / 7) * Math.PI * 2 + rand() * 0.3;
      const r = 5 + rand() * 1.5;
      const x = a.x + Math.cos(angle) * r;
      const z = a.z + Math.sin(angle) * r;
      // Cột đổ, cột gãy, cột còn nguyên.
      const h = rand() < 0.3 ? 0.8 + rand() : 2.4 + rand() * 1.6;
      return { x, z, y: world.heightAt(x, z), h, tilt: (rand() - 0.5) * 0.25, fallen: rand() < 0.2 };
    });
  }, [a, world]);
  const gateY = world.heightAt(a.x, a.z - 3);
  return (
    <group>
      {pillars.map((p, i) =>
        p.fallen ? (
          <mesh key={i} position={[p.x, p.y + 0.35, p.z]} rotation={[Math.PI / 2, i, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.38, 0.42, 3, 7]} />
            <meshStandardMaterial color="#7f8577" flatShading roughness={1} />
          </mesh>
        ) : (
          <mesh key={i} position={[p.x, p.y + p.h / 2 - 0.1, p.z]} rotation-z={p.tilt} castShadow receiveShadow>
            <cylinderGeometry args={[0.38, 0.46, p.h, 7]} />
            <meshStandardMaterial color="#8a8f80" flatShading roughness={1} />
          </mesh>
        ),
      )}
      {/* Cổng đá: hai trụ và một thanh đá ngang phủ rêu, hai bên là tượng rắn cuộn. */}
      <group position={[a.x, gateY, a.z - 3]}>
        {[-1.6, 1.6].map((gx) => (
          <mesh key={gx} position={[gx, 1.6, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.8, 3.2, 0.8]} />
            <meshStandardMaterial color="#7d8474" flatShading roughness={1} />
          </mesh>
        ))}
        <mesh position={[0, 3.45, 0]} castShadow>
          <boxGeometry args={[4.6, 0.6, 1]} />
          <meshStandardMaterial color="#6f7a62" flatShading roughness={1} />
        </mesh>
        <mesh position={[0, 3.8, 0]}>
          <boxGeometry args={[4.2, 0.12, 0.9]} />
          <meshStandardMaterial color="#4f7a3a" flatShading roughness={1} />
        </mesh>
        {[-2.6, 2.6].map((sx) => (
          <mesh key={sx} position={[sx, 0.55, 0.3]} rotation-x={Math.PI / 2} castShadow>
            <torusKnotGeometry args={[0.35, 0.12, 32, 5, 2, 3]} />
            <meshStandardMaterial color="#6d7560" flatShading roughness={1} />
          </mesh>
        ))}
      </group>
      <RigidBody type="fixed" colliders={false}>
        {pillars
          .filter((p) => !p.fallen)
          .map((p, i) => (
            <CylinderCollider key={i} args={[p.h / 2, 0.42]} position={[p.x, p.y + p.h / 2, p.z]} />
          ))}
        <CuboidCollider args={[0.4, 1.6, 0.4]} position={[a.x - 1.6, gateY + 1.6, a.z - 3]} />
        <CuboidCollider args={[0.4, 1.6, 0.4]} position={[a.x + 1.6, gateY + 1.6, a.z - 3]} />
      </RigidBody>
    </group>
  );
}

function CliffNest({ a, world }: { a: Anchor; world: World }) {
  const rocks = useMemo(() => {
    const dir = seaward(a);
    const rand = mulberry32(31);
    return Array.from({ length: 6 }, (_, i) => {
      const along = (i - 2.5) * 1.9;
      const x = a.x + Math.sin(dir) * (3.5 + rand() * 1.5) + Math.cos(dir) * along;
      const z = a.z + Math.cos(dir) * (3.5 + rand() * 1.5) - Math.sin(dir) * along;
      return { x, z, y: world.heightAt(x, z), s: 1.3 + rand() * 1.6, h: 1.6 + rand() * 2.6 };
    });
  }, [a, world]);
  return (
    <group>
      {rocks.map((r, i) => (
        <group key={i} position={[r.x, r.y, r.z]}>
          <mesh position-y={r.h / 2} scale={[r.s, r.h, r.s]} castShadow receiveShadow>
            <dodecahedronGeometry args={[0.7, 0]} />
            <meshStandardMaterial color="#6f6b64" flatShading roughness={1} />
          </mesh>
          {/* Tổ chim trên đỉnh đá, trứng lốm đốm. */}
          {i % 2 === 0 && (
            <group position-y={r.h * 0.95}>
              <mesh>
                <torusGeometry args={[0.32, 0.12, 5, 9]} />
                <meshStandardMaterial color="#8a6a3e" flatShading />
              </mesh>
              {[0, 1, 2].map((e) => (
                <mesh key={e} position={[Math.cos(e * 2.1) * 0.12, 0.05, Math.sin(e * 2.1) * 0.12]} scale={[0.07, 0.09, 0.07]}>
                  <sphereGeometry args={[1, 6, 5]} />
                  <meshStandardMaterial color="#e9e3d2" />
                </mesh>
              ))}
            </group>
          )}
          {/* Vệt phân chim trắng loang trên đá. */}
          <mesh position={[0, r.h * 0.7, r.s * 0.45]} scale={[r.s * 0.6, r.h * 0.4, 0.05]}>
            <boxGeometry />
            <meshStandardMaterial color="#e8e4dc" flatShading />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {rocks.map((r, i) => (
          <CylinderCollider key={i} args={[r.h / 2, r.s * 0.55]} position={[r.x, r.y + r.h / 2, r.z]} />
        ))}
      </RigidBody>
    </group>
  );
}

const STEAM = 24;

function HotSpring({ a, world }: { a: Anchor; world: World }) {
  const x = a.x + 3;
  const z = a.z + 1;
  const y = world.heightAt(x, z);
  const steam = useRef<InstancedMesh>(null);
  const puffs = useMemo(() => {
    const rand = mulberry32(17);
    return Array.from({ length: STEAM }, () => ({ ox: (rand() - 0.5) * 3, oz: (rand() - 0.5) * 3, phase: rand(), speed: 0.25 + rand() * 0.2 }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const m = steam.current;
    if (!m) return;
    puffs.forEach((p, i) => {
      const k = (clock.elapsedTime * p.speed + p.phase) % 1;
      dummy.position.set(x + p.ox + Math.sin(k * 6) * 0.2, y + 0.2 + k * 3.2, z + p.oz);
      dummy.scale.setScalar(0.35 + k * 0.9);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {/* Vũng nước xanh ngọc viền đá đen. */}
      <mesh position={[x, y + 0.12, z]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[2.2, 14]} />
        <meshStandardMaterial color="#5fd0c6" emissive="#1f7a74" emissiveIntensity={0.35} roughness={0.15} flatShading />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        return (
          <mesh key={i} position={[x + Math.cos(angle) * 2.5, y + 0.15, z + Math.sin(angle) * 2.5]} rotation={[i, i * 2, 0]} castShadow>
            <dodecahedronGeometry args={[0.45 + (i % 3) * 0.15, 0]} />
            <meshStandardMaterial color="#2f2b2a" flatShading roughness={1} />
          </mesh>
        );
      })}
      <instancedMesh ref={steam} args={[undefined, undefined, STEAM]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.22} depthWrite={false} flatShading />
      </instancedMesh>
    </group>
  );
}

export function Landmarks({ world }: { world: World }) {
  return (
    <>
      {ANCHORS.map((a) => {
        switch (a.type) {
          case "shipwreck":
            return <Shipwreck key={a.id} a={a} world={world} />;
          case "jungle_ruin":
            return <Ruin key={a.id} a={a} world={world} />;
          case "cliff_nest":
            return <CliffNest key={a.id} a={a} world={world} />;
          case "hot_spring":
            return <HotSpring key={a.id} a={a} world={world} />;
          default:
            return null;
        }
      })}
    </>
  );
}
