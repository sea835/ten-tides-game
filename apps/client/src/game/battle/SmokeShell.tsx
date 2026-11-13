import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import { BackSide, Color, FrontSide, SphereGeometry, Vector3, type Mesh } from "three";
import { NodeMaterial } from "three/webgpu";
import { Break, Discard, Fn, If, Loop, select, cameraPosition, dot, exp, float, floor, fract, length, max, min, mix, normalize, positionWorld, screenCoordinate, smoothstep, sqrt, uniform, vec3, vec4 } from "three/tsl";
import type { F, V3 } from "../gpu/slots.ts";
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

const hash3 = Fn(([p0]: [V3]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17);
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
});
const noise3 = Fn(([x]: [V3]) => {
  const i = floor(x);
  const f = fract(x);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const h = (dx: number, dy: number, dz: number) => hash3(i.add(vec3(dx, dy, dz)));
  return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), u.x), mix(h(0, 1, 0), h(1, 1, 0), u.x), u.y), mix(mix(h(0, 0, 1), h(1, 0, 1), u.x), mix(h(0, 1, 1), h(1, 1, 1), u.x), u.y), u.z);
});

/** Đồng phục của một khối khói (ghi bằng `.value` mỗi khung). */
function shellUniforms() {
  return {
    uCenter: uniform(new Vector3()),
    uRadius: uniform(1),
    uFloor: uniform(0),
    uDensity: uniform(0),
    uClear: uniform(new Vector3()),
    uTime: uniform(0),
    uSteps: uniform(8),
    uLit: uniform(new Color()),
    uShadow: uniform(new Color()),
  };
}
type ShellUniforms = ReturnType<typeof shellUniforms>;

/**
 * Vật liệu khối khói: mặt cầu vẽ bằng dò tia rút gọn trong fragment (đỉnh chuẩn, vị trí thế giới của điểm ảnh cho
 * hướng tia). Sương theo cảnh tính ở điểm vào của mặt cầu (ngoài khối) như bản cũ.
 */
function shellMaterial(u: ShellUniforms) {
  const m = new NodeMaterial();
  m.fragmentNode = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(ro));
    const oc = ro.sub(u.uCenter);
    const b = dot(oc, rd);
    const c = dot(oc, oc).sub(u.uRadius.mul(u.uRadius));
    const h0 = b.mul(b).sub(c);
    Discard(h0.lessThanEqual(0));
    const h = sqrt(max(h0, 0));
    const t0 = max(b.negate().sub(h), 0);
    // Phần chìm dưới đất không tính.
    const t1 = b.negate().add(h).toVar();
    If(rd.y.lessThan(-1e-4).and(ro.y.greaterThan(u.uFloor)), () => {
      t1.assign(min(t1, u.uFloor.sub(ro.y).div(rd.y)));
    });
    Discard(t1.lessThanEqual(t0));

    const dt = t1.sub(t0).div(u.uSteps);
    const jitter = hash3(vec3(screenCoordinate.xy, u.uTime));
    const tau = float(0).toVar();
    const lit = float(0).toVar();
    Loop(16, ({ i }) => {
      If(float(i).greaterThanEqual(u.uSteps), () => {
        Break();
      });
      const p = ro.add(rd.mul(t0.add(float(i).add(jitter).mul(dt))));
      const r = length(p.sub(u.uCenter)).div(u.uRadius);
      // Khói cuộn: nhiễu hai tầng trôi chậm lên trên, ăn mòn mép khối cho lởm chởm.
      const sp = p.mul(0.24).add(vec3(0, u.uTime.mul(-0.1), u.uTime.mul(0.04)));
      const n = noise3(sp).mul(0.65).add(noise3(sp.mul(2.7).add(7.1)).mul(0.35));
      // Mép khối lồi lõm thành từng cụm (ngưỡng theo nhiễu), lõi vẫn đặc kín.
      const d = float(1).sub(smoothstep(n.mul(0.5).add(0.35), n.mul(0.3).add(0.75), r)).mul(n.mul(0.9).add(0.55)).toVar();
      // Lựu đạn vừa thổi thủng: ống trống thẳng đứng quanh chỗ nổ.
      const hole = smoothstep(u.uClear.z.mul(0.75), u.uClear.z, length(p.xz.sub(u.uClear.xy)));
      d.mulAssign(select(u.uClear.z.greaterThan(0), hole, float(1)));
      const dTau = d.mul(dt).mul(1.15);
      tau.addAssign(dTau);
      // Trên đỉnh sáng (nắng chiếu), chân khối và lõi tối hơn.
      lit.addAssign(dTau.mul(p.y.sub(u.uFloor).div(u.uRadius.mul(1.4)).add(0.35).sub(float(1).sub(r).mul(0.25)).clamp(0, 1)));
    });
    const alpha = float(1).sub(exp(tau.negate())).mul(u.uDensity);
    Discard(alpha.lessThan(0.004));
    const k = select(tau.greaterThan(1e-4), lit.div(tau), float(0.5));
    return vec4(mix(u.uShadow.xyz, u.uLit.xyz, k), alpha);
  })();
  m.transparent = true;
  m.depthWrite = false;
  return m;
}

