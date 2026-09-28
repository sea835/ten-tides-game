import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type Group,
  type InstancedMesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CLIMBABLE_GROWTH, type Tree, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useFx } from "./fxStore.ts";
import { grain, mulberry32, swayMaterial } from "./nature.ts";
import { detailed } from "./textures.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";

// Cây leo được, chặt được: dừa và cây rừng tán rộng của bản đồ (trừ cây đã bị đốn, chỉ còn gốc),
// cộng cây mới trồng lớn dần. Cây bị đốn thì đổ rạp xuống theo hướng nhát chặt cuối.

/** Độ cong của thân dừa ở độ cao t (0 gốc, 1 ngọn), tính theo bề ngang. */
const TRUNK_BEND = 0.9;
export const bend = (t: number) => TRUNK_BEND * t * t;

function buildTrunk(): BufferGeometry {
  const g = new CylinderGeometry(0.17, 0.3, 1, 6, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    p.setX(i, p.getX(i) + bend(t));
    // Gờ vòng trên thân dừa.
    const ring = 1 + 0.08 * Math.abs(Math.sin(t * 40));
    p.setX(i, bend(t) + (p.getX(i) - bend(t)) * ring);
    p.setZ(i, p.getZ(i) * ring);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/** Tán dừa: 8 tàu lá rủ xuống (mỗi tàu là một dải có lá hai bên) và chùm dừa. */
function buildCrown(): { leaves: BufferGeometry; nuts: BufferGeometry } {
  const fronds: BufferGeometry[] = [];
  const count = 8;
  for (let f = 0; f < count; f++) {
    const angle = (f / count) * Math.PI * 2 + (f % 2) * 0.2;
    const length = 3 + (f % 3) * 0.35;
    const steps = 6;
    const verts: number[] = [];
    const point = (s: number, side: number) => {
      const along = s * length;
      const droop = -0.9 * s * s * length * 0.45 + 0.35 * s;
      const width = Math.sin(Math.PI * Math.min(1, s * 1.1)) * 0.55 * side;
      const x = Math.cos(angle) * along - Math.sin(angle) * width;
      const z = Math.sin(angle) * along + Math.cos(angle) * width;
      // Mép lá thấp hơn sống lá một chút cho thành hình chữ V.
      return [x, droop - Math.abs(width) * 0.35, z];
    };
    for (let i = 0; i < steps; i++) {
      const s0 = i / steps;
      const s1 = (i + 1) / steps;
      for (const side of [-1, 1]) {
        const a = point(s0, 0);
        const b = point(s1, 0);
        const c = point(s1, side);
        const d = point(s0, side);
        verts.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    g.computeVertexNormals();
    fronds.push(g);
  }
  const leaves = mergeGeometries(fronds)!;
  const nutParts = [0, 1, 2].map((i) => {
    const s = new SphereGeometry(0.2, 5, 4);
    const a = (i / 3) * Math.PI * 2;
    s.translate(Math.cos(a) * 0.22, -0.25, Math.sin(a) * 0.22);
    return s.toNonIndexed();
  });
  const nuts = mergeGeometries(nutParts)!;
  nuts.computeVertexNormals();
  return { leaves, nuts };
}

/** Tán cây rừng: bốn khối lá lớn chồng lệch nhau quanh ngọn thân. */
function canopy(): BufferGeometry {
  const parts = [
    [0, 0, 0, 2.2],
    [1.5, -0.4, 0.4, 1.6],
    [-1.3, -0.3, -0.6, 1.7],
    [0.2, 0.9, -0.3, 1.5],
  ].map(([x, y, z, r]) => new IcosahedronGeometry(r!, 0).translate(x!, y!, z!));
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Dáng cố định của từng cây (theo id, nên chặt cây này không làm cây khác đổi dáng). */
function pose(tree: { id: string; x: number; z: number; kind: string }) {
  const rand = mulberry32(hashId(tree.id));
  const yaw = tree.kind === "palm" ? -Math.atan2(tree.z, tree.x) + (rand() - 0.5) * 0.8 : rand() * Math.PI * 2;
  return { yaw, tilt: [(rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25] as const, hue: rand(), sat: rand(), light: rand() };
}

/** Cây đang đứng mà người chơi leo được (cây của bản đồ chưa bị đốn và cây trồng đủ lớn). */
export interface ClimbTree {
  id: string;
  kind: string;
  x: number;
  /** Mặt đất ở gốc. */
  y: number;
  z: number;
  height: number;
  /** Độ lệch ngang của ngọn so với gốc (dừa cong, cây rừng thẳng). */
  sway: number;
  yaw: number;
}

/** Cây của bản đồ (tính một lần cho mỗi thế giới và mỗi lần có cây bị đốn, vì độ cao địa hình tính khá tốn). */
let standingCache: { world: World | null; key: string; trees: ClimbTree[] } = { world: null, key: "", trees: [] };

export function climbTrees(room: IslandRoom, world: World): ClimbTree[] {
  const key = room.state.stumps.join(",");
  if (standingCache.world !== world || standingCache.key !== key) {
    const felled = new Set(room.state.stumps);
    const trees: ClimbTree[] = [];
    for (const t of world.trees) {
      if (felled.has(t.id)) continue;
      const palmy = t.kind === "palm";
      trees.push({ id: t.id, kind: t.kind, x: t.x, y: world.heightAt(t.x, t.z), z: t.z, height: t.height, sway: palmy ? 1 + (t.lean + 0.25) * 0.3 : 0, yaw: pose(t).yaw });
    }
    standingCache = { world, key, trees };
  }
  const out = [...standingCache.trees];
  for (const [id, p] of room.state.plants) {
    if (p.growth < CLIMBABLE_GROWTH) continue;
    const palmy = p.kind === "palm";
    const yaw = pose({ id, kind: p.kind, x: p.x, z: p.z }).yaw;
    out.push({ id, kind: p.kind, x: p.x, y: p.y, z: p.z, height: (palmy ? 7 : 5.5) * p.growth, sway: palmy ? (1 + 0.35 * 0.3) * p.growth : 0, yaw });
  }
  return out;
}

/** Tâm thân cây ở độ cao `h` tính từ gốc (thân dừa cong dần về một phía). */
export function trunkAt(tree: ClimbTree, h: number): { x: number; z: number } {
  const off = tree.sway * bend(Math.min(1, Math.max(0, h / tree.height)));
  return { x: tree.x + off * Math.cos(tree.yaw), z: tree.z - off * Math.sin(tree.yaw) };
}

/** Leo tới đâu thì hết: dừa tới dưới tán lá, cây rừng tới chạc cây. */
export function climbTop(tree: ClimbTree): number {
  return tree.kind === "palm" ? tree.height - 1.1 : tree.height * 0.72;
}

const palm = { trunk: buildTrunk(), ...buildCrown() };
const shared = {
  trunk: new CylinderGeometry(0.22, 0.38, 1, 7).translate(0, 0.5, 0),
  canopy: canopy(),
  stump: new CylinderGeometry(0.28, 0.36, 0.45, 7).translate(0, 0.2, 0),
};
const mats = {
  palmTrunk: detailed(swayMaterial({ color: "#8b6b43", flatShading: true, roughness: 1 }, 0.004), "bark"),
  palmLeaves: detailed(swayMaterial({ color: "#3f9a3c", flatShading: true, side: DoubleSide, roughness: 0.8 }, 0.035, -2), "leaf"),
  nuts: detailed(new MeshStandardMaterial({ color: "#5a4020", flatShading: true }), "fur"),
  trunk: detailed(new MeshStandardMaterial({ flatShading: true, roughness: 1 }), "bark"),
  canopy: detailed(swayMaterial({ flatShading: true, roughness: 0.9 }, 0.004, 1), "leaf"),
  stump: detailed(new MeshStandardMaterial({ color: "#7a5a38", flatShading: true, roughness: 1 }), "wood"),
  leaf: detailed(new MeshStandardMaterial({ color: "#4f9a3c", flatShading: true, roughness: 0.9 }), "leaf"),
  bark: detailed(new MeshStandardMaterial({ color: "#5a4028", flatShading: true, roughness: 1 }), "bark"),
};

interface TreeLike {
  id: string;
  kind: string;
  x: number;
  z: number;
  height: number;
  lean: number;
}

/** Ma trận thân và tán của một cây dừa, co giãn theo `scale` (cây non nhỏ hơn). */
function palmMatrices(tree: TreeLike, ground: number, scale: number) {
  const dummy = new Object3D();
  const p = pose(tree);
  const lean = tree.lean + 0.25;
  dummy.position.set(tree.x, ground - 0.1, tree.z);
  dummy.rotation.set(0, p.yaw, 0);
  dummy.scale.set((1 + lean * 0.3) * scale, tree.height * scale, (1 + lean * 0.3) * scale);
  dummy.updateMatrix();
  const trunk = dummy.matrix.clone();
  const top = new Vector3(bend(1), 1, 0).applyMatrix4(dummy.matrix);
  dummy.position.copy(top);
  dummy.rotation.set(p.tilt[0], p.tilt[1], p.tilt[2]);
  const s = (0.85 + (tree.height - 6) / 10) * scale;
  dummy.scale.set(s, s, s);
  dummy.updateMatrix();
  return { trunk, crown: dummy.matrix.clone(), p };
}

function PalmForest({ trees, world }: { trees: Tree[]; world: World }) {
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const nuts = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!trunks.current || !crowns.current || !nuts.current) return;
    const color = new Color();
    trees.forEach((tree, i) => {
      const m = palmMatrices(tree, world.heightAt(tree.x, tree.z), 1);
      trunks.current!.setMatrixAt(i, m.trunk);
      crowns.current!.setMatrixAt(i, m.crown);
      nuts.current!.setMatrixAt(i, m.crown);
      crowns.current!.setColorAt(i, color.setHSL(0.28 + m.p.hue * 0.05, 0.5 + m.p.sat * 0.15, 0.3 + m.p.light * 0.08));
    });
    for (const m of [trunks, crowns, nuts]) {
      m.current!.instanceMatrix.needsUpdate = true;
      m.current!.computeBoundingSphere();
    }
    if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true;
  }, [trees, world]);
  if (trees.length === 0) return null;
  return (
    <group key={trees.length}>
      <instancedMesh ref={trunks} args={[palm.trunk, mats.palmTrunk, trees.length]} castShadow receiveShadow />
      <instancedMesh ref={crowns} args={[palm.leaves, mats.palmLeaves, trees.length]} castShadow />
      <instancedMesh ref={nuts} args={[palm.nuts, mats.nuts, trees.length]} />
    </group>
  );
}

function BroadleafForest({ trees, world }: { trees: Tree[]; world: World }) {
  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!trunks.current || !canopies.current) return;
    const dummy = new Object3D();
    const color = new Color();
    trees.forEach((t, i) => {
      const ground = world.heightAt(t.x, t.z);
      const p = pose(t);
      dummy.position.set(t.x, ground, t.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(t.lean, t.height, t.lean);
      dummy.updateMatrix();
      trunks.current!.setMatrixAt(i, dummy.matrix);
      trunks.current!.setColorAt(i, color.setHSL(0.07, 0.35, 0.22 + grain(i, 15) * 0.06));
      dummy.position.set(t.x, ground + t.height * 0.95, t.z);
      dummy.scale.setScalar(t.lean);
      dummy.updateMatrix();
      canopies.current!.setMatrixAt(i, dummy.matrix);
      canopies.current!.setColorAt(i, color.setHSL(0.27 + p.hue * 0.06, 0.45, 0.2 + p.light * 0.07));
    });
    for (const m of [trunks, canopies]) {
      m.current!.instanceMatrix.needsUpdate = true;
      if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true;
      m.current!.computeBoundingSphere();
    }
  }, [trees, world]);
  if (trees.length === 0) return null;
  return (
    <group key={trees.length}>
      <instancedMesh ref={trunks} args={[shared.trunk, mats.trunk, trees.length]} castShadow receiveShadow />
      <instancedMesh ref={canopies} args={[shared.canopy, mats.canopy, trees.length]} castShadow />
    </group>
  );
}

interface PlantView {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  growth: number;
}

function Matrixed({ geometry, material, matrix }: { geometry: BufferGeometry; material: MeshStandardMaterial; matrix: Matrix4 }) {
  return <mesh geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false} castShadow />;
}

