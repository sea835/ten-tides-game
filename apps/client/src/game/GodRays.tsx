import { Color, Vector2, Vector3, type Camera } from "three";
import type { TextureNode } from "three/webgpu";
import { Fn, If, Loop, clamp, dot, exp, float, fract, length, screenCoordinate, screenSize, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { localEnv, sky, weatherFx } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";
import type { V2, V3, V4 } from "./gpu/slots.ts";

// Tia nắng xuyên qua tán dừa, vách núi, cửa sổ (god rays) kiểu màn hình: từ mỗi điểm ảnh lấy mẫu dọc đường thẳng về
// phía mặt trời trên màn hình, cộng những mẫu là bầu trời sáng (độ sâu ở mặt phẳng xa) — chỗ bị cây, nhà che thì
// không có, nên thành các luồng sáng tối xen kẽ toả ra từ mặt trời. Chỉ bật khi mặt trời ở trong (hoặc sát) khung
// hình và nắng chiếu thấp (bình minh, chiều tà); trưa nắng, đêm, trời kín mây, dưới nước thì tắt (độ mạnh về 0, cả
// vòng lấy mẫu bị bỏ qua, gần như không tốn gì). Nằm trong chuỗi hậu kỳ trước Bloom (đồ hoạ thấp không có hậu kỳ nên
// không có tia). Là node TSL tự viết: three không có sẵn node tương đương (GodraysNode của three là tia thể tích theo
// bản đồ bóng, khác hẳn).

const sunPoint = new Vector3();
const forward = new Vector3();
const WARM = new Color("#ffb46a");

function smoothstepJs(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface GodRays {
  /** Cộng tia nắng vào ảnh cảnh `input` (tuyến tính, HDR). `color`: ảnh cảnh; `depth`: độ sâu của cùng lượt vẽ. */
  apply: (input: V4, color: TextureNode, depth: TextureNode) => V4;
  /** Gọi mỗi khung hình trước khi vẽ: đặt vị trí mặt trời trên màn hình và độ mạnh theo trời, thời tiết, chỗ đứng. */
  update: (camera: Camera) => void;
}

/** `samples`: mức Cao lấy nhiều mẫu hơn cho tia mịn; Trung bình ít mẫu (tia hơi lấm tấm nhưng nhẹ). */
export function createGodRays(samples: number): GodRays {
  const uSun = uniform(new Vector2(0.5, 0.5));
  const uStrength = uniform(0);
  const uRayColor = uniform(new Color());

  const apply = (input: V4, color: TextureNode, depth: TextureNode): V4 =>
    Fn(() => {
      const out = vec4(input).toVar();
      If(uStrength.greaterThan(0), () => {
        const coord = uv();
        // Bước về phía mặt trời (tối đa 85% quãng đường), lệch đầu tia ngẫu nhiên theo điểm ảnh để khỏi thấy vân bậc.
        const delta = (uSun as unknown as V2).sub(coord).mul(0.85 / samples);
        const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
        const p = coord.add(delta.mul(jitter)).toVar();
        const decay = float(1).toVar();
        const sum = float(0).toVar();
        Loop(samples, () => {
          const q = clamp(p, 0.001, 0.999);
          // Chỉ bầu trời (vòm trời vẽ ở đúng mặt phẳng xa) mới phát sáng; mây sẫm, cây, nhà chắn tia.
          const open = step(0.99995, depth.sample(q).r);
          const lum = dot(color.sample(q).rgb, vec3(0.2126, 0.7152, 0.0722));
          sum.addAssign(open.mul(smoothstep(0.35, 1.6, lum).add(0.25)).mul(decay));
          decay.mulAssign(0.955);
          p.addAssign(delta);
        });
        sum.divAssign(samples * 0.45);
        // Tia đậm gần mặt trời, nhạt dần ra xa (tính theo khung hình vuông cho khỏi méo theo tỉ lệ màn hình).
        const d = coord.sub(uSun as unknown as V2).mul(vec2(screenSize.x.div(screenSize.y), 1));
        const falloff = exp(length(d).mul(-1.6));
        out.addAssign(vec4((uRayColor as unknown as V3).mul(sum).mul(falloff).mul(uStrength), 0));
      });
      return out;
    })() as V4;

  const update = (camera: Camera) => {
    const dir = skyUniforms.uSunDir.value;
    camera.getWorldDirection(forward);
    const facing = forward.dot(dir);
    // Nắng thấp (bình minh, chiều tà) thì tia rõ, trưa vẫn còn chút; đêm (mặt trời đã lặn) thì tắt.
    const low = 1 - smoothstepJs(0.18, 0.62, dir.y);
    const day = (1 - sky.night) * smoothstepJs(0.0, 0.05, sky.elevation);
    const clear = 1 - smoothstepJs(0.55, 0.95, weatherFx.cloud) * 0.9 - weatherFx.fog * 0.6;
    let strength = facing > 0.05 ? day * (0.25 + 0.75 * low) * Math.max(0, clear) * (localEnv.underwater ? 0 : 1) * (1 - 0.6 * localEnv.indoor) : 0;
    if (strength > 0.001) {
      sunPoint.copy(camera.position).addScaledVector(dir, 100).project(camera);
      const x = sunPoint.x * 0.5 + 0.5;
      const y = sunPoint.y * 0.5 + 0.5;
      // Mặt trời ra ngoài mép khung hình thì tia tắt dần (tâm tia ra quá xa thì vân tia lộ ra).
      const out = Math.max(Math.max(-x, x - 1), Math.max(-y, y - 1));
      strength *= 1 - smoothstepJs(0, 0.35, out);
      uSun.value.set(x, y);
    }
    uStrength.value = strength * 0.55;
    uRayColor.value.copy(skyUniforms.uSunColor.value).lerp(WARM, low * 0.5);
  };

  return { apply, update };
}
