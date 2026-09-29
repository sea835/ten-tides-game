import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Mô hình 3D dựng bằng khối cho chế độ Battleground: súng (cầm trên tay và nằm dưới đất), đạn, giáp, mũ, lựu đạn,
// bom khói, mìn, băng gạc, hộp cứu thương, tiền. Mỗi mô hình gộp các khối cùng vật liệu thành một hình (ít lệnh vẽ),
// dựng một lần rồi dùng chung cho mọi người chơi.
// Quy ước súng: gốc toạ độ ở tay cầm (chỗ tay phải nắm), nòng chĩa theo +z, trên là +y, đơn vị mét, kích thước thật.
// Bên phải khẩu súng là -x (cùng quy ước với nhân vật nhìn theo +z).

type V3 = [number, number, number];

// ---------------------------------------------------------------------------- vật liệu

interface MatDef {
  color: string;
  metal?: number;
  rough?: number;
  detail?: string;
  opacity?: number;
  double?: boolean;
}

const MATS: Record<string, MatDef> = {
  metal: { color: "#2b2d30", metal: 0.6, rough: 0.42, detail: "none" },
  steel: { color: "#8d9299", metal: 0.85, rough: 0.32, detail: "none" },
  poly: { color: "#1e1f21", rough: 0.72, detail: "none" },
  wood: { color: "#7b4a26", rough: 0.55, detail: "none" },
  darkwood: { color: "#553019", rough: 0.55, detail: "none" },
  bakelite: { color: "#4a2a1e", rough: 0.55, detail: "none" },
  tan: { color: "#b39c74", rough: 0.75, detail: "none" },
  olive: { color: "#4c5838", rough: 0.75, detail: "none" },
  glass: { color: "#0d1b26", metal: 0.9, rough: 0.08, detail: "none" },
  brass: { color: "#c9a14a", metal: 0.85, rough: 0.3, detail: "none" },
  white: { color: "#e8e6e0", rough: 0.85, detail: "fabric" },
  red: { color: "#b8282a", rough: 0.6, detail: "none" },
  cash: { color: "#7fa36a", rough: 0.9, detail: "paper" },
  band: { color: "#e9dfbf", rough: 0.9, detail: "paper" },
  vest1: { color: "#6f6a4c", rough: 0.92, detail: "fabric" },
  vest2: { color: "#4f5638", rough: 0.9, detail: "fabric" },
  vest3: { color: "#2b2d2b", rough: 0.85, detail: "fabric" },
  pouch: { color: "#5d5f45", rough: 0.92, detail: "fabric" },
  plate: { color: "#3c4130", rough: 0.7, detail: "none" },
  strap: { color: "#232420", rough: 0.9, detail: "fabric" },
  helmet1: { color: "#5e5c3e", rough: 0.9, detail: "fabric" },
  helmet2: { color: "#56603f", rough: 0.7, detail: "none" },
  helmet3: { color: "#39402f", rough: 0.6, detail: "none" },
  visor: { color: "#1c2a33", metal: 0.6, rough: 0.1, opacity: 0.55, detail: "none", double: true },
  // Hộp đạn: màu theo cỡ đạn cho dễ nhận ra.
  "ammo:9mm": { color: "#c9a33a", rough: 0.7, detail: "none" },
  "ammo:45acp": { color: "#3d6fcf", rough: 0.7, detail: "none" },
  "ammo:556": { color: "#3f8f3f", rough: 0.7, detail: "none" },
  "ammo:762": { color: "#c65a26", rough: 0.7, detail: "none" },
  "ammo:12g": { color: "#b83232", rough: 0.7, detail: "none" },
  "ammo:300": { color: "#7a4bb0", rough: 0.7, detail: "none" },
  ammobox: { color: "#4a4f36", rough: 0.8, detail: "none" },
};

const matCache = new Map<string, MeshStandardMaterial>();

/** Vật liệu dùng chung theo tên (và độ trong: người chơi đã chết vẽ mờ). */
export function gearMaterial(key: string, opacity = 1): MeshStandardMaterial {
  const id = `${key}|${opacity}`;
  let m = matCache.get(id);
  if (m) return m;
  const d = MATS[key] ?? MATS.metal!;
  const alpha = Math.min(opacity, d.opacity ?? 1);
  m = new MeshStandardMaterial({ color: d.color, metalness: d.metal ?? 0, roughness: d.rough ?? 0.7, transparent: alpha < 1, opacity: alpha, side: d.double ? DoubleSide : undefined });
  if (alpha < 1) m.depthWrite = false;
  m.userData.detail = d.detail ?? "none";
  m.userData.detailSpace = "object";
  matCache.set(id, m);
  return m;
}

// ---------------------------------------------------------------------------- khối hình

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();

function place(g: BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): BufferGeometry {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  g.applyMatrix4(_m.compose(new Vector3(...p), _q, new Vector3(...s)));
  return g;
}

type Part = [string, BufferGeometry];

/** Hộp rộng w (x), cao h (y), dài d (z). */
const box = (k: string, w: number, h: number, d: number, p: V3, r?: V3): Part => [k, place(new BoxGeometry(w, h, d), p, r)];

/** Ống tròn nằm dọc trục (mặc định z: đầu `r` quay về +z, đầu `r2` quay về -z). */
function cyl(k: string, r: number, len: number, p: V3, o: { r2?: number; axis?: "x" | "y" | "z"; segs?: number; rot?: V3; open?: boolean } = {}): Part {
  const g = new CylinderGeometry(r, o.r2 ?? r, len, o.segs ?? 12, 1, !!o.open);
  if ((o.axis ?? "z") === "z") g.rotateX(Math.PI / 2);
  else if (o.axis === "x") g.rotateZ(-Math.PI / 2);
  return [k, place(g, p, o.rot)];
}

