import { Object3D, type Scene } from "three";

// Ma trận thế giới của cảnh, tính MỘT lần mỗi khung hình.
//
// Mặc định three.js gọi `scene.updateMatrixWorld()` ở đầu MỖI lượt vẽ: cảnh chính, bản đồ bóng, ảnh phản chiếu mặt
// nước, lớp súng trước mặt, ảnh môi trường... mỗi lượt lại duyệt hết cả cảnh (hàng nghìn vật, kể cả vật đang ẩn) và ghép
// lại ma trận của từng vật. Đó thuần là việc của CPU. Trận đấu tắt việc tự cập nhật đó (`scene.matrixWorldAutoUpdate =
// false`) và gọi `updateWorld` đúng một lần ngay trước khi vẽ (RenderDriver), có thêm hai lối tắt:
// - Nhánh đang ẩn thì bỏ qua cả nhánh (không vẽ thì không cần ma trận); hiện lại thì cả nhánh được tính lại.
// - Nhánh đã `freezeWorld` (công trình, cây, đá: không bao giờ di chuyển) thì không duyệt vào nữa.

const base = Object3D.prototype.updateMatrixWorld;
/** Nhánh bị bỏ qua vì đang ẩn: lần tới hiện ra phải tính lại cả nhánh (cha có thể đã di chuyển). */
const skipped = new WeakSet<Object3D>();
/** Nhánh đứng yên vĩnh viễn: đã tính xong, không duyệt nữa. */
const frozen = new WeakSet<Object3D>();
const pending = new WeakSet<Object3D>();

/**
 * Đánh dấu cả nhánh `root` là đứng yên: lần `updateWorld` tới tính ma trận một lần cuối rồi thôi không duyệt vào nữa.
 * Trả hàm bỏ đánh dấu. Sau này cần dời vật trong nhánh thì gọi lại `freezeWorld(root)` (tính lại một lần).
 */
export function freezeWorld(root: Object3D): () => void {
  frozen.delete(root);
  pending.add(root);
  return () => {
    frozen.delete(root);
    pending.delete(root);
  };
}

function walk(o: Object3D, force: boolean) {
  if (!o.visible) {
    skipped.add(o);
    return;
  }
  if (skipped.delete(o)) force = true;
  if (frozen.has(o) && !force) return;
  // Lớp có cách cập nhật riêng (camera, đèn có đích, lưới có xương...): để nó tự làm cả nhánh của nó.
  if (o.updateMatrixWorld !== base) {
    o.updateMatrixWorld(force);
    return;
  }
  if (pending.delete(o)) {
    force = true;
    frozen.add(o);
  }
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = o.children;
  for (let i = 0, n = children.length; i < n; i++) walk(children[i]!, force);
}

/** Tính ma trận thế giới của cả cảnh (gọi một lần mỗi khung hình, ngay trước khi vẽ). */
export function updateWorld(scene: Scene) {
  walk(scene, false);
}
