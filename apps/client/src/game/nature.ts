import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";

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

export const wind = { value: 0 };

/**
 * MeshStandardMaterial lay theo gió: đỉnh càng cao (theo y cục bộ) càng lắc nhiều.
 * `upNormals`: lá mỏng vẽ hai mặt thì giữ nguyên pháp tuyến hướng lên cho cả mặt sau
 * (mặc định three.js lật pháp tuyến mặt sau xuống đất, làm lá tối sẫm).
 */
export function swayMaterial(params: ConstructorParameters<typeof MeshStandardMaterial>[0], amount: number, from = 0, upNormals = false) {
  const m = new MeshStandardMaterial(params);
  // Mỗi bộ tham số là một shader riêng; không có khoá này three.js gộp chung theo mã nguồn hàm bên dưới.
  m.customProgramCacheKey = () => `sway:${amount}:${from}:${upNormals}`;
  m.onBeforeCompile = (shader) => {
    if (upNormals) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize( vNormal );");
    }
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        #else
          float phase = 0.0;
        #endif
        float k = max(0.0, position.y - ${from.toFixed(2)});
        float sway = k * k * ${amount.toFixed(3)};
        transformed.x += sin(uWind * 1.3 + phase) * sway;
        transformed.z += cos(uWind * 1.1 + phase * 1.7) * sway * 0.6;`,
      );
  };
  return m;
}

export function WindClock() {
  useFrame((_, dt) => {
    wind.value += dt;
  });
  return null;
}