const sph = (k: string, r: number, p: V3, s: V3 = [1, 1, 1], r3?: V3, seg: [number, number] = [12, 8]): Part => [k, place(new SphereGeometry(r, seg[0], seg[1]), p, r3, s)];

/** Chỏm cầu (mũ): phần trên của khối cầu tới góc `theta` tính từ đỉnh. */
const dome = (k: string, theta: number, p: V3, s: V3, r3?: V3): Part => [k, place(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, theta), p, r3, s)];

const torus = (k: string, r: number, tube: number, p: V3, r3?: V3, s?: V3): Part => [k, place(new TorusGeometry(r, tube, 6, 16), p, r3, s)];

/** Vòng bầu dục nằm ngang (bán kính rx theo x, rz theo z, dây dày t), nghiêng `tilt` quanh trục x. */
const ring = (k: string, rx: number, rz: number, t: number, p: V3, tilt = 0): Part => [k, place(new TorusGeometry(1, t / rx, 6, 20), p, [Math.PI / 2 + tilt, 0, 0], [rx, rz, rx])];

/** Gộp các khối cùng vật liệu thành một hình. */
function merge(parts: Part[]): { key: string; geo: BufferGeometry }[] {
  const byKey = new Map<string, BufferGeometry[]>();
  for (const [k, g] of parts) {
    // Chỏm cầu/ống hở có thể thiếu chỉ số hoặc khác thuộc tính: đưa về cùng một kiểu (có chỉ số, đủ normal + uv).
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(g);
  }
  return [...byKey].map(([key, list]) => {
    const geo = mergeGeometries(list, false)!;
    for (const g of list) g.dispose();
    geo.computeBoundingSphere();
    // Pháp tuyến có sẵn đã đúng (cạnh hộp sắc, ống tròn mượt): khỏi để trình quét cảnh làm mượt lại.
    geo.userData.smooth = true;
    return { key, geo };
  });
}

// ---------------------------------------------------------------------------- các bộ phận dùng chung

/** Tay cầm súng: nghiêng về sau, gốc ở giữa lòng bàn tay. */
const grip = (k = "poly", w = 0.032): Part => box(k, w, 0.105, 0.045, [0, -0.005, -0.012], [0.3, 0, 0]);

/** Vòng cò và cò súng. */
const trigger = (z = 0.035, y = 0.02): Part[] => [box("metal", 0.008, 0.008, 0.07, [0, y - 0.005, z + 0.01]), box("metal", 0.008, 0.035, 0.008, [0, y + 0.01, z + 0.045]), box("metal", 0.006, 0.025, 0.008, [0, y + 0.018, z])];

/** Băng đạn thẳng kiểu STANAG, hơi cong về trước ở đáy. */
const stanag = (z: number, k = "poly"): Part[] => [box(k, 0.028, 0.1, 0.068, [0, -0.005, z], [-0.08, 0, 0]), box(k, 0.028, 0.07, 0.066, [0, -0.085, z + 0.012], [-0.22, 0, 0]), box("metal", 0.042, 0.05, 0.085, [0, 0.04, z])];

/** Ray gắn phụ kiện trên nóc: một thanh và các rãnh ngang. */
function rail(z0: number, z1: number, y: number, w = 0.028): Part[] {
  const out: Part[] = [box("metal", w, 0.01, z1 - z0, [0, y, (z0 + z1) / 2])];
  for (let z = z0 + 0.01; z < z1 - 0.005; z += 0.022) out.push(box("metal", w + 0.006, 0.006, 0.008, [0, y + 0.007, z]));
  return out;
}

/** Ống ngắm: thân ống, loa vật kính trước, thị kính sau, hai núm chỉnh, hai chân kẹp, mặt kính. */
function scope(y: number, z: number, len: number, r: number, bell: number): Part[] {
  return [
    cyl("metal", r, len, [0, y, z]),
    cyl("metal", bell, 0.07, [0, y, z + len / 2 + 0.025], { r2: r }),
    cyl("metal", bell * 0.88, 0.05, [0, y, z - len / 2 - 0.015], { r2: r * 1.05 }),
    cyl("glass", bell * 0.85, 0.004, [0, y, z + len / 2 + 0.061]),
    cyl("glass", bell * 0.7, 0.004, [0, y, z - len / 2 - 0.041]),
    cyl("metal", r * 0.62, 0.035, [0, y + r + 0.012, z], { axis: "y" }),
    cyl("metal", r * 0.62, 0.035, [-(r + 0.012), y, z], { axis: "x" }),
    box("metal", 0.022, y - 0.12, 0.022, [0, (y + 0.12) / 2, z - len * 0.3]),
    box("metal", 0.022, y - 0.12, 0.022, [0, (y + 0.12) / 2, z + len * 0.3]),
  ];
}

/** Chân chống gấp dọc dưới nòng. */
const bipod = (y: number, z: number, len: number): Part[] => [cyl("metal", 0.006, len, [0.014, y, z], { segs: 6 }), cyl("metal", 0.006, len, [-0.014, y, z], { segs: 6 }), box("metal", 0.04, 0.02, 0.03, [0, y + 0.01, z + len / 2])];

/** Tay kéo khoá nòng súng trường (bên phải: -x). */
const bolt = (y: number, z: number): Part[] => [cyl("steel", 0.005, 0.06, [-0.035, y - 0.005, z], { axis: "x", segs: 6, rot: [0, 0, 0.35] }), sph("steel", 0.011, [-0.064, y - 0.018, z], [1, 1, 1], undefined, [8, 6])];

