import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  type Mesh,
} from "three";
import { MAP_HALF_SIZE, WATER_LEVEL, type World } from "@tentides/content";
import { useProfile } from "./graphics.ts";
import { sky, weatherFx } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";
import { fbm } from "./textures.ts";

// Mặt biển: sóng Gerstner (đỉnh sóng nhọn, chân sóng bẹt như sóng thật) cộng hai lớp gợn nhỏ từ bản đồ pháp tuyến,
// phản chiếu bầu trời theo góc nhìn (Fresnel), nắng lấp lánh, nước hấp thụ ánh sáng theo độ sâu, đỉnh sóng
// trong xanh khi ngược nắng, bọt vỗ bờ và bọt đầu sóng khi gió to. Độ sâu nướng sẵn từ địa hình thành một tấm
// bản đồ, nên không cần depth buffer. Lưới nước đi theo camera, dày ở gần và thưa dần ra xa.

/** Độ sâu tối đa lưu trong bản đồ độ sâu (mét). */
const DEPTH_RANGE = 12;
const DEPTH_TEXELS = 512;
const NORMAL_TEXELS = 256;

/** Đồng hồ và độ cao sóng dùng chung (đáy biển vẽ vân sáng theo cùng đồng hồ). */
export const waterUniforms = {
  uTime: { value: 0 },
  uWaveScale: { value: 1 },
};

function bakeDepth(world: World): DataTexture {
  const data = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS);
  const size = MAP_HALF_SIZE * 2;
  for (let j = 0; j < DEPTH_TEXELS; j++) {
    for (let i = 0; i < DEPTH_TEXELS; i++) {
      const x = -MAP_HALF_SIZE + ((i + 0.5) / DEPTH_TEXELS) * size;
      const z = -MAP_HALF_SIZE + ((j + 0.5) / DEPTH_TEXELS) * size;
      const depth = WATER_LEVEL - world.heightAt(x, z);
      data[j * DEPTH_TEXELS + i] = Math.round(Math.min(1, Math.max(0, depth / DEPTH_RANGE)) * 255);
    }
  }
  const tex = new DataTexture(data, DEPTH_TEXELS, DEPTH_TEXELS, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let normalMap: DataTexture | null = null;
/** Bản đồ pháp tuyến gợn sóng lặp liền mép (RGB) và nhiễu bọt (A), sinh một lần. */
function waterNormals(): DataTexture {
  if (normalMap) return normalMap;
  const n = NORMAL_TEXELS;
  const height = new Float32Array(n * n);
  const foam = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      // Gợn kéo dài theo một hướng như gió thổi, cộng gợn li ti.
      height[y * n + x] = fbm(u, v, 4, 5, 91) * 0.7 + fbm(u, v, 16, 3, 92) * 0.3;
      foam[y * n + x] = fbm(u, v, 8, 4, 93);
    }
  }
  const data = new Uint8Array(n * n * 4);
  const at = (x: number, y: number) => height[((y + n) % n) * n + ((x + n) % n)]!;
  const strength = 7;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, foam[y * n + x]!)) * 255);
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  normalMap = tex;
  return tex;
}

/**
 * Lưới vuông cạnh `size`, đỉnh dồn về giữa (khoảng cách tăng theo luỹ thừa): gần camera mịn để thấy sóng,
 * ra xa thưa dần (sương mù che hết rồi).
 */
function radialGrid(size: number, segments: number, power: number): BufferGeometry {
  const half = size / 2;
  const coord = (i: number) => {
    const t = (i / segments) * 2 - 1;
    return Math.sign(t) * Math.pow(Math.abs(t), power) * half;
  };
  const count = (segments + 1) * (segments + 1);
  const pos = new Float32Array(count * 3);
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const k = (j * (segments + 1) + i) * 3;
      pos[k] = coord(i);
      pos[k + 1] = 0;
      pos[k + 2] = coord(j);
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let k = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere!.radius = size;
  return g;
}

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uWaveScale;
  uniform sampler2D uDepth;
  uniform float uHalf;

  float seaDepth(vec2 p) {
    vec2 uv = (p + uHalf) / (2.0 * uHalf);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return mix(${DEPTH_RANGE.toFixed(1)}, texture2D(uDepth, uv).r * ${DEPTH_RANGE.toFixed(1)}, inside);
  }

  // Một con sóng Gerstner: w = (hướng x, hướng z, độ dốc, bước sóng). Cộng dồn tiếp tuyến để ra pháp tuyến.
  vec3 gerstner(vec4 w, vec2 p, float amp, inout vec3 tangent, inout vec3 binormal) {
    float k = 6.28318 / w.w;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(w.xy);
    float f = k * (dot(d, p) - c * uTime);
    float s = w.z * amp;
    float a = s / k;
    float sf = sin(f);
    float cf = cos(f);
    tangent += vec3(-d.x * d.x * s * sf, d.x * s * cf, -d.x * d.y * s * sf);
    binormal += vec3(-d.x * d.y * s * sf, d.y * s * cf, -d.y * d.y * s * sf);
    return vec3(d.x * a * cf, a * sf, d.y * a * cf);
  }

  vec3 waves(vec2 p, float amp, out vec3 normal) {
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 o = vec3(0.0);
    o += gerstner(vec4(1.0, 0.35, 0.07, 38.0), p, amp, tangent, binormal);
    o += gerstner(vec4(0.6, 1.0, 0.06, 23.0), p, amp, tangent, binormal);
    o += gerstner(vec4(-0.4, 0.9, 0.05, 14.0), p, amp, tangent, binormal);
    o += gerstner(vec4(0.9, -0.5, 0.045, 9.0), p, amp, tangent, binormal);
    o += gerstner(vec4(-0.8, -0.3, 0.035, 5.5), p, amp, tangent, binormal);
    normal = normalize(cross(binormal, tangent));
    return o;
  }
