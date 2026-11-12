import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  Vector4,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Node, NodeBuilder } from "three/webgpu";
import {
  Fn,
  attribute,
  faceDirection,
  float,
  instanceColor,
  materialColor,
  materialNormal,
  materialRoughness,
  mix,
  normalGeometry,
  normalWorldGeometry,
  positionGeometry,
  positionView,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from "three/tsl";
import { setSlot, slots, type F, type V2, type V3, type V4 } from "./gpu/slots.ts";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Chất liệu cho mọi thứ trong cảnh: tám tấm vân (gỗ, đá, lá, vải, cát, cỏ, vách đá, đất) sinh tại chỗ bằng nhiễu
// lặp liền mép, không tải file nào. Mỗi vật liệu được gắn node TSL để phủ vân theo toạ độ (chiếu ba mặt, khỏi cần
// UV), làm màu loang lổ và bề mặt gồ ghề theo vân (bump). Ở xa thì vân mờ dần để khỏi nhiễu hạt.

const SIZE = 256;

// ---------------------------------------------------------------------------- nhiễu lặp liền mép

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Nhiễu giá trị lặp theo chu kỳ `period` ô (u, v trong 0..1). */
function vnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (n: number) => ((n % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, period << o, seed + o * 17) * amp;
    total += amp;
    amp *= 0.5;
  }
  return sum / total;
}

/** Nhiễu tế bào lặp: khoảng cách tới điểm gần nhất (f1) và gần nhì (f2), theo đơn vị ô. */
export function worley(u: number, v: number, cells: number, seed: number): [number, number] {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + hash(wx, wy, seed);
      const py = cy + hash(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2];
}

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------- tám tấm vân

type Gen = (u: number, v: number) => number;

/** Ván gỗ: thớ chạy dọc, xoắn nhẹ theo nhiễu, bốn tấm ván có khe tối. */
const wood: Gen = (u, v) => {
  const warp = fbm(u, v, 4, 3, 11) - 0.5;
  const plank = Math.floor(u * 4);
  const within = (u * 4) % 1;
  const grainLines = 0.5 + 0.5 * Math.sin((u * 4 + warp * 0.35 + hash(plank, 0, 3)) * TAU * 7);
  const fibre = fbm(u, v, 32, 2, 12);
  const edge = Math.min(within * 30, (1 - within) * 30, 1);
  return clamp01((0.4 + grainLines * 0.18 + fibre * 0.32 + (hash(plank, 1, 5) - 0.5) * 0.12) * (0.7 + 0.3 * edge));
};

/** Đá: mảng loang, vết nứt theo ranh tế bào. */
const rock: Gen = (u, v) => {
  const [f1, f2] = worley(u, v, 6, 21);
  const crack = smooth(0.0, 0.09, f2 - f1);
  const body = fbm(u, v, 8, 4, 22);
  return clamp01((0.22 + body * 0.7 - f1 * 0.12) * (0.45 + 0.55 * crack));
};

/** Lá: gân xiên song song, đốm loang. */
const leaf: Gen = (u, v) => {
  const blotch = fbm(u, v, 6, 3, 31);
  const veins = Math.pow(Math.abs(Math.sin((u + v * 0.5 + (blotch - 0.5) * 0.08) * TAU * 6)), 10);
  const speck = fbm(u, v, 24, 2, 32);
  return clamp01(0.3 + blotch * 0.5 + speck * 0.2 + veins * 0.18);
};

/** Vải: sợi dọc sợi ngang đan nhau, hơi sờn. */
const fabric: Gen = (u, v) => {
  const n = 24;
  const a = Math.sin(u * TAU * n);
  const b = Math.sin(v * TAU * n);
  const over = (Math.floor(u * n) + Math.floor(v * n)) % 2 === 0 ? Math.abs(a) : Math.abs(b);
  const wear = fbm(u, v, 8, 3, 41);
  return clamp01(0.35 + over * 0.2 + wear * 0.45);
};

