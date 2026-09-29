import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  Camera,
  Color,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type WebGLRenderer,
} from "three";
import { MAP_HALF_SIZE } from "@tentides/content";
import { mulberry32, wind, windStrength } from "./nature.ts";

// Thảm cỏ dày quanh camera: hàng trăm nghìn lá cỏ vẽ bằng một lệnh (instancing). Mỗi lá cố định một chỗ trên
// thế giới trong một ô vuông lặp lại theo camera: đi tới thì lá phía sau vòng lên phía trước, nên cỏ luôn phủ quanh
// người mà không phải lưu vị trí từng lá. Độ cao mặt đất, màu đất và mật độ cỏ (chỗ nào là cỏ, cát, đá) được
// "chụp" một lần từ chính lưới địa hình vào hai tấm ảnh, lá cỏ đọc ảnh đó để đứng đúng mặt đất và hợp màu nền.

const BAKE_SIZE = 1024;
/** Số khoảng trống không có cỏ (trại, điểm sự kiện, chỗ đào). */
const CLEARINGS = 32;

/**
 * Chụp địa hình từ trên xuống: ảnh màu (RGB màu đất, A mật độ cỏ) và ảnh độ cao. `run` vẽ vào hai ảnh, gọi trong
 * vòng lặp khung hình (vẽ ngay lúc React dựng cây thì renderer chưa sẵn sàng, ảnh ra trống).
 */
