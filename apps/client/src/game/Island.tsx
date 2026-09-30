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
import { ANCHORS, CAVE, MAP_HALF_SIZE, TREASURE_SITES, VOLCANO, WATER_LEVEL, heightAt, shoreRadius, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { sky } from "./shared.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { Vegetation } from "./Vegetation.tsx";
import { Water, waterUniforms } from "./Water.tsx";
import { WindClock, grain, mulberry32, patch, swayMaterial } from "./nature.ts";
import { Structures } from "./Structures.tsx";
import { Points } from "./Points.tsx";
import { Wildlife } from "./Wildlife.tsx";
import { SeaLife } from "./SeaLife.tsx";
import { Trees } from "./Trees.tsx";
import { Camp } from "./Camp.tsx";
import { Landmarks } from "./Landmarks.tsx";
import { detailed } from "./textures.ts";
import { GrassField } from "./Grass.tsx";
import { Flame } from "./Flame.tsx";
import { useProfile } from "./graphics.ts";

// ---------------------------------------------------------------------------
// Địa hình
// ---------------------------------------------------------------------------

/** Địa hình chia thành từng ô vuông cạnh chừng này mét (để camera cắt bớt phần ngoài tầm nhìn). */
const CHUNK = 48;
/** Độ mịn: ô có đất liền hay đáy nông thì 2 m một đỉnh; ô toàn biển sâu thì 6 m (6 chia hết cho 2 nên mép khớp nhau). */
const FINE = 2;
const COARSE = 6;
/**
 * Cạnh (theo số ô CHUNK) của mỗi khối va chạm. Ô vẽ vẫn giữ nguyên 48 m để cắt bớt phần ngoài
 * tầm nhìn, nhưng ô va chạm gộp lại: 100 `TrimeshCollider` riêng lẻ nghĩa là 100 cây BVH cùng
 * bước trong `world.step()` mỗi khung hình. Gộp theo khối 3×3 ô (144 m) còn 16 collider mà
 * hình học va chạm giống hệt.
 */
const COLLIDER_BLOCK = 3;

const C = {
  deepBed: new Color("#1d4f5a"),
  bed: new Color("#c7b286"),
  reefBed: new Color("#c99a86"),
  wetSand: new Color("#b89c70"),
  sand: new Color("#dcc79a"),
  blackSand: new Color("#3a3738"),
  blackWet: new Color("#262425"),
  grassLight: new Color("#8fa654"),
  grass: new Color("#62883a"),
  forest: new Color("#4b6d2c"),
  forestDark: new Color("#3b5523"),
  rock: new Color("#878079"),
  rockDark: new Color("#5f5953"),
  ash: new Color("#5f5751"),
  lava: new Color("#c8401f"),
  straw: new Color("#a79d5c"),
  dirt: new Color("#6e5b44"),
  asphalt: new Color("#3f4143"),
  concrete: new Color("#8f8c85"),
};

function faceColor(world: World, out: Color, x: number, z: number, h: number, slope: number) {
  const surf = world.surface(x, z);
  const inland = surf.inland;
  const n = patch(x, z);
  const islet = surf.islet && surf.inland > -30 ? surf.islet : null;
  const volcanic = islet?.kind === "volcanic";
  if (world.kind !== "battle" && !islet && Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.craterRadius + 1) return out.copy(C.lava);
  // Nền nhân tạo của Battleground: đường nhựa, sân bê tông, sân đá, đất trống.
  if (surf.ground && h >= WATER_LEVEL + 0.35) {
    const g = grain(x, z);
    if (surf.ground === "asphalt") return out.copy(C.asphalt).multiplyScalar(0.92 + 0.12 * g);
    if (surf.ground === "concrete") return out.copy(C.concrete).multiplyScalar(0.9 + 0.12 * g);
    if (surf.ground === "stone") return out.copy(C.rock).lerp(C.dirt, 0.25 + 0.2 * g);
    return out.copy(C.dirt).lerp(C.straw, 0.15 * g);
  }
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
        if (inland < 4 + n * 1.5) return out.copy(C.sand).lerp(C.wetSand, Math.min(1, Math.max(0, 1 - inland / 2)) * 0.8);
        if (inland < 7) return out.copy(C.sand).lerp(C.grassLight, Math.max(0, (inland - 4) / 3));
        return out.copy(C.grass).lerp(C.forest, 0.5 + 0.5 * n);
    }
  }
  if (world.zoneAt(x, z) === "volcano" && h > 6) return out.copy(C.ash).lerp(C.rockDark, Math.max(0, n) * 0.6);
  if (h > 8) return out.copy(C.rock).lerp(C.rockDark, 0.5 + 0.5 * n);
  if (inland < 12 + n * 3) return out.copy(C.sand).lerp(C.wetSand, Math.min(1, Math.max(0, 1 - inland / 4)) * 0.8);
  if (inland < 16) return out.copy(C.sand).lerp(C.grassLight, Math.max(0, (inland - 12) / 4));
  if (inland < 40) out.copy(C.grass).lerp(C.forest, 0.5 + 0.5 * n);
  else out.copy(C.forest).lerp(n > 0.2 ? C.forestDark : C.grassLight, Math.abs(n) * 0.8);
  // Nền dưới đám cỏ tranh ngả màu rơm.
  for (const p of world.tallGrass) {
    const d = Math.hypot(p.x - x, p.z - z) / p.radius;
    if (d < 1.2) out.lerp(C.straw, 0.55 * Math.min(1, (1.2 - d) * 2));
  }
  return out;
}

