import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type Group,
  type InstancedMesh,
  type Mesh,
  type PointLight,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CAMP, CAVE, MAP_HALF_SIZE, VOLCANO, WATER_LEVEL, heightAt, shoreRadius, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { sky } from "./shared.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { Vegetation } from "./Vegetation.tsx";
import { Water } from "./Water.tsx";
import { WindClock, grain, mulberry32, patch, swayMaterial } from "./nature.ts";
import { Structures } from "./Structures.tsx";
import { Points } from "./Points.tsx";
import { Wildlife } from "./Wildlife.tsx";
import { SeaLife } from "./SeaLife.tsx";

// ---------------------------------------------------------------------------
// Địa hình
// ---------------------------------------------------------------------------

/** Địa hình chia thành từng ô vuông cạnh chừng này mét (để camera cắt bớt phần ngoài tầm nhìn). */
const CHUNK = 48;
/** Độ mịn: ô có đất liền hay đáy nông thì 2 m một đỉnh; ô toàn biển sâu thì 6 m (6 chia hết cho 2 nên mép khớp nhau). */
const FINE = 2;
const COARSE = 6;

const C = {
  deepBed: new Color("#1f5a66"),
  bed: new Color("#cdb98a"),
  reefBed: new Color("#d9a38f"),
  wetSand: new Color("#d2b57c"),
  sand: new Color("#f2dea8"),
  blackSand: new Color("#3d3a3b"),
  blackWet: new Color("#2a2829"),
  grassLight: new Color("#9ccb67"),
  grass: new Color("#72b04f"),
  forest: new Color("#4f8e3f"),
  forestDark: new Color("#3a7131"),
  rock: new Color("#8f8a84"),
  rockDark: new Color("#6b6661"),
  ash: new Color("#6b625c"),
  lava: new Color("#c8401f"),
  straw: new Color("#a9a45a"),
  dirt: new Color("#7a6a55"),
};

function faceColor(world: World, out: Color, x: number, z: number, h: number, slope: number) {
  const surf = world.surface(x, z);
  const inland = surf.inland;
  const n = patch(x, z);
  const islet = surf.islet && surf.inland > -30 ? surf.islet : null;
  const volcanic = islet?.kind === "volcanic";
  if (!islet && Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.craterRadius + 1) return out.copy(C.lava);
  if (h < WATER_LEVEL - 0.3) {
    const bed = surf.reef ? C.reefBed : volcanic ? C.blackWet : C.bed;
    return out.copy(bed).lerp(C.deepBed, Math.min(1, (WATER_LEVEL - h) / (surf.reef ? 9 : 7)));
  }
  if (h < WATER_LEVEL + 0.35) return out.copy(volcanic ? C.blackWet : C.wetSand);
  // Sàn trong lòng hang, hầm và sân trước cửa: đất nện lẫn đá vụn.
  if (surf.pad || world.structureAt(x, z)) return out.copy(C.dirt).lerp(C.rockDark, 0.3 + 0.3 * grain(x, z));
  // Dốc đứng thì lộ đá, bất kể vùng nào.
  if (slope > 0.55 && h > 2) return out.copy(C.rockDark).lerp(C.rock, grain(x, z));
  if (islet) {
    switch (islet.kind) {
      case "volcanic":
        return h > 4 ? out.copy(C.ash).lerp(C.rockDark, Math.max(0, n) * 0.6) : out.copy(C.blackSand).lerp(C.ash, Math.max(0, n) * 0.5);
      case "rocky":
        if (h > 3 || n > 0.3) return out.copy(C.rock).lerp(C.rockDark, 0.5 + 0.5 * n);
        return inland < 4 ? out.copy(C.sand).lerp(C.rock, 0.4) : out.copy(C.grassLight).lerp(C.rock, 0.35);
      case "sandbar":
      case "atoll":
        return inland < 6 + n * 2 ? out.copy(C.sand) : out.copy(C.sand).lerp(C.grassLight, 0.5 + 0.3 * n);
      case "jungle":
        if (inland < 4 + n * 1.5) return out.copy(C.sand).lerp(C.wetSand, Math.max(0, 1 - inland / 2) * 0.8);
        if (inland < 7) return out.copy(C.sand).lerp(C.grassLight, (inland - 4) / 3);
        return out.copy(C.grass).lerp(C.forest, 0.5 + 0.5 * n);
    }
  }
  if (world.zoneAt(x, z) === "volcano" && h > 6) return out.copy(C.ash).lerp(C.rockDark, Math.max(0, n) * 0.6);
  if (h > 8) return out.copy(C.rock).lerp(C.rockDark, 0.5 + 0.5 * n);
  if (inland < 12 + n * 3) return out.copy(C.sand).lerp(C.wetSand, Math.max(0, 1 - inland / 4) * 0.8);
  if (inland < 16) return out.copy(C.sand).lerp(C.grassLight, (inland - 12) / 4);
  if (inland < 40) out.copy(C.grass).lerp(C.forest, 0.5 + 0.5 * n);
  else out.copy(C.forest).lerp(n > 0.2 ? C.forestDark : C.grassLight, Math.abs(n) * 0.8);
  // Nền dưới đám cỏ tranh ngả màu rơm.
  for (const p of world.tallGrass) {
    const d = Math.hypot(p.x - x, p.z - z) / p.radius;
    if (d < 1.2) out.lerp(C.straw, 0.55 * Math.min(1, (1.2 - d) * 2));
  }
  return out;
}

