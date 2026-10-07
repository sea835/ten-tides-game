import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, PMREMGenerator, ShaderMaterial } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

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
  const { gl, scene } = useThree();
  useEffect(() => {
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
  const { geometry, material } = useMemo(() => {
    const pos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { time: { value: 0 }, color: { value: new Color(color) } },
      vertexShader: `uniform float time; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + time * 0.06, 3.0);
          p.x += sin(time * 0.3 + position.z * 3.0) * 0.15;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = 0.35 + 0.65 * fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
          gl_PointSize = 26.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(color, smoothstep(0.5, 0.0, d) * 0.5 * vA); }`,
    });
    return { geometry, material };
  }, [color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(({ clock }) => {
    material.uniforms.time!.value = clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/** Cột sáng mờ chiếu từ trên xuống bục (giả luồng sáng thể tích bằng một nón cộng màu). */
export function LightCone({ color, opacity, bottom, x = 0, top = 4 }: { color: string; opacity: number; bottom: number; x?: number; top?: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: { color: { value: new Color(color) }, opacity: { value: opacity } },
        vertexShader: "varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 color; uniform float opacity; varying float vY; void main(){ gl_FragColor = vec4(color, opacity * pow(1.0 - vY, 1.6)); }",
      }),
    [color, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[x, top / 2 + 0.1, 0]} material={material}>
      <cylinderGeometry args={[0.22, bottom, top - 0.2, 40, 1, true]} />
    </mesh>
  );
}