function bakeGround(gl: WebGLRenderer, geometries: BufferGeometry[]) {
  const vertex = /* glsl */ `
    attribute vec4 splat;
    varying vec3 vColor;
    varying float vGrass;
    varying float vHeight;
    void main() {
      vColor = color;
      // Cỏ mọc ở chỗ trọng số cỏ cao, trên mặt nước một đoạn.
      vGrass = splat.y / max(splat.x + splat.y + splat.z + splat.w, 1e-3) * smoothstep(0.5, 1.0, position.y);
      vHeight = position.y;
      gl_Position = vec4(position.x / ${MAP_HALF_SIZE.toFixed(1)}, position.z / ${MAP_HALF_SIZE.toFixed(1)}, 0.5, 1.0);
    }
  `;
  const colorMat = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: "varying vec3 vColor; varying float vGrass; varying float vHeight; void main() { gl_FragColor = vec4(vColor, vGrass); }",
    vertexColors: true,
    // Nhìn từ trên xuống theo trục z đảo chiều nên mặt tam giác bị lật: vẽ cả hai mặt.
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const heightMat = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: "varying vec3 vColor; varying float vGrass; varying float vHeight; void main() { gl_FragColor = vec4(vHeight, 0.0, 0.0, 1.0); }",
    vertexColors: true,
    // Nhìn từ trên xuống theo trục z đảo chiều nên mặt tam giác bị lật: vẽ cả hai mặt.
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const make = (half: boolean) => {
    const rt = new WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { type: half ? HalfFloatType : undefined, depthBuffer: false });
    rt.texture.minFilter = LinearFilter;
    rt.texture.magFilter = LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  const color = make(false);
  const height = make(true);
  const run = () => {
    const scene = new Scene();
    const meshes = geometries.map((g) => {
      const m = new Mesh(g, colorMat);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    const camera = new Camera();
    const prev = gl.getRenderTarget();
    const clear = gl.getClearColor(new Color());
    const clearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(color);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    meshes.forEach((m) => (m.material = heightMat));
    gl.setRenderTarget(height);
    gl.setClearColor(0x000000, 1);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(prev);
    gl.setClearColor(clear, clearAlpha);
  };
  return {
    color,
    height,
    run: () => {
      run();
      colorMat.dispose();
      heightMat.dispose();
    },
  };
}

/** Một lá cỏ: dải 3 đoạn thon dần tới ngọn (x −0.5..0.5 ngang lá, y 0..1 dọc lá). */
function bladeGeometry(count: number, seed: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const pos = [-0.5, 0, 0, 0.5, 0, 0, -0.5, 0.35, 0, 0.5, 0.35, 0, -0.5, 0.7, 0, 0.5, 0.7, 0, 0, 1, 0];
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(pos.length).fill(0), 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  const rand = mulberry32(seed);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  g.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  g.userData.smooth = true;
  return g;
}

const VERTEX_HEAD = /* glsl */ `
  uniform sampler2D uGroundColor;
  uniform sampler2D uGroundHeight;
  uniform vec3 uCam;
  uniform float uTile;
  uniform float uRadius;
  uniform float uWind;
  uniform float uWindStrength;
  uniform vec3 uClear[${CLEARINGS}];
  attribute vec4 aSeed;
  varying vec3 vGrassColor;
  varying float vTip;
  varying float vShade;
`;

const VERTEX_PLACE = /* glsl */ `
  // Chỗ đứng cố định trên thế giới, lặp theo ô quanh camera.
  vec2 gRel = (fract((aSeed.xy * uTile - uCam.xz) / uTile + 0.5) - 0.5) * uTile;
  vec2 gXZ = uCam.xz + gRel;
  vec2 gUV = gXZ / ${(MAP_HALF_SIZE * 2).toFixed(1)} + 0.5;
  vec4 gGround = texture2D(uGroundColor, gUV);
  float gY = texture2D(uGroundHeight, gUV).r;
  float gDist = length(gRel);
  float gFade = 1.0 - smoothstep(uRadius * 0.55, uRadius, gDist);
  // Mật độ cỏ theo ảnh: chỗ thưa thì bớt lá (so với số ngẫu nhiên riêng của lá).
  float gKeep = step(aSeed.z, gGround.a * 1.15 - 0.08);
  // Chỗ người qua lại (trại, điểm sự kiện, chỗ đào) thì cỏ bị giẫm thấp dần vào giữa.
  for (int i = 0; i < ${CLEARINGS}; i++) {
    vec3 c = uClear[i];
    gKeep *= smoothstep(c.z * 0.6, c.z, length(gXZ - c.xy) + (aSeed.z - 0.5) * 0.8);
  }
  float gHeight = (0.32 + aSeed.w * aSeed.w * 0.6) * gFade * gKeep * (0.6 + 0.4 * gGround.a);
  float gAngle = fract(aSeed.z * 7.13 + aSeed.w * 3.7) * 6.28318;
  vec2 gDir = vec2(cos(gAngle), sin(gAngle));
  vec2 gPerp = vec2(-gDir.y, gDir.x);
  float gT = position.y;
  float gWidth = position.x * (0.05 + aSeed.w * 0.03) * (1.0 - gT * 0.8);
  float gLean = (0.12 + fract(aSeed.w * 13.1) * 0.4) * gT * gT * gHeight;
  // Gió: từng đợt gió lướt qua bãi cỏ thành sóng.
  float gGust = sin(uWind * 2.2 + gXZ.x * 0.28 + gXZ.y * 0.17) * 0.6 + sin(uWind * 3.7 + gXZ.x * 0.9 - gXZ.y * 0.6) * 0.25;
  vec2 gWindOff = vec2(0.85, 0.5) * (gGust + 0.4) * 0.22 * uWindStrength * gT * gT * gHeight;
  vec3 gPos = vec3(
    gXZ.x + gPerp.x * gWidth + gDir.x * gLean + gWindOff.x,
    gY - 0.02 + gT * gHeight,
    gXZ.y + gPerp.y * gWidth + gDir.y * gLean + gWindOff.y
  );
  // Mỗi lá một sắc: lá non xanh tươi, lá già ngả vàng, lá khuất sẫm hơn.
  float gHue = fract(aSeed.w * 71.3 + aSeed.z * 13.7);
  vec3 gTint = mix(vec3(0.85, 1.12, 0.62), vec3(1.25, 1.1, 0.55), smoothstep(0.7, 1.0, gHue));
  vGrassColor = gGround.rgb * gTint;
  vShade = 0.7 + 0.6 * fract(aSeed.x * 91.7 + aSeed.y * 37.1);
  vTip = gT;
`;

/**
 * `clearings(out)` ghi các khoảng trống [x, z, bán kính] vào mảng (gọi mỗi khung hình, trại dời được);
 * chỗ thừa để bán kính 0.
 */
export function GrassField({ geometries, count, clearings }: { geometries: BufferGeometry[]; count: number; clearings: (out: Vector3[]) => void }) {
  const gl = useThree((s) => s.gl);
  // Tạo và huỷ ảnh nướng trong cùng một effect (StrictMode, sửa nóng khi dev chạy effect hai lần).
  const [baked, setBaked] = useState<ReturnType<typeof bakeGround> | null>(null);
  useEffect(() => {
    const b = bakeGround(gl, geometries);
    setBaked(b);
    return () => {
      b.color.dispose();
      b.height.dispose();
    };
  }, [gl, geometries]);
  const geometry = useMemo(() => bladeGeometry(count, 77), [count]);
  const done = useRef<unknown>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uGroundColor: { value: baked?.color.texture ?? null },
      uGroundHeight: { value: baked?.height.texture ?? null },
      uCam: { value: new Vector3() },
      uTile: { value: 68 },
      uRadius: { value: 34 },
      uWind: wind,
      uWindStrength: windStrength,
      uClear: { value: Array.from({ length: CLEARINGS }, () => new Vector3()) },
    }),
    [baked],
  );

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ roughness: 0.8, side: DoubleSide });
    m.userData.detail = "none";
    m.customProgramCacheKey = () => "grass-field";
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
        .replace(
          "#include <beginnormal_vertex>",
          `${VERTEX_PLACE}\n  // Pháp tuyến ngả lên trời: cả bãi cỏ sáng tối theo nắng như mặt đất, không lốm đốm từng lá.\n  vec3 objectNormal = normalize(vec3(gDir.x * 0.35, 1.0, gDir.y * 0.35));`,
        )
        .replace("#include <begin_vertex>", "vec3 transformed = gPos;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGrassColor;\nvarying float vTip;\nvarying float vShade;")
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          // Gốc lá tối (bóng của chính bãi cỏ), ngọn sáng và ngả vàng nhạt; nền màu đất nơi lá mọc.
          vec3 gBase = vGrassColor * vShade;
          diffuseColor.rgb = mix(gBase * 0.3, gBase * 1.45 + vec3(0.015, 0.02, 0.0), pow(vTip, 0.8));`,
        );
    };
    return m;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }) => {
    if (baked && done.current !== baked) {
      done.current = baked;
      baked.run();
    }
    uniforms.uCam.value.copy(camera.position);
    for (const v of uniforms.uClear.value) v.set(0, 0, 0);
    clearings(uniforms.uClear.value);
  });

  if (!baked) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} receiveShadow />;
}
