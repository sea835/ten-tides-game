import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, ShaderChunk, UnsignedByteType, Vector2, type DirectionalLight, type Fog, type Scene } from "three";
import type { Node } from "three/webgpu";
import { Fn, cameraPosition, float, fog, mix, positionView, positionWorld, reference, select, smoothstep, texture, uniform, vec2 } from "three/tsl";
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

/** Việc cũ của bản WebGL (vá mẩu shader sương của three). Giờ sương là node của cảnh: xem `installAtmosphere`. */
export function installHeightFog() {}

/**
 * Hệ số sương (0 trong, 1 chìm hẳn vào màu sương) tại điểm đang tô, theo `scene.fog` (DayCycle chỉnh near, far, màu
 * mỗi khung hình). Vật liệu tự viết ánh sáng (mặt nước, hạt khói) có thể dùng lại.
 */
export function heightFogFactor(sceneFog: Fog): Node<"float"> {
  const near = reference("near", "float", sceneFog);
  const far = reference("far", "float", sceneFog);
  return Fn(() => {
    const depth = positionView.z.negate();
    // Độ cao của mắt và của điểm đang vẽ so với mặt nước (dưới nước coi như sát mặt nước).
    const hc = cameraPosition.y.sub(WATER_LEVEL).max(-1);
    const hp = positionWorld.y.sub(WATER_LEVEL).max(-1);
    const dh = hp.sub(hc);
    // Mật độ trung bình dọc tia nhìn với mật độ giảm theo luỹ thừa độ cao (tích phân đóng).
    const b = float(FOG_FALLOFF);
    const ec = b.mul(hc).negate().exp();
    const flat = dh.abs().lessThanEqual(0.05);
    const avg = select(flat, ec, ec.sub(b.mul(hp).negate().exp()).div(b.mul(select(flat, float(1), dh))));
    // Trời sương, mưa (DayCycle kéo fogNear từ 70 m xuống còn 8 m) thì sương sát đất đặc hơn nhiều.
    const murk = float(70).sub(near).div(62).clamp(0, 1);
    const density = murk.mul(0.03).add(0.0045);
    const low = density.mul(depth).mul(avg).negate().exp().oneMinus().mul(murk.mul(0.2).add(0.72));
    // Phần tuyến tính theo khoảng cách: tia nhìn lướt cao (đỉnh núi, tháp) thì mỏng hơn, sát mặt biển, đáy thung lũng
    // thì dày hơn; vẫn đúng 1 ở fogFar để vật ở xa chìm hẳn vào chân trời trước mặt phẳng xa của camera.
    const lin = smoothstep(near, far, depth).pow(mix(float(0.85), float(1.9), smoothstep(3, 45, hc.add(hp).mul(0.5))));
    return lin.oneMinus().mul(low.oneMinus()).oneMinus();
  })();
}

/**
 * Cài khí quyển cho một cảnh: sương bám độ cao cho MỌI vật liệu (node sương của cảnh, đọc near/far/màu từ
 * `scene.fog`). Gọi một lần sau khi cảnh có `fog` (kiểu Fog tuyến tính).
 */
export function installAtmosphere(scene: Scene) {
  const sceneFog = scene.fog as Fog | null;
  if (!sceneFog || (scene as { fogNode?: Node }).fogNode) return;
  cloudTexture();
  (scene as { fogNode?: Node }).fogNode = fog(reference("color", "color", sceneFog), heightFogFactor(sceneFog));
}

// ---------------------------------------------------------------------------- bóng mây

/**
 * Bóng mây trôi trên mặt đất: một tấm nhiễu FBM lặp liền mép chiếu thẳng từ trên xuống, trôi theo cùng hướng với mây
 * vẽ trên vòm trời (Sky.tsx). CloudShadows (Weather) ghi mỗi khung hình; mọi vật liệu đã vá vân (textures.ts), thảm
 * cỏ và mặt nước đọc chung. Chỉ làm tối nắng trực tiếp (đèn mặt trời), ánh trời và đèn khác giữ nguyên.
 */
