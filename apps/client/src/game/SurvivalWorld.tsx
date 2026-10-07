import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Object3D, type InstancedMesh, type Mesh, type MeshStandardMaterial } from "three";
import {
  BOMB_RADIUS,
  CRATER_RADIUS,
  CRATER_SECONDS,
  HOT_SPRING,
  VOLCANO,
  WATER_LEVEL,
  WRECK_LOOT_OFFSET,
  ashAmount,
  dayTime,
  flowProgress,
  flowReach,
  lavaFlows,
  quakeCracks,
  seaLevel,
  springBoiling,
  tidalOpen,
  tidalSites,
  volcanoStage,
  type LavaFlow,
  type TidalSite,
  type World,
} from "@tentides/content";
import { SurvivalMessages, type VolcanoMessage } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { useProfile } from "./graphics.ts";
import { mulberry32, rockGeometry } from "./nature.ts";
import { localEnv, shake } from "./shared.ts";
import { play } from "./sound/sfx.ts";
import { tide } from "./tide.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { waterUniforms } from "./Water.tsx";
import { Flame } from "./Flame.tsx";

// Đảo sinh tồn biến động (chỉ vẽ trong chế độ cốt truyện): thủy triều dâng hạ theo giờ, xác tàu, hang ngầm, cổ vật
// trên rạn san hô lộ ra khi triều rút; núi lửa leo thang — vết nứt, mưa tro, suối sôi, bom nham thạch, hố lửa,
// dòng dung nham. Mọi thứ ảnh hưởng tới luật chơi do server tính; ở đây chỉ vẽ theo cùng các hàm của content.

// ---------------------------------------------------------------------------- thủy triều

/** Mực nước theo đồng hồ pha (nội suy giữa hai nhịp giây), làm mượt chỗ đổi pha cho mặt biển khỏi giật. */
function TideDriver({ room }: { room: IslandRoom }) {
  const timer = useRef({ timeLeft: -1, at: 0, first: true });
  useEffect(
    () => () => {
      // Rời đảo (vào Battleground) thì mặt biển về mốc.
      tide.level = WATER_LEVEL;
      waterUniforms.uTide.value = 0;
    },
    [],
  );
  useFrame((_, rawDt) => {
    const s = room.state;
    const now = performance.now();
    const t = timer.current;
    if (s.timeLeft !== t.timeLeft) {
      t.timeLeft = s.timeLeft;
      t.at = now;
    }
    const remaining = Math.max(s.timeLeft - 1, s.timeLeft - (now - t.at) / 1000);
    const target = seaLevel(s, remaining);
    tide.level = t.first ? target : tide.level + (target - tide.level) * Math.min(1, Math.min(rawDt, 0.1) * 1.5);
    t.first = false;
    waterUniforms.uTide.value = tide.level - WATER_LEVEL;
  });
  return null;
}

const WOOD = "#5b4630";
const WOOD_DARK = "#3e2f20";

/** Xác tàu đắm nằm trên thềm cát: thân tàu nghiêng, mấy xương sườn; cổ vật nằm dọc thân. */
function Wreck({ sites, world }: { sites: readonly TidalSite[]; world: World }) {
  const mid = sites[1] ?? sites[0]!;
  // Thân tàu nằm trên trục, cổ vật lệch ra phía biển (xem tide.ts).
  const x = mid.x - Math.cos(mid.rot) * WRECK_LOOT_OFFSET;
  const z = mid.z - Math.sin(mid.rot) * WRECK_LOOT_OFFSET;
  return (
    <group position={[x, world.heightAt(x, z) - 0.3, z]} rotation={[0, -mid.rot, 0.18]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.3, 9]} />
        <meshStandardMaterial color={WOOD_DARK} flatShading roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.2, 1.2, side * 0.4]} rotation-z={side * 0.3} castShadow>
          <boxGeometry args={[0.2, 1.4, side > 0 ? 7.6 : 5.2]} />
          <meshStandardMaterial color={WOOD} flatShading roughness={1} />
        </mesh>
      ))}
      {[-3, -1.5, 0, 1.5].map((z) => (
        <mesh key={z} position={[0, 1, z]} rotation-z={Math.PI / 2}>
          <torusGeometry args={[1.25, 0.09, 4, 8, Math.PI]} />
          <meshStandardMaterial color={WOOD_DARK} flatShading />
        </mesh>
      ))}
      <mesh position={[0.3, 2.6, -1]} rotation-x={0.6}>
        <cylinderGeometry args={[0.12, 0.16, 4.5, 6]} />
        <meshStandardMaterial color="#4a3a28" flatShading />
      </mesh>
    </group>
  );
}

