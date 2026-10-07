import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { BufferAttribute, BufferGeometry, DoubleSide, MeshStandardMaterial, Object3D, type Group, type InstancedMesh, type Mesh, type MeshBasicMaterial, type PointLight } from "three";
import { BUILD_RADIUS, worldCatalog, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { getHud, setHud, useHud } from "./hudStore.ts";
import { look } from "./input.ts";
import { mulberry32, rockGeometry } from "./nature.ts";
import { usePrivate } from "./privateStore.ts";
import { buildGhost, localPosition, sky } from "./shared.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { Flame } from "./Flame.tsx";
import { SnapGhost, SnapPieces, type PlacedBuilding } from "./SnapBuild.tsx";
import { detailed } from "./textures.ts";

// Trại: lửa trại, hai lều và những công trình cả đội dựng thêm (chòi lá, nhà sàn, hàng rào), tất cả đặt
// tương đối so với lửa trại. Nhổ trại mang đi rồi đặt lửa trại ở chỗ mới thì cả khu nhà dời theo.

const EMBERS = 18;
/** Khúc gỗ ngồi quanh lửa: vân vỏ cây (vân ván gỗ trên thân tròn thành sọc). */
const SEAT_LOG = detailed(new MeshStandardMaterial({ color: "#6e5236", roughness: 0.95 }), "bark", 0.1);

function Campfire({ x, z, ground }: { x: number; z: number; ground: number }) {
  const light = useRef<PointLight>(null);
  const embers = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const seeds = useMemo(() => {
    const rand = mulberry32(31);
    return Array.from({ length: EMBERS }, () => ({ o: rand(), a: rand() * Math.PI * 2, r: rand() * 0.4 }));
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (light.current) light.current.intensity = (14 + Math.sin(t * 11) * 2.5 + Math.sin(t * 23) * 1.5) * (0.5 + sky.night * 1.2);
    const mesh = embers.current;
    if (!mesh) return;
    seeds.forEach((s, i) => {
      const life = (t * 0.45 + s.o) % 1;
      dummy.position.set(x + Math.cos(s.a + t) * (s.r + life * 0.5), ground + 0.4 + life * 3.2, z + Math.sin(s.a + t) * (s.r + life * 0.5));
      dummy.scale.setScalar(0.05 * (1 - life));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <group position={[x, ground + 0.05, z]}>
        <Flame position={[0, 0, 0]} width={1.2} height={1.9} seed={0.1} />
        <Flame position={[0.15, 0, 0.1]} width={0.8} height={1.4} seed={0.57} intensity={0.8} />
        <Flame position={[-0.15, 0, -0.08]} width={0.7} height={1.2} seed={0.83} intensity={0.8} />
      </group>
      <pointLight ref={light} position={[x, ground + 1.6, z]} color="#ffa052" distance={18} castShadow={false} />
      <instancedMesh ref={embers} args={[undefined, undefined, EMBERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffb347" toneMapped={false} />
      </instancedMesh>
      {/* Vòng đá quanh lửa. */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return (
          <mesh key={i} position={[x + Math.cos(a) * 0.95, ground + 0.12, z + Math.sin(a) * 0.95]} rotation={[i, i * 2, 0]} castShadow>
            <primitive object={rockGeometry(0.22, i % 4, 2)} attach="geometry" />
            <meshStandardMaterial color="#77716b" flatShading />
          </mesh>
        );
      })}
      {/* Củi cháy dở chụm giữa. */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[x, ground + 0.15, z]} rotation={[0, (i / 3) * Math.PI, Math.PI / 2 - 0.25]}>
          <cylinderGeometry args={[0.07, 0.09, 1.2, 5]} />
          <meshStandardMaterial color="#3a2616" flatShading />
        </mesh>
      ))}
      {/* Khúc gỗ ngồi quanh. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        return (
          <mesh key={i} position={[x + Math.cos(a) * 2.4, ground + 0.22, z + Math.sin(a) * 2.4]} rotation={[0, -a, Math.PI / 2]} material={SEAT_LOG} castShadow receiveShadow>
            <cylinderGeometry args={[0.24, 0.26, 1.8, 14]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Lều chữ A: hai mái nghiêng và hai đầu tam giác. */
function tentGeometry(width: number, height: number, depth: number): BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  // prettier-ignore
  const v = [
    -w, 0, -d,   0, height, -d,   0, height, d,
    -w, 0, -d,   0, height, d,   -w, 0, d,
    w, 0, d,   0, height, d,   0, height, -d,
    w, 0, d,   0, height, -d,   w, 0, -d,
    -w, 0, -d,   w, 0, -d,   0, height, -d,
    w, 0, d,   -w, 0, d,   0, height, d,
  ];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}
const TENT = tentGeometry(2.4, 1.7, 2.8);

function Tent({ x, y, z, rot, color }: { x: number; y: number; z: number; rot: number; color: string }) {
  return (
    <group position={[x, y - 0.05, z]} rotation-y={rot}>
      <mesh geometry={TENT} castShadow receiveShadow>
        <meshStandardMaterial color={color} flatShading roughness={0.9} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.45, 1.41]}>
        <planeGeometry args={[0.7, 0.9]} />
        <meshStandardMaterial color="#2a1d12" side={DoubleSide} />
      </mesh>
    </group>
  );
}

const THATCH = "#b59a52";
const POLE = "#6b4a2b";
const PLANK = "#8a6038";

function Post({ p, h, r = 0.1 }: { p: [number, number, number]; h: number; r?: number }) {
  return (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} castShadow>
      <cylinderGeometry args={[r, r * 1.1, h, 6]} />
      <meshStandardMaterial color={POLE} flatShading />
    </mesh>
  );
}

