import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, BufferAttribute, BufferGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from "three";
import { deckAt, halfBeamAt, shipToWorld, worldToShip, type ShipClass, type ShipPose } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { localPosition } from "../shared.ts";
import { puffs } from "../battle/gpuParticles.ts";

// Vết hư hại tích dần trên thân tàu: mỗi phát trúng để lại mảng cháy sém đúng chỗ trúng (theo mặt boong, mạn, vách
// thượng tầng gần nhất), phát mạnh khoét lỗ thủng đen viền tấm thép rách bẻ ra ngoài, lỗ thủng lâu lâu bốc khói; bộ
// phận bị phá huỷ thì quanh đó thủng lỗ chỗ. Vết gắn theo toạ độ riêng của tàu (tàu chạy, chìm thì vết đi theo).

export interface DamageMark {
  /** Toạ độ riêng của tàu, pháp tuyến mặt bị trúng. */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** Bán kính mảng cháy sém (m); lỗ thủng (0: không thủng). */
  scorch: number;
  hole: number;
  spin: number;
  born: number;
  /** Đã dò bề mặt thật của mô hình (dán vết đúng mặt vẽ, không chìm trong thân). */
  placed?: boolean;
}

const MAX_MARKS = 90;
const MAX_HOLES = 50;
const SHARDS_PER_HOLE = 5;

/** Vết hư hại từng tàu (khoá: id tàu). */
const marks = new Map<string, DamageMark[]>();
/** Đổi mỗi khi thêm vết (để cập nhật lại instance). */
const versions = new Map<string, number>();

/** Pháp tuyến mặt gần nhất của khối chứa điểm (toạ độ riêng); không trong khối nào thì theo mạn / boong. */
function surfaceNormal(cls: ShipClass, x: number, y: number, z: number): [number, number, number] {
  let best = Infinity;
  let n: [number, number, number] = [0, 1, 0];
  for (const b of cls.boxes) {
    if (b.pitch || b.mat === "rail") continue;
    const dx = x - b.x;
    const dy = y - b.y;
    const dz = z - b.z;
    const m = 1.2;
    if (Math.abs(dx) > b.w / 2 + m || Math.abs(dy) > b.h / 2 + m || Math.abs(dz) > b.d / 2 + m) continue;
    const faces: [number, [number, number, number]][] = [
      [Math.abs(b.w / 2 - Math.abs(dx)), [Math.sign(dx) || 1, 0, 0]],
      [Math.abs(b.h / 2 - Math.abs(dy)), [0, Math.sign(dy) || 1, 0]],
      [Math.abs(b.d / 2 - Math.abs(dz)), [0, 0, Math.sign(dz) || 1]],
    ];
    for (const [d, f] of faces) {
      // Mặt dưới (đáy khối) không ai thấy: bỏ.
      if (f[1] < 0) continue;
      if (d < best) {
        best = d;
        n = f;
      }
    }
  }
  if (best === Infinity) n = Math.abs(x) > cls.beam * 0.3 ? [Math.sign(x), 0, 0] : [0, 1, 0];
  return n;
}

/** Thêm vết hư hại cho tàu `id` ở điểm thế giới `at`, sát thương `dmg`. */
export function addDamageMark(id: string, cls: ShipClass, pose: ShipPose, at: readonly [number, number, number], dmg: number) {
  const [lx, ly0, lz] = worldToShip(pose, at[0], at[1], at[2]);
  // Ngư lôi, bom chìm nổ dưới nước: vết hiện ở mạn ngay trên mặt nước (dưới nước không ai thấy).
  const ly = Math.max(ly0, 0.6 - (pose.y ?? 0) + Math.random() * 1.2);
  if (![lx, ly, lz, dmg].every(Number.isFinite)) return;
  const [nx, ny, nz] = surfaceNormal(cls, lx, ly, lz);
  const list = marks.get(id) ?? [];
  const scorch = Math.min(6.5, 1.1 + dmg / 110);
  const hole = dmg >= 170 ? Math.min(2.6, 0.6 + dmg / 350) : 0;
  list.push({ x: lx, y: ly, z: lz, nx, ny, nz, scorch, hole, spin: Math.random() * Math.PI * 2, born: performance.now() / 1000 });
  // Quá nhiều: bỏ bớt vết sém nhỏ cũ nhất (giữ lỗ thủng).
  if (list.length > MAX_MARKS) {
    const i = list.findIndex((m) => m.hole === 0);
    list.splice(i >= 0 ? i : 0, 1);
  }
  marks.set(id, list);
  versions.set(id, (versions.get(id) ?? 0) + 1);
}

/** Bộ phận bị phá huỷ: thủng lỗ chỗ quanh đó. */
export function wreckMarks(id: string, cls: ShipClass, pose: ShipPose, partId: string) {
  const part = cls.parts.find((p) => p.id === partId);
  if (!part) return;
  for (let k = 0; k < 4; k++) {
    const [x, y, z] = shipToWorld(pose, part.at[0] + (Math.random() - 0.5) * part.r * 1.6, part.at[1] + (Math.random() - 0.3) * part.r, part.at[2] + (Math.random() - 0.5) * part.r * 1.6);
    addDamageMark(id, cls, pose, [x, y, z], 220 + Math.random() * 200);
  }
}

