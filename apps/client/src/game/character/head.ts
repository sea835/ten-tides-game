import { BufferAttribute, BufferGeometry, SphereGeometry, Vector3 } from "three";
import { capsule, ellipsoid, loft, merge, place, weldNormals, type V3 } from "./shapes.ts";

// Đầu người dựng bằng code: một khối cầu nắn thành hộp sọ, trán, hốc mắt, gò má, quai hàm, cằm; mũi, tai, mí mắt
// gộp chung một hình da. Tóc và râu là lớp vỏ bọc theo đúng mặt da, dày mỏng theo kiểu.
// Toạ độ đầu (gốc ở đỉnh cổ): tâm sọ ở y = 0.1, mặt nhìn theo +z (mũ trong GunModel.tsx cũng theo mốc này).

const C = new Vector3(0, 0.1, -0.004);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Bướu Gauss dẹt theo hai trục. */
const bump = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));

/**
 * Điểm trên mặt da theo hướng `d` (đơn vị, từ tâm sọ). Hộp sọ bầu dục rộng ở trên, hàm thon về cằm, sau gáy thu vào
 * cổ; rồi đắp gờ mày, hốc mắt, gò má, cằm, miệng, u chẩm.
 */
export function headPoint(d: Vector3, out = new Vector3()): Vector3 {
  const { x: ux, y: uy, z: uz } = d;
  const low = sstep(0.05, -0.95, uy);
  const front = sstep(-0.1, 0.7, uz);
  const rx = (0.078 + 0.008 * sstep(-0.4, 0.5, uy)) * (1 - 0.24 * low * (0.3 + 0.7 * front));
  const ry = uy > 0 ? 0.112 : 0.118;
  const rz = uz > 0 ? 0.097 : 0.104 * (1 - 0.62 * low);
  let x = ux * rx;
  const y = uy * ry;
  let z = uz * rz;
  // Mặt trước hơi phẳng (không tròn như quả bóng).
  if (uz > 0) z *= 1 - 0.08 * (1 - Math.abs(uy)) * front;
  // Hai bên thái dương hơi dẹt.
  x *= 1 - 0.05 * sstep(0.1, 0.6, uy) * (1 - Math.abs(uz));
  const r = Math.hypot(x, y, z) || 1;
  const py = y + C.y;
  const ax = Math.abs(x);
  let b = 0;
  const f = sstep(0.2, 0.8, uz);
  // Gờ mày, hốc mắt, gò má, sống mũi, cằm, vùng miệng nhô.
  b += 0.0042 * bump(ax - 0.034, py - 0.128, 0.022, 0.008) * f;
  b -= 0.0075 * bump(ax - 0.035, py - 0.106, 0.013, 0.011) * f;
  b += 0.0045 * bump(ax - 0.056, py - 0.083, 0.016, 0.014) * sstep(0, 0.6, uz);
  b += 0.0035 * bump(x, py - 0.108, 0.007, 0.012) * f;
  b += 0.009 * bump(x, py - 0.006, 0.02, 0.016) * f;
  b += 0.003 * bump(x, py - 0.05, 0.026, 0.02) * f;
  // Góc hàm vuông hơn ở hai bên dưới tai.
  b += 0.004 * bump(ax - 0.062, py - 0.03, 0.014, 0.02) * sstep(-0.5, 0.2, uz);
  // U chẩm sau đầu.
  b += 0.007 * bump(0, uy - 0.15, 1, 0.35) * sstep(-0.1, -0.8, uz);
  out.set(x + (x / r) * b, y + (y / r) * b + C.y, z + (z / r) * b + C.z);
  return out;
}

/** Điểm mặt da phía trước ở toạ độ (x, y) của đầu (dùng để gắn mắt, môi, mũi, lông mày sát mặt). */
export function facePoint(x: number, y: number): Vector3 {
  const d = new Vector3(x / 0.085, (y - C.y) / 0.115, 0);
  const p = new Vector3();
  for (let i = 0; i < 16; i++) {
    d.z = Math.sqrt(Math.max(0.02, 1 - d.x * d.x - d.y * d.y));
    d.normalize();
    headPoint(d, p);
    d.x += (x - p.x) / 0.09;
    d.y += (y - p.y) / 0.11;
  }
  return p;
}

