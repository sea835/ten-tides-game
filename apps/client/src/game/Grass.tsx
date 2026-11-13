import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  OrthographicCamera,
  Color,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Sphere,
  Vector3,
  type BufferGeometry,
} from "three";
import { NodeMaterial, RenderTarget, type Texture, type WebGPURenderer } from "three/webgpu";
import {
  attribute,
  cos,
  faceDirection,
  float,
  fract,
  length,
  mix,
  positionGeometry,
  select,
  sin,
  smoothstep,
  step,
  texture,
  transformNormalToView,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MAP_HALF_SIZE } from "@tentides/content";
import { cloudTexture } from "./atmosphere.ts";
import { setSlot, type F, type V2, type V3, type V4 } from "./gpu/slots.ts";
import { mulberry32, wind, windStrength } from "./nature.ts";
import { reflectionHidden } from "./reflection.ts";
import { tenTrample } from "./trample.ts";

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
function bakeGround(gl: WebGPURenderer, geometries: BufferGeometry[], half: number) {
  // Mỗi đỉnh tự đặt vị trí trên màn hình theo (x, z) của thế giới (nhìn từ trên xuống).
  const vertexNode = vec4(positionGeometry.x.div(half), positionGeometry.z.div(half), 0.5, 1);
  // Cỏ mọc ở chỗ trọng số cỏ cao, trên mặt nước một đoạn.
  const splat = attribute("splat", "vec4") as V4;
  const grass: F = splat.y.div(splat.x.add(splat.y).add(splat.z).add(splat.w).max(1e-3)).mul(smoothstep(0.5, 1, positionGeometry.y)).toVarying("tenBakeGrass");
  const vertexColor = (attribute("color", "vec3") as V3).toVarying("tenBakeColor");
  const height: F = positionGeometry.y.toVarying("tenBakeHeight");
  const make = (fragmentNode: V4) => {
    const m = new NodeMaterial();
    m.vertexNode = vertexNode;
    m.fragmentNode = fragmentNode;
    // Nhìn từ trên xuống theo trục z đảo chiều nên mặt tam giác bị lật: vẽ cả hai mặt.
    m.side = DoubleSide;
    m.depthTest = false;
    m.depthWrite = false;
    m.fog = false;
    m.lights = false;
    return m;
  };
  const colorMat = make(vec4(vertexColor, grass));
  const heightMat = make(vec4(height, 0, 0, 1));
  const makeTarget = (half: boolean) => {
    const rt = new RenderTarget(BAKE_SIZE, BAKE_SIZE, { type: half ? HalfFloatType : undefined, depthBuffer: false });
    rt.texture.minFilter = LinearFilter;
    rt.texture.magFilter = LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  const color = makeTarget(false);
  const heightTarget = makeTarget(true);
  const run = () => {
    const scene = new Scene();
    const meshes = geometries.map((g) => {
      const m = new Mesh(g, colorMat);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    // WebGPURenderer gọi updateProjectionMatrix trên camera: `Camera` trần làm bước nướng ném lỗi. Vật liệu nướng tự đặt
    // vị trí clip (vertexNode) nên ma trận của camera này không ảnh hưởng hình.
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = gl.getRenderTarget();
    const clear = gl.getClearColor(new Color());
    const clearAlpha = gl.getClearAlpha();
    try {
      gl.setRenderTarget(color);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, camera);
      meshes.forEach((m) => (m.material = heightMat));
      gl.setRenderTarget(heightTarget);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      gl.render(scene, camera);
    } finally {
      gl.setRenderTarget(prev);
      gl.setClearColor(clear, clearAlpha);
    }
  };
  return {
    color,
    height: heightTarget,
    run: () => {
      run();
      colorMat.dispose();
      heightMat.dispose();
    },
  };
}

/** Số ô mỗi cạnh của thảm cỏ: mỗi ô một lệnh vẽ, ô sau lưng camera hay ngoài bán kính thì bỏ qua. */
const CHUNKS = 8;

/**
 * Lá cỏ chia thành CHUNKS × CHUNKS ô, mỗi ô một hình (dùng chung dải lá, riêng số ngẫu nhiên): số ngẫu nhiên xy của
 * lá trong ô (i, j) nằm trong [i/CHUNKS, (i+1)/CHUNKS) × [j/CHUNKS, (j+1)/CHUNKS), nên cả ô luôn đứng liền một
 * khoảng trên thế giới và có thể bỏ qua cả ô khi không nhìn thấy.
 */
function bladeGeometries(count: number, seed: number): InstancedBufferGeometry[] {
  // Một lá cỏ: dải 3 đoạn thon dần tới ngọn (x −0.5..0.5 ngang lá, y 0..1 dọc lá).
  const pos = [-0.5, 0, 0, 0.5, 0, 0, -0.5, 0.35, 0, 0.5, 0.35, 0, -0.5, 0.7, 0, 0.5, 0.7, 0, 0, 1, 0];
  const position = new BufferAttribute(new Float32Array(pos), 3);
  const normal = new BufferAttribute(new Float32Array(pos.length).fill(0), 3);
  const index = new BufferAttribute(new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]), 1);
  const rand = mulberry32(seed);
  const per = Math.max(1, Math.floor(count / (CHUNKS * CHUNKS)));
  const out: InstancedBufferGeometry[] = [];
  for (let j = 0; j < CHUNKS; j++) {
    for (let i = 0; i < CHUNKS; i++) {
      const g = new InstancedBufferGeometry();
      g.setAttribute("position", position);
      g.setAttribute("normal", normal);
      g.setIndex(index);
      const seeds = new Float32Array(per * 4);
      for (let k = 0; k < per; k++) {
        seeds[k * 4] = (i + rand()) / CHUNKS;
        seeds[k * 4 + 1] = (j + rand()) / CHUNKS;
        seeds[k * 4 + 2] = rand();
        seeds[k * 4 + 3] = rand();
      }
      g.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 4));
      g.instanceCount = per;
      g.boundingSphere = new Sphere(new Vector3(), 1);
      g.userData.smooth = true;
      out.push(g);
    }
  }
  return out;
}

