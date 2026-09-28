import { useLayoutEffect, useMemo, useRef } from "react";
import { CuboidCollider, CylinderCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { BufferAttribute, Color, Object3D, PlaneGeometry, type InstancedMesh } from "three";
import {
  CAMP,
  CAVE,
  MAP_HALF_SIZE,
  PALMS,
  VOLCANO,
  WATER_LEVEL,
  heightAt,
  shoreRadius,
  zoneAt,
} from "@tentides/content";

const TERRAIN_SEGMENTS = 150;

const COLORS = {
  seabed: new Color("#c9b58a"),
  sand: new Color("#f1dca4"),
  grass: new Color("#7fb069"),
  forest: new Color("#5e9a4f"),
  rock: new Color("#8d8a86"),
  ash: new Color("#5b5450"),
  lava: new Color("#b8452c"),
};

function faceColor(x: number, z: number, h: number): Color {
  const inland = shoreRadius(x, z) - Math.hypot(x, z);
  const volcanoDist = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (volcanoDist < VOLCANO.craterRadius + 1) return COLORS.lava;
  if (h < WATER_LEVEL - 0.3) return COLORS.seabed;
  if (zoneAt(x, z) === "volcano" && h > 6) return COLORS.ash;
  if (h > 7) return COLORS.rock;
  if (inland < 14) return COLORS.sand;
  return inland < 40 ? COLORS.forest : COLORS.grass;
}

/** Dựng lưới địa hình từ heightAt(): bản có chỉ số cho va chạm, bản tách mặt để tô màu phẳng kiểu low-poly. */
function buildTerrain() {
  const size = MAP_HALF_SIZE * 2;
  const grid = new PlaneGeometry(size, size, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  grid.rotateX(-Math.PI / 2);
  const pos = grid.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }

  const colliderVertices = new Float32Array(pos.array);
  const colliderIndices = new Uint32Array(grid.index!.array);

  const flat = grid.toNonIndexed();
  const fpos = flat.attributes.position!;
  const colors = new Float32Array(fpos.count * 3);
  const tint = new Color();
  for (let i = 0; i < fpos.count; i += 3) {
    const cx = (fpos.getX(i) + fpos.getX(i + 1) + fpos.getX(i + 2)) / 3;
    const cy = (fpos.getY(i) + fpos.getY(i + 1) + fpos.getY(i + 2)) / 3;
    const cz = (fpos.getZ(i) + fpos.getZ(i + 1) + fpos.getZ(i + 2)) / 3;
    // Lệch màu nhẹ từng mặt cho ra chất low-poly.
    const jitter = 0.94 + 0.06 * Math.sin(cx * 12.9898 + cz * 78.233);
    tint.copy(faceColor(cx, cz, cy)).multiplyScalar(jitter);
    for (let v = 0; v < 3; v++) tint.toArray(colors, (i + v) * 3);
  }
  flat.setAttribute("color", new BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  grid.dispose();

  return { geometry: flat, colliderVertices, colliderIndices };
}

function Terrain() {
  const terrain = useMemo(buildTerrain, []);
  return (
    <RigidBody type="fixed" colliders={false}>
      <TrimeshCollider args={[terrain.colliderVertices, terrain.colliderIndices]} />
      <mesh geometry={terrain.geometry} receiveShadow>
        <meshStandardMaterial vertexColors flatShading />
      </mesh>
    </RigidBody>
  );
}

function Water() {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL}>
      <planeGeometry args={[1200, 1200]} />
      <meshStandardMaterial color="#2f9bc4" transparent opacity={0.8} />
    </mesh>
  );
}

/** Rừng dừa: hai InstancedMesh (thân + tán) cho cả rừng, mỗi cây một collider hình trụ. */
function Palms() {
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const dummy = new Object3D();
    PALMS.forEach((palm, i) => {
      const ground = heightAt(palm.x, palm.z);
      dummy.position.set(palm.x, ground + palm.height / 2, palm.z);
      dummy.rotation.set(palm.lean, 0, palm.lean * 0.6);
      dummy.scale.set(1, palm.height, 1);
      dummy.updateMatrix();
      trunks.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(palm.x + palm.lean * palm.height * 0.3, ground + palm.height, palm.z - palm.lean * palm.height * 0.5);
      dummy.rotation.set(0, i, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      crowns.current!.setMatrixAt(i, dummy.matrix);
    });
    trunks.current!.instanceMatrix.needsUpdate = true;
    crowns.current!.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, PALMS.length]} castShadow>
        <cylinderGeometry args={[0.18, 0.28, 1, 6]} />
        <meshStandardMaterial color="#8b6b43" flatShading />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, PALMS.length]} castShadow>
        <coneGeometry args={[2.4, 1.4, 7]} />
        <meshStandardMaterial color="#3f8f3a" flatShading />
      </instancedMesh>
      <RigidBody type="fixed" colliders={false}>
        {PALMS.map((palm, i) => (
          <CylinderCollider
            key={i}
            args={[palm.height / 2, 0.3]}
            position={[palm.x, heightAt(palm.x, palm.z) + palm.height / 2, palm.z]}
          />
        ))}
      </RigidBody>
    </>
  );
}

interface Block {
  size: [number, number, number];
  at: [number, number, number];
}

/** Hang động graybox: một phòng rỗng bằng khối đá, cửa quay về phía trại, có vách ngăn bên trong. */
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
  return (
    <RigidBody type="fixed" colliders={false}>
      {blocks.map((b, i) => (
        <group key={i} position={b.at}>
          <CuboidCollider args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={b.size} />
            <meshStandardMaterial color="#6f6a64" flatShading />
          </mesh>
        </group>
      ))}
    </RigidBody>
  );
}

function Crater() {
  const y = heightAt(VOLCANO.x, VOLCANO.z) + 0.4;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[VOLCANO.x, y, VOLCANO.z]}>
      <circleGeometry args={[3.5, 10]} />
      <meshStandardMaterial color="#ff7a1a" emissive="#ff4d00" emissiveIntensity={1.5} />
    </mesh>
  );
}

/** Trại: đống lửa giữa, vài khúc gỗ ngồi quanh, chiếc thuyền neo ngoài bờ. */
function Camp() {
  const ground = heightAt(CAMP.x, CAMP.z);
  const boatZ = shoreRadius(0, 1) + 3;
  return (
    <group>
      <mesh position={[CAMP.x, ground + 0.5, CAMP.z]}>
        <coneGeometry args={[0.6, 1.2, 6]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff7b00" emissiveIntensity={1.2} />
      </mesh>
      <pointLight position={[CAMP.x, ground + 1.5, CAMP.z]} color="#ffae5c" intensity={20} distance={14} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        return (
          <mesh key={i} position={[CAMP.x + Math.cos(a) * 2.2, ground + 0.2, CAMP.z + Math.sin(a) * 2.2]} rotation={[0, -a, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, 1.6, 6]} />
            <meshStandardMaterial color="#7a5230" flatShading />
          </mesh>
        );
      })}
      <mesh position={[0, WATER_LEVEL + 0.3, boatZ]} castShadow>
        <boxGeometry args={[2.4, 0.8, 6]} />
        <meshStandardMaterial color="#a0522d" flatShading />
      </mesh>
    </group>
  );
}

export function Island() {
  return (
    <>
      <Terrain />
      <Water />
      <Palms />
      <Cave />
      <Crater />
      <Camp />
    </>
  );
}
