import { AgXToneMapping, NoToneMapping, SRGBColorSpace, type Camera, type Scene } from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { clamp, distance, mix, pass, renderOutput, sRGBTransferEOTF, sRGBTransferOETF, toneMapping, uv, vec2, vec3, vec4 } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { V3, V4 } from "./gpu/slots.ts";
import { createGodRays } from "./GodRays.tsx";
import type { ViewLayer } from "./battle/ViewModel.tsx";
import { barrelFxScene } from "./battle/BarrelFx.tsx";
import type { PrepTarget } from "./shaderPrep.ts";

// Chuỗi hậu kỳ của cảnh, dựng bằng RenderPipeline của three (node TSL, chạy cả WebGPU lẫn WebGL 2):
//   cảnh (tuyến tính, HDR) → bóng tối ở khe, góc, chân cây (AO, chỉ mức Cao) → tia nắng xuyên cây, nhà (GodRays.tsx)
//   → Bloom (lửa, dung nham, nắng loá toả quầng) → tone map kiểu phim AgX (màu tự nhiên, không cháy sáng)
//   → chỉnh màu nhẹ (bão hoà, tương phản) → góc màn hình tối nhẹ → súng trước mặt (tone map riêng, không dính hậu kỳ)
//   → đổi sang sRGB → khử răng cưa SMAA (cần ảnh đã ở sRGB, nên đứng cuối).
// Không dùng tone map + sRGB tự động của pipeline (`outputColorTransform = false`): ta cần chấm màu SAU tone map và
// khử răng cưa SAU đổi màu, như chuỗi cũ.

export interface PostFx {
  /** Vẽ cả khung hình (cảnh, hậu kỳ, súng trước mặt) ra màn hình. */
  render: () => void;
  /** Các đích vẽ thật của chuỗi, để dịch sẵn shader đúng đích (shaderPrep.ts). */
  targets: PrepTarget[];
  dispose: () => void;
}

/** Bão hoà +0.22 kiểu HueSaturation của postprocessing: đẩy màu ra xa mức xám trung bình (hệ số 1.28). */
const SATURATION = 1.28;
/** Tương phản +0.14 kiểu BrightnessContrast: giãn quanh 0.5. */
const CONTRAST = 0.14;
/** Góc tối: offset 0.3, darkness 0.5 (kiểu Vignette mặc định của postprocessing). */
const VIGNETTE_OFFSET = 0.3;
const VIGNETTE_DARKNESS = 0.5;

function grade(rgb: V3): V3 {
  const avg = rgb.x.add(rgb.y).add(rgb.z).div(3);
  const saturated = mix(vec3(avg, avg, avg), rgb, SATURATION) as V3;
  // BrightnessContrast của postprocessing làm việc trên màu ĐÃ mã hoá sRGB (inputColorSpace = sRGB), các hiệu ứng còn lại
  // trên màu tuyến tính. Giãn tương phản thẳng trên số tuyến tính thì vùng tối bị ép về âm, cảnh chiều tối ngả đỏ sẫm.
  const encoded = sRGBTransferOETF(saturated.max(0)) as V3;
  const contrasted = sRGBTransferEOTF(encoded.sub(0.5).div(1 - CONTRAST).add(0.5).max(0)) as V3;
  // smoothstep(0.8, offset * 0.799, d * (darkness + offset)): cạnh ngược nên tự viết (smoothstep của GPU chỉ định nghĩa khi cạnh dưới < cạnh trên).
  const x = distance(uv(), vec2(0.5, 0.5)).mul(VIGNETTE_DARKNESS + VIGNETTE_OFFSET);
  const t = clamp(x.sub(0.8).div(VIGNETTE_OFFSET * 0.799 - 0.8), 0, 1);
  const vignette = t.mul(t).mul(t.mul(-2).add(3));
  return contrasted.mul(vignette) as V3;
}

/**
 * `full`: có AO (mức Cao); `view`: lớp súng trước mặt (chỉ trong trận). AO tính ở nửa độ phân giải, đọc độ sâu của
 * cảnh và tự dựng lại pháp tuyến từ độ sâu (khỏi vẽ thêm bản đồ pháp tuyến).
 */
export function createPostFx(renderer: WebGPURenderer, scene: Scene, camera: Camera, full: boolean, view: ViewLayer | null): PostFx {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode();
  const sceneDepth = scenePass.getTextureNode("depth");
  // Khí nóng đầu nòng (BarrelFx) khúc xạ ảnh của lượt vẽ cảnh.
  barrelFxScene.texture = scenePass.getTexture("output");

  let color = sceneColor as unknown as V4;
  const aoPass = full ? ao(sceneDepth, null as never, camera) : null;
  if (aoPass) {
    // Tương đương N8AO cũ: bán kính 1.6, nửa độ phân giải, cường độ vừa phải (GTAO nâng độ che sáng lên luỹ thừa `scale`).
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.6;
    aoPass.distanceFallOff.value = 1;
    aoPass.scale.value = 1.6;
    aoPass.samples.value = 12;
    color = vec4(color.rgb.mul(aoPass.getTextureNode().r), color.a) as V4;
  }

  // Mức Cao lấy nhiều mẫu hơn cho tia mịn; Trung bình ít mẫu (tia hơi lấm tấm nhưng nhẹ).
  const rays = createGodRays(full ? 32 : 20);
  color = rays.apply(color, sceneColor, sceneDepth);

  // Ngưỡng 1: chỉ chỗ sáng hơn trắng (lửa, dung nham, mặt trời loá) mới toả quầng.
  const glow = bloom(color, 0.7, 0.75, 1);
  glow.smoothWidth.value = 0.2;
  const hdr = color.add(glow) as V4;

  const mapped = toneMapping(AgXToneMapping, 1, hdr.rgb) as V3;
  let graded = grade(mapped);
  if (view) graded = view.composite(graded);

  const smaaPass = smaa(renderOutput(vec4(graded, 1), NoToneMapping, SRGBColorSpace));
  const pipeline = new RenderPipeline(renderer, smaaPass);
  pipeline.outputColorTransform = false;

  const targets: PrepTarget[] = [{ target: scenePass.renderTarget }];
  if (view) targets.push({ target: view.target, camera: view.camera });

  return {
    render: () => {
      rays.update(camera);
      pipeline.render();
    },
    targets,
    dispose: () => {
      pipeline.dispose();
      smaaPass.dispose();
      glow.dispose();
      aoPass?.dispose();
      scenePass.dispose();
      barrelFxScene.texture = null;
      view?.dispose();
    },
  };
}
