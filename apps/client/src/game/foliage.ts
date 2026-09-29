import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { mulberry32, swayMaterial } from "./nature.ts";
import { skyUniforms } from "./Sky.tsx";

// Lá cây thật: thay khối tròn đặc bằng hàng trăm tấm lá nhỏ (ảnh lá vẽ sẵn có nền trong suốt) xếp thành chùm.
// Pháp tuyến mỗi tấm hướng từ tâm chùm ra ngoài nên cả chùm sáng tối mềm như một khối lá dày, còn mép chùm lởm chởm
// thấy được từng lá. Lá mỏng nên nắng chiếu sau lưng thì lá sáng xanh trong (ánh sáng xuyên lá).
// Ảnh lá vẽ bằng canvas lúc chạy, không tải file nào.

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, repeat = false): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Màu lá nhạt (màu thật nhân thêm màu của từng cây); `v` 0..1 là độ sáng tối của từng lá. */
function leafColor(rand: () => number, v = rand()) {
  const h = 78 + rand() * 30;
  const s = 28 + rand() * 22;
  const l = 58 + v * 32;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Một chiếc lá: hình thoi thuôn hai đầu, gân giữa sẫm hơn. */
function drawLeaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, angle: number, fill: string) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.35, -width, len, 0);
  g.quadraticCurveTo(len * 0.35, width, 0, 0);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = "rgba(40, 60, 20, 0.35)";
  g.lineWidth = Math.max(1, width * 0.12);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(len * 0.92, 0);
  g.stroke();
  g.restore();
}

let cache: Record<string, Texture> = {};

/** Chùm lá cây rừng: vài chục lá bầu dục chồng lên nhau, toả ra từ các cuống. */
export function leafClusterTexture(): Texture {
  if (cache.cluster) return cache.cluster;
  const S = 256;
  const { c, g } = canvas(S, S);
  const rand = mulberry32(5);
  // Lá phía sau tối hơn, lá phía trước sáng hơn.
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * S * 0.3;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const len = S * (0.16 + rand() * 0.1);
    drawLeaf(g, x, y, len, len * (0.28 + rand() * 0.12), a + (rand() - 0.5) * 1.2, leafColor(rand, i / 70));
  }
  cache.cluster = finish(c);
  return cache.cluster;
}

/**
 * Tàu lá kép (dừa, dương xỉ): trục u chạy dọc sống lá (0 gốc, 1 ngọn), trục v ngang (0.5 là sống lá).
 * Lá chét mọc xiên hai bên, dài ở giữa, ngắn ở gốc và ngọn.
 */
export function frondTexture(): Texture {
  if (cache.frond) return cache.frond;
  const W = 512;
  const H = 128;
  const { c, g } = canvas(W, H);
  const rand = mulberry32(9);
  for (let x = 12; x < W - 6; x += 5) {
    const t = x / W;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.85 + rand() * 0.25);
    for (const side of [-1, 1]) {
      if (rand() < 0.06) continue; // lá chét gãy rụng
      const len = H * 0.5 * env;
      // Lá chét: dải mảnh xiên về phía ngọn.
      const tipX = x + len * (0.45 + rand() * 0.2);
      const tipY = H / 2 + side * len * 0.95;
      g.beginPath();
      g.moveTo(x - 2, H / 2);
      g.quadraticCurveTo(x + len * 0.15, H / 2 + side * len * 0.55, tipX, tipY);
      g.quadraticCurveTo(x + len * 0.3, H / 2 + side * len * 0.4, x + 3, H / 2);
      g.fillStyle = leafColor(rand);
      g.fill();
    }
  }
  // Sống lá.
  g.strokeStyle = "hsl(60, 30%, 62%)";
  g.lineCap = "round";
  for (let x = 0; x < W; x += 16) {
    g.lineWidth = 5 * (1 - x / W) + 1.5;
    g.beginPath();
    g.moveTo(x, H / 2);
    g.lineTo(x + 17, H / 2);
    g.stroke();
  }
  cache.frond = finish(c);
  return cache.frond;
}

