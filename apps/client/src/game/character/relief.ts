import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, type MeshStandardMaterial, type Texture, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { mulberry32 } from "../nature.ts";
import { detailSettings } from "../textures.ts";

// Nổi gân bề mặt cho đồ của người lính, tính thẳng trong shader theo toạ độ của vật (không cần UV, không tải ảnh):
// - "wrinkle": nếp nhăn vải quần áo (nếp ngang uốn lượn quanh ống tay, ống quần, thân áo; chỗ dày chỗ thưa).
// - "kevlar": sợi dệt đan rổ của áo giáp mềm.
// - "ceramic": tấm gốm chống đạn ghép lục giác, rãnh giữa các viên, mỗi viên đậm nhạt khác nhau.
// - "scuff": mũ sắt sơn mờ, vết xước tróc sơn lộ kim loại sáng loé dưới nắng, vài vết móp.
// Chỉ nổi gân ở gần (mờ dần theo khoảng cách cho khỏi lấm tấm), tắt hẳn khi đồ hoạ thấp tắt vân chi tiết.

export type ReliefKind = "wrinkle" | "kevlar" | "ceramic" | "scuff";

/** Bật / tắt theo vân chi tiết của cả cảnh (đọc mỗi lần đẩy uniform, khỏi phải dựng lại shader). */
const on = {
  get value() {
    return detailSettings.enabled ? 1 : 0;
  },
};

let scratchTex: Texture | null = null;

