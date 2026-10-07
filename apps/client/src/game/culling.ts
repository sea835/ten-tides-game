import type { Object3D } from "three";

// Cho một nhánh cảnh "ngủ" khi ở quá xa: ẩn đi VÀ thôi tính ma trận. three.js vẫn duyệt cả nhánh đang ẩn mỗi khung
// hình để cập nhật ma trận (updateMatrixWorld không xét `visible`), nên vài trăm món đồ ẩn ngoài tầm nhìn vẫn tốn
// hàng nghìn phép nhân ma trận mỗi khung. Nhánh đang ngủ thay updateMatrixWorld bằng hàm rỗng; thức dậy thì trả lại
// hàm gốc và đánh dấu cần tính lại để ma trận đúng ngay khung đó.

const noop = () => {};

export function setAwake(o: Object3D, awake: boolean) {
  const sleeping = Object.prototype.hasOwnProperty.call(o, "updateMatrixWorld");
  o.visible = awake;
  if (awake && sleeping) {
    delete (o as { updateMatrixWorld?: unknown }).updateMatrixWorld;
    o.matrixWorldNeedsUpdate = true;
  } else if (!awake && !sleeping) {
    o.updateMatrixWorld = noop;
  }
}

/** Bật tắt đổ bóng cho mọi khối trong nhánh (đồ nhỏ ở xa thì bóng không thấy được mà tốn gấp đôi lệnh vẽ). */
export function setCastShadow(o: Object3D, on: boolean) {
  o.traverse((c) => {
    if ((c as { isMesh?: boolean }).isMesh) c.castShadow = on;
  });
}
