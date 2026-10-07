import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLCubeRenderTarget,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import { reflectionHidden } from "./reflection.ts";
import { localEnv, weatherFx } from "./shared.ts";

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
  /** Độ phủ mây (0 trời quang, 1 kín mây), độ sẫm mây bão, chớp loé, và quãng mây đã trôi. */
  uCloud: { value: 0.15 },
  uStorm: { value: 0 },
  uFlash: { value: 0 },
  uDrift: { value: 0 },
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
  uniform float uCloud;
  uniform float uStorm;
  uniform float uFlash;
  uniform float uDrift;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Ba lớp nhiễu đầu (dáng mây lớn); p và a đi tiếp để cộng thêm lớp mịn.
  const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
  float fbm3(inout vec2 p, inout float a) {
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += noise(p) * a;
      p = ROT * p * 2.03 + 11.7;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float day = 1.0 - uNight;

    // Bầu trời: đỉnh đậm, chân trời sáng và mỏng như lớp không khí dày.
    float horizonGlow = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
    vec3 col = mix(uTop, uHorizon, horizonGlow);
    col = mix(col, uTop, clamp(h - 0.35, 0.0, 1.0) * 0.4);
    // Dưới chân trời: hơi nước mù mịt trên mặt biển xa.
    col = mix(col, uHorizon * 0.82, clamp(-h * 4.0, 0.0, 1.0));

    // Mặt trời: đĩa sáng, quầng tán xạ (Mie) quanh đĩa và vùng trời ửng màu nắng.
    float s = max(dot(d, uSunDir), 0.0);
    float disk = smoothstep(0.99955, 0.9998, s);
    vec3 sun = uSunColor * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.6 + pow(s, 2.0) * 0.08 * horizonGlow) * day;
    col += sun * (1.0 - uCloud * 0.5);

    // Mặt trăng và sao.
    float m = max(dot(d, uMoonDir), 0.0);
    vec3 moon = vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, m) * 2.5 + pow(m, 80.0) * 0.25 + pow(m, 8.0) * 0.05) * uNight;
    vec3 stars = vec3(0.0);
    if (uNight > 0.01 && h > 0.0) {
      vec3 cell = d * 160.0;
      vec3 id = floor(cell);
      float n = hash(id);
      float point = smoothstep(0.32, 0.0, length(fract(cell) - 0.5));
      float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + n * 60.0);
      stars = vec3(step(0.994, n) * point * twinkle * uNight * smoothstep(0.02, 0.3, h));
    }

    // Mây: nhiễu nhiều lớp chiếu lên một tầng mây phẳng trên cao; bên hướng nắng sáng, lõi dày tối lại,
    // mép mỏng viền bạc khi nắng chiếu xuyên qua.
    float density = 0.0;
    vec3 cloudCol = vec3(0.0);
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uDrift, uDrift * 0.35);
      // Dáng mây 5 lớp nhiễu; sáng tối theo nắng chỉ cần dáng lớn (3 lớp đầu, dùng lại) so với điểm lệch về phía mặt trời.
      vec2 q = uv;
      float a = 0.5;
      float nLow = fbm3(q, a);
      float n = nLow + noise(q) * a;
      q = ROT * q * 2.03 + 11.7;
      n += noise(q) * a * 0.5;
      float cover = mix(0.66, 0.28, uCloud);
      density = smoothstep(cover, cover + 0.28 - 0.1 * uCloud, n);
      vec2 qs = uv + normalize(uSunDir.xz + 1e-4) * 0.18;
      float aSun = 0.5;
      float nSun = fbm3(qs, aSun);
      float lit = clamp(0.55 + (nLow - nSun) * 4.0, 0.0, 1.0);
      vec3 shadowCol = mix(vec3(0.52, 0.58, 0.66), vec3(0.3, 0.33, 0.37), uStorm);
      vec3 litCol = mix(vec3(1.0), uSunColor, 0.35) * (1.0 - 0.45 * uStorm);
      cloudCol = mix(shadowCol, litCol, lit * (1.0 - 0.35 * density));
      // Mây nhận màu trời (hoàng hôn ửng cam, đêm xám xanh).
      cloudCol *= mix(vec3(1.0), uHorizon * 1.2 + 0.2, 0.35);
      cloudCol += uSunColor * pow(s, 6.0) * (1.0 - density) * 1.2 * day;
      cloudCol *= 0.08 + 0.92 * day;
      cloudCol = mix(cloudCol, vec3(1.0), uFlash * 0.8);
      density *= smoothstep(0.0, 0.18, h) * 0.97;
    }
    col += (disk * uSunColor * 8.0 * day + moon + stars) * (1.0 - density);
    col = mix(col, cloudCol, density);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function skyMaterial() {
  return new ShaderMaterial({ uniforms: skyUniforms, vertexShader, fragmentShader, side: BackSide, depthWrite: false, fog: false });
}