const cloudMapNode = texture(new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType));
export const cloudUniforms = {
  /** Node ảnh mây (`.value` là tấm ảnh, có sau lần gọi cloudTexture() đầu tiên). */
  uCloudMap: cloudMapNode,
  /** Độ lệch của tấm mây (đơn vị toạ độ ảnh), trôi theo gió. */
  uCloudOffset: uniform(new Vector2()),
  /** Ngưỡng phủ mây (thấp là kín trời) và độ tối của bóng (0 tắt). */
  uCloudCover: uniform(0.6),
  uCloudShadow: uniform(0),
};

const CLOUD_TEXELS = 128;
/** Một ô ảnh mây phủ chừng này mét (mảng mây cỡ vài chục tới trăm mét). */
export const CLOUD_TILE = 260;

/** Tấm nhiễu mây (sinh một lần). */
let cloudTex: DataTexture | null = null;
export function cloudTexture(): DataTexture {
  if (cloudTex) return cloudTex;
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
  cloudTex = tex;
  cloudMapNode.value = tex;
  return tex;
}

/** Độ sáng nắng dưới bóng mây (1 là nắng đủ) tại toạ độ thế giới `xz`. Gọi `cloudTexture()` trước lần vẽ đầu. */
export const cloudShade = Fn(([xz]: [Node<"vec2">]) => {
  const { uCloudOffset, uCloudCover, uCloudShadow } = cloudUniforms;
  const cuv = xz.mul(1 / CLOUD_TILE).add(uCloudOffset);
  const cn = texture(cloudMapNode.value, cuv).r.mul(0.68).add(texture(cloudMapNode.value, cuv.mul(2.37).add(vec2(0.31, 0.17))).r.mul(0.32));
  return uCloudShadow.mul(smoothstep(uCloudCover, uCloudCover.add(0.16), cn)).oneMinus();
});

/**
 * Cho đèn hướng (mặt trời, mặt trăng) bị bóng mây che: màu đèn tại mỗi điểm nhân với độ sáng dưới mây. Áp cho mọi
 * vật liệu nhận ánh sáng của đèn này, khỏi vá từng vật liệu. Gọi một lần lúc tạo đèn.
 */
export function shadeLightWithClouds(light: DirectionalLight) {
  cloudTexture();
  const lit = new Color();
  const color = uniform(lit).onRenderUpdate(() => lit.copy(light.color).multiplyScalar(light.intensity));
  (light as { colorNode?: Node }).colorNode = color.mul(cloudShade(positionWorld.xz));
}

/** @deprecated GLSL của bản WebGL, chỉ còn để các file chưa chuyển sang TSL nạp được. Dùng `cloudShade`. */
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
let litFrom: string | null = null;
/**
 * Mẩu `lights_fragment_begin` của three.js có thêm bóng mây trên đèn hướng (mặt trời, mặt trăng). `xz` là biểu thức
 * GLSL ra toạ độ thế giới của điểm đang tô. Dựng lại nếu mẩu gốc đã bị vá sau đó (bóng tĩnh cài lúc vào trận).
 */
export function cloudLightsChunk(xz: string): string {
  if (litFrom !== ShaderChunk.lights_fragment_begin) litChunk = null;
  litFrom = ShaderChunk.lights_fragment_begin;
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
export const wetUniforms = { uViewWet: uniform(0) };

/** Chèn sau `metalnessmap_fragment`: bề mặt ướt bóng loáng (độ nhám tụt về ~0.06), ánh kim nhẹ, màu sẫm đi. */
export const VIEW_WET_PARS_GLSL = "uniform float uViewWet;";
export const VIEW_WET_GLSL = /* glsl */ `
  roughnessFactor = mix( roughnessFactor, 0.06, uViewWet * 0.85 );
  metalnessFactor = min( 1.0, metalnessFactor + 0.08 * uViewWet );
  diffuseColor.rgb *= 1.0 - 0.14 * uViewWet;
`;