// ---------------------------------------------------------------------------- từng khẩu súng

interface GunSpec {
  parts: () => Part[];
  muzzle: V3;
  sight: number;
  /** Chỗ tay trái đỡ (ốp lót tay), trong toạ độ súng. */
  support: V3;
  /** Khoảng cách từ tay cầm tới đế báng (0 là súng lục). */
  stock: number;
}

const GUNS: Record<string, GunSpec> = {
  // Súng lục P92: khung nhựa, khối trượt thép.
  p92: {
    muzzle: [0, 0.075, 0.165],
    sight: 0.094,
    support: [0.024, -0.012, 0.005],
    stock: 0,
    parts: () => [
      box("poly", 0.03, 0.1, 0.045, [0, -0.005, -0.01], [0.25, 0, 0]),
      box("poly", 0.028, 0.026, 0.15, [0, 0.04, 0.06]),
      box("metal", 0.03, 0.034, 0.19, [0, 0.07, 0.06]),
      cyl("metal", 0.007, 0.012, [0, 0.075, 0.16]),
      box("metal", 0.024, 0.008, 0.008, [0, 0.09, -0.025]),
      box("metal", 0.006, 0.008, 0.008, [0, 0.09, 0.145]),
      box("poly", 0.03, 0.012, 0.035, [0, -0.057, -0.022]),
      ...trigger(0.035, 0.015),
    ],
  },
  // Deagle: to, nặng, khối trượt bạc tam giác.
  deagle: {
    muzzle: [0, 0.085, 0.215],
    sight: 0.108,
    support: [0.026, -0.014, 0.005],
    stock: 0,
    parts: () => [
      box("poly", 0.034, 0.112, 0.05, [0, -0.01, -0.012], [0.25, 0, 0]),
      box("steel", 0.032, 0.03, 0.2, [0, 0.042, 0.08]),
      box("steel", 0.036, 0.042, 0.25, [0, 0.078, 0.08]),
      box("steel", 0.022, 0.012, 0.25, [0, 0.102, 0.08]),
      cyl("metal", 0.009, 0.01, [0, 0.085, 0.21]),
      box("metal", 0.026, 0.01, 0.01, [0, 0.112, -0.035]),
      box("metal", 0.006, 0.01, 0.01, [0, 0.112, 0.19]),
      ...trigger(0.04, 0.012),
    ],
  },
  // UMP45: thân hộp nhựa to bản, băng thẳng, báng khung gấp.
  ump45: {
    muzzle: [0, 0.095, 0.35],
    sight: 0.165,
    support: [0.0, 0.03, 0.22],
    stock: 0.31,
    parts: () => [
      box("poly", 0.052, 0.09, 0.36, [0, 0.085, 0.1]),
      box("poly", 0.05, 0.03, 0.12, [0, 0.03, 0.22]),
      ...rail(-0.07, 0.25, 0.135, 0.026),
      cyl("metal", 0.016, 0.02, [0, 0.095, 0.29]),
      cyl("metal", 0.012, 0.07, [0, 0.095, 0.315]),
      box("poly", 0.03, 0.17, 0.06, [0, -0.045, 0.13], [-0.06, 0, 0]),
      grip("poly", 0.035),
      box("poly", 0.03, 0.02, 0.08, [0, 0.015, 0.035]),
      box("metal", 0.006, 0.025, 0.008, [0, 0.035, 0.03]),
      box("poly", 0.012, 0.012, 0.22, [0.018, 0.11, -0.19]),
      box("poly", 0.012, 0.012, 0.22, [-0.018, 0.11, -0.19]),
      box("poly", 0.012, 0.012, 0.2, [0, 0.05, -0.18], [-0.12, 0, 0]),
      box("poly", 0.045, 0.11, 0.025, [0, 0.08, -0.305]),
      box("metal", 0.03, 0.03, 0.015, [0, 0.155, -0.04]),
      box("metal", 0.012, 0.035, 0.012, [0, 0.15, 0.24]),
    ],
  },
  // Vector: khối dưới xiên đặc trưng, băng dài trước tay cầm, báng gấp mảnh.
  vector: {
    muzzle: [0, 0.095, 0.355],
    sight: 0.16,
    support: [0.0, 0.025, 0.21],
    stock: 0.29,
    parts: () => [
      box("poly", 0.05, 0.065, 0.34, [0, 0.1, 0.09]),
      box("poly", 0.05, 0.13, 0.1, [0, 0.03, 0.21], [0.55, 0, 0]),
      box("poly", 0.048, 0.05, 0.14, [0, 0.05, 0.04]),
      box("poly", 0.028, 0.2, 0.055, [0, -0.07, 0.1]),
      grip(),
      ...trigger(0.03, 0.02),
      cyl("metal", 0.016, 0.1, [0, 0.095, 0.3]),
      cyl("metal", 0.01, 0.02, [0, 0.095, 0.35]),
      ...rail(-0.07, 0.25, 0.138, 0.026),
      box("metal", 0.024, 0.03, 0.012, [0, 0.155, -0.05]),
      box("metal", 0.01, 0.03, 0.012, [0, 0.155, 0.24]),
      box("poly", 0.03, 0.05, 0.2, [0, 0.1, -0.17]),
      box("poly", 0.04, 0.09, 0.025, [0, 0.085, -0.28]),
    ],
  },
  // M416: thân nhôm đen, ốp lót tay có ray, báng rút, tay cầm đứng.
  m416: {
    muzzle: [0, 0.105, 0.565],
    sight: 0.172,
    support: [0.0, 0.06, 0.3],
    stock: 0.34,
    parts: () => [
      box("metal", 0.05, 0.05, 0.22, [0, 0.07, 0.03]),
      box("metal", 0.052, 0.045, 0.3, [0, 0.115, 0.05]),
      ...rail(-0.09, 0.41, 0.143),
      box("metal", 0.058, 0.062, 0.22, [0, 0.1, 0.31]),
      box("metal", 0.066, 0.01, 0.2, [0, 0.1, 0.31]),
      cyl("metal", 0.011, 0.1, [0, 0.105, 0.47]),
      cyl("metal", 0.015, 0.045, [0, 0.105, 0.54], { segs: 8 }),
      box("metal", 0.01, 0.035, 0.012, [0, 0.165, 0.39]),
      box("metal", 0.03, 0.03, 0.02, [0, 0.162, -0.07]),
      box("metal", 0.04, 0.012, 0.02, [0, 0.135, -0.1]),
      cyl("poly", 0.014, 0.075, [0, 0.035, 0.33], { axis: "y" }),
      ...stanag(0.11),
      grip(),
      ...trigger(0.035, 0.02),
      cyl("metal", 0.016, 0.15, [0, 0.1, -0.16]),
      box("poly", 0.046, 0.085, 0.13, [0, 0.083, -0.265]),
      box("poly", 0.048, 0.105, 0.016, [0, 0.078, -0.332]),
    ],
  },
  // AKM: gỗ ốp, ống trích khí trên nòng, băng cong hình quả chuối, báng gỗ đổ xuống.
  akm: {
    muzzle: [0, 0.09, 0.68],
    sight: 0.145,
    support: [0.0, 0.055, 0.29],
    stock: 0.41,
    parts: () => [
      box("metal", 0.048, 0.07, 0.3, [0, 0.085, 0.03]),
      cyl("metal", 0.022, 0.28, [0, 0.112, 0.02], { segs: 10 }),
      box("metal", 0.03, 0.028, 0.04, [0, 0.128, 0.17]),
      box("wood", 0.05, 0.05, 0.2, [0, 0.075, 0.29]),
      cyl("wood", 0.018, 0.16, [0, 0.128, 0.27], { segs: 10 }),
      cyl("metal", 0.01, 0.1, [0, 0.128, 0.4], { segs: 8 }),
      box("metal", 0.03, 0.035, 0.03, [0, 0.11, 0.44]),
      cyl("metal", 0.011, 0.3, [0, 0.09, 0.49]),
      box("metal", 0.018, 0.05, 0.025, [0, 0.12, 0.6]),
      cyl("metal", 0.014, 0.04, [0, 0.09, 0.66], { segs: 8 }),
      box("bakelite", 0.03, 0.1, 0.075, [0, -0.01, 0.1], [-0.15, 0, 0]),
      box("bakelite", 0.03, 0.1, 0.07, [0, -0.1, 0.135], [-0.45, 0, 0]),
      grip("darkwood"),
      ...trigger(0.035, 0.03),
      box("wood", 0.042, 0.072, 0.3, [0, 0.06, -0.26], [-0.12, 0, 0]),
      box("wood", 0.044, 0.11, 0.05, [0, 0.03, -0.39], [-0.12, 0, 0]),
      box("metal", 0.046, 0.115, 0.012, [0, 0.03, -0.418], [-0.12, 0, 0]),
    ],
  },
  // SCAR-L: thân trên màu cát liền ray, thân dưới đen, báng gấp có tì má, kính ngắm toàn ký.
  scar: {
    muzzle: [0, 0.1, 0.51],
    sight: 0.178,
    support: [0.0, 0.06, 0.26],
    stock: 0.34,
    parts: () => [
      box("tan", 0.055, 0.065, 0.5, [0, 0.105, 0.12]),
      box("poly", 0.048, 0.05, 0.2, [0, 0.06, 0.03]),
      ...rail(-0.12, 0.37, 0.143),
      box("poly", 0.064, 0.012, 0.16, [0, 0.1, 0.28]),
      cyl("metal", 0.011, 0.09, [0, 0.1, 0.41]),
      cyl("metal", 0.015, 0.05, [0, 0.1, 0.485], { segs: 8 }),
      box("poly", 0.02, 0.015, 0.03, [0.035, 0.115, 0.18]),
      // Kính toàn ký: đế, hai cột, mái, mặt kính.
      box("poly", 0.04, 0.012, 0.07, [0, 0.155, 0.0]),
      box("poly", 0.006, 0.04, 0.05, [0.017, 0.178, 0.0]),
      box("poly", 0.006, 0.04, 0.05, [-0.017, 0.178, 0.0]),
      box("poly", 0.04, 0.006, 0.05, [0, 0.2, 0.0]),
      box("glass", 0.028, 0.034, 0.003, [0, 0.178, 0.012]),
      ...stanag(0.11),
      grip(),
      ...trigger(0.035, 0.02),
      box("tan", 0.045, 0.07, 0.22, [0, 0.09, -0.23]),
      box("tan", 0.04, 0.022, 0.14, [0, 0.132, -0.22]),
      box("poly", 0.05, 0.1, 0.02, [0, 0.075, -0.34]),
    ],
  },
  // M249: súng máy to, hộp đạn treo bên trái, nòng dài có chân chống, quai xách.
  m249: {
    muzzle: [0, 0.1, 0.79],
    sight: 0.17,
    support: [0.0, 0.06, 0.3],
    stock: 0.44,
    parts: () => [
      box("metal", 0.07, 0.1, 0.34, [0, 0.09, 0.03]),
      box("metal", 0.072, 0.03, 0.2, [0, 0.152, 0.0]),
      box("poly", 0.062, 0.062, 0.2, [0, 0.1, 0.3]),
      cyl("metal", 0.013, 0.34, [0, 0.1, 0.57]),
      cyl("metal", 0.016, 0.05, [0, 0.1, 0.765], { segs: 8 }),
      box("metal", 0.02, 0.03, 0.14, [0, 0.175, 0.32]),
      box("metal", 0.012, 0.04, 0.012, [0, 0.15, 0.26]),
      box("metal", 0.012, 0.04, 0.012, [0, 0.15, 0.38]),
      box("metal", 0.01, 0.05, 0.015, [0, 0.13, 0.72]),
      box("metal", 0.03, 0.03, 0.03, [0, 0.168, -0.1]),
      ...bipod(0.07, 0.56, 0.3),
      box("olive", 0.09, 0.11, 0.1, [0.03, -0.02, 0.07]),
      box("olive", 0.094, 0.012, 0.104, [0.03, 0.03, 0.07]),
      box("brass", 0.02, 0.02, 0.05, [0.045, 0.06, 0.07]),
      grip(),
      ...trigger(0.03, 0.03),
      box("poly", 0.05, 0.1, 0.28, [0, 0.075, -0.28]),
      box("poly", 0.055, 0.125, 0.03, [0, 0.07, -0.43]),
    ],
  },
  // S686: hai nòng song song, báng và ốp lót tay gỗ, khung thép sáng.
  s686: {
    muzzle: [0, 0.095, 0.68],
    sight: 0.117,
    support: [0.0, 0.05, 0.22],
    stock: 0.37,
    parts: () => [
      box("steel", 0.06, 0.07, 0.12, [0, 0.075, 0.0]),
      cyl("metal", 0.0125, 0.62, [0.0135, 0.095, 0.37]),
      cyl("metal", 0.0125, 0.62, [-0.0135, 0.095, 0.37]),
      box("metal", 0.01, 0.006, 0.62, [0, 0.111, 0.37]),
      sph("steel", 0.004, [0, 0.117, 0.67], [1, 1, 1], undefined, [6, 4]),
      box("wood", 0.05, 0.04, 0.26, [0, 0.07, 0.2]),
      box("darkwood", 0.036, 0.1, 0.05, [0, 0.0, -0.03], [0.45, 0, 0]),
      ...trigger(0.03, 0.03),
      box("wood", 0.045, 0.07, 0.3, [0, 0.055, -0.2], [-0.12, 0, 0]),
      box("wood", 0.046, 0.11, 0.03, [0, 0.035, -0.35], [-0.12, 0, 0]),
      box("metal", 0.048, 0.114, 0.012, [0, 0.033, -0.368], [-0.12, 0, 0]),
    ],
  },
  // SKS: báng gỗ liền thân, lưỡi lê gấp dưới nòng, ống ngắm 4x.
  sks: {
    muzzle: [0, 0.095, 0.66],
    sight: 0.165,
    support: [0.0, 0.05, 0.2],
    stock: 0.42,
    parts: () => [
      box("wood", 0.045, 0.06, 0.56, [0, 0.06, 0.05]),
      box("wood", 0.044, 0.1, 0.2, [0, 0.04, -0.32], [-0.12, 0, 0]),
      box("metal", 0.046, 0.104, 0.012, [0, 0.03, -0.42], [-0.12, 0, 0]),
      box("wood", 0.035, 0.09, 0.05, [0, 0.0, -0.03], [0.45, 0, 0]),
      box("metal", 0.038, 0.045, 0.26, [0, 0.105, 0.0]),
      cyl("metal", 0.011, 0.4, [0, 0.095, 0.45]),
      cyl("wood", 0.016, 0.16, [0, 0.118, 0.22], { segs: 10 }),
      cyl("metal", 0.009, 0.2, [0, 0.122, 0.34], { segs: 8 }),
      box("metal", 0.035, 0.06, 0.08, [0, 0.01, 0.06]),
      box("metal", 0.012, 0.035, 0.015, [0, 0.12, 0.6]),
      box("steel", 0.008, 0.012, 0.26, [0, 0.074, 0.47]),
      ...trigger(0.0, 0.035),
      ...scope(0.165, 0.0, 0.26, 0.015, 0.022),
    ],
  },
  // Kar98k: súng trường khoá nòng cổ điển, báng gỗ dài, tay khoá cong bên phải, ống ngắm.
  kar98k: {
    muzzle: [0, 0.095, 0.71],
    sight: 0.152,
    support: [0.0, 0.05, 0.25],
    stock: 0.45,
    parts: () => [
      box("wood", 0.045, 0.06, 0.66, [0, 0.06, 0.09]),
      box("wood", 0.044, 0.11, 0.22, [0, 0.035, -0.34], [-0.12, 0, 0]),
      box("metal", 0.046, 0.115, 0.012, [0, 0.03, -0.45], [-0.12, 0, 0]),
      box("wood", 0.035, 0.09, 0.05, [0, 0.0, -0.03], [0.45, 0, 0]),
      box("wood", 0.03, 0.018, 0.3, [0, 0.104, 0.27]),
      cyl("metal", 0.018, 0.22, [0, 0.1, 0.0]),
      ...bolt(0.1, -0.05),
      cyl("metal", 0.011, 0.31, [0, 0.095, 0.55]),
      cyl("metal", 0.018, 0.015, [0, 0.085, 0.25], { segs: 8 }),
      cyl("metal", 0.018, 0.015, [0, 0.085, 0.4], { segs: 8 }),
      box("metal", 0.016, 0.03, 0.02, [0, 0.115, 0.69]),
      box("metal", 0.03, 0.012, 0.07, [0, 0.03, 0.03]),
      ...trigger(-0.01, 0.035),
      ...scope(0.152, -0.01, 0.28, 0.015, 0.022),
    ],
  },
  // AWM: khung báng xanh ô liu có lỗ ngón cái, nòng to với hãm nẩy, ống ngắm lớn, chân chống.
  awm: {
    muzzle: [0, 0.1, 0.78],
    sight: 0.178,
    support: [0.0, 0.04, 0.25],
    stock: 0.46,
    parts: () => [
      box("olive", 0.06, 0.07, 0.46, [0, 0.07, 0.1]),
      cyl("metal", 0.02, 0.26, [0, 0.115, 0.0]),
      ...bolt(0.115, -0.08),
      cyl("metal", 0.014, 0.38, [0, 0.1, 0.52]),
      box("metal", 0.04, 0.035, 0.07, [0, 0.1, 0.745]),
      box("olive", 0.05, 0.05, 0.3, [0, 0.1, -0.28]),
      box("olive", 0.05, 0.035, 0.22, [0, 0.0, -0.3]),
      box("olive", 0.052, 0.14, 0.035, [0, 0.055, -0.44]),
      box("poly", 0.054, 0.14, 0.012, [0, 0.055, -0.463]),
      box("olive", 0.04, 0.022, 0.1, [0, 0.135, -0.25]),
      grip("olive", 0.035),
      ...trigger(0.035, 0.02),
      box("metal", 0.035, 0.06, 0.1, [0, 0.015, 0.07]),
      ...bipod(0.05, 0.42, 0.28),
      ...rail(-0.1, 0.14, 0.142, 0.026),
      ...scope(0.178, 0.0, 0.32, 0.017, 0.028),
    ],
  },
};