/** Vòm trời bao quanh camera: dải màu theo giờ, mặt trời, mây trôi, mặt trăng, sao. */
export function SkyDome() {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(skyMaterial, []);
  // Ảnh phản chiếu trên mặt nước không cần vòm trời (shader nước tự tính bầu trời phản chiếu).
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    reflectionHidden.add(m);
    return () => void reflectionHidden.delete(m);
  }, []);
  useFrame(({ camera, clock }, dt) => {
    const m = mesh.current;
    if (m) {
      m.position.copy(camera.position);
      // Dưới nước thì không thấy trời qua làn nước đục (chỉ thấy sương xanh).
      m.visible = !localEnv.underwater;
    }
    skyUniforms.uTime.value = clock.elapsedTime;
    skyUniforms.uCloud.value = weatherFx.cloud;
    skyUniforms.uStorm.value = Math.max(weatherFx.storm, weatherFx.rain * 0.6);
    skyUniforms.uFlash.value = weatherFx.flash;
    skyUniforms.uDrift.value += Math.min(dt, 0.1) * (0.012 + weatherFx.storm * 0.05);
  });
  return (
    // Vẽ sau mọi vật đặc (vòm trời nằm đúng mặt phẳng xa nhất): chỗ bị núi, cây, nhà che thì GPU bỏ qua ngay nhờ
    // phép thử độ sâu, không phải tính mây cho điểm ảnh không ai thấy. Vẫn trước mặt nước và vật trong suốt.
    <mesh ref={mesh} renderOrder={1000} frustumCulled={false} material={material}>
      <sphereGeometry args={[300, 48, 24]} />
    </mesh>
  );
}

/**
 * Mỗi chừng này giây chụp lại bầu trời làm ánh sáng môi trường. Vòng lặp này tốn 6 lượt vẽ
 * cộng chuỗi blur PMREM, nên chạy 1,5 giây một lần tạo ra một nhịp tụt khung hình đều đặn;
 * 4 giây vẫn kịp theo mặt trời (một ngày trong game ~8 phút thật) mà ít hẳn nhịp giật.
 */
const ENV_INTERVAL = 4;

/**
 * Ánh sáng môi trường lấy từ chính bầu trời (image-based lighting): chụp vòm trời vào một cubemap nhỏ,
 * lọc mờ theo độ nhám (PMREM), gắn làm scene.environment. Vật liệu PBR nhận ánh trời đúng màu theo giờ,
 * mặt bóng (lá ướt, đá, kim loại) phản chiếu trời.
 */
export function SkyEnvironment({ intensity = 1 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // Tạo và huỷ trong cùng một effect (StrictMode chạy effect hai lần; tạo bằng useMemo thì lần dọn đầu huỷ mất).
  const rigRef = useRef<{
    envScene: Scene;
    target: WebGLCubeRenderTarget;
    camera: CubeCamera;
    pmrem: PMREMGenerator;
    current: WebGLRenderTarget | null;
    next: number;
  } | null>(null);
  useEffect(() => {
    const envScene = new Scene();
    const dome = new Mesh(new SphereGeometry(100, 32, 16), skyMaterial());
    envScene.add(dome);
    const target = new WebGLCubeRenderTarget(64, { type: HalfFloatType });
    const camera = new CubeCamera(1, 1000, target);
    const pmrem = new PMREMGenerator(gl);
    const rig = { envScene, target, camera, pmrem, current: null as WebGLRenderTarget | null, next: 0 };
    rigRef.current = rig;
    return () => {
      rigRef.current = null;
      if (rig.current && scene.environment === rig.current.texture) scene.environment = null;
      rig.current?.dispose();
      pmrem.dispose();
      target.dispose();
      dome.geometry.dispose();
      (dome.material as ShaderMaterial).dispose();
    };
  }, [gl, scene]);

  useFrame(({ clock }) => {
    scene.environmentIntensity = intensity * (1 - 0.85 * localEnv.indoor);
    const rig = rigRef.current;
    if (!rig || clock.elapsedTime < rig.next) return;
    rig.next = clock.elapsedTime + ENV_INTERVAL;
    // Bầu trời đêm vẫn có sao chớp; không cần tone map khi chụp vào render target.
    rig.camera.update(gl, rig.envScene);
    // Dùng lại render target cũ: không cấp phát mới mỗi lần chụp.
    rig.current = rig.pmrem.fromCubemap(rig.target.texture, rig.current);
    scene.environment = rig.current.texture as Texture;
  });
  return null;
}