/**
 * Trộn vân địa hình tại một đỉnh: [cát, cỏ, vách đá, đất], cùng logic vùng với faceColor nhưng gọn hơn
 * (tính theo đỉnh nên chỗ giáp hai loại chuyển dần, không gãy theo mặt tam giác).
 */
function splatAt(world: World, x: number, z: number, h: number, slope: number): [number, number, number, number] {
  const surf = world.surface(x, z);
  const n = patch(x, z);
  const islet = surf.islet && surf.inland > -30 ? surf.islet : null;
  if (h < WATER_LEVEL + 0.35) return [1, 0, 0, 0];
  if (surf.ground) return surf.ground === "dirt" ? [0, 0, 0.2, 0.8] : [0, 0, 1, 0];
  if (surf.pad || world.structureAt(x, z)) return [0, 0, 0.3, 0.7];
  if (slope > 0.55 && h > 2) return [0, 0, 1, 0];
  const mix = (t: number, a: [number, number, number, number], b: [number, number, number, number]) =>
    a.map((v, i) => v * (1 - t) + b[i]! * t) as [number, number, number, number];
  const SAND: [number, number, number, number] = [1, 0, 0, 0];
  const GRASS: [number, number, number, number] = [0, 1, 0, 0];
  const CLIFF: [number, number, number, number] = [0, 0, 1, 0];
  const DIRT: [number, number, number, number] = [0, 0, 0, 1];
  if (islet) {
    switch (islet.kind) {
      case "volcanic":
        return h > 4 ? mix(0.4, DIRT, CLIFF) : mix(0.3, SAND, DIRT);
      case "rocky":
        if (h > 3 || n > 0.3) return CLIFF;
        return surf.inland < 4 ? mix(0.4, SAND, CLIFF) : mix(0.35, GRASS, CLIFF);
      case "sandbar":
      case "atoll":
        return surf.inland < 6 + n * 2 ? SAND : mix(0.5, SAND, GRASS);
      case "jungle":
        if (surf.inland < 4 + n * 1.5) return SAND;
        if (surf.inland < 7) return mix(Math.max(0, (surf.inland - 4) / 3), SAND, GRASS);
        return GRASS;
    }
  }
  if (world.zoneAt(x, z) === "volcano" && h > 6) return mix(0.35, DIRT, CLIFF);
  if (h > 8) return mix(Math.min(1, (h - 8) / 3), GRASS, CLIFF);
  const inland = surf.inland;
  if (inland < 12 + n * 3) return SAND;
  if (inland < 16) return mix(Math.max(0, (inland - 12) / 4), SAND, GRASS);
  // Rừng sâu: đất lẫn cỏ.
  return inland > 40 && n > 0.2 ? mix(0.35, GRASS, DIRT) : GRASS;
}

interface TerrainChunk {
  geometry: BufferGeometry;
  colliderVertices: Float32Array;
  colliderIndices: Uint32Array;
  /** Toạ độ ô (theo lưới CHUNK) để gom về khối va chạm. */
  cx: number;
  cz: number;
}