/** Nắn một khối cầu theo mặt da (cộng thêm độ dày `thick(d)` theo pháp tuyến), bỏ tam giác chìm hẳn trong da. */
function shell(sphere: SphereGeometry, thick: ((d: Vector3) => number) | null, cull: boolean): BufferGeometry {
  const pos = sphere.attributes.position as BufferAttribute;
  const d = new Vector3();
  const p = new Vector3();
  const keep: boolean[] = [];
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    headPoint(d, p);
    const t = thick ? thick(d) : 0;
    keep.push(t > 0);
    if (t !== 0) p.addScaledVector(p.clone().sub(C).normalize(), t);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  if (cull && sphere.index) {
    const src = sphere.index.array;
    const idx: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i]!;
      const b = src[i + 1]!;
      const c = src[i + 2]!;
      if (keep[a] || keep[b] || keep[c]) idx.push(a, b, c);
    }
    sphere.setIndex(idx);
  }
  sphere.computeVertexNormals();
  weldNormals(sphere);
  return sphere;
}

/** Nội suy tuyến tính theo bảng [x, y]. */
function table(t: [number, number][], x: number): number {
  if (x <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++) {
    const [x1, y1] = t[i]!;
    const [x0, y0] = t[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return t[t.length - 1]![1];
}

/** Chân tóc theo góc quanh đầu (0 là giữa trán, π là gáy): trán cao, tóc mai trước tai, vòng qua trên tai, xuống gáy. */
const HAIRLINE: [number, number][] = [
  [0, 0.7],
  [0.55, 0.64],
  [0.95, 0.55],
  [1.2, 0.45],
  [1.33, 0.3],
  [1.38, -0.1],
  [1.47, -0.1],
  [1.53, 0.32],
  [1.95, 0.3],
  [2.35, -0.15],
  [2.75, -0.42],
  [Math.PI, -0.48],
];

const azimuth = (d: Vector3) => Math.abs(Math.atan2(d.x, d.z));
/** 0 dưới chân tóc, lên 1 ngay phía trên (mép tóc mềm). */
const hairMask = (d: Vector3, soft = 0.12) => sstep(table(HAIRLINE, azimuth(d)), table(HAIRLINE, azimuth(d)) + soft, d.y);

/** Nhiễu gợn nhẹ cho tóc xoăn (không cần ngẫu nhiên thật: vài sóng sin lệch pha). */
const curls = (d: Vector3) => Math.sin(d.x * 13 + 1.3) * Math.sin(d.y * 11 + 0.4) * Math.sin(d.z * 12 + 2.1);

/** Các kiểu tóc: độ dày theo hướng (m). */
export const HAIR_STYLES = ["buzz", "crew", "quiff", "tied", "curly", "shaved"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

const STYLE: Record<HairStyle, (d: Vector3) => number> = {
  buzz: () => 0.0035,
  crew: (d) => 0.005 + 0.009 * sstep(0.2, 0.9, d.y),
  quiff: (d) => 0.006 + 0.014 * sstep(0.35, 0.95, d.y) + 0.012 * sstep(0.2, 0.8, d.z) * sstep(0.45, 0.85, d.y) + 0.004 * d.x,
  tied: (d) => 0.007 + 0.004 * sstep(0.3, 0.9, d.y),
  curly: (d) => 0.017 + 0.005 * sstep(0.2, 0.9, d.y) + 0.005 * curls(d),
  shaved: () => 0.0014,
};

const hairCache = new Map<string, BufferGeometry>();

/**
 * Tóc theo kiểu. `capped`: đang đội mũ thì tóc ép sát (chỉ còn phần lộ dưới vành mũ), khỏi xuyên qua mũ.
 * Kiểu buộc đuôi ngựa có thêm túm tóc sau gáy.
 */
export function hairGeometry(style: HairStyle, capped: boolean): BufferGeometry {
  const key = `${style}|${capped}`;
  let g = hairCache.get(key);
  if (g) return g;
  const thick = capped ? () => 0.0028 : STYLE[style];
  const sphere = new SphereGeometry(1, 34, 19, 0, Math.PI * 2, 0, Math.PI * 0.82);
  const skin = shell(sphere, (d) => {
    const m = hairMask(d, style === "shaved" ? 0.05 : 0.12);
    // Đầu cạo: chỉ còn lún phún quanh gáy và hai bên (đỉnh hói).
    const bald = style === "shaved" && !capped ? 1 - sstep(0.55, 0.75, d.y) : 1;
    return m * bald > 0.001 ? thick(d) * m * bald + 0.0006 : -0.004;
  }, true);
  const parts = [skin];
  if (style === "tied") {
    // Đuôi ngựa: túm buộc sau gáy, rũ xuống lưng.
    const a = new Vector3(0, 0.115, -0.112);
    const b = new Vector3(0, 0.06, -0.14);
    const c = new Vector3(0, -0.02, -0.135);
    parts.push(capsule(a, b, 0.02, 8, 2), capsule(b, c, 0.016, 8, 2));
    parts.push(ellipsoid([0.018, 0.012, 0.018], [0, 0.116, -0.11], [0.4, 0, 0], [8, 5]));
  }
  g = merge(parts);
  hairCache.set(key, g);
  return g;
}

/** Các kiểu râu. */
export const BEARDS = ["none", "stubble", "mustache", "goatee", "full"] as const;
export type Beard = (typeof BEARDS)[number];

const beardCache = new Map<Beard, BufferGeometry>();

/** Râu: lớp vỏ bọc vùng hàm, cằm, mép; chừa môi. */
export function beardGeometry(style: Beard): BufferGeometry | null {
  if (style === "none") return null;
  let g = beardCache.get(style);
  if (g) return g;
  const sphere = new SphereGeometry(1, 40, 14, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6);
  const p = new Vector3();
  const region = (d: Vector3) => {
    const phi = azimuth(d);
    headPoint(d, p);
    // Chừa môi và khoảng dưới môi một chút.
    const lips = bump(p.x, p.y - 0.047, 0.02, 0.009) * sstep(0.3, 0.8, d.z);
    const mustache = sstep(0.55, 0.35, phi) * sstep(-0.47, -0.4, d.y) * sstep(-0.22, -0.3, d.y);
    const chin = sstep(0.42, 0.25, phi) * sstep(-0.52, -0.62, d.y);
    const jaw = sstep(1.48, 1.32, phi) * sstep(table([[0, -0.32], [0.9, -0.3], [1.2, -0.12], [1.4, 0.02]], phi), table([[0, -0.32], [0.9, -0.3], [1.2, -0.12], [1.4, 0.02]], phi) - 0.1, d.y);
    const area = style === "mustache" ? mustache : style === "goatee" ? Math.max(mustache, chin) : Math.max(mustache, jaw);
    return area * (1 - sstep(0.3, 0.6, lips));
  };
  const depth = style === "stubble" ? 0.0012 : style === "full" ? 0.007 : 0.0035;
  g = merge([
    shell(sphere, (d) => {
      const a = region(d);
      return a > 0.02 ? depth * a + 0.0007 : -0.004;
    }, true),
  ]);
  beardCache.set(style, g);
  return g;
}

let faceCache: {
  skin: BufferGeometry;
  eyes: BufferGeometry;
  irises: BufferGeometry;
  lips: BufferGeometry;
  brows: BufferGeometry[];
} | null = null;

/**
 * Hình đầu dùng chung: da (sọ, mũi, tai, mí mắt), lòng trắng, tròng mắt, môi, và vài kiểu lông mày (dày, mảnh, cong).
 */
export function face() {
  if (faceCache) return faceCache;
  const skin: BufferGeometry[] = [shell(new SphereGeometry(1, 28, 20), null, false)];
  // Mũi: sống mũi từ giữa hai mắt chúi ra trước xuống đầu mũi, cánh mũi hai bên.
  const bridge = facePoint(0, 0.112);
  const nose = loft(
    [
      { y: 0.004, w: 0 },
      { y: 0, w: 0.006, f: 0.004, b: 0.004 },
      { y: -0.015, w: 0.007, f: 0.0055, b: 0.006 },
      { y: -0.03, w: 0.0085, f: 0.0075, b: 0.008 },
      { y: -0.04, w: 0.011, f: 0.009, b: 0.01 },
      { y: -0.046, w: 0.0095, f: 0.0065, b: 0.009 },
      { y: -0.049, w: 0 },
    ],
    10,
  );
  place(nose, [0, bridge.y, bridge.z - 0.004], [-0.3, 0, 0]);
  skin.push(nose);
  const tip = facePoint(0, 0.066);
  for (const s of [-1, 1]) {
    skin.push(ellipsoid([0.0075, 0.006, 0.0075], [s * 0.0105, 0.0685, tip.z + 0.0015], [0, s * 0.4, 0], [8, 5]));
    // Tai: vành tai dẹt xiên ra sau, dái tai.
    const ear = headPoint(new Vector3(s * 1, -0.05, -0.12).normalize());
    skin.push(ellipsoid([0.008, 0.027, 0.017], [ear.x + s * 0.003, 0.098, ear.z - 0.004], [0, s * 0.35, s * -0.08], [10, 7]));
    skin.push(ellipsoid([0.0055, 0.01, 0.008], [ear.x + s * 0.0005, 0.076, ear.z + 0.001], [0, s * 0.3, 0], [7, 5]));
  }
  // Mắt: nhãn cầu nằm trong hốc, mí trên phủ nửa trên, tròng mắt.
  const eyes: BufferGeometry[] = [];
  const irises: BufferGeometry[] = [];
  const brow = (thick: number, arch: number): BufferGeometry => {
    const list: BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      // Lông mày: hai đoạn nối nhau, dày ở đầu mày, mảnh dần ra đuôi, cong theo gờ mày.
      const a = facePoint(s * 0.013, 0.123).add(new Vector3(0, 0, 0.0022));
      const m = facePoint(s * 0.031, 0.1275 + arch * 0.004).add(new Vector3(0, 0, 0.0024));
      const e = facePoint(s * 0.049, 0.1235 + arch * 0.002).add(new Vector3(0, 0, 0.0016));
      list.push(capsule(a, m, 0.0034 * thick, 5, 1), capsule(m, e, 0.0026 * thick, 5, 1));
    }
    return merge(list);
  };
  for (const s of [-1, 1]) {
    const at = facePoint(s * 0.033, 0.106);
    const c: V3 = [s * 0.033, 0.106, at.z - 0.0028];
    eyes.push(ellipsoid([0.0122, 0.0112, 0.0095], c, undefined, [10, 6]));
    irises.push(ellipsoid([0.0064, 0.0064, 0.0022], [c[0] - s * 0.0004, c[1] - 0.0004, c[2] + 0.0086], undefined, [10, 4]));
    // Mí trên: chỏm cầu úp trên nhãn cầu, mép mí ngang trên con ngươi.
    skin.push(place(new SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), c, [0.34, 0, 0], [0.0134, 0.0128, 0.0106]));
    // Mí dưới: gờ mỏng.
    skin.push(place(new SphereGeometry(1, 10, 3, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.25), c, [-0.1, 0, 0], [0.013, 0.012, 0.0102]));
  }
  // Môi: môi trên mỏng hơi nhô, môi dưới dày hơn; khoé miệng thu vào theo mặt.
  const up = facePoint(0, 0.0515);
  const lo = facePoint(0, 0.0425);
  const lips = merge([
    ellipsoid([0.0185, 0.0038, 0.0055], [0, 0.0512, up.z - 0.0028], [-0.1, 0, 0], [12, 5]),
    ellipsoid([0.0165, 0.0048, 0.006], [0, 0.0434, lo.z - 0.003], [0.15, 0, 0], [12, 5]),
  ]);
  faceCache = { skin: merge(skin), eyes: merge(eyes), irises: merge(irises), lips, brows: [brow(1.25, 0.05), brow(0.9, 0.2), brow(1, -0.05)] };
  return faceCache;
}
