import { useEffect, useMemo } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STRUCTURE_WALL, structureSlabs, type Slab, type Structure, type World } from "@tentides/content";
import { grain, mulberry32 } from "./nature.ts";
import { detailed } from "./textures.ts";

// Hang động và hầm mỏ sinh theo seed. Va chạm là các khối hộp (vách, trần); phần nhìn thấy là đá lởm chởm
// phủ ngoài, cộng đồ trang trí gộp chung theo vật liệu để mỗi hang chỉ tốn vài lần vẽ:
// hang có nhũ đá, măng đá, nấm phát sáng; hầm mỏ có khung gỗ chống lò, đường ray, xe goòng, đèn và mạch quặng.

/** Gom nhiều hình khối cùng vật liệu thành một geometry. */
class Batch {
  private parts = new Map<string, BufferGeometry[]>();
  private m = new Matrix4();
  private q = new Quaternion();

  add(key: string, geometry: BufferGeometry, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    this.q.setFromEuler(new Euler(...rot));
    this.m.compose(new Vector3(...at), this.q, new Vector3(...scale));
    g.applyMatrix4(this.m);
    const list = this.parts.get(key) ?? [];
    list.push(g);
    this.parts.set(key, list);
  }

  build(): Map<string, BufferGeometry> {
    const out = new Map<string, BufferGeometry>();
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      merged.computeVertexNormals();
      out.set(key, merged);
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

/** Khối hộp chia nhỏ rồi xô lệch đỉnh theo toạ độ riêng của hang, nên các cạnh chung vẫn khép kín. */
function rockSlab(b: Slab, rough: number): BufferGeometry {
  const seg = (n: number) => Math.max(1, Math.round(n / 1.3));
  const su = b.su + 0.25;
  const sy = b.sy + 0.12;
  const sv = b.sv + 0.25;
  const g = new BoxGeometry(su, sy, sv, seg(su), seg(sy), seg(sv));
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i) + b.u;
    const wy = p.getY(i) + b.y;
    const wz = p.getZ(i) + b.v;
    p.setXYZ(
      i,
      wx + (grain(wx, wy + wz) - 0.5) * rough,
      wy + (grain(wy, wx - wz) - 0.5) * rough,
      wz + (grain(wz, wx + wy) - 0.5) * rough,
    );
  }
  const flat = g.toNonIndexed();
  g.dispose();
  return flat;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ORE_COLORS = ["#62f5c8", "#ffb347", "#d0e8ff", "#ff6bd6", "#9dff5c"];

const PALETTE = {
  cave: { wall: "#716b65", roof: "#5f5a55", mound: "#6f6a5f" },
  mine: { wall: "#6e5f50", roof: "#5a4c40", mound: "#5d7a3f" },
};

interface Dressing {
  rock: BufferGeometry;
  roof: BufferGeometry;
  parts: Map<string, BufferGeometry>;
  ore: string;
}

function buildStructure(s: Structure, slabs: Slab[]): Dressing {
  const rand = mulberry32(hashString(s.id + s.name));
  const cs = s.cellSize;
  const H = s.height;
  const open = new Set(s.cells.map(([i, j]) => `${i},${j}`));
  const walls = slabs.filter((b) => b.part === "wall");
  const roofs = slabs.filter((b) => b.part === "roof");
  const rock = mergeGeometries(walls.map((b) => rockSlab(b, 0.32)))!;
  const roofGeo = mergeGeometries(roofs.map((b) => rockSlab(b, 0.4)))!;
  rock.computeVertexNormals();
  roofGeo.computeVertexNormals();

  const batch = new Batch();
  const boulder = new DodecahedronGeometry(1, 1);
  const cone = new ConeGeometry(1, 1, 10);
  const box = new BoxGeometry(1, 1, 1);
  const cyl = new CylinderGeometry(1, 1, 1, 12);
  const gem = new OctahedronGeometry(1, 0);
  const ball = new SphereGeometry(1, 12, 8);
  const ore = ORE_COLORS[hashString(s.name) % ORE_COLORS.length]!;

  // Vỏ ngoài: tảng đá (hang) hoặc gò đất phủ cỏ (hầm mỏ) chất lên trần, cho giống một quả đồi.
  for (const [i, j] of s.cells) {
    const u = i * cs;
    const v = (j + 0.5) * cs;
    const r = cs * (0.55 + rand() * 0.25);
    batch.add("mound", boulder, [u + (rand() - 0.5), H + STRUCTURE_WALL + r * 0.25, v + (rand() - 0.5)], [rand(), rand() * 3, rand()], [r, r * (0.45 + rand() * 0.3), r]);
  }

  // Trang trí trong lòng, lấy mẫu theo từng ô.
  s.cells.forEach(([i, j], k) => {
    const u = i * cs;
    const v = (j + 0.5) * cs;
    const depth = s.depth[k]!;
    if (s.kind === "cave") {
      // Nhũ đá trên trần, măng đá dưới sàn (tránh giữa lối đi).
      for (let n = 0; n < 5; n++) {
        const du = (rand() - 0.5) * cs * 0.85;
        const dv = (rand() - 0.5) * cs * 0.85;
        const len = 0.5 + rand() * 1.2;
        batch.add("rock2", cone, [u + du, H - len / 2, v + dv], [Math.PI, 0, 0], [0.12 + rand() * 0.15, len, 0.12 + rand() * 0.15]);
        if (Math.abs(du) > cs * 0.25 && rand() < 0.5) {
          const up = 0.3 + rand() * 0.7;
          batch.add("rock2", cone, [u + du, up / 2, v + dv], [0, 0, 0], [0.15 + rand() * 0.1, up, 0.15 + rand() * 0.1]);
        }
      }
      // Nấm phát sáng ở các ô sâu.
      if (depth >= 2 || rand() < 0.3) {
        const cx = u + (rand() - 0.5) * cs * 0.6;
        const cz = v + (rand() - 0.5) * cs * 0.6;
        for (let n = 0; n < 6; n++) {
          const a = rand() * Math.PI * 2;
          const d = rand() * 0.6;
          const hgt = 0.12 + rand() * 0.25;
          batch.add("stem", cyl, [cx + Math.cos(a) * d, hgt / 2, cz + Math.sin(a) * d], [0, 0, 0], [0.025, hgt, 0.025]);
          batch.add(rand() < 0.5 ? "glowA" : "glowB", ball, [cx + Math.cos(a) * d, hgt, cz + Math.sin(a) * d], [0, 0, 0], [0.09, 0.05, 0.09]);
        }
      }
    } else {
      // Khung gỗ chống lò: bốn cột ở góc ô, xà ngang hai đầu.
      const e = cs / 2 - 0.25;
      for (const [pu, pv] of [
        [-e, -e],
        [e, -e],
        [-e, e],
        [e, e],
      ] as const) {
        batch.add("wood", box, [u + pu, H / 2, v + pv], [0, 0, (rand() - 0.5) * 0.05], [0.22, H, 0.22]);
      }
      for (const pv of [-e, e]) batch.add("wood", box, [u, H - 0.15, v + pv], [0, 0, 0], [cs - 0.3, 0.24, 0.24]);
      // Đường ray theo hướng hầm.
      const alongV = open.has(`${i},${j + 1}`) || open.has(`${i},${j - 1}`) || (i === 0 && j === 0);
      for (const side of [-0.45, 0.45]) {
        if (alongV) batch.add("metal", box, [u + side, 0.08, v], [0, 0, 0], [0.07, 0.06, cs]);
        else batch.add("metal", box, [u, 0.08, v + side], [0, 0, 0], [cs, 0.06, 0.07]);
      }
      for (let n = 0; n < 4; n++) {
        const t = -cs / 2 + (n + 0.5) * (cs / 4);
        if (alongV) batch.add("wood", box, [u, 0.03, v + t], [0, 0, 0], [1.3, 0.06, 0.22]);
        else batch.add("wood", box, [u + t, 0.03, v], [0, 0, 0], [0.22, 0.06, 1.3]);
      }
      // Đèn treo xà (chỉ phát sáng, không phải nguồn sáng thật).
      if (k % 2 === 0) {
        batch.add("wire", cyl, [u, H - 0.45, v - e], [0, 0, 0], [0.01, 0.4, 0.01]);
        batch.add("lamp", box, [u, H - 0.75, v - e], [0, 0, 0], [0.2, 0.26, 0.2]);
      }
    }
    // Mạch quặng lấp lánh trên vách (hầm mỏ nhiều hơn).
    const veins = s.kind === "mine" ? 3 : rand() < 0.4 ? 1 : 0;
    for (let n = 0; n < veins; n++) {
      const wall = walls[Math.floor(rand() * walls.length)]!;
      const inward = wall.su < wall.sv ? [Math.sign(u - wall.u) || 1, 0] : [0, Math.sign(v - wall.v) || 1];
      const off = STRUCTURE_WALL / 2 + 0.05;
      const cu = wall.u + inward[0]! * off + (wall.su > wall.sv ? (rand() - 0.5) * wall.su * 0.7 : 0);
      const cv = wall.v + inward[1]! * off + (wall.sv > wall.su ? (rand() - 0.5) * wall.sv * 0.7 : 0);
      const y = 0.6 + rand() * (H - 1.4);
      for (let q = 0; q < 3; q++) {
        const sz = 0.08 + rand() * 0.12;
        batch.add("ore", gem, [cu + (rand() - 0.5) * 0.4, y + (rand() - 0.5) * 0.4, cv + (rand() - 0.5) * 0.4], [rand() * 3, rand() * 3, 0], [sz, sz * 1.6, sz]);
      }
    }
  });

  // Cửa: hang có hai tảng đá nhọn và đuốc; hầm mỏ có khung cửa bằng gỗ và đèn.
  const door = cs / 2 - 0.2;
  if (s.kind === "cave") {
    for (const side of [-1, 1]) {
      batch.add("mound", boulder, [side * (door + 0.6), H * 0.6, -0.3], [rand(), rand(), rand()], [1.1, H * 0.7, 1]);
      batch.add("wood", cyl, [side * (door - 0.4), 2.1, 0.25], [0, 0, 0], [0.05, 1, 0.05]);
      batch.add("flame", cone, [side * (door - 0.4), 2.75, 0.25], [0, 0, 0], [0.13, 0.36, 0.13]);
    }
  } else {
    for (const side of [-1, 1]) batch.add("wood", box, [side * door, H / 2, 0.15], [0, 0, 0], [0.34, H, 0.34]);
    batch.add("wood", box, [0, H - 0.05, 0.15], [0, 0, 0], [cs + 0.3, 0.4, 0.4]);
    batch.add("sign", box, [0, H + 0.5, -0.1], [0.1, 0, 0], [2.2, 0.7, 0.08]);
    batch.add("lamp", box, [door - 0.5, H - 0.6, -0.1], [0, 0, 0], [0.22, 0.28, 0.22]);
    // Xe goòng ở cuối hầm.
    const deepest = s.depth.indexOf(Math.max(...s.depth));
    const [di, dj] = s.cells[deepest]!;
    const mu = di * cs;
    const mv = (dj + 0.5) * cs;
    batch.add("metal", box, [mu, 0.65, mv], [0, rand() * 0.4, 0], [1.1, 0.7, 1.6]);
    batch.add("oreHeap", boulder, [mu, 1.05, mv], [rand(), rand(), 0], [0.5, 0.25, 0.65]);
    for (const [wu, wv] of [
      [-0.55, -0.5],
      [0.55, -0.5],
      [-0.55, 0.5],
      [0.55, 0.5],
    ] as const) {
      batch.add("metal", cyl, [mu + wu, 0.22, mv + wv], [0, 0, Math.PI / 2], [0.2, 0.08, 0.2]);
    }
  }
  [boulder, cone, box, cyl, gem, ball].forEach((g) => g.dispose());
  return { rock, roof: roofGeo, parts: batch.build(), ore };
}

function StructureView({ s }: { s: Structure }) {
  const slabs = useMemo(() => structureSlabs(s), [s]);
  const dressing = useMemo(() => buildStructure(s, slabs), [s, slabs]);
  useEffect(
    () => () => {
      dressing.rock.dispose();
      dressing.roof.dispose();
      dressing.parts.forEach((g) => g.dispose());
    },
    [dressing],
  );
  const colors = PALETTE[s.kind];
  const mats = useMemo(() => {
    const glow = (c: string, i = 2) => new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, toneMapped: false, flatShading: true });
    return {
      mound: detailed(new MeshStandardMaterial({ color: colors.mound, flatShading: true, roughness: 1 }), "cliff"),
      rock2: detailed(new MeshStandardMaterial({ color: "#6a645d", flatShading: true, roughness: 1 }), "rock"),
      wood: detailed(new MeshStandardMaterial({ color: "#6b4a2b", flatShading: true, roughness: 1 }), "wood"),
      metal: detailed(new MeshStandardMaterial({ color: "#5a5f66", flatShading: true, metalness: 0.4, roughness: 0.6 }), "metal"),
      wire: new MeshStandardMaterial({ color: "#222" }),
      stem: new MeshStandardMaterial({ color: "#d8d2c0", flatShading: true }),
      sign: new MeshStandardMaterial({ color: "#8a6a42", flatShading: true }),
      oreHeap: detailed(new MeshStandardMaterial({ color: "#4a4038", flatShading: true }), "dirt"),
      lamp: glow("#ffb347", 2.4),
      flame: glow("#ff9a3a", 3),
      ore: glow(dressing.ore, 1.6),
      glowA: glow("#6ff7ff", 1.8),
      glowB: glow("#d58bff", 1.8),
    } as Record<string, MeshStandardMaterial>;
  }, [colors.mound, dressing.ore]);

  return (
    <RigidBody type="fixed" colliders={false} position={[s.x, s.floor, s.z]} rotation={[0, s.rot, 0]}>
      {slabs.map((b, i) => (
        <CuboidCollider key={i} args={[b.su / 2, b.sy / 2, b.sv / 2]} position={[b.u, b.y, b.v]} />
      ))}
      <mesh geometry={dressing.rock} castShadow receiveShadow>
        <meshStandardMaterial color={colors.wall} flatShading roughness={1} />
      </mesh>
      <mesh geometry={dressing.roof} castShadow receiveShadow>
        <meshStandardMaterial color={colors.roof} flatShading roughness={1} />
      </mesh>
      {[...dressing.parts.entries()].map(([key, geometry]) => (
        <mesh key={key} geometry={geometry} material={mats[key]} castShadow={key === "mound"} receiveShadow={key !== "ore"} />
      ))}
    </RigidBody>
  );
}

export function Structures({ world }: { world: World }) {
  return (
    <>
      {world.structures.map((s) => (
        <StructureView key={s.id} s={s} />
      ))}
    </>
  );
}