/** Một khối va chạm gồm nhiều ô: đỉnh và tam giác đã nối lại thành một lưới. */
interface TerrainCollider {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Dựng địa hình từ world.heightAt() theo từng ô: ô có đất hay đáy nông dùng lưới mịn, ô toàn biển sâu dùng lưới thưa.
 * Mép ô mịn giáp ô thưa được nắn thẳng theo ô thưa để không hở khe. Mỗi ô dùng chung một lưới cho va chạm
 * và cho hình vẽ; màu, pháp tuyến và trọng số vân tính theo đỉnh nên mặt đất chuyển mượt.
 */
function buildTerrain(world: World): TerrainChunk[] {
  const half = world.half ?? MAP_HALF_SIZE;
  const count = Math.round((half * 2) / CHUNK);
  const origin = -half;
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
      // Lưới dùng chung đỉnh: pháp tuyến và màu nội suy mượt giữa các đỉnh (không còn tô phẳng từng mặt).
      const grid = new BufferGeometry();
      grid.setAttribute("position", new BufferAttribute(verts, 3));
      grid.setIndex(new BufferAttribute(indices, 1));
      const count = (cells + 1) * (cells + 1);
      const normals = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const splat = new Float32Array(count * 4);
      const e = FINE;
      for (let v = 0; v < count; v++) {
        const x = verts[v * 3]!;
        const y = verts[v * 3 + 1]!;
        const z = verts[v * 3 + 2]!;
        // Pháp tuyến tính thẳng từ độ cao thế giới nên hai ô cạnh nhau khớp nhau, không lộ đường nối.
        const nx = heightOn(x - e, z) - heightOn(x + e, z);
        const nz = heightOn(x, z - e) - heightOn(x, z + e);
        const len = Math.hypot(nx, 2 * e, nz);
        normals[v * 3] = nx / len;
        normals[v * 3 + 1] = (2 * e) / len;
        normals[v * 3 + 2] = nz / len;
        const slope = 1 - (2 * e) / len;
        faceColor(world, tint, x, z, y, slope);
        // Lệch màu rất nhẹ theo chỗ, cho đỡ phẳng lì.
        tint.multiplyScalar(0.96 + 0.06 * grain(x, z));
        tint.toArray(colors, v * 3);
        splat.set(splatAt(world, x, z, y, slope), v * 4);
      }
      grid.setAttribute("normal", new BufferAttribute(normals, 3));
      grid.setAttribute("color", new BufferAttribute(colors, 3));
      grid.setAttribute("splat", new BufferAttribute(splat, 4));
      grid.userData.smooth = true;
      grid.computeBoundingSphere();
      chunks.push({ geometry: grid, colliderVertices: verts, colliderIndices: indices, cx, cz });
    }
  }
  return chunks;
}

/**
 * Gộp đỉnh/tam giác của các ô cạnh nhau thành vài khối lớn hơn để va chạm.
 * Mỗi `TrimeshCollider` là một cây BVH riêng được duyệt mỗi bước vật lý; 100 cây (một cây mỗi
 * ô 48 m) tốn nhiều hơn 16 cây (mỗi khối 3×3 ô) trong khi hình học va chạm hoàn toàn giống nhau.
 */
function buildTerrainColliders(chunks: TerrainChunk[], count: number): TerrainCollider[] {
  const blocks = Math.ceil(count / COLLIDER_BLOCK);
  const out: (TerrainCollider & { v: number[]; i: number[]; base: number })[] = [];
  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) out.push({ vertices: new Float32Array(0), indices: new Uint32Array(0), v: [], i: [], base: 0 });
  }
  for (const c of chunks) {
    const b = out[Math.floor(c.cx / COLLIDER_BLOCK) * blocks + Math.floor(c.cz / COLLIDER_BLOCK)]!;
    b.base = b.v.length / 3;
    for (let n = 0; n < c.colliderVertices.length; n++) b.v.push(c.colliderVertices[n]!);
    for (let n = 0; n < c.colliderIndices.length; n++) b.i.push(c.colliderIndices[n]! + b.base);
  }
  for (const b of out) {
    b.vertices = Float32Array.from(b.v);
    b.indices = Uint32Array.from(b.i);
  }
  return out;
}

/**
 * Mặt đất gần nước: cát ướt sẫm màu và bóng hơn ở mép nước (mép ướt dâng hạ theo sóng), đáy biển có vân sáng
 * lung linh do nắng khúc xạ qua mặt sóng (caustics), càng sâu càng mờ và ngả xanh.
 */
