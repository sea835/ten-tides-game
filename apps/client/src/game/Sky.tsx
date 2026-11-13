import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BackSide, Color, CubeCamera, HalfFloatType, Mesh, Scene, SphereGeometry, Vector3, type Texture } from "three";
import { CubeRenderTarget, NodeMaterial, PMREMGenerator, type RenderTarget, type WebGPURenderer } from "three/webgpu";
import { Fn, cameraProjectionMatrix, dot, float, floor, fract, length, max, mix, modelViewMatrix, normalize, positionLocal, sin, smoothstep, step, uniform, vec2, vec3, vec4 } from "three/tsl";
import type { F, V2, V3 } from "./gpu/slots.ts";
import { reflectionHidden } from "./reflection.ts";
import { localEnv, weatherFx } from "./shared.ts";

/**
 * Tham số của bầu trời, DayCycle ghi mỗi khung hình. Dùng chung với sương mù và mặt nước
 * để đường chân trời liền một màu.
 */
export const skyUniforms = {
  uTop: uniform(new Color("#4f9fd8")),
  uHorizon: uniform(new Color("#cde9f5")),
  uSunColor: uniform(new Color("#fff1d0")),
  uSunDir: uniform(new Vector3(0, 1, 0)),
  uMoonDir: uniform(new Vector3(0, 1, 0)),
  uNight: uniform(0),
  uTime: uniform(0),
  /** Độ phủ mây (0 trời quang, 1 kín mây), độ sẫm mây bão, chớp loé, và quãng mây đã trôi. */
  uCloud: uniform(0.15),
  uStorm: uniform(0),
  uFlash: uniform(0),
  uDrift: uniform(0),
};

