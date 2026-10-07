import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdditiveBlending, BackSide, CanvasTexture, Color, SRGBColorSpace, ShaderMaterial, type Group, type PerspectiveCamera } from "three";
import { Character, type Motion } from "../game/Character.tsx";
import { pulseNeon } from "../game/skinMaterials.ts";
import { getGraphics, targetDpr } from "../game/graphics.ts";
import { Dust, Environment, LightCone, blobTexture } from "./stageParts.tsx";
import type { StudioLook, StudioSet, StudioSpin } from "./studioTypes.ts";
import { StageLoop } from "./stageLoop.tsx";
import { useDecorPaused } from "./decorPause.ts";

// Sân khấu 3D của sảnh chờ: nhân vật của người chơi (rằn ri, mũ áo giáp, súng đã lắp skin) đứng trên bục kim loại,
// trong phòng chỉ huy tác chiến hoặc trên bãi biển lúc hoàng hôn. Đèn ven (rim light) chiếu từ sau lưng tách dáng người
// khỏi nền, bụi lơ lửng trong luồng sáng. Canvas riêng, nhẹ: không vật lý, không hậu kỳ (sảnh không tải Rapier,
// postprocessing). Kéo chuột xoay nhân vật được xử lý ở StudioBackdrop (ghi vào `spin`), ở đây chỉ đọc.

const FOV = 30;
/** Khoảng cách camera tới nhân vật (m) và độ cao mắt camera. */
const DIST = 6.4;
const CAM_Y = 1.45;
const LOOK_Y = 1.02;
/** Bục: bán kính, cao. */
const PED_R = 0.78;
const PED_H = 0.22;

// ---------------------------------------------------------------------------- tư thế đứng chờ

/**
 * Dáng đứng chờ sống động: ngẩng cúi nhẹ theo nhịp thở, dồn trọng tâm qua lại, thỉnh thoảng giương súng lên vai ngắm
 * thử rồi hạ xuống. Một đối tượng dùng lại mỗi khung hình (không cấp phát).
 */
function useIdleMotion(): () => Motion {
  return useMemo(() => {
    const m: Motion = { moving: false, aiming: false, aimPitch: 0, lean: 0 };
    const t0 = performance.now();
    return () => {
      const t = (performance.now() - t0) / 1000;
      m.aimPitch = Math.sin(t * 0.9) * 0.05 - 0.04;
      m.lean = Math.sin(t * 0.37) * 0.07;
      // Mỗi 11 giây giương súng ngắm 1,6 giây.
      m.aiming = t % 11 > 8.2 && t % 11 < 9.8;
      return m;
    };
  }, []);
}

// ---------------------------------------------------------------------------- vật liệu, kết cấu vẽ tay

/** Màn hình tác chiến trên tường phòng chỉ huy: lưới bản đồ, vòng quét radar, vài chấm mục tiêu. */
function radarTexture(seed: number, tint: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#03080d";
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = tint;
  g.globalAlpha = 0.18;
  g.lineWidth = 1;
  for (let x = 0; x <= 256; x += 16) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 160);
    g.stroke();
  }
  for (let y = 0; y <= 160; y += 16) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(256, y + 0.5);
    g.stroke();
  }
  g.globalAlpha = 0.55;
  g.lineWidth = 1.5;
  const cx = 128;
  const cy = 80;
  for (const r of [22, 44, 66]) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  // Vệt quét.
  const sweep = g.createRadialGradient(cx, cy, 0, cx, cy, 70);
  sweep.addColorStop(0, tint);
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = 0.35;
  g.fillStyle = sweep;
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, 70, seed, seed + 0.9);
  g.closePath();
  g.fill();
  // Chấm mục tiêu (ngẫu nhiên cố định theo seed).
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.globalAlpha = 0.95;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 3 === 0 ? "#ff3355" : tint;
    g.fillRect(20 + rnd() * 216, 12 + rnd() * 136, 4, 4);
  }
  // Chữ toạ độ ở góc.
  g.font = "10px monospace";
  g.fillStyle = tint;
  g.globalAlpha = 0.7;
  g.fillText(`GRID ${(seed * 1000).toFixed(0).padStart(4, "0")}-N`, 8, 152);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Bầu trời hoàng hôn: dải màu dọc trên quả cầu lớn (một shader nhỏ, không cần ảnh). */
