import { Object3D, type Camera, type LightShadow, type Light as BaseLight, type PerspectiveCamera, type Scene } from "three";

type Light = BaseLight & { shadow?: LightShadow };
import { reflector } from "three/tsl";

/**
 * Vật không vẽ vào ảnh phản chiếu của mặt nước (Water.tsx): chính mặt nước, vòm trời (bầu trời phản chiếu đã tính sẵn
 * trong shader nước), thảm cỏ (hàng trăm nghìn lá, nặng mà phản chiếu gần như không thấy). Ẩn tạm trong lượt vẽ đó.
 */
export const reflectionHidden = new Set<Object3D>();

/** Phần của khung hình mà nút phản chiếu (ReflectorBaseNode) của three đọc: đủ cho chỗ ta cần. */
interface ReflectorFrame {
  scene: Scene;
  camera?: Camera;
  renderer: { getClearAlpha(): number; setClearAlpha(a: number): void };
}

/**
 * Phản chiếu phẳng cho mặt nước (đồ hoạ Cao), dựng trên nút `reflector()` của TSL: camera soi gương qua mặt phẳng nước,
 * mặt phẳng gần xiên theo mặt nước (cắt phần dưới nước, đúng cho cả hệ toạ độ WebGPU lẫn WebGL 2), vẽ cảnh vào
 * `RenderTarget` nửa độ phân giải. Bọc thêm các việc riêng của game: ẩn vật `reflectionHidden`, bỏ nền (chỗ trống giữ
 * alpha 0 để shader nước giữ bầu trời tính sẵn), không vẽ lại bản đồ bóng (đèn đứng yên; cờ nằm trên `light.shadow`).
 * `target` phải nằm trong cảnh (con của lưới nước): nó cho vị trí và pháp tuyến mặt phẳng gương.
 */
/** Tầm xa của ảnh phản chiếu (mét), như bản WebGL cũ. */
const REFLECT_FAR = 150;

export function createReflection(resolutionScale: number) {
  const target = new Object3D();
  // Mặt phẳng gương = trục z cục bộ của target; xoay -90° quanh x để nó hướng lên. Hạ thấp chút để chân người lội
  // nước không bị cắt cụt.
  target.rotation.x = -Math.PI / 2;
  target.position.y = -0.05;
  const node = reflector({ target, resolutionScale, bounces: false });
  const base = node.reflector as unknown as { updateBefore(frame: ReflectorFrame): unknown };
  const original = base.updateBefore.bind(base);
  /** Bật khi camera ở trên mặt nước và không quá cao (Water.tsx đặt mỗi khung hình). */
  const state = { active: false };
  let lights: Light[] = [];
  let age = 1e9;
  let turn = 0;
  base.updateBefore = (frame: ReflectorFrame) => {
    if (!state.active) return;
    // Ảnh phản chiếu là một lượt vẽ lại cả cảnh (CPU duyệt và gửi lệnh vẽ thêm lần nữa): vẽ cách khung, khung giữa dùng
    // lại ảnh cũ. Mặt nước gợn sóng làm méo ảnh nên chậm một khung hình không nhận ra.
    if (turn++ & 1) return;
    const { scene, renderer } = frame;
    // Danh sách đèn có bóng: quét lại cảnh thi thoảng thôi (đèn hiếm khi thêm bớt).
    if (age++ > 120) {
      age = 0;
      lights = [];
      scene.traverse((o) => {
        const l = o as Light;
        if (l.isLight && l.shadow) lights.push(l);
      });
    }
    const hidden: boolean[] = [];
    let i = 0;
    for (const o of reflectionHidden) {
      hidden[i++] = o.visible;
      o.visible = false;
    }
    const shadow = lights.map((l) => [l.shadow!.autoUpdate, l.shadow!.needsUpdate] as const);
    for (const l of lights) {
      l.shadow!.autoUpdate = false;
      l.shadow!.needsUpdate = false;
    }
    const background = scene.background;
    scene.background = null;
    const alpha = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    // Chỉ soi vật trong tầm REFLECT_FAR (reflector() chép ma trận chiếu của camera chính, nên thu tầm xa của nó trong lúc
    // vẽ): vật xa hơn trên mặt nước chỉ còn vài điểm ảnh mà vẫn tốn lệnh vẽ.
    const camera = (frame.camera as PerspectiveCamera | undefined)?.isPerspectiveCamera ? (frame.camera as PerspectiveCamera) : null;
    const far = camera ? camera.far : 0;
    if (camera && far > REFLECT_FAR) {
      camera.far = REFLECT_FAR;
      camera.updateProjectionMatrix();
    }
    try {
      original(frame);
    } finally {
      if (camera && far > REFLECT_FAR) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      renderer.setClearAlpha(alpha);
      scene.background = background;
      lights.forEach((l, k) => {
        l.shadow!.autoUpdate = shadow[k]![0];
        l.shadow!.needsUpdate = shadow[k]![1];
      });
      i = 0;
      for (const o of reflectionHidden) o.visible = hidden[i++]!;
    }
  };
  return { node, target, state, dispose: () => node.dispose() };
}

export type WaterReflection = ReturnType<typeof createReflection>;
