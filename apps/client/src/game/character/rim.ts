import type { MeshStandardMaterial } from "three";
import { clamp, float, materialEmissive, normalView, positionView, uniform, vec3 } from "three/tsl";
import { slots, type V3 } from "../gpu/slots.ts";

// Viền sáng quanh dáng người (rim light): mép thân, vai, đầu hắt sáng nhẹ theo góc nhìn, để người đứng trước bãi cỏ,
// bức tường cùng tông vẫn tách khỏi nền. Người chơi báo khó nhìn thấy người khác quanh bản đồ (quần áo rằn ri
// chìm hẳn vào cỏ, bóng râm). Đủ nhẹ để không thành "phát sáng"; sợi ghillie không dùng (ngụy trang là để khó thấy).

/** Độ mạnh viền chung, có thể chỉnh lúc chạy (vd. ban đêm giảm đi). */
export const rimLight = { value: 0.22 };
// Node uniform chung cho mọi vật liệu: cập nhật mỗi khung hình từ rimLight (nơi khác vẫn ghi `rimLight.value`).
const rimStrength = uniform(rimLight.value).onFrameUpdate(function () {
  this.value = rimLight.value;
});
const RIM_COLOR = vec3(0.62, 0.66, 0.72);

/** Gắn viền sáng vào vật liệu (gọi một lần lúc tạo, trước các bản vá khác như vân chi tiết). */
export function withRim<M extends MeshStandardMaterial>(m: M, strength = 1): M {
  if (m.userData.rim) return m;
  m.userData.rim = strength;
  // Viền cộng vào emissive (sau emissive có sẵn). `normalView` ở giai đoạn ánh sáng là pháp tuyến đã qua bản vá khác.
  const rimF = clamp(normalView.dot(positionView.negate().normalize()), 0, 1).oneMinus();
  const rim: V3 = RIM_COLOR.mul(rimF.pow(3)).mul(rimStrength).mul(float(strength));
  const s = slots(m);
  s.emissiveNode = ((s.emissiveNode ?? materialEmissive) as V3).add(rim);
  m.needsUpdate = true;
  return m;
}
