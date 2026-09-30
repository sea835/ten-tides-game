import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector2, type Texture, type WebGLProgramParametersWithUniforms } from "three";
import { SKIN, type SkinDef, type SkinFinish, type SkinPattern } from "@tentides/content";

// Vật liệu skin súng: thay vật liệu của từng bộ phận súng (khoá GunModel: metal, poly, wood...) bằng vật liệu theo skin.
// Vân (rằn ri, vằn hổ, tổ ong, điểm ảnh, sợi carbon, thép damascus) sinh tại chỗ bằng canvas, không cần file ảnh.
// Khối súng không có UV tử tế, nên vân được chiếu theo ba mặt phẳng (triplanar) trong toạ độ của vật (object space):
// vân dính theo súng khi súng xoay, không trượt như chiếu theo toạ độ thế giới. Chuyển màu thì chạy dọc nòng (+z).
// Skin neon: nền tối, các đường vân phát sáng (emissive); vật liệu có userData.neon = true để bên gọi cho nhấp nháy
// emissiveIntensity (hoặc gọi pulseNeon(t) mỗi khung hình).

/** Các khoá vật liệu thân súng nhận skin. Kính, ống kính, đồ khác (găng, đạn...) giữ nguyên. */
export const SKINNABLE_KEYS: ReadonlySet<string> = new Set(["metal", "steel", "poly", "wood", "darkwood", "bakelite", "tan", "olive"]);

/** Độ sáng từng loại bộ phận khi đã phủ skin: phần gỗ, nhựa tối hơn một chút để vẫn nhìn ra hình khối súng. */
const TONE: Record<string, number> = { metal: 1, steel: 1.12, poly: 0.86, wood: 0.94, darkwood: 0.8, bakelite: 0.8, tan: 1.04, olive: 0.94 };

// ---------------------------------------------------------------------------- vân sinh tại chỗ

const SIZE = 256;

/** Ngẫu nhiên có seed (mulberry32) để cùng skin luôn ra cùng vân trên mọi máy. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/** Vẽ một hình lặp ở 9 vị trí (lệch ±SIZE) để vân nối liền khi lát gạch. */
function wrapDraw(ctx: Ctx, draw: (dx: number, dy: number) => void) {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) draw(dx, dy);
}

const pick = <T,>(list: readonly T[], i: number, fallback: T): T => list[i % Math.max(1, list.length)] ?? fallback;

