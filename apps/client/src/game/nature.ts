import { Fn, cos, float, instancedBufferAttribute, mat4, max, min, modelWorldMatrix, normalViewGeometry, positionGeometry, positionLocal, sin, uniform, vec3, vec4 } from "three/tsl";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, InstancedInterleavedBuffer, MeshStandardMaterial, type BufferGeometry, type InstancedMesh } from "three";
import type { NodeBuilder } from "three/webgpu";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { setSlot, slots, type F, type V3, type V4 } from "./gpu/slots.ts";
import { tenTrample } from "./trample.ts";

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

export const wind = uniform(0);
/** Gió mạnh hay nhẹ: bão thì cây cỏ lắc mạnh gấp mấy lần (Weather ghi). */
export const windStrength = uniform(1);

/** Ma trận instance của một InstancedMesh dưới dạng 4 cột vec4 (đọc thẳng từ bộ đệm instance, mọi nền đều chạy). */
const instanceBuffers = new WeakMap<object, InstancedInterleavedBuffer>();
function instanceColumns(mesh: InstancedMesh) {
  const im = mesh.instanceMatrix;
  let buf = instanceBuffers.get(im);
  if (!buf) {
    buf = new InstancedInterleavedBuffer(im.array, 16, 1);
    buf.version = im.version;
    instanceBuffers.set(im, buf);
  }
  const b = buf;
  const cols = [0, 4, 8, 12].map((o) => instancedBufferAttribute(b, "vec4", 16, o)) as unknown as [V4, V4, V4, V4];
  return cols;
}

/**
 * MeshStandardMaterial lay theo gió: đỉnh càng cao (theo y cục bộ) càng lắc nhiều.
 * `upNormals`: lá mỏng vẽ hai mặt thì giữ nguyên pháp tuyến hướng lên cho cả mặt sau
 * (mặc định three.js lật pháp tuyến mặt sau xuống đất, làm lá tối sẫm).
 * `trample`: khóm cỏ thấp dạt ra, rạp xuống khi người, xe đi qua hay bom nổ gần (trample.ts).
 *
 * Lay bằng `positionNode`: three chạy nó cho cả lượt vẽ bóng nên bóng đổ lay theo. Lưu ý WebGPURenderer đã áp ma
 * trận instance TRƯỚC positionNode, nên độ lệch tính trong hệ hình học được đổi qua ma trận instance cho đúng bản cũ.
 */
export function swayMaterial(params: ConstructorParameters<typeof MeshStandardMaterial>[0], amount: number, from = 0, upNormals = false, trample = false) {
  const m = new MeshStandardMaterial(params);
  if (upNormals) setSlot(m, "normalNode", normalViewGeometry);
  // Chụp ô hiện có TRƯỚC khi gán (Fn chạy muộn lúc dựng shader, lúc đó ô đã là chính node này).
  const prior = slots(m).positionNode as V3 | undefined;
  const sway = Fn((builder: NodeBuilder) => {
    const mesh = builder.object as InstancedMesh | null;
    const instanced = !!mesh?.isInstancedMesh && !!mesh.instanceMatrix;
    const cols = instanced ? instanceColumns(mesh!) : null;
    const base = prior ?? (positionLocal as V3);
    const phase: F = cols ? cols[3].x.mul(0.37).add(cols[3].z.mul(0.23)) : float(0);
    const k = positionGeometry.y.sub(from).max(0);
    // Gió bão lắc mạnh hơn nhưng có chừng mực, và độ lệch không vượt quá một góc nghiêng hợp lý: tán cây
    // luôn dính vào thân (trước đây gió mưa bão đẩy tán cây cao lệch hẳn khỏi thân).
    const gust = windStrength.sub(1).mul(0.35).add(1);
    const swayAmt = min(k.mul(k).mul(amount), k.mul(0.05).add(0.12)).mul(gust);
    let dx: F = sin(wind.mul(1.3).add(phase)).mul(swayAmt);
    let dy: F = float(0);
    let dz: F = cos(wind.mul(1.1).add(phase.mul(1.7))).mul(swayAmt).mul(0.6);
    if (trample && cols) {
      // Đẩy theo toạ độ thế giới của gốc khóm, đổi về hệ toạ độ của khóm (khóm chỉ xoay quanh trục đứng, co giãn đều).
      const world = modelWorldMatrix.mul(mat4(cols[0], cols[1], cols[2], cols[3]));
      const c0 = world.mul(vec4(1, 0, 0, 0)).xyz;
      const c1 = world.mul(vec4(0, 1, 0, 0)).xyz;
      const c2 = world.mul(vec4(0, 0, 1, 0)).xyz;
      const origin = world.mul(vec4(0, 0, 0, 1)).xz;
      const off = c0.xz.mul(positionGeometry.x).add(c2.xz.mul(positionGeometry.z));
      const tr = tenTrample(origin.add(off));
      const v = vec3(tr.x, 0, tr.y);
      const inv = max(c0.dot(c0), 1e-4);
      const local = vec3(c0.dot(v), c1.dot(v), c2.dot(v)).div(inv);
      dx = dx.add(local.x.mul(k).mul(0.9));
      dz = dz.add(local.z.mul(k).mul(0.9));
      dy = k.mul(0.55).mul(tr.z).negate();
    }
    // Đổi độ lệch từ hệ hình học sang hệ sau instance.
    const disp: V3 = cols ? cols[0].xyz.mul(dx).add(cols[1].xyz.mul(dy)).add(cols[2].xyz.mul(dz)) : vec3(dx, dy, dz);
    return base.add(disp);
  });
  setSlot(m, "positionNode", sway());
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
