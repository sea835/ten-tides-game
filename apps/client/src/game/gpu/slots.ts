import type { Material } from "three";
import type { Node } from "three/webgpu";

// Chỗ gắn node TSL trên vật liệu. Game vẫn dùng các lớp vật liệu chuẩn của three (MeshStandardMaterial,
// MeshBasicMaterial...): WebGPURenderer tự chuyển chúng thành vật liệu node lúc dựng shader và CHÉP MỌI thuộc tính
// sang, kể cả các ô node dưới đây. Nên muốn sửa shader của một vật liệu chuẩn (việc trước đây làm bằng
// onBeforeCompile) thì gán node vào ô tương ứng qua `slots(material)`.
//
// Quy ước:
// - KHÔNG BAO GIỜ gán `undefined` hay `null` vào ô (three kiểm tra `!== null`, gặp undefined là lỗi dựng shader):
//   dùng `setSlot(material, "colorNode", null)` để xoá.
// - Nhiều bản vá cùng sửa một ô thì bọc lên nhau: đọc ô hiện có (hoặc giá trị mặc định của three, vd. `materialColor`)
//   rồi gán node mới tính từ nó. Xem `wrapSlot`.
// - Gán xong mà vật liệu đã từng được vẽ thì đặt `material.needsUpdate = true` để dựng lại shader.

/** Kiểu node TSL hay dùng (kiểu của three phân biệt theo kiểu dữ liệu shader). */
export type F = Node<"float">;
export type V2 = Node<"vec2">;
export type V3 = Node<"vec3">;
export type V4 = Node<"vec4">;

/**
 * Ô lưu node không ghi kiểu dữ liệu (một ô màu có thể là vec3 hay vec4): lúc đọc ra để tính tiếp thì ép kiểu, vd.
 * `vec4((slots(m).colorNode ?? materialColor) as V3)`.
 */
export interface NodeSlots {
  /** Màu nền (trước khi nhân màu đỉnh, màu instance). Mặc định `materialColor`. */
  colorNode?: Node;
  /** Pháp tuyến trong hệ camera (view space). Mặc định `materialNormal`. */
  normalNode?: Node;
  roughnessNode?: Node;
  metalnessNode?: Node;
  emissiveNode?: Node;
  opacityNode?: Node;
  /** Vị trí đỉnh trong hệ của vật (three áp ma trận instance TRƯỚC ô này: độ lệch tính trong hệ hình học phải tự đổi qua ma trận instance, xem swayMaterial ở nature.ts). Mặc định `positionLocal`. */
  positionNode?: Node;
  /** false thì bỏ điểm ảnh (discard). */
  maskNode?: Node;
  alphaTestNode?: Node;
  castShadowNode?: Node;
  receivedShadowNode?: Node;
  /** Màu cuối cùng sau ánh sáng (trước sương mù, tone map). */
  outputNode?: Node;
  envNode?: Node;
  aoNode?: Node;
}

export type SlotName = keyof NodeSlots;

/** Các ô node của một vật liệu (vật liệu chuẩn lẫn vật liệu node). */
export function slots(material: Material): NodeSlots {
  return material as unknown as NodeSlots;
}

/** Gán (hoặc xoá, khi `node` là null) một ô node. */
export function setSlot(material: Material, name: SlotName, node: Node | null) {
  const s = material as unknown as Record<string, unknown>;
  if (node) s[name] = node;
  else if ((material as { isNodeMaterial?: boolean }).isNodeMaterial) s[name] = null;
  else delete s[name];
}

/** Bọc một ô: `fn` nhận node hiện có (hoặc `fallback` nếu ô trống) và trả node mới. */
export function wrapSlot(material: Material, name: SlotName, fallback: Node, fn: (current: Node) => Node) {
  const s = slots(material);
  s[name] = fn(s[name] ?? fallback);
}
