import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CanvasTexture, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, SRGBColorSpace, ShaderMaterial, Vector3, type PerspectiveCamera } from "three";
import { Character, type Motion } from "../game/Character.tsx";
import { pulseNeon } from "../game/skinMaterials.ts";
import { getGraphics, targetDpr } from "../game/graphics.ts";
import { Environment, LightCone, blobTexture } from "../studio/stageParts.tsx";

// Bục vinh danh 3D cuối trận: ba người điểm cao nhất đứng trên bục 1-2-3 với dáng ăn mừng (hạng nhất chĩa súng lên
// trời bắn mừng, hạng nhì đứng lắc vai, hạng ba giương súng thủ thế), mưa giấy kim tuyến, đèn rọi từng bục. Camera
// điện ảnh lia chậm vòng quanh bục rồi dừng ở góc chính diện. Canvas riêng, nạp lười (VictoryPodium là phần vỏ).

export interface PodiumHero {
  id: string;
  name: string;
  place: 1 | 2 | 3;
  color: string;
  outfit: string;
  weapon: string;
  sight: string;
  skin: string;
}

/** Vị trí, độ cao bục, màu kim loại theo hạng. */
const STEP: Record<1 | 2 | 3, { x: number; h: number; yaw: number; metal: string; glow: string }> = {
  1: { x: 0, h: 0.9, yaw: 0, metal: "#4a3c12", glow: "#ffd700" },
  2: { x: -1.55, h: 0.6, yaw: 0.32, metal: "#3a4048", glow: "#d6e2f0" },
  3: { x: 1.55, h: 0.42, yaw: -0.32, metal: "#3f2a1c", glow: "#e08a4a" },
};
const STEP_W = 1.3;
const STEP_D = 1.2;
/** Thời lượng cú lia máy mở màn (giây). */
const ORBIT_SECONDS = 9;

