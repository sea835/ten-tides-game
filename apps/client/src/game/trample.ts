import { Vector4 } from "three";
import { Fn, float, length, max, min, select, smoothstep, uniformArray, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { V2, V4 } from "./gpu/slots.ts";

// Cỏ tương tác: tối đa 8 "vật giẫm" (mình, người gần nhất, xe) và 4 vụ nổ gần đây truyền vào shader thảm cỏ (Grass.tsx)
// và bụi cỏ lay gió (swayMaterial trong nature.ts). Lá cỏ trong bán kính dạt ra hai bên, rạp xuống, rồi tự đứng lên khi
// vật đi qua (vết chân của mình để lại vài điểm mờ dần nên cỏ hồi từ từ chứ không bật thẳng ngay). Vụ nổ đẩy một vòng
// xung kích lan ra (~8 m) làm rạp cỏ trong chốc lát. Atmosphere.tsx ghi các mảng này mỗi khung hình.

export const TRAMPLERS = 8;
export const TRAMPLE_BLASTS = 4;

// Mảng Vector4 giữ nguyên cấu trúc `{ value }` như bản cũ (Atmosphere.tsx ghi `.value[i].set(...)` mỗi khung hình);
// node uniformArray bên dưới đọc lại đúng các Vector4 này mỗi lần vẽ.
const tramplers = Array.from({ length: TRAMPLERS }, () => new Vector4());
const blasts = Array.from({ length: TRAMPLE_BLASTS }, () => new Vector4());

export const trampleUniforms = {
  /** x, z, bán kính (m), độ mạnh (0–1). Bán kính 0 là ô trống. */
  uTramplers: { value: tramplers },
  /** x, z, tuổi (giây), bán kính (m). Bán kính 0 là ô trống. */
  uTrampleBlasts: { value: blasts },
};

const tramplerNode = uniformArray(tramplers, "vec4");
const blastNode = uniformArray(blasts, "vec4");

/**
 * `tenTrample(xz)`: xy là hướng dạt (độ dài 0–1), z là mức rạp xuống (0–1). Vòng lặp trải ra lúc dựng shader
 * (8 + 4 lần, rẻ) để khỏi phụ thuộc cách nền WebGPU/WebGL xử lý chỉ số động; ô trống (bán kính 0) cho trọng số 0.
 */
export const tenTrample = Fn(([xz]: [V2]) => {
  let push: V2 = vec2(0, 0);
  let press: Node<"float"> = float(0);
  for (let i = 0; i < TRAMPLERS; i++) {
    const t = tramplerNode.element(i) as unknown as V4;
    const d = xz.sub(t.xy);
    const dist = length(d);
    const w = select(t.z.greaterThan(0), t.w.mul(smoothstep(t.z.mul(0.3), t.z, dist).oneMinus()), float(0));
    push = push.add(d.div(max(dist, 0.05)).mul(w));
    press = max(press, w);
  }
  for (let i = 0; i < TRAMPLE_BLASTS; i++) {
    const b = blastNode.element(i) as unknown as V4;
    const d = xz.sub(b.xy);
    const dist = length(d);
    // Mặt sóng lan ra ~26 m/s: chỗ sóng đã quét qua thì rạp hẳn, rồi đứng dậy dần trong ~1,5 giây.
    const front = b.z.mul(26);
    const hit = smoothstep(front.sub(1.5), front, dist).oneMinus().mul(smoothstep(b.w.mul(0.55), b.w, dist).oneMinus());
    const w = select(b.w.greaterThan(0), hit.mul(smoothstep(0.3, 1.6, b.z).oneMinus()), float(0));
    push = push.add(d.div(max(dist, 0.05)).mul(w).mul(1.4));
    press = max(press, w);
  }
  const len = length(push);
  const dir = select(len.greaterThan(1), push.div(len), push);
  return vec3(dir, min(press, 1));
});
