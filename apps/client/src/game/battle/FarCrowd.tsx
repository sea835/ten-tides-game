import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, CapsuleGeometry, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Group, type Material } from "three";
import { withRim } from "../character/rim.ts";
import { getGraphics } from "../graphics.ts";

// Đám đông vẽ chung (instancing). Nhân vật đầy đủ (Character) tốn khoảng 70 khối vẽ cộng 60 khối đổ bóng mỗi người, mỗi
// khối là một lệnh vẽ CPU phải gửi đi; lúc xuất phát cạnh căn cứ có vài chục đồng đội đứng quanh là hàng nghìn lệnh vẽ
// mỗi khung hình (máy giật vì CPU, không phải vì card đồ hoạ). Giờ chỉ vài người GẦN NHẤT (theo mức đồ hoạ, `fullBudget`)
// được vẽ đầy đủ; mọi người còn lại là hình người gọn (chân, tay, thân, đầu, mũ, băng tay, súng) dùng chung 9 khối
// instanced: mỗi khung chỉ ghép ma trận từng người (vị trí, hướng, tư thế, nhịp bước chân), GPU vẽ cả đám đông bằng
// 9 lệnh vẽ (đổ bóng cũng 9 lệnh). Dấu đồng đội trên đầu (hình thoi xanh) cũng vẽ chung một lệnh.

export type CrowdPose = "stand" | "crouch" | "prone";

/** Một người vẽ trong đám đông: nhóm gốc (vị trí, ẩn hiện), nhóm quay theo hướng nhìn, tư thế, màu áo, băng tay, súng. */
export interface CrowdEntry {
  root: Group;
  yaw: Group;
  pose: CrowdPose;
  cloth: string;
  band?: string;
  gun: boolean;
}

interface Gait {
  phase: number;
  amount: number;
  x: number;
  z: number;
}

const crowd = new Map<string, CrowdEntry>();
const gaits = new Map<string, Gait>();
/** Dấu đồng đội: nhóm gốc của người đó và độ cao dấu so với chân. */
const mates = new Map<string, { root: Group; y: number }>();
/** Nhóm gốc của mọi người khác (để xếp ai gần camera nhất). */
const roots = new Map<string, Group>();
/** Thứ hạng gần camera (0 là gần nhất) của người đang hiện; tính lại vài lần mỗi giây. */
const ranks = new Map<string, number>();

export function setCrowd(id: string, e: CrowdEntry | null) {
  if (e) crowd.set(id, e);
  else {
    crowd.delete(id);
    gaits.delete(id);
  }
}

export function setMateMark(id: string, e: { root: Group; y: number } | null) {
  if (e) mates.set(id, e);
  else mates.delete(id);
}

export function setRemoteRoot(id: string, root: Group | null) {
  if (root) roots.set(id, root);
  else {
    roots.delete(id);
    ranks.delete(id);
  }
}

/** Thứ hạng gần camera của người này (Infinity nếu đang ẩn). */
export function crowdRank(id: string): number {
  return ranks.get(id) ?? Infinity;
}

/** Số người tối đa được vẽ nhân vật đầy đủ cùng lúc, theo mức đồ hoạ. */
export function fullBudget(): number {
  // Bản dev: window.__fullBudget ép số nhân vật đầy đủ (vd. 0 để soi hình người instanced ở gần).
  const forced = import.meta.env.DEV ? (window as unknown as { __fullBudget?: number }).__fullBudget : undefined;
  if (forced !== undefined) return forced;
  const q = getGraphics().quality;
  return q === "high" ? 12 : q === "medium" ? 8 : 5;
}

/** Số nhân vật đầy đủ gần nhất được đổ bóng riêng (người khác đổ bóng qua đám đông instanced). */
export const SHADOW_BUDGET = 4;

/** Màu áo ngụy trang nhìn từ xa. */
export const OUTFIT_COLOR: Record<string, string> = {
  woodland: "#4c5a36",
  desert: "#b59a6a",
  urban: "#6b6e70",
  digital: "#5d6a6f",
  snow: "#d8dcde",
  ghillie: "#56642f",
};

const MAX = 160;