const DEFAULT_GUN = GUNS.m416!;
const built = new Map<string, { key: string; geo: BufferGeometry }[]>();

function gunParts(id: string) {
  let b = built.get(id);
  if (!b) {
    b = merge((GUNS[id] ?? DEFAULT_GUN).parts());
    built.set(id, b);
  }
  return b;
}

/** Đầu nòng (nơi loé lửa) trong toạ độ súng, ở tỉ lệ 1. */
export function muzzleOffset(weaponId: string): [number, number, number] {
  return [...(GUNS[weaponId] ?? DEFAULT_GUN).muzzle];
}

/** Độ cao đường ngắm (điểm ruồi / tâm ống ngắm) so với tay cầm. */
export function sightHeight(weaponId: string): number {
  return (GUNS[weaponId] ?? DEFAULT_GUN).sight;
}

/** Chỗ tay trái đỡ súng (dưới ốp lót tay; súng lục thì ôm lấy tay phải). */
export function supportOffset(weaponId: string): [number, number, number] {
  return [...(GUNS[weaponId] ?? DEFAULT_GUN).support];
}

/** Chiều dài báng tính từ tay cầm ra sau (0: súng lục). */
export function stockLength(weaponId: string): number {
  return (GUNS[weaponId] ?? DEFAULT_GUN).stock;
}