/** Cát: hạt li ti và gợn sóng gió thổi. */
const sand: Gen = (u, v) => {
  const ripple = 0.5 + 0.5 * Math.sin((v + (fbm(u, v, 4, 2, 51) - 0.5) * 0.25) * TAU * 9);
  const soft = fbm(u, v, 16, 3, 53);
  const fine = fbm(u, v, 64, 2, 52);
  return clamp01(0.2 + ripple * 0.25 + soft * 0.4 + fine * 0.15);
};

/** Cỏ: vô số ngọn nhỏ sáng tối xen nhau, mảng đậm nhạt. */
const grass: Gen = (u, v) => {
  const blades = fbm(u, v, 32, 2, 61);
  const tufts = fbm(u, v, 8, 3, 62);
  return clamp01(0.1 + blades * 0.4 + tufts * 0.5);
};

/** Vách đá: lớp đá xếp ngang, khối lớn nứt vỡ. */
const cliff: Gen = (u, v) => {
  const warp = fbm(u, v, 4, 3, 71) - 0.5;
  const strata = 0.5 + 0.5 * Math.sin((v + warp * 0.2) * TAU * 8);
  const [f1, f2] = worley(u, v, 4, 72);
  const crack = smooth(0, 0.06, f2 - f1);
  const body = fbm(u, v, 16, 3, 73);
  return clamp01((0.2 + strata * 0.3 + body * 0.45) * (0.5 + 0.5 * crack));
};

/** Đất: đất mịn lẫn sỏi nhỏ nổi lên. */
const dirt: Gen = (u, v) => {
  const [f1] = worley(u, v, 14, 81);
  const pebble = 1 - smooth(0.18, 0.34, f1);
  const soil = fbm(u, v, 8, 4, 82);
  return clamp01(0.18 + soil * 0.5 + pebble * 0.35 * hash(Math.floor(u * 14), Math.floor(v * 14), 83));
};

function makeTexture(gens: [Gen, Gen, Gen, Gen]): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  // Kéo mỗi kênh về trung bình 0.5 để vân chỉ làm loang màu, không làm cả vật sáng hay tối đi.
  const raw = gens.map((g) => {
    const out = new Float32Array(SIZE * SIZE);
    let sum = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const val = g(x / SIZE, y / SIZE);
        out[y * SIZE + x] = val;
        sum += val;
      }
    }
    const mean = sum / out.length;
    for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i]! - mean + 0.5);
    return out;
  });
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(raw[c]![i]! * 255);
  }
  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

let textures: { a: DataTexture; b: DataTexture } | null = null;
/** Hai tấm RGBA, mỗi kênh một loại vân: A = gỗ, đá, lá, vải · B = cát, cỏ, vách đá, đất. */
function detailTextures() {
  textures ??= { a: makeTexture([wood, rock, leaf, fabric]), b: makeTexture([sand, grass, cliff, dirt]) };
  return textures;
}

// ---------------------------------------------------------------------------- loại chất liệu

export type DetailKind = "wood" | "bark" | "rock" | "leaf" | "fabric" | "sand" | "grass" | "cliff" | "dirt" | "fur" | "skin" | "metal" | "paper";

interface KindDef {
  a: [number, number, number, number];
  b: [number, number, number, number];
  /** Số lần lặp vân trên một mét. */
  scale: number;
  /** Độ loang màu (0–1) và độ gồ ghề. */
  strength: number;
  bump: number;
}

