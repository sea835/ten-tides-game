import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Mesh,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  cross,
  dot,
  float,
  frontFacing,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalize,
  pow,
  positionGeometry,
  positionWorld,
  reflect,
  select,
  sin,
  cos,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  fract,
  exp,
} from "three/tsl";
import { MAP_HALF_SIZE, WATER_LEVEL, type World } from "@tentides/content";
import { useProfile } from "./graphics.ts";
import { createReflection } from "./reflection.ts";
import { sky, weatherFx } from "./shared.ts";
import { skyUniforms } from "./Sky.tsx";
import { fbm } from "./textures.ts";
import { cloudShade, cloudTexture } from "./atmosphere.ts";
import type { F, V2, V3 } from "./gpu/slots.ts";

// Mặt biển kiểu stylized: ba tầng sóng Gerstner mềm (đỉnh tròn, cuộn nhịp nhàng) cộng hai lớp gợn nhỏ từ bản đồ
// pháp tuyến, phản chiếu bầu trời theo góc nhìn (Fresnel), nắng lấp lánh, màu nước chuyển ba nấc theo độ sâu (ngọc lam
// trong vắt ven bờ → xanh ngọc → xanh thẫm ngoài khơi), đỉnh sóng trong xanh khi ngược nắng, dải bọt trắng men theo
// bờ (so độ sâu với địa hình) lùa vào theo nhịp sóng, bọt đầu sóng khi gió to. Độ sâu nướng sẵn từ địa hình
// (`world.heightAt`) thành một tấm bản đồ, nên không cần depth buffer. Lưới nước đi theo camera, dày ở gần và thưa
// dần ra xa; chỉ vẽ một mặt (mặt trên khi ở trên, mặt dưới khi lặn), sát mặt nước mới vẽ cả hai.
// Đồ hoạ Cao: thêm ảnh phản chiếu thật (người, xe, cây ven bờ, lửa đầu nòng, cầu lửa) vẽ lại từ camera soi gương qua
// mặt nước ở nửa độ phân giải, chỉ hiện rõ ở góc nhìn xiên (Fresnel), gợn sóng làm ảnh lăn tăn; bầu trời phản chiếu
// vẫn tính trong shader (vòm trời, thảm cỏ không vẽ lại cho nhẹ).


/** Độ sâu tối đa lưu trong bản đồ độ sâu (mét). */
const DEPTH_RANGE = 12;
const DEPTH_TEXELS = 512;
const NORMAL_TEXELS = 256;

/** Đồng hồ và độ cao sóng dùng chung (đáy biển vẽ vân sáng theo cùng đồng hồ). */
export const waterUniforms = {
  uTime: uniform(0),
  uWaveScale: uniform(1),
  /** Thủy triều (chế độ sinh tồn): mặt biển cao hơn mốc WATER_LEVEL chừng này mét. Battleground luôn 0. */
  uTide: uniform(0),
};

/**
 * Đảo sinh tồn có thủy triều: nướng bản đồ độ sâu so với một mốc cao hơn chừng này, để bãi cát bị triều cường ngập
 * vẫn có độ sâu đúng (bọt sóng, màu nước men theo bờ mới khi triều lên xuống).
 */
const TIDE_HEADROOM = 1.5;

