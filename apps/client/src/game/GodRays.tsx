import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Uniform, Vector2, Vector3 } from "three";
import { localEnv, sky, weatherFx } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";

// Tia nắng xuyên qua tán dừa, vách núi, cửa sổ (god rays) kiểu màn hình: từ mỗi điểm ảnh lấy mẫu dọc đường thẳng về
// phía mặt trời trên màn hình, cộng những mẫu là bầu trời sáng (độ sâu ở mặt phẳng xa) — chỗ bị cây, nhà che thì
// không có, nên thành các luồng sáng tối xen kẽ toả ra từ mặt trời. Chỉ bật khi mặt trời ở trong (hoặc sát) khung
// hình và nắng chiếu thấp (bình minh, chiều tà); trưa nắng, đêm, trời kín mây, dưới nước thì tắt (nhánh đồng nhất,
// gần như không tốn gì). Nằm trong chuỗi hậu kỳ trước Bloom (đồ hoạ thấp không có hậu kỳ nên không có tia).

const fragment = /* glsl */ `
uniform vec2 uSun;
uniform float uStrength;
uniform vec3 uRayColor;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uStrength <= 0.0) return;
  // Bước về phía mặt trời (tối đa 85% quãng đường), lệch đầu tia ngẫu nhiên theo điểm ảnh để khỏi thấy vân bậc.
  vec2 delta = (uSun - uv) * (0.85 / float(SAMPLES));
  float jitter = fract(sin(dot(uv * resolution, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 p = uv + delta * jitter;
  float decay = 1.0;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 q = clamp(p, vec2(0.001), vec2(0.999));
    // Chỉ bầu trời (vòm trời vẽ ở đúng mặt phẳng xa) mới phát sáng; mây sẫm, cây, nhà chắn tia.
    float open = step(0.99995, readDepth(q));
    float lum = dot(texture2D(inputBuffer, q).rgb, vec3(0.2126, 0.7152, 0.0722));
    sum += open * (0.25 + smoothstep(0.35, 1.6, lum)) * decay;
    decay *= 0.955;
    p += delta;
  }
  sum /= float(SAMPLES) * 0.45;
  // Tia đậm gần mặt trời, nhạt dần ra xa (tính theo khung hình vuông cho khỏi méo theo tỉ lệ màn hình).
  vec2 d = (uv - uSun) * vec2(aspect, 1.0);
  float falloff = exp(-length(d) * 1.6);
  outputColor = vec4(inputColor.rgb + uRayColor * sum * falloff * uStrength, inputColor.a);
}
`;

class GodRaysEffect extends Effect {
  constructor(samples: number) {
    super("GodRaysEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      defines: new Map([["SAMPLES", String(samples)]]),
      uniforms: new Map<string, Uniform>([
        ["uSun", new Uniform(new Vector2(0.5, 0.5))],
        ["uStrength", new Uniform(0)],
        ["uRayColor", new Uniform(new Color())],
      ]),
    });
  }
}

const sunPoint = new Vector3();
const forward = new Vector3();
const WARM = new Color("#ffb46a");

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Tạo hiệu ứng tia nắng (đưa vào EffectComposer bằng <primitive>) và cập nhật vị trí mặt trời, độ mạnh mỗi khung hình. */
export function useGodRays(samples: number): Effect {
  const effect = useMemo(() => new GodRaysEffect(samples), [samples]);
  useEffect(() => () => effect.dispose(), [effect]);
  useFrame(({ camera }) => {
    const u = effect.uniforms;
    const dir = skyUniforms.uSunDir.value;
    camera.getWorldDirection(forward);
    const facing = forward.dot(dir);
    // Nắng thấp (bình minh, chiều tà) thì tia rõ, trưa vẫn còn chút; đêm (mặt trời đã lặn) thì tắt.
    const low = 1 - smoothstep(0.18, 0.62, dir.y);
    const day = (1 - sky.night) * smoothstep(0.0, 0.05, sky.elevation);
    const clear = 1 - smoothstep(0.55, 0.95, weatherFx.cloud) * 0.9 - weatherFx.fog * 0.6;
    let strength = facing > 0.05 ? day * (0.25 + 0.75 * low) * Math.max(0, clear) * (localEnv.underwater ? 0 : 1) * (1 - 0.6 * localEnv.indoor) : 0;
    if (strength > 0.001) {
      sunPoint.copy(camera.position).addScaledVector(dir, 100).project(camera);
      const x = sunPoint.x * 0.5 + 0.5;
      const y = sunPoint.y * 0.5 + 0.5;
      // Mặt trời ra ngoài mép khung hình thì tia tắt dần (tâm tia ra quá xa thì vân tia lộ ra).
      const out = Math.max(Math.max(-x, x - 1), Math.max(-y, y - 1));
      strength *= 1 - smoothstep(0, 0.35, out);
      (u.get("uSun")!.value as Vector2).set(x, y);
    }
    u.get("uStrength")!.value = strength * 0.55;
    (u.get("uRayColor")!.value as Color).copy(skyUniforms.uSunColor.value).lerp(WARM, low * 0.5);
  });
  return effect;
}
