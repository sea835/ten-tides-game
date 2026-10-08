import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer } from "three";

// Viền sáng quanh dáng người (rim light): mép thân, vai, đầu hắt sáng nhẹ theo góc nhìn, để người đứng trước bãi cỏ,
// bức tường cùng tông vẫn tách khỏi nền. Người chơi báo khó nhìn thấy người khác quanh bản đồ (quần áo rằn ri
// chìm hẳn vào cỏ, bóng râm). Đủ nhẹ để không thành "phát sáng"; sợi ghillie không dùng (ngụy trang là để khó thấy).

/** Độ mạnh viền chung, có thể chỉnh lúc chạy (vd. ban đêm giảm đi). */
export const rimLight = { value: 0.22 };
const uniform = { value: rimLight.value };

type Compile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

/** Gắn viền sáng vào vật liệu (gọi một lần lúc tạo, trước các bản vá khác như vân chi tiết). */
export function withRim<M extends MeshStandardMaterial>(m: M, strength = 1): M {
  if (m.userData.rim) return m;
  m.userData.rim = strength;
  const prev: Compile | undefined = m.onBeforeCompile === Object.getPrototypeOf(m).onBeforeCompile ? undefined : m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey === Object.getPrototypeOf(m).customProgramCacheKey ? "" : m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uRim = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uRim;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.62, 0.66, 0.72) * pow(rimF, 3.0) * uRim * ${strength.toFixed(2)};
        }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|rim${strength}`;
  return m;
}