/** Vẽ các hình đã gộp với vật liệu dùng chung. */
function Parts({ list, opacity = 1 }: { list: { key: string; geo: BufferGeometry }[]; opacity?: number }) {
  return (
    <>
      {list.map(({ key, geo }) => (
        <mesh key={key} geometry={geo} material={gearMaterial(key, opacity)} castShadow receiveShadow />
      ))}
    </>
  );
}

/** Khẩu súng theo id (WEAPONS). Gốc ở tay cầm, nòng theo +z. */
export function GunModel({ weaponId, scale = 1, opacity = 1 }: { weaponId: string; scale?: number; opacity?: number }) {
  return (
    <group scale={scale}>
      <Parts list={gunParts(weaponId)} opacity={opacity} />
    </group>
  );
}

// ---------------------------------------------------------------------------- áo giáp và mũ

/**
 * Áo giáp theo cấp, dựng trong toạ độ thân người (y = 0 ở eo, ngực quanh y 0.3, mặt trước +z).
 * Cấp 1: áo vải chần mềm. Cấp 2: thêm tấm chắn trước sau và túi băng đạn. Cấp 3: đen, tấm to, đệm vai, cổ, hông, hai hàng túi.
 */
function vestParts(level: number): Part[] {
  const k = level >= 3 ? "vest3" : level === 2 ? "vest2" : "vest1";
  const pts = [
    [0.166, 0.05],
    [0.172, 0.12],
    [0.183, 0.2],
    [0.194, 0.28],
    [0.197, 0.35],
    [0.188, 0.41],
    [0.168, 0.45],
  ].map(([r, y]) => new Vector2(r!, y!));
  const shell = new LatheGeometry(pts, 18);
  const parts: Part[] = [[k, place(shell, [0, 0, 0], [0, 0, 0], [1, 1, 0.78])]];
  // Quai vai.
  for (const x of [-0.095, 0.095]) parts.push(box(k, 0.065, 0.024, 0.25, [x, 0.49, 0], [0, 0, x > 0 ? -0.35 : 0.35]));
  if (level <= 1) {
    // Đường chần ngang trên áo mềm.
    for (const y of [0.16, 0.26, 0.36]) parts.push(ring("strap", 0.176 + (y - 0.16) * 0.1, (0.176 + (y - 0.16) * 0.1) * 0.78, 0.006, [0, y, 0]));
    return parts;
  }
  const big = level >= 3;
  // Tấm chắn trước và sau.
  parts.push(box("plate", big ? 0.28 : 0.25, big ? 0.3 : 0.26, 0.03, [0, 0.28, 0.148]));
  parts.push(box("plate", big ? 0.28 : 0.25, big ? 0.3 : 0.26, 0.03, [0, 0.28, -0.148]));
  // Túi băng đạn phía trước bụng, nắp túi sẫm hơn.
  const rows = big ? [0.13, 0.22] : [0.14];
  for (const y of rows) {
    for (const x of [-0.085, 0, 0.085]) {
      parts.push(box("pouch", 0.07, 0.09, 0.045, [x, y, 0.182]));
      parts.push(box("strap", 0.072, 0.02, 0.047, [x, y + 0.04, 0.183]));
    }
  }
  // Bộ đàm bên trái ngực, dây đai hông.
  parts.push(box("pouch", 0.05, 0.1, 0.04, [0.12, 0.34, 0.16]));
  parts.push(cyl("strap", 0.004, 0.12, [0.12, 0.44, 0.16], { axis: "y", segs: 5 }));
  parts.push(ring("strap", 0.17, 0.134, 0.012, [0, 0.07, 0]));
  if (big) {
    // Tấm hông, đệm vai, cổ giáp, tấm che hạ bộ.
    for (const x of [-0.19, 0.19]) {
      parts.push(box("plate", 0.03, 0.18, 0.14, [x, 0.24, 0]));
      parts.push(sph(k, 0.075, [x * 1.03, 0.44, 0], [1, 0.55, 1.05], [0, 0, x > 0 ? -0.5 : 0.5], [12, 6]));
    }
    parts.push(torus(k, 0.075, 0.022, [0, 0.52, 0.0], [Math.PI / 2, 0, 0], [1.1, 0.85, 1]));
    parts.push(box(k, 0.16, 0.16, 0.03, [0, -0.07, 0.15], [0.12, 0, 0]));
  }
  return parts;
}