function seabedLight(m: MeshStandardMaterial) {
  m.customProgramCacheKey = () => "seabed";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSeabed;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvSeabed = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uTime;
        varying vec3 vSeabed;
        float tenCaustic(vec2 p, float t) {
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0;
          c = 1.17 - pow(c, 1.4);
          return clamp(pow(abs(c), 8.0), 0.0, 2.0);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float tenWater = ${WATER_LEVEL.toFixed(2)};
        float tenAbove = vSeabed.y - tenWater;
        float tenWetLine = 0.45 + 0.25 * sin(uTime * 0.75 + (vSeabed.x + vSeabed.z) * 0.05);
        float tenWet = 1.0 - smoothstep(0.0, tenWetLine, tenAbove);
        diffuseColor.rgb *= 1.0 - 0.32 * tenWet;
        float tenDepth = max(0.0, -tenAbove);
        // Càng sâu càng mất màu đỏ, ngả xanh lục lam.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.85, 0.95), smoothstep(0.0, 6.0, tenDepth));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, tenWet * step(0.0, tenAbove));",
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        if (tenAbove < 0.0) {
          float tenFade = smoothstep(0.0, 0.6, tenDepth) * (1.0 - smoothstep(4.0, 14.0, tenDepth));
          float tenC = tenCaustic(mod(vSeabed.xz * 0.4 + vec2(0.0, uTime * 0.03), 6.28318) - 250.0, uTime * 0.5);
          // Vân sáng theo nắng trực tiếp đang chiếu xuống (đêm, trong bóng râm thì tắt).
          reflectedLight.directDiffuse += reflectedLight.directDiffuse * tenC * 2.2 * tenFade;
        }`,
      );
  };
}

/** Trại, điểm sự kiện, chỗ đào: không mọc cỏ dày (người qua lại giẫm hết). */
function grassClearings(room: IslandRoom, world: World) {
  if (world.kind === "battle") return () => {};
  const fixed = [
    ...ANCHORS.map((a) => [a.x, a.z, LANDMARK_ANCHORS.has(a.type) ? 10 : 3.5] as const),
    ...TREASURE_SITES.map((t) => [t.x, t.z, 2.5] as const),
  ];
  return (out: Vector3[]) => {
    let i = 0;
    const st = room.state;
    if (!st.campPacked) out[i++]!.set(st.campX, st.campZ, 7.5);
    for (const [x, z, r] of fixed) if (i < out.length) out[i++]!.set(x, z, r);
  };
}

const LANDMARK_ANCHORS = new Set(["shipwreck", "jungle_ruin", "cliff_nest", "hot_spring"]);

export function Terrain({ room, world }: { room: IslandRoom; world: World }) {
  const clearings = useMemo(() => grassClearings(room, world), [room, world]);
  const chunks = useMemo(() => buildTerrain(world), [world]);
  const geometries = useMemo(() => chunks.map((c) => c.geometry), [chunks]);
  // 100 ô vẽ (mỗi ô một draw call, cắt bớt phần ngoài tầm nhìn) nhưng chỉ ~16 collider.
  const colliders = useMemo(() => buildTerrainColliders(chunks, (MAP_HALF_SIZE * 2) / CHUNK), [chunks]);
  // Số lá cỏ do mức chất lượng quyết định (0 ở "low"): mỗi bụi là một vòng lặp 32 phép tính trên
  // vertex, 100 000 bụi là khoảng 22 triệu phép tính mỗi khung hình.
  const grass = useProfile().grass;
  const material = useMemo(() => {
    const m = detailed(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), "grass");
    seabedLight(m);
    m.userData.detailSplat = true;
    m.userData.detailBump = 0.2;
    m.userData.detailStrength = 0.24;
    return m;
  }, []);
  useEffect(() => () => chunks.forEach((c) => c.geometry.dispose()), [chunks]);
  return (
    <RigidBody type="fixed" colliders={false}>
      {colliders.map((c, i) => (
        <TrimeshCollider key={`col${i}`} args={[c.vertices, c.indices]} />
      ))}
      {chunks.map((c, i) => (
        <mesh key={i} geometry={c.geometry} material={material} receiveShadow />
      ))}
      {grass > 0 && <GrassField geometries={geometries} count={grass} clearings={clearings} heightAt={world.heightAt} half={world.half ?? MAP_HALF_SIZE} />}
    </RigidBody>
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
          <Flame position={[0, 0.5, 0]} width={0.35} height={0.6} seed={side * 0.37 + 0.5} />
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
      <Terrain room={room} world={world} />
      <Water world={world} />
      <Trees room={room} world={world} />
      <Vegetation world={world} />
      <Structures world={world} />
      <Points room={room} world={world} />
      <Wildlife room={room} />
      <SeaLife world={world} />
      <Cave />
      <Volcano room={room} />
      <Camp room={room} world={world} />
      <Landmarks world={world} />
      <Boat room={room} />
    </>
  );
}
