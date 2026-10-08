import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, CapsuleGeometry, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Group, type Material } from "three";
import { withRim } from "../character/rim.ts";

// Đám đông ở xa vẽ chung (instancing): mỗi người ở xa (hàng chục mét) là một hình người gọn vài khối; trước đây mỗi
// người một nhóm 5–6 khối riêng, 80 người là gần 500 lệnh vẽ (trên Windows, mỗi lệnh vẽ qua ANGLE/Direct3D đắt hơn
// hẳn). Giờ mọi người ở xa dùng chung 6 khối instanced (chân trái, chân phải, thân, đầu, băng tay, súng): mỗi khung
// hình ghép ma trận từng người (vị trí, hướng, tư thế đứng / ngồi / nằm) vào đúng ô của họ, cả đám đông chỉ 6 lệnh vẽ.
// Dấu đồng đội trên đầu (hình thoi xanh) cũng vẽ chung một lệnh.

export type CrowdPose = "stand" | "crouch" | "prone";

/** Một người ở xa: nhóm gốc (vị trí, ẩn hiện), nhóm quay theo hướng nhìn, tư thế, màu áo, màu băng tay, có súng. */
export interface CrowdEntry {
  root: Group;
  yaw: Group;
  pose: CrowdPose;
  cloth: string;
  band?: string;
  gun: boolean;
}

const crowd = new Map<string, CrowdEntry>();
/** Dấu đồng đội: nhóm gốc của người đó và độ cao dấu so với chân. */
const mates = new Map<string, { root: Group; y: number }>();

export function setCrowd(id: string, e: CrowdEntry | null) {
  if (e) crowd.set(id, e);
  else crowd.delete(id);
}

export function setMateMark(id: string, e: { root: Group; y: number } | null) {
  if (e) mates.set(id, e);
  else mates.delete(id);
}

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

const legGeo = new BoxGeometry(0.14, 0.82, 0.16).translate(0, -0.41, 0);
const PARTS: { key: string; geo: BufferGeometry; color: "cloth" | "band" | "skin" | "metal" }[] = [
  { key: "legR", geo: legGeo, color: "cloth" },
  { key: "legL", geo: legGeo, color: "cloth" },
  { key: "body", geo: new CapsuleGeometry(0.2, 0.6, 3, 8), color: "cloth" },
  { key: "head", geo: new SphereGeometry(0.13, 8, 6), color: "skin" },
  { key: "band", geo: new BoxGeometry(0.46, 0.12, 0.34), color: "band" },
  { key: "gun", geo: new BoxGeometry(0.06, 0.1, 0.8), color: "metal" },
];

/** Ma trận từng bộ phận so với gốc chân, theo tư thế (hình người rút gọn: hai chân, thân, đầu, băng tay, súng). */
function poseMatrices(pose: CrowdPose): Matrix4[] {
  const prone = pose === "prone";
  const crouch = pose === "crouch";
  const inner = new Matrix4().compose(new Vector3(0, prone ? 0.15 : crouch ? -0.4 : 0, prone ? -0.9 : 0), new Quaternion().setFromEuler(new Euler(prone ? 1.45 : 0, 0, 0)), new Vector3(1, 1, 1));
  const part = (x: number, y: number, z: number, rx = 0) => inner.clone().multiply(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, 0, 0)), new Vector3(1, 1, 1)));
  return [
    part(0.1, crouch ? 0.7 : 0.9, crouch ? 0.15 : 0, crouch ? -0.9 : 0),
    part(-0.1, crouch ? 0.7 : 0.9, 0),
    part(0, 1.3, 0),
    part(0, 1.78, 0.02),
    part(0, 1.42, 0),
    part(0.12, 1.35, 0.35, prone ? -1.45 : 0),
  ];
}
const POSES: Record<CrowdPose, Matrix4[]> = { stand: poseMatrices("stand"), crouch: poseMatrices("crouch"), prone: poseMatrices("prone") };

const MATE_GEO = new OctahedronGeometry(0.16, 0);

const _root = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _one = new Vector3(1, 1, 1);
const _m = new Matrix4();
const _c = new Color();
const counts = new Int32Array(PARTS.length);
const SKIN = new Color("#c79a78");
const METAL = new Color("#222325");

export function FarCrowd() {
  const { meshes, mateMesh } = useMemo(() => {
    // Một vật liệu trắng dùng chung, màu riêng từng người lấy từ màu instance.
    const mat = withRim(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }));
    mat.userData.detail = "none";
    const meshes = PARTS.map((part) => {
      const m = new InstancedMesh(part.geo, mat as Material, MAX);
      m.count = 0;
      m.frustumCulled = false;
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

  useFrame(() => {
    counts.fill(0);
    for (const e of crowd.values()) {
      if (!e.root.visible || !e.root.parent) continue;
      _q.setFromAxisAngle(_p.set(0, 1, 0), e.yaw.rotation.y);
      _root.compose(e.root.position, _q, _one);
      const local = POSES[e.pose];
      for (let k = 0; k < PARTS.length; k++) {
        const part = PARTS[k]!;
        if (part.color === "band" && !e.band) continue;
        if (k === 5 && !e.gun) continue;
        const i = counts[k]!;
        if (i >= MAX) continue;
        counts[k] = i + 1;
        const mesh = meshes[k]!;
        mesh.setMatrixAt(i, _m.multiplyMatrices(_root, local[k]!));
        mesh.setColorAt(i, part.color === "cloth" ? _c.set(e.cloth) : part.color === "band" ? _c.set(e.band!) : part.color === "skin" ? SKIN : METAL);
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
      _p.copy(e.root.position);
      _p.y += e.y;
      mateMesh.setMatrixAt(n++, _m.makeTranslation(_p.x, _p.y, _p.z));
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
