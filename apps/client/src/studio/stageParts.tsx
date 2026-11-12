import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry } from "three";
import { NodeMaterial, PMREMGenerator, type WebGPURenderer } from "three/webgpu";
import { attribute, cameraProjectionMatrix, dot, float, fract, length, modelViewMatrix, positionGeometry, pow, sin, smoothstep, uniform, uv, vec2, vec4, viewportSize } from "three/tsl";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { F, V3 } from "../game/gpu/slots.ts";

// Mảnh dựng cảnh dùng chung cho sân khấu sảnh chờ (StudioStage) và bục vinh danh cuối trận (PodiumStage): ánh sáng
// môi trường cho kim loại, bụi lơ lửng trong luồng sáng, cột sáng giả thể tích, vệt tối dưới chân.

/** Vệt tối mềm dưới chân (thay cho bóng đổ thật, đỡ tốn). */
export function blobTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.75)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Ánh sáng môi trường phòng chụp cho kim loại (bục, súng, skin vàng/chrome), không cần file HDR. */
export function Environment({ intensity }: { intensity: number }) {
  const { gl: glRaw, scene } = useThree();
  const gl = glRaw as unknown as WebGPURenderer;
  useEffect(() => {
    // PMREMGenerator của three/webgpu (node); renderer đã `init()` xong ở makeRenderer nên fromScene dùng được ngay.
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

// ---------------------------------------------------------------------------- bụi lơ lửng trong luồng sáng

const DUST = 140;

export function Dust({ color }: { color: string }) {
  const { geometry, material, time } = useMemo(() => {
    // WebGPU không có điểm to hơn 1 điểm ảnh: mỗi hạt bụi là một ô vuông hướng về camera (billboard), dựng từ một
    // thuộc tính instance `seed` (vị trí gốc), kích thước tính theo điểm ảnh như gl_PointSize cũ.
    const base = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("uv", base.getAttribute("uv"));
    const pos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    geometry.setAttribute("seed", new InstancedBufferAttribute(pos, 3));
    geometry.instanceCount = DUST;
    base.dispose();

    const time = uniform(0);
    const seed = attribute("seed", "vec3") as V3;
    const wobble = sin(time.mul(0.3).add(seed.z.mul(3))).mul(0.15);
    const y = time.mul(0.06).add(seed.y).mod(3);
    const mv = modelViewMatrix.mul(vec4(seed.x.add(wobble), y, seed.z, 1));
    const vA = fract(sin(dot(seed.xz, vec2(12.9898, 78.233))).mul(43758.5453)).mul(0.65).add(0.35) as F;
    // Đường kính 26 / độ sâu điểm ảnh (như gl_PointSize cũ) đổi sang kích thước theo hệ camera:
    // px * độ sâu * 2 / (proj[1][1] * chiều cao khung) = 52 / (proj[1][1] * chiều cao khung), không phụ thuộc độ sâu.
    const worldSize = float(52).div(cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y.mul(viewportSize.y));
    const corner = positionGeometry.xy.mul(worldSize);
    const clip = cameraProjectionMatrix.mul(vec4(mv.xy.add(corner), mv.z, 1));
    const d = length(uv().sub(0.5));
    const material = new NodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = AdditiveBlending;
    material.fog = false;
    material.vertexNode = clip;
    material.fragmentNode = vec4(uniform(new Color(color)), smoothstep(0.5, 0, d).mul(0.5).mul(vA));
    return { geometry, material, time };
  }, [color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(({ clock }) => {
    time.value = clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** Cột sáng mờ chiếu từ trên xuống bục (giả luồng sáng thể tích bằng một nón cộng màu). */
export function LightCone({ color, opacity, bottom, x = 0, top = 4 }: { color: string; opacity: number; bottom: number; x?: number; top?: number }) {
  const material = useMemo(() => {
    const m = new NodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.side = DoubleSide;
    m.blending = AdditiveBlending;
    m.fog = false;
    m.fragmentNode = vec4(uniform(new Color(color)), pow(float(1).sub(uv().y), 1.6).mul(opacity));
    return m;
  }, [color, opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[x, top / 2 + 0.1, 0]} material={material}>
      <cylinderGeometry args={[0.22, bottom, top - 0.2, 40, 1, true]} />
    </mesh>
  );
}