interface TerrainChunk {
  geometry: BufferGeometry;
  colliderVertices: Float32Array;
  colliderIndices: Uint32Array;
}

/**
 * Dựng địa hình từ world.heightAt() theo từng ô: ô có đất hay đáy nông dùng lưới mịn, ô toàn biển sâu dùng lưới thưa.
 * Mép ô mịn giáp ô thưa được nắn thẳng theo ô thưa để không hở khe. Mỗi ô có bản chỉ số cho va chạm
 * và bản tách mặt để tô màu phẳng kiểu low-poly.
 */
function buildTerrain(world: World): TerrainChunk[] {
  const count = (MAP_HALF_SIZE * 2) / CHUNK;
  const origin = -MAP_HALF_SIZE;
  // Ô nào toàn biển sâu (lấy mẫu dày theo lưới thưa, cả mép).
  const coarse: boolean[][] = [];
  for (let cx = 0; cx < count; cx++) {
    coarse.push([]);
    for (let cz = 0; cz < count; cz++) {
      let deep = true;
      for (let i = 0; i <= CHUNK / FINE && deep; i += 1) {
        for (let j = 0; j <= CHUNK / FINE && deep; j += 1) {
          if (world.heightAt(origin + cx * CHUNK + i * FINE, origin + cz * CHUNK + j * FINE) > -7) deep = false;
        }
      }
      coarse[cx]!.push(deep);
    }
  }
  const isCoarse = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < count && cz < count && coarse[cx]![cz]!;

  const chunks: TerrainChunk[] = [];
  const tint = new Color();
  for (let cx = 0; cx < count; cx++) {
    for (let cz = 0; cz < count; cz++) {
      const step = coarse[cx]![cz] ? COARSE : FINE;
      const cells = CHUNK / step;
      const x0 = origin + cx * CHUNK;
      const z0 = origin + cz * CHUNK;
      const verts = new Float32Array((cells + 1) * (cells + 1) * 3);
      const heightOn = (x: number, z: number) => world.heightAt(x, z);
      for (let j = 0; j <= cells; j++) {
        for (let i = 0; i <= cells; i++) {
          const x = x0 + i * step;
          const z = z0 + j * step;
          let y = heightOn(x, z);
          // Mép giáp ô thưa: lấy nội suy giữa hai đỉnh của ô thưa để hai bên khớp nhau.
          if (step === FINE) {
            const snap = (t: number, a: [number, number], b: [number, number]) => {
              const k = (t % COARSE) / COARSE;
              return k === 0 ? heightOn(...a) : heightOn(...a) * (1 - k) + heightOn(...b) * k;
            };
            const tx = i * FINE;
            const tz = j * FINE;
            const floorX = x0 + Math.floor(tx / COARSE) * COARSE;
            const floorZ = z0 + Math.floor(tz / COARSE) * COARSE;
            if ((i === 0 && isCoarse(cx - 1, cz)) || (i === cells && isCoarse(cx + 1, cz))) y = snap(tz, [x, floorZ], [x, floorZ + COARSE]);
            else if ((j === 0 && isCoarse(cx, cz - 1)) || (j === cells && isCoarse(cx, cz + 1))) y = snap(tx, [floorX, z], [floorX + COARSE, z]);
          }
          verts.set([x, y, z], (j * (cells + 1) + i) * 3);
        }
      }
      const indices = new Uint32Array(cells * cells * 6);
      let k = 0;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const a = j * (cells + 1) + i;
          const b = a + 1;
          const c = a + (cells + 1);
          const d = c + 1;
          indices.set([a, c, b, b, c, d], k);
          k += 6;
        }
      }
      const grid = new BufferGeometry();
      grid.setAttribute("position", new BufferAttribute(verts, 3));
      grid.setIndex(new BufferAttribute(indices, 1));
      const flat = grid.toNonIndexed();
      flat.computeVertexNormals();
      const fpos = flat.attributes.position!;
      const fnorm = flat.attributes.normal!;
      const colors = new Float32Array(fpos.count * 3);
      for (let v = 0; v < fpos.count; v += 3) {
        const fx = (fpos.getX(v) + fpos.getX(v + 1) + fpos.getX(v + 2)) / 3;
        const fy = (fpos.getY(v) + fpos.getY(v + 1) + fpos.getY(v + 2)) / 3;
        const fz = (fpos.getZ(v) + fpos.getZ(v + 1) + fpos.getZ(v + 2)) / 3;
        faceColor(world, tint, fx, fz, fy, 1 - Math.abs(fnorm.getY(v)));
        // Lệch màu nhẹ từng mặt cho ra chất low-poly.
        tint.multiplyScalar(0.93 + 0.1 * grain(fx, fz));
        for (let q = 0; q < 3; q++) tint.toArray(colors, (v + q) * 3);
      }
      flat.setAttribute("color", new BufferAttribute(colors, 3));
      flat.computeBoundingSphere();
      grid.dispose();
      chunks.push({ geometry: flat, colliderVertices: verts, colliderIndices: indices });
    }
  }
  return chunks;
}

