import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BackSide, Color, Vector3, type Mesh } from "three";

/**
 * Tham số của bầu trời, DayCycle ghi mỗi khung hình. Dùng chung với sương mù và mặt nước
 * để đường chân trời liền một màu.
 */
export const skyUniforms = {
  uTop: { value: new Color("#4f9fd8") },
  uHorizon: { value: new Color("#cde9f5") },
  uSunColor: { value: new Color("#fff1d0") },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uMoonDir: { value: new Vector3(0, 1, 0) },
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // luôn nằm ở mặt phẳng xa nhất
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
    // Dưới chân trời: tối dần như hơi nước trên biển xa.
    col *= mix(1.0, 0.75, clamp(-h * 3.0, 0.0, 1.0));

    // Mặt trời: đĩa sáng và quầng rộng nhuộm màu cả vùng trời quanh nó.
    float s = max(dot(d, uSunDir), 0.0);
    float day = 1.0 - uNight;
    col += uSunColor * (smoothstep(0.9990, 0.9996, s) * 6.0 + pow(s, 10.0) * 0.45 + pow(s, 3.0) * 0.12) * day;

    // Mặt trăng và sao.
    float m = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, m) * 2.5 + pow(m, 80.0) * 0.25) * uNight;
    if (uNight > 0.01 && h > 0.0) {
      vec3 cell = d * 160.0;
      vec3 id = floor(cell);
      float n = hash(id);
      float point = smoothstep(0.32, 0.0, length(fract(cell) - 0.5));
      float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + n * 60.0);
      col += vec3(step(0.994, n) * point * twinkle * uNight * smoothstep(0.02, 0.3, h));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Vòm trời bao quanh camera: dải màu theo giờ, mặt trời, mặt trăng, sao. */
export function SkyDome() {
  const mesh = useRef<Mesh>(null);
  useFrame(({ camera, clock }) => {
    mesh.current?.position.copy(camera.position);
    skyUniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh ref={mesh} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[300, 32, 16]} />
      <shaderMaterial
        uniforms={skyUniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}