function sunsetSky(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color("#141a3a") },
      mid: { value: new Color("#7a3f5c") },
      low: { value: new Color("#ff9a4a") },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(low, mid, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c, 1.0); }",
  });
}

/** Mặt biển chiều: gần thì xanh thẫm, xa dần ánh màu trời hoàng hôn (giả phản chiếu, không tốn). */
function sunsetSea(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { near: { value: new Color("#0b1d2e") }, far: { value: new Color("#b85a4a") } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader:
      "uniform vec3 near; uniform vec3 far; varying vec3 vW; void main(){ float t = smoothstep(-8.0, -60.0, vW.z); gl_FragColor = vec4(mix(near, far, pow(t, 1.6)), 1.0); }",
  });
}

/** Vệt nắng lấp lánh trên mặt biển: những gạch sáng ngắn nằm ngang, dày dần về phía mặt trời, mờ hai mép. */
function glitterTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    // Phía xa (đầu ảnh, gần mặt trời) dày và sáng hơn.
    const y = Math.pow(v, 1.8) * 512;
    const spread = 0.5 - Math.abs(Math.random() - 0.5);
    const x = 64 + (Math.random() - 0.5) * 128 * (0.35 + 0.65 * (y / 512)) * spread * 2;
    const a = (1 - y / 512) * 0.9 * Math.random();
    g.fillStyle = `rgba(255,${200 + Math.floor(Math.random() * 55)},150,${a.toFixed(3)})`;
    g.fillRect(x, y, 2 + Math.random() * 10 * (1 - y / 600), 1.5);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------- bục đứng

function Pedestal({ glow }: { glow: string }) {
  const blob = useMemo(blobTexture, []);
  useEffect(() => () => blob.dispose(), [blob]);
  return (
    <group>
      <mesh position={[0, PED_H / 2, 0]}>
        <cylinderGeometry args={[PED_R, PED_R + 0.06, PED_H, 48]} />
        <meshStandardMaterial color="#2a3139" metalness={0.9} roughness={0.32} />
      </mesh>
      {/* Mặt bục: thép phay tối, viền phát sáng. */}
      <mesh position={[0, PED_H + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[PED_R - 0.02, 48]} />
        <meshStandardMaterial color="#1a1f25" metalness={0.85} roughness={0.45} />
      </mesh>
      <mesh position={[0, PED_H + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PED_R - 0.07, PED_R - 0.045, 64]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      <mesh position={[0, PED_H * 0.35, 0]}>
        <torusGeometry args={[PED_R + 0.035, 0.008, 6, 72]} />
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, PED_H + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.3, 1.3]} />
        <meshBasicMaterial map={blob} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------- hai bối cảnh

function CommandRoom() {
  const screens = useMemo(() => [radarTexture(0.31, "#00f2fe"), radarTexture(0.77, "#00f2fe"), radarTexture(0.54, "#ffd700")], []);
  useEffect(() => () => screens.forEach((t) => t.dispose()), [screens]);
  return (
    <group>
      <color attach="background" args={["#05080c"]} />
      <fog attach="fog" args={["#05080c", 6, 16]} />
      {/* Sàn thép, lưới bản đồ mờ. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0b1015" metalness={0.75} roughness={0.42} />
      </mesh>
      <gridHelper args={[24, 48, "#0d4a55", "#0b2a33"]} position={[0, 0.003, 0]} />
      {/* Tường cong phía sau, dải đèn xanh và màn hình tác chiến. */}
      <mesh position={[0, 2.2, 0]} rotation={[0, Math.PI, 0]}>
        <cylinderGeometry args={[6.5, 6.5, 4.4, 48, 1, true, -Math.PI * 0.42, Math.PI * 0.84]} />
        <meshStandardMaterial color="#0e141b" metalness={0.6} roughness={0.55} side={BackSide} />
      </mesh>
      {[-0.55, 0, 0.55].map((a, i) => (
        <mesh key={a} position={[Math.sin(a) * 6.3, 2.1, -Math.cos(a) * 6.3]} rotation={[0, -a, 0]}>
          <planeGeometry args={[2.3, 1.45]} />
          <meshBasicMaterial map={screens[i]} toneMapped={false} />
        </mesh>
      ))}
      {[0.6, 3.7].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[0, Math.PI, 0]}>
          <cylinderGeometry args={[6.45, 6.45, 0.035, 48, 1, true, -Math.PI * 0.42, Math.PI * 0.84]} />
          <meshBasicMaterial color="#00c8e0" toneMapped={false} side={BackSide} transparent opacity={0.8} />
        </mesh>
      ))}
      <hemisphereLight args={["#9fc6ff", "#0a0e14", 0.35]} />
      {/* Đèn chính phía trước chếch trái (ấm), đèn ven xanh và trắng từ sau lưng. */}
      <directionalLight position={[2.5, 3.5, 4]} intensity={1.5} color="#ffe9cf" />
      <directionalLight position={[-2.6, 2.8, -3]} intensity={3.2} color="#00f2fe" />
      <directionalLight position={[2.8, 2.2, -3.2]} intensity={2.4} color="#dfe8ff" />
      <pointLight position={[0, 0.5, 1.4]} intensity={1.2} distance={3} color="#00f2fe" />
      <LightCone color="#7fe9ff" opacity={0.1} bottom={PED_R + 0.1} />
      <Dust color="#9feeff" />
    </group>
  );
}