/** Cửa hang ngầm dưới chân vách: một vòm đá đen bám rong, trong tối om. */
function SeaCave({ site }: { site: TidalSite }) {
  const rocks = useMemo(() => {
    const rand = mulberry32(73);
    return Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI * (i / 8);
      return { x: Math.cos(a) * 2.6, y: Math.sin(a) * 2.4, s: 1 + rand() * 0.5, k: i };
    });
  }, []);
  // Vòm quay mặt ra biển (hướng từ tâm đảo ra ngoài).
  return (
    <group position={[site.x, site.y - 0.2, site.z]} rotation-y={Math.PI / 2 - site.rot}>
      {rocks.map((r) => (
        <mesh key={r.k} position={[r.x, r.y, -0.8]} rotation={[r.k, r.k * 2, 0]} castShadow>
          <primitive object={rockGeometry(r.s, r.k % 4, 2)} attach="geometry" />
          <meshStandardMaterial color="#2c2a28" flatShading roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 1.1, -1.4]}>
        <circleGeometry args={[2.1, 12, 0, Math.PI]} />
        <meshBasicMaterial color="#050506" />
      </mesh>
      <mesh position={[0, 1.1, -1.42]} rotation-z={Math.PI}>
        <planeGeometry args={[4.2, 0.01]} />
        <meshBasicMaterial color="#050506" />
      </mesh>
    </group>
  );
}

/** Món cổ vật: hòm gỗ (xác tàu, hang) hay bình gốm (rạn san hô); triều rút thì lấp lánh mời lại gần. */
function Artifact({ site }: { site: TidalSite }) {
  const glint = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const g = glint.current;
    if (!g) return;
    const open = tidalOpen(site, tide.level);
    g.visible = open;
    if (open) {
      const t = clock.elapsedTime + site.x;
      g.position.y = site.y + 1.1 + Math.sin(t * 2) * 0.12;
      g.rotation.y = t;
      g.scale.setScalar(0.85 + Math.sin(t * 5) * 0.15);
    }
  });
  return (
    <group>
      <group position={[site.x, site.y, site.z]} rotation-y={site.rot}>
        {site.kind === "reef" ? (
          <mesh position={[0, 0.35, 0]} rotation-z={0.5} castShadow>
            <cylinderGeometry args={[0.18, 0.3, 0.8, 8]} />
            <meshStandardMaterial color="#a8653a" flatShading roughness={0.8} />
          </mesh>
        ) : (
          <group position={[0, 0.25, 0]} rotation-z={0.12}>
            <mesh castShadow>
              <boxGeometry args={[0.9, 0.5, 0.6]} />
              <meshStandardMaterial color="#6b4a2b" flatShading roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.27, 0]}>
              <boxGeometry args={[0.94, 0.08, 0.64]} />
              <meshStandardMaterial color="#b08d3a" metalness={0.6} roughness={0.4} flatShading />
            </mesh>
          </group>
        )}
      </group>
      <mesh ref={glint} position={[site.x, site.y + 1.1, site.z]} visible={false}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshBasicMaterial color="#ffe68a" toneMapped={false} />
      </mesh>
    </group>
  );
}