/** Số hạng in nổi trên mặt trước bục. */
function digitTexture(n: number, color: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "700 104px 'Chakra Petch', 'Rajdhani', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = color;
  g.fillText(String(n), 64, 70);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Dáng ăn mừng theo hạng (một đối tượng dùng lại mỗi khung hình). */
function useVictoryMotion(place: 1 | 2 | 3): () => Motion {
  return useMemo(() => {
    const m: Motion = { moving: false, aiming: place !== 2, aimPitch: 0, lean: 0, firing: 0 };
    const t0 = performance.now() + place * 370;
    return () => {
      const t = (performance.now() - t0) / 1000;
      if (place === 1) {
        // Chĩa súng lên trời, cứ 3 giây bắn mừng ba phát.
        m.aimPitch = 1.1 + Math.sin(t * 0.8) * 0.06;
        const cycle = t % 3;
        m.firing = Math.floor(t / 3) * 3 + (cycle > 0.4 ? 1 : 0) + (cycle > 0.62 ? 1 : 0) + (cycle > 0.84 ? 1 : 0);
        m.lean = Math.sin(t * 0.5) * 0.08;
      } else if (place === 2) {
        m.aimPitch = 0.3 + Math.sin(t * 1.1) * 0.08;
        m.lean = Math.sin(t * 1.3) * 0.4;
      } else {
        m.aimPitch = 0.04 + Math.sin(t * 0.7) * 0.03;
        m.lean = 0.3 + Math.sin(t * 0.6) * 0.1;
      }
      return m;
    };
  }, [place]);
}

function Step({ place }: { place: 1 | 2 | 3 }) {
  const s = STEP[place];
  const digit = useMemo(() => digitTexture(place, s.glow), [place, s.glow]);
  const blob = useMemo(blobTexture, []);
  useEffect(
    () => () => {
      digit.dispose();
      blob.dispose();
    },
    [digit, blob],
  );
  return (
    <group position={[s.x, 0, 0]}>
      <mesh position={[0, s.h / 2, 0]}>
        <boxGeometry args={[STEP_W, s.h, STEP_D]} />
        <meshStandardMaterial color={s.metal} metalness={0.85} roughness={0.35} />
      </mesh>
      {/* Viền sáng mép trên và số hạng mặt trước. */}
      <mesh position={[0, s.h + 0.004, STEP_D / 2 - 0.02]}>
        <boxGeometry args={[STEP_W, 0.012, 0.04]} />
        <meshBasicMaterial color={s.glow} toneMapped={false} />
      </mesh>
      <mesh position={[0, s.h * 0.5, STEP_D / 2 + 0.002]}>
        <planeGeometry args={[Math.min(0.62, s.h * 0.95), Math.min(0.62, s.h * 0.95)]} />
        <meshBasicMaterial map={digit} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, s.h + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial map={blob} transparent depthWrite={false} />
      </mesh>
      <LightCone color={s.glow} opacity={place === 1 ? 0.12 : 0.07} bottom={0.75} top={5} />
    </group>
  );
}

function Hero({ hero }: { hero: PodiumHero }) {
  const s = STEP[hero.place];
  const motion = useVictoryMotion(hero.place);
  return (
    <group position={[s.x, s.h, 0]} rotation={[0, s.yaw, 0]}>
      <Character color={hero.color} outfit={hero.outfit} armor={2} helmet={2} weapon={hero.weapon} sight={hero.sight} gunSkin={hero.skin} motion={motion} />
    </group>
  );
}

// ---------------------------------------------------------------------------- mưa giấy kim tuyến

const CONFETTI = 220;

/** Giấy kim tuyến rơi xoay: mọi chuyển động tính trong shader theo thời gian (CPU không phải làm gì mỗi khung). */
function Confetti() {
  const { geometry, material } = useMemo(() => {
    const base = new PlaneGeometry(0.05, 0.085);
    const geometry = new InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute("position", base.getAttribute("position"));
    const seed = new Float32Array(CONFETTI * 4);
    const tint = new Float32Array(CONFETTI * 3);
    const palette = [new Color("#ffd700"), new Color("#ffae00"), new Color("#00f2fe"), new Color("#ff0844"), new Color("#ffffff")];
    for (let i = 0; i < CONFETTI; i++) {
      seed.set([Math.random(), Math.random(), Math.random(), 0.6 + Math.random() * 0.8], i * 4);
      const c = palette[i % palette.length]!;
      tint.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute("seed", new InstancedBufferAttribute(seed, 4));
    geometry.setAttribute("tint", new InstancedBufferAttribute(tint, 3));
    geometry.instanceCount = CONFETTI;
    const material = new ShaderMaterial({
      side: DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec4 seed; attribute vec3 tint; uniform float time; varying vec3 vC;
        void main(){
          float t = time * seed.w * 0.32 + seed.y * 6.0;
          float y = 5.2 - mod(t, 6.0);
          vec3 c = vec3(seed.x * 7.0 - 3.5 + sin(t * 1.3 + seed.z * 6.0) * 0.35, y, seed.z * 3.2 - 1.8);
          float a = t * 4.0 + seed.x * 10.0;
          vec3 p = position;
          p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
          float b = a * 0.7;
          p.yz = mat2(cos(b), -sin(b), sin(b), cos(b)) * p.yz;
          vC = tint * (0.45 + 0.55 * abs(cos(b)));
          gl_Position = projectionMatrix * viewMatrix * vec4(c + p, 1.0);
        }`,
      fragmentShader: "varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }",
    });
    return { geometry, material };
  }, []);
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
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------- camera, nhãn tên

const _head = new Vector3();

/**
 * Cú lia máy chậm: bắt đầu từ góc nghiêng thấp bên trái, vòng sang và tiến lại gần, dừng ở góc chính diện rồi trôi
 * nhẹ. `skip` (bấm Bỏ qua) thì nhảy ngay tới cuối. Mỗi khung chiếu vị trí đầu ba người lên màn hình để đặt nhãn tên.
 */
function CinemaRig({ skip, heroes, labels }: { skip: boolean; heroes: PodiumHero[]; labels: RefObject<(HTMLDivElement | null)[]> }) {
  const start = useRef(-1);
  useFrame(({ camera, clock, size }) => {
    const cam = camera as PerspectiveCamera;
    if (start.current < 0) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const u = skip ? 1 : Math.min(1, t / ORBIT_SECONDS);
    // Êm đầu êm cuối.
    const e = u * u * (3 - 2 * u);
    const drift = Math.sin(t * 0.18) * 0.08 * e;
    const angle = -1.25 + 1.25 * e + drift;
    // Khung hẹp (điện thoại): lùi xa thêm cho đủ ba bục.
    const narrow = Math.min(1.6, Math.max(1, 2 / (size.width / Math.max(1, size.height))));
    const radius = (10 - 2.2 * e) * narrow;
    const y = 0.7 + 1.5 * e;
    cam.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    cam.lookAt(0, 1.5 + 0.1 * e, 0);
    cam.updateMatrixWorld();
    const els = labels.current;
    if (!els) return;
    for (let i = 0; i < heroes.length; i++) {
      const el = els[i];
      if (!el) continue;
      const s = STEP[heroes[i]!.place];
      _head.set(s.x, s.h + 2.12, 0).project(cam);
      const visible = _head.z < 1;
      el.style.opacity = visible ? "1" : "0";
      el.style.transform = `translate(-50%, -100%) translate(${((_head.x + 1) / 2) * size.width}px, ${((1 - _head.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

function NeonPulse() {
  useFrame(({ clock }) => pulseNeon(clock.elapsedTime));
  return null;
}

export default function PodiumStage({ heroes, skip, labels }: { heroes: PodiumHero[]; skip: boolean; labels: RefObject<(HTMLDivElement | null)[]> }) {
  return (
    <Canvas dpr={Math.min(1.5, targetDpr(getGraphics()))} camera={{ fov: 32, near: 0.1, far: 80, position: [0, 1.6, 9] }} gl={{ antialias: true, powerPreference: "low-power" }}>
      <color attach="background" args={["#05080d"]} />
      <fog attach="fog" args={["#05080d", 9, 24]} />
      <Environment intensity={0.4} />
      <NeonPulse />
      <hemisphereLight args={["#9fc6ff", "#0a0e14", 0.35]} />
      <directionalLight position={[2, 4, 5]} intensity={1.6} color="#fff1dc" />
      <directionalLight position={[-3, 3, -4]} intensity={3} color="#00f2fe" />
      <directionalLight position={[3, 2.5, -4]} intensity={2.6} color="#ffcf6a" />
      {/* Sàn đen bóng, vòng sáng quanh bục. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#080b10" metalness={0.15} roughness={0.85} envMapIntensity={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[2.9, 2.95, 96]} />
        <meshBasicMaterial color="#ffd700" toneMapped={false} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[3.4, 3.42, 96]} />
        <meshBasicMaterial color="#00f2fe" toneMapped={false} transparent opacity={0.35} />
      </mesh>
      {([1, 2, 3] as const).map((p) => (
        <Step key={p} place={p} />
      ))}
      <Suspense fallback={null}>
        {heroes.map((h) => (
          <Hero key={h.id} hero={h} />
        ))}
      </Suspense>
      <Confetti />
      <CinemaRig skip={skip} heroes={heroes} labels={labels} />
    </Canvas>
  );
}