/** Bộ phận: hình, màu (theo áo / băng tay / da / kim loại / mũ), điểm khớp (hông, vai) để xoay khi bước. */
type Tint = "cloth" | "band" | "skin" | "metal" | "helmet";
const legGeo = new BoxGeometry(0.15, 0.84, 0.17).translate(0, -0.42, 0);
const armGeo = new BoxGeometry(0.11, 0.62, 0.12).translate(0, -0.29, 0);
const PARTS: { geo: BufferGeometry; tint: Tint; shadow: boolean }[] = [
  { geo: legGeo, tint: "cloth", shadow: true }, // 0 chân phải
  { geo: legGeo, tint: "cloth", shadow: true }, // 1 chân trái
  { geo: new CapsuleGeometry(0.2, 0.55, 3, 8), tint: "cloth", shadow: true }, // 2 thân
  { geo: armGeo, tint: "cloth", shadow: true }, // 3 tay phải
  { geo: armGeo, tint: "cloth", shadow: true }, // 4 tay trái
  { geo: new SphereGeometry(0.12, 8, 6), tint: "skin", shadow: true }, // 5 đầu
  { geo: new SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), tint: "helmet", shadow: true }, // 6 mũ
  { geo: new BoxGeometry(0.46, 0.12, 0.34), tint: "band", shadow: false }, // 7 băng tay
  { geo: new BoxGeometry(0.06, 0.1, 0.82), tint: "metal", shadow: true }, // 8 súng
];

const _e = new Euler();
const _q = new Quaternion();
const _v = new Vector3();
const _one = new Vector3(1, 1, 1);
const _root = new Matrix4();
const _inner = new Matrix4();
const _part = new Matrix4();
const _m = new Matrix4();
const _c = new Color();
const SKIN = new Color("#c79a78");
const METAL = new Color("#222325");
const HELMET = new Color("#3e4632");
const counts = new Int32Array(PARTS.length);
const MATE_GEO = new OctahedronGeometry(0.16, 0);

/** Ma trận bộ phận: dời tới khớp (x, y, z), xoay quanh trục ngang `rx` (và nghiêng `rz`). */
function joint(out: Matrix4, x: number, y: number, z: number, rx = 0, rz = 0): Matrix4 {
  _q.setFromEuler(_e.set(rx, 0, rz));
  return out.compose(_v.set(x, y, z), _q, _one);
}

