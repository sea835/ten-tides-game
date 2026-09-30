import { BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Euler, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Hình khối của nhân vật người: dựng bằng code (không tải file), mỗi hình dựng một lần rồi mọi nhân vật dùng chung.
// Toạ độ theo từng khớp giống Character.tsx: chân đặt ở y = 0, mặt nhìn theo +z, bên phải nhân vật là -x.

export type V3 = [number, number, number];

/** Ô vân vải (rằn ri, sợi dệt) phủ chừng này mét: UV nhân theo kích thước thật để vân to đều trên mọi bộ phận. */
export const TILE = 0.45;

// ---------------------------------------------------------------------------- công cụ dựng hình

/**
 * Một vòng mặt cắt của khối tiện: nửa rộng `w` (theo x), nửa sâu phía trước `f` (+z) và phía sau `b` (-z), tâm lệch
 * `x`, `z`; `n` là độ vuông của mặt cắt (2 là bầu dục, lớn hơn thì vuông vức như thân người, bàn tay).
 */
export interface Ring {
  y: number;
  w: number;
  f?: number;
  b?: number;
  x?: number;
  z?: number;
  n?: number;
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.abs(v) ** p;

/**
 * Khối tiện mặt cắt bầu dục lệch (trước sâu, sau nông...) theo các vòng dọc trục y. Vòng có w = 0 là đỉnh bịt kín.
 * Pháp tuyến mượt, liền cả đường nối; UV theo mét thật.
 */
export function loft(rings: Ring[], segs: number, n0 = 2): BufferGeometry {
  const cols = segs + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let per = 0;
  for (const r of rings) per = Math.max(per, Math.PI * (r.w + ((r.f ?? r.w) + (r.b ?? r.f ?? r.w)) / 2));
  const su = Math.max(1, Math.round(per / TILE));
  let v = 0;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]!;
    if (i > 0) {
      const p = rings[i - 1]!;
      v += Math.hypot(r.y - p.y, r.w - p.w) / TILE;
    }
    const f = r.f ?? r.w;
    const b = r.b ?? f;
    const e = 2 / (r.n ?? n0);
    for (let j = 0; j < cols; j++) {
      const a = (j / segs) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      pos.push((r.x ?? 0) + r.w * sgnPow(s, e), r.y, (r.z ?? 0) + (c >= 0 ? f : b) * sgnPow(c, e));
      uv.push((j / segs) * su, v);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * cols + j;
      const c = a + cols;
      idx.push(a, a + 1, c + 1, a, c + 1, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  outward(g);
  weldNormals(g);
  return g;
}

/** Lật chiều tam giác nếu pháp tuyến đang quay vào trong (vòng xếp từ trên xuống). */
function outward(g: BufferGeometry) {
  const p = g.attributes.position as BufferAttribute;
  const n = g.attributes.normal as BufferAttribute;
  g.computeBoundingBox();
  const c = new Vector3();
  g.boundingBox!.getCenter(c);
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += (p.getX(i) - c.x) * n.getX(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (dot >= 0) return;
  const index = g.index!;
  for (let i = 0; i < index.count; i += 3) {
    const t = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, t);
  }
  g.computeVertexNormals();
}

/** Đỉnh trùng chỗ (đường nối UV, đỉnh cực) lấy chung một pháp tuyến trung bình: khỏi lộ vệt gãy. */
export function weldNormals(g: BufferGeometry) {
  const p = g.attributes.position as BufferAttribute;
  const n = g.attributes.normal as BufferAttribute;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  }
  const s = new Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    s.set(0, 0, 0);
    for (const i of list) s.x += n.getX(i), s.y += n.getY(i), s.z += n.getZ(i);
    s.normalize();
    for (const i of list) n.setXYZ(i, s.x, s.y, s.z);
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** Dời, xoay, co giãn một hình (sửa thẳng vào hình). */
export function place(g: BufferGeometry, p: V3 = [0, 0, 0], r?: V3, s?: V3 | number): BufferGeometry {
  _q.setFromEuler(_e.set(...(r ?? [0, 0, 0])));
  if (typeof s === "number") _s.setScalar(s);
  else _s.set(...(s ?? [1, 1, 1]));
  g.applyMatrix4(_m.compose(_p.set(...p), _q, _s));
  return g;
}

/** Nhân UV (vân rằn ri trên hộp, cầu nhỏ khỏi bị phóng to). */
export function scaleUV(g: BufferGeometry, su: number, sv = su): BufferGeometry {
  const uv = g.attributes.uv as BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Cầu bầu dục (bán trục r) với UV theo mét thật. */
export function ellipsoid(r: V3, p: V3, rot?: V3, seg: [number, number] = [12, 8]): BufferGeometry {
  const g = new SphereGeometry(1, seg[0], seg[1]);
  scaleUV(g, (Math.PI * 2 * Math.max(r[0], r[2])) / TILE, (Math.PI * r[1]) / TILE);
  return place(g, p, rot, r);
}

/** Hộp (UV theo mét thật). */
export function block(w: number, h: number, d: number, p: V3, r?: V3): BufferGeometry {
  return place(scaleUV(new BoxGeometry(w, h, d), Math.max(w, d) / TILE, h / TILE), p, r);
}

const Y = new Vector3(0, 1, 0);

/** Viên nang nối hai điểm (ngón tay, dây ăng-ten...). */
export function capsule(a: Vector3, b: Vector3, r: number, radial = 6, cap = 1): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const g = new CapsuleGeometry(r, Math.max(0.0001, len), cap, radial);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(Y, d.normalize()));
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Dây đai phẳng đi qua các điểm (quai balo, dây đeo ngực): mỗi đoạn là một hộp mỏng, mặt dây quay ra xa điểm `center`. */
export function strap(points: V3[], width: number, thick: number, center: V3 = [0, 0.3, 0]): BufferGeometry[] {
  const list: BufferGeometry[] = [];
  const c = new Vector3(...center);
  for (let i = 0; i < points.length - 1; i++) {
    const a = new Vector3(...points[i]!);
    const b = new Vector3(...points[i + 1]!);
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length() + thick;
    dir.normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // Mặt dây quay ra ngoài chủ yếu theo trước / sau / trên (bớt thành phần ngang để dây không bị vặn xoắn).
    const o = mid.clone().sub(c);
    o.x *= 0.3;
    const z = o.addScaledVector(dir, -o.dot(dir)).normalize();
    const x = new Vector3().crossVectors(dir, z).normalize();
    const g = scaleUV(new BoxGeometry(width, len, thick), width / TILE, len / TILE);
    g.applyMatrix4(new Matrix4().makeBasis(x, dir, z));
    g.translate(mid.x, mid.y, mid.z);
    list.push(g);
  }
  return list;
}

/** Gộp nhiều khối cùng vật liệu thành một hình (một lệnh vẽ). */
export function merge(list: BufferGeometry[]): BufferGeometry {
  const ready = list.map((g0) => {
    let g = g0;
    if (!g.index) {
      const n = (g.attributes.position as BufferAttribute).count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new BufferAttribute(new Float32Array((g.attributes.position as BufferAttribute).count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    g.morphAttributes = {};
    return g;
  });
  const out = mergeGeometries(ready, false)!;
  for (const g of ready) g.dispose();
  // Đã có pháp tuyến đúng: trình quét cảnh khỏi tính lại (giữ cạnh sắc của hộp, mặt mượt của khối tiện).
  out.userData.smooth = true;
  out.computeBoundingSphere();
  return out;
}

/** Nội suy một số đo của vòng theo y (dùng để đặt túi, khoá kéo sát mặt vải). */
export function ringAt(rings: Ring[], y: number, key: "w" | "f" | "b"): number {
  const get = (r: Ring) => (key === "w" ? r.w : key === "f" ? (r.f ?? r.w) : (r.b ?? r.f ?? r.w));
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if ((y - a.y) * (y - b.y) <= 0 && a.y !== b.y) {
      const k = (y - a.y) / (b.y - a.y);
      return get(a) + (get(b) - get(a)) * k + ((a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k) * (key === "f" ? 1 : key === "b" ? -1 : 0);
    }
  }
  return get(rings[rings.length - 1]!);
}

// ---------------------------------------------------------------------------- dáng người

/** Nửa thân trên (toạ độ eo): eo thon, lồng ngực nở, lưng phẳng hơn ngực, vai xuôi vào cổ. */
export const TORSO: Ring[] = [
  { y: -0.085, w: 0 },
  { y: -0.08, w: 0.138, f: 0.098, b: 0.1 },
  { y: -0.02, w: 0.141, f: 0.099, b: 0.098 },
  { y: 0.06, w: 0.145, f: 0.104, b: 0.096 },
  { y: 0.14, w: 0.154, f: 0.113, b: 0.1 },
  { y: 0.22, w: 0.166, f: 0.123, b: 0.106 },
  { y: 0.3, w: 0.176, f: 0.129, b: 0.11 },
  { y: 0.36, w: 0.18, f: 0.124, b: 0.112 },
  { y: 0.41, w: 0.178, f: 0.11, b: 0.106 },
  { y: 0.455, w: 0.166, f: 0.09, b: 0.094 },
  { y: 0.495, w: 0.126, f: 0.07, b: 0.076 },
  { y: 0.525, w: 0.074, f: 0.056, b: 0.062 },
  { y: 0.54, w: 0 },
];

/** Hông, mông (toạ độ thân): mông nhô ra sau, bụng dưới phẳng. */
const PELVIS: Ring[] = [
  { y: 0.79, w: 0 },
  { y: 0.795, w: 0.075, f: 0.06, b: 0.07 },
  { y: 0.83, w: 0.132, f: 0.09, b: 0.112 },
  { y: 0.875, w: 0.158, f: 0.1, b: 0.126 },
  { y: 0.935, w: 0.166, f: 0.102, b: 0.122 },
  { y: 0.99, w: 0.16, f: 0.101, b: 0.108 },
  { y: 1.04, w: 0.148, f: 0.1, b: 0.1 },
  { y: 1.07, w: 0 },
];

/** Đùi (gốc ở khớp hông, chĩa xuống): cơ đùi trước phồng, thon về gối. Ống quần hơi rộng. */
const THIGH: Ring[] = [
  { y: 0.075, w: 0 },
  { y: 0.06, w: 0.072, f: 0.07, b: 0.07 },
  { y: 0.0, w: 0.088, f: 0.088, b: 0.086 },
  { y: -0.08, w: 0.086, f: 0.09, b: 0.083 },
  { y: -0.2, w: 0.078, f: 0.082, b: 0.075 },
  { y: -0.32, w: 0.068, f: 0.07, b: 0.065 },
  { y: -0.4, w: 0.059, f: 0.061, b: 0.058 },
  { y: -0.45, w: 0.052, f: 0.054, b: 0.052 },
  { y: -0.47, w: 0 },
];

/** Cẳng chân (gốc ở gối): bắp chân phồng phía sau, thon về mắt cá. */
const SHIN: Ring[] = [
  { y: 0.05, w: 0 },
  { y: 0.03, w: 0.052, f: 0.055, b: 0.052 },
  { y: -0.03, w: 0.053, f: 0.05, b: 0.06 },
  { y: -0.1, w: 0.055, f: 0.048, b: 0.07 },
  { y: -0.18, w: 0.051, f: 0.045, b: 0.063 },
  { y: -0.26, w: 0.044, f: 0.041, b: 0.05 },
  { y: -0.34, w: 0.038, f: 0.037, b: 0.041 },
  { y: -0.42, w: 0.036, f: 0.036, b: 0.039 },
  { y: -0.44, w: 0 },
];

/** Cánh tay trên (gốc ở khớp vai): cơ vai tròn, bắp tay trước. */
const UPPER_ARM: Ring[] = [
  { y: 0.046, w: 0 },
  { y: 0.038, w: 0.03, f: 0.036, b: 0.036 },
  { y: 0.012, w: 0.048, f: 0.05, b: 0.05 },
  { y: -0.04, w: 0.053, f: 0.052, b: 0.051 },
  { y: -0.1, w: 0.05, f: 0.05, b: 0.047 },
  { y: -0.16, w: 0.047, f: 0.05, b: 0.044 },
  { y: -0.22, w: 0.044, f: 0.046, b: 0.042 },
  { y: -0.28, w: 0.041, f: 0.041, b: 0.04 },
  { y: -0.31, w: 0.038, f: 0.038, b: 0.038 },
  { y: -0.325, w: 0 },
];

/** Cẳng tay (gốc ở khuỷu): to gần khuỷu, dẹt dần về cổ tay (dẹt theo x như bàn tay). */
const FOREARM: Ring[] = [
  { y: 0.045, w: 0 },
  { y: 0.03, w: 0.036, f: 0.038, b: 0.04 },
  { y: -0.02, w: 0.041, f: 0.04, b: 0.043 },
  { y: -0.07, w: 0.042, f: 0.039, b: 0.04 },
  { y: -0.14, w: 0.035, f: 0.034, b: 0.034 },
  { y: -0.2, w: 0.028, f: 0.03, b: 0.029 },
  { y: -0.25, w: 0.022, f: 0.028, b: 0.027 },
  { y: -0.275, w: 0 },
];

/** Cắt một dãy vòng ở khoảng [lo, hi] theo y (nội suy vòng ở mép cắt, bịt đầu nếu cần). */
function cut(rings: Ring[], lo: number, hi: number, capLo: boolean, capHi: boolean): Ring[] {
  const at = (y: number): Ring => ({ y, w: ringAt(rings, y, "w"), f: ringAt(rings, y, "f"), b: ringAt(rings, y, "b") });
  const sorted = [...rings].sort((a, b) => b.y - a.y);
  const out: Ring[] = [];
  if (capHi) out.push({ y: hi + 0.004, w: 0 });
  out.push(at(hi));
  for (const r of sorted) if (r.y < hi && r.y > lo && r.w > 0) out.push(r);
  out.push(at(lo));
  if (capLo) out.push({ y: lo - 0.004, w: 0 });
  return out;
}

/** Nới rộng ống tay áo, ống quần một chút (vải phủ ngoài da). */
const loose = (rings: Ring[], k: number, add = 0): Ring[] => rings.map((r) => (r.w > 0 ? { ...r, w: r.w * k + add, f: (r.f ?? r.w) * k + add, b: (r.b ?? r.f ?? r.w) * k + add } : r));

/** Vòng xắn tay áo, gấu quần: ống vải cuộn dày hơn chỗ nó ôm. */
function roll(rings: Ring[], y: number, h: number, thick: number): BufferGeometry {
  const w = ringAt(rings, y, "w");
  const f = ringAt(rings, y, "f");
  const b = ringAt(rings, y, "b");
  const ring = (dy: number, k: number): Ring => ({ y: y + dy, w: w + k, f: f + k, b: b + k });
  return loft([ring(-h / 2, thick * 0.3), ring(-h / 4, thick), ring(h / 4, thick), ring(h / 2, thick * 0.3)], 14);
}

// ---------------------------------------------------------------------------- bàn tay

/**
 * Bàn tay (gốc ở cổ tay, ngón chĩa -y, lòng bàn tay quay vào trong `inward`, ngón cái phía trước +z): lòng dẹt, bốn ngón
 * hai đốt co nửa nắm, ngón cái. Găng tay thêm cổ găng và miếng đệm đốt tay.
 */
function hand(inward: 1 | -1, glove: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const g = glove ? 0.0015 : 0;
  parts.push(
    loft(
      [
        { y: 0.006, w: 0 },
        { y: 0.0, w: 0.016 + g, f: 0.024 + g, b: 0.023 + g },
        { y: -0.03, w: 0.017 + g, f: 0.032 + g, b: 0.028 + g },
        { y: -0.062, w: 0.016 + g, f: 0.033 + g, b: 0.03 + g },
        { y: -0.082, w: 0.013 + g, f: 0.031 + g, b: 0.028 + g },
        { y: -0.088, w: 0 },
      ].map((r) => ({ ...r, z: 0.002, x: inward * 0.002 })),
      10,
      2.6,
    ),
  );
  // Bốn ngón: ngón trỏ ở trước (gần ngón cái), ngón út sau cùng. Đốt một chúi nhẹ, đốt hai co vào lòng.
  const fingers: [number, number, number, number][] = [
    [0.022, 0.036, 0.028, 0.0082],
    [0.007, 0.04, 0.031, 0.0085],
    [-0.008, 0.037, 0.029, 0.008],
    [-0.022, 0.03, 0.023, 0.007],
  ];
  for (const [z, l1, l2, r] of fingers) {
    const k = new Vector3(inward * 0.002, -0.078, z);
    const j = k.clone().add(new Vector3(inward * Math.sin(0.45) * l1, -Math.cos(0.45) * l1, 0));
    const t = j.clone().add(new Vector3(inward * Math.sin(1.45) * l2, -Math.cos(1.45) * l2, 0));
    parts.push(capsule(k, j, r + g, 5), capsule(j, t, r * 0.92 + g, 5));
  }
  // Ngón cái: mọc ở mép trước lòng bàn tay, chĩa xuống, ra trước và vào trong.
  const t0 = new Vector3(inward * 0.006, -0.02, 0.025);
  const t1 = t0.clone().add(new Vector3(inward * 0.012, -0.03, 0.02));
  const t2 = t1.clone().add(new Vector3(inward * 0.018, -0.022, 0.006));
  parts.push(capsule(t0, t1, 0.0105 + g), capsule(t1, t2, 0.0088 + g));
  if (glove) {
    // Cổ găng ôm cổ tay, miếng đệm đốt ngón trên mu bàn tay.
    parts.push(
      loft(
        [
          { y: 0.035, w: 0.026, f: 0.032, b: 0.031 },
          { y: 0.0, w: 0.024, f: 0.031, b: 0.03 },
          { y: -0.015, w: 0.019, f: 0.028, b: 0.027 },
        ],
        12,
      ),
    );
    parts.push(block(0.008, 0.026, 0.056, [-inward * 0.016, -0.07, 0.002], [0, 0, inward * 0.12]));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------- giày

/**
 * Giày (gốc ở mắt cá, đế chạm đất ở y = -0.09): `tall` là giày lính cổ cao buộc dây lên tận ống, không thì giày da
 * cổ thấp. Trả về thân giày (da) và đế + dây giày (cao su sẫm).
 */
function boot(tall: boolean): { upper: BufferGeometry; sole: BufferGeometry } {
  const top = tall ? 0.155 : 0.055;
  const shaft = loft(
    [
      { y: top + 0.003, w: 0.041, f: 0.043, b: 0.047 },
      { y: top, w: 0.05, f: 0.052, b: 0.056 },
      { y: top - 0.012, w: 0.049, f: 0.051, b: 0.055 },
      { y: 0.03, w: 0.045, f: 0.048, b: 0.052 },
      { y: -0.02, w: 0.043, f: 0.05, b: 0.05 },
      { y: -0.05, w: 0.044, f: 0.052, b: 0.05 },
    ],
    14,
  );
  // Bàn chân: khối tiện dọc trục z (gót ở sau, mũi giày ở trước), mặt cắt dẹt cao thấp dần về mũi.
  // Dựng dọc trục y rồi xoay: f là nửa dưới, b là nửa trên, z là -(tâm theo chiều cao).
  const footRings = (grow: number): Ring[] =>
    [
      [-0.078, 0, -0.05, 0, 0],
      [-0.073, 0.034, -0.05, 0.03, 0.028],
      [-0.055, 0.041, -0.047, 0.041, 0.042],
      [-0.01, 0.045, -0.046, 0.042, 0.045],
      [0.045, 0.049, -0.05, 0.037, 0.033],
      [0.1, 0.051, -0.057, 0.03, 0.024],
      [0.145, 0.047, -0.061, 0.026, 0.018],
      [0.172, 0.036, -0.063, 0.021, 0.013],
      [0.184, 0, -0.064, 0, 0],
    ].map(([y, w, yc, down, up]) => ({ y: y!, w: w! > 0 ? w! + grow : 0, f: down! + grow, b: up! + grow, z: -yc!, n: 2.3 }));
  const foot = loft(footRings(0), 14);
  foot.rotateX(Math.PI / 2);
  // Đế: dẹt, vuông vức, rộng hơn thân giày; gót dày hơn mũi.
  const soleRings: Ring[] = [
    [-0.082, 0.03, -0.079, 0.011],
    [-0.078, 0.04, -0.079, 0.011],
    [-0.04, 0.046, -0.079, 0.011],
    [-0.008, 0.044, -0.08, 0.01],
    [0.02, 0.047, -0.082, 0.008],
    [0.1, 0.056, -0.082, 0.008],
    [0.15, 0.052, -0.081, 0.008],
    [0.178, 0.042, -0.079, 0.008],
    [0.192, 0.024, -0.077, 0.007],
  ].map(([y, w, yc, h]) => ({ y: y!, w: w!, f: h!, b: h!, z: -yc!, n: 4 }));
  const sole = loft([{ ...soleRings[0]!, w: 0, y: -0.084 }, ...soleRings, { ...soleRings[soleRings.length - 1]!, w: 0, y: 0.194 }], 16);
  sole.rotateX(Math.PI / 2);
  const laces: BufferGeometry[] = [];
  // Dây giày bắt chéo trên mu bàn chân, bám theo độ dốc mu.
  for (const [z, y, slope] of [
    [0.012, -0.001, 0.25],
    [0.032, -0.008, 0.33],
    [0.052, -0.016, 0.35],
    [0.072, -0.024, 0.35],
  ] as const) {
    for (const turn of [-0.4, 0.4]) laces.push(place(new BoxGeometry(0.042, 0.0045, 0.0055), [0, y + 0.0035, z], [slope, turn, 0]));
  }
  // Giày lính: dây buộc tiếp lên mặt trước ống giày.
  if (tall) {
    for (let y = 0.014; y < top - 0.015; y += 0.03) {
      const f = 0.048 + (0.052 - 0.048) * (y / top);
      for (const turn of [-0.45, 0.45]) laces.push(place(new BoxGeometry(0.038, 0.0045, 0.0045), [0, y, f + 0.0015], [0, 0, turn]));
    }
    // Nút buộc trên cùng.
    laces.push(ellipsoid([0.008, 0.006, 0.005], [0, top - 0.01, 0.055], undefined, [6, 4]));
  }
  return { upper: merge([shaft, foot]), sole: merge([sole, ...laces]) };
}

// ---------------------------------------------------------------------------- cơ thể

/** Mọi hình của thân người (không kể đầu), dựng một lần khi cần. */
function makeBody() {
  const thighPants = loose(THIGH, 1.04);
  const shinPants = loose(SHIN, 1.06, 0.004);
  const upperSleeve = loose(UPPER_ARM, 1.04, 0.002);
  const foreSleeve = loose(FOREARM, 1.08, 0.003);
  const tall = boot(true);
  const low = boot(false);

  /** Túi hộp bên hông đùi (ngoài): thân túi, nắp túi. */
  const cargo = (side: 1 | -1) => {
    const x = side * (ringAt(thighPants, -0.2, "w") + 0.012);
    return merge([
      loft(thighPants, 14),
      block(0.026, 0.12, 0.1, [x, -0.21, 0.004], [0, 0, side * 0.04]),
      block(0.03, 0.03, 0.106, [x + side * 0.004, -0.148, 0.004], [0, 0, side * 0.04]),
    ]);
  };

  return {
    torso: loft(TORSO, 22, 2.5),
    pelvis: loft(PELVIS, 20, 2.3),
    butt: merge([ellipsoid([0.085, 0.085, 0.085], [-0.068, 0, -0.03], undefined, [10, 6]), ellipsoid([0.085, 0.085, 0.085], [0.068, 0, -0.03], undefined, [10, 6])]),
    thigh: loft(thighPants, 14),
    thighCargoL: cargo(1),
    thighCargoR: cargo(-1),
    /** Gối và cả ống quần tới mắt cá (lính: nhét vào giày). */
    shinFull: merge([ellipsoid([0.06, 0.062, 0.062], [0, 0, 0.006]), loft(shinPants, 16)]),
    /** Dân thường: quần xắn tới giữa bắp chân (gấu cuộn), dưới là da. */
    shinRolled: merge([ellipsoid([0.06, 0.062, 0.062], [0, 0, 0.006]), loft(cut(shinPants, -0.24, 0.03, false, true), 16), roll(shinPants, -0.235, 0.034, 0.008)]),
    shinSkin: loft(cut(SHIN, -0.44, -0.225, true, false), 14),
    /** Đệm gối lính: mảnh cong trước gối, dây đai sau khoeo. */
    kneePad: merge([
      ellipsoid([0.056, 0.066, 0.026], [0, -0.015, 0.043], [0.1, 0, 0], [12, 8]),
      loft(
        [
          { y: -0.035, w: 0.058, f: 0.056, b: 0.068 },
          { y: -0.047, w: 0.06, f: 0.058, b: 0.07 },
          { y: -0.059, w: 0.058, f: 0.056, b: 0.068 },
        ],
        14,
      ),
    ]),
    bootTall: tall.upper,
    soleTall: tall.sole,
    bootLow: low.upper,
    soleLow: low.sole,

    /** Tay áo liền vai phủ cả cánh tay trên (tay áo dài hoặc xắn dưới khuỷu). */
    upperSleeve: loft(upperSleeve, 14),
    /** Tay áo xắn trên khuỷu: vải tới gần khuỷu, cuộn gấu. */
    upperRolled: merge([loft(cut(upperSleeve, -0.235, 0.035, false, true), 14), roll(upperSleeve, -0.23, 0.036, 0.009)]),
    upperSkin: loft(cut(UPPER_ARM, -0.325, -0.21, true, false), 12),
    elbowSkin: ellipsoid([0.042, 0.044, 0.042], [0, 0, 0]),
    elbowSleeve: ellipsoid([0.047, 0.048, 0.047], [0, 0, 0]),
    /** Cẳng tay trần. */
    foreSkin: loft(FOREARM, 12),
    /** Tay áo xắn ngay dưới khuỷu: phần vải trên, gấu cuộn; phần da dưới. */
    foreRolled: merge([loft(cut(foreSleeve, -0.075, 0.03, false, true), 14), roll(foreSleeve, -0.075, 0.034, 0.008)]),
    foreSkinLow: loft(cut(FOREARM, -0.275, -0.06, true, false), 12),
    /** Tay áo dài tới cổ tay, cổ tay áo bó. */
    foreSleeve: merge([loft(cut(foreSleeve, -0.235, 0.03, false, true), 14), roll(foreSleeve, -0.228, 0.028, 0.004)]),
    handL: hand(-1, false),
    handR: hand(1, false),
    gloveL: hand(-1, true),
    gloveR: hand(1, true),
    /** Cổ: hơi đổ về trước, gân cổ hai bên. */
    neck: loft(
      [
        { y: 0.42, w: 0.06, f: 0.056, b: 0.064, z: -0.008 },
        { y: 0.47, w: 0.054, f: 0.05, b: 0.058, z: -0.004 },
        { y: 0.53, w: 0.049, f: 0.047, b: 0.052, z: 0.002 },
        { y: 0.585, w: 0.046, f: 0.045, b: 0.05, z: 0.006 },
        { y: 0.59, w: 0 },
      ],
      14,
    ),
  };
}

let bodyCache: ReturnType<typeof makeBody> | null = null;
/** Hình thân người dùng chung. */
export const body = () => (bodyCache ??= makeBody());

// ---------------------------------------------------------------------------- áo

/** Áo: cổ áo, nẹp khuy / khoá kéo, túi ngực. Mỗi kiểu dựng một lần. */
export type Top = "shirt" | "combat" | "jacket";

const shirtCache = new Map<Top, { cloth: BufferGeometry; trim: BufferGeometry }>();

/** Phần vải của áo (gộp với thân) và phần viền (khoá kéo, khuy, nẹp: màu sẫm). */
export function top(kind: Top): { cloth: BufferGeometry; trim: BufferGeometry } {
  let t = shirtCache.get(kind);
  if (t) return t;
  const cloth: BufferGeometry[] = [loft(TORSO, 22, 2.5)];
  const trim: BufferGeometry[] = [];
  const front = (y: number) => ringAt(TORSO, y, "f");
  // Túi ngực hai bên, nắp túi (áo lính nghiêng theo ngực, có nắp dán).
  const pocket = (x: number, y: number, w: number, h: number) => {
    const z = front(y) - Math.abs(x) * 0.12;
    const yaw = Math.sign(x) * 0.32;
    cloth.push(block(w, h, 0.012, [x, y, z + 0.003], [0.05, yaw, 0]));
    cloth.push(block(w + 0.006, 0.026, 0.02, [x, y + h / 2 - 0.006, z + 0.006], [0.05, yaw, 0]));
  };
  if (kind === "shirt") {
    // Sơ mi: cổ bẻ hai vạt nằm trên ngực, bản cổ sau gáy, nẹp khuy giữa ngực, gấu áo thả ngoài quần.
    for (const s of [-1, 1]) cloth.push(block(0.055, 0.06, 0.008, [s * 0.042, 0.47, front(0.47) + 0.004], [-0.75, s * 0.35, s * 0.55]));
    cloth.push(loft([{ y: 0.46, w: 0.07, f: 0.066, b: 0.07, z: -0.004 }, { y: 0.495, w: 0.068, f: 0.062, b: 0.068, z: -0.006 }, { y: 0.52, w: 0.071, f: 0.064, b: 0.071, z: -0.008 }], 16));
    for (let y = 0.07; y < 0.44; y += 0.07) trim.push(ellipsoid([0.006, 0.006, 0.003], [0, y, front(y) + 0.003], undefined, [6, 4]));
    cloth.push(...strap(TORSO.filter((r) => r.y > -0.08 && r.y < 0.46).map((r) => [0, r.y, (r.f ?? r.w) + 0.002] as V3), 0.024, 0.004, [0, 0.2, -0.5]));
    pocket(0.075, 0.3, 0.07, 0.08);
  } else {
    // Áo lính: cổ đứng (áo khoác cao hơn, có khoá kéo), túi ngực nắp dán, khoá kéo giữa ngực.
    const high = kind === "jacket" ? 0.585 : 0.55;
    cloth.push(
      loft(
        [
          { y: 0.455, w: 0.074, f: 0.07, b: 0.072, z: -0.004 },
          { y: 0.5, w: 0.066, f: 0.061, b: 0.066, z: -0.003 },
          { y: high, w: 0.062 + (high - 0.55) * 0.3, f: 0.059 + (high - 0.55) * 0.3, b: 0.064 + (high - 0.55) * 0.3, z: 0.004 },
          { y: high + 0.004, w: 0.055, f: 0.052, b: 0.057, z: 0.004 },
        ],
        16,
      ),
    );
    trim.push(...strap(TORSO.filter((r) => r.y > -0.08 && r.y < 0.46).map((r) => [0, r.y, (r.f ?? r.w) + 0.002] as V3), 0.01, 0.004, [0, 0.2, -0.5]));
    trim.push(block(0.01, high - 0.46, 0.004, [0, (high + 0.46) / 2, 0.066], [0.1, 0, 0]));
    pocket(0.08, 0.29, 0.075, 0.09);
    pocket(-0.08, 0.29, 0.075, 0.09);
  }
  t = { cloth: merge(cloth), trim: merge(trim.length ? trim : [new BoxGeometry(0.001, 0.001, 0.001)]) };
  shirtCache.set(kind, t);
  return t;
}

// ---------------------------------------------------------------------------- đồ lính: thắt lưng, đai ngực, balo

/** Đặt một món quanh vành bầu dục (thắt lưng, hông): góc a = 0 là chính giữa bụng, dương là sang trái (+x). */
function around(rx: number, rz: number, a: number, y: number, g: BufferGeometry, out = 0): BufferGeometry {
  const x = Math.sin(a) * (rx + out);
  const z = Math.cos(a) * (rz + out);
  g.rotateY(a);
  g.translate(x, y, z);
  return g;
}

/** Thắt lưng (toạ độ thân, ngang y = 1.0): bản đai và các túi, bao súng ngắn (lính) hoặc túi da, bao dao (dân thường). */
export function belt(soldier: boolean) {
  const key = soldier ? "beltS" : "beltC";
  let b = gearCache.get(key);
  if (b) return b;
  const rx = 0.162;
  const rz = 0.11;
  const band = loft(
    [
      { y: 0.975, w: rx, f: rz, b: rz + 0.006 },
      { y: 0.978, w: rx + 0.004, f: rz + 0.004, b: rz + 0.01 },
      { y: 1.022, w: rx + 0.004, f: rz + 0.004, b: rz + 0.01 },
      { y: 1.025, w: rx, f: rz, b: rz + 0.006 },
    ],
    24,
    2.2,
  );
  const gear: BufferGeometry[] = [band];
  const metal: BufferGeometry[] = [block(0.05, 0.036, 0.01, [0, 1.0, rz + 0.008])];
  if (soldier) {
    // Túi băng đạn bên trái, túi đồ phía sau, túi xả vỏ đạn bên hông trái sau.
    for (const a of [0.85, 1.12]) gear.push(around(rx, rz, a, 0.975, merge([block(0.042, 0.085, 0.034, [0, 0, 0]), block(0.046, 0.022, 0.038, [0, 0.036, 0.002])]), 0.02));
    gear.push(around(rx, rz, Math.PI, 0.985, merge([block(0.11, 0.075, 0.045, [0, 0, 0]), block(0.114, 0.02, 0.05, [0, 0.03, 0.002])]), 0.024));
    gear.push(around(rx, rz, 2.2, 0.97, block(0.07, 0.1, 0.05, [0, 0, 0]), 0.026));
    // Bao súng ngắn bên hông phải, trễ xuống đùi, báng súng ló lên.
    const holster = merge([block(0.036, 0.15, 0.075, [0, -0.06, 0], [0.12, 0, 0]), block(0.03, 0.06, 0.045, [0, 0.03, -0.012], [0.3, 0, 0])]);
    gear.push(around(rx, rz, -Math.PI / 2 - 0.08, 0.96, holster, 0.02));
    metal.push(around(rx, rz, -Math.PI / 2 - 0.08, 1.02, block(0.022, 0.05, 0.028, [0, 0, -0.018], [0.35, 0, 0]), 0.022));
  } else {
    // Túi da nhỏ bên trái sau, bao dao bên phải sau.
    gear.push(around(rx, rz, 1.9, 0.965, merge([block(0.085, 0.08, 0.04, [0, 0, 0]), block(0.089, 0.03, 0.044, [0, 0.03, 0.003], [0.15, 0, 0])]), 0.02));
    gear.push(around(rx, rz, -2.0, 0.93, block(0.034, 0.16, 0.022, [0, 0, 0], [0, 0, 0.25]), 0.012));
    metal.push(around(rx, rz, -2.0, 1.03, block(0.02, 0.05, 0.02, [0.012, 0, 0], [0, 0, 0.25]), 0.012));
  }
  b = { gear: merge(gear), metal: merge(metal) };
  gearCache.set(key, b);
  return b;
}

const gearCache = new Map<string, { gear: BufferGeometry; metal: BufferGeometry }>();

/** Đai ngực (toạ độ eo): dây đeo chữ H qua vai, ba túi băng đạn trước bụng, hai túi nhỏ hai bên. Mặc dưới áo giáp. */
export function chestRig(): BufferGeometry {
  const hit = gearCache.get("rig");
  if (hit) return hit.gear;
  const parts: BufferGeometry[] = [];
  const f = (y: number) => ringAt(TORSO, y, "f");
  const b = (y: number) => ringAt(TORSO, y, "b");
  for (const s of [-1, 1]) {
    parts.push(...strap([[s * 0.1, 0.13, f(0.13) + 0.028], [s * 0.095, 0.3, f(0.3) + 0.006], [s * 0.085, 0.42, f(0.42) + 0.004], [s * 0.085, 0.47, 0.02], [s * 0.085, 0.43, -b(0.43) - 0.004], [s * 0.1, 0.12, -b(0.12) - 0.006]], 0.04, 0.006));
  }
  for (const x of [-0.07, 0, 0.07]) {
    const y = 0.12;
    parts.push(block(0.062, 0.095, 0.04, [x, y, f(y) + 0.02 - Math.abs(x) * 0.08], [0.06, x * 2.5, 0]));
    parts.push(block(0.066, 0.024, 0.044, [x, y + 0.045, f(y) + 0.021 - Math.abs(x) * 0.08], [0.06, x * 2.5, 0]));
  }
  for (const s of [-1, 1]) parts.push(around(0.155, 0.11, s * 1.45, 0.1, block(0.05, 0.08, 0.04, [0, 0, 0]), 0.018));
  // Vành đai quanh bụng giữ túi.
  parts.push(loft([{ y: 0.065, w: 0.152, f: 0.112, b: 0.1 }, { y: 0.072, w: 0.157, f: 0.117, b: 0.105 }, { y: 0.105, w: 0.16, f: 0.12, b: 0.107 }, { y: 0.112, w: 0.155, f: 0.115, b: 0.102 }], 22, 2.4));
  const g = merge(parts);
  gearCache.set("rig", { gear: g, metal: g });
  return g;
}

/** Balo lính (toạ độ eo): túi đeo lưng nhỏ gọn hoặc bộ đàm có ăng-ten; `radio` là kim loại (bộ đàm, ăng-ten). */
export function pack(kind: 1 | 2 | 3) {
  const key = `pack${kind}`;
  let p = gearCache.get(key);
  if (p) return p;
  const gear: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  const back = (y: number) => -ringAt(TORSO, y, "b");
  const straps = (w: number) => {
    for (const s of [-1, 1]) gear.push(...strap([[s * 0.09, 0.44, back(0.44) - 0.02], [s * 0.085, 0.49, 0.0], [s * 0.09, 0.42, ringAt(TORSO, 0.42, "f") + 0.004], [s * 0.105, 0.2, ringAt(TORSO, 0.2, "f") + 0.006]], w, 0.007));
  };
  if (kind === 1) {
    // Túi đeo lưng: thân bo tròn, túi ngoài, dây nén hai bên.
    gear.push(
      loft(
        [
          { y: 0.06, w: 0 },
          { y: 0.065, w: 0.12, f: 0.045, b: 0.055, z: -0.2, n: 4 },
          { y: 0.25, w: 0.13, f: 0.05, b: 0.065, z: -0.205, n: 4 },
          { y: 0.4, w: 0.12, f: 0.045, b: 0.058, z: -0.2, n: 4 },
          { y: 0.43, w: 0.09, f: 0.035, b: 0.04, z: -0.198, n: 3 },
          { y: 0.435, w: 0 },
        ],
        16,
      ),
    );
    gear.push(block(0.16, 0.14, 0.03, [0, 0.18, -0.275]));
    gear.push(block(0.17, 0.03, 0.036, [0, 0.25, -0.275]));
    straps(0.036);
  } else if (kind === 2) {
    // Bộ đàm trong túi sau lưng lệch trái, ăng-ten dẻo vươn lên quá vai.
    gear.push(block(0.09, 0.17, 0.06, [0.07, 0.3, -0.165]));
    metal.push(block(0.07, 0.03, 0.05, [0.07, 0.4, -0.165]));
    metal.push(capsule(new Vector3(0.09, 0.41, -0.165), new Vector3(0.1, 0.62, -0.19), 0.0035, 4, 1));
    metal.push(capsule(new Vector3(0.1, 0.62, -0.19), new Vector3(0.105, 0.78, -0.22), 0.0028, 4, 1));
    straps(0.03);
  } else {
    // Túi nước dẹt sát lưng, ống hút vắt qua vai phải.
    gear.push(
      loft(
        [
          { y: 0.1, w: 0 },
          { y: 0.105, w: 0.1, f: 0.02, b: 0.035, z: -0.14, n: 3.5 },
          { y: 0.4, w: 0.11, f: 0.02, b: 0.038, z: -0.14, n: 3.5 },
          { y: 0.44, w: 0.07, f: 0.015, b: 0.025, z: -0.135, n: 3 },
          { y: 0.445, w: 0 },
        ],
        14,
      ),
    );
    gear.push(capsule(new Vector3(-0.07, 0.43, -0.12), new Vector3(-0.085, 0.49, -0.01), 0.006, 5, 1));
    gear.push(capsule(new Vector3(-0.085, 0.49, -0.01), new Vector3(-0.09, 0.4, 0.12), 0.006, 5, 1));
    straps(0.03);
  }
  p = { gear: merge(gear), metal: merge(metal.length ? metal : [new BoxGeometry(0.001, 0.001, 0.001)]) };
  gearCache.set(key, p);
  return p;
}

/** Balo dân thường (toạ độ eo): túi vải bạt bo tròn, nắp trùm, túi ngoài, quai vai; cuộn chăn buộc trên đỉnh. */
export function rucksack() {
  const hit = gearCache.get("ruck");
  if (hit) return { bag: hit.gear, strap: hit.metal };
  const bag: BufferGeometry[] = [
    loft(
      [
        { y: -0.02, w: 0 },
        { y: -0.015, w: 0.15, f: 0.07, b: 0.08, z: -0.215, n: 3.6 },
        { y: 0.08, w: 0.165, f: 0.08, b: 0.1, z: -0.22, n: 3.6 },
        { y: 0.3, w: 0.165, f: 0.08, b: 0.1, z: -0.22, n: 3.6 },
        { y: 0.4, w: 0.15, f: 0.075, b: 0.085, z: -0.218, n: 3.4 },
        { y: 0.42, w: 0 },
      ],
      18,
    ),
    // Nắp trùm đỉnh vắt xuống sau lưng, túi ngoài có nắp.
    loft(
      [
        { y: 0.36, w: 0.155, f: 0.082, b: 0.095, z: -0.218, n: 3.6 },
        { y: 0.425, w: 0.158, f: 0.084, b: 0.1, z: -0.22, n: 3.6 },
        { y: 0.44, w: 0 },
      ],
      18,
    ),
    block(0.2, 0.15, 0.05, [0, 0.12, -0.325]),
    block(0.21, 0.04, 0.056, [0, 0.19, -0.325], [-0.1, 0, 0]),
  ];
  const straps: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    straps.push(...strap([[s * 0.1, 0.4, -0.15], [s * 0.088, 0.485, -0.02], [s * 0.09, 0.43, ringAt(TORSO, 0.43, "f") + 0.004], [s * 0.11, 0.2, ringAt(TORSO, 0.2, "f") + 0.006], [s * 0.14, 0.05, 0.02]], 0.042, 0.008));
    // Dây buộc cuộn chăn.
    straps.push(loft([{ y: -0.008, w: 0.068 }, { y: 0.008, w: 0.068 }], 10).rotateZ(Math.PI / 2).translate(s * 0.12, 0.48, -0.2));
  }
  const g = { gear: merge(bag), metal: merge(straps) };
  gearCache.set("ruck", g);
  return { bag: g.gear, strap: g.metal };
}

/** Cuộn chăn trên balo. */
export function bedroll(): BufferGeometry {
  const hit = gearCache.get("bedroll");
  if (hit) return hit.gear;
  const g = merge([
    loft(
      [
        { y: -0.215, w: 0 },
        { y: -0.21, w: 0.058 },
        { y: -0.19, w: 0.064 },
        { y: 0.19, w: 0.064 },
        { y: 0.21, w: 0.058 },
        { y: 0.215, w: 0 },
      ],
      12,
    )
      .rotateZ(Math.PI / 2)
      .translate(0, 0.48, -0.2),
  ]);
  gearCache.set("bedroll", { gear: g, metal: g });
  return g;
}

/** Băng tay màu đội (tay trái, lính): nhận ra đồng đội từ xa. */
export function armband(): BufferGeometry {
  const hit = gearCache.get("armband");
  if (hit) return hit.gear;
  const r = loose(UPPER_ARM, 1.05, 0.002);
  const g = loft(
    [
      { y: -0.08, w: ringAt(r, -0.08, "w") + 0.003, f: ringAt(r, -0.08, "f") + 0.003, b: ringAt(r, -0.08, "b") + 0.003 },
      { y: -0.125, w: ringAt(r, -0.125, "w") + 0.003, f: ringAt(r, -0.125, "f") + 0.003, b: ringAt(r, -0.125, "b") + 0.003 },
    ],
    14,
  );
  gearCache.set("armband", { gear: g, metal: g });
  return g;
}