function SunsetBeach() {
  const sky = useMemo(sunsetSky, []);
  const glitter = useMemo(glitterTexture, []);
  const sea = useMemo(sunsetSea, []);
  useEffect(
    () => () => {
      sky.dispose();
      glitter.dispose();
      sea.dispose();
    },
    [sky, glitter, sea],
  );
  return (
    <group>
      <color attach="background" args={["#ff9a4a"]} />
      <fog attach="fog" args={["#b8665a", 30, 140]} />
      <mesh material={sky}>
        <sphereGeometry args={[80, 32, 16]} />
      </mesh>
      {/* Mặt trời sắp lặn sau lưng nhân vật, vệt nắng vàng trên mặt biển. */}
      <mesh position={[-8, 3.4, -60]}>
        <circleGeometry args={[4.2, 48]} />
        <meshBasicMaterial color="#ffe2a0" toneMapped={false} fog={false} />
      </mesh>
      <mesh position={[-8, 3.4, -60.1]}>
        <circleGeometry args={[8, 48]} />
        <meshBasicMaterial color="#ffb060" toneMapped={false} fog={false} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, -30]}>
        <planeGeometry args={[200, 60]} />
        <primitive object={sea} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.13]} position={[-4.6, -0.24, -34]}>
        <planeGeometry args={[7, 52]} />
        <meshBasicMaterial map={glitter} color="#ffc47a" toneMapped={false} transparent blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Bãi cát, dải cát ướt bóng nước sát mép sóng. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2]}>
        <planeGeometry args={[80, 14]} />
        <meshStandardMaterial color="#6e5241" roughness={0.97} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, -6]}>
        <planeGeometry args={[80, 2.4]} />
        <meshStandardMaterial color="#3d3036" metalness={0.3} roughness={0.25} />
      </mesh>
      <hemisphereLight args={["#ffb27a", "#2a2440", 0.5]} />
      <directionalLight position={[2.5, 3, 4]} intensity={1.1} color="#ffd9b0" />
      {/* Nắng chiều ngược sáng: viền cam rực quanh dáng người. */}
      <directionalLight position={[-2, 1.6, -4]} intensity={4} color="#ff9d52" />
      <directionalLight position={[3, 2.4, -3]} intensity={1.4} color="#ffc7a0" />

      <Dust color="#ffd9a6" />
    </group>
  );
}

// ---------------------------------------------------------------------------- camera, nhân vật

/**
 * Camera điện ảnh: nhích nhẹ theo thời gian (như máy quay cầm tay chậm), lùi ra khi màn hình dọc, dời khung để nhân vật
 * đứng ở `spin.focus` (toạ độ màn hình −1 trái … 1 phải), chừa chỗ cho bảng giao diện.
 */
