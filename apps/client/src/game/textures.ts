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
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

// Chất liệu cho mọi thứ trong cảnh: tám tấm vân (gỗ, đá, lá, vải, cát, cỏ, vách đá, đất) sinh tại chỗ bằng nhiễu
// lặp liền mép, không tải file nào. Mỗi vật liệu được vá shader để phủ vân theo toạ độ (chiếu ba mặt, khỏi cần UV),
// làm màu loang lổ và bề mặt gồ ghề theo vân (bump). Ở xa thì vân mờ dần để khỏi nhiễu hạt.

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

function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
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
function worley(u: number, v: number, cells: number, seed: number): [number, number] {
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
  return clamp01((0.34 + grainLines * 0.28 + fibre * 0.3 + (hash(plank, 1, 5) - 0.5) * 0.15) * (0.35 + 0.65 * edge));
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
  wood: { a: [1, 0, 0, 0], b: [0, 0, 0, 0], scale: 0.45, strength: 0.32, bump: 0.7 },
  bark: { a: [0.6, 0, 0, 0], b: [0, 0, 0.4, 0], scale: 0.7, strength: 0.35, bump: 1.1 },
  rock: { a: [0, 1, 0, 0], b: [0, 0, 0, 0], scale: 0.25, strength: 0.32, bump: 1.2 },
  leaf: { a: [0, 0, 1, 0], b: [0, 0, 0, 0], scale: 0.6, strength: 0.22, bump: 0.2 },
  fabric: { a: [0, 0, 0, 1], b: [0, 0, 0, 0], scale: 0.9, strength: 0.16, bump: 0 },
  sand: { a: [0, 0, 0, 0], b: [1, 0, 0, 0], scale: 0.25, strength: 0.18, bump: 0.3 },
  grass: { a: [0, 0, 0, 0], b: [0, 1, 0, 0], scale: 0.3, strength: 0.28, bump: 0.3 },
  cliff: { a: [0, 0, 0, 0], b: [0, 0, 1, 0], scale: 0.1, strength: 0.38, bump: 1.2 },
  dirt: { a: [0, 0, 0, 0], b: [0, 0, 0, 1], scale: 0.35, strength: 0.32, bump: 1 },
  fur: { a: [0, 0, 0, 0], b: [0, 1, 0, 0], scale: 1.6, strength: 0.14, bump: 0 },
  skin: { a: [0, 0, 0.3, 0], b: [0.7, 0, 0, 0], scale: 2, strength: 0.05, bump: 0 },
  metal: { a: [0, 0.4, 0, 0], b: [0, 0, 0, 0.6], scale: 0.8, strength: 0.2, bump: 0.3 },
  paper: { a: [0, 0, 0, 0.5], b: [0.5, 0, 0, 0], scale: 1.2, strength: 0.08, bump: 0 },
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

const VERTEX_HEAD = /* glsl */ `
varying vec3 vDetailPos;
varying vec3 vDetailNormal;
#ifdef TEN_SPLAT
  attribute vec4 splat;
  varying vec4 vSplat;
#endif
`;

function vertexBody(world: boolean) {
  return /* glsl */ `
  {
    vec4 dp = vec4( transformed, 1.0 );
    vec3 dn = objectNormal;
    ${
      world
        ? `#ifdef USE_INSTANCING
      dp = instanceMatrix * dp;
      dn = mat3( instanceMatrix ) * dn;
    #endif
    dp = modelMatrix * dp;
    dn = mat3( modelMatrix ) * dn;`
        : ""
    }
    vDetailPos = dp.xyz;
    vDetailNormal = dn;
    #ifdef TEN_SPLAT
      vSplat = splat;
    #endif
  }`;
}

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uDetailA;
uniform sampler2D uDetailB;
uniform vec4 uMaskA;
uniform vec4 uMaskB;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform float uDetailBump;
varying vec3 vDetailPos;
varying vec3 vDetailNormal;
#ifdef TEN_SPLAT
  varying vec4 vSplat;
#endif
vec3 tenPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
  vec3 sx = dFdx( surfPos );
  vec3 sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm );
  vec3 r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;