// Nhiễu giá trị (value noise) và hash: cùng công thức bản GLSL cũ để mây, sao giữ nguyên hình.
const hash3 = Fn(([p0]: [V3]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
});
const hash2 = Fn(([p]: [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
const noise = Fn(([p]: [V2]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hash2(i);
  const b = hash2(i.add(vec2(1, 0)));
  const c = hash2(i.add(vec2(0, 1)));
  const d = hash2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});
// Quay 2D (ma trận mat2(0.8, -0.6, 0.6, 0.8) của bản cũ, nhân cột).
const rot = (p: V2): V2 => vec2(p.x.mul(0.8).add(p.y.mul(0.6)), p.x.mul(-0.6).add(p.y.mul(0.8)));
const nextOctave = (p: V2): V2 => rot(p).mul(2.03).add(11.7);
/** Ba lớp nhiễu đầu (dáng mây lớn); trả thêm p và a đã đi tiếp để cộng thêm lớp mịn. */
function fbm3(p0: V2): { s: F; p: V2; a: number } {
  let p = p0;
  let a = 0.5;
  let s: F = float(0);
  for (let i = 0; i < 3; i++) {
    s = s.add(noise(p).mul(a));
    p = nextOctave(p);
    a *= 0.5;
  }
  return { s, p, a };
}

/** Màu bầu trời theo hướng nhìn `d` (đã chuẩn hoá), cùng công thức bản GLSL cũ. */
const skyColor = Fn(([d]: [V3]) => {
  const { uTop, uHorizon, uSunColor, uSunDir, uMoonDir, uNight, uTime, uCloud, uStorm, uFlash, uDrift } = skyUniforms;
  const h = d.y.toVar();
  const day = float(1).sub(uNight);

  // Bầu trời: đỉnh đậm, chân trời sáng và mỏng như lớp không khí dày.
  const horizonGlow = float(1).sub(h.clamp(0, 1)).pow(5).toVar();
  const col = mix(uTop, uHorizon, horizonGlow).toVar();
  col.assign(mix(col, uTop, h.sub(0.35).clamp(0, 1).mul(0.4)));
  // Dưới chân trời: hơi nước mù mịt trên mặt biển xa.
  col.assign(mix(col, uHorizon.mul(0.82), h.mul(-4).clamp(0, 1)));

  // Mặt trời: đĩa sáng, quầng tán xạ (Mie) quanh đĩa và vùng trời ửng màu nắng.
  const s = max(dot(d, uSunDir), 0).toVar();
  const disk = smoothstep(0.99955, 0.9998, s);
  const sun = uSunColor.mul(s.pow(8).mul(0.35).add(s.pow(64).mul(0.6)).add(s.pow(2).mul(0.08).mul(horizonGlow))).mul(day);
  col.addAssign(sun.mul(float(1).sub(uCloud.mul(0.5))));

  // Mặt trăng và sao (sao chỉ hiện trên đường chân trời, đêm).
  const m = max(dot(d, uMoonDir), 0);
  const moon = vec3(0.85, 0.9, 1.0)
    .mul(smoothstep(0.9993, 0.9996, m).mul(2.5).add(m.pow(80).mul(0.25)).add(m.pow(8).mul(0.05)))
    .mul(uNight);
  const cell = d.mul(160);
  const id = floor(cell);
  const nStar = hash3(id);
  const point = smoothstep(0.32, 0.0, length(fract(cell).sub(0.5)));
  const twinkle = sin(uTime.mul(2.5).add(nStar.mul(60))).mul(0.35).add(0.65);
  const stars = vec3(step(0.994, nStar).mul(point).mul(twinkle).mul(uNight).mul(smoothstep(0.02, 0.3, h)));

  // Mây: nhiễu nhiều lớp chiếu lên một tầng mây phẳng trên cao; bên hướng nắng sáng, lõi dày tối lại,
  // mép mỏng viền bạc khi nắng chiếu xuyên qua. Dưới chân trời (h <= 0) mật độ về 0 nhờ smoothstep theo h.
  const hc = max(h, 0);
  const uv = d.xz.div(hc.add(0.12)).mul(1.3).add(vec2(uDrift, uDrift.mul(0.35))).toVar();
  // Dáng mây 5 lớp nhiễu; sáng tối theo nắng chỉ cần dáng lớn (3 lớp đầu, dùng lại) so với điểm lệch về phía mặt trời.
  const low = fbm3(uv);
  const nLow = low.s.toVar();
  const qa = low.p;
  const n = nLow.add(noise(qa).mul(low.a)).add(noise(nextOctave(qa)).mul(low.a * 0.5)).toVar();
  const cover = mix(0.66, 0.28, uCloud);
  const density = smoothstep(cover, cover.add(0.28).sub(uCloud.mul(0.1)), n).toVar();
  const qs = uv.add(normalize(uSunDir.xz.add(1e-4)).mul(0.18));
  const nSun = fbm3(qs).s;
  const lit = nLow.sub(nSun).mul(4).add(0.55).clamp(0, 1);
  const shadowCol = mix(vec3(0.52, 0.58, 0.66), vec3(0.3, 0.33, 0.37), uStorm);
  const litCol = mix(vec3(1), uSunColor, 0.35).mul(float(1).sub(uStorm.mul(0.45)));
  const cloudCol = mix(shadowCol, litCol, lit.mul(float(1).sub(density.mul(0.35)))).toVar();
  // Mây nhận màu trời (hoàng hôn ửng cam, đêm xám xanh).
  cloudCol.mulAssign(mix(vec3(1), uHorizon.mul(1.2).add(0.2), 0.35));
  cloudCol.addAssign(uSunColor.mul(s.pow(6)).mul(float(1).sub(density)).mul(1.2).mul(day));
  cloudCol.mulAssign(float(0.08).add(day.mul(0.92)));
  cloudCol.assign(mix(cloudCol, vec3(1), uFlash.mul(0.8)));
  density.mulAssign(smoothstep(0, 0.18, h).mul(0.97));

  col.addAssign(disk.mul(uSunColor).mul(8).mul(day).add(moon).add(stars).mul(float(1).sub(density)));
  return vec4(mix(col, cloudCol, density), 1);
});

/**
 * Chiếu đỉnh về đúng mặt phẳng xa nhất (bản cũ dùng gl_Position.xyww): z = w thì độ sâu = 1. Nếu renderer dùng
 * depth đảo (reversed) thì mặt xa là 0. Vật liệu không ghi depth, không sương, nên chỗ núi/cây che thì phép thử
 * độ sâu bỏ điểm ảnh trời.
 */
const skyClip = Fn((builder: { renderer: { reversedDepthBuffer?: boolean } }) => {
  const p = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1)).toVar();
  const z = builder.renderer.reversedDepthBuffer ? float(0) : p.w;
  return vec4(p.x, p.y, z, p.w);
});

function skyMaterial() {
  const m = new NodeMaterial();
  m.vertexNode = skyClip();
  m.fragmentNode = skyColor(normalize(positionLocal));
  m.side = BackSide;
  m.depthWrite = false;
  m.fog = false;
  return m;
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
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const scene = useThree((s) => s.scene);
  // Tạo và huỷ trong cùng một effect (StrictMode chạy effect hai lần; tạo bằng useMemo thì lần dọn đầu huỷ mất).
  const rigRef = useRef<{
    envScene: Scene;
    target: CubeRenderTarget;
    camera: CubeCamera;
    pmrem: PMREMGenerator;
    current: RenderTarget | null;
    next: number;
  } | null>(null);
  useEffect(() => {
    const envScene = new Scene();
    const dome = new Mesh(new SphereGeometry(100, 32, 16), skyMaterial());
    envScene.add(dome);
    const target = new CubeRenderTarget(64, { type: HalfFloatType });
    const camera = new CubeCamera(1, 1000, target as never);
    const pmrem = new PMREMGenerator(gl);
    const rig = { envScene, target, camera, pmrem, current: null as RenderTarget | null, next: 0 };
    rigRef.current = rig;
    return () => {
      rigRef.current = null;
      if (rig.current && scene.environment === rig.current.texture) scene.environment = null;
      rig.current?.dispose();
      pmrem.dispose();
      target.dispose();
      dome.geometry.dispose();
      (dome.material as NodeMaterial).dispose();
    };
  }, [gl, scene]);

  useFrame(({ clock }) => {
    scene.environmentIntensity = intensity * (1 - 0.85 * localEnv.indoor);
    const rig = rigRef.current;
    if (!rig || clock.elapsedTime < rig.next) return;
    rig.next = clock.elapsedTime + ENV_INTERVAL;
    // Bầu trời đêm vẫn có sao chớp; vẽ vào render target nên không bị tone map. CubeCamera.update tự lưu và trả
    // lại đích vẽ đang dùng, nên không làm kẹt render target của cảnh chính.
    rig.camera.update(gl as never, rig.envScene);
    // Dùng lại render target cũ: không cấp phát mới mỗi lần chụp.
    rig.current = rig.pmrem.fromCubemap(rig.target.texture, rig.current);
    scene.environment = rig.current.texture as Texture;
  });
  return null;
}