/**
 * Mũ theo cấp, trong toạ độ đầu (tâm hộp sọ ở y = 0.1, mặt nhìn +z).
 * Cấp 1: mũ vải có lưỡi trai. Cấp 2: mũ sắt quân đội có ray và giá kính đêm. Cấp 3: mũ nặng có che tai và kính chắn.
 */
function helmetParts(level: number): Part[] {
  if (level <= 1) {
    return [
      dome("helmet1", Math.PI * 0.5, [0, 0.118, -0.005], [0.102, 0.09, 0.114], [-0.12, 0, 0]),
      cyl("helmet1", 0.072, 0.008, [0, 0.128, 0.1], { axis: "y", rot: [0.18, 0, 0], segs: 14 }),
      ring("helmet1", 0.102, 0.114, 0.008, [0, 0.12, -0.005], -0.12),
    ];
  }
  if (level === 2) {
    return [
      dome("helmet2", Math.PI * 0.56, [0, 0.1, -0.008], [0.12, 0.122, 0.132], [-0.1, 0, 0]),
      ring("helmet2", 0.12, 0.132, 0.009, [0, 0.083, -0.006], -0.1),
      box("metal", 0.034, 0.036, 0.016, [0, 0.172, 0.118], [-0.45, 0, 0]),
      box("poly", 0.012, 0.016, 0.085, [0.118, 0.12, -0.005]),
      box("poly", 0.012, 0.016, 0.085, [-0.118, 0.12, -0.005]),
      box("strap", 0.008, 0.07, 0.012, [0.085, 0.035, 0.03], [0, 0, -0.15]),
      box("strap", 0.008, 0.07, 0.012, [-0.085, 0.035, 0.03], [0, 0, 0.15]),
    ];
  }
  return [
    dome("helmet3", Math.PI * 0.6, [0, 0.1, -0.008], [0.13, 0.13, 0.142], [-0.06, 0, 0]),
    ring("helmet3", 0.13, 0.142, 0.011, [0, 0.062, -0.01], -0.06),
    // Che tai hai bên.
    box("helmet3", 0.03, 0.09, 0.11, [0.123, 0.05, -0.015]),
    box("helmet3", 0.03, 0.09, 0.11, [-0.123, 0.05, -0.015]),
    // Kính chắn trước mặt và gờ trán giữ kính.
    [
      "visor",
      place(new CylinderGeometry(0.142, 0.135, 0.095, 16, 1, true, -0.95, 1.9), [0, 0.085, -0.012]),
    ],
    box("helmet3", 0.2, 0.022, 0.03, [0, 0.14, 0.12], [0.15, 0, 0]),
    box("metal", 0.02, 0.03, 0.03, [0.13, 0.12, 0.05]),
    box("metal", 0.02, 0.03, 0.03, [-0.13, 0.12, 0.05]),
  ];
}

