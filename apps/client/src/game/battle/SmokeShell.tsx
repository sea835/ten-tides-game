import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import { BackSide, Color, FrontSide, ShaderMaterial, SphereGeometry, UniformsLib, UniformsUtils, Vector3, type Mesh } from "three";
import { SMOKE, SMOKE_CLEAR, SMOKE_SIGHT } from "@tentides/content";
import type { SmokeState } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { useQuality } from "../graphics.ts";
import { sky, weatherFx } from "../shared.ts";

// Khối khói của bom khói: một vòm bán cầu khói đục (quả cầu tâm nhích lên khỏi mặt đất, nửa dưới chìm trong đất),
// vẽ bằng dò tia rút gọn trong shader: tia nhìn đi qua bao nhiêu khói (chiều dài dây cung × mật độ có nhiễu cuộn) thì
// đục bấy nhiêu, nên giữa khối đặc kín hoàn toàn, mép mỏng mềm và lởm chởm như khói thật. Cỡ khối khớp đúng phép
// thử tầm nhìn của bot trên server (SMOKE_SIGHT): người chơi cũng như bot, không nhìn xuyên qua được. Các cụm khói
// billboard (Effects.tsx) bay quanh mép cho đám khói cuồn cuộn, khối này lo phần "che kín".

/** Đám khói tối thiểu cần cho bộ vẽ (khớp SmokeState). */
export interface SmokeLike {
  x: number;
  y: number;
  z: number;
  timeLeft: number;
  clear: number;
  cx: number;
  cz: number;
}

/** Khói giả chỉ trên máy mình, để thử hình ảnh khi dev (window.__tentides.devSmoke). */
export const devSmokes = new Map<string, SmokeLike>();

/** Duyệt mọi đám khói đang có (state của server, cộng khói thử khi dev). */
export function forEachSmoke(room: IslandRoom, fn: (key: string, smoke: SmokeLike) => void) {
  for (const [key, smoke] of room.state.smokes as unknown as Map<string, SmokeState>) fn(key, smoke);
  if (import.meta.env.DEV) for (const [key, smoke] of devSmokes) fn(key, smoke);
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uFloor;
  uniform float uDensity;
  uniform vec3 uClear;
  uniform float uTime;
  uniform int uSteps;
  uniform vec3 uLit;
  uniform vec3 uShadow;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec3 oc = ro - uCenter;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - uRadius * uRadius;
    float h = b * b - c;
    if (h <= 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    // Phần chìm dưới đất không tính.
    if (rd.y < -1e-4 && ro.y > uFloor) t1 = min(t1, (uFloor - ro.y) / rd.y);
    if (t1 <= t0) discard;

    float len = t1 - t0;
    float dt = len / float(uSteps);
    float jitter = hash(vec3(gl_FragCoord.xy, uTime));
    float tau = 0.0;
    float lit = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= uSteps) break;
      vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
      vec3 q = p - uCenter;
      float r = length(q) / uRadius;
      // Khói cuộn: nhiễu hai tầng trôi chậm lên trên, ăn mòn mép khối cho lởm chởm.
      vec3 s = p * 0.24 + vec3(0.0, -uTime * 0.1, uTime * 0.04);
      float n = noise(s) * 0.65 + noise(s * 2.7 + 7.1) * 0.35;
      // Mép khối lồi lõm thành từng cụm (ngưỡng theo nhiễu), lõi vẫn đặc kín.
      float d = 1.0 - smoothstep(0.35 + 0.5 * n, 0.75 + 0.3 * n, r);
      d *= 0.55 + 0.9 * n;
      // Lựu đạn vừa thổi thủng: ống trống thẳng đứng quanh chỗ nổ.
      if (uClear.z > 0.0) d *= smoothstep(uClear.z * 0.75, uClear.z, length(p.xz - uClear.xy));
      float dTau = d * dt * 1.15;
      tau += dTau;
      // Trên đỉnh sáng (nắng chiếu), chân khối và lõi tối hơn.
      lit += dTau * clamp(0.35 + (p.y - uFloor) / (uRadius * 1.4) - (1.0 - r) * 0.25, 0.0, 1.0);
    }
    float alpha = (1.0 - exp(-tau)) * uDensity;
    if (alpha < 0.004) discard;
    float k = tau > 1e-4 ? lit / tau : 0.5;
    vec3 col = mix(uShadow, uLit, k);
    float fogK = smoothstep(fogNear, fogFar, t0);
    col = mix(col, fogColor, fogK);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

const LIT = new Color("#d9dcdf");
const SHADOW = new Color("#8a9096");
const NIGHT = new Color("#1d232b");
const tmp = new Vector3();

/** Số bước dò tia theo mức đồ hoạ (giữa khối đã đục kín sau vài bước, thêm bước chỉ làm mép mịn hơn). */
const STEPS = { high: 12, medium: 9, low: 6 } as const;