const KINDS: Record<DetailKind, KindDef> = {
  wood: { a: [1, 0, 0, 0], b: [0, 0, 0, 0], scale: 0.35, strength: 0.2, bump: 0.3 },
  bark: { a: [0.6, 0, 0, 0], b: [0, 0, 0.4, 0], scale: 0.5, strength: 0.22, bump: 0.45 },
  rock: { a: [0, 1, 0, 0], b: [0, 0, 0, 0], scale: 0.18, strength: 0.22, bump: 0.5 },
  leaf: { a: [0, 0, 1, 0], b: [0, 0, 0, 0], scale: 0.4, strength: 0.12, bump: 0 },
  fabric: { a: [0, 0, 0, 1], b: [0, 0, 0, 0], scale: 0.7, strength: 0.08, bump: 0 },
  sand: { a: [0, 0, 0, 0], b: [1, 0, 0, 0], scale: 0.14, strength: 0.1, bump: 0.15 },
  grass: { a: [0, 0, 0, 0], b: [0, 1, 0, 0], scale: 0.16, strength: 0.14, bump: 0.1 },
  cliff: { a: [0, 0, 0, 0], b: [0, 0, 1, 0], scale: 0.08, strength: 0.24, bump: 0.5 },
  dirt: { a: [0, 0, 0, 0], b: [0, 0, 0, 1], scale: 0.25, strength: 0.18, bump: 0.35 },
  fur: { a: [0, 0, 0, 0], b: [0, 1, 0, 0], scale: 1.2, strength: 0.07, bump: 0 },
  skin: { a: [0, 0, 0.3, 0], b: [0.7, 0, 0, 0], scale: 1.5, strength: 0.03, bump: 0 },
  metal: { a: [0, 0.4, 0, 0], b: [0, 0, 0, 0.6], scale: 0.6, strength: 0.12, bump: 0.15 },
  paper: { a: [0, 0, 0, 0.5], b: [0.5, 0, 0, 0], scale: 1, strength: 0.05, bump: 0 },
};

export interface DetailOptions {
  kind: DetailKind;
  /** "world": vân cố định theo thế giới (vật đứng yên). "object": vân dính theo vật (người, thú, đồ cầm tay). */
  space?: "world" | "object";
  /** Địa hình: trọng số cát/cỏ/vách đá/đất theo từng đỉnh (thuộc tính `splat`). */
  splat?: boolean;
  scale?: number;
  strength?: number;
  bump?: number;
}

// ---------------------------------------------------------------------------- node TSL

/**
 * Mức tuyết phủ và độ ướt của cả cảnh (Weather cập nhật theo thời tiết), dùng chung cho mọi vật liệu đã phủ vân.
 * `uWet` làm sẫm màu và bóng mặt (độ nhám thấp).
 */
export const weatherUniforms = { uSnow: uniform(0), uWet: uniform(0) };

const SNOW_COLOR = vec3(0.9, 0.93, 0.97);

/**
 * Tích các màu mà three nhân vào màu nền SAU `colorNode` (màu đỉnh, màu instance). Trộn về một màu cố định (tuyết,
 * đất lộ) thì chia màu đích cho tích này trước, để sau khi three nhân vào vẫn ra đúng màu đích.
 */
const tintAfter = Fn((builder: NodeBuilder) => {
  let k: V3 = vec3(1);
  const material = builder.material as Material | null;
  const object = builder.object as (Object3D & { instanceColor?: unknown }) | null;
  if (material?.vertexColors && builder.geometry?.hasAttribute("color")) k = k.mul(vertexColor().rgb);
  if (object?.instanceColor) k = k.mul(instanceColor);
  return k.max(0.02);
});

/** Pháp tuyến bị đẩy lệch theo độ dốc của một trường độ cao `h` (bump không cần UV). `dHdxy` đã nhân cường độ. */
const perturb = Fn(([n, dHdxy]: [V3, V2]) => {
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const r1 = sy.cross(n);
  const r2 = n.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const grad = det.sign().mul(dHdxy.x.mul(r1).add(dHdxy.y.mul(r2)));
  return det.abs().mul(n).sub(grad).normalize();
});

interface Base {
  color: Node | undefined;
  roughness: Node | undefined;
  normal: Node | undefined;
}

interface Patch {
  options: DetailOptions;
  /** Các ô node có sẵn trước khi phủ vân (bản vá khác gắn trước, vd. viền sáng nhân vật): vân bọc lên trên. */
  base: Base;
  uniforms: { maskA: V4; maskB: V4; scale: F; strength: F; bump: F };
}