`;

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  ${COMMON}
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;
  varying float vDepth;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float depth = seaDepth(world.xz);
    // Sát bờ sóng dẹt lại (không trườn lên bãi cát rồi nhấp nháy xuyên qua địa hình).
    float amp = uWaveScale * smoothstep(0.15, 5.0, depth);
    vec3 n;
    vec3 o = waves(world.xz, amp, n);
    world.xyz += o;
    vWorld = world.xyz;
    vNormalW = n;
    vHeight = o.y / max(uWaveScale, 0.3);
    vDepth = depth;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <fog_pars_fragment>
  ${COMMON}
  uniform float uDay;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uScatter;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uCloud;
  uniform sampler2D uRipple;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;
  varying float vDepth;

  vec3 skyColor(vec3 r) {
    float h = clamp(r.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
    float s = max(dot(r, uSunDir), 0.0);
    col += uSunColor * (pow(s, 12.0) * 0.5 + pow(s, 4.0) * 0.12) * uDay;
    return col;
  }

  void main() {
    vec2 p = vWorld.xz;
    float depth = vDepth;
    float dist = length(cameraPosition - vWorld);
    vec3 view = normalize(cameraPosition - vWorld);

    // Gợn nhỏ: hai lớp trôi lệch hướng, mờ dần ở xa để khỏi lấm tấm.
    float detail = 1.0 - smoothstep(30.0, 160.0, dist);
    vec3 r1 = texture2D(uRipple, p * 0.045 + vec2(uTime * 0.018, uTime * 0.011)).xyz * 2.0 - 1.0;
    vec3 r2 = texture2D(uRipple, p * 0.11 + vec2(-uTime * 0.021, uTime * 0.027)).xyz * 2.0 - 1.0;
    vec2 ripple = (r1.xy * 0.6 + r2.xy * 0.4) * (0.35 + 0.65 * detail) * (0.7 + 0.5 * uWaveScale);
    vec3 n = normalize(vec3(vNormalW.x + ripple.x * 0.55, vNormalW.y, vNormalW.z + ripple.y * 0.55));

    // Màu nước: ánh sáng bị hấp thụ dần theo độ sâu, nông thì ngả xanh ngọc trong vắt.
    float absorb = 1.0 - exp(-depth * 0.32);
    vec3 body = mix(uShallow, uDeep, absorb);

    // Đỉnh sóng mỏng, ngược nắng thì ánh sáng xuyên qua thành xanh trong (tán xạ dưới bề mặt).
    float crest = clamp(vHeight * 1.6 + 0.35, 0.0, 1.0);
    float backlit = pow(max(dot(view, -vec3(uSunDir.x, 0.0, uSunDir.z)), 0.0), 3.0);
    body += uScatter * crest * (0.25 + 0.9 * backlit) * uDay * (0.4 + 0.6 * absorb);

    // Phản chiếu bầu trời (Fresnel Schlick, nước F0 = 0.02).
    float cosT = clamp(dot(n, view), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    vec3 refl = skyColor(reflect(-view, n));
    // Mây dày thì mặt nước bớt bóng loáng.
    refl = mix(refl, uHorizon, uCloud * 0.4);
    vec3 col = mix(body, refl, clamp(fres * 1.1, 0.0, 1.0));

    // Nắng lấp lánh: một vệt to mềm và vô số chấm sáng nhỏ trên gợn.
    vec3 h = normalize(uSunDir + view);
    float nh = max(dot(n, h), 0.0);
    float glint = pow(nh, 900.0) * 6.0 + pow(nh, 120.0) * 0.5;
    col += uSunColor * glint * uDay * (1.0 - uCloud * 0.8);

    // Bọt vỗ bờ: các vệt sóng lùa vào bờ theo nhịp, nhiễu bọt làm vỡ vụn thành mảng.
    float foamTex = texture2D(uRipple, p * 0.16 + vec2(uTime * 0.01, 0.0)).a;
    float foamTex2 = texture2D(uRipple, p * 0.37 - vec2(0.0, uTime * 0.015)).a;
    float foamNoise = foamTex * 0.6 + foamTex2 * 0.4;
    float wash = fract(uTime * 0.12 - depth * 0.45 + foamTex * 0.3);
    float band = smoothstep(0.0, 0.06, wash) * (1.0 - smoothstep(0.06, 0.35, wash));
    float shore = 1.0 - smoothstep(0.0, 1.6, depth);
    float foam = shore * (smoothstep(0.12, 0.0, depth) * 0.8 + band);
    // Đầu sóng bạc trắng khi gió to.
    foam += smoothstep(0.55, 0.9, crest) * smoothstep(0.9, 1.6, uWaveScale) * 0.9;
    foam *= smoothstep(0.42, 0.7, foamNoise + foam * 0.15);
    vec3 foamCol = vec3(0.92, 0.96, 0.98) * (0.3 + 0.7 * uDay);
    col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.9);

    // Nước nông trong suốt, thấy cát đáy; sâu dần thì đục.
    float alpha = mix(0.18, 0.97, smoothstep(0.0, 4.5, depth));
    alpha = max(alpha, fres);
    alpha = max(alpha, clamp(foam, 0.0, 1.0));

    if (!gl_FrontFacing) {
      // Nhìn từ dưới nước lên: gần đỉnh đầu thấy trời qua cửa sổ Snell, ra xa phản xạ toàn phần tối lại.
      float up = clamp(-view.y, 0.0, 1.0);
      float window = smoothstep(0.55, 0.8, up);
      vec3 under = mix(uDeep * 0.7, uShallow * 1.2, up);
      col = mix(under, skyColor(vec3(0.0, 1.0, 0.0)) * 1.1, window) * (0.45 + 0.6 * uDay);
      col += uSunColor * pow(max(dot(-view, uSunDir), 0.0), 40.0) * uDay;
      gl_FragColor = vec4(col, 0.92);
    } else {
      gl_FragColor = vec4(col, alpha);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const DEEP_DAY = new Color("#0a3a55");
const SHALLOW_DAY = new Color("#3fb8b0");
const SCATTER_DAY = new Color("#2fa39a");
const DEEP_NIGHT = new Color("#020b14");
const SHALLOW_NIGHT = new Color("#0a2a33");

const SIZE = 1400;

export function Water({ world }: { world: World }) {
  const depthMap = useMemo(() => bakeDepth(world), [world]);
  useEffect(() => () => depthMap.dispose(), [depthMap]);
  // Số ô lưới theo mức chất lượng: đỉnh dồn về gần camera nên bớt ô chủ yếu làm thưa phần xa (sương mù che).
  const segments = useProfile().water;
  const geometry = useMemo(() => radialGrid(SIZE, segments, 2.2), [segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => {
    const m = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uDay: { value: 1 },
          uDeep: { value: new Color() },
          uShallow: { value: new Color() },
          uScatter: { value: new Color() },
          uTop: { value: new Color() },
          uHorizon: { value: new Color() },
          uSunDir: { value: skyUniforms.uSunDir.value.clone() },
          uSunColor: { value: new Color() },
          uCloud: { value: 0 },
          uDepth: { value: null },
          uRipple: { value: null },
          uHalf: { value: MAP_HALF_SIZE },
        },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      side: DoubleSide,
      fog: true,
    });
    // Đồng hồ sóng dùng chung (merge sao chép giá trị nên gắn lại sau).
    m.uniforms.uTime = waterUniforms.uTime;
    m.uniforms.uWaveScale = waterUniforms.uWaveScale;
    m.uniforms.uRipple!.value = waterNormals();
    return m;
  }, []);
  material.uniforms.uDepth!.value = depthMap;

  useFrame(({ clock, camera }) => {
    const u = material.uniforms;
    waterUniforms.uTime.value = clock.elapsedTime;
    // Gió to, bão thì sóng lớn hơn.
    const target = 1 + weatherFx.rain * 0.3 + weatherFx.storm * 1.1;
    waterUniforms.uWaveScale.value += (target - waterUniforms.uWaveScale.value) * 0.01;
    const day = 1 - sky.night;
    u.uDay!.value = day;
    (u.uDeep!.value as Color).copy(DEEP_NIGHT).lerp(DEEP_DAY, day);
    (u.uShallow!.value as Color).copy(SHALLOW_NIGHT).lerp(SHALLOW_DAY, day);
    (u.uScatter!.value as Color).copy(SCATTER_DAY).multiplyScalar(day);
    (u.uTop!.value as Color).copy(skyUniforms.uTop.value);
    (u.uHorizon!.value as Color).copy(skyUniforms.uHorizon.value);
    (u.uSunDir!.value as typeof skyUniforms.uSunDir.value).copy(skyUniforms.uSunDir.value);
    (u.uSunColor!.value as Color).copy(skyUniforms.uSunColor.value);
    u.uCloud!.value = Math.max(0, weatherFx.cloud - 0.3) / 0.7;
    // Lưới đi theo camera, bám theo bước 2 m để đỉnh không trượt qua lại khi đi.
    if (mesh.current) mesh.current.position.set(Math.round(camera.position.x / 2) * 2, WATER_LEVEL, Math.round(camera.position.z / 2) * 2);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} position-y={WATER_LEVEL} frustumCulled={false} />;
}
