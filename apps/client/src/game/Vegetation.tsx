import { useLayoutEffect, useMemo, useRef } from "react";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ANCHORS,
  CAMP,
  CAVE,
  LAKE,
  PALMS,
  TALL_GRASS,
  TREASURE_SITES,
  heightAt,
  shoreRadius,
  zoneAt,
  type GrassPatch,
} from "@tentides/content";
import { useQuality } from "./graphics.ts";
import { grain, mulberry32, patch, swayMaterial } from "./nature.ts";

// Cây cỏ của đảo hoang: cỏ thấp phủ khắp, cỏ vừa, đám cỏ tranh cao (ngồi vào là nấp được),
// lau sậy quanh hồ, dương xỉ dưới tán dừa, bụi rậm có hoa, cây rừng tán rộng và gỗ trôi dạt.
// Tất cả dùng InstancedMesh; chỉ cây rừng có va chạm (số lượng cố định, không đổi theo chất lượng).

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
  const pos: number[] = [];
  const count = 9;
  for (let f = 0; f < count; f++) {
    const angle = (f / count) * Math.PI * 2 + (f % 2) * 0.3;
    const length = 1.1 + (f % 3) * 0.15;
    const point = (s: number, side: number) => {
      const along = s * length;
      const y = 0.9 * s - 0.9 * s * s * 1.1 + 0.05;
      const width = Math.sin(Math.PI * Math.min(1, s * 1.05)) * 0.22 * side;
      return [Math.cos(angle) * along - Math.sin(angle) * width, y - Math.abs(width) * 0.4, Math.sin(angle) * along + Math.cos(angle) * width];
    };
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const s0 = i / steps;
      const s1 = (i + 1) / steps;
      for (const side of [-1, 1]) {
        const a = point(s0, 0);
        const b = point(s1, 0);
        const c = point(s1, side);
        const d = point(s0, side);
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** Bụi rậm: vài khối đa diện chụm lại, rộng chừng 1,6 và cao chừng 1 đơn vị. */
function bush(): BufferGeometry {
  const parts = [
    [0, 0.5, 0, 0.62],
    [0.5, 0.38, 0.12, 0.48],
    [-0.42, 0.34, -0.18, 0.5],
    [0.1, 0.32, -0.5, 0.42],
    [-0.1, 0.8, 0.1, 0.4],
  ].map(([x, y, z, r]) => new IcosahedronGeometry(r!, 0).translate(x!, y!, z!));
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
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

const inland = (x: number, z: number) => shoreRadius(x, z) - Math.hypot(x, z);
const nearCamp = (x: number, z: number, d: number) => Math.hypot(x - CAMP.x, z - CAMP.z) < d;
const inLake = (x: number, z: number) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 1;
const clearOfPoints = (x: number, z: number, d: number) =>
  ANCHORS.every((a) => Math.hypot(a.x - x, a.z - z) > d) && TREASURE_SITES.every((t) => Math.hypot(t.x - x, t.z - z) > d);
/** Đất có cỏ mọc: trong đảo, không phải sườn núi lửa hay hang, không dưới nước. */
const grassy = (x: number, z: number, h: number) =>
  h > 0.6 && h < 9 && inland(x, z) > 12 && zoneAt(x, z) !== "volcano" && !inLake(x, z) && Math.hypot(x - CAVE.x, z - CAVE.z) > CAVE.radius - 2;

function scatter(count: number, seed: number, accept: (x: number, z: number, h: number, rand: () => number) => boolean, size: [number, number] = [0.7, 1.3]): Spot[] {
  const rand = mulberry32(seed);
  const out: Spot[] = [];
  for (let tries = 0; out.length < count && tries < count * 25; tries++) {
    const x = (rand() * 2 - 1) * 112;
    const z = (rand() * 2 - 1) * 112;
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

/** Cây rừng tán rộng mọc trong nội đảo; tránh điểm sự kiện, kho báu, trại, cây dừa, đám cỏ tranh. */
function jungleTrees(): Spot[] {
  const rand = mulberry32(41);
  const out: Spot[] = [];
  for (let tries = 0; out.length < 34 && tries < 3000; tries++) {
    const x = (rand() * 2 - 1) * 90;
    const z = (rand() * 2 - 1) * 90;
    const h = heightAt(x, z);
    if (!grassy(x, z, h) || inland(x, z) < 30) continue;
    if (nearCamp(x, z, 22) || !clearOfPoints(x, z, 7)) continue;
    if (TALL_GRASS.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 2)) continue;
    if (PALMS.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 9)) continue;
    out.push({ x, y: h, z, s: 0.8 + rand() * 0.5, h: 4.5 + rand() * 2.5, r: rand() * Math.PI * 2 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vẽ
// ---------------------------------------------------------------------------

type Tint = (i: number, c: Color, spot: Spot) => void;

function Instances({ spots, geometry, material, tint, heightScale = false, cast = false }: {
  spots: Spot[];
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  tint: Tint;
  /** Co giãn chiều cao theo `spot.h` (cỏ), không thì co đều theo `spot.s`. */
  heightScale?: boolean;
  cast?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new Object3D();
    const color = new Color();
    spots.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.r, 0);
      if (heightScale) dummy.scale.set(p.s, p.h, p.s);
      else dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      tint(i, color, p);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [spots, tint, heightScale]);
  if (spots.length === 0) return null;
  return <instancedMesh key={spots.length} ref={mesh} args={[geometry, material, spots.length]} castShadow={cast} receiveShadow />;
}

export function Vegetation() {
  const quality = useQuality();
  const density = quality === "high" ? 1 : 0.35;

  const spots = useMemo(() => {
    const d = (n: number) => Math.round(n * density);
    const underPalm = (x: number, z: number) => PALMS.some((p) => Math.hypot(p.x - x, p.z - z) < 4);
    const bushes = scatter(d(420), 12, (x, z, h, rand) => grassy(x, z, h) && !nearCamp(x, z, 11) && clearOfPoints(x, z, 3) && (inland(x, z) > 30 || rand() < 0.35), [0.6, 1.8]);
    return {
      // Cỏ thấp phủ khắp nơi có đất, thưa dần ra phía cát.
      short: scatter(d(9000), 11, (x, z, h, rand) => grassy(x, z, h) && (inland(x, z) > 16 || rand() < 0.3) && !nearCamp(x, z, 3.5), [0.7, 1.4]).map((p, i) => ({
        ...p,
        h: 0.25 + grain(i, 9) * 0.35 + Math.max(0, patch(p.x, p.z)) * 0.2,
      })),
      // Cỏ vừa mọc thành từng khóm lẻ, dày hơn ở bìa rừng.
      medium: scatter(d(1600), 15, (x, z, h, rand) => grassy(x, z, h) && inland(x, z) > 18 && !nearCamp(x, z, 5) && (patch(x, z) > -0.2 || rand() < 0.3), [0.8, 1.3]).map((p, i) => ({
        ...p,
        h: 0.6 + grain(i, 7) * 0.5,
      })),
      // Cỏ cao dùng để nấp nên dày như nhau ở mọi mức đồ hoạ (máy yếu không được lợi thế nhìn xuyên cỏ).
      tall: fillPatches(TALL_GRASS, 3.4, 16),
      ferns: scatter(d(520), 17, (x, z, h, rand) => grassy(x, z, h) && !nearCamp(x, z, 8) && clearOfPoints(x, z, 2.5) && (underPalm(x, z) || inland(x, z) > 38 || rand() < 0.15), [0.6, 1.3]),
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
      rocks: scatter(d(140), 13, (x, z, h) => h > -0.5 && clearOfPoints(x, z, 2) && (zoneAt(x, z) === "volcano" || zoneAt(x, z) === "cave" || inland(x, z) < 6), [0.4, 1.6]),
      shells: scatter(d(90), 14, (x, z, h) => h > 0.1 && h < 0.9, [0.8, 1.2]),
      driftwood: scatter(16, 18, (x, z, h) => h > 0.15 && h < 0.7 && !nearCamp(x, z, 8) && clearOfPoints(x, z, 3), [0.8, 1.6]),
    };
  }, [density]);
  // Cây rừng có va chạm nên không đổi theo chất lượng đồ hoạ.
  const trees = useMemo(jungleTrees, []);

  const geo = useMemo(
    () => ({
      short: grassClump(5, 1, 0.28, 0.08),
      medium: grassClump(9, 2, 0.3, 0.09),
      tall: grassClump(8, 3, 0.42, 0.15),
      fern: fern(),
      bush: bush(),
      flower: new IcosahedronGeometry(0.1, 0),
      rock: new DodecahedronGeometry(0.6, 0),
      shell: new CylinderGeometry(0, 0.12, 0.08, 5),
      driftwood: new CylinderGeometry(0.16, 0.2, 2.4, 6).rotateZ(Math.PI / 2).translate(0, 0.12, 0),
      trunk: new CylinderGeometry(0.22, 0.38, 1, 7).translate(0, 0.5, 0),
      canopy: canopy(),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      grass: swayMaterial({ vertexColors: true, side: DoubleSide, roughness: 1 }, 0.22, 0, true),
      tall: swayMaterial({ vertexColors: true, side: DoubleSide, roughness: 1 }, 0.1, 0, true),
      fern: swayMaterial({ flatShading: true, side: DoubleSide, roughness: 0.9 }, 0.05),
      bush: swayMaterial({ flatShading: true, roughness: 0.9 }, 0.025),
      flower: new MeshStandardMaterial({ flatShading: true, roughness: 0.6 }),
      stone: new MeshStandardMaterial({ flatShading: true, roughness: 1 }),
      trunk: new MeshStandardMaterial({ flatShading: true, roughness: 1 }),
      canopy: swayMaterial({ flatShading: true, roughness: 0.9 }, 0.004, 1),
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
      fern: ((i, c) => c.setHSL(0.29 + grain(i, 8) * 0.05, 0.5, 0.27 + grain(i, 9) * 0.08)) as Tint,
      bush: ((i, c) => c.setHSL(0.27 + grain(i, 10) * 0.07, 0.42, 0.22 + grain(i, 11) * 0.1)) as Tint,
      flower: ((i, c) => c.set(FLOWERS[Math.floor(i / 4) % FLOWERS.length]!)) as Tint,
      rock: ((i, c) => c.setHSL(0.08, 0.06, 0.36 + grain(i, 12) * 0.16)) as Tint,
      shell: ((i, c) => c.setHSL(0.05 + grain(i, 13) * 0.08, 0.5, 0.82)) as Tint,
      driftwood: ((i, c) => c.setHSL(0.08, 0.18, 0.55 + grain(i, 14) * 0.12)) as Tint,
      trunk: ((i, c) => c.setHSL(0.07, 0.35, 0.22 + grain(i, 15) * 0.06)) as Tint,
      canopy: ((i, c) => c.setHSL(0.27 + grain(i, 16) * 0.06, 0.45, 0.2 + grain(i, 17) * 0.07)) as Tint,
    };
  }, []);

  // Tán cây đặt trên ngọn thân (thân co giãn theo chiều cao riêng của từng cây).
  const canopies = useMemo(() => trees.map((t) => ({ ...t, y: t.y + t.h * 0.95 })), [trees]);

  return (
    <>
      <Instances spots={spots.short} geometry={geo.short} material={mats.grass} tint={tints.short} heightScale />
      <Instances spots={spots.medium} geometry={geo.medium} material={mats.grass} tint={tints.medium} heightScale />
      <Instances spots={spots.tall} geometry={geo.tall} material={mats.tall} tint={tints.tall} heightScale />
      <Instances spots={spots.ferns} geometry={geo.fern} material={mats.fern} tint={tints.fern} />
      <Instances spots={spots.bushes} geometry={geo.bush} material={mats.bush} tint={tints.bush} cast />
      <Instances spots={spots.flowers} geometry={geo.flower} material={mats.flower} tint={tints.flower} />
      <Instances spots={spots.rocks} geometry={geo.rock} material={mats.stone} tint={tints.rock} cast />
      <Instances spots={spots.shells} geometry={geo.shell} material={mats.stone} tint={tints.shell} />
      <Instances spots={spots.driftwood} geometry={geo.driftwood} material={mats.stone} tint={tints.driftwood} cast />
      <Instances spots={trees} geometry={geo.trunk} material={mats.trunk} tint={tints.trunk} heightScale cast />
      <Instances spots={canopies} geometry={geo.canopy} material={mats.canopy} tint={tints.canopy} cast />
      <RigidBody type="fixed" colliders={false}>
        {trees.map((t, i) => (
          <CylinderCollider key={i} args={[t.h / 2, 0.35 * t.s]} position={[t.x, t.y + t.h / 2, t.z]} />
        ))}
      </RigidBody>
    </>
  );
}
