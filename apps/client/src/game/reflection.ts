import { Object3D, type LightShadow, type Light as BaseLight, type Scene } from "three";

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
  renderer: { getClearAlpha(): number; setClearAlpha(a: number): void };
}

/**
 * Phản chiếu phẳng cho mặt nước (đồ hoạ Cao), dựng trên nút `reflector()` của TSL: camera soi gương qua mặt phẳng nước,
 * mặt phẳng gần xiên theo mặt nước (cắt phần dưới nước, đúng cho cả hệ toạ độ WebGPU lẫn WebGL 2), vẽ cảnh vào
 * `RenderTarget` nửa độ phân giải. Bọc thêm các việc riêng của game: ẩn vật `reflectionHidden`, bỏ nền (chỗ trống giữ
 * alpha 0 để shader nước giữ bầu trời tính sẵn), không vẽ lại bản đồ bóng (đèn đứng yên; cờ nằm trên `light.shadow`).
 * `target` phải nằm trong cảnh (con của lưới nước): nó cho vị trí và pháp tuyến mặt phẳng gương.
 */
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
  base.updateBefore = (frame: ReflectorFrame) => {
    if (!state.active) return;
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
    try {
      original(frame);
    } finally {
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
