import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, ShaderChunk, UnsignedByteType, Vector2 } from "three";
import { WATER_LEVEL } from "@tentides/content";
import { fbm } from "./textures.ts";

// Khí quyển dùng chung cho mọi vật liệu: sương mù bám theo độ cao (dày ở thung lũng, trên mặt biển, mỏng dần khi lên
// cao) và bóng mây trôi trên mặt đất.
//
// Sương mù độ cao: thay mẩu shader `fog_*` của three.js (mọi vật liệu có `fog: true` đều nhận, kể cả shader tự viết
// như mặt nước, khói, máu) nên không phải vá từng vật liệu. Không thêm uniform mới (vật liệu dựng sẵn không có chỗ
// gắn): độ dày suy ra từ `fogNear` mà DayCycle đã chỉnh theo thời tiết (sương, mưa thì `near` co lại), còn độ cao
// mặt nước và độ dốc giảm theo độ cao là hằng số. Phần sương tuyến tính cũ vẫn giữ nguyên ở `fogFar` (đúng 1 ở đó) để
// mặt phẳng xa của camera (`farForFog`) vẫn cắt đúng chỗ mọi vật đã chìm hẳn vào màu chân trời.

/** Sương dày nhất ở mặt nước, cứ lên cao chừng này mét thì loãng đi e lần. */
const FOG_FALLOFF = 0.085;

let installed = false;

/** Cài mẩu shader sương mù độ cao (gọi trước khi dựng shader đầu tiên; gọi lại thì bỏ qua). */
export function installHeightFog() {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogHeight;
#endif
`;
  // Độ cao thế giới của đỉnh suy từ toạ độ theo camera: phần quay của viewMatrix trực chuẩn nên nghịch đảo là chuyển
  // vị, thành phần y của nó là tích vô hướng với cột 1; cộng độ cao camera. Không cần modelMatrix nên dùng được cho cả
  // hạt khói, tấm billboard.
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogHeight = cameraPosition.y + dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );
#endif
`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogHeight;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // Độ cao của mắt và của điểm đang vẽ so với mặt nước (dưới nước coi như sát mặt nước).
    float fogHc = max( cameraPosition.y - ${WATER_LEVEL.toFixed(2)}, -1.0 );
    float fogHp = max( vFogHeight - ${WATER_LEVEL.toFixed(2)}, -1.0 );
    float fogDh = fogHp - fogHc;
    // Mật độ trung bình dọc tia nhìn với mật độ giảm theo luỹ thừa độ cao (tích phân đóng).
    float fogB = ${FOG_FALLOFF.toFixed(4)};
    float fogAvg = abs( fogDh ) > 0.05 ? ( exp( - fogB * fogHc ) - exp( - fogB * fogHp ) ) / ( fogB * fogDh ) : exp( - fogB * fogHc );
    // Trời sương, mưa (DayCycle kéo fogNear từ 70 m xuống còn 8 m) thì sương sát đất đặc hơn nhiều.
    float fogMurk = clamp( ( 70.0 - fogNear ) / 62.0, 0.0, 1.0 );
    float fogDensityH = 0.0045 + 0.03 * fogMurk;
    float fogLow = ( 1.0 - exp( - fogDensityH * vFogDepth * fogAvg ) ) * ( 0.72 + 0.2 * fogMurk );
    // Phần tuyến tính theo khoảng cách: tia nhìn lướt cao (đỉnh núi, tháp) thì mỏng hơn, sát mặt biển, đáy thung lũng
    // thì dày hơn; vẫn đúng 1 ở fogFar để vật ở xa chìm hẳn vào chân trời trước mặt phẳng xa của camera.
    float fogLin = smoothstep( fogNear, fogFar, vFogDepth );
    fogLin = pow( fogLin, mix( 0.85, 1.9, smoothstep( 3.0, 45.0, 0.5 * ( fogHc + fogHp ) ) ) );
    float fogFactor = 1.0 - ( 1.0 - fogLin ) * ( 1.0 - fogLow );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

// ---------------------------------------------------------------------------- bóng mây

/**
 * Bóng mây trôi trên mặt đất: một tấm nhiễu FBM lặp liền mép chiếu thẳng từ trên xuống, trôi theo cùng hướng với mây
 * vẽ trên vòm trời (Sky.tsx). CloudShadows (Weather) ghi mỗi khung hình; mọi vật liệu đã vá vân (textures.ts), thảm
 * cỏ và mặt nước đọc chung. Chỉ làm tối nắng trực tiếp (đèn mặt trời), ánh trời và đèn khác giữ nguyên.
 */
export const cloudUniforms = {
  uCloudMap: { value: null as DataTexture | null },
  /** Độ lệch của tấm mây (đơn vị toạ độ ảnh), trôi theo gió. */
  uCloudOffset: { value: new Vector2() },
  /** Ngưỡng phủ mây (thấp là kín trời) và độ tối của bóng (0 tắt). */
  uCloudCover: { value: 0.6 },
  uCloudShadow: { value: 0 },
};

const CLOUD_TEXELS = 128;
/** Một ô ảnh mây phủ chừng này mét (mảng mây cỡ vài chục tới trăm mét). */
export const CLOUD_TILE = 260;

/** Tấm nhiễu mây (sinh một lần). */
export function cloudTexture(): DataTexture {
  if (cloudUniforms.uCloudMap.value) return cloudUniforms.uCloudMap.value;
  const n = CLOUD_TEXELS;
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) data[y * n + x] = Math.round(Math.min(1, Math.max(0, fbm(x / n, y / n, 4, 4, 131))) * 255);
  }
  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cloudUniforms.uCloudMap.value = tex;
  return tex;
}

