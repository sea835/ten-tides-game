import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, type Group, type InstancedMesh, Object3D } from "three";
import { worldCatalog, type Poi, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { localPosition } from "./shared.ts";
import { mulberry32, rockGeometry } from "./nature.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Easter egg và điểm bất thường rải theo seed, cộng bẫy đã sập (server mới công khai chỗ bẫy khi có người giẫm).
// Chưa ai tìm thấy thì có đốm sáng lấp lánh mờ khi lại gần; tìm rồi thì đồ vật vẫn còn nhưng hết lấp lánh,
// điểm bất thường thì tắt hiệu ứng.

type V3 = [number, number, number];

function Mat({ c, e = 0, t, o = 1 }: { c: string; e?: number; t?: boolean; o?: number }) {
  return (
    <meshStandardMaterial
      color={c}
      emissive={e ? c : "#000000"}
      emissiveIntensity={e}
      toneMapped={e === 0}
      flatShading
      transparent={t}
      opacity={o}
      roughness={0.85}
    />
  );
}

function Box({ s, p = [0, 0, 0], r = [0, 0, 0], c, e }: { s: V3; p?: V3; r?: V3; c: string; e?: number }) {
  return (
    <mesh position={p} rotation={r} castShadow>
      <boxGeometry args={s} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

function Ball({ r, p = [0, 0, 0], s = [1, 1, 1], c, e, detail = 0 }: { r: number; p?: V3; s?: V3; c: string; e?: number; detail?: number }) {
  return (
    <mesh position={p} scale={s} castShadow>
      <icosahedronGeometry args={[r, detail]} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

function Cyl({ r, h, p = [0, 0, 0], rot = [0, 0, 0], c, e, top }: { r: number; h: number; p?: V3; rot?: V3; c: string; e?: number; top?: number }) {
  return (
    <mesh position={p} rotation={rot} castShadow>
      <cylinderGeometry args={[top ?? r, r, h, 7]} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

function Cone({ r, h, p = [0, 0, 0], rot = [0, 0, 0], c, e }: { r: number; h: number; p?: V3; rot?: V3; c: string; e?: number }) {
  return (
    <mesh position={p} rotation={rot} castShadow>
      <coneGeometry args={[r, h, 6]} />
      <Mat c={c} e={e} />
    </mesh>
  );
}

/** Mảng hạt nhỏ bay lên (mưa ngược, bọt nước, hơi nước), lặp vô hạn. */
function Rising({ count, radius, height, size, color, speed = 1, seed = 1 }: { count: number; radius: number; height: number; size: number; color: string; speed?: number; seed?: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const seeds = useMemo(() => {
    const rand = mulberry32(seed);
    return Array.from({ length: count }, () => ({ a: rand() * Math.PI * 2, r: Math.sqrt(rand()) * radius, o: rand() }));
  }, [count, radius, seed]);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime * speed;
    seeds.forEach((s, i) => {
      const life = (t * 0.35 + s.o) % 1;
      dummy.position.set(Math.cos(s.a) * s.r, life * height, Math.sin(s.a) * s.r);
      dummy.scale.setScalar(size * (1 - life * 0.5));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.65} depthWrite={false} />
    </instancedMesh>
  );
}

/** Nhóm con quay/nhấp nhô theo thời gian. */
function Spin({ children, speed = 1, bob = 0, p = [0, 0, 0] }: { children: ReactNode; speed?: number; bob?: number; p?: V3 }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    g.current.rotation.y = clock.elapsedTime * speed;
    g.current.position.y = p[1] + Math.sin(clock.elapsedTime * 1.3) * bob;
  });
  return (
    <group ref={g} position={p}>
      {children}
    </group>
  );
}

function Pulse({ children, speed = 2, amount = 0.15 }: { children: ReactNode; speed?: number; amount?: number }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * speed) * amount);
  });
  return <group ref={g}>{children}</group>;
}

/** Hình dáng từng loại điểm. `live`: điểm bất thường chưa ai chạm thì còn hiệu ứng. */
function PoiModel({ model, live, seed }: { model: string; live: boolean; seed: number }) {
  // Số ngẫu nhiên cố định theo điểm (tính một lần, để vẽ lại không xê dịch).
  const rnd = useMemo(() => Array.from({ length: 64 }, mulberry32(seed)), [seed]);
  switch (model) {
    case "golden_coconut":
      return <Ball r={0.24} p={[0, 0.22, 0]} c="#e7b416" e={live ? 0.6 : 0.1} detail={1} />;
    case "shipwreck":
      return (
        <group rotation={[0.12, 0, 0.35]}>
          <Box s={[3.2, 1.8, 10]} p={[0, 0.8, 0]} c="#4a3322" />
          <Box s={[2.6, 0.2, 8]} p={[0, 1.75, 0]} c="#6b4a2b" />
          <Cyl r={0.18} h={6} p={[0, 4.5, 1.2]} rot={[0.3, 0, 0.2]} c="#3b2a1a" />
          <Cyl r={0.15} h={3.5} p={[0.4, 3, -2.5]} rot={[-0.6, 0, 0]} c="#3b2a1a" />
          <Box s={[1, 0.8, 0.8]} p={[0.5, 2.2, -3]} c="#7a5a2a" />
        </group>
      );
    case "carved_wall":
      return (
        <group>
          <Box s={[2.4, 2.2, 0.35]} p={[0, 1.1, 0]} c="#8a837a" />
          {Array.from({ length: 12 }, (_, i) => (
            <Box key={i} s={[0.25 + ((i * 7) % 5) * 0.08, 0.06, 0.05]} p={[-0.8 + (i % 3) * 0.75, 0.5 + Math.floor(i / 3) * 0.38, 0.19]} c="#f5e6b8" e={live ? 0.7 : 0.15} />
          ))}
        </group>
      );
    case "footprints":
      return (
        <group>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[(i % 2 ? 0.9 : -0.9), 0.04, i * 2.6 - 7]} rotation={[0, (i % 2 ? 0.15 : -0.15), 0]} scale={[1, 1, 1.9]}>
              <cylinderGeometry args={[0.55, 0.55, 0.08, 9]} />
              <Mat c="#3a332d" />
            </mesh>
          ))}
        </group>
      );
    case "bottle":
      return (
        <group rotation={[0, 0, Math.PI / 2.3]} position={[0, 0.12, 0]}>
          <mesh>
            <cylinderGeometry args={[0.1, 0.1, 0.36, 8]} />
            <meshStandardMaterial color="#6fbf8f" transparent opacity={0.6} roughness={0.1} />
          </mesh>
          <Cyl r={0.04} h={0.14} p={[0, 0.25, 0]} c="#6fbf8f" />
          <Cyl r={0.035} h={0.06} p={[0, 0.34, 0]} c="#8b6b43" />
          <Cyl r={0.05} h={0.22} p={[0, 0, 0]} c="#f2e6c9" e={live ? 0.5 : 0} />
        </group>
      );
    case "grave":
      return (
        <group>
          {Array.from({ length: 7 }, (_, i) => (
            <Ball key={i} r={0.35} p={[Math.cos(i) * 0.6, 0.15, Math.sin(i) * 0.9]} s={[1, 0.6, 1]} c="#8a857d" />
          ))}
          <Box s={[0.12, 2, 0.12]} p={[0, 1, -0.6]} r={[0.1, 0, 0.08]} c="#6b4a2b" />
          <Box s={[0.35, 0.7, 0.05]} p={[0, 1.8, -0.55]} c="#6b4a2b" />
        </group>
      );
    case "stone_head":
      return (
        <group>
          <Box s={[1.4, 2.4, 1.1]} p={[0, 1.2, 0]} c="#7d766c" />
          <Box s={[1.5, 0.35, 1.2]} p={[0, 2.1, 0.05]} c="#6d665d" />
          <Box s={[0.3, 0.9, 0.35]} p={[0, 1.5, 0.65]} c="#7d766c" />
          <Box s={[0.9, 0.15, 0.1]} p={[0, 0.8, 0.56]} c="#4f4943" />
          <Box s={[1.2, 0.5, 1.1]} p={[0, 2.6, -0.1]} c="#9b5a3a" />
        </group>
      );
    case "chest":
      return (
        <group>
          <Box s={[1, 0.6, 0.65]} p={[0, 0.3, 0]} c="#6b4a2b" />
          <Box s={[1.04, 0.1, 0.69]} p={[0, 0.6, 0]} c="#c9a227" e={live ? 0.4 : 0} />
          <Box s={[0.12, 0.2, 0.05]} p={[0, 0.45, 0.34]} c="#c9a227" />
        </group>
      );
    case "clam":
      return (
        <group>
          <Ball r={0.8} p={[0, 0.2, 0]} s={[1, 0.35, 0.8]} c="#b8a6c9" />
          <Ball r={0.8} p={[0, 0.55, -0.25]} s={[1, 0.3, 0.8]} c="#a391b7" />
          <Ball r={0.16} p={[0, 0.42, 0.1]} c="#2b2440" e={live ? 1.2 : 0.2} detail={1} />
        </group>
      );
    case "chess":
      return (
        <group>
          <Box s={[1.6, 0.35, 1.6]} p={[0, 0.18, 0]} c="#9a9388" />
          {Array.from({ length: 9 }, (_, i) => (
            <Cyl key={i} r={0.08} h={0.12} p={[-0.6 + (i % 3) * 0.55 + rnd[i]! * 0.1, 0.42, -0.6 + Math.floor(i / 3) * 0.55]} c={i % 2 ? "#b33a2a" : "#222"} />
          ))}
        </group>
      );
    case "whale_bones":
      return (
        <group>
          <Box s={[1.6, 1, 2.2]} p={[0, 0.5, -5]} c="#ece3cf" />
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[0, 0, -3 + i * 1.2]} rotation={[0, 0, 0]}>
              <torusGeometry args={[1.6 - Math.abs(i - 3) * 0.15, 0.1, 5, 10, Math.PI]} />
              <Mat c="#ece3cf" />
            </mesh>
          ))}
          <Box s={[0.3, 0.3, 9]} p={[0, 0.15, -0.5]} c="#e2d8c2" />
        </group>
      );
    case "marker":
      return (
        <group>
          <Box s={[0.25, 2.2, 0.25]} p={[0, 1.1, 0]} c="#b33a2a" />
          <Box s={[0.5, 0.35, 0.05]} p={[0, 1.6, 0.15]} c="#c9a227" e={live ? 0.3 : 0} />
          <Cone r={0.2} h={0.35} p={[0, 0.9, 0.2]} rot={[Math.PI / 2, 0, 0]} c="#c9a227" />
        </group>
      );
    case "bell":
      return (
        <group rotation={[0.4, 0, 0.3]}>
          <Cyl r={0.8} top={0.45} h={1.1} p={[0, 0.6, 0]} c="#5f7d4a" />
          <Ball r={0.45} p={[0, 1.1, 0]} s={[1, 0.6, 1]} c="#5f7d4a" />
          <mesh position={[0, 1.4, 0]}>
            <torusGeometry args={[0.2, 0.06, 5, 8]} />
            <Mat c="#8a6a2a" />
          </mesh>
        </group>
      );
    case "painting":
      return (
        <group>
          <Box s={[2.6, 2, 0.3]} p={[0, 1.1, 0]} c="#8a7a68" />
          {Array.from({ length: 9 }, (_, i) => (
            <Box key={i} s={[0.14, 0.35, 0.03]} p={[-0.9 + i * 0.22, 0.9 + (i % 2) * 0.1, 0.17]} c={i === 8 ? "#c9412a" : "#3a241a"} e={live && i === 8 ? 0.8 : 0} />
          ))}
          <Cone r={0.35} h={0.6} p={[0.9, 1.45, 0.17]} c="#c9412a" e={live ? 0.6 : 0} />
        </group>
      );
    case "old_camp":
      return (
        <group>
          <Cone r={1.3} h={1.7} p={[0, 0.85, -1.2]} c="#8a7a5a" />
          {Array.from({ length: 7 }, (_, i) => (
            <Ball key={i} r={0.18} p={[1.2 + Math.cos(i) * 0.6, 0.1, 0.8 + Math.sin(i) * 0.6]} c="#6d6760" />
          ))}
          <Cyl r={0.3} top={0.35} h={0.4} p={[1.2, 0.3, 0.8]} c="#2d2b28" />
        </group>
      );
    case "tree_boat":
      return (
        <group>
          <Cyl r={0.45} top={0.3} h={6} p={[0, 3, 0]} c="#5a4028" />
          <Cyl r={0.12} h={2.5} p={[0.8, 5, 0]} rot={[0, 0, -0.9]} c="#5a4028" />
          <group position={[0.2, 6.2, 0]} rotation={[0.2, 0.6, 0.15]}>
            <Box s={[1.1, 0.6, 3.6]} c="#8a4b27" />
          </group>
          <Ball r={2} p={[0, 6.8, 0]} s={[1.3, 0.6, 1.3]} c="#3f7a34" />
          <Cyl r={0.03} h={5.8} p={[-0.4, 3.2, 0.9]} rot={[0.15, 0, 0]} c="#c9b98a" />
        </group>
      );
    case "shrine":
      return (
        <group>
          <Box s={[1.4, 1.2, 1.2]} p={[0, 0.6, 0]} c="#8f8a84" />
          <Cone r={1.15} h={0.8} p={[0, 1.6, 0]} rot={[0, Math.PI / 4, 0]} c="#6b3a2a" />
          <Box s={[0.5, 0.5, 0.05]} p={[0, 0.7, 0.62]} c="#2a1d12" />
          <Cyl r={0.12} h={0.15} p={[0, 0.1, 0.9]} c="#c9a227" />
          <Cyl r={0.01} h={0.3} p={[0, 0.3, 0.9]} c="#ff7a3a" e={live ? 2 : 0} />
        </group>
      );
    case "sea_glass":
      return (
        <group>
          {Array.from({ length: 30 }, (_, i) => {
            const a = rnd[i]! * Math.PI * 2;
            const r = Math.sqrt(rnd[i + 30]!) * 2.2;
            const colors = ["#6ad1c9", "#9be38f", "#f2a3c7", "#8fb8ff", "#f5e38f"];
            return <Box key={i} s={[0.1, 0.05, 0.08]} p={[Math.cos(a) * r, 0.03, Math.sin(a) * r]} r={[0, a, 0]} c={colors[i % colors.length]!} e={live ? 0.5 : 0.1} />;
          })}
        </group>
      );
    // ---------------- Điểm bất thường ----------------
    case "ghost_fire":
      return (
        <group>
          {Array.from({ length: 6 }, (_, i) => (
            <Ball key={i} r={0.22} p={[Math.cos(i) * 0.9, 0.12, Math.sin(i) * 0.9]} c="#55504a" />
          ))}
          {live && (
            <Pulse speed={7} amount={0.12}>
              <Cone r={0.4} h={1.3} p={[0, 0.65, 0]} c="#5ad1ff" e={3} />
              <Cone r={0.22} h={0.8} p={[0.1, 0.45, 0]} c="#c9f3ff" e={3} />
            </Pulse>
          )}
        </group>
      );
    case "fairy_ring":
      return (
        <Pulse speed={live ? 1.5 : 0} amount={live ? 0.04 : 0}>
          {Array.from({ length: 11 }, (_, i) => {
            const a = (i / 11) * Math.PI * 2;
            return (
              <group key={i} position={[Math.cos(a) * 2, 0, Math.sin(a) * 2]}>
                <Cyl r={0.05} h={0.25} p={[0, 0.12, 0]} c="#e8e0cc" />
                <Ball r={0.16} p={[0, 0.27, 0]} s={[1, 0.5, 1]} c={i % 2 ? "#ff8fe0" : "#7ff3ff"} e={live ? 1.8 : 0.1} />
              </group>
            );
          })}
        </Pulse>
      );
    case "floating_stones":
      return (
        <group>
          {Array.from({ length: 6 }, (_, i) => (
            <Spin key={i} speed={live ? 0.4 + i * 0.1 : 0} bob={live ? 0.25 : 0} p={[Math.cos(i * 1.1) * 1.2, live ? 1.2 + i * 0.35 : 0.2, Math.sin(i * 1.1) * 1.2]}>
              <mesh castShadow>
                <primitive object={rockGeometry(0.28 + (i % 3) * 0.1, i % 4, 2)} attach="geometry" />
                <Mat c="#77716b" e={0} />
              </mesh>
            </Spin>
          ))}
        </group>
      );
    case "iron_stone":
      return (
        <group>
          <Ball r={0.9} p={[0, 0.5, 0]} s={[1, 0.7, 0.9]} c="#3b3a40" />
          <Spin speed={live ? 9 : 0} p={[0, 1.5, 0]}>
            <Box s={[0.05, 0.03, 0.7]} p={[0, 0, 0.17]} c="#d63b2a" e={live ? 1 : 0} />
            <Box s={[0.05, 0.03, 0.35]} p={[0, 0, -0.17]} c="#eeeeee" />
          </Spin>
        </group>
      );
    case "whisper_stone":
      return (
        <group>
          <Box s={[0.9, 3, 0.6]} p={[0, 1.5, 0]} r={[0.05, 0, 0.04]} c="#4d4a52" />
          <Pulse speed={live ? 2.5 : 0} amount={live ? 0.05 : 0}>
            {Array.from({ length: 5 }, (_, i) => (
              <Box key={i} s={[0.4, 0.06, 0.02]} p={[0, 0.8 + i * 0.45, 0.31]} r={[0, 0, (i % 2 ? 0.4 : -0.4)]} c="#b784ff" e={live ? 2 : 0.1} />
            ))}
          </Pulse>
        </group>
      );
    case "warm_spring":
      return (
        <group>
          <mesh rotation-x={-Math.PI / 2} position-y={0.06}>
            <circleGeometry args={[1.6, 12]} />
            <meshStandardMaterial color="#5fc6c9" emissive="#2a8a8f" emissiveIntensity={live ? 0.5 : 0} roughness={0.2} />
          </mesh>
          {Array.from({ length: 9 }, (_, i) => (
            <Ball key={i} r={0.3} p={[Math.cos(i * 0.7) * 1.8, 0.1, Math.sin(i * 0.7) * 1.8]} c="#a9a39a" />
          ))}
          {live && <Rising count={14} radius={1.2} height={3} size={0.25} color="#f2f2f2" speed={0.6} seed={seed} />}
        </group>
      );
    case "bleeding_tree":
      return (
        <group>
          <Cyl r={0.35} top={0.2} h={4} p={[0, 2, 0]} c="#3b2f2a" />
          <Cyl r={0.1} h={2} p={[0.7, 3.4, 0]} rot={[0, 0, -0.8]} c="#3b2f2a" />
          <Cyl r={0.1} h={1.8} p={[-0.6, 3, 0.2]} rot={[0.2, 0, 0.9]} c="#3b2f2a" />
          <Box s={[0.08, 1.4, 0.05]} p={[0.1, 1.5, 0.33]} c="#a3121c" e={live ? 1.2 : 0.2} />
          <Box s={[0.06, 0.9, 0.05]} p={[-0.15, 1.9, 0.31]} c="#a3121c" e={live ? 1.2 : 0.2} />
          <mesh rotation-x={-Math.PI / 2} position={[0.1, 0.04, 0.6]}>
            <circleGeometry args={[0.45, 9]} />
            <Mat c="#6d0b12" />
          </mesh>
        </group>
      );
    case "upward_rain":
      return (
        <group>
          <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
            <ringGeometry args={[1.8, 2.1, 20]} />
            <meshBasicMaterial color="#9fd8ff" transparent opacity={live ? 0.5 : 0.15} side={DoubleSide} />
          </mesh>
          {live && <Rising count={40} radius={2} height={7} size={0.05} color="#bfe6ff" speed={2.2} seed={seed} />}
        </group>
      );
    case "bubble_vent":
      return (
        <group>
          <Cone r={0.8} h={0.9} p={[0, 0.45, 0]} c="#4a4540" />
          {live && <Rising count={20} radius={0.4} height={9} size={0.14} color="#e0f7ff" speed={1.4} seed={seed} />}
        </group>
      );
    default:
      return <Box s={[0.6, 0.6, 0.6]} p={[0, 0.3, 0]} c="#c9a227" />;
  }
}