/** Gắn các node vân, ướt, tuyết vào vật liệu theo `detailSettings.enabled` (bản đủ hay bản nhẹ). */
function assignNodes(material: MeshStandardMaterial, patch: Patch) {
  const { options, base, uniforms } = patch;
  const world = (options.space ?? "world") === "world";
  const full = detailSettings.enabled;
  const { uSnow, uWet } = weatherUniforms;
  // Pháp tuyến hình học theo thế giới hướng lên bao nhiêu (tuyết đọng, nước đọng).
  const up = normalWorldGeometry.y;
  // Ô màu có thể là vec3 hay vec4: three tự đệm alpha = 1 khi đổi sang vec4.
  const baseColor = vec4((base.color ?? materialColor) as unknown as V4);
  const baseRough = (base.roughness ?? materialRoughness) as F;
  let rgb: V3 = baseColor.rgb;
  const k = tintAfter();
  const s = slots(material);

  let h: F | null = null;
  let dist: F | null = null;
  if (full) {
    const tex = detailTextures();
    const pos = world ? positionWorld : positionGeometry;
    const nrm = world ? normalWorldGeometry : normalGeometry;
    const w0 = nrm.normalize().abs().pow(vec3(4));
    const w = w0.div(w0.x.add(w0.y).add(w0.z).add(1e-5));
    const p = pos.mul(uniforms.scale);
    // Lệch mip bậc rưỡi: vân mềm hơn, đạo hàm (cho bump) đỡ lấm tấm.
    const tri = (t: DataTexture) =>
      texture(t, p.zy, null, float(1.5)).mul(w.x).add(texture(t, p.xz, null, float(1.5)).mul(w.y)).add(texture(t, p.xy, null, float(1.5)).mul(w.z));
    const ta = tri(tex.a);
    const tb = tri(tex.b);
    const splat: V4 | null = options.splat ? attribute("splat", "vec4") : null;
    const maskB = splat ?? uniforms.maskB;
    const one = vec4(1);
    const mass = uniforms.maskA.dot(one).add(maskB.dot(one));
    h = ta.dot(uniforms.maskA).add(tb.dot(maskB)).div(mass.max(1e-3)).toVar("tenH");
    // Ở xa thì vân nhạt dần (tránh nhiễu hạt), bump tắt sớm hơn.
    dist = positionView.length();
    const fade = smoothstep(25, 110, dist).oneMinus();
    rgb = rgb.mul(h.sub(0.5).mul(2).mul(uniforms.strength).mul(fade.mul(0.65).add(0.35)).add(1));
    if (splat) {
      // Mảng lớn đậm nhạt trên địa hình để khỏi thấy vân lặp.
      const macro = texture(tex.b, positionWorld.xz.mul(0.011)).a;
      const macro2 = texture(tex.a, positionWorld.xz.mul(0.0045)).y;
      rgb = rgb.mul(macro.mul(0.32).add(0.84));
      // Mảng cỏ khô ngả vàng, mảng đất lộ ra giữa bãi cỏ.
      rgb = mix(rgb, rgb.mul(vec3(1.15, 1.02, 0.72)), smoothstep(0.45, 0.72, macro2).mul(splat.y).mul(0.7));
      rgb = mix(rgb, vec3(0.2, 0.15, 0.1).div(k), smoothstep(0.66, 0.8, macro).mul(splat.y).mul(0.35));
      // Hạt mịn ở gần: sỏi cát, rễ cỏ.
      const fine = texture(tex.b, positionWorld.xz.mul(uniforms.scale).mul(4.3));
      rgb = rgb.mul(fine.dot(splat).div(splat.dot(one).max(1e-3)).sub(0.5).mul(0.3).mul(fade).add(1));
    }
  }

  // Thời tiết: mưa thì mặt đất, tường sẫm lại (ướt); tuyết phủ trắng các mặt hướng lên (đất, mái tôn, bậu cửa, nắp
  // xe tăng, lá cây), dày mỏng loang lổ theo vân, mặt dốc đứng thì không đọng. Vật vân theo vật (người lính: mũ,
  // vai, ba lô) đọng mỏng hơn vì cử động suốt. Bản nhẹ (tắt vân) không có vân nên tuyết phủ đều.
  const snowTarget = SNOW_COLOR.div(k);
  if (world) {
    rgb = rgb.mul(uWet.mul(0.22).oneMinus());
    const snow = h ? uSnow.mul(smoothstep(0.45, 0.8, up)).mul(smoothstep(0.25, 0.6, h.add(uSnow.mul(0.25)))).clamp(0, 0.92) : uSnow.mul(smoothstep(0.5, 0.85, up)).clamp(0, 0.88);
    rgb = mix(rgb, snowTarget, snow);
  } else {
    rgb = rgb.mul(uWet.mul(0.14).oneMinus());
    const snow = h ? uSnow.mul(smoothstep(0.55, 0.9, up)).mul(smoothstep(0.35, 0.65, h.add(uSnow.mul(0.2)))).mul(0.75).clamp(0, 0.8) : uSnow.mul(smoothstep(0.6, 0.92, up)).mul(0.6).clamp(0, 0.7);
    rgb = mix(rgb, snowTarget, snow);
  }
  s.colorNode = vec4(rgb, baseColor.a);

  // Mưa: mặt đất, mái, bậu cửa hướng lên bóng loáng như phủ nước (độ nhám tụt về ~0.06, chỗ trũng theo vân đọng thành
  // vũng bóng nhất), tường đứng ướt ít hơn; người, đồ vật (vân theo vật) chỉ bớt nhám một chút.
  if (world) {
    let gloss: F = uWet.mul(smoothstep(0.35, 0.85, up).mul(0.6).add(0.4));
    gloss = h ? gloss.mul(smoothstep(0.4, 0.62, h).oneMinus().mul(smoothstep(0.5, 0.9, up)).mul(0.4).add(0.6)) : gloss.mul(0.8);
    s.roughnessNode = mix(baseRough, float(0.06), gloss.clamp(0, 0.92));
  } else {
    s.roughnessNode = mix(baseRough, float(0.32), uWet.mul(0.45));
  }

  if (h && dist) {
    const bumpFade = smoothstep(12, 55, dist).oneMinus();
    const n = (base.normal ?? materialNormal) as V3;
    s.normalNode = perturb(n, vec2(h.dFdx(), h.dFdy()).mul(uniforms.bump).mul(bumpFade));
  } else setSlot(material, "normalNode", base.normal ?? null);
}