function drawCamo(ctx: Ctx, palette: readonly string[], rand: () => number) {
  ctx.fillStyle = pick(palette, 0, "#555");
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let k = 1; k < Math.max(2, palette.length); k++) {
    ctx.fillStyle = pick(palette, k, "#333");
    for (let b = 0; b < 9; b++) {
      // Mỗi mảng rằn ri là vài hình bầu dục chồng lên nhau cho mép cong queo tự nhiên.
      const cx = rand() * SIZE;
      const cy = rand() * SIZE;
      const lobes = 3 + Math.floor(rand() * 4);
      const pieces: [number, number, number, number, number][] = [];
      for (let l = 0; l < lobes; l++) pieces.push([cx + (rand() - 0.5) * 50, cy + (rand() - 0.5) * 34, 10 + rand() * 22, 7 + rand() * 14, rand() * Math.PI]);
      wrapDraw(ctx, (dx, dy) => {
        for (const [x, y, rx, ry, rot] of pieces) {
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, rx, ry, rot, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }
}

function drawTiger(ctx: Ctx, colors: readonly string[], rand: () => number) {
  ctx.fillStyle = pick(colors, 0, "#c9822b");
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = pick(colors, 1, "#111");
  // Vằn: dải thuôn hai đầu, uốn lượn, chạy chéo.
  for (let s = 0; s < 14; s++) {
    const x0 = rand() * SIZE;
    const y0 = rand() * SIZE;
    const len = 60 + rand() * 90;
    const width = 4 + rand() * 9;
    const ang = 1.1 + (rand() - 0.5) * 0.5;
    const bend = (rand() - 0.5) * 40;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const w = width * Math.sin(Math.PI * t) ** 0.7;
      pts.push([x0 + Math.cos(ang) * len * t + Math.sin(t * Math.PI) * bend, y0 + Math.sin(ang) * len * t, w]);
    }
    wrapDraw(ctx, (dx, dy) => {
      ctx.beginPath();
      pts.forEach(([x, y, w], i) => (i === 0 ? ctx.moveTo(x + dx - w, y + dy) : ctx.lineTo(x + dx - w, y + dy)));
      for (let i = pts.length - 1; i >= 0; i--) {
        const [x, y, w] = pts[i]!;
        ctx.lineTo(x + dx + w, y + dy);
      }
      ctx.closePath();
      ctx.fill();
    });
  }
}

function drawHex(ctx: Ctx, colors: readonly string[]) {
  // Lưới lục giác lát kín ô 256: 8 cột, 10 hàng (hàng chẵn để so le nối liền).
  const cols = 8;
  const rows = 10;
  const w = SIZE / cols;
  const h = SIZE / rows;
  const rx = w / Math.sqrt(3);
  const ry = h / 1.5;
  ctx.fillStyle = pick(colors, 1, "#2bb3a3");
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = pick(colors, 0, "#0f3d3e");
  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      const cx = c * w + (r % 2 ? w / 2 : 0);
      const cy = r * h;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * rx * 0.86;
        const py = cy + Math.sin(a) * ry * 0.86;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawDigital(ctx: Ctx, colors: readonly string[], rand: () => number) {
  const cell = 8;
  const n = SIZE / cell;
  const grid: number[] = new Array(n * n).fill(0);
  // Các mảng điểm ảnh gom cụm (không phải nhiễu hạt tiêu).
  for (let k = 1; k < Math.max(2, colors.length); k++) {
    for (let b = 0; b < 22; b++) {
      const cx = Math.floor(rand() * n);
      const cy = Math.floor(rand() * n);
      const bw = 1 + Math.floor(rand() * 5);
      const bh = 1 + Math.floor(rand() * 3);
      for (let x = 0; x < bw; x++) for (let y = 0; y < bh; y++) if (rand() > 0.15) grid[((cy + y) % n) * n + ((cx + x) % n)] = k;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = pick(colors, grid[y * n + x]!, "#555");
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

function drawCarbon(ctx: Ctx, colors: readonly string[]) {
  // Sợi dệt chéo (twill 2x2): mỗi ô là một bó sợi ngang hay dọc, có đổ bóng theo chiều sợi.
  const cell = 16;
  const n = SIZE / cell;
  const a = pick(colors, 0, "#1a1b1e");
  const b = pick(colors, 1, "#3a3d42");
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const horizontal = (x + y) % 4 < 2;
      const g = horizontal ? ctx.createLinearGradient(0, y * cell, 0, (y + 1) * cell) : ctx.createLinearGradient(x * cell, 0, (x + 1) * cell, 0);
      g.addColorStop(0, a);
      g.addColorStop(0.5, b);
      g.addColorStop(1, a);
      ctx.fillStyle = g;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

function drawDamascus(ctx: Ctx, colors: readonly string[], rand: () => number) {
  // Thép damascus: các lớp gợn sóng. Mọi tần số là bội nguyên của chu kỳ ô nên vân nối liền.
  const img = ctx.createImageData(SIZE, SIZE);
  const cols = colors.map((c) => new Color(c));
  while (cols.length < 2) cols.push(new Color("#888"));
  const tau = Math.PI * 2;
  const p1 = rand() * tau;
  const p2 = rand() * tau;
  const tmp = new Color();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const warp = 0.09 * Math.sin(tau * 2 * u + p1) + 0.05 * Math.sin(tau * (3 * u + 2 * v) + p2) + 0.03 * Math.sin(tau * 7 * u);
      const band = 0.5 + 0.5 * Math.sin(tau * 9 * (v + warp));
      const t = band * (cols.length - 1);
      const i = Math.min(cols.length - 2, Math.floor(t));
      tmp.copy(cols[i]!).lerp(cols[i + 1]!, t - i);
      const o = (y * SIZE + x) * 4;
      img.data[o] = Math.round(tmp.r * 255);
      img.data[o + 1] = Math.round(tmp.g * 255);
      img.data[o + 2] = Math.round(tmp.b * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Mặt nạ phát sáng cho skin neon: đường mạch điện trắng trên nền đen (trắng là chỗ sáng). */
function drawNeonMask(ctx: Ctx, rand: () => number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const step = 32;
  for (let i = 0; i < 16; i++) {
    let x = Math.floor(rand() * 8) * step;
    let y = Math.floor(rand() * 8) * step;
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < 4; s++) {
      // Đường mạch chỉ đi ngang, dọc hoặc chéo 45 độ.
      const dir = Math.floor(rand() * 3);
      const len = step * (1 + Math.floor(rand() * 2));
      if (dir === 0) x += len;
      else if (dir === 1) y += len;
      else {
        x += len;
        y += len;
      }
      pts.push([x, y]);
    }
    const width = 1.5 + rand() * 2.5;
    wrapDraw(ctx, (dx, dy) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px + dx, py + dy) : ctx.lineTo(px + dx, py + dy)));
      ctx.stroke();
      const [ex, ey] = pts[pts.length - 1]!;
      ctx.beginPath();
      ctx.arc(ex + dx, ey + dy, width + 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

const textureCache = new Map<string, Texture>();

function makeTexture(key: string, paint: (ctx: Ctx, rand: () => number) => void, srgb = true): Texture | null {
  const hit = textureCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx, seeded(key));
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

function patternPaint(pattern: SkinPattern, colors: readonly string[]): (ctx: Ctx, rand: () => number) => void {
  switch (pattern) {
    case "tiger":
      return (ctx, r) => drawTiger(ctx, colors, r);
    case "hex":
      return (ctx) => drawHex(ctx, colors);
    case "digital":
      return (ctx, r) => drawDigital(ctx, colors, r);
    case "carbon":
      return (ctx) => drawCarbon(ctx, colors);
    case "damascus":
      return (ctx, r) => drawDamascus(ctx, colors, r);
  }
}

/** Số lần lặp vân trên mỗi mét (súng dài chừng 0,2–1,3 m). */
const PATTERN_SCALE: Record<SkinPattern, number> = { tiger: 2.6, hex: 8, digital: 4, carbon: 16, damascus: 3.2 };
/** Kim loại, độ nhám của từng kiểu vân. */
const PATTERN_SURFACE: Record<SkinPattern, [number, number]> = { tiger: [0.2, 0.55], hex: [0.45, 0.4], digital: [0.1, 0.72], carbon: [0.35, 0.32], damascus: [0.85, 0.28] };

// ---------------------------------------------------------------------------- vá shader

interface SkinLook {
  color: string;
  metalness: number;
  roughness: number;
  map?: Texture | null;
  scale?: number;
  /** Độ nhám thay đổi theo độ sáng vân (0 là không): thép damascus, carbon lấp lánh theo lớp. */
  roughVar?: number;
  gradient?: { from: string; to: string };
  neon?: { color: string; glow: number; mask: Texture | null; scale: number };
}

function lookOf(skin: SkinDef): SkinLook {
  const f: SkinFinish = skin.finish;
  switch (f.kind) {
    case "solid":
      return { color: f.color, metalness: f.metalness, roughness: f.roughness };
    case "camo":
      return { color: "#ffffff", metalness: 0.1, roughness: 0.75, map: makeTexture(`camo:${skin.id}`, (ctx, r) => drawCamo(ctx, f.palette, r)), scale: 2.8 };
    case "gradient":
      return { color: "#ffffff", metalness: 0.55, roughness: 0.32, gradient: { from: f.from, to: f.to } };
    case "pattern": {
      const [metalness, roughness] = PATTERN_SURFACE[f.pattern];
      return {
        color: "#ffffff",
        metalness,
        roughness,
        map: makeTexture(`${f.pattern}:${skin.id}`, patternPaint(f.pattern, f.colors)),
        scale: PATTERN_SCALE[f.pattern],
        roughVar: f.pattern === "damascus" || f.pattern === "carbon" ? 0.6 : 0,
      };
    }
    case "gold":
      return { color: "#e0b040", metalness: 1, roughness: 0.2 };
    case "chrome":
      return { color: "#eef1f4", metalness: 1, roughness: 0.06 };
    case "neon":
      return { color: "#0d1117", metalness: 0.55, roughness: 0.35, neon: { color: f.color, glow: f.glow, mask: makeTexture(`neon:${skin.id}`, drawNeonMask, false), scale: 4 } };
  }
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
`;

const VERTEX_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
    vSkinPos = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;
    vSkinNormal = mat3( instanceMatrix ) * objectNormal;
  #else
    vSkinPos = position;
    vSkinNormal = objectNormal;
  #endif
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
uniform sampler2D uSkinMap;
uniform float uSkinScale;
uniform float uSkinRoughVar;
uniform vec3 uSkinFrom;
uniform vec3 uSkinTo;
uniform vec2 uSkinRange;
vec4 skinTriplanar( sampler2D tex, vec3 p, vec3 n ) {
  vec3 w = pow( abs( normalize( n ) ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-5 );
  return texture2D( tex, p.zy ) * w.x + texture2D( tex, p.xz + 0.37 ) * w.y + texture2D( tex, p.xy + 0.71 ) * w.z;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
  vec4 skinTex = vec4( 1.0 );
  #if defined( SKIN_MAP ) || defined( SKIN_NEON )
    skinTex = skinTriplanar( uSkinMap, vSkinPos * uSkinScale, vSkinNormal );
  #endif
  #ifdef SKIN_MAP
    diffuseColor.rgb *= skinTex.rgb;
  #endif
  #ifdef SKIN_GRADIENT
    // Chuyển màu dọc thân súng (báng → nòng), pha chút theo chiều cao cho đỡ phẳng.
    float skinT = smoothstep( uSkinRange.x, uSkinRange.y, vSkinPos.z + vSkinPos.y * 0.35 );
    diffuseColor.rgb *= mix( uSkinFrom, uSkinTo, skinT );
  #endif
`;

const FRAGMENT_ROUGH = /* glsl */ `
  #ifdef SKIN_MAP
    roughnessFactor = clamp( roughnessFactor * ( 1.0 + ( 0.5 - dot( skinTex.rgb, vec3( 0.333 ) ) ) * uSkinRoughVar * 2.0 ), 0.03, 1.0 );
  #endif
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
  #ifdef SKIN_NEON
    // Đường mạch sáng rực, phần nền le lói.
    totalEmissiveRadiance *= 0.08 + skinTex.r * 1.4;
  #endif
`;

/** Nén độ sâu về sát camera cho súng trước mặt (giống drawOnTop trong GunModel), gộp chung vào bản vá skin. */
const DRAW_ON_TOP_GLSL = "gl_Position.z = gl_Position.z * 0.05 - 0.95 * gl_Position.w;";

function patch(m: MeshStandardMaterial, look: SkinLook, onTop: boolean) {
  const uniforms = {
    uSkinMap: { value: look.map ?? look.neon?.mask ?? null },
    uSkinScale: { value: look.neon?.scale ?? look.scale ?? 1 },
    uSkinRoughVar: { value: look.roughVar ?? 0 },
    uSkinFrom: { value: new Color(look.gradient?.from ?? "#ffffff") },
    uSkinTo: { value: new Color(look.gradient?.to ?? "#ffffff") },
    // Súng: gốc ở tay cầm, nòng theo +z; báng chừng -0,45 m, đầu nòng chừng +0,75 m.
    uSkinRange: { value: new Vector2(-0.45, 0.75) },
  };
  const defines: Record<string, string> = {};
  if (look.map) defines.SKIN_MAP = "";
  if (look.gradient) defines.SKIN_GRADIENT = "";
  if (look.neon?.mask) defines.SKIN_NEON = "";
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...shader.defines, ...defines };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
    if (onTop) shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n  ${DRAW_ON_TOP_GLSL}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGH}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE}`);
  };
  const key = `tenskin:${Object.keys(defines).sort().join(",")}${onTop ? ":top" : ""}`;
  m.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------------------- vật liệu

const cache = new Map<string, MeshStandardMaterial>();
const neonMaterials = new Set<MeshStandardMaterial>();

function build(baseKey: string, skin: SkinDef, opacity: number, onTop: boolean): MeshStandardMaterial {
  const look = lookOf(skin);
  const tone = TONE[baseKey] ?? 1;
  const color = new Color(look.color).multiplyScalar(tone);
  const alpha = Math.min(1, Math.max(0, opacity));
  const m = new MeshStandardMaterial({
    color,
    metalness: look.metalness,
    // Bộ phận nhựa, gỗ nhám hơn phần kim loại một chút.
    roughness: Math.min(1, look.roughness + (baseKey === "poly" || baseKey === "wood" || baseKey === "darkwood" ? 0.08 : 0)),
    transparent: alpha < 1,
    opacity: alpha,
    side: alpha < 1 ? DoubleSide : undefined,
  });
  if (alpha < 1) m.depthWrite = false;
  if (look.neon) {
    m.emissive.set(look.neon.color);
    m.emissiveIntensity = look.neon.glow;
    m.userData.neon = true;
    m.userData.neonGlow = look.neon.glow;
    neonMaterials.add(m);
  }
  // Không để trình phủ vân của cảnh (textures.ts) vá chồng lên.
  m.userData.detail = "none";
  m.userData.detailSpace = "object";
  m.userData.skin = skin.id;
  patch(m, look, onTop);
  return m;
}

function get(baseKey: string, skinId: string, opacity: number, onTop: boolean): MeshStandardMaterial | null {
  if (!skinId || !SKINNABLE_KEYS.has(baseKey)) return null;
  const skin = SKIN.get(skinId);
  if (!skin) return null;
  const id = `${baseKey}|${skinId}|${opacity}|${onTop ? 1 : 0}`;
  let m = cache.get(id);
  if (!m) {
    m = build(baseKey, skin, opacity, onTop);
    cache.set(id, m);
  }
  return m;
}

/**
 * Vật liệu thay cho bộ phận súng `baseKey` (khoá trong MATS của GunModel) khi lắp skin `skinId`. Dùng chung (cache),
 * đừng dispose. Trả về null nếu bộ phận không nhận skin (kính, ống kính...) hoặc skin không tồn tại: giữ vật liệu gốc.
 */
export function skinMaterial(baseKey: string, skinId: string, opacity = 1): MeshStandardMaterial | null {
  return get(baseKey, skinId, opacity, false);
}

/**
 * Như skinMaterial nhưng cho súng trước mặt (góc thứ nhất): đã gộp sẵn phần nén độ sâu (drawOnTop của GunModel).
 * Đừng gọi drawOnTop() lên vật liệu này: hàm đó ghi đè onBeforeCompile và làm mất vân skin.
 */
export function skinViewMaterial(baseKey: string, skinId: string): MeshStandardMaterial | null {
  return get(baseKey, skinId, 1, true);
}

/** Nhịp sáng cho mọi vật liệu neon đã tạo (gọi mỗi khung hình với thời gian tính bằng giây), nếu bên gọi không tự làm. */
export function pulseNeon(time: number) {
  for (const m of neonMaterials) {
    const glow = (m.userData.neonGlow as number) ?? 1;
    m.emissiveIntensity = glow * (0.75 + 0.25 * Math.sin(time * 3.2) + 0.08 * Math.sin(time * 11.7));
  }
}