/** Khai báo và hàm tính độ sáng nắng dưới bóng mây (1 là nắng đủ) tại toạ độ thế giới xz. */
export const CLOUD_PARS_GLSL = /* glsl */ `
uniform sampler2D uCloudMap;
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform float uCloudShadow;
float tenCloudShade( vec2 xz ) {
  if ( uCloudShadow <= 0.0 ) return 1.0;
  vec2 cuv = xz * ${(1 / CLOUD_TILE).toFixed(6)} + uCloudOffset;
  float cn = texture2D( uCloudMap, cuv ).r * 0.68 + texture2D( uCloudMap, cuv * 2.37 + vec2( 0.31, 0.17 ) ).r * 0.32;
  return 1.0 - uCloudShadow * smoothstep( uCloudCover, uCloudCover + 0.16, cn );
}
`;

let litChunk: string | null = null;
/**
 * Mẩu `lights_fragment_begin` của three.js có thêm bóng mây trên đèn hướng (mặt trời, mặt trăng). `xz` là biểu thức
 * GLSL ra toạ độ thế giới của điểm đang tô.
 */
export function cloudLightsChunk(xz: string): string {
  litChunk ??= ShaderChunk.lights_fragment_begin.replace(
    "getDirectionalLightInfo( directionalLight, directLight );",
    "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= tenCloud;",
  );
  return `float tenCloud = tenCloudShade( ${xz} );\n${litChunk}`;
}

// ---------------------------------------------------------------------------- súng, găng tay ướt

/**
 * Độ ướt của súng và găng tay trước mặt (0–1): dầm mưa ngoài trời, hay vừa bơi, lặn lên (khô dần trong chừng nửa
 * phút). Atmosphere.tsx ghi; vật liệu súng trước mặt (drawOnTop của GunModel, skin trong skinMaterials) đọc.
 */
export const wetUniforms = { uViewWet: { value: 0 } };

/** Chèn sau `metalnessmap_fragment`: bề mặt ướt bóng loáng (độ nhám tụt về ~0.06), ánh kim nhẹ, màu sẫm đi. */
export const VIEW_WET_PARS_GLSL = "uniform float uViewWet;";
export const VIEW_WET_GLSL = /* glsl */ `
  roughnessFactor = mix( roughnessFactor, 0.06, uViewWet * 0.85 );
  metalnessFactor = min( 1.0, metalnessFactor + 0.08 * uViewWet );
  diffuseColor.rgb *= 1.0 - 0.14 * uViewWet;
`;