/** Cây mới trồng: nhú mầm rồi lớn dần thành cây. */
function Planted({ plant }: { plant: PlantView }) {
  const g = Math.max(0.12, plant.growth);
  if (plant.kind === "palm") {
    const m = palmMatrices({ id: plant.id, kind: "palm", x: plant.x, z: plant.z, height: 7, lean: 0.1 }, plant.y, g);
    return (
      <group>
        <Matrixed geometry={palm.trunk} material={mats.palmTrunk} matrix={m.trunk} />
        <Matrixed geometry={palm.leaves} material={mats.palmLeaves} matrix={m.crown} />
      </group>
    );
  }
  const h = 5.5 * g;
  return (
    <group position={[plant.x, plant.y, plant.z]}>
      <mesh geometry={shared.trunk} material={mats.bark} scale={[g, h, g]} castShadow />
      <mesh geometry={shared.canopy} material={mats.leaf} position-y={h * 0.95} scale={g} castShadow />
    </group>
  );
}

interface FallingTree extends TreeLike {
  y: number;
}

/** Cây đang đổ: xoay quanh gốc theo hướng nhát chặt cuối, rơi nhanh dần, nảy nhẹ rồi lún mất. */
function Falling({ tree, dir, onDone }: { tree: FallingTree; dir: number; onDone: () => void }) {
  const pivot = useRef<Group>(null);
  const start = useRef(-1);
  const done = useRef(false);
  useFrame(({ clock }) => {
    const g = pivot.current;
    if (!g) return;
    if (start.current < 0) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const fall = Math.min(1, (t / 1.1) ** 2);
    const bounce = t > 1.1 ? Math.sin((t - 1.1) * 12) * 0.06 * Math.max(0, 1 - (t - 1.1) * 2) : 0;
    g.rotation.x = fall * 1.5 - bounce;
    g.position.y = -Math.max(0, t - 2.2) * 0.8;
    if (t > 3.2 && !done.current) {
      done.current = true;
      onDone();
    }
  });
  const m = tree.kind === "palm" ? palmMatrices({ ...tree, x: 0, z: 0 }, 0, 1) : null;
  return (
    <group position={[tree.x, tree.y, tree.z]} rotation-y={dir}>
      <group ref={pivot}>
        {m ? (
          <group rotation-y={-dir}>
            <Matrixed geometry={palm.trunk} material={mats.palmTrunk} matrix={m.trunk} />
            <Matrixed geometry={palm.leaves} material={mats.palmLeaves} matrix={m.crown} />
          </group>
        ) : (
          <>
            <mesh geometry={shared.trunk} material={mats.bark} scale={[tree.lean, tree.height, tree.lean]} castShadow />
            <mesh geometry={shared.canopy} material={mats.leaf} position-y={tree.height * 0.95} scale={tree.lean} castShadow />
          </>
        )}
      </group>
    </group>
  );
}