function TidalFinds({ room, world }: { room: IslandRoom; world: World }) {
  const sites = useMemo(() => tidalSites(world), [world]);
  const found = useRoomSnapshot(room, (s) => [...s.discovered].filter((id) => id.startsWith("tide_")).join(","));
  const taken = useMemo(() => new Set(found.split(",")), [found]);
  const wreck = sites.filter((s) => s.kind === "wreck");
  const cave = sites.find((s) => s.kind === "cave");
  return (
    <>
      {wreck.length > 0 && <Wreck sites={wreck} world={world} />}
      {cave && <SeaCave site={cave} />}
      {sites.filter((s) => !taken.has(s.id)).map((s) => (
        <Artifact key={s.id} site={s} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------- núi lửa

/** Vết nứt động đất: từng đường gãy khúc bám theo mặt đất, phun trào thì rực đỏ bên trong. */
const CRACK_SEGMENTS = 4;
function Cracks({ world, stage }: { world: World; stage: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const cracks = useMemo(() => quakeCracks(world), [world]);
  const count = cracks.length * CRACK_SEGMENTS;
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new Object3D();
    const rand = mulberry32(world.seed);
    cracks.forEach((c, i) => {
      let x = c.x;
      let z = c.z;
      let rot = c.rot;
      const seg = c.length / CRACK_SEGMENTS;
      for (let k = 0; k < CRACK_SEGMENTS; k++) {
        rot += (rand() - 0.5) * 0.9;
        const nx = x + Math.cos(rot) * seg;
        const nz = z + Math.sin(rot) * seg;
        const mx = (x + nx) / 2;
        const mz = (z + nz) / 2;
        dummy.position.set(mx, world.heightAt(mx, mz) + 0.02, mz);
        dummy.rotation.set(0, -rot, 0);
        dummy.scale.set(seg * 1.05, 1, 0.18 + rand() * 0.25);
        dummy.updateMatrix();
        m.setMatrixAt(i * CRACK_SEGMENTS + k, dummy.matrix);
        x = nx;
        z = nz;
      }
    });
    m.instanceMatrix.needsUpdate = true;
  }, [cracks, world]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={stage >= 2} receiveShadow>
      <boxGeometry args={[1, 0.06, 1]} />
      <meshStandardMaterial color="#1a1513" emissive="#ff3d00" emissiveIntensity={stage >= 3 ? 1.4 : 0} roughness={1} />
    </instancedMesh>
  );
}

/** Mưa tro: bụi xám lả tả quanh người, dày dần theo mức núi lửa (sương mù dày lên ở Weather.tsx). */
const ASH_AREA = 24;
const ASH_HEIGHT = 18;
function AshFall({ level, count }: { level: number; count: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const shown = useRef(0);
  const flakes = useMemo(() => {
    const rand = mulberry32(9);
    return Array.from({ length: count }, () => ({ x: (rand() - 0.5) * 2 * ASH_AREA, y: rand() * ASH_HEIGHT, z: (rand() - 0.5) * 2 * ASH_AREA, speed: 1.2 + rand() * 1.4, sway: rand() * 6 }));
  }, [count]);
  const dummy = useMemo(() => new Object3D(), []);
  const amount = useRef(0);
  useFrame(({ camera, clock }, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const goal = ashAmount(level) * (1 - localEnv.indoor) * (localEnv.underwater ? 0 : 1);
    amount.current += (goal - amount.current) * Math.min(1, dt * 0.5);
    const visible = Math.floor(count * amount.current);
    if (visible === 0 && shown.current === 0) return;
    shown.current = visible;
    m.count = visible;
    const t = clock.elapsedTime;
    for (let i = 0; i < visible; i++) {
      const f = flakes[i]!;
      f.y -= f.speed * dt;
      if (f.y < 0) f.y += ASH_HEIGHT;
      // Hạt bám theo camera (lưới lặp quanh người), lắc lư theo gió.
      const wx = camera.position.x + ((((f.x - camera.position.x) % (2 * ASH_AREA)) + 3 * ASH_AREA) % (2 * ASH_AREA)) - ASH_AREA;
      const wz = camera.position.z + ((((f.z - camera.position.z) % (2 * ASH_AREA)) + 3 * ASH_AREA) % (2 * ASH_AREA)) - ASH_AREA;
      dummy.position.set(wx + Math.sin(t * 0.7 + f.sway) * 0.6, camera.position.y - 6 + f.y, wz + Math.cos(t * 0.5 + f.sway) * 0.6);
      dummy.rotation.set(t + f.sway, f.sway, 0);
      dummy.scale.setScalar(0.07);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#8d8782" transparent opacity={0.75} depthWrite={false} />
    </instancedMesh>
  );
}

/** Suối nước nóng sôi sục (từ ngày 5): bong bóng sủi lên mặt vũng, hơi bốc dày. */
const BUBBLES = 18;
function BoilingSpring({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const y = world.heightAt(HOT_SPRING.x, HOT_SPRING.z);
  const seeds = useMemo(() => {
    const rand = mulberry32(44);
    return Array.from({ length: BUBBLES }, () => ({ a: rand() * Math.PI * 2, r: rand() * (HOT_SPRING.radius - 0.6), o: rand(), s: 0.8 + rand() * 0.8 }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    seeds.forEach((b, i) => {
      const life = (t * b.s + b.o) % 1;
      dummy.position.set(HOT_SPRING.x + Math.cos(b.a) * b.r, y + 0.14 + life * 0.25, HOT_SPRING.z + Math.sin(b.a) * b.r);
      dummy.scale.setScalar(0.08 + life * 0.18);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, BUBBLES]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshStandardMaterial color="#d8fff8" transparent opacity={0.6} roughness={0.1} />
    </instancedMesh>
  );
}

/** Dải dung nham chảy theo đường giữa dòng, bám mặt đất; dài dần theo giờ trong ngày. */
function FlowRibbon({ flow, room }: { flow: LavaFlow; room: IslandRoom }) {
  const mesh = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const pts = flow.points;
    const pos = new Float32Array(pts.length * 2 * 3);
    const uv = new Float32Array(pts.length * 2 * 2);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      // Mép dòng chảy uốn nhẹ cho khỏi thẳng tưng.
      const w = (flow.width / 2) * (0.85 + 0.15 * Math.sin(i * 1.7));
      const nx = (-dz / len) * w;
      const nz = (dx / len) * w;
      const p = pts[i]!;
      pos.set([p.x + nx, p.y + 0.12, p.z + nz, p.x - nx, p.y + 0.12, p.z - nz], i * 6);
      uv.set([0, i / 4, 1, i / 4], i * 4);
    }
    const index: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const k = i * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }, [flow]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const timer = useRef({ timeLeft: -1, at: 0 });
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const s = room.state;
    const now = performance.now();
    if (s.timeLeft !== timer.current.timeLeft) timer.current = { timeLeft: s.timeLeft, at: now };
    const remaining = Math.max(s.timeLeft - 1, s.timeLeft - (now - timer.current.at) / 1000);
    const reach = flowReach(flow, flowProgress(dayTime(s.phase, remaining, s.phaseDuration)));
    geometry.setDrawRange(0, (reach - 1) * 6);
    (m.material as MeshStandardMaterial).emissiveIntensity = 1.8 + Math.sin(clock.elapsedTime * 1.3) * 0.4;
  });
  return (
    <mesh ref={mesh} geometry={geometry} receiveShadow frustumCulled={false}>
      <meshStandardMaterial color="#ff6a1a" emissive="#ff3a00" emissiveIntensity={2} roughness={0.6} toneMapped={false} />
    </mesh>
  );
}

function LavaFlows({ room, world, day, level }: { room: IslandRoom; world: World; day: number; level: number }) {
  const flows = useMemo(() => lavaFlows(world, day, level), [world, day, level]);
  return (
    <>
      {flows.map((f) => (
        <FlowRibbon key={f.id} flow={f} room={room} />
      ))}
    </>
  );
}

/** Cột tro phun trào: những cụm khói đen cuộn lên cao trên miệng núi. */
const PLUME = 26;
function EruptionPlume({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const top = world.heightAt(VOLCANO.x, VOLCANO.z);
  const puffs = useMemo(() => {
    const rand = mulberry32(88);
    return Array.from({ length: PLUME }, () => ({ o: rand(), a: rand() * Math.PI * 2, s: 1.4 + rand() * 1.2 }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    puffs.forEach((p, i) => {
      const life = (t * 0.05 + p.o) % 1;
      const r = 2 + life * 12;
      dummy.position.set(VOLCANO.x + Math.cos(p.a + t * 0.05) * r, top + 4 + life * 55, VOLCANO.z + Math.sin(p.a) * r);
      dummy.scale.setScalar(p.s * (1.5 + life * 6) * Math.sin(Math.PI * Math.min(1, life * 1.2)));
      dummy.rotation.set(i, t * 0.05 + i, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, PLUME]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#3b3633" flatShading transparent opacity={0.85} roughness={1} depthWrite={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------- bom nham thạch, hố lửa, động đất

interface FlyingBomb {
  id: string;
  x: number;
  y: number;
  z: number;
  /** performance.now() lúc phóng, và tổng giây bay. */
  at: number;
  flight: number;
}
interface Crater {
  id: string;
  x: number;
  y: number;
  z: number;
  until: number;
}
/** Giới hạn số bom, hố vẽ cùng lúc. */
const MAX_BOMBS = 12;
const MAX_CRATERS = 10;

function Bomb({ bomb, world }: { bomb: FlyingBomb; world: World }) {
  const rock = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const top = world.heightAt(VOLCANO.x, VOLCANO.z) + 2;
  useFrame(({ clock }) => {
    const k = Math.min(1, (performance.now() - bomb.at) / 1000 / bomb.flight);
    const r = rock.current;
    if (r) {
      // Đường bay vồng cao từ miệng núi xuống chỗ rơi.
      r.position.set(VOLCANO.x + (bomb.x - VOLCANO.x) * k, top + (bomb.y - top) * k + Math.sin(Math.PI * k) * 45, VOLCANO.z + (bomb.z - VOLCANO.z) * k);
      r.rotation.set(clock.elapsedTime * 3, clock.elapsedTime * 2, 0);
    }
    const g = ring.current;
    if (g) {
      // Vòng đỏ dưới đất co lại dần: chỗ sắp rơi, chạy mau.
      g.scale.setScalar(BOMB_RADIUS * (1.15 - 0.4 * k));
      (g.material as MeshStandardMaterial).opacity = 0.35 + 0.4 * Math.abs(Math.sin(clock.elapsedTime * 8));
    }
  });
  return (
    <group>
      <mesh ref={rock}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color="#2a1a12" emissive="#ff5a10" emissiveIntensity={2.4} flatShading toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[bomb.x, bomb.y + 0.08, bomb.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.85, 1, 24]} />
        <meshStandardMaterial color="#ff2a10" emissive="#ff2a10" transparent opacity={0.6} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function CraterFire({ crater }: { crater: Crater }) {
  const glow = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const g = glow.current;
    if (!g) return;
    const left = Math.max(0, (crater.until - performance.now()) / 1000);
    (g.material as MeshStandardMaterial).emissiveIntensity = Math.min(1, left / 10) * (1.6 + Math.sin(clock.elapsedTime * 7 + crater.x) * 0.4);
  });
  return (
    <group position={[crater.x, crater.y, crater.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[CRATER_RADIUS + 0.8, 14]} />
        <meshStandardMaterial color="#1b1512" roughness={1} />
      </mesh>
      <mesh ref={glow} rotation-x={-Math.PI / 2} position-y={0.08}>
        <circleGeometry args={[CRATER_RADIUS * 0.75, 12]} />
        <meshStandardMaterial color="#ff5a10" emissive="#ff3a00" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <Flame position={[0, 0.05, 0]} width={1.4} height={1.8} seed={(crater.x * 0.13) % 1} />
    </group>
  );
}

function Eruptions({ room, world }: { room: IslandRoom; world: World }) {
  const [bombs, setBombs] = useState<FlyingBomb[]>([]);
  const [craters, setCraters] = useState<Crater[]>([]);
  const quake = useRef({ start: -100, duration: 0, strength: 0 });
  const blast = useRef<Mesh>(null);
  const blastAt = useRef({ x: 0, y: 0, z: 0, start: -100 });

  useEffect(() => {
    const off = room.onMessage(SurvivalMessages.volcano, (m: VolcanoMessage) => {
      const now = performance.now();
      if (m.kind === "quake") {
        quake.current = { start: now / 1000, duration: m.duration, strength: m.strength };
        play("rumble", { volume: 0.6 + 0.4 * m.strength });
      } else if (m.kind === "bomb") {
        setBombs((list) => [...list.filter((b) => b.id !== m.id), { id: m.id, x: m.x, y: m.y, z: m.z, at: now, flight: m.flight }].slice(-MAX_BOMBS));
      } else {
        setBombs((list) => list.filter((b) => b.id !== m.id));
        setCraters((list) => [...list.filter((c) => c.until > now && c.id !== m.id), { id: m.id, x: m.x, y: m.y, z: m.z, until: now + m.seconds * 1000 }].slice(-MAX_CRATERS));
        // Hố lửa cũ server gửi lại (vào giữa chừng) thì không nổ lại.
        if (m.seconds < CRATER_SECONDS - 1) return;
        blastAt.current = { x: m.x, y: m.y, z: m.z, start: now / 1000 };
        play("thunder", { at: { x: m.x, y: m.y, z: m.z }, volume: 0.8 });
        play("sizzle", { at: { x: m.x, y: m.y, z: m.z }, volume: 0.6 });
      }
    });
    // Vào giữa chừng: xin server gửi lại bom đang bay, hố lửa còn cháy.
    room.send(SurvivalMessages.volcano);
    return off;
  }, [room]);
  // Hố lửa tắt thì dọn đi.
  useEffect(() => {
    if (craters.length === 0) return;
    const id = setInterval(() => setCraters((list) => (list.some((c) => c.until <= performance.now()) ? list.filter((c) => c.until > performance.now()) : list)), 2000);
    return () => clearInterval(id);
  }, [craters.length]);

  useFrame(({ camera }) => {
    const now = performance.now() / 1000;
    const q = quake.current;
    const since = now - q.start;
    if (since < q.duration) shake.amount = Math.max(shake.amount, 0.4 * q.strength * Math.sin((since / q.duration) * Math.PI));
    // Bom rơi gần thì mặt đất rung, chớp sáng một quả cầu lửa.
    const b = blastAt.current;
    const bs = now - b.start;
    const ball = blast.current;
    if (ball) {
      ball.visible = bs < 0.6;
      if (ball.visible) {
        ball.position.set(b.x, b.y + 1, b.z);
        ball.scale.setScalar(1 + bs * 9);
        (ball.material as MeshStandardMaterial).opacity = 1 - bs / 0.6;
      }
      if (bs < 0.05) {
        const d = Math.hypot(camera.position.x - b.x, camera.position.z - b.z);
        shake.amount = Math.max(shake.amount, Math.max(0, 0.7 - d / 40));
      }
    }
  });

  return (
    <>
      {bombs.map((b) => (
        <Bomb key={b.id} bomb={b} world={world} />
      ))}
      {craters.map((c) => (
        <CraterFire key={c.id} crater={c} />
      ))}
      <mesh ref={blast} visible={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff6a1a" emissiveIntensity={3} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/** Ánh đỏ phản lên mây tro khi phun trào (một đèn, tắt khi chưa phun). */
function EruptionGlow({ world, stage }: { world: World; stage: number }) {
  const top = world.heightAt(VOLCANO.x, VOLCANO.z);
  const color = useMemo(() => new Color("#ff4a12"), []);
  return stage >= 3 ? <pointLight position={[VOLCANO.x, top + 14, VOLCANO.z]} color={color} intensity={60} distance={120} decay={1.1} /> : null;
}

// ---------------------------------------------------------------------------- gộp lại

export function SurvivalWorld({ room, world }: { room: IslandRoom; world: World }) {
  const story = useRoomSnapshot(room, (s) => s.mode === "story");
  const level = useRoomSnapshot(room, (s) => s.volcano);
  const day = useRoomSnapshot(room, (s) => s.day);
  const stage = volcanoStage(level);
  const ashCount = Math.min(700, Math.round(useProfile().rain * 0.45));
  if (!story) return null;
  return (
    <group>
      <TideDriver room={room} />
      <TidalFinds room={room} world={world} />
      <Cracks world={world} stage={stage} />
      {stage >= 2 && <AshFall level={level} count={ashCount} />}
      {springBoiling(level) && <BoilingSpring world={world} />}
      {stage >= 3 && <LavaFlows room={room} world={world} day={day} level={level} />}
      {stage >= 3 && <EruptionPlume world={world} />}
      <EruptionGlow world={world} stage={stage} />
      <Eruptions room={room} world={world} />
    </group>
  );
}