/** Vị trí của một điểm cố định trong ô lặp (toạ độ ô `u` trong 0..1) khi camera ở `cam`: bản sao gần camera nhất. */
function wrapped(u: number, cam: number, tile: number): number {
  const t = (u * tile - cam) / tile + 0.5;
  return cam + (t - Math.floor(t) - 0.5) * tile;
}

/** Ô lặp quanh camera (m) và bán kính phủ cỏ (m). */
const TILE = 68;
const RADIUS = 34;

/**
 * Toàn bộ chỗ đứng, hình dáng, gió, giẫm rạp và màu của từng lá cỏ, tính trên đỉnh (vẽ instance, mỗi instance một lá
 * với số ngẫu nhiên `aSeed`). Trả node cho ô vị trí, màu và pháp tuyến.
 */
function placeGrass(uniforms: { uCam: { value: Vector3 } & V3; uClear: Vector3[] }, groundColor: Texture, groundHeight: Texture, half: number) {
  const seed = attribute("aSeed", "vec4") as V4;
  const cam = uniforms.uCam as unknown as V3;
  const clear = uniformArray(uniforms.uClear, "vec3");
  // Chỗ đứng cố định trên thế giới, lặp theo ô quanh camera.
  const rel = fract(seed.xy.mul(TILE).sub(cam.xz).div(TILE).add(0.5)).sub(0.5).mul(TILE);
  const xz: V2 = cam.xz.add(rel);
  const uv = xz.div(half * 2).add(0.5);
  // Đọc ảnh ở đỉnh: bắt buộc chỉ rõ mức mip (không có đạo hàm ở vertex stage).
  const ground = texture(groundColor, uv).level(float(0)) as unknown as V4;
  const gY: F = (texture(groundHeight, uv).level(float(0)) as unknown as V4).r;
  const dist = length(rel);
  const fade = smoothstep(RADIUS * 0.55, RADIUS, dist).oneMinus();
  // Mật độ cỏ theo ảnh: chỗ thưa thì bớt lá (so với số ngẫu nhiên riêng của lá).
  let keep: F = step(seed.z, ground.a.mul(1.15).sub(0.08));
  // Chỗ người qua lại (trại, điểm sự kiện, chỗ đào) thì cỏ bị giẫm thấp dần vào giữa (ô trống bán kính 0: bỏ qua).
  for (let i = 0; i < CLEARINGS; i++) {
    const c = clear.element(i) as unknown as V3;
    const near = smoothstep(c.z.mul(0.6), c.z, length(xz.sub(c.xy)).add(seed.z.sub(0.5).mul(0.8)));
    keep = keep.mul(select(c.z.greaterThan(0), near, float(1)));
  }
  const height: F = seed.w.mul(seed.w).mul(0.6).add(0.32).mul(fade).mul(keep).mul(ground.a.mul(0.4).add(0.6));
  const angle = fract(seed.z.mul(7.13).add(seed.w.mul(3.7))).mul(6.28318);
  const dir = vec2(cos(angle), sin(angle));
  const perp = vec2(dir.y.negate(), dir.x);
  const t: F = positionGeometry.y;
  const width = positionGeometry.x.mul(seed.w.mul(0.03).add(0.05)).mul(t.mul(0.8).oneMinus());
  const lean = fract(seed.w.mul(13.1)).mul(0.4).add(0.12).mul(t).mul(t).mul(height);
  // Gió: từng đợt gió lướt qua bãi cỏ thành sóng.
  const gust = sin(wind.mul(2.2).add(xz.x.mul(0.28)).add(xz.y.mul(0.17))).mul(0.6).add(sin(wind.mul(3.7).add(xz.x.mul(0.9)).sub(xz.y.mul(0.6))).mul(0.25));
  const windOff = vec2(0.85, 0.5).mul(gust.add(0.4)).mul(0.22).mul(windStrength).mul(t).mul(t).mul(height);
  // Người, xe đi qua thì lá dạt ra hai bên và rạp xuống; vụ nổ quét một vòng rạp cỏ (trample.ts).
  const tr = tenTrample(xz);
  const off = windOff.mul(tr.z.mul(0.7).oneMinus()).add(tr.xy.mul(tr.z.mul(0.4).add(0.55)).mul(t).mul(height));
  const position = vec3(
    xz.x.add(perp.x.mul(width)).add(dir.x.mul(lean)).add(off.x),
    gY.sub(0.02).add(t.mul(height).mul(tr.z.mul(0.62).oneMinus())),
    xz.y.add(perp.y.mul(width)).add(dir.y.mul(lean)).add(off.y),
  );
  // Mỗi lá một sắc: lá non xanh tươi, lá già ngả vàng, lá khuất sẫm hơn.
  const hue = fract(seed.w.mul(71.3).add(seed.z.mul(13.7)));
  const tint = mix(vec3(0.85, 1.12, 0.62), vec3(1.25, 1.1, 0.55), smoothstep(0.7, 1, hue));
  const base = (ground.rgb.mul(tint).toVarying("tenGrassColor") as V3).mul(seed.x.mul(91.7).add(seed.y.mul(37.1)).fract().mul(0.6).add(0.7).toVarying("tenGrassShade") as F);
  const tip = t.toVarying("tenGrassTip");
  // Gốc lá tối (bóng của chính bãi cỏ), ngọn sáng và ngả vàng nhạt; nền màu đất nơi lá mọc.
  const color = vec4(mix(base.mul(0.3), base.mul(1.45).add(vec3(0.015, 0.02, 0)), tip.pow(0.8)), 1);
  const normal = transformNormalToView(vec3(dir.x.mul(0.35), 1, dir.y.mul(0.35)).normalize()).mul(faceDirection);
  return { colors: { position, color, normal } };
}