/** Lá chuối: phiến lá rộng, gân song song xiên, mép rách từng đường. u dọc lá, v ngang lá. */
export function broadLeafTexture(): Texture {
  if (cache.broad) return cache.broad;
  const W = 512;
  const H = 256;
  const { c, g } = canvas(W, H);
  const rand = mulberry32(13);
  g.beginPath();
  g.moveTo(0, H / 2);
  for (let x = 0; x <= W; x += 8) {
    const t = x / W;
    const w = Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.9)) * H * 0.47;
    g.lineTo(x, H / 2 - w);
  }
  for (let x = W; x >= 0; x -= 8) {
    const t = x / W;
    const w = Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.9)) * H * 0.47;
    g.lineTo(x, H / 2 + w);
  }
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "hsl(88, 40%, 70%)");
  grad.addColorStop(0.5, "hsl(92, 38%, 84%)");
  grad.addColorStop(1, "hsl(88, 40%, 70%)");
  g.fillStyle = grad;
  g.fill();
  // Gân lá song song xiên ra mép.
  g.strokeStyle = "rgba(60, 90, 30, 0.22)";
  g.lineWidth = 1.5;
  for (let x = 0; x < W; x += 6) {
    g.beginPath();
    g.moveTo(x, H / 2);
    g.lineTo(x + 40, 0);
    g.moveTo(x, H / 2);
    g.lineTo(x + 40, H);
    g.stroke();
  }
  // Mép lá rách theo gân: xoá những vệt mảnh từ mép vào.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 26; i++) {
    const x = 60 + rand() * (W - 80);
    const top = rand() < 0.5;
    const depth = H * (0.15 + rand() * 0.3);
    g.lineWidth = 2 + rand() * 3;
    g.beginPath();
    g.moveTo(x + depth * 0.4, top ? 0 : H);
    g.lineTo(x, top ? depth : H - depth);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  // Sống lá.
  g.strokeStyle = "hsl(70, 35%, 78%)";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  g.stroke();
  cache.broad = finish(c);
  return cache.broad;
}

