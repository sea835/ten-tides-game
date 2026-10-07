import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ANCHORS, CAMP, CAVE, LAKE, TREASURE_SITES, type GrassPatch, type World } from "@tentides/content";
import { useProfile } from "./graphics.ts";
import { grain, mulberry32, patch, rockGeometry, swayMaterial } from "./nature.ts";
import { detailed } from "./textures.ts";
import { broadLeafTexture, frondStrip, frondTexture, leafCluster, leafClusterTexture, leafMaterial } from "./foliage.ts";

// Cây cỏ của đảo hoang: cỏ thấp phủ khắp, cỏ vừa, đám cỏ tranh cao (ngồi vào là nấp được),
// lau sậy quanh hồ, dương xỉ dưới tán dừa, bụi rậm có hoa, chuối rừng lá to, dứa dại gai góc ven rừng,
// cỏ biển lún phún trên cát, dây leo bò lan và gỗ trôi dạt. Tất cả dùng InstancedMesh, không va chạm
// (cây leo được, chặt được nằm ở Trees.tsx).

// ---------------------------------------------------------------------------
// Hình khối
// ---------------------------------------------------------------------------

const UP = [0, 1, 0];

/**
 * Một khóm lá cỏ: mỗi lá là dải tam giác cong 3 đoạn, cao 1 đơn vị (co giãn theo instance).
 * Pháp tuyến hướng lên để cỏ sáng tối giống mặt đất; màu đỉnh sáng hơn gốc.
 */
