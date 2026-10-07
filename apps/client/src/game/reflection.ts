import type { Object3D } from "three";

/**
 * Vật không vẽ vào ảnh phản chiếu của mặt nước (Water.tsx): chính mặt nước, vòm trời (bầu trời phản chiếu đã tính sẵn
 * trong shader nước), thảm cỏ (hàng trăm nghìn lá, nặng mà phản chiếu gần như không thấy). Ẩn tạm trong lượt vẽ đó.
 */
export const reflectionHidden = new Set<Object3D>();