const FRAGMENT_COLOR = /* glsl */ `
  vec3 tenW = pow( abs( normalize( vDetailNormal ) ), vec3( 4.0 ) );
  tenW /= ( tenW.x + tenW.y + tenW.z + 1e-5 );
  vec3 tenP = vDetailPos * uDetailScale;
  // Lệch mip một bậc: vân mềm hơn, đạo hàm (cho bump) đỡ lấm tấm.
  vec4 tenA = texture2D( uDetailA, tenP.zy, 1.0 ) * tenW.x + texture2D( uDetailA, tenP.xz, 1.0 ) * tenW.y + texture2D( uDetailA, tenP.xy, 1.0 ) * tenW.z;
  vec4 tenB = texture2D( uDetailB, tenP.zy, 1.0 ) * tenW.x + texture2D( uDetailB, tenP.xz, 1.0 ) * tenW.y + texture2D( uDetailB, tenP.xy, 1.0 ) * tenW.z;
  #ifdef TEN_SPLAT
    vec4 tenMaskB = vSplat;
  #else
    vec4 tenMaskB = uMaskB;
  #endif
  float tenMass = dot( uMaskA, vec4( 1.0 ) ) + dot( tenMaskB, vec4( 1.0 ) );
  float tenH = ( dot( tenA, uMaskA ) + dot( tenB, tenMaskB ) ) / max( tenMass, 1e-3 );
  // Ở xa thì vân nhạt dần (tránh nhiễu hạt), bump tắt sớm hơn.
  float tenDist = length( vViewPosition );
  float tenFade = 1.0 - smoothstep( 25.0, 110.0, tenDist );
  diffuseColor.rgb *= 1.0 + ( tenH - 0.5 ) * 2.0 * uDetailStrength * ( 0.35 + 0.65 * tenFade );
  #ifdef TEN_SPLAT
    // Mảng lớn đậm nhạt trên địa hình để khỏi thấy vân lặp.
    float tenMacro = texture2D( uDetailB, vDetailPos.xz * 0.011 ).a;
    diffuseColor.rgb *= 0.86 + 0.28 * tenMacro;
  #endif
`;

const FRAGMENT_NORMAL = /* glsl */ `
  {
    float tenBumpFade = 1.0 - smoothstep( 12.0, 55.0, tenDist );
    if ( tenBumpFade > 0.0 && uDetailBump > 0.0 ) normal = tenPerturb( -vViewPosition, normal, vec2( dFdx( tenH ), dFdy( tenH ) ) * uDetailBump * tenBumpFade, faceDirection );
  }
`;

/** Bật tắt vân cho cả cảnh (đồ hoạ thấp thì tắt cho nhẹ máy). Đổi thì các vật liệu đã vá tự dựng lại shader. */
export const detailSettings = { enabled: true };
const patched = new Set<MeshStandardMaterial>();

export function setDetailEnabled(on: boolean) {
  if (detailSettings.enabled === on) return;
  detailSettings.enabled = on;
  for (const m of patched) m.needsUpdate = true;
}

type Compile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

/** Vá một vật liệu để phủ vân. Gọi lại trên vật liệu đã vá thì không làm gì. Giữ nguyên bản vá sẵn có (gió lay...). */
export function applyDetail(material: MeshStandardMaterial, options: DetailOptions): MeshStandardMaterial {
  if (material.userData.tenDetail) return material;
  const def = KINDS[options.kind];
  const world = (options.space ?? "world") === "world";
  const tex = detailTextures();
  const uniforms = {
    uDetailA: { value: tex.a },
    uDetailB: { value: tex.b },
    uMaskA: { value: new Vector4(...def.a) },
    uMaskB: { value: new Vector4(...def.b) },
    uDetailScale: { value: options.scale ?? def.scale },
    uDetailStrength: { value: options.strength ?? def.strength },
    uDetailBump: { value: options.bump ?? def.bump },
  };
  const prev: Compile | undefined = material.onBeforeCompile === MeshStandardMaterial.prototype.onBeforeCompile ? undefined : material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey === MeshStandardMaterial.prototype.customProgramCacheKey ? "" : material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    if (!detailSettings.enabled) return;
    Object.assign(shader.uniforms, uniforms);
    if (options.splat) shader.defines = { ...shader.defines, TEN_SPLAT: "" };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <fog_vertex>", `#include <fog_vertex>\n${vertexBody(world)}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
  };
  material.customProgramCacheKey = () => (detailSettings.enabled ? `${prevKey}|detail:${world ? "w" : "o"}:${options.splat ? "s" : ""}` : `${prevKey}|flat`);
  patched.add(material);
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
  if (m.userData.tenDetail || m.userData.detail === "none") return true;
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

/**
 * Quét cảnh và phủ vân cho mọi vật liệu chuẩn chưa có: vật liệu tự khai báo `userData.detail`, hoặc nằm dưới nhóm
 * có khai báo, hoặc đoán theo màu. Gọi định kỳ (vật mới xuất hiện thì lần quét sau có vân).
 */
export function detailScene(root: Object3D) {
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      if (!(m instanceof MeshStandardMaterial) || skip(m)) continue;
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
  });
}

