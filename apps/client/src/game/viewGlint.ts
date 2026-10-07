import { Color, Vector4, type WebGLProgramParametersWithUniforms } from "three";

// Vệt sáng quét qua kim loại của súng trước mặt khi ngắm nghía (phím I): một nguồn sáng ảo trong toạ độ camera lướt
// từ trái sang phải, để lại điểm loá phản chiếu (specular) và viền sáng (rim) chạy dọc các mặt kim loại — khoe vân skin.
// Mọi vật liệu súng trước mặt (drawOnTop của GunModel và skinViewMaterial) dùng chung một uniform, tắt (w = 0) thì
// shader cộng 0, chẳng tốn gì đáng kể.

/** xyz: hướng nguồn sáng ảo (toạ độ camera, đã chuẩn hoá); w: độ sáng (0 là tắt). */
export const viewGlint = { value: new Vector4(0, 0.3, 1, 0) };
const glintColor = { value: new Color(1, 0.94, 0.84) };

const HEAD = /* glsl */ `
uniform vec4 uViewGlint;
uniform vec3 uViewGlintColor;
`;

const BODY = /* glsl */ `
  #ifdef STANDARD
  if ( uViewGlint.w > 0.001 ) {
    vec3 glV = normalize( vViewPosition );
    vec3 glN = normalize( normal );
    vec3 glR = reflect( -glV, glN );
    float glSpec = pow( max( dot( glR, uViewGlint.xyz ), 0.0 ), 40.0 );
    float glRim = pow( 1.0 - clamp( dot( glN, glV ), 0.0, 1.0 ), 3.0 ) * max( dot( glN, uViewGlint.xyz ), 0.0 );
    // Kim loại sáng rõ, nhựa, vải chỉ le lói.
    float glMetal = 0.15 + 0.85 * metalnessFactor;
    outgoingLight += uViewGlintColor * uViewGlint.w * glMetal * ( glSpec * 2.6 + glRim * 0.55 );
  }
  #endif
`;

/** Vá shader (gọi trong onBeforeCompile, sau các bản vá khác) để vật liệu nhận vệt sáng quét. */
export function injectGlint(shader: WebGLProgramParametersWithUniforms) {
  shader.uniforms.uViewGlint = viewGlint;
  shader.uniforms.uViewGlintColor = glintColor;
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${HEAD}`)
    .replace("#include <opaque_fragment>", `${BODY}\n#include <opaque_fragment>`);
}
