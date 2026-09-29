import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, MeshStandardMaterial, type BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Tiện ích chung cho cảnh vật: số ngẫu nhiên cố định theo seed (cây cỏ đặt giống nhau trên mọi máy),
// nhiễu mịn, và gió làm cây cỏ lay.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nhiễu mịn rẻ tiền (tổng vài sóng sin), −1..1, để vẽ mảng cỏ đậm nhạt. */
export function patch(x: number, z: number): number {
  return (
    0.5 * Math.sin(x * 0.045 + Math.cos(z * 0.031) * 2.1) +
    0.3 * Math.sin(z * 0.07 - Math.sin(x * 0.052) * 1.7) +
    0.2 * Math.sin((x + z) * 0.13)
  );
}

/** Nhiễu hạt (theo từng điểm), 0..1. */
export function grain(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// Gió: vật liệu có đỉnh lay theo thời gian (tán dừa, bụi cỏ), dùng chung một đồng hồ.
// ---------------------------------------------------------------------------

export const wind = { value: 0 };
/** Gió mạnh hay nhẹ: bão thì cây cỏ lắc mạnh gấp mấy lần (Weather ghi). */
export const windStrength = { value: 1 };

/**
 * MeshStandardMaterial lay theo gió: đỉnh càng cao (theo y cục bộ) càng lắc nhiều.
 * `upNormals`: lá mỏng vẽ hai mặt thì giữ nguyên pháp tuyến hướng lên cho cả mặt sau
 * (mặc định three.js lật pháp tuyến mặt sau xuống đất, làm lá tối sẫm).
 */
export function swayMaterial(params: ConstructorParameters<typeof MeshStandardMaterial>[0], amount: number, from = 0, upNormals = false) {
  const m = new MeshStandardMaterial(params);
  // Mỗi bộ tham số là một shader riêng; không có khoá này three.js gộp chung theo mã nguồn hàm bên dưới.
  m.customProgramCacheKey = () => `sway:${amount}:${from}:${upNormals}`;
  m.onBeforeCompile = (shader) => {
    if (upNormals) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize( vNormal );");
    }
    shader.uniforms.uWind = wind;
    shader.uniforms.uWindStrength = windStrength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;\nuniform float uWindStrength;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        #else
          float phase = 0.0;
        #endif
        float k = max(0.0, position.y - ${from.toFixed(2)});
        float sway = k * k * ${amount.toFixed(3)} * uWindStrength;
        transformed.x += sin(uWind * 1.3 + phase) * sway;
        transformed.z += cos(uWind * 1.1 + phase * 1.7) * sway * 0.6;`,
      );
  };
  return m;
}

export function WindClock() {
  useFrame((_, dt) => {
    // Gió mạnh thì cây cỏ không chỉ lắc rộng hơn mà còn lắc nhanh hơn.
    wind.value += dt * (0.6 + 0.4 * windStrength.value);
  });
  return null;
}

// ---------------------------------------------------------------------------
// Đá: khối cầu chia nhỏ rồi đẩy lồi lõm theo nhiễu ba chiều (mặt vỡ, gờ, hốc), đáy hơi bằng như đá nằm trên đất.
// ---------------------------------------------------------------------------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1440662683 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx);
  const v = s(fy);
  const w = s(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

const rockCache = new Map<string, BufferGeometry>();

/** Hình đá bán kính `radius` (dùng chung theo bán kính và kiểu `variant`). */
export function rockGeometry(radius = 1, variant = 0, detail = 3): BufferGeometry {
  const key = `${radius}:${variant}:${detail}`;
  const hit = rockCache.get(key);
  if (hit) return hit;
  const g = mergeVertices(new IcosahedronGeometry(1, detail).deleteAttribute("normal").deleteAttribute("uv"));
  const p = g.attributes.position!;
  const seed = 17 + variant * 31;
  // Mỗi kiểu đá dẹt, dài khác nhau.
  const sx = 0.85 + hash3(variant, 1, 0, 3) * 0.4;
  const sy = 0.55 + hash3(variant, 2, 0, 3) * 0.35;
  const sz = 0.85 + hash3(variant, 3, 0, 3) * 0.4;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let n = 0;
    let amp = 0.5;
    let f = 1.6;
    for (let o = 0; o < 4; o++) {
      n += (noise3(x * f + 5, y * f + 5, z * f + 5, seed + o) - 0.5) * amp;
      amp *= 0.5;
      f *= 2.1;
    }
    // Vài mặt phẳng vỡ: cắt bớt phần nhô ra theo hướng ngẫu nhiên.
    const facet = Math.max(0, x * 0.6 + y * 0.5 - z * 0.62 - 0.55) + Math.max(0, -x * 0.7 + z * 0.4 + y * 0.3 - 0.6);
    const r = 1 + n * 0.55 - facet * 0.6;
    let ny = y * r * sy;
    if (ny < -0.35 * sy) ny = -0.35 * sy + (ny + 0.35 * sy) * 0.3;
    p.setXYZ(i, x * r * sx * radius, ny * radius, z * r * sz * radius);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData.smooth = true;
  rockCache.set(key, g);
  return g;
}
