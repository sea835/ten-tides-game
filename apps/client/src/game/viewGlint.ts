import { Color, Vector4, type MeshStandardMaterial } from "three";
import type { Node } from "three/webgpu";
import { clamp, dot, float, materialColor, materialEmissive, materialMetalness, materialRoughness, max, min, mix, normalView, positionView, pow, reflect, uniform, vec4 } from "three/tsl";
import { slots, type F, type V3, type V4 } from "./gpu/slots.ts";
import { wetUniforms } from "./atmosphere.ts";
import { drawOnTopClip } from "./battle/ViewModel.tsx";

// Vệt sáng quét qua kim loại của súng trước mặt khi ngắm nghía (phím I): một nguồn sáng ảo trong toạ độ camera lướt
// từ trái sang phải, để lại điểm loá phản chiếu (specular) và viền sáng (rim) chạy dọc các mặt kim loại — khoe vân skin.
// Mọi vật liệu súng trước mặt (drawOnTop của GunModel và skinViewMaterial) dùng chung một uniform, tắt (w = 0) thì
// shader cộng 0, chẳng tốn gì đáng kể.

/** xyz: hướng nguồn sáng ảo (toạ độ camera, đã chuẩn hoá); w: độ sáng (0 là tắt). */
export const viewGlint = { value: new Vector4(0, 0.3, 1, 0) };
const glintColor = { value: new Color(1, 0.94, 0.84) };

const glintNode = uniform(viewGlint.value);
const glintColorNode = uniform(glintColor.value);

/**
 * Cho vật liệu nhận vệt sáng quét (gọi sau các bản vá khác, nhất là bản vá độ kim loại): cộng vào emissive, cùng chỗ
 * với cộng vào ánh sáng ra của bản WebGL cũ. w = 0 thì cộng 0.
 */
export function applyGlint<M extends MeshStandardMaterial>(m: M): M {
  const s = slots(m);
  const v = positionView.negate().normalize();
  const n = normalView.normalize();
  const spec = pow(max(dot(reflect(v.negate(), n), glintNode.xyz), 0), 40);
  const rim = pow(clamp(dot(n, v), 0, 1).oneMinus(), 3).mul(max(dot(n, glintNode.xyz), 0));
  // Kim loại sáng rõ, nhựa, vải chỉ le lói.
  const metal = float(0.15).add(((s.metalnessNode ?? materialMetalness) as F).mul(0.85));
  const add: V3 = glintColorNode.mul(glintNode.w).mul(metal).mul(spec.mul(2.6).add(rim.mul(0.55)));
  s.emissiveNode = ((s.emissiveNode ?? materialEmissive) as V3).add(add);
  return m;
}

/**
 * Súng, găng tay trước mặt ướt (dầm mưa, vừa bơi lên: atmosphere.ts): bề mặt bóng loáng (độ nhám tụt về ~0.06), ánh kim
 * nhẹ, màu sẫm đi. Gọi sau các bản vá màu, độ nhám của skin.
 */
export function applyViewWet<M extends MeshStandardMaterial>(m: M): M {
  const s = slots(m);
  const wet = wetUniforms.uViewWet;
  const c = vec4((s.colorNode ?? materialColor) as unknown as V4);
  s.colorNode = vec4(c.rgb.mul(wet.mul(0.14).oneMinus()), c.a);
  s.roughnessNode = mix((s.roughnessNode ?? materialRoughness) as F, float(0.06), wet.mul(0.85));
  s.metalnessNode = min(float(1), ((s.metalnessNode ?? materialMetalness) as F).add(wet.mul(0.08)));
  return m;
}

/**
 * Nén độ sâu về sát camera cho súng trước mặt (xem `drawOnTopClip`): súng luôn vẽ đè tường, cây, người đứng sát mà các
 * chi tiết của súng vẫn che nhau đúng thứ tự.
 */
export function applyDrawOnTop<M extends MeshStandardMaterial>(m: M): M {
  (m as unknown as { vertexNode: Node }).vertexNode = drawOnTopClip();
  return m;
}