/** Hình dáng từng loại công trình (gốc toạ độ ở giữa nền, mặt đất y = 0). */
export function BuildingModel({ kind, ghost }: { kind: string; ghost?: string }) {
  const mat = (c: string) =>
    ghost ? <meshBasicMaterial color={ghost} transparent opacity={0.35} depthWrite={false} /> : <meshStandardMaterial color={c} flatShading roughness={0.9} side={DoubleSide} />;
  switch (kind) {
    case "lean_to":
      return (
        <group>
          {!ghost && [-1.4, 1.4].map((x) => <Post key={`f${x}`} p={[x, 0, 1.3]} h={2.2} />)}
          {!ghost && [-1.4, 1.4].map((x) => <Post key={`b${x}`} p={[x, 0, -1.3]} h={0.9} />)}
          <mesh position={[0, 1.55, 0]} rotation-x={-0.44} castShadow receiveShadow>
            <boxGeometry args={[3.4, 0.12, 3.1]} />
            {mat(THATCH)}
          </mesh>
          {!ghost && (
            <mesh position={[0, 0.03, 0]} receiveShadow>
              <boxGeometry args={[2.6, 0.05, 2.4]} />
              <meshStandardMaterial color="#8b7a4a" flatShading />
            </mesh>
          )}
        </group>
      );
    case "hut":
      return (
        <group>
          {!ghost && [-1.8, 1.8].flatMap((x) => [-1.8, 1.8].map((z) => <Post key={`${x},${z}`} p={[x, 0, z]} h={1.2} r={0.13} />))}
          <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[4, 0.15, 4]} />
            {mat(PLANK)}
          </mesh>
          {/* Vách ván, chừa cửa phía trước. */}
          {[
            [0, -1.9, 4, 0.12],
            [-1.9, 0, 0.12, 4],
            [1.9, 0, 0.12, 4],
            [-1.25, 1.9, 1.5, 0.12],
            [1.25, 1.9, 1.5, 0.12],
          ].map(([x, z, w, d], i) => (
            <mesh key={i} position={[x!, 2.2, z!]} castShadow receiveShadow>
              <boxGeometry args={[w!, 1.8, d!]} />
              {mat(PLANK)}
            </mesh>
          ))}
          <mesh position={[0, 3.9, 0]} rotation-y={Math.PI / 4} castShadow>
            <coneGeometry args={[3.4, 1.8, 4]} />
            {mat(THATCH)}
          </mesh>
          {!ghost && (
            <mesh position={[0, 0.62, 2.4]} rotation-x={0.55} castShadow>
              <boxGeometry args={[1, 0.08, 1.5]} />
              <meshStandardMaterial color={PLANK} flatShading />
            </mesh>
          )}
        </group>
      );
    case "fence":
      return (
        <group>
          {[-1.5, -0.75, 0, 0.75, 1.5].map((x) => (
            <mesh key={x} position={[x, 0.6, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.08, 1.2, 5]} />
              {mat(POLE)}
            </mesh>
          ))}
          {[0.4, 0.9].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow>
              <boxGeometry args={[3.2, 0.08, 0.08]} />
              {mat(POLE)}
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

function BuildingCollider({ kind }: { kind: string }) {
  switch (kind) {
    case "lean_to":
      return (
        <>
          {[-1.4, 1.4].flatMap((x) => [-1.3, 1.3].map((z) => <CylinderCollider key={`${x},${z}`} args={[1, 0.12]} position={[x, 1, z]} />))}
        </>
      );
    case "hut":
      return <CuboidCollider args={[2, 2.2, 2]} position={[0, 2.2, 0]} />;
    case "fence":
      return <CuboidCollider args={[1.6, 0.6, 0.1]} position={[0, 0.6, 0]} />;
    default:
      return null;
  }
}

/** Bóng công trình trước mặt khi đang ở chế độ dựng nhà: xanh là dựng được, đỏ là không. */
function BuildGhost({
  world,
  camp,
  buildings,
  blocked,
  records,
}: {
  world: World;
  camp: { x: number; z: number; packed: boolean };
  buildings: { x: number; z: number }[];
  blocked: { x: number; z: number }[];
  records: readonly PlacedBuilding[];
}) {
  const view = usePrivate();
  const kind = useHud().build;
  const def = worldCatalog.buildings.get(kind);
  const items = view?.bag.map((b) => b.itemId) ?? [];
  const enough = def ? Object.entries(def.cost).every(([item, n]) => items.filter((i) => i === item).length >= n) : false;
  // Vật cản cho mảnh lắp ghép: cây, nhà kiểu cũ (đúng như server kiểm tra).
  const obstacles = useMemo(
    () => [
      ...blocked.map((t) => ({ x: t.x, z: t.z, r: 0.3 })),
      ...records
        .filter((b) => !worldCatalog.buildings.get(b.kind)?.snap)
        .map((b) => ({ x: camp.x + b.dx, z: camp.z + b.dz, r: (worldCatalog.buildings.get(b.kind)?.size[0] ?? 3) / 2 })),
    ],
    [blocked, records, camp.x, camp.z],
  );
  if (def?.snap) return <SnapGhost world={world} camp={camp} kind={kind} snap={def.snap} buildings={records} obstacles={obstacles} enough={enough} />;
  return <FreeGhost world={world} camp={camp} buildings={buildings} blocked={blocked} kind={kind} enough={enough} />;
}

/** Công trình đặt tự do kiểu cũ (chòi lá, nhà sàn, hàng rào). */
function FreeGhost({
  world,
  camp,
  buildings,
  blocked,
  kind,
  enough,
}: {
  world: World;
  camp: { x: number; z: number; packed: boolean };
  buildings: { x: number; z: number }[];
  blocked: { x: number; z: number }[];
  kind: string;
  enough: boolean;
}) {
  const group = useRef<Group>(null);
  const def = worldCatalog.buildings.get(kind);

  useFrame(() => {
    const g = group.current;
    if (!g || !def) return;
    // Đặt trước mặt theo hướng camera, cách chừng 4,5 m.
    const x = localPosition.x - Math.sin(look.yaw) * 4.5;
    const z = localPosition.z - Math.cos(look.yaw) * 4.5;
    const rot = look.yaw + buildGhost.turn;
    const y = world.heightAt(x, z);
    const fromCamp = Math.hypot(x - camp.x, z - camp.z);
    const clear = buildings.every((b) => Math.hypot(b.x - x, b.z - z) > 2.4 + def.size[0] / 2 - 1.5) && blocked.every((t) => Math.hypot(t.x - x, t.z - z) > def.size[0] / 2 + 0.3);
    const ok = enough && !camp.packed && y > 0.4 && !world.structureAt(x, z) && fromCamp <= BUILD_RADIUS && fromCamp >= 3.5 && clear;
    Object.assign(buildGhost, { x, z, rot, ok, kind, level: 0 });
    g.position.set(x, y, z);
    g.rotation.y = rot;
    if (getHud().buildOk !== ok) setHud({ buildOk: ok });
    g.traverse((o) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (m && "color" in m) m.color.set(ok ? "#6dff8a" : "#ff5a4a");
    });
  });
  if (!def) return null;
  return (
    <group ref={group}>
      <BuildingModel kind={kind} ghost="#6dff8a" />
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[def.size[0] / 2 - 0.1, def.size[0] / 2, 24]} />
        <meshBasicMaterial color="#6dff8a" transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Camp({ room, world }: { room: IslandRoom; world: World }) {
  const camp = useRoomSnapshot(room, (s) => ({ x: s.campX, z: s.campZ, packed: s.campPacked }));
  const buildings = useRoomSnapshot(room, (s) => [...s.buildings.entries()].map(([id, b]) => ({ id, kind: b.kind, dx: b.dx, dz: b.dz, rot: b.rot, level: b.level })));
  const stumps = useRoomSnapshot(room, (s) => [...s.stumps].join(","));
  const plants = useRoomSnapshot(room, (s) => [...s.plants.values()].map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) })));
  const building = useHud().build;
  const ground = world.heightAt(camp.x, camp.z);
  const placed = buildings.map((b) => ({ ...b, x: camp.x + b.dx, z: camp.z + b.dz }));
  // Công trình kiểu cũ đặt tự do; mảnh lắp ghép (sàn, vách, cầu thang, tháp canh) vẽ riêng theo lưới.
  const free = placed.filter((b) => !worldCatalog.buildings.get(b.kind)?.snap);
  const blocked = useMemo(() => {
    const felled = new Set(stumps.split(","));
    return [...world.trees.filter((t) => !felled.has(t.id)), ...plants];
  }, [world, stumps, plants]);
  const tents = [
    { x: camp.x - 7, z: camp.z - 4, rot: 0.6, color: "#c9a36a" },
    { x: camp.x + 7.5, z: camp.z - 2, rot: -0.8, color: "#7b8f5a" },
  ];

  return (
    <>
      {!camp.packed && (
        <>
          <Campfire x={camp.x} z={camp.z} ground={ground} />
          {tents.map((t, i) => (
            <Tent key={i} x={t.x} y={world.heightAt(t.x, t.z)} z={t.z} rot={t.rot} color={t.color} />
          ))}
          <SnapPieces world={world} camp={camp} buildings={buildings} />
          {free.map((b) => (
            <group key={b.id} position={[b.x, world.heightAt(b.x, b.z), b.z]} rotation-y={b.rot}>
              <BuildingModel kind={b.kind} />
              <RigidBody type="fixed" colliders={false}>
                <BuildingCollider kind={b.kind} />
              </RigidBody>
            </group>
          ))}
        </>
      )}
      {camp.packed && (
        // Chỗ trại cũ chỉ còn vết tro.
        <mesh rotation-x={-Math.PI / 2} position={[camp.x, ground + 0.03, camp.z]}>
          <circleGeometry args={[1.1, 10]} />
          <meshStandardMaterial color="#2b2622" />
        </mesh>
      )}
      {building && <BuildGhost world={world} camp={camp} buildings={placed} blocked={blocked} records={buildings} />}
    </>
  );
}