const gear = new Map<string, { key: string; geo: BufferGeometry }[]>();
function gearParts(id: string, make: () => Part[]) {
  let b = gear.get(id);
  if (!b) {
    b = merge(make());
    gear.set(id, b);
  }
  return b;
}

/** Áo giáp mặc trên người (toạ độ thân: y = 0 ở eo). */
export function VestModel({ level, opacity = 1 }: { level: number; opacity?: number }) {
  if (level <= 0) return null;
  return <Parts list={gearParts(`vest${level}`, () => vestParts(level))} opacity={opacity} />;
}

/** Mũ đội trên đầu (toạ độ đầu: tâm sọ ở y = 0.1). */
export function HelmetModel({ level, opacity = 1 }: { level: number; opacity?: number }) {
  if (level <= 0) return null;
  return <Parts list={gearParts(`helmet${level}`, () => helmetParts(level))} opacity={opacity} />;
}

// ---------------------------------------------------------------------------- đồ nằm dưới đất

const LOOT: Record<string, () => Part[]> = {
  // Lựu đạn: thân tròn khía, ngòi, cần bẩy, khoen chốt.
  frag: () => [
    sph("olive", 0.034, [0, 0.042, 0], [1, 1.18, 1], undefined, [12, 10]),
    torus("olive", 0.033, 0.004, [0, 0.042, 0], [Math.PI / 2, 0, 0]),
    cyl("steel", 0.012, 0.028, [0, 0.088, 0], { axis: "y", segs: 8 }),
    box("steel", 0.012, 0.07, 0.006, [0, 0.07, 0.034], [-0.15, 0, 0]),
    torus("steel", 0.012, 0.0025, [0.02, 0.095, 0], [0, Math.PI / 2, 0]),
  ],
  // Bom khói: ống trụ xám xanh, sọc trắng, nắp ngòi.
  smoke: () => [
    cyl("olive", 0.03, 0.12, [0, 0.03, 0], { segs: 12 }),
    cyl("white", 0.0305, 0.018, [0, 0.03, 0.02], { segs: 12 }),
    cyl("steel", 0.014, 0.02, [0, 0.03, 0.07], { segs: 8 }),
    box("steel", 0.01, 0.006, 0.07, [0, 0.062, 0.03]),
  ],
  // Mìn: đĩa dẹt ô liu, mặt nén ở giữa.
  mine: () => [
    cyl("olive", 0.1, 0.04, [0, 0.02, 0], { axis: "y", r2: 0.105, segs: 18 }),
    cyl("poly", 0.036, 0.016, [0, 0.046, 0], { axis: "y", segs: 12 }),
    torus("poly", 0.08, 0.006, [0, 0.04, 0], [Math.PI / 2, 0, 0]),
  ],
  // Băng gạc: cuộn vải trắng nằm nghiêng, một đoạn duỗi ra.
  bandage: () => [cyl("white", 0.035, 0.07, [0, 0.035, 0], { axis: "x", segs: 14 }), box("white", 0.06, 0.004, 0.09, [0, 0.002, 0.07])],
  // Hộp cứu thương: hộp trắng, chữ thập đỏ, quai xách.
  medkit: () => [
    box("white", 0.26, 0.12, 0.18, [0, 0.06, 0]),
    box("red", 0.26, 0.03, 0.182, [0, 0.06, 0]),
    box("red", 0.1, 0.004, 0.03, [0, 0.122, 0]),
    box("red", 0.03, 0.004, 0.1, [0, 0.122, 0]),
    box("poly", 0.1, 0.02, 0.014, [0, 0.135, -0.07]),
  ],
  // Tiền: ba xấp giấy bạc buộc đai.
  money: () => [
    box("cash", 0.156, 0.03, 0.066, [0, 0.015, 0]),
    box("cash", 0.156, 0.03, 0.066, [0.02, 0.045, 0.01], [0, 0.25, 0]),
    box("cash", 0.156, 0.03, 0.066, [-0.03, 0.015, 0.075], [0, -0.2, 0]),
    box("band", 0.022, 0.032, 0.068, [0, 0.015, 0]),
    box("band", 0.022, 0.032, 0.068, [0.02, 0.045, 0.01], [0, 0.25, 0]),
    box("band", 0.022, 0.032, 0.068, [-0.03, 0.015, 0.075], [0, -0.2, 0]),
  ],
};