function Shell({ smoke, steps }: { smoke: SmokeLike; steps: number }) {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uCenter: { value: new Vector3() },
            uRadius: { value: 1 },
            uFloor: { value: 0 },
            uDensity: { value: 0 },
            uClear: { value: new Vector3() },
            uTime: { value: 0 },
            uSteps: { value: 8 },
            uLit: { value: new Color() },
            uShadow: { value: new Color() },
          },
        ]),
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, clock }) => {
    const m = mesh.current;
    if (!m) return;
    const u = material.uniforms;
    const age = SMOKE.seconds - smoke.timeLeft;
    // Nở nhanh trong giây đầu (server che tầm nhìn ngay khi khói bung), tan dần hai giây cuối.
    const grow = 1 - Math.pow(1 - Math.min(1, Math.max(0, age) / 1.1), 3);
    const radius = SMOKE_SIGHT.radius * (0.35 + 0.65 * grow);
    (u.uCenter!.value as Vector3).set(smoke.x, smoke.y + SMOKE_SIGHT.lift, smoke.z);
    u.uRadius!.value = radius;
    u.uFloor!.value = smoke.y - 1;
    u.uDensity!.value = Math.min(1, Math.max(0, age) * 2) * Math.min(1, Math.max(0, smoke.timeLeft) / 2);
    const clearR = smoke.clear > 0 ? SMOKE_CLEAR.radius * Math.min(1, smoke.clear / (SMOKE_CLEAR.seconds * 0.6)) : 0;
    (u.uClear!.value as Vector3).set(smoke.cx, smoke.cz, clearR);
    u.uTime!.value = clock.elapsedTime;
    // Màu khói theo ánh sáng trời: đêm tối sẫm, chớp loé thì sáng bừng.
    const day = 1 - sky.night;
    const flash = Math.min(1, weatherFx.flash);
    (u.uLit!.value as Color).copy(NIGHT).lerp(LIT, Math.min(1, day + flash * 0.6));
    (u.uShadow!.value as Color).copy(NIGHT).multiplyScalar(0.7).lerp(SHADOW, Math.min(1, day + flash * 0.6));
    m.position.set(smoke.x, smoke.y + SMOKE_SIGHT.lift, smoke.z);
    m.scale.setScalar(radius);
    // Camera trong khối: vẽ mặt sau, bỏ phép thử độ sâu (khói phủ lên mọi thứ trong tầm dây cung).
    const inside = tmp.copy(camera.position).sub(m.position).length() < radius + 0.35;
    // Ở ngoài thì vẽ mặt trước (có phép thử độ sâu: tường che thì không thấy khói), ở trong thì vẽ mặt sau.
    material.side = inside ? BackSide : FrontSide;
    // Ở trong khối thì dây cung dài, đục kín sau vài bước: bớt bước cho đỡ nặng (khói phủ cả màn hình).
    u.uSteps!.value = inside ? Math.min(steps, 5) : steps;
    material.depthTest = !inside;
    m.visible = u.uDensity!.value > 0.003;
  });

  return <mesh ref={mesh} geometry={SPHERE} material={material} frustumCulled={false} renderOrder={5} />;
}

const SPHERE = new SphereGeometry(1, 28, 18);

/** Mọi đám khói đang có: mỗi đám một khối khói đặc. */
export function SmokeShells({ room }: { room: IslandRoom }) {
  const [keys, setKeys] = useState<string[]>([]);
  const steps = STEPS[useQuality()];
  useEffect(() => {
    const cb = Callbacks.get(room);
    const refresh = () => setKeys([...(room.state.smokes as unknown as Map<string, SmokeState>).keys()]);
    const a = cb.onAdd("smokes", refresh);
    const r = cb.onRemove("smokes", refresh);
    refresh();
    if (import.meta.env.DEV) {
      // Dev: thả khói thử ngay trên máy mình (không qua server), xoá bằng devSmoke().
      const w = window as unknown as { __tentides?: Record<string, unknown> };
      w.__tentides ??= {};
      w.__tentides.devSmoke = (x?: number, y?: number, z?: number) => {
        if (x === undefined || y === undefined || z === undefined) devSmokes.clear();
        else devSmokes.set(`dev${devSmokes.size}`, { x, y, z, timeLeft: SMOKE.seconds, clear: 0, cx: 0, cz: 0 });
        refresh();
      };
    }
    return () => {
      a();
      r();
    };
  }, [room]);
  // Khói thử khi dev cũng tự đếm giờ.
  useFrame((_, dt) => {
    if (!import.meta.env.DEV || devSmokes.size === 0) return;
    for (const [key, s] of devSmokes) {
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) devSmokes.delete(key);
    }
  });
  const list: [string, SmokeLike][] = [];
  for (const key of keys) {
    const s = (room.state.smokes as unknown as Map<string, SmokeState>).get(key);
    if (s) list.push([key, s]);
  }
  if (import.meta.env.DEV) for (const entry of devSmokes) list.push(entry);
  return (
    <>
      {list.map(([key, s]) => (
        <Shell key={key} smoke={s} steps={steps} />
      ))}
    </>
  );
}