/** Ảnh vết xước (kênh đỏ): vệt dài mảnh cong nhẹ, vết tróc sơn lốm đốm, lặp liền mép. */
function scratches(): Texture {
  if (scratchTex) return scratchTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const rand = mulberry32(4711);
  g.lineCap = "round";
  for (let i = 0; i < 34; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const len = 6 + rand() * 38;
    const bend = (rand() - 0.5) * 10;
    g.strokeStyle = `rgba(255,0,0,${0.25 + rand() * 0.5})`;
    g.lineWidth = rand() < 0.8 ? 0.7 : 1.4;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]] as const) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + oy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
  // Vết tróc sơn: cụm chấm nhỏ.
  for (let i = 0; i < 14; i++) {
    const x = rand() * S;
    const y = rand() * S;
    for (let k = 0; k < 8; k++) {
      g.fillStyle = `rgba(255,0,0,${0.4 + rand() * 0.5})`;
      const r = 0.6 + rand() * 1.8;
      g.beginPath();
      g.arc((x + (rand() - 0.5) * 9 + S) % S, (y + (rand() - 0.5) * 9 + S) % S, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  scratchTex = t;
  return t;
}

const HEAD = /* glsl */ `
uniform float uRelOn;
uniform float uRelAmp;
uniform sampler2D uRelTex;
varying vec3 vRelPos;
varying vec3 vRelNrm;
varying vec3 vRelX;
varying vec3 vRelY;
varying vec3 vRelZ;
float relHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// Toạ độ phẳng theo mặt chiếu trội nhất của pháp tuyến (tấm giáp, mặt hộp: gần như phẳng nên không cần trộn ba mặt).
vec2 relPlane( vec3 p, vec3 n ) {
  vec3 a = abs( n );
  return a.z >= a.x && a.z >= a.y ? p.xy : a.x >= a.y ? p.zy : p.xz;
}
`;

/**
 * Mỗi loại: hàm `relPat(p, n)` (toạ độ và pháp tuyến của vật) trả về độ cao (m) và mặt nạ (0–1, nơi đổi màu, độ nhám,
 * độ kim loại); `step` là bước sai phân (m) để lấy độ dốc, nhỏ hơn chi tiết nhỏ nhất của vân.
 */
const PATTERN: Record<ReliefKind, { step: number; glsl: string }> = {
  wrinkle: {
    step: 0.002,
    glsl: /* glsl */ `
vec2 relPat( vec3 p, vec3 n ) {
  float a = atan( p.x, p.z );
  // Nếp ngang (vải dồn) uốn lượn theo góc quanh ống, chỗ dày chỗ thưa dọc ống.
  float w1 = sin( p.y * 95.0 + sin( a * 3.0 + p.y * 17.0 ) * 1.9 + sin( a * 5.0 ) * 0.7 );
  float m1 = smoothstep( 0.35, 0.95, 0.5 + 0.5 * sin( a * 2.0 + p.y * 23.0 + 1.3 ) );
  float fold = pow( 1.0 - abs( w1 ), 2.0 ) * m1;
  // Nếp chéo dài mềm (vải căng xoắn theo thân).
  float w2 = sin( p.y * 41.0 + a * 4.0 + sin( p.y * 29.0 + a ) * 1.3 );
  return vec2( ( fold * 0.8 + w2 * 0.25 ) * 0.0016, fold );
}
`,
  },
  kevlar: {
    step: 0.0005,
    glsl: /* glsl */ `
vec2 relPat( vec3 p, vec3 n ) {
  vec2 q = relPlane( p, n ) / 0.006;
  vec2 c = floor( q );
  vec2 f = fract( q );
  // Đan rổ: ô chẵn sợi ngang, ô lẻ sợi dọc, mỗi ô ba sợi.
  float odd = mod( c.x + c.y, 2.0 );
  float thread = odd > 0.5 ? sin( fract( f.x * 3.0 ) * 3.14159 ) : sin( fract( f.y * 3.0 ) * 3.14159 );
  float rise = odd > 0.5 ? sin( f.y * 3.14159 ) : sin( f.x * 3.14159 );
  return vec2( thread * rise * 0.0003, thread * rise );
}
`,
  },
  ceramic: {
    step: 0.0012,
    glsl: /* glsl */ `
vec2 relPat( vec3 pp, vec3 n ) {
  vec2 p = relPlane( pp, n ) / 0.032;
  const vec2 s = vec2( 1.0, 1.7320508 );
  vec4 hc = floor( vec4( p, p - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
  vec4 h = vec4( p - hc.xy * s, p - ( hc.zw + 0.5 ) * s );
  bool first = dot( h.xy, h.xy ) < dot( h.zw, h.zw );
  vec2 q = abs( first ? h.xy : h.zw );
  vec2 id = first ? hc.xy : hc.zw + 0.5;
  float edge = 0.5 - max( dot( q, s * 0.5 ), q.x );
  // Rãnh giữa các viên gốm, mặt viên hơi vồng.
  float tile = smoothstep( 0.0, 0.08, edge );
  return vec2( ( tile * 0.8 + sqrt( max( edge, 0.0 ) ) * 0.3 ) * 0.0016, tile * ( 0.75 + 0.25 * relHash( id ) ) );
}
`,
  },
  scuff: {
    step: 0.0008,
    glsl: /* glsl */ `
vec2 relPat( vec3 pp, vec3 n ) {
  vec3 p = pp * 2.6;
  vec3 w = pow( abs( normalize( n ) ), vec3( 4.0 ) );
  w /= w.x + w.y + w.z + 1e-5;
  float s = texture2D( uRelTex, p.zy ).r * w.x + texture2D( uRelTex, p.xz ).r * w.y + texture2D( uRelTex, p.xy ).r * w.z;
  // Vài vết móp nông trên vỏ mũ.
  float dent = sin( pp.x * 61.0 + 1.7 ) * sin( pp.y * 47.0 ) * sin( pp.z * 53.0 + 0.4 );
  return vec2( -s * 0.00025 - smoothstep( 0.55, 0.95, dent ) * 0.0012, s );
}
`,
  },
};

/** Đổi màu, độ nhám, độ kim loại theo mặt nạ của từng loại. */
const SURFACE: Record<ReliefKind, { color: string; rough: string; metal: string }> = {
  // Đáy nếp gấp tối hơn, sống nếp sáng hơn chút (vải bị mài).
  wrinkle: { color: "diffuseColor.rgb *= 1.0 - relM * 0.09 * relFade * uRelOn;", rough: "", metal: "" },
  kevlar: { color: "diffuseColor.rgb *= 1.0 + ( relM - 0.5 ) * 0.07 * relFade * uRelOn;", rough: "", metal: "" },
  // Mặt viên gốm phủ lớp bóng nhẹ, rãnh nhám tối.
  ceramic: {
    color: "diffuseColor.rgb *= mix( 1.0, mix( 0.7, 0.92 + relM * 0.2, step( 0.01, relM ) ), uRelOn );",
    rough: "roughnessFactor = mix( roughnessFactor, mix( 0.95, 0.42, relM ), uRelOn );",
    metal: "",
  },
  // Vết xước: tróc sơn lộ thép sáng, nhẵn, kim loại (loé sáng khi nắng chiếu).
  scuff: {
    color: "diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.43, 0.42 ), clamp( relM * 1.2, 0.0, 0.85 ) * uRelOn );",
    rough: "roughnessFactor = mix( roughnessFactor, 0.25, clamp( relM * 1.2, 0.0, 1.0 ) * uRelOn );",
    metal: "metalnessFactor = mix( metalnessFactor, 0.9, clamp( relM * 1.2, 0.0, 1.0 ) * uRelOn );",
  },
};

type Compile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

/**
 * Gắn nổi gân bề mặt vào vật liệu (gọi một lần lúc tạo). Giữ các bản vá có sẵn (viền sáng, vân chi tiết) và để bản vá
 * sau vẫn tìm thấy các mốc shader. `amp` nhân độ sâu nổi gân.
 */
export function withRelief<M extends MeshStandardMaterial>(m: M, kind: ReliefKind, amp = 1): M {
  if (m.userData.relief) return m;
  m.userData.relief = kind;
  const prev: Compile | undefined = m.onBeforeCompile === Object.getPrototypeOf(m).onBeforeCompile ? undefined : m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey === Object.getPrototypeOf(m).customProgramCacheKey ? "" : m.customProgramCacheKey();
  const uniforms = { uRelOn: on, uRelAmp: { value: amp }, uRelTex: { value: kind === "scuff" ? scratches() : null } };
  const surf = SURFACE[kind];
  const pat = PATTERN[kind];
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRelPos;\nvarying vec3 vRelNrm;\nvarying vec3 vRelX;\nvarying vec3 vRelY;\nvarying vec3 vRelZ;")
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
  vRelPos = position;
  vRelNrm = normal;
  vRelX = normalize( ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
  vRelY = normalize( ( modelViewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vRelZ = normalize( ( modelViewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEAD}\n${pat.glsl}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  // Độ cao, mặt nạ, và độ dốc (sai phân theo ba trục của vật, đổi sang toạ độ camera) để nắn pháp tuyến. Ở xa thì
  // tắt dần (nổi gân vài mm nhìn từ xa chỉ thành nhiễu hạt) và thôi tính độ dốc.
  float relH = 0.0;
  float relM = 0.0;
  vec3 relG = vec3( 0.0 );
  float relFade = 1.0 - smoothstep( 4.0, 18.0, length( vViewPosition ) );
  if ( uRelOn > 0.5 ) {
    vec2 relHM = relPat( vRelPos, vRelNrm );
    relH = relHM.x;
    relM = relHM.y;
    if ( relFade > 0.0 ) {
      relG = vec3(
        relPat( vRelPos + vec3( ${pat.step.toFixed(4)}, 0.0, 0.0 ), vRelNrm ).x - relH,
        relPat( vRelPos + vec3( 0.0, ${pat.step.toFixed(4)}, 0.0 ), vRelNrm ).x - relH,
        relPat( vRelPos + vec3( 0.0, 0.0, ${pat.step.toFixed(4)} ), vRelNrm ).x - relH
      ) / ${pat.step.toFixed(4)};
    }
  }
  ${surf.color}`,
      )
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n  ${surf.rough}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n  ${surf.metal}`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  if ( uRelOn > 0.5 ) {
    vec3 relGV = ( relG.x * vRelX + relG.y * vRelY + relG.z * vRelZ ) * uRelAmp * relFade;
    normal = normalize( normal - ( relGV - normal * dot( relGV, normal ) ) );
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|relief:${kind}`;
  m.needsUpdate = true;
  return m;
}
