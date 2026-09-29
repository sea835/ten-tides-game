import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, PlaneGeometry, ShaderMaterial } from "three";

// Ngọn lửa thật: tấm phẳng luôn xoay mặt về camera (chỉ xoay quanh trục đứng), trên đó nhiễu nhiều lớp cuộn
// lên trên, cắt theo hình giọt nước, tô theo dải màu từ đỏ sẫm ở mép tới vàng trắng ở lõi. Cộng sáng (additive)
// nên chồng hai ba tấm lệch nhau thành đám lửa dày, hậu kỳ bloom làm lửa toả quầng.

const vertexShader = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - center;
    toCam.y = 0.0;
    toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 world = center + right * position.x * uSize.x + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * uSize.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += noise(p) * a;
      p *= 2.1;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime * 1.6 + uSeed * 10.0;
    // Nhiễu cuộn lên, uốn ngang theo một lớp nhiễu chậm cho lưỡi lửa lượn.
    vec2 q = vec2(uv.x * 3.0 + uSeed * 7.0, uv.y * 2.2 - t);
    q.x += (fbm(vec2(uv.y * 2.0 - t * 0.5, uSeed)) - 0.5) * 1.4 * uv.y;
    float n = fbm(q);
    // Hình giọt nước: rộng ở chân, nhọn ở ngọn.
    float x = (uv.x - 0.5) * 2.0;
    float width = mix(0.95, 0.05, pow(uv.y, 0.8));
    float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
    float fire = body * (n * 1.6 - uv.y * 1.05 + 0.25);
    fire *= smoothstep(0.0, 0.08, uv.y);
    fire = clamp(fire, 0.0, 1.0);
    // Dải màu: đỏ sẫm → cam → vàng → trắng ngà.
    vec3 col = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.35, 0.02), smoothstep(0.0, 0.35, fire));
    col = mix(col, vec3(1.0, 0.75, 0.2), smoothstep(0.35, 0.7, fire));
    col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.7, 1.0, fire));
    float alpha = smoothstep(0.02, 0.3, fire);
    gl_FragColor = vec4(col * alpha * uIntensity * 2.2, alpha);
  }
`;

const plane = new PlaneGeometry(1, 1, 1, 1);

export function Flame({ position, width = 1, height = 1.6, intensity = 1, seed = 0 }: { position: [number, number, number]; width?: number; height?: number; intensity?: number; seed?: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uIntensity: { value: intensity }, uSize: { value: [width, height] } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    [seed, intensity, width, height],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
  });
  return <mesh geometry={plane} material={material} position={position} frustumCulled={false} renderOrder={5} />;
}