/** Ảnh dùng cho cỏ: một nắm lá cỏ mảnh, gốc sẫm ngọn sáng (v = 0 gốc, 1 ngọn). */
export function grassTexture(): Texture {
  if (cache.grass) return cache.grass;
  const W = 256;
  const H = 256;
  const { c, g } = canvas(W, H);
  const rand = mulberry32(21);
  for (let i = 0; i < 60; i++) {
    const x = W * (0.08 + rand() * 0.84);
    const hgt = H * (0.45 + rand() * 0.53);
    const lean = (rand() - 0.5) * W * 0.25;
    const w = 3 + rand() * 4;
    const grad = g.createLinearGradient(0, H, 0, H - hgt);
    const hue = 70 + rand() * 30;
    grad.addColorStop(0, `hsl(${hue}, 30%, 38%)`);
    grad.addColorStop(1, `hsl(${hue - 10}, 38%, ${72 + rand() * 18}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, H);
    g.quadraticCurveTo(x - w * 0.5 + lean * 0.3, H - hgt * 0.5, x + lean, H - hgt);
    g.quadraticCurveTo(x + w * 0.5 + lean * 0.3, H - hgt * 0.5, x + w, H);
    g.fill();
  }
  cache.grass = finish(c);
  return cache.grass;
}

export function resetFoliageTextures() {
  for (const t of Object.values(cache)) t.dispose();
  cache = {};
}

// ---------------------------------------------------------------------------- vật liệu

/**
 * Vật liệu lá: cắt theo nền trong suốt của ảnh (alphaTest, đổ bóng đúng hình lá), vẽ hai mặt, lay theo gió,
 * và sáng lên khi nhìn ngược về phía mặt trời (ánh sáng xuyên qua phiến lá mỏng).
 */
export function leafMaterial(map: Texture, sway: number, from = 0, translucency = 0.55): MeshStandardMaterial {
  const m = swayMaterial({ map, alphaTest: 0.45, side: DoubleSide, roughness: 0.72, metalness: 0 }, sway, from, false);
  const base = m.onBeforeCompile;
  const baseKey = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${baseKey}|leaf:${translucency}`;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.uniforms.uLeafSunDir = skyUniforms.uSunDir;
    shader.uniforms.uLeafSunColor = skyUniforms.uSunColor;
    shader.uniforms.uLeafNight = skyUniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLeafSunDir;\nuniform vec3 uLeafSunColor;\nuniform float uLeafNight;")
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          // Nhìn về phía mặt trời qua tán lá: ánh nắng xuyên phiến lá thành xanh vàng trong.
          vec3 tenView = normalize( vViewPosition );
          vec3 tenSunView = normalize( ( viewMatrix * vec4( uLeafSunDir, 0.0 ) ).xyz );
          float tenBack = pow( max( dot( tenView, tenSunView ), 0.0 ), 3.0 );
          float tenWrap = 0.5 + 0.5 * dot( normal, tenSunView );
          reflectedLight.directDiffuse += diffuseColor.rgb * uLeafSunColor * ( tenBack * ${translucency.toFixed(2)} + ( 1.0 - tenWrap ) * 0.12 ) * ( 1.0 - uLeafNight );
        }`,
      );
  };
  // Không phủ vân chi tiết lên lá đã có ảnh.
  m.userData.detail = "none";
  return m;
}

// ---------------------------------------------------------------------------- hình khối

type Blob = [number, number, number, number];
const UP_BIAS = new Vector3(0, 0.35, 0);

/**
 * Chùm lá: rải `density` tấm lá cho mỗi m² bề mặt các khối cầu `blobs` [x, y, z, bán kính], mỗi tấm vuông cạnh
 * `card`, xoay ngẫu nhiên, nằm dày ở vỏ ngoài. Pháp tuyến hướng từ tâm khối ra (nghiêng lên trời một chút).
 */
export function leafCluster(blobs: Blob[], density: number, card: number, seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const tmp = new Vector3();
  for (const [cx, cy, cz, r] of blobs) {
    const count = Math.max(6, Math.round(4 * Math.PI * r * r * density));
    for (let k = 0; k < count; k++) {
      // Điểm trên vỏ khối cầu, lún vào trong một chút.
      n.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (n.lengthSq() < 1e-4) n.set(0, 1, 0);
      n.normalize();
      const depth = 0.55 + 0.45 * Math.sqrt(rand());
      p.set(cx, cy, cz).addScaledVector(n, r * depth);
      // Mặt tấm lá: nghiêng ngẫu nhiên quanh hướng pháp tuyến để nhìn từ đâu cũng thấy lá.
      tmp.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      a.crossVectors(n, tmp).normalize();
      b.crossVectors(n, a).normalize();
      const twist = rand() * 0.9;
      a.addScaledVector(n, twist).normalize();
      const s = card * (0.75 + rand() * 0.5) * 0.5;
      const base = pos.length / 3;
      const normal = tmp.copy(n).add(UP_BIAS).normalize();
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        pos.push(p.x + (a.x * su + b.x * sv) * s, p.y + (a.y * su + b.y * sv) * s, p.z + (a.z * su + b.z * sv) * s);
        nor.push(normal.x, normal.y, normal.z);
      }
      // Lật ảnh ngẫu nhiên để các tấm không giống hệt nhau.
      const flip = rand() < 0.5;
      uv.push(flip ? 1 : 0, 0, flip ? 0 : 1, 0, flip ? 0 : 1, 1, flip ? 1 : 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // Giữ nguyên pháp tuyến tự tính (bộ làm mịn của textures.ts bỏ qua).
  g.userData.smooth = true;
  return g;
}

/**
 * Tàu lá dạng dải có UV (u dọc sống lá, v ngang): `point(s, side)` trả toạ độ tại vị trí s (0..1) dọc lá,
 * side −1..1 ngang lá. Pháp tuyến ngả lên trời cho lá sáng đều như tán thật.
 */
export function frondStrip(fronds: number, steps: number, point: (frond: number, s: number, side: number) => [number, number, number]): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let f = 0; f < fronds; f++) {
    const base = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      for (const side of [-1, 0, 1]) {
        pos.push(...point(f, s, side));
        uv.push(s, 0.5 + side * 0.5);
      }
    }
    for (let i = 0; i < steps; i++) {
      const r0 = base + i * 3;
      const r1 = base + (i + 1) * 3;
      idx.push(r0, r1, r1 + 1, r0, r1 + 1, r0 + 1, r0 + 1, r1 + 1, r1 + 2, r0 + 1, r1 + 2, r0 + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ngả pháp tuyến lên trời: lá vẽ hai mặt, mặt dưới không bị tối sẫm.
  const nrm = g.attributes.normal!;
  for (let i = 0; i < nrm.count; i++) {
    const x = nrm.getX(i);
    let y = nrm.getY(i);
    const z = nrm.getZ(i);
    if (y < 0) y = -y;
    const len = Math.hypot(x * 0.5, y + 0.8, z * 0.5);
    nrm.setXYZ(i, (x * 0.5) / len, (y + 0.8) / len, (z * 0.5) / len);
  }
  g.computeBoundingSphere();
  g.userData.smooth = true;
  return g;
}