/**
 * `clearings(out)` ghi các khoảng trống [x, z, bán kính] vào mảng (gọi mỗi khung hình, trại dời được);
 * chỗ thừa để bán kính 0.
 */
export function GrassField({ geometries, count, clearings, heightAt, half = MAP_HALF_SIZE }: { geometries: BufferGeometry[]; count: number; clearings: (out: Vector3[]) => void; heightAt: (x: number, z: number) => number; half?: number }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  // Tạo và huỷ ảnh nướng trong cùng một effect (StrictMode, sửa nóng khi dev chạy effect hai lần).
  const [baked, setBaked] = useState<ReturnType<typeof bakeGround> | null>(null);
  useEffect(() => {
    const b = bakeGround(gl, geometries, half);
    setBaked(b);
    return () => {
      b.color.dispose();
      b.height.dispose();
    };
  }, [gl, geometries, half]);
  const chunks = useMemo(() => bladeGeometries(count, 77), [count]);
  const meshes = useRef<(Mesh | null)[]>([]);
  // Độ cao thấp nhất, cao nhất của mặt đất trong từng ô thế giới (ô cố định trên lưới lặp), tính một lần.
  const relief = useMemo(() => new Map<number, [number, number]>(), [heightAt]);
  const done = useRef<unknown>(null);
  useEffect(() => () => chunks.forEach((g) => g.dispose()), [chunks]);

  const uniforms = useMemo(
    () => ({
      uCam: uniform(new Vector3()),
      uClear: Array.from({ length: CLEARINGS }, () => new Vector3()),
    }),
    [],
  );

  const material = useMemo(() => {
    if (!baked) return null;
    const m = new MeshStandardMaterial({ roughness: 0.8, side: DoubleSide });
    m.userData.detail = "none";
    cloudTexture();
    // Bóng mây tự đến qua đèn mặt trời (shadeLightWithClouds): vật liệu có ánh sáng nên khỏi vá riêng.
    const { colors } = placeGrass(uniforms, baked.color.texture, baked.height.texture, half);
    setSlot(m, "positionNode", colors.position);
    setSlot(m, "colorNode", colors.color);
    // Pháp tuyến ngả lên trời: cả bãi cỏ sáng tối theo nắng như mặt đất, không lốm đốm từng lá.
    setSlot(m, "normalNode", colors.normal);
    return m;
  }, [uniforms, baked, half]);
  useEffect(() => () => material?.dispose(), [material]);
  // Thảm cỏ không vẽ vào ảnh phản chiếu của mặt nước (nặng mà gần như không thấy).
  useEffect(() => {
    const list = meshes.current.slice();
    for (const m of list) if (m) reflectionHidden.add(m);
    return () => list.forEach((m) => m && reflectionHidden.delete(m));
  }, [baked, chunks]);

  useFrame(({ camera }) => {
    if (baked && done.current !== baked) {
      done.current = baked;
      baked.run();
    }
    uniforms.uCam.value.copy(camera.position);
    for (const v of uniforms.uClear) v.set(0, 0, 0);
    clearings(uniforms.uClear);

    // Đặt khung bao từng ô theo chỗ ô đang đứng quanh camera; three.js tự bỏ ô ngoài khung hình.
    const tile = TILE;
    const radius = RADIUS;
    const cell = tile / CHUNKS;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let j = 0; j < CHUNKS; j++) {
      const z = wrapped((j + 0.5) / CHUNKS, cz, tile);
      for (let i = 0; i < CHUNKS; i++) {
        const k = j * CHUNKS + i;
        const mesh = meshes.current[k];
        if (!mesh) continue;
        const x = wrapped((i + 0.5) / CHUNKS, cx, tile);
        // Ô nằm hẳn ngoài vòng cỏ (góc của ô lặp) thì lá đã thu về không, khỏi vẽ.
        const far = Math.hypot(x - cx, z - cz) - cell * 0.71;
        mesh.visible = far < radius;
        if (!mesh.visible) continue;
        const key = Math.round(x / cell) * 100003 + Math.round(z / cell);
        let r = relief.get(key);
        if (!r) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let a = -1; a <= 1; a++) {
            for (let b = -1; b <= 1; b++) {
              const h = heightAt(x + a * cell * 0.5, z + b * cell * 0.5);
              lo = Math.min(lo, h);
              hi = Math.max(hi, h);
            }
          }
          r = [lo, hi + 1];
          relief.set(key, r);
        }
        const sphere = mesh.geometry.boundingSphere!;
        sphere.center.set(x, (r[0] + r[1]) / 2, z);
        // Cộng lề cho lá nghiêng, gió lay và chỗ dốc giữa các điểm lấy mẫu.
        sphere.radius = Math.hypot(cell * 0.71, (r[1] - r[0]) / 2) + 1.5;
      }
    }
  });

  if (!baked || !material) return null;
  return (
    <>
      {chunks.map((g, k) => (
        <mesh
          key={k}
          ref={(m) => {
            meshes.current[k] = m;
          }}
          geometry={g}
          material={material}
          receiveShadow
        />
      ))}
    </>
  );
}