function CameraRig({ spin }: { spin: StudioSpin }) {
  const shift = useRef(0);
  useFrame(({ camera, size, clock }, dt) => {
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    let dist = DIST * (aspect < 0.8 ? 1.25 : 1);
    // Chỗ trống bên trái hẹp: lùi camera cho cả bục (rộng chừng 1,7 m) lọt vừa 85% khoảng trống.
    if (spin.focus < 0) {
      const free = (spin.focus + 1) * size.width;
      dist = Math.min(11, Math.max(dist, (1.7 * size.width) / (2 * tan * aspect * 0.85 * free)));
    }
    const halfW = tan * dist * aspect;
    const want = -spin.focus * halfW;
    shift.current += (want - shift.current) * Math.min(1, dt * 4);
    const t = clock.elapsedTime;
    cam.position.set(shift.current + Math.sin(t * 0.21) * 0.12, CAM_Y + Math.sin(t * 0.33) * 0.04, dist);
    cam.lookAt(shift.current, LOOK_Y, 0);
  });
  return null;
}

function Hero({ look, spin }: { look: StudioLook; spin: StudioSpin }) {
  const group = useRef<Group>(null);
  const motion = useIdleMotion();
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    // Thả tay ra thì xoay theo quán tính rồi chậm dần; lâu không chạm thì lắc nhẹ qua lại quanh góc nghiêng 3/4.
    if (!spin.dragging) {
      spin.yaw += spin.vel * dt;
      spin.vel *= Math.exp(-dt * 3);
      if (performance.now() - spin.touched > 4000) {
        const rest = 0.55 + Math.sin(clock.elapsedTime * 0.25) * 0.15;
        // Về góc nghỉ theo đường ngắn nhất (xoay nhiều vòng rồi cũng không quay ngược mấy vòng).
        const d = Math.atan2(Math.sin(rest - spin.yaw), Math.cos(rest - spin.yaw));
        spin.yaw += d * Math.min(1, dt * 0.8);
      }
    }
    g.rotation.y = spin.yaw;
    // Thở: nhún rất nhẹ.
    g.position.y = PED_H + Math.sin(clock.elapsedTime * 1.6) * 0.004;
    pulseNeon(clock.elapsedTime);
  });
  return (
    <group ref={group} position={[0, PED_H, 0]}>
      <Character
        color={look.color}
        outfit={look.outfit}
        armor={look.armor}
        helmet={look.helmet}
        weapon={look.weapon}
        sight={look.sight}
        atts={look.atts}
        gunSkin={look.skin}
        motion={motion}
      />
    </group>
  );
}

export default function StudioStage({ look, set, spin }: { look: StudioLook; set: StudioSet; spin: StudioSpin }) {
  const paused = useDecorPaused();
  // Đang kéo xoay hay nhân vật còn quay theo quán tính: vẽ mượt 60 khung; đứng yên làm nền thì 30 là đủ.
  const boost = useCallback(() => spin.dragging || Math.abs(spin.vel) > 0.05 || performance.now() - spin.touched < 600, [spin]);
  return (
    // Nền sảnh không cần nét như trong trận: vẽ tối đa 1,25 điểm ảnh mỗi điểm CSS (màn Retina 2x vẽ ít hơn 2,5 lần).
    // Canvas đục (alpha: false): trình duyệt khỏi phải trộn trong suốt với trang web phía dưới mỗi khung.
    <Canvas frameloop="never" dpr={Math.min(1.25, targetDpr(getGraphics()))} camera={{ fov: FOV, near: 0.1, far: 200, position: [0, CAM_Y, DIST] }} gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}>
      <StageLoop fps={30} boost={boost} paused={paused} />
      <Environment intensity={set === "command" ? 0.35 : 0.45} />
      <CameraRig spin={spin} />
      {set === "command" ? <CommandRoom /> : <SunsetBeach />}
      <Pedestal glow={set === "command" ? "#00f2fe" : "#ffd27a"} />
      <Suspense fallback={null}>
        <Hero look={look} spin={spin} />
      </Suspense>
    </Canvas>
  );
}