function bakeDepth(world: World, headroom: number): DataTexture {
  const data = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS);
  const half = world.half ?? MAP_HALF_SIZE;
  const size = half * 2;
  for (let j = 0; j < DEPTH_TEXELS; j++) {
    for (let i = 0; i < DEPTH_TEXELS; i++) {
      const x = -half + ((i + 0.5) / DEPTH_TEXELS) * size;
      const z = -half + ((j + 0.5) / DEPTH_TEXELS) * size;
      const depth = WATER_LEVEL + headroom - world.heightAt(x, z);
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

const DEEP_DAY = new Color("#0b3a66");
const MID_DAY = new Color("#167f95");
const SHALLOW_DAY = new Color("#48d0c0");
const SCATTER_DAY = new Color("#2fb3a4");
const DEEP_NIGHT = new Color("#020b14");
const MID_NIGHT = new Color("#05202b");
const SHALLOW_NIGHT = new Color("#0a2a33");

/**
 * Cạnh tấm lưới nước (mét). Camera không nhìn xa quá tầm sương mù (`camera.far` theo sương, xem DayCycle, tối đa
 * chừng 300 m), nên tấm 760 m là đủ phủ; trước đây 1 400 m nên phần lớn đỉnh nằm ngoài tầm nhìn.
 */
const SIZE = 760;

// ---------------------------------------------------------------------------- shader nước (TSL)

/** Mỗi sóng Gerstner: hướng x, hướng z, độ dốc, bước sóng (mét). */
const WAVES = [
  [1.0, 0.3, 0.08, 44.0],
  [-0.65, 1.0, 0.065, 27.0],
  [0.85, -0.7, 0.06, 17.0],
  [0.15, 1.0, 0.055, 11.0],
  [-1.0, -0.25, 0.05, 7.5],
] as const;

/** Uniform riêng của một tấm nước (màu theo giờ, độ sâu, phủ mây...). Đồng hồ, độ cao sóng, thủy triều: `waterUniforms`. */
function makeUniforms(half: number) {
  return {
    uDay: uniform(1),
    uDeep: uniform(new Color()),
    uMid: uniform(new Color()),
    uShallow: uniform(new Color()),
    uScatter: uniform(new Color()),
    uCloud: uniform(0),
    uHalf: uniform(half),
    uWaveFade: uniform(0),
    uDepthBias: uniform(0),
    uReflect: uniform(0),
  };
}

/** Ép nút màu (uniform Color) thành vec3 cho phép tính. */
const asV3 = (n: unknown): V3 => vec3(n as V3);

const placeholder = () => {
  const t = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
};

/**
 * Vật liệu nước: vertex dựng sóng Gerstner (năm tầng toả nhiều hướng, mỗi tầng tắt dần khi ô lưới ở đó quá thưa so
 * với bước sóng), fragment tính màu cuối (màu theo độ sâu, Fresnel, nắng lấp lánh, bọt, mặt dưới khi lặn). Sương mù
 * áp tự động qua `fogNode` của cảnh (installAtmosphere) vì vật liệu để `fog = true`.
 * `reflection`: ảnh phản chiếu thật (đồ hoạ Cao) hoặc null.
 */
function makeWaterMaterial(half: number, reflection: ReturnType<typeof createReflection> | null) {
  const u = makeUniforms(half);
  const { uTime, uWaveScale, uTide } = waterUniforms;
  const { uDay, uCloud, uHalf, uWaveFade, uDepthBias, uReflect } = u;
  const depthMap = texture(placeholder());
  const rippleMap = texture(waterNormals());
  cloudTexture();

  const deep = asV3(u.uDeep);
  const mid = asV3(u.uMid);
  const shallow = asV3(u.uShallow);
  const scatter = asV3(u.uScatter);
  const top = asV3(skyUniforms.uTop);
  const horizon = asV3(skyUniforms.uHorizon);
  const sunDir = skyUniforms.uSunDir as unknown as V3;
  const sunColor = asV3(skyUniforms.uSunColor);

  // Độ sâu nước tại điểm thế giới p (mét), từ bản đồ nướng sẵn; ngoài bản đồ coi như sâu tối đa.
  const seaDepth = (p: V2): F => {
    const uv = p.add(uHalf).div(uHalf.mul(2));
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    // Bản đồ nướng so với mốc + uDepthBias; mặt nước thật đang ở mốc + uTide.
    const baked = depthMap.sample(uv).level(float(0)).r.mul(DEPTH_RANGE);
    return mix(float(DEPTH_RANGE), baked, inside).sub(uDepthBias).add(uTide);
  };

  // Cộng dồn các sóng: trả về độ lệch đỉnh và pháp tuyến (Gerstner: tiếp tuyến cộng dồn rồi lấy tích có hướng).
  const waves = (p: V2, amp: F, dist: F) => {
    let tangent: V3 = vec3(1, 0, 0);
    let binormal: V3 = vec3(0, 0, 1);
    let offset: V3 = vec3(0, 0, 0);
    for (const [wx, wz, steep, len] of WAVES) {
      const l = Math.hypot(wx, wz);
      const dx = wx / l;
      const dz = wz / l;
      const k = 6.28318 / len;
      const c = Math.sqrt(9.8 / k);
      const f = p.x.mul(k * dx).add(p.y.mul(k * dz)).sub(uTime.mul(k * c));
      const fade = float(1).sub(smoothstep(uWaveFade.mul(len * 3), uWaveFade.mul(len * 7), dist));
      const s = amp.mul(fade).mul(steep);
      const a = s.div(k);
      const sf = sin(f);
      const cf = cos(f);
      tangent = tangent.add(vec3(s.mul(sf).mul(-dx * dx), s.mul(cf).mul(dx), s.mul(sf).mul(-dx * dz)));
      binormal = binormal.add(vec3(s.mul(sf).mul(-dx * dz), s.mul(cf).mul(dz), s.mul(sf).mul(-dz * dz)));
      offset = offset.add(vec3(a.mul(cf).mul(dx), a.mul(sf), a.mul(cf).mul(dz)));
    }
    return { offset, normal: normalize(cross(binormal, tangent)) as V3 };
  };

  // ---- đỉnh
  const world = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
  const depthV = seaDepth(world.xz);
  // Sát bờ sóng dẹt lại (không trườn lên bãi cát rồi nhấp nháy xuyên qua địa hình).
  const ampV = uWaveScale.mul(smoothstep(0.15, 5.0, depthV));
  const wv = waves(world.xz, ampV, length(world.xz.sub(cameraPosition.xz)));
  const vNormal = wv.normal.toVarying("vWaterNormal");
  const vHeight = wv.offset.y.div(max(uWaveScale, 0.3)).toVarying("vWaterHeight");
  const vDepth = depthV.toVarying("vWaterDepth");

  // ---- điểm ảnh
  const pw = positionWorld as unknown as V3;
  const p = pw.xz;
  const toCam = cameraPosition.sub(pw);
  const dist = length(toCam);
  const view = normalize(toCam);
  const depth = vDepth;
  const day = uDay;

  // Màu bầu trời theo hướng nhìn r (khớp Sky.tsx: dải chân trời → thiên đỉnh cộng quầng mặt trời).
  const skyColor = (r: V3): V3 => {
    const h = clamp(r.y, 0, 1);
    const s = max(dot(r, sunDir), 0);
    const base = mix(horizon, top, pow(h, 0.5));
    return base.add(sunColor.mul(pow(s, 12).mul(0.5).add(pow(s, 4).mul(0.12))).mul(day)) as V3;
  };

  // Gợn nhỏ: ba lớp trôi lệch hướng, mờ dần ở xa để khỏi lấm tấm.
  const detail = float(1).sub(smoothstep(30, 160, dist));
  const ripple = (uv: V2) => rippleMap.sample(uv).xyz.mul(2).sub(1);
  const r1 = ripple(p.mul(0.045).add(vec2(uTime.mul(0.018), uTime.mul(0.011))));
  const r2 = ripple(p.mul(0.11).add(vec2(uTime.mul(-0.021), uTime.mul(0.027))));
  // Lớp thứ ba xoay chéo, trôi ngược chiều: gợn đan nhau, không lộ một hướng trôi.
  const q = vec2(p.x.mul(0.6).add(p.y.mul(0.8)), p.x.mul(-0.8).add(p.y.mul(0.6)));
  const r3 = ripple(q.mul(0.073).add(vec2(uTime.mul(0.013), uTime.mul(-0.024))));
  const rip = r1.xy.mul(0.42).add(r2.xy.mul(0.3)).add(r3.xy.mul(0.33)).mul(detail.mul(0.65).add(0.35)).mul(uWaveScale.mul(0.5).add(0.7));
  const n = normalize(vec3(vNormal.x.add(rip.x.mul(0.55)), vNormal.y, vNormal.z.add(rip.y.mul(0.55)))) as V3;

  // Màu nước ba nấc theo độ sâu: ngọc lam trong vắt ven bờ → xanh ngọc → xanh thẫm ngoài khơi. Ngoài rìa bản đồ
  // (độ sâu kịch trần) càng xa đảo càng thẫm.
  const absorb = float(1).sub(exp(depth.mul(-0.32)));
  let body: V3 = mix(shallow, mid, smoothstep(0, 3.5, depth)) as V3;
  body = mix(body, deep, smoothstep(2.5, 11, depth)) as V3;
  const offshore = smoothstep(uHalf.mul(0.9), uHalf.mul(1.35), max(p.x.abs(), p.y.abs()));
  body = mix(body, deep.mul(0.75), offshore.mul(0.6)) as V3;

  // Đỉnh sóng mỏng, ngược nắng thì ánh sáng xuyên qua thành xanh trong (tán xạ dưới bề mặt).
  const crest = clamp(vHeight.mul(1.6).add(0.35), 0, 1);
  const backlit = pow(max(dot(view, vec3(sunDir.x, 0, sunDir.z).negate()), 0), 3);
  body = body.add(scatter.mul(crest).mul(backlit.mul(0.9).add(0.25)).mul(day).mul(absorb.mul(0.6).add(0.4))) as V3;

  // Phản chiếu bầu trời (Fresnel Schlick, nước F0 = 0.02).
  const cosT = clamp(dot(n, view), 0, 1);
  const fres = pow(float(1).sub(cosT), 5).mul(0.98).add(0.02);
  let refl: V3 = skyColor(reflect(view.negate(), n) as V3);
  // Mây dày thì mặt nước bớt bóng loáng.
  refl = mix(refl, horizon, uCloud.mul(0.4)) as V3;
  if (reflection) {
    // Ảnh phản chiếu thật (nửa độ phân giải), gợn sóng làm lệch toạ độ; chỗ trống (trời) giữ bầu trời ở trên.
    const rn = reflection.node;
    const ruv = (rn.uvNode as unknown as V2).add(vec2(n.x.negate(), n.z).mul(uWaveScale.mul(0.02).add(0.035).mul(detail.mul(0.6).add(0.4))));
    const redge = smoothstep(0, 0.04, ruv.x).mul(smoothstep(1, 0.96, ruv.x)).mul(smoothstep(0, 0.04, ruv.y)).mul(smoothstep(1, 0.96, ruv.y));
    rn.uvNode = clamp(ruv, 0.002, 0.998) as never;
    const rt = rn as unknown as { rgb: V3; a: F };
    refl = mix(refl, rt.rgb, clamp(rt.a, 0, 1).mul(redge).mul(uReflect)) as V3;
  }
  let col: V3 = mix(body, refl, clamp(fres.mul(1.1), 0, 1)) as V3;

  // Nắng lấp lánh: một vệt to mềm và vô số chấm sáng nhỏ trên gợn.
  const h = normalize(sunDir.add(view));
  const nh = max(dot(n, h), 0);
  const glint = pow(nh, 900).mul(6).add(pow(nh, 120).mul(0.5));
  // Bóng mây trôi qua thì mặt nước tắt lấp lánh, sẫm đi một chút.
  const sunShade = cloudShade(p) as F;
  col = col.mul(sunShade.mul(0.2).add(0.8)) as V3;
  col = col.add(sunColor.mul(glint).mul(day).mul(float(1).sub(uCloud.mul(0.8))).mul(sunShade)) as V3;

  // Bọt vỗ bờ (so độ sâu nước với địa hình): một viền bọt dày sát mép nước, cộng hai lớp vệt sóng lùa vào bờ theo
  // nhịp (lệch pha nhau), nhiễu bọt làm vỡ vụn thành mảng. Vách đá dốc (độ sâu tăng nhanh) thì dải bọt hẹp.
  const foamTex = rippleMap.sample(p.mul(0.16).add(vec2(uTime.mul(0.01), 0))).a;
  const foamTex2 = rippleMap.sample(p.mul(0.37).sub(vec2(0, uTime.mul(0.015)))).a;
  const foamNoise = foamTex.mul(0.6).add(foamTex2.mul(0.4));
  const wash = fract(uTime.mul(0.12).sub(depth.mul(0.45)).add(foamTex.mul(0.3)));
  const wash2 = fract(uTime.mul(0.12).add(0.5).sub(depth.mul(0.6)).add(foamTex2.mul(0.3)));
  const band = smoothstep(0, 0.06, wash).mul(float(1).sub(smoothstep(0.06, 0.35, wash)));
  const band2 = smoothstep(0, 0.05, wash2).mul(float(1).sub(smoothstep(0.05, 0.22, wash2))).mul(0.7);
  const shore = float(1).sub(smoothstep(0, 1.8, depth));
  const edge = smoothstep(0.22, 0, depth.add(foamTex.sub(0.5).mul(0.2)));
  let foam: F = edge.mul(1.1).add(shore.mul(band.add(band2.mul(float(1).sub(smoothstep(0.4, 1.2, depth)))))) as F;
  // Đầu sóng bạc trắng khi gió to.
  foam = foam.add(smoothstep(0.55, 0.9, crest).mul(smoothstep(0.9, 1.6, uWaveScale)).mul(0.9)) as F;
  foam = foam.mul(smoothstep(0.42, 0.7, foamNoise.add(foam.mul(0.15)))) as F;
  // Bọt kiểu hoạt hình: mép mảng bọt sắc gọn thay vì loang mờ.
  foam = smoothstep(0.25, 0.45, foam).mul(0.95).add(foam.mul(0.05)) as F;
  const foamCol = vec3(0.94, 0.97, 0.99).mul(day.mul(0.7).add(0.3));
  const foamK = clamp(foam, 0, 1);
  col = mix(col, foamCol, foamK.mul(0.92)) as V3;

  // Nước nông trong suốt, thấy cát đáy; sâu dần thì đục hẳn (không lộ lờ mờ từng ô đáy biển thành mảng vuông).
  const alpha = max(max(mix(float(0.18), float(1), smoothstep(0, 6, depth)), fres), foamK);

  // Nhìn từ dưới nước lên: gần đỉnh đầu thấy trời qua cửa sổ Snell, ra xa phản xạ toàn phần tối lại.
  const up = clamp(view.y.negate(), 0, 1);
  const window = smoothstep(0.55, 0.8, up);
  const under = mix(deep.mul(0.7), shallow.mul(1.2), up);
  const underCol = mix(under, skyColor(vec3(0, 1, 0)).mul(1.1), window)
    .mul(day.mul(0.6).add(0.45))
    .add(sunColor.mul(pow(max(dot(view.negate(), sunDir), 0), 40)).mul(day)) as V3;

  const m = new MeshBasicNodeMaterial({ transparent: true });
  m.positionNode = positionGeometry.add(wv.offset);
  m.colorNode = vec4(select(frontFacing, col, underCol), select(frontFacing, alpha, float(0.92)));
  return { material: m, u, depthMap };
}

// ---------------------------------------------------------------------------- thành phần

/** `tidal`: mặt biển dâng hạ theo thủy triều (đảo sinh tồn); Battleground để mặc định (mặt biển đứng yên ở mốc). */
export function Water({ world, tidal = false }: { world: World; tidal?: boolean }) {
  const headroom = tidal ? TIDE_HEADROOM : 0;
  const depthMap = useMemo(() => bakeDepth(world, headroom), [world, headroom]);
  useEffect(() => () => depthMap.dispose(), [depthMap]);
  // Số ô lưới theo mức chất lượng: đỉnh dồn về gần camera nên bớt ô chủ yếu làm thưa phần xa (sương mù che).
  const profile = useProfile();
  const segments = profile.water;
  const reflectScale = profile.reflect;
  // Biển hải chiến: nhìn xa hơn nhiều (đánh nhau ở tầm gần một cây số) nên tấm nước lớn hơn, lưới dày hơn; sóng
  // ngắn tắt dần theo khoảng cách (ô lưới ở xa to hơn bước sóng thì sóng răng cưa thành vân vòng, mảng loang).
  const big = (world.half ?? MAP_HALF_SIZE) >= 600;
  const size = big ? SIZE * 4.5 : SIZE;
  const geometry = useMemo(() => radialGrid(size, big ? Math.round(segments * 1.6) : segments, big ? 2.6 : 2.2), [segments, size, big]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<Mesh>(null);
  // Phản chiếu thật (đồ hoạ Cao): dựng lại cả vật liệu khi bật/tắt vì nó đổi cấu trúc shader.
  const reflection = useMemo(() => (reflectScale > 0 ? createReflection(reflectScale) : null), [reflectScale]);
  useEffect(() => () => reflection?.dispose(), [reflection]);
  const built = useMemo(() => makeWaterMaterial(world.half ?? MAP_HALF_SIZE, reflection), [reflection]); // eslint-disable-line react-hooks/exhaustive-deps
  const { material, u } = built;
  useEffect(() => () => material.dispose(), [material]);
  // Bản đồ rộng hẹp khác nhau (chiến trường rộng hơn đảo): tấm độ sâu phủ đúng cả bản đồ.
  useEffect(() => {
    u.uHalf.value = world.half ?? MAP_HALF_SIZE;
    // Lưới biển hải chiến thưa hơn (trải rộng): sóng ngắn tắt gần hơn.
    u.uWaveFade.value = big ? 1 : 1.8;
  }, [u, world, big]);
  built.depthMap.value = depthMap;
  u.uDepthBias.value = headroom;
  const scene = useThree((s) => s.scene);
  void scene;

  useFrame(({ clock, camera }) => {
    waterUniforms.uTime.value = clock.elapsedTime;
    // Gió to, bão thì sóng lớn hơn.
    const target = 1 + weatherFx.rain * 0.3 + weatherFx.storm * 1.1;
    waterUniforms.uWaveScale.value += (target - waterUniforms.uWaveScale.value) * 0.01;
    const day = 1 - sky.night;
    u.uDay.value = day;
    (u.uDeep.value as Color).copy(DEEP_NIGHT).lerp(DEEP_DAY, day);
    (u.uMid.value as Color).copy(MID_NIGHT).lerp(MID_DAY, day);
    (u.uShallow.value as Color).copy(SHALLOW_NIGHT).lerp(SHALLOW_DAY, day);
    (u.uScatter.value as Color).copy(SCATTER_DAY).multiplyScalar(day);
    u.uCloud.value = Math.max(0, weatherFx.cloud - 0.3) / 0.7;
    // Lưới đi theo camera, bám theo bước 2 m để đỉnh không trượt qua lại khi đi.
    const sea = WATER_LEVEL + waterUniforms.uTide.value;
    if (mesh.current) mesh.current.position.set(Math.round(camera.position.x / 2) * 2, sea, Math.round(camera.position.z / 2) * 2);
    // Chỉ vẽ mặt camera nhìn thấy (bỏ DoubleSide: đỡ nửa số điểm ảnh tô từ mặt sau sóng). Lặn thì nhìn mặt dưới
    // (cửa sổ Snell trong shader); sát mặt nước sóng có thể cao hơn mắt nên vẽ cả hai mặt.
    const above = camera.position.y - sea;
    const amp = 1.2 * waterUniforms.uWaveScale.value;
    material.side = above > amp ? FrontSide : above < -amp ? BackSide : DoubleSide;
    // Phản chiếu chỉ khi ở trên mặt nước, không quá cao (trên cao nhìn xuống gần như chỉ thấy màu nước), mặt nước hiện.
    if (reflection) {
      const on = !!mesh.current?.visible && camera.position.y > sea + 0.15 && camera.position.y < sea + 70;
      reflection.state.active = on;
      u.uReflect.value = on ? 1 : 0;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} material={material} position-y={WATER_LEVEL} frustumCulled={false}>
      {reflection && <primitive object={reflection.target} />}
    </mesh>
  );
}