const LIT = new Color("#d9dcdf");
const SHADOW = new Color("#8a9096");
const NIGHT = new Color("#1d232b");
const tmp = new Vector3();

/** Số bước dò tia theo mức đồ hoạ (giữa khối đã đục kín sau vài bước, thêm bước chỉ làm mép mịn hơn). */
const STEPS = { high: 12, medium: 9, low: 6 } as const;

function Shell({ smoke, steps }: { smoke: SmokeLike; steps: number }) {
  const mesh = useRef<Mesh>(null);
  const { material, u } = useMemo(() => {
    const u = shellUniforms();
    return { material: shellMaterial(u), u };
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, clock }) => {
    const m = mesh.current;
    if (!m) return;
    const age = SMOKE.seconds - smoke.timeLeft;
    // Nở nhanh trong giây đầu (server che tầm nhìn ngay khi khói bung), tan dần hai giây cuối.
    const grow = 1 - Math.pow(1 - Math.min(1, Math.max(0, age) / 1.1), 3);
    const radius = SMOKE_SIGHT.radius * (0.35 + 0.65 * grow);
    (u.uCenter.value).set(smoke.x, smoke.y + SMOKE_SIGHT.lift, smoke.z);
    u.uRadius.value = radius;
    u.uFloor.value = smoke.y - 1;
    u.uDensity.value = Math.min(1, Math.max(0, age) * 2) * Math.min(1, Math.max(0, smoke.timeLeft) / 2);
    const clearR = smoke.clear > 0 ? SMOKE_CLEAR.radius * Math.min(1, smoke.clear / (SMOKE_CLEAR.seconds * 0.6)) : 0;
    u.uClear.value.set(smoke.cx, smoke.cz, clearR);
    u.uTime.value = clock.elapsedTime;
    // Màu khói theo ánh sáng trời: đêm tối sẫm, chớp loé thì sáng bừng.
    const day = 1 - sky.night;
    const flash = Math.min(1, weatherFx.flash);
    u.uLit.value.copy(NIGHT).lerp(LIT, Math.min(1, day + flash * 0.6));
    u.uShadow.value.copy(NIGHT).multiplyScalar(0.7).lerp(SHADOW, Math.min(1, day + flash * 0.6));
    m.position.set(smoke.x, smoke.y + SMOKE_SIGHT.lift, smoke.z);
    m.scale.setScalar(radius);
    // Camera trong khối: vẽ mặt sau, bỏ phép thử độ sâu (khói phủ lên mọi thứ trong tầm dây cung).
    const inside = tmp.copy(camera.position).sub(m.position).length() < radius + 0.35;
    // Ở ngoài thì vẽ mặt trước (có phép thử độ sâu: tường che thì không thấy khói), ở trong thì vẽ mặt sau.
    material.side = inside ? BackSide : FrontSide;
    // Ở trong khối thì dây cung dài, đục kín sau vài bước: bớt bước cho đỡ nặng (khói phủ cả màn hình).
    u.uSteps.value = inside ? Math.min(steps, 5) : steps;
    material.depthTest = !inside;
    m.visible = u.uDensity.value > 0.003;
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