/** Bật tắt vân cho cả cảnh (đồ hoạ thấp thì tắt cho nhẹ máy). Đổi thì các vật liệu đã phủ vân dựng lại shader. */
export const detailSettings = { enabled: true };
const patched = new Map<MeshStandardMaterial, Patch>();

export function setDetailEnabled(on: boolean) {
  if (detailSettings.enabled === on) return;
  detailSettings.enabled = on;
  for (const [m, patch] of patched) {
    assignNodes(m, patch);
    m.needsUpdate = true;
  }
}

/**
 * Phủ vân cho một vật liệu: gắn node màu, độ nhám, pháp tuyến (xem gpu/slots.ts). Gọi lại trên vật liệu đã phủ thì
 * không làm gì. Node có sẵn trên vật liệu (bản vá khác gắn TRƯỚC khi phủ vân) được giữ và bọc lên; bản vá muốn gắn
 * SAU thì cứ bọc tiếp lên ô hiện có (`wrapSlot`).
 */
export function applyDetail(material: MeshStandardMaterial, options: DetailOptions): MeshStandardMaterial {
  // Đánh dấu bằng tập hợp chứ không chỉ userData: React vẽ lại có thể thay cả userData (prop JSX) làm mất dấu.
  if (patched.has(material) || material.userData.tenDetail) return material;
  const def = KINDS[options.kind];
  const s = slots(material);
  const patch: Patch = {
    options,
    base: { color: s.colorNode, roughness: s.roughnessNode, normal: s.normalNode },
    uniforms: {
      maskA: uniform(new Vector4(...def.a)),
      maskB: uniform(new Vector4(...def.b)),
      scale: uniform(options.scale ?? def.scale),
      strength: uniform(options.strength ?? def.strength),
      bump: uniform(options.bump ?? def.bump),
    },
  };
  assignNodes(material, patch);
  patched.set(material, patch);
  material.addEventListener("dispose", () => patched.delete(material));
  material.userData.tenDetail = options.kind;
  material.needsUpdate = true;
  return material;
}