export function Trees({ room, world }: { room: IslandRoom; world: World }) {
  const stumpKey = useRoomSnapshot(room, (s) => [...s.stumps].join(","));
  const plants = useRoomSnapshot(room, (s) =>
    [...s.plants.entries()].map(([id, p]) => ({ id, kind: p.kind, x: p.x, y: p.y, z: p.z, growth: Math.round(p.growth * 25) / 25 })),
  );
  const felled = useMemo(() => new Set(stumpKey.split(",").filter(Boolean)), [stumpKey]);
  const palms = useMemo(() => world.trees.filter((t) => t.kind === "palm" && !felled.has(t.id)), [world, felled]);
  const broad = useMemo(() => world.trees.filter((t) => t.kind === "broadleaf" && !felled.has(t.id)), [world, felled]);
  const stumps = useMemo(() => world.trees.filter((t) => felled.has(t.id)), [world, felled]);
  const [falling, setFalling] = useState<{ key: number; tree: FallingTree; dir: number }[]>([]);
  const lastPlants = useRef(plants);
  lastPlants.current = plants;

  useFx((fx) => {
    if (fx.kind !== "fell" || !fx.treeId) return;
    const t = world.trees.find((x) => x.id === fx.treeId);
    const planted = lastPlants.current.find((p) => p.id === fx.treeId);
    const growth = planted?.growth ?? 0.6;
    const tree: FallingTree = t
      ? { ...t, y: world.heightAt(t.x, t.z) }
      : { id: fx.treeId, kind: planted?.kind ?? "broadleaf", x: fx.x, y: fx.y, z: fx.z, height: (planted?.kind === "palm" ? 7 : 5.5) * growth, lean: growth };
    setFalling((list) => [...list, { key: performance.now() + Math.random(), tree, dir: fx.dir ?? 0 }]);
  });

  const colliders = useMemo(
    () => [
      ...[...palms, ...broad].map((t) => ({ id: t.id, x: t.x, z: t.z, y: world.heightAt(t.x, t.z), h: t.height, r: t.kind === "palm" ? 0.3 : 0.35 * t.lean })),
      ...plants.filter((p) => p.growth >= 0.3).map((p) => ({ id: p.id, x: p.x, z: p.z, y: p.y, h: 5 * p.growth, r: 0.3 * p.growth })),
    ],
    [palms, broad, plants, world],
  );

  return (
    <>
      <PalmForest trees={palms} world={world} />
      <BroadleafForest trees={broad} world={world} />
      {stumps.map((t) => (
        <mesh key={t.id} geometry={shared.stump} material={mats.stump} position={[t.x, world.heightAt(t.x, t.z) - 0.05, t.z]} scale={t.kind === "palm" ? 0.8 : t.lean} castShadow receiveShadow />
      ))}
      {plants.map((p) => (
        <Planted key={p.id} plant={p} />
      ))}
      {falling.map((f) => (
        <Falling key={f.key} tree={f.tree} dir={f.dir} onDone={() => setFalling((list) => list.filter((x) => x.key !== f.key))} />
      ))}
      <RigidBody type="fixed" colliders={false}>
        {colliders.map((c) => (
          <CylinderCollider key={c.id} args={[c.h / 2, c.r]} position={[c.x, c.y + c.h / 2, c.z]} />
        ))}
      </RigidBody>
    </>
  );
}