/**
 * Mảng méo (không tròn đều), nằm trong mặt XY hướng +Z: lõi đặc (màu `core`), vòng trong, vòng ngoài răng cưa mờ dần
 * ra rìa (màu `rim`, trong suốt dần) — vết cháy sém loang chứ không phải miếng dán viền sắc.
 */
function blob(seed: number, core: [number, number, number], rim: [number, number, number], edge: number): BufferGeometry {
  const n = 12;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos: number[] = [0, 0, 0];
  const col: number[] = [...core, 1];
  const jag: number[] = [];
  for (let i = 0; i < n; i++) jag.push(0.7 + rnd() * 0.4);
  for (const [k, ring] of [0.5, 1].entries()) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (ring === 1 ? (rnd() - 0.5) * 0.25 : 0);
      const r = ring * jag[i]! * (ring === 1 ? 0.85 + rnd() * 0.3 : 1);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      if (k === 0) col.push(core[0] * 0.6 + rim[0] * 0.4, core[1] * 0.6 + rim[1] * 0.4, core[2] * 0.6 + rim[2] * 0.4, 0.92);
      else col.push(...rim, edge);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % n);
    idx.push(0, a, b);
    const c = 1 + n + i;
    const d = 1 + n + ((i + 1) % n);
    idx.push(a, c, d, a, d, b);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 4));
  // Mảng phẳng: pháp tuyến đặt thẳng +Z (tính từ tam giác có thể ra 0 ở đỉnh suy biến → NaN trong shader, lan qua bloom
  // làm đen cả màn hình).
  const normals = new Float32Array((pos.length / 3) * 3);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setIndex(idx);
  return g;
}

function darkMat(color: string, offset: number, soft = false): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color,
    roughness: 1,
    metalness: 0,
    vertexColors: soft,
    transparent: soft,
    depthWrite: !soft,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
  m.userData.detail = "none";
  return m;
}

const _o = new Object3D();

/**
 * Dán vết lên bề mặt nhìn thấy (rẻ, không dò tia lưới): trúng boong / nóc thì lấy mặt trên cao nhất của khối nhìn thấy
 * ngay dưới chỗ trúng (không có thì mặt boong thân); trúng mạn thì mặt ngoài cùng của khối ở độ cao đó, dưới boong thì
 * đường mạn thân tàu (vách nhà chứa máy bay của tàu sân bay lùi vào một chút); trúng vách trước / sau thì mặt khối.
 */
function place(m: DamageMark, cls: ShipClass) {
  m.placed = true;
  const h = cls.hull;
  const vis = cls.boxes.filter((b) => !b.hidden && !b.pitch && b.mat !== "rail");
  if (m.ny > 0.5) {
    let top = h ? deckAt(h, m.z) : cls.deck;
    for (const b of vis) {
      if (Math.abs(m.x - b.x) > b.w / 2 || Math.abs(m.z - b.z) > b.d / 2) continue;
      const t = b.y + b.h / 2;
      if (t <= m.y + 1.5 && t > top) top = t;
    }
    m.y = top + 0.03;
    return;
  }
  if (Math.abs(m.nx) > 0.5) {
    const sd = Math.sign(m.nx);
    let edge = -Infinity;
    for (const b of vis) {
      if (Math.abs(m.y - b.y) > b.h / 2 || Math.abs(m.z - b.z) > b.d / 2) continue;
      const f = sd * (b.x + (sd * b.w) / 2);
      if (f <= sd * m.x + 1.5 && f > edge) edge = f;
    }
    if (edge === -Infinity && h) edge = halfBeamAt(h, m.z) - (m.y > deckAt(h, m.z) + 0.5 ? 0.35 : 0);
    if (Number.isFinite(edge)) m.x = sd * (edge + 0.03);
    return;
  }
  const sd = Math.sign(m.nz);
  let edge = -Infinity;
  for (const b of vis) {
    if (Math.abs(m.y - b.y) > b.h / 2 || Math.abs(m.x - b.x) > b.w / 2) continue;
    const f = sd * (b.z + (sd * b.d) / 2);
    if (f <= sd * m.z + 1.5 && f > edge) edge = f;
  }
  if (Number.isFinite(edge)) m.z = sd * (edge + 0.03);
}
const _q = new Quaternion();
const _n = new Vector3();
const _z = new Vector3(0, 0, 1);
const _t = new Vector3();

