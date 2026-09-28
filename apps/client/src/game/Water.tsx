import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, DataTexture, DoubleSide, LinearFilter, RedFormat, ShaderMaterial, UniformsLib, UniformsUtils, UnsignedByteType } from "three";
import { MAP_HALF_SIZE, WATER_LEVEL, type World } from "@tentides/content";
import { sky } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";

// Mặt nước stylized: sóng lăn tăn bằng shader, màu nông/sâu và dải bọt trắng theo bản đồ độ sâu
// nướng sẵn từ địa hình của thế giới (bờ đảo chính, đảo nhỏ, rạn san hô, hồ), không cần depth buffer.
// Vẽ cả hai mặt để khi lặn xuống vẫn thấy mặt nước lấp loá phía trên.

/** Độ sâu tối đa lưu trong bản đồ độ sâu (mét). */
const DEPTH_RANGE = 12;
const DEPTH_TEXELS = 256;

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

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vec3 p = position;
    vec4 world = modelMatrix * vec4(p, 1.0);
    float w = sin(world.x * 0.18 + uTime * 1.1) * 0.5 + sin(world.z * 0.23 - uTime * 0.9) * 0.5
            + sin((world.x + world.z) * 0.41 + uTime * 1.7) * 0.25;
    world.y += w * 0.12;
    vWave = w;
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform sampler2D uDepth;
  uniform float uHalf;
  varying vec3 vWorld;
  varying float vWave;

  void main() {
    vec2 p = vWorld.xz;
    vec2 uv = (p + uHalf) / (2.0 * uHalf);
    // Ngoài vùng bản đồ là biển sâu.
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float depth = mix(${DEPTH_RANGE.toFixed(1)}, texture2D(uDepth, uv).r * ${DEPTH_RANGE.toFixed(1)}, inside);
    float shallow = 1.0 - smoothstep(0.3, 7.0, depth);
    vec3 col = mix(uDeep, uShallow, shallow);

    // Phản chiếu bầu trời ở góc nhìn xa (fresnel).
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
    col = mix(col, uSky, fres * 0.55);

    // Vệt nắng lấp lánh.
    vec3 n = normalize(vec3(-cos(vWorld.x * 0.9 + uTime * 2.0) * 0.08, 1.0, -sin(vWorld.z * 0.8 - uTime * 1.6) * 0.08));
    vec3 h = normalize(uSunDir + view);
    col += uSunColor * pow(max(dot(n, h), 0.0), 180.0) * 1.6 * uDay;

    // Bọt sóng vỗ bờ: dải trắng dập dềnh theo thời gian ở chỗ nước rất nông, cộng một vệt sóng xa hơn.
    float surf = sin(uTime * 1.3 + (p.x + p.y) * 0.08);
    float foam = smoothstep(0.55, 0.0, abs(depth - 0.25 - surf * 0.18));
    // Vệt sóng thứ hai sát bờ (không quá 1,2 m nước, để rạn san hô ngoài khơi không nổi bọt loang lổ).
    foam += 0.4 * smoothstep(0.22, 0.0, abs(depth - 0.8 - surf * 0.18));
    foam *= 0.55 + 0.45 * sin(p.x * 1.7 + p.y * 1.3 + uTime * 0.7 + vWave * 2.0);
    col = mix(col, vec3(0.95, 0.98, 1.0) * (0.35 + 0.65 * uDay), clamp(foam, 0.0, 1.0) * 0.85);

    // Nhìn từ dưới nước lên: mặt nước sáng như tấm gương, hơi xanh.
    if (!gl_FrontFacing) {
      // Mặt dưới: sáng ngay trên đầu, xa dần thì tối lại (phản xạ toàn phần của đáy biển).
      float up = clamp(-view.y, 0.0, 1.0);
      col = mix(uDeep * 0.8, mix(uShallow, uSky, 0.3), up) * (0.45 + 0.6 * uDay);
      gl_FragColor = vec4(col, 0.9);
    } else {
      gl_FragColor = vec4(col, 0.92 - 0.25 * shallow);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const DEEP_DAY = new Color("#11577a");
const SHALLOW_DAY = new Color("#3fc1c9");
const DEEP_NIGHT = new Color("#04121f");
const SHALLOW_NIGHT = new Color("#0d3340");

export function Water({ world }: { world: World }) {
  const depthMap = useMemo(() => bakeDepth(world), [world]);
  useEffect(() => () => depthMap.dispose(), [depthMap]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uDay: { value: 1 },
            uDeep: { value: new Color() },
            uShallow: { value: new Color() },
            uSky: { value: new Color() },
            uSunDir: { value: skyUniforms.uSunDir.value },
            uSunColor: { value: skyUniforms.uSunColor.value },
            uDepth: { value: null },
            uHalf: { value: MAP_HALF_SIZE },
          },
        ]),
        vertexShader,
        fragmentShader,
        transparent: true,
        side: DoubleSide,
        fog: true,
      }),
    [],
  );
  material.uniforms.uDepth!.value = depthMap;

  useFrame(({ clock }) => {
    const u = material.uniforms;
    u.uTime!.value = clock.elapsedTime;
    const day = 1 - sky.night;
    u.uDay!.value = day;
    (u.uDeep!.value as Color).copy(DEEP_NIGHT).lerp(DEEP_DAY, day);
    (u.uShallow!.value as Color).copy(SHALLOW_NIGHT).lerp(SHALLOW_DAY, day);
    (u.uSky!.value as Color).copy(skyUniforms.uHorizon.value);
    // UniformsUtils.merge sao chép giá trị, nên nối lại vector dùng chung với bầu trời.
    (u.uSunDir!.value as typeof skyUniforms.uSunDir.value).copy(skyUniforms.uSunDir.value);
    (u.uSunColor!.value as Color).copy(skyUniforms.uSunColor.value);
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} material={material}>
      <planeGeometry args={[1400, 1400, 220, 220]} />
    </mesh>
  );
}