export function FarCrowd() {
  const { meshes, mateMesh } = useMemo(() => {
    // Một vật liệu trắng dùng chung, màu riêng từng người lấy từ màu instance.
    const mat = withRim(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }));
    mat.userData.detail = "none";
    const meshes = PARTS.map((part) => {
      const m = new InstancedMesh(part.geo, mat as Material, MAX);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = part.shadow;
      // Có màu instance ngay từ đầu để shader dịch một lần (thêm sau thì phải dịch lại).
      m.setColorAt(0, _c.set("#ffffff"));
      return m;
    });
    const mateMesh = new InstancedMesh(MATE_GEO, new MeshBasicMaterial({ color: "#6fb0ff", fog: false, depthTest: false, transparent: true, opacity: 0.9 }), 64);
    mateMesh.count = 0;
    mateMesh.frustumCulled = false;
    mateMesh.renderOrder = 5;
    return { meshes, mateMesh };
  }, []);
  useEffect(
    () => () => {
      (meshes[0]!.material as Material).dispose();
      (mateMesh.material as Material).dispose();
      meshes.forEach((m) => m.dispose());
      mateMesh.dispose();
    },
    [meshes, mateMesh],
  );

  const rankAt = useMemo(() => ({ next: 0 }), []);
  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    // Xếp hạng gần camera (4 lần mỗi giây): ai được vẽ đầy đủ, ai đổ bóng riêng.
    if (clock.elapsedTime >= rankAt.next) {
      rankAt.next = clock.elapsedTime + 0.25;
      const list: [string, number][] = [];
      for (const [id, r] of roots) if (r.visible && r.parent) list.push([id, r.position.distanceToSquared(camera.position)]);
      list.sort((a, b) => a[1] - b[1]);
      ranks.clear();
      list.forEach(([id], k) => ranks.set(id, k));
    }

    counts.fill(0);
    for (const [id, e] of crowd) {
      if (!e.root.visible || !e.root.parent) continue;
      const p = e.root.position;
      // Nhịp bước: đo tốc độ từ vị trí đang vẽ, chân tay đánh theo.
      let g = gaits.get(id);
      if (!g) gaits.set(id, (g = { phase: Math.random() * 6, amount: 0, x: p.x, z: p.z }));
      const speed = dt > 0 ? Math.hypot(p.x - g.x, p.z - g.z) / dt : 0;
      g.x = p.x;
      g.z = p.z;
      g.amount += ((speed > 0.6 && e.pose !== "prone" ? 1 : 0) - g.amount) * Math.min(1, dt * 8);
      g.phase += dt * Math.min(12, 2.2 + speed * 1.15);
      const swing = Math.sin(g.phase) * 0.55 * g.amount;

      _q.setFromAxisAngle(_v.set(0, 1, 0), e.yaw.rotation.y);
      _root.compose(p, _q, _one);
      const prone = e.pose === "prone";
      const crouch = e.pose === "crouch";
      _inner.compose(_v.set(0, prone ? 0.15 : crouch ? -0.38 : 0, prone ? -0.9 : 0), _q.setFromEuler(_e.set(prone ? 1.45 : 0, 0, 0)), _one);
      _root.multiply(_inner);
      const hip = crouch ? 0.72 : 0.9;
      for (let k = 0; k < PARTS.length; k++) {
        const part = PARTS[k]!;
        if (part.tint === "band" && !e.band) continue;
        if (k === 8 && !e.gun) continue;
        switch (k) {
          case 0:
            joint(_part, 0.1, hip, crouch ? 0.15 : 0, crouch ? -0.9 : swing);
            break;
          case 1:
            joint(_part, -0.1, hip, 0, crouch ? 0.1 : -swing);
            break;
          case 2:
            joint(_part, 0, 1.3, 0);
            break;
          case 3:
            // Tay phải: cầm súng thì giơ ra trước, không thì đánh ngược nhịp chân. Nằm: hai tay duỗi về phía đầu.
            joint(_part, 0.27, 1.56, 0, prone ? -2.75 : e.gun ? -1.25 : -swing * 0.8, 0.08);
            break;
          case 4:
            joint(_part, -0.27, 1.56, e.gun ? 0.02 : 0, prone ? -2.6 : e.gun ? -1.45 : swing * 0.8, prone ? 0.25 : e.gun ? 0.45 : -0.08);
            break;
          case 5:
            joint(_part, 0, 1.79, 0.02);
            break;
          case 6:
            joint(_part, 0, 1.82, 0.01);
            break;
          case 7:
            joint(_part, 0, 1.42, 0);
            break;
          default:
            // Súng: đứng, ngồi thì chĩa ra trước ngực; nằm thì nằm dọc theo người, nòng chĩa về phía trước đầu.
            if (prone) joint(_part, 0.12, 1.95, 0.12, -Math.PI / 2);
            else joint(_part, 0.1, 1.32, 0.42);
        }
        const i = counts[k]!;
        if (i >= MAX) continue;
        counts[k] = i + 1;
        const mesh = meshes[k]!;
        mesh.setMatrixAt(i, _m.multiplyMatrices(_root, _part));
        mesh.setColorAt(i, part.tint === "cloth" ? _c.set(e.cloth) : part.tint === "band" ? _c.set(e.band!) : part.tint === "skin" ? SKIN : part.tint === "helmet" ? HELMET : METAL);
      }
    }
    meshes.forEach((m, k) => {
      m.count = counts[k]!;
      if (m.count) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
    let n = 0;
    for (const e of mates.values()) {
      if (!e.root.visible || !e.root.parent || n >= 64) continue;
      mateMesh.setMatrixAt(n++, _m.makeTranslation(e.root.position.x, e.root.position.y + e.y, e.root.position.z));
    }
    mateMesh.count = n;
    if (n) mateMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
      <primitive object={mateMesh} />
    </>
  );
}