export function ShipDamage({ room, id, cls, pose }: { room: IslandRoom; id: string; cls: ShipClass; pose: () => ShipPose | undefined }) {
  const scorch = useRef<InstancedMesh>(null);
  const holes = useRef<InstancedMesh>(null);
  const shards = useRef<InstancedMesh>(null);
  const seen = useRef(-1);
  const smokeAt = useRef(0);
  const geo = useMemo(
    () => ({
      scorch: blob(7, [0.006, 0.005, 0.0045], [0.03, 0.026, 0.022], 0),
      hole: blob(31, [0.001, 0.001, 0.001], [0.012, 0.009, 0.007], 0.75),
      shard: new BoxGeometry(1, 1, 1),
    }),
    [],
  );
  const mat = useMemo(() => ({ scorch: darkMat("#ffffff", -3, true), hole: darkMat("#ffffff", -5, true), shard: darkMat("#3a3633", -1) }), []);
  useEffect(
    () => () => {
      marks.delete(id);
      versions.delete(id);
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => m.dispose());
    },
    [id, geo, mat],
  );

  useFrame((_, dt) => {
    const s = room.state.naval?.ships.get(id);
    // Trận mới (tàu đầy máu lại): xoá vết cũ.
    if (s && s.hp >= s.maxHp && marks.get(id)?.length) {
      marks.delete(id);
      versions.set(id, (versions.get(id) ?? 0) + 1);
    }
    const list = marks.get(id) ?? [];
    // Vết mới: dán lên bề mặt nhìn thấy.
    for (const m of list) {
      if (m.placed) continue;
      place(m, cls);
      versions.set(id, (versions.get(id) ?? 0) + 1);
    }
    const v = versions.get(id) ?? 0;
    if (v !== seen.current && scorch.current && holes.current && shards.current) {
      seen.current = v;
      let nh = 0;
      let ns = 0;
      let ni = 0;
      list.forEach((m) => {
        if (!m.placed) return;
        const i = ni++;
        _n.set(m.nx, m.ny, m.nz);
        _q.setFromUnitVectors(_z, _n);
        _o.quaternion.copy(_q);
        _o.rotateZ(m.spin);
        _o.position.set(m.x + m.nx * 0.05, m.y + m.ny * 0.05, m.z + m.nz * 0.05);
        _o.scale.setScalar(m.scorch);
        _o.updateMatrix();
        scorch.current!.setMatrixAt(i, _o.matrix);
        if (m.hole > 0 && nh < MAX_HOLES) {
          _o.position.set(m.x + m.nx * 0.08, m.y + m.ny * 0.08, m.z + m.nz * 0.08);
          _o.scale.setScalar(m.hole);
          _o.updateMatrix();
          holes.current!.setMatrixAt(nh++, _o.matrix);
          // Tấm thép rách quanh lỗ, bẻ chìa ra ngoài.
          for (let k = 0; k < SHARDS_PER_HOLE; k++) {
            const a = m.spin + (k / SHARDS_PER_HOLE) * Math.PI * 2;
            _o.quaternion.copy(_q);
            _o.rotateZ(a);
            _o.rotateY(-0.9 - ((k * 37) % 5) * 0.12);
            _o.position.set(m.x, m.y, m.z);
            _t.set(Math.cos(a), Math.sin(a), 0).applyQuaternion(_q).multiplyScalar(m.hole * 0.95);
            _o.position.add(_t).addScaledVector(_n, m.hole * 0.25);
            _o.scale.set(m.hole * 0.75, m.hole * 0.42, 0.08);
            _o.updateMatrix();
            shards.current!.setMatrixAt(ns++, _o.matrix);
          }
        }
      });
      scorch.current.count = ni;
      holes.current.count = nh;
      shards.current.count = ns;
      scorch.current.instanceMatrix.needsUpdate = true;
      holes.current.instanceMatrix.needsUpdate = true;
      shards.current.instanceMatrix.needsUpdate = true;
    }
    // Lỗ thủng bốc khói (lâu lâu một cuộn, lỗ mới khói dày hơn).
    smokeAt.current += dt;
    if (smokeAt.current < 0.12 || !s || s.sunk) return;
    smokeAt.current = 0;
    const p = pose();
    if (!p || Math.hypot(p.x - localPosition.x, p.z - localPosition.z) > 900) return;
    const now = performance.now() / 1000;
    for (const m of list) {
      if (m.hole <= 0) continue;
      const fresh = Math.max(0, 1 - (now - m.born) / 40);
      if (Math.random() > 0.06 + 0.25 * fresh) continue;
      const [x, y, z] = shipToWorld(p, m.x + m.nx * m.hole, m.y + m.ny * m.hole, m.z + m.nz * m.hole);
      puffs.push({
        x,
        y: Math.max(0.6, y),
        z,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 1.6 + Math.random(),
        vz: (Math.random() - 0.5) * 0.6,
        size: 0.8 + m.hole * 0.5,
        grow: 1.6,
        life: 3 + Math.random() * 2,
        age: 0,
        r: 0.16,
        g: 0.15,
        b: 0.15,
        alpha: 0.32 + 0.25 * fresh,
        dense: false,
      });
    }
  });

  return (
    <>
      <instancedMesh ref={scorch} args={[geo.scorch, mat.scorch, MAX_MARKS]} frustumCulled={false} count={0} />
      <instancedMesh ref={holes} args={[geo.hole, mat.hole, MAX_HOLES]} frustumCulled={false} count={0} />
      <instancedMesh ref={shards} args={[geo.shard, mat.shard, MAX_HOLES * SHARDS_PER_HOLE]} frustumCulled={false} count={0} castShadow />
    </>
  );
}