// ---------------------------------------------------------------------------- phủ vân cho cả cảnh

/** Khai báo loại vân cho một vật liệu (lần quét cảnh kế tiếp sẽ vá shader). */
export function detailed<M extends MeshStandardMaterial>(material: M, kind: DetailKind, strength?: number): M {
  material.userData.detail = kind;
  if (strength !== undefined) material.userData.detailStrength = strength;
  return material;
}

const hsl = { h: 0, s: 0, l: 0 };
const probe = new Color();

/** Đoán chất liệu theo màu: nâu là gỗ, xám là đá, xanh lá là lá, trắng ngà là vải/giấy... */
export function guessKind(color: Color): DetailKind {
  probe.copy(color).getHSL(hsl);
  const hue = hsl.h * 360;
  if (hsl.s < 0.12) return hsl.l > 0.75 ? "paper" : "rock";
  if (hue >= 70 && hue < 170) return "leaf";
  if (hue >= 15 && hue < 50 && hsl.l < 0.55) return "wood";
  if (hue >= 30 && hue < 60 && hsl.l >= 0.55) return hsl.s > 0.5 ? "sand" : "paper";
  if (hue >= 170 && hue < 260 && hsl.s < 0.35) return "rock";
  return "fabric";
}

/** Vật liệu không nên phủ vân: phát sáng, trong suốt, hay có bản đồ riêng. */
function skip(m: MeshStandardMaterial): boolean {
  if (patched.has(m) || m.userData.tenDetail || m.userData.detail === "none") return true;
  if (m.map || m.wireframe) return true;
  if (m.transparent && m.opacity < 0.95) return true;
  if (m.emissiveIntensity > 0.2 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) return true;
  return false;
}

/** Nhóm cha đánh dấu `userData.detail` (vd. "fur" cho thú, "fabric" cho người) thì dùng loại đó, vân dính theo vật. */
function ancestorKind(o: Object3D): DetailKind | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    const k = p.userData.detail as DetailKind | undefined;
    if (k && k in KINDS) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------- làm mịn hình khối

/** Góc gãy: hai mặt kề nhau lệch dưới chừng này thì nối mượt (khối đa diện, thân trụ ít cạnh), trên thì giữ cạnh (hộp). */
const CREASE = (75 * Math.PI) / 180;
/** Hình dựng sẵn của three.js đã có pháp tuyến đúng (hộp giữ cạnh, trụ và cầu tròn mượt). */
const NATIVE = new Set(["BoxGeometry", "PlaneGeometry", "CylinderGeometry", "SphereGeometry", "ConeGeometry", "CircleGeometry", "RingGeometry", "TorusGeometry", "CapsuleGeometry", "LatheGeometry"]);
const smoothed = new WeakMap<BufferGeometry, BufferGeometry>();

/** Pháp tuyến mượt cho một hình (dùng chung cho mọi vật cùng hình): khối đa diện, cây, đá ghép từ nhiều mảnh. */
function smoothMesh(mesh: Mesh) {
  const g = mesh.geometry;
  if (!g || g.userData.smooth || NATIVE.has(g.type) || !g.attributes.position || !g.attributes.normal) return;
  let out = smoothed.get(g);
  if (!out) {
    out = toCreasedNormals(g, CREASE);
    out.userData.smooth = true;
    g.userData.smooth = true;
    if (out !== g) {
      const copy = out;
      g.addEventListener("dispose", () => copy.dispose());
    }
    smoothed.set(g, out);
  }
  if (out !== g) mesh.geometry = out;
}