/** Đốm sáng lấp lánh báo có gì đó đáng xem, chỉ hiện khi lại gần (không phải cột sáng dẫn đường như điểm sự kiện). */
function Twinkle({ height, color }: { height: number; color: string }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    const m = g.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const d = m.parent ? localPosition.distanceTo(m.parent.position) : 999;
    m.visible = d < 28;
    m.rotation.y = t * 2;
    m.scale.setScalar(0.6 + 0.4 * Math.abs(Math.sin(t * 2.4)));
  });
  return (
    <group ref={g} position-y={height}>
      <mesh>
        <octahedronGeometry args={[0.13, 0]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function PoiView({ poi, found }: { poi: Poi; found: boolean }) {
  const def = worldCatalog.pois.get(poi.defId);
  if (!def) return null;
  const live = !found;
  return (
    <group position={[poi.x, poi.y, poi.z]} rotation-y={poi.rot}>
      <PoiModel model={def.model} live={live} seed={poi.x * 1000 + poi.z} />
      {live && <Twinkle height={def.model === "tree_boat" ? 7.5 : def.model === "shipwreck" ? 3.5 : 1.6} color={def.kind === "egg" ? "#ffe79a" : "#c9a6ff"} />}
    </group>
  );
}

/** Bẫy đã sập: vẽ lại đúng dáng bẫy ở chỗ đó để người khác tránh. */
function TrapModel({ defId }: { defId: string }) {
  const model = worldCatalog.traps.get(defId)?.model ?? "";
  switch (model) {
    case "spike_pit":
      return (
        <group>
          <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
            <circleGeometry args={[1.1, 10]} />
            <Mat c="#1f1712" />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <Cone key={i} r={0.05} h={0.6} p={[Math.cos(i) * 0.6, 0.2, Math.sin(i * 1.3) * 0.6]} c="#c9b98a" />
          ))}
        </group>
      );
    case "snare":
      return (
        <group>
          <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
            <torusGeometry args={[0.45, 0.04, 5, 12]} />
            <Mat c="#c9b98a" />
          </mesh>
          <Cyl r={0.04} h={1.6} p={[0.6, 0.8, 0]} rot={[0, 0, 0.3]} c="#6b4a2b" />
        </group>
      );
    case "quicksand":
      return (
        <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
          <circleGeometry args={[1.5, 12]} />
          <Mat c="#8a6a3a" />
        </mesh>
      );
    case "rockfall":
      return (
        <group>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[Math.cos(i * 2) * 0.7, 0.25, Math.sin(i * 1.4) * 0.7]} rotation={[i, i, 0]} castShadow>
              <primitive object={rockGeometry(0.3 + (i % 3) * 0.12, i % 4, 2)} attach="geometry" />
              <Mat c="#6a645d" />
            </mesh>
          ))}
        </group>
      );
    case "gas_vent":
      return (
        <group>
          <Box s={[1.4, 0.05, 0.2]} p={[0, 0.03, 0]} r={[0, 0.5, 0]} c="#2b2622" />
          <Rising count={10} radius={0.4} height={2.5} size={0.3} color="#d8d35a" speed={0.5} />
        </group>
      );
    case "urchins":
      return (
        <group>
          {Array.from({ length: 6 }, (_, i) => (
            <Ball key={i} r={0.14} p={[Math.cos(i) * 0.5, 0.12, Math.sin(i * 2) * 0.5]} c="#1a1426" />
          ))}
        </group>
      );
    case "dart_trap":
      return (
        <group>
          <Box s={[0.6, 0.06, 0.6]} p={[0, 0.03, 0]} c="#5f5a55" />
          <Cyl r={0.02} h={0.7} p={[0.4, 0.3, 0]} rot={[0, 0, 1.2]} c="#6b4a2b" />
        </group>
      );
    case "ant_nest":
      return <Cone r={0.6} h={0.5} p={[0, 0.25, 0]} c="#7a4b2b" />;
    case "rotten_planks":
      return (
        <group>
          <Box s={[1.2, 0.06, 0.3]} p={[0, 0.03, -0.3]} r={[0, 0, 0.2]} c="#5a4028" />
          <Box s={[1.2, 0.06, 0.3]} p={[0, -0.05, 0.1]} r={[0.3, 0, -0.1]} c="#5a4028" />
          <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
            <circleGeometry args={[0.7, 8]} />
            <Mat c="#120d0a" />
          </mesh>
        </group>
      );
    default:
      return <Box s={[0.3, 0.3, 0.3]} p={[0, 0.15, 0]} c="#d63b2a" />;
  }
}

export function Points({ room, world }: { room: IslandRoom; world: World }) {
  const view = useRoomSnapshot(room, (s) => ({
    day: s.day,
    found: [...s.discovered],
    traps: [...s.traps.entries()].map(([id, t]) => ({ id, defId: t.defId, x: t.x, y: t.y, z: t.z })),
  }));
  const found = new Set(view.found);
  return (
    <>
      {world.pois
        .filter((p) => p.day === 0 || p.day === view.day)
        .map((p) => (
          <PoiView key={p.id} poi={p} found={found.has(p.id)} />
        ))}
      {view.traps.map((t) => (
        <group key={t.id} position={[t.x, t.y, t.z]}>
          <TrapModel defId={t.defId} />
        </group>
      ))}
    </>
  );
}