function grassClump(blades: number, seed: number, spread: number, width: number): BufferGeometry {
  const rand = mulberry32(seed);
  const pos: number[] = [];
  const col: number[] = [];
  for (let b = 0; b < blades; b++) {
    const angle = rand() * Math.PI * 2;
    const r = rand() * spread;
    const ox = Math.cos(angle) * r;
    const oz = Math.sin(angle) * r;
    const h = 0.7 + rand() * 0.3;
    const lean = 0.15 + rand() * 0.35;
    const facing = rand() * Math.PI * 2;
    const dx = Math.cos(facing);
    const dz = Math.sin(facing);
    // Hướng bề ngang của lá, vuông góc với hướng ngả.
    const wx = -dz * width;
    const wz = dx * width;
    const at = (t: number, side: number) => {
      const bendOut = lean * t * t;
      const taper = 1 - t;
      return [ox + dx * bendOut + wx * side * taper, h * t, oz + dz * bendOut + wz * side * taper];
    };
    const b0l = at(0, -0.5);
    const b0r = at(0, 0.5);
    const m1l = at(0.45, -0.5);
    const m1r = at(0.45, 0.5);
    const m2l = at(0.75, -0.5);
    const m2r = at(0.75, 0.5);
    const tip = at(1, 0);
    const tris = [b0l, b0r, m1r, b0l, m1r, m1l, m1l, m1r, m2r, m1l, m2r, m2l, m2l, m2r, tip];
    for (const v of tris) {
      pos.push(...v);
      const shade = 0.72 + 0.28 * (v[1]! / h);
      col.push(shade, shade, shade);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < normals.length; i += 3) normals.set(UP, i);
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  return g;
}

/** Dương xỉ: vòng lá kép xoè ra rồi rủ xuống, cao chừng 1 đơn vị. */
function fern(): BufferGeometry {
  const count = 9;
  return frondStrip(count, 6, (f, s, side) => {
    const angle = (f / count) * Math.PI * 2 + (f % 2) * 0.3;
    const length = 1.1 + (f % 3) * 0.15;
    const along = s * length;
    const y = 0.9 * s - 0.9 * s * s * 1.1 + 0.05;
    const width = 0.3 * side * Math.min(1, 0.3 + s * 2);
    return [Math.cos(angle) * along - Math.sin(angle) * width, y - Math.abs(width) * 0.4, Math.sin(angle) * along + Math.cos(angle) * width];
  });
}

const BUSH_BLOBS: [number, number, number, number][] = [
  [0, 0.5, 0, 0.62],
  [0.5, 0.38, 0.12, 0.48],
  [-0.42, 0.34, -0.18, 0.5],
  [0.1, 0.32, -0.5, 0.42],
  [-0.1, 0.8, 0.1, 0.4],
];

/** Bụi rậm: vài chùm lá chụm lại, rộng chừng 1,6 và cao chừng 1 đơn vị; lõi sẫm che khoảng trống bên trong. */
function bush(): { leaves: BufferGeometry; core: BufferGeometry } {
  const leaves = leafCluster(BUSH_BLOBS, 9, 0.55, 12);
  const core = mergeGeometries(BUSH_BLOBS.map(([x, y, z, r]) => new IcosahedronGeometry(r * 0.7, 1).translate(x, y, z)))!;
  core.computeVertexNormals();
  return { leaves, core };
}

/** Lá chuối: mỗi tàu lá là phiến rộng vươn lên rồi rủ xuống, mọc quanh ngọn một thân giả ngắn. */
function bananaLeaves(): BufferGeometry {
  const count = 7;
  return frondStrip(count, 7, (f, s, side) => {
    const angle = (f / count) * Math.PI * 2 + (f % 2) * 0.4;
    const length = 1.5 + (f % 3) * 0.2;
    const rise = 0.55 + (f % 2) * 0.25;
    const along = s * length;
    // Cuống vươn lên, phiến lá rủ dần về cuối; hai mép lá hơi cụp xuống như lá chuối thật.
    const y = 1.35 + rise * s - 1.3 * s * s;
    const width = 0.36 * side;
    return [Math.cos(angle) * along - Math.sin(angle) * width, y - Math.abs(width) * 0.35, Math.sin(angle) * along + Math.cos(angle) * width];
  });
}

/** Dây leo bò lan trên đất: mấy nhánh lá tròn nhỏ toả ra sát mặt đất. */
function creeper(): BufferGeometry {
  const rand = mulberry32(77);
  const parts: BufferGeometry[] = [];
  for (let b = 0; b < 5; b++) {
    const angle = rand() * Math.PI * 2;
    for (let k = 1; k <= 4; k++) {
      const d = k * 0.32;
      parts.push(new IcosahedronGeometry(0.16 + rand() * 0.06, 0).scale(1, 0.35, 1).translate(Math.cos(angle + k * 0.25) * d, 0.05, Math.sin(angle + k * 0.25) * d));
    }
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Đặt cây cỏ
// ---------------------------------------------------------------------------

interface Spot {
  x: number;
  y: number;
  z: number;
  s: number;
  h: number;
  r: number;
}

const LANDMARK_TYPES = new Set(["shipwreck", "jungle_ruin", "cliff_nest", "hot_spring"]);

const nearCamp = (x: number, z: number, d: number) => Math.hypot(x - CAMP.x, z - CAMP.z) < d;
const inLake = (x: number, z: number) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 1;

/** Các hàm đặt cây cỏ theo thế giới đang chơi (đảo chính và đảo nhỏ). */
function placer(world: World) {
  const heightAt = world.heightAt;
  /** Số mét từ bờ vào trong; đảo nhỏ bé nên được "tính rộng" gấp rưỡi để ngưỡng rừng, cát dùng chung. */
  const inland = (x: number, z: number) => {
    const s = world.surface(x, z);
    return s.island === "islet" ? s.inland * 2.5 : s.inland;
  };
  // Chừa chỗ cho cảnh cố định ở điểm sự kiện (xác tàu, phế tích, suối nước nóng, mỏm đá tổ chim).
  const clearOfPoints = (x: number, z: number, d: number) =>
    ANCHORS.every((a) => Math.hypot(a.x - x, a.z - z) > d + (LANDMARK_TYPES.has(a.type) ? 7 : 0)) && TREASURE_SITES.every((t) => Math.hypot(t.x - x, t.z - z) > d) && world.isClear(x, z, d);
  /** Đất có cỏ mọc: trong đảo, không phải sườn núi lửa, hang, đảo đá hay đảo cát đen, không dưới nước. */
  const grassy = (x: number, z: number, h: number) => {
    if (h < 0.6 || h > 9 || inland(x, z) < 12 || inLake(x, z)) return false;
    const s = world.surface(x, z);
    if (s.islet && (s.islet.kind === "rocky" || s.islet.kind === "volcanic")) return false;
    return world.zoneAt(x, z) !== "volcano" && Math.hypot(x - CAVE.x, z - CAVE.z) > CAVE.radius - 2 && !s.pad && !world.structureAt(x, z);
  };
  /** Vùng lấy mẫu: đảo chính và từng đảo nhỏ, theo diện tích. */
  const regions = [{ x: 0, z: 0, half: world.extent ?? 112 }, ...world.islets.map((it) => ({ x: it.x, z: it.z, half: it.radius * 1.2 }))];
  const area = regions.reduce((sum, r) => sum + r.half * r.half, 0);

  function scatter(count: number, seed: number, accept: (x: number, z: number, h: number, rand: () => number) => boolean, size: [number, number] = [0.7, 1.3]): Spot[] {
    const rand = mulberry32(seed);
    const out: Spot[] = [];
    for (let tries = 0; out.length < count && tries < count * 25; tries++) {
      let pick = rand() * area;
      let region = regions[0]!;
      for (const r of regions) {
        pick -= r.half * r.half;
        if (pick <= 0) {
          region = r;
          break;
        }
      }
      const x = region.x + (rand() * 2 - 1) * region.half;
      const z = region.z + (rand() * 2 - 1) * region.half;
      const h = heightAt(x, z);
      if (!accept(x, z, h, rand)) continue;
      out.push({ x, y: h, z, s: size[0] + rand() * (size[1] - size[0]), h: 1, r: rand() * Math.PI * 2 });
    }
    return out;
  }

  /** Rải dày trong từng đám cỏ tranh: lõi cao và dày, mép thấp và thưa dần. */
  function fillPatches(patches: readonly GrassPatch[], perSquareMeter: number, seed: number): Spot[] {
    const rand = mulberry32(seed);
    const out: Spot[] = [];
    for (const p of patches) {
      const n = Math.round(Math.PI * p.radius * p.radius * perSquareMeter);
      for (let i = 0; i < n; i++) {
        // Căn bậc hai để rải đều theo diện tích; lấn ra mép một chút cho viền tự nhiên.
        const d = Math.sqrt(rand()) * p.radius * 1.12;
        const a = rand() * Math.PI * 2;
        const x = p.x + Math.cos(a) * d;
        const z = p.z + Math.sin(a) * d;
        const edge = d / p.radius;
        if (edge > 0.8 && rand() < (edge - 0.8) * 3) continue;
        const h = heightAt(x, z);
        if (h < 0.1 || inLake(x, z)) continue;
        // Cao 1,5–2,1 m ở lõi (che kín người ngồi, ngang đầu người đứng), thấp dần ra mép.
        const height = (1.5 + rand() * 0.6) * (1 - Math.max(0, edge - 0.6) * 0.9);
        out.push({ x, y: h - 0.05, z, s: 0.9 + rand() * 0.5, h: height, r: rand() * Math.PI * 2 });
      }
    }
    return out;
  }

  return { heightAt, inland, clearOfPoints, grassy, scatter, fillPatches };
}

// ---------------------------------------------------------------------------
// Vẽ
// ---------------------------------------------------------------------------

type Tint = (i: number, c: Color, spot: Spot) => void;

/** Cây cỏ chia theo ô vuông cạnh chừng này mét: ô nào ngoài khung hình thì card đồ hoạ bỏ qua cả ô. */
const CELL = 72;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  spots: { spot: Spot; index: number }[];
}

function chunked(spots: Spot[]): Chunk[] {
  const map = new Map<string, Chunk>();
  spots.forEach((spot, index) => {
    const gx = Math.floor(spot.x / CELL);
    const gz = Math.floor(spot.z / CELL);
    const key = `${gx},${gz}`;
    let c = map.get(key);
    if (!c) {
      c = { key, cx: (gx + 0.5) * CELL, cz: (gz + 0.5) * CELL, spots: [] };
      map.set(key, c);
    }
    c.spots.push({ spot, index });
  });
  return [...map.values()];
}

function ChunkMesh({ chunk, geometry, material, tint, heightScale, cast, meshRef }: {
  chunk: Chunk;
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  tint: Tint;
  heightScale: boolean;
  cast: boolean;
  meshRef: (m: InstancedMesh | null) => void;
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new Object3D();
    const color = new Color();
    chunk.spots.forEach(({ spot: p, index }, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.r, 0);
      if (heightScale) dummy.scale.set(p.s, p.h, p.s);
      else dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      // Màu tính theo chỉ số trong cả danh sách, để chia ô không làm đổi màu từng khóm.
      tint(index, color, p);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Khung bao của riêng ô này: three.js dùng nó để bỏ qua ô nằm ngoài khung hình.
    m.computeBoundingSphere();
  }, [chunk, tint, heightScale]);
  return (
    <instancedMesh
      ref={(m) => {
        mesh.current = m;
        meshRef(m);
      }}
      args={[geometry, material, chunk.spots.length]}
      castShadow={cast}
      receiveShadow
    />
  );
}

/**
 * Một loại cây cỏ, chia thành từng ô (mỗi ô một InstancedMesh). `farthest`: ô có tâm xa camera hơn chừng này
 * mét thì ẩn hẳn (cỏ nhỏ ở xa chỉ còn là vài điểm ảnh, vẽ ra tốn công vô ích).
 */
function Instances({ spots, geometry, material, tint, heightScale = false, cast = false, farthest }: {
  spots: Spot[];
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  tint: Tint;
  /** Co giãn chiều cao theo `spot.h` (cỏ), không thì co đều theo `spot.s`. */
  heightScale?: boolean;
  cast?: boolean;
  farthest?: number;
}) {
  const chunks = useMemo(() => chunked(spots), [spots]);
  const meshes = useRef(new Map<string, InstancedMesh>());
  // Chỗ camera lần xét gần nhất: đi chưa quá 2 m thì giữ nguyên (khỏi duyệt lại hàng trăm ô mỗi khung hình),
  // nhưng cứ 30 khung hình vẫn xét lại một lần (ô vừa dựng lại, tầm nhìn đổi theo mức đồ họa).
  const seen = useRef({ x: Infinity, z: Infinity, frames: 0 });
  useFrame(({ camera }) => {
    if (!farthest) return;
    const last = seen.current;
    const { x, z } = camera.position;
    if (++last.frames < 30 && Math.abs(x - last.x) < 2 && Math.abs(z - last.z) < 2) return;
    last.x = x;
    last.z = z;
    last.frames = 0;
    const limit = farthest + CELL * 0.71;
    for (const c of chunks) {
      const m = meshes.current.get(c.key);
      if (m) m.visible = Math.hypot(c.cx - camera.position.x, c.cz - camera.position.z) < limit;
    }
  });
  return (
    <>
      {chunks.map((c) => (
        <ChunkMesh
          key={`${c.key}:${c.spots.length}`}
          chunk={c}
          geometry={geometry}
          material={material}
          tint={tint}
          heightScale={heightScale}
          cast={cast}
          meshRef={(m) => {
            if (m) meshes.current.set(c.key, m);
            else meshes.current.delete(c.key);
          }}
        />
      ))}
    </>
  );
}

export function Vegetation({ world }: { world: World }) {
  const profile = useProfile();
  const density = profile.vegetation;
  // Tầm vẽ theo mức chất lượng: ô ở xa hơn thì ẩn hẳn (sương mù đã che gần hết, vẽ ra chỉ tốn GPU).
  const far = (m: number) => m * profile.drawDistance;
  const place = useMemo(() => placer(world), [world]);

  const spots = useMemo(() => {
    const { inland, clearOfPoints, grassy, scatter, fillPatches } = place;
    const heightAt = world.heightAt;
    const zoneAt = world.zoneAt;
    // Đảo lớn hơn (bản đồ Battleground) thì rải nhiều hơn theo diện tích để độ dày như nhau.
    const area = Math.min(3.2, ((world.extent ?? 112) / 112) ** 2);
    const d = (n: number) => Math.round(n * density * area);
    const underPalm = (x: number, z: number) => world.palms.some((p) => Math.hypot(p.x - x, p.z - z) < 4);
    const nearTree = (x: number, z: number, r: number) => world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < r);
    /** Bãi cát: trên mặt nước, sát mép bờ (đảo đá, đảo núi lửa không có). */
    const sandy = (x: number, z: number, h: number) => {
      if (h < 0.25 || h > 3 || inLake(x, z)) return false;
      const s = world.surface(x, z);
      if (s.islet && (s.islet.kind === "rocky" || s.islet.kind === "volcanic")) return false;
      return inland(x, z) < 14 && !s.pad && !world.structureAt(x, z);
    };
    const bushes = scatter(d(680), 12, (x, z, h, rand) => grassy(x, z, h) && !nearCamp(x, z, 11) && clearOfPoints(x, z, 3) && (inland(x, z) > 30 || rand() < 0.35), [0.6, 1.8]);
    return {
      // Cỏ thấp phủ khắp nơi có đất, thưa dần ra phía cát.
      short: scatter(d(10500), 11, (x, z, h, rand) => grassy(x, z, h) && (inland(x, z) > 16 || rand() < 0.3) && !nearCamp(x, z, 3.5), [0.7, 1.4]).map((p, i) => ({
        ...p,
        h: 0.25 + grain(i, 9) * 0.35 + Math.max(0, patch(p.x, p.z)) * 0.2,
      })),
      // Cỏ vừa mọc thành từng khóm lẻ, dày hơn ở bìa rừng.
      medium: scatter(d(2300), 15, (x, z, h, rand) => grassy(x, z, h) && inland(x, z) > 18 && !nearCamp(x, z, 5) && (patch(x, z) > -0.2 || rand() < 0.3), [0.8, 1.3]).map((p, i) => ({
        ...p,
        h: 0.6 + grain(i, 7) * 0.5,
      })),
      // Cỏ cao dùng để nấp nên dày như nhau ở mọi mức đồ hoạ (máy yếu không được lợi thế nhìn xuyên cỏ).
      tall: fillPatches(world.tallGrass, 3.4, 16),
      ferns: scatter(d(850), 17, (x, z, h, rand) => grassy(x, z, h) && !nearCamp(x, z, 8) && clearOfPoints(x, z, 2.5) && (underPalm(x, z) || nearTree(x, z, 6) || inland(x, z) > 38 || rand() < 0.15), [0.6, 1.3]),
      // Chuối rừng mọc thành cụm ở chỗ ẩm trong rừng, dưới tán cây lớn.
      bananas: scatter(d(170), 19, (x, z, h, rand) => grassy(x, z, h) && inland(x, z) > 26 && !nearCamp(x, z, 12) && clearOfPoints(x, z, 3.5) && !nearTree(x, z, 1.8) && (nearTree(x, z, 9) || rand() < 0.25), [0.8, 1.35]),
      // Dứa dại: khóm lá dài gai góc ở bìa rừng giáp bãi cát.
      pandans: scatter(d(260), 20, (x, z, h) => h > 0.5 && h < 6 && inland(x, z) > 7 && inland(x, z) < 26 && !inLake(x, z) && !nearCamp(x, z, 9) && clearOfPoints(x, z, 3) && !world.structureAt(x, z), [0.9, 1.6]),
      // Cỏ biển lún phún trên cát.
      beachGrass: scatter(d(1300), 22, (x, z, h) => sandy(x, z, h) && !nearCamp(x, z, 4) && clearOfPoints(x, z, 1.5), [0.6, 1.2]).map((p, i) => ({ ...p, h: 0.35 + grain(i, 23) * 0.45 })),
      // Dây leo bò lan dưới tán rừng và trên bãi cát (rau muống biển).
      creepers: scatter(d(420), 24, (x, z, h, rand) => (grassy(x, z, h) && inland(x, z) > 30) || (sandy(x, z, h) && rand() < 0.4), [0.7, 1.5]),
      bushes,
      // Khoảng một phần ba số bụi trổ hoa.
      flowers: bushes
        .filter((_, i) => grain(i, 21) < 0.33)
        .flatMap((b, i) =>
          Array.from({ length: 4 }, (_, k) => {
            const a = grain(i, k + 30) * Math.PI * 2;
            const r = 0.35 + grain(k, i + 40) * 0.35;
            return { x: b.x + Math.cos(a) * r * b.s, y: b.y + (0.6 + grain(i, k) * 0.35) * b.s, z: b.z + Math.sin(a) * r * b.s, s: 1, h: 1, r: a };
          }),
        ),
      rocks: scatter(d(180), 13, (x, z, h) => {
        if (h < -0.5 || !clearOfPoints(x, z, 2)) return false;
        const s = world.surface(x, z);
        return zoneAt(x, z) === "volcano" || zoneAt(x, z) === "cave" || inland(x, z) < 6 || s.islet?.kind === "rocky" || s.islet?.kind === "volcanic";
      }, [0.4, 1.6]),
      shells: scatter(d(90), 14, (x, z, h) => h > 0.1 && h < 0.9, [0.8, 1.2]),
      driftwood: scatter(16, 18, (x, z, h) => h > 0.15 && h < 0.7 && !nearCamp(x, z, 8) && clearOfPoints(x, z, 3), [0.8, 1.6]),
    };
  }, [density, place, world]);

  const geo = useMemo(
    () => ({
      short: grassClump(5, 1, 0.28, 0.08),
      medium: grassClump(9, 2, 0.3, 0.09),
      tall: grassClump(8, 3, 0.42, 0.15),
      fern: fern(),
      bush: bush(),
      flower: new IcosahedronGeometry(0.1, 0),
      rock: rockGeometry(0.6, 1),
      shell: new CylinderGeometry(0, 0.12, 0.08, 5),
      driftwood: new CylinderGeometry(0.16, 0.2, 2.4, 10).rotateZ(Math.PI / 2).translate(0, 0.12, 0),
      bananaStem: new CylinderGeometry(0.1, 0.16, 1.45, 10).translate(0, 0.72, 0),
      bananaLeaves: bananaLeaves(),
      pandan: grassClump(14, 4, 0.18, 0.14),
      beachGrass: grassClump(7, 5, 0.2, 0.05),
      creeper: creeper(),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      grass: detailed(swayMaterial({ vertexColors: true, side: DoubleSide, roughness: 1 }, 0.22, 0, true), "leaf"),
      tall: detailed(swayMaterial({ vertexColors: true, side: DoubleSide, roughness: 1 }, 0.1, 0, true), "leaf"),
      fern: leafMaterial(frondTexture(), 0.05, 0, 0.6),
      bush: leafMaterial(leafClusterTexture(), 0.025),
      bushCore: detailed(swayMaterial({ roughness: 1 }, 0.025), "leaf"),
      flower: detailed(new MeshStandardMaterial({ flatShading: true, roughness: 0.6 }), "leaf", 0.15),
      stone: detailed(new MeshStandardMaterial({ flatShading: true, roughness: 1 }), "rock"),
      trunk: detailed(new MeshStandardMaterial({ flatShading: true, roughness: 1 }), "bark"),
      banana: leafMaterial(broadLeafTexture(), 0.06, -1, 0.75),
      creeper: detailed(new MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), "leaf"),
    }),
    [],
  );
  const tints = useMemo(() => {
    const FLOWERS = ["#e63946", "#ffd166", "#ffffff", "#ff8fab", "#ff7b00"];
    return {
      short: ((i, c, p) => c.setHSL(0.23 + grain(i, 1) * 0.06 + patch(p.x, p.z) * 0.02, 0.5, 0.4 + grain(i, 2) * 0.12)) as Tint,
      medium: ((i, c) => c.setHSL(0.22 + grain(i, 3) * 0.07, 0.48, 0.36 + grain(i, 4) * 0.1)) as Tint,
      // Cỏ tranh ngả màu rơm; lau sậy quanh hồ xanh đậm hơn.
      tall: ((i, c, p) => {
        const reed = Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.radius + 12;
        if (reed) return c.setHSL(0.26 + grain(i, 5) * 0.04, 0.45, 0.32 + grain(i, 6) * 0.08);
        // Pha lẫn khóm xanh và khóm ngả vàng cho giống cỏ tranh ngoài nắng.
        const dry = grain(i, 7);
        return c.setHSL(0.2 - dry * 0.07, 0.42 + dry * 0.08, 0.38 + grain(i, 6) * 0.1 + dry * 0.06);
      }) as Tint,
      fern: ((i, c) => c.setHSL(0.27 + grain(i, 8) * 0.05, 0.48, 0.34 + grain(i, 9) * 0.08)) as Tint,
      bush: ((i, c) => c.setHSL(0.23 + grain(i, 10) * 0.08, 0.4, 0.3 + grain(i, 11) * 0.1)) as Tint,
      bushCore: ((i, c) => c.setHSL(0.25 + grain(i, 10) * 0.06, 0.4, 0.13)) as Tint,
      flower: ((i, c) => c.set(FLOWERS[Math.floor(i / 4) % FLOWERS.length]!)) as Tint,
      rock: ((i, c) => c.setHSL(0.08, 0.06, 0.36 + grain(i, 12) * 0.16)) as Tint,
      shell: ((i, c) => c.setHSL(0.05 + grain(i, 13) * 0.08, 0.5, 0.82)) as Tint,
      driftwood: ((i, c) => c.setHSL(0.08, 0.18, 0.55 + grain(i, 14) * 0.12)) as Tint,
      bananaStem: ((i, c) => c.setHSL(0.2 + grain(i, 15) * 0.04, 0.35, 0.33)) as Tint,
      // Lá chuối xanh non, thỉnh thoảng có cây ngả vàng úa.
      banana: ((i, c) => c.setHSL(0.24 - (grain(i, 16) < 0.15 ? 0.08 : 0) + grain(i, 17) * 0.04, 0.5, 0.4 + grain(i, 18) * 0.08)) as Tint,
      pandan: ((i, c) => c.setHSL(0.24 + grain(i, 19) * 0.05, 0.4, 0.3 + grain(i, 20) * 0.08)) as Tint,
      beachGrass: ((i, c) => c.setHSL(0.16 + grain(i, 21) * 0.06, 0.4, 0.5 + grain(i, 22) * 0.1)) as Tint,
      creeper: ((i, c) => c.setHSL(0.3 + grain(i, 23) * 0.05, 0.45, 0.25 + grain(i, 24) * 0.07)) as Tint,
    };
  }, []);


  return (
    <>
      <Instances spots={spots.short} geometry={geo.short} material={mats.grass} tint={tints.short} heightScale farthest={far(80)} />
      <Instances spots={spots.medium} geometry={geo.medium} material={mats.grass} tint={tints.medium} heightScale farthest={far(110)} />
      <Instances spots={spots.tall} geometry={geo.tall} material={mats.tall} tint={tints.tall} heightScale farthest={far(220)} />
      <Instances spots={spots.ferns} geometry={geo.fern} material={mats.fern} tint={tints.fern} farthest={far(140)} />
      <Instances spots={spots.bushes} geometry={geo.bush.leaves} material={mats.bush} tint={tints.bush} cast farthest={far(240)} />
      <Instances spots={spots.bushes} geometry={geo.bush.core} material={mats.bushCore} tint={tints.bushCore} farthest={far(240)} />
      <Instances spots={spots.flowers} geometry={geo.flower} material={mats.flower} tint={tints.flower} farthest={far(90)} />
      <Instances spots={spots.rocks} geometry={geo.rock} material={mats.stone} tint={tints.rock} cast farthest={far(190)} />
      <Instances spots={spots.shells} geometry={geo.shell} material={mats.stone} tint={tints.shell} farthest={far(70)} />
      <Instances spots={spots.driftwood} geometry={geo.driftwood} material={mats.stone} tint={tints.driftwood} cast farthest={far(170)} />
      <Instances spots={spots.bananas} geometry={geo.bananaStem} material={mats.trunk} tint={tints.bananaStem} farthest={far(230)} />
      <Instances spots={spots.bananas} geometry={geo.bananaLeaves} material={mats.banana} tint={tints.banana} cast farthest={far(230)} />
      <Instances spots={spots.pandans} geometry={geo.pandan} material={mats.tall} tint={tints.pandan} farthest={far(210)} />
      <Instances spots={spots.beachGrass} geometry={geo.beachGrass} material={mats.grass} tint={tints.beachGrass} heightScale farthest={far(90)} />
      <Instances spots={spots.creepers} geometry={geo.creeper} material={mats.creeper} tint={tints.creeper} farthest={far(90)} />
    </>
  );
}
