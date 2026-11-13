import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, PlaneGeometry, Vector2 } from "three";
import { NodeMaterial } from "three/webgpu";
import { Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cross, dot, float, floor, fract, mix, modelWorldMatrix, normalize, positionLocal, smoothstep, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import type { F, V2, V3 } from "./gpu/slots.ts";

// Ngọn lửa thật: tấm phẳng luôn xoay mặt về camera (chỉ xoay quanh trục đứng), trên đó nhiễu nhiều lớp cuộn
// lên trên, cắt theo hình giọt nước, tô theo dải màu từ đỏ sẫm ở mép tới vàng trắng ở lõi. Cộng sáng (additive)
// nên chồng hai ba tấm lệch nhau thành đám lửa dày, hậu kỳ bloom làm lửa toả quầng.

const hash = Fn(([p]: [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
const noise = Fn(([p]: [V2]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
});
function fbm(p0: V2): F {
  let p = p0;
  let a = 0.5;
  let s: F = float(0);
  for (let i = 0; i < 5; i++) {
    s = s.add(noise(p).mul(a));
    p = p.mul(2.1);
    a *= 0.5;
  }
  return s;
}

/** Nút lửa dùng chung cho mọi ngọn (uniform riêng từng vật liệu, nên cùng một chương trình shader). */
function flameMaterial(uTime: F, uSeed: F, uIntensity: F, uSize: V2) {
  const m = new NodeMaterial();
  // Tấm phẳng xoay quanh trục đứng về phía camera, dựng thẳng trong không gian thế giới.
  m.vertexNode = Fn(() => {
    const center = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const toCam = cameraPosition.sub(center).mul(vec3(1, 0, 1));
    const dir = normalize(toCam.add(vec3(1e-4, 0, 0)));
    const right = normalize(cross(vec3(0, 1, 0), dir));
    const world = center.add(right.mul(positionLocal.x.mul(uSize.x))).add(vec3(0, 1, 0).mul(positionLocal.y.add(0.5).mul(uSize.y)));
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
  })();
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const t = uTime.mul(1.6).add(uSeed.mul(10));
    // Nhiễu cuộn lên, uốn ngang theo một lớp nhiễu chậm cho lưỡi lửa lượn.
    const qx = vUv.x.mul(3).add(uSeed.mul(7)).toVar();
    const qy = vUv.y.mul(2.2).sub(t);
    qx.addAssign(fbm(vec2(vUv.y.mul(2).sub(t.mul(0.5)), uSeed)).sub(0.5).mul(1.4).mul(vUv.y));
    const n = fbm(vec2(qx, qy));
    // Hình giọt nước: rộng ở chân, nhọn ở ngọn.
    const x = vUv.x.sub(0.5).mul(2);
    const width = mix(0.95, 0.05, vUv.y.pow(0.8));
    const body = float(1).sub(smoothstep(width.mul(0.55), width, x.abs()));
    const fire = body.mul(n.mul(1.6).sub(vUv.y.mul(1.05)).add(0.25)).mul(smoothstep(0, 0.08, vUv.y)).clamp(0, 1);
    // Dải màu: đỏ sẫm → cam → vàng → trắng ngà.
    const c1 = mix(vec3(0.5, 0.05, 0), vec3(1, 0.35, 0.02), smoothstep(0, 0.35, fire));
    const c2 = mix(c1, vec3(1, 0.75, 0.2), smoothstep(0.35, 0.7, fire));
    const col = mix(c2, vec3(1, 0.95, 0.75), smoothstep(0.7, 1, fire));
    const alpha = smoothstep(0.02, 0.3, fire);
    return vec4(col.mul(alpha).mul(uIntensity).mul(2.2), alpha);
  })();
  m.transparent = true;
  m.depthWrite = false;
  m.blending = AdditiveBlending;
  m.side = DoubleSide;
  m.toneMapped = false;
  m.fog = false;
  return m;
}

const plane = new PlaneGeometry(1, 1, 1, 1);

export function Flame({ position, width = 1, height = 1.6, intensity = 1, seed = 0 }: { position: [number, number, number]; width?: number; height?: number; intensity?: number; seed?: number }) {
  const { material, uTime } = useMemo(() => {
    const uTime = uniform(0);
    return { material: flameMaterial(uTime, uniform(seed), uniform(intensity), uniform(new Vector2(width, height))), uTime };
  }, [seed, intensity, width, height]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    uTime.value = clock.elapsedTime;
  });
  return <mesh geometry={plane} material={material} position={position} frustumCulled={false} renderOrder={5} />;
}