/** Vật cố ý để cạnh sắc: đá quý, pha lê, đồ phát sáng. */
function faceted(m: MeshStandardMaterial): boolean {
  return !!m.userData.faceted || (m.emissiveIntensity > 0.2 && m.emissive.r + m.emissive.g + m.emissive.b > 0.05);
}

/** Bỏ tô phẳng, làm mịn hình và phủ vân cho các vật liệu chuẩn của một khối (chưa phủ thì phủ, có rồi thì thôi). */
export function detailMesh(mesh: Mesh) {
  const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  let smooth = list.length > 0 && !mesh.userData.faceted;
  for (const m of list) {
    if (!(m instanceof MeshStandardMaterial)) {
      smooth = false;
      continue;
    }
    if (faceted(m)) smooth = false;
    else if (m.flatShading) {
      m.flatShading = false;
      m.needsUpdate = true;
    }
    if (skip(m)) continue;
    const declared = m.userData.detail as DetailKind | undefined;
    const group = declared ? null : ancestorKind(mesh);
    const kind = declared ?? group ?? (m.vertexColors ? "leaf" : guessKind(m.color));
    applyDetail(m, {
      kind,
      space: group || m.userData.detailSpace === "object" ? "object" : "world",
      splat: !!m.userData.detailSplat,
      strength: m.userData.detailStrength as number | undefined,
      bump: m.userData.detailBump as number | undefined,
    });
  }
  if (smooth) smoothMesh(mesh);
}

/**
 * Quét cảnh: bỏ kiểu tô phẳng low-poly (pháp tuyến mượt, tô mượt), rồi phủ vân cho mọi vật liệu chuẩn chưa có:
 * vật liệu tự khai báo `userData.detail`, hoặc nằm dưới nhóm có khai báo, hoặc đoán theo màu. Gọi định kỳ
 * (vật mới xuất hiện thì lần quét sau có vân) và trước khi dịch sẵn shader.
 */
export function detailScene(root: Object3D) {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) detailMesh(o as Mesh);
  });
}

// ---------------------------------------------------------------------------- phủ vân trước lần vẽ đầu

const hooked = new WeakSet<Mesh>();
const hookScenes = new Set<Object3D>();
const baseBeforeRender = Mesh.prototype.onBeforeRender;

/**
 * Phủ vân cho khối của cảnh `scene` ngay trước lần vẽ đầu tiên của nó. Trước đây vật mới xuất hiện được vẽ (và dịch
 * shader) bằng vật liệu gốc, tới lần quét cảnh sau (1,5 giây) mới được vá vân và phải dịch shader lần nữa: mỗi loại
 * vật mới làm khựng hai lần. Trên Windows (ANGLE dịch GLSL sang HLSL rồi qua trình biên dịch Direct3D) mỗi lần dịch
 * có thể mất cả trăm ms, nên đây là một nguồn giật lớn giữa trận. Móc vào Mesh.prototype.onBeforeRender (three gọi
 * ngay trước khi chọn shader cho khối), mỗi khối chỉ xử lý một lần. Móc dùng chung mọi canvas (nền 3D của menu vẽ
 * cùng lúc với trận) nên chỉ xử lý khối đang vẽ trong cảnh đã đăng ký. Trả về hàm gỡ móc.
 */
export function installDetailHook(scene: Object3D): () => void {
  if (hookScenes.size === 0) {
    Mesh.prototype.onBeforeRender = function (this: Mesh, _renderer: unknown, target: Object3D) {
      if (!hooked.has(this) && hookScenes.has(target)) {
        hooked.add(this);
        detailMesh(this);
      }
    };
  }
  hookScenes.add(scene);
  return () => {
    hookScenes.delete(scene);
    if (hookScenes.size === 0) Mesh.prototype.onBeforeRender = baseBeforeRender;
  };
}