/** Hộp đạn: hộp ô liu có dải màu theo cỡ đạn, vài viên nằm trên nắp. */
function ammoParts(ammo: string): Part[] {
  const k = `ammo:${ammo}` in MATS ? `ammo:${ammo}` : "ammo:556";
  const shell = ammo === "12g";
  const parts: Part[] = [box("ammobox", 0.2, 0.11, 0.12, [0, 0.055, 0]), box(k, 0.202, 0.035, 0.122, [0, 0.065, 0]), box("poly", 0.08, 0.012, 0.02, [0, 0.116, 0])];
  for (let i = 0; i < 3; i++) {
    const x = -0.05 + i * 0.05;
    if (shell) parts.push(cyl(k, 0.01, 0.06, [x, 0.12, 0.03], { axis: "x", segs: 8 }));
    else parts.push(cyl("brass", 0.006, 0.05, [x, 0.117, 0.035], { segs: 6, r2: 0.006 }), sph("brass", 0.006, [x, 0.117, 0.06], [1, 1, 1.6], undefined, [6, 4]));
  }
  return parts;
}

/** Món đồ nằm dưới đất: id súng, "ammo:<id>", "armor:<cấp>", "helmet:<cấp>", ném, hồi máu, "money:<n>". */
export function LootModel({ id }: { id: string }) {
  if (id in GUNS) {
    const g = GUNS[id]!;
    const mid = (g.muzzle[2] - g.stock) / 2;
    // Súng nằm nghiêng (mặt trái lên trời), dịch cho giữa khẩu súng ở gốc.
    return (
      <group position-y={0.035} rotation-z={Math.PI / 2}>
        <group position-z={-mid}>
          <GunModel weaponId={id} />
        </group>
      </group>
    );
  }
  const [kind, arg = ""] = id.split(":");
  if (kind === "ammo") return <Parts list={gearParts(id, () => ammoParts(arg))} />;
  if (kind === "armor") {
    // Áo giáp nằm sấp gập dẹt trên đất (mặt trước có tấm chắn, túi đạn quay lên).
    return (
      <group position-y={0.075} rotation-x={-Math.PI / 2}>
        <group position-y={-0.27} scale={[1, 1, 0.45]}>
          <VestModel level={Number(arg) || 1} />
        </group>
      </group>
    );
  }
  if (kind === "helmet") {
    return (
      <group position-y={-0.05}>
        <HelmetModel level={Number(arg) || 1} />
      </group>
    );
  }
  const make = LOOT[kind ?? ""];
  if (!make) return <Parts list={gearParts("ammo:556", () => ammoParts("556"))} />;
  return <Parts list={gearParts(kind!, make)} />;
}