function Terrain({ world }: { world: World }) {
  const chunks = useMemo(() => buildTerrain(world), [world]);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }), []);
  useEffect(() => () => chunks.forEach((c) => c.geometry.dispose()), [chunks]);
  return (
    <RigidBody type="fixed" colliders={false}>
      {chunks.map((c, i) => (
        <group key={i}>
          <TrimeshCollider args={[c.colliderVertices, c.colliderIndices]} />
          <mesh geometry={c.geometry} material={material} receiveShadow />
        </group>
      ))}
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Rừng dừa
// ---------------------------------------------------------------------------

/** Độ cong của thân dừa ở độ cao t (0 gốc, 1 ngọn), tính theo bề ngang. */
const TRUNK_BEND = 0.9;
const bend = (t: number) => TRUNK_BEND * t * t;

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

function Palms({ world }: { world: World }) {
  const palms = world.palms;
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const nuts = useRef<InstancedMesh>(null);
  const geo = useMemo(() => ({ trunk: buildTrunk(), ...buildCrown() }), []);
  const mats = useMemo(
    () => ({
      trunk: swayMaterial({ color: "#8b6b43", flatShading: true, roughness: 1 }, 0.004),
      leaves: swayMaterial({ color: "#3f9a3c", flatShading: true, side: DoubleSide, roughness: 0.8 }, 0.035, -2),
      nuts: new MeshStandardMaterial({ color: "#5a4020", flatShading: true }),
    }),
    [],
  );

  useLayoutEffect(() => {
    const dummy = new Object3D();
    const top = new Vector3();
    const rand = mulberry32(7);
    const leafColor = new Color();
    palms.forEach((palm, i) => {
      const ground = world.heightAt(palm.x, palm.z);
      // Hướng nghiêng: dừa ven biển hay ngả ra phía biển.
      const seaward = Math.atan2(palm.z, palm.x);
      const lean = palm.lean + 0.25;
      dummy.position.set(palm.x, ground - 0.1, palm.z);
      dummy.rotation.set(0, -seaward + (rand() - 0.5) * 0.8, 0);
      dummy.scale.set(1 + lean * 0.3, palm.height, 1 + lean * 0.3);
      dummy.updateMatrix();
      trunks.current!.setMatrixAt(i, dummy.matrix);

      top.set(bend(1), 1, 0).applyMatrix4(dummy.matrix);
      dummy.position.copy(top);
      dummy.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25);
      const s = 0.85 + (palm.height - 6) / 10;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      crowns.current!.setMatrixAt(i, dummy.matrix);
      nuts.current!.setMatrixAt(i, dummy.matrix);
      crowns.current!.setColorAt(i, leafColor.setHSL(0.28 + rand() * 0.05, 0.5 + rand() * 0.15, 0.3 + rand() * 0.08));
    });
    for (const m of [trunks, crowns, nuts]) m.current!.instanceMatrix.needsUpdate = true;
    if (crowns.current!.instanceColor) crowns.current!.instanceColor.needsUpdate = true;
  }, [palms, world]);

  return (
    <>
      <instancedMesh ref={trunks} args={[geo.trunk, mats.trunk, palms.length]} castShadow receiveShadow />
      <instancedMesh ref={crowns} args={[geo.leaves, mats.leaves, palms.length]} castShadow />
      <instancedMesh ref={nuts} args={[geo.nuts, mats.nuts, palms.length]} />
      <RigidBody type="fixed" colliders={false}>
        {palms.map((palm, i) => (
          <CylinderCollider key={i} args={[palm.height / 2, 0.3]} position={[palm.x, world.heightAt(palm.x, palm.z) + palm.height / 2, palm.z]} />
        ))}
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hang động: va chạm vẫn là khối hộp, phần nhìn thấy là đá lởm chởm phủ ngoài.
// ---------------------------------------------------------------------------

interface Block {
  size: [number, number, number];
  at: [number, number, number];
}

/** Khối hộp chia nhỏ rồi xô lệch đỉnh (theo vị trí thế giới, nên các cạnh chung vẫn khép kín). */
function rockBlock(size: [number, number, number], at: [number, number, number]): BufferGeometry {
  const seg = (n: number) => Math.max(1, Math.round(n / 1.2));
  const g = new BoxGeometry(size[0], size[1], size[2], seg(size[0]), seg(size[1]), seg(size[2]));
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i) + at[0];
    const wy = p.getY(i) + at[1];
    const wz = p.getZ(i) + at[2];
    const j = 0.28;
    p.setXYZ(i, p.getX(i) + (grain(wx, wy + wz) - 0.5) * j, p.getY(i) + (grain(wy, wx - wz) - 0.5) * j, p.getZ(i) + (grain(wz, wx + wy) - 0.5) * j);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

function Cave() {
  const floor = 3;
  const height = 4.5;
  const blocks: Block[] = [
    { size: [1.5, height, 14], at: [CAVE.x - 5.5, floor + height / 2, CAVE.z - 2] },
    { size: [1.5, height, 14], at: [CAVE.x + 5.5, floor + height / 2, CAVE.z - 2] },
    { size: [12.5, height, 1.5], at: [CAVE.x, floor + height / 2, CAVE.z - 9] },
    { size: [12.5, 1.5, 15.5], at: [CAVE.x, floor + height + 0.75, CAVE.z - 2] },
    { size: [6, height, 1], at: [CAVE.x - 1.5, floor + height / 2, CAVE.z - 3] },
    { size: [3.5, height, 1.5], at: [CAVE.x - 3.5, floor + height / 2, CAVE.z + 5] },
    { size: [3.5, height, 1.5], at: [CAVE.x + 3.5, floor + height / 2, CAVE.z + 5] },
  ];
  const geometries = useMemo(() => blocks.map((b) => rockBlock([b.size[0] + 0.2, b.size[1] + 0.1, b.size[2] + 0.2], b.at)), []);
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        {blocks.map((b, i) => (
          <group key={i} position={b.at}>
            <CuboidCollider args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]} />
            <mesh geometry={geometries[i]} castShadow receiveShadow>
              <meshStandardMaterial color={i === 3 ? "#5f5a55" : "#716b65"} flatShading roughness={1} />
            </mesh>
          </group>
        ))}
      </RigidBody>
      {/* Đuốc cắm cửa hang: dẫn đường ban đêm. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[CAVE.x + side * 2.2, floor + 2.2, CAVE.z + 6.2]}>
          <mesh>
            <cylinderGeometry args={[0.06, 0.08, 1, 5]} />
            <meshStandardMaterial color="#5a3d22" flatShading />
          </mesh>
          <mesh position-y={0.62}>
            <coneGeometry args={[0.16, 0.4, 5]} />
            <meshStandardMaterial color="#ffb347" emissive="#ff7b00" emissiveIntensity={3} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <pointLight position={[CAVE.x, floor + 3, CAVE.z + 6.5]} color="#ff9a4a" intensity={8} distance={10} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Núi lửa: hồ dung nham phát sáng và cột khói dày dần theo mức núi lửa.
// ---------------------------------------------------------------------------

const SMOKE_PUFFS = 22;

function Volcano({ room }: { room: IslandRoom }) {
  const level = useRoomSnapshot(room, (s) => s.volcano);
  const lava = useRef<Mesh>(null);
  const smoke = useRef<InstancedMesh>(null);
  const glow = useRef<PointLight>(null);
  const top = heightAt(VOLCANO.x, VOLCANO.z);
  const puffs = useMemo(() => {
    const rand = mulberry32(21);
    return Array.from({ length: SMOKE_PUFFS }, () => ({ offset: rand(), drift: rand() * Math.PI * 2, size: 0.7 + rand() * 0.6 }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const heat = 0.3 + (level / 100) * 0.7;
    if (lava.current) {
      const m = lava.current.material as MeshStandardMaterial;
      m.emissiveIntensity = (1.4 + Math.sin(t * 1.7) * 0.3) * (1 + heat);
    }
    if (glow.current) glow.current.intensity = (20 + Math.sin(t * 2.3) * 5) * heat * (0.6 + sky.night);
    const mesh = smoke.current;
    if (!mesh) return;
    const rise = 3 + heat * 5;
    puffs.forEach((p, i) => {
      const life = (t * (0.06 + heat * 0.05) + p.offset) % 1;
      const r = life * (2 + heat * 5);
      dummy.position.set(VOLCANO.x + Math.cos(p.drift + t * 0.1) * r + life * 6, top + 1 + life * rise * 4, VOLCANO.z + Math.sin(p.drift) * r);
      const s = p.size * (1 + life * (2 + heat * 4)) * Math.sin(Math.PI * Math.min(1, life * 1.3));
      dummy.scale.setScalar(Math.max(0.001, s));
      dummy.rotation.set(t * 0.1 + i, i, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={lava} rotation-x={-Math.PI / 2} position={[VOLCANO.x, top + 0.4, VOLCANO.z]}>
        <circleGeometry args={[3.6, 12]} />
        <meshStandardMaterial color="#ff7a1a" emissive="#ff4d00" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <pointLight ref={glow} position={[VOLCANO.x, top + 4, VOLCANO.z]} color="#ff6a2a" distance={60} decay={1.2} />
      <instancedMesh ref={smoke} args={[undefined, undefined, SMOKE_PUFFS]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#9a938e" flatShading transparent opacity={0.7} roughness={1} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trại: lửa bập bùng, tàn lửa bay, vòng đá, khúc gỗ, lều. Thuyền neo ngoài bờ.
// ---------------------------------------------------------------------------

const EMBERS = 18;

function Campfire() {
  const ground = heightAt(CAMP.x, CAMP.z);
  const flames = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const embers = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const seeds = useMemo(() => {
    const rand = mulberry32(31);
    return Array.from({ length: EMBERS }, () => ({ o: rand(), a: rand() * Math.PI * 2, r: rand() * 0.4 }));
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    flames.current?.children.forEach((f, i) => {
      const k = 1 + Math.sin(t * (9 + i * 2.3) + i) * 0.12 + Math.sin(t * 17 + i * 5) * 0.06;
      f.scale.set(1, k, 1);
      f.rotation.y = t * (0.8 + i * 0.3);
    });
    if (light.current) light.current.intensity = (14 + Math.sin(t * 11) * 2.5 + Math.sin(t * 23) * 1.5) * (0.5 + sky.night * 1.2);
    const mesh = embers.current;
    if (!mesh) return;
    seeds.forEach((s, i) => {
      const life = (t * 0.45 + s.o) % 1;
      dummy.position.set(CAMP.x + Math.cos(s.a + t) * (s.r + life * 0.5), ground + 0.4 + life * 3.2, CAMP.z + Math.sin(s.a + t) * (s.r + life * 0.5));
      dummy.scale.setScalar(0.05 * (1 - life));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <group ref={flames} position={[CAMP.x, ground + 0.15, CAMP.z]}>
        {[
          [0, 1.3, 0.55, "#ff8a1f"],
          [0.18, 0.9, 0.35, "#ffb347"],
          [-0.16, 0.8, 0.32, "#ffd27a"],
          [0, 0.55, 0.28, "#fff1c2"],
        ].map(([x, h, r, c], i) => (
          <mesh key={i} position={[x as number, (h as number) / 2, 0]}>
            <coneGeometry args={[r as number, h as number, 6]} />
            <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={2.6} toneMapped={false} flatShading />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} position={[CAMP.x, ground + 1.6, CAMP.z]} color="#ffa052" distance={18} castShadow={false} />
      <instancedMesh ref={embers} args={[undefined, undefined, EMBERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffb347" toneMapped={false} />
      </instancedMesh>
      {/* Vòng đá quanh lửa. */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return (
          <mesh key={i} position={[CAMP.x + Math.cos(a) * 0.95, ground + 0.12, CAMP.z + Math.sin(a) * 0.95]} rotation={[i, i * 2, 0]} castShadow>
            <dodecahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial color="#77716b" flatShading />
          </mesh>
        );
      })}
      {/* Củi cháy dở chụm giữa. */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[CAMP.x, ground + 0.15, CAMP.z]} rotation={[0, (i / 3) * Math.PI, Math.PI / 2 - 0.25]}>
          <cylinderGeometry args={[0.07, 0.09, 1.2, 5]} />
          <meshStandardMaterial color="#3a2616" flatShading />
        </mesh>
      ))}
      {/* Khúc gỗ ngồi quanh. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        return (
          <mesh key={i} position={[CAMP.x + Math.cos(a) * 2.4, ground + 0.22, CAMP.z + Math.sin(a) * 2.4]} rotation={[0, -a, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[0.24, 0.26, 1.8, 7]} />
            <meshStandardMaterial color="#7a5230" flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/** Lều chữ A: hai mái nghiêng và hai đầu tam giác, dựng thẳng từ đỉnh (khỏi xoay hình trụ cho rối). */
function tentGeometry(width: number, height: number, depth: number): BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  // prettier-ignore
  const v = [
    // mái trái
    -w, 0, -d,   0, height, -d,   0, height, d,
    -w, 0, -d,   0, height, d,   -w, 0, d,
    // mái phải
    w, 0, d,   0, height, d,   0, height, -d,
    w, 0, d,   0, height, -d,   w, 0, -d,
    // đầu sau và cửa trước
    -w, 0, -d,   w, 0, -d,   0, height, -d,
    w, 0, d,   -w, 0, d,   0, height, d,
  ];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

function Tent({ x, z, rot, color }: { x: number; z: number; rot: number; color: string }) {
  const y = heightAt(x, z);
  const geometry = useMemo(() => tentGeometry(2.4, 1.7, 2.8), []);
  return (
    <group position={[x, y - 0.05, z]} rotation-y={rot}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={color} flatShading roughness={0.9} side={DoubleSide} />
      </mesh>
      {/* Cửa lều tối màu ở đầu trước. */}
      <mesh position={[0, 0.45, 1.41]}>
        <planeGeometry args={[0.7, 0.9]} />
        <meshStandardMaterial color="#2a1d12" side={DoubleSide} />
      </mesh>
    </group>
  );
}

function Boat({ room }: { room: IslandRoom }) {
  const hull = useRoomSnapshot(room, (s) => s.hull);
  const boat = useRef<Group>(null);
  const boatZ = shoreRadius(0, 1) + 4;
  const hullGeo = useMemo(() => {
    const g = new BoxGeometry(2.4, 1, 6.4, 2, 1, 4);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const y = p.getY(i);
      // Thu hẹp hai đầu thành mũi và lái, đáy hẹp hơn mạn.
      const taper = 1 - Math.pow(Math.abs(z) / 3.2, 2.2) * 0.85;
      const bottom = y < 0 ? 0.55 : 1;
      p.setX(i, p.getX(i) * taper * bottom);
      if (y > 0) p.setY(i, y + Math.pow(Math.abs(z) / 3.2, 2) * 0.35);
    }
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    return flat;
  }, []);
  // Thuyền càng hư càng nghiêng và buồm càng rách.
  const damage = 1 - hull / 100;

  useFrame(({ clock }) => {
    const b = boat.current;
    if (!b) return;
    const t = clock.elapsedTime;
    b.position.y = WATER_LEVEL + 0.35 + Math.sin(t * 1.2) * 0.12 - damage * 0.35;
    b.rotation.z = Math.sin(t * 0.9) * 0.05 + damage * 0.22;
    b.rotation.x = Math.sin(t * 0.7 + 1) * 0.03;
  });

  return (
    <group ref={boat} position={[0, 0, boatZ]}>
      <mesh geometry={hullGeo} castShadow receiveShadow>
        <meshStandardMaterial color="#8a4b27" flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[1.9, 0.06, 5.2]} />
        <meshStandardMaterial color="#b98a55" flatShading />
      </mesh>
      <mesh position={[0, 2.9, 0.4]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 5, 6]} />
        <meshStandardMaterial color="#5a3d22" flatShading />
      </mesh>
      <mesh position={[0, 3.1 - damage * 0.6, 1.3]} rotation-y={Math.PI / 2} scale={[1, 1 - damage * 0.55, 1]} castShadow>
        <planeGeometry args={[1.7, 3.6, 3, 3]} />
        <meshStandardMaterial color={damage > 0.6 ? "#b8ad97" : "#efe6d2"} side={DoubleSide} flatShading />
      </mesh>
    </group>
  );
}

export function Island({ room, world }: { room: IslandRoom; world: World }) {
  return (
    <>
      <WindClock />
      <Terrain world={world} />
      <Water world={world} />
      <Palms world={world} />
      <Vegetation world={world} />
      <Structures world={world} />
      <Points room={room} world={world} />
      <Wildlife room={room} />
      <SeaLife world={world} />
      <Cave />
      <Volcano room={room} />
      <Campfire />
      <Tent x={CAMP.x - 7} z={CAMP.z - 4} rot={0.6} color="#c9a36a" />
      <Tent x={CAMP.x + 7.5} z={CAMP.z - 2} rot={-0.8} color="#7b8f5a" />
      <Boat room={room} />
    </>
  );
}
