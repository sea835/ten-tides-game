import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, Matrix4, MeshStandardMaterial, SphereGeometry, Vector3, type Group, type Mesh, type Object3D } from "three";
import { stockLength, supportOffset } from "../GunModel.tsx";
import { mulberry32 } from "../nature.ts";
import { facePoint } from "./head.ts";
import { withRim } from "./rim.ts";
import { TORSO, block, capsule, ellipsoid, loft, merge, ringAt, strap, type V3 } from "./shapes.ts";

// Phụ kiện động của người lính và cử động nhỏ của đầu, tách khỏi Character.tsx (chỉ gắn vào các khớp sẵn có):
// - Đồ treo lủng lẳng có quán tính lò xo: thẻ bài trên ngực, bình nước bên hông, dây súng võng dưới khẩu súng, đuôi
//   dây nén balo, ăng-ten bộ đàm. Lắc theo gia tốc thật của điểm treo (chạy, rẽ, tiếp đất, giật súng), trọng lực
//   kéo xuống, lò xo kéo về dáng nghỉ, không xuyên vào người.
// - Đầu liếc trước theo hướng đang quay người, thỉnh thoảng nhìn quanh khi đứng yên, mắt chớp mỗi 3–5 giây.
// Chỉ tính cho người ở gần (≤ 25 m) và đang hiện; người ở xa đã vẽ bằng đám đông instanced (FarCrowd).

/** Quá khoảng này (m) thì thôi tính đồ lắc, chớp mắt: nhìn không ra mà tốn. */
const NEAR = 25;
const NEAR2 = NEAR * NEAR;

const _cam = new Vector3();
const _pos = new Vector3();

/** Đang hiện thật (mọi cấp cha đều hiện) và ở gần camera. */
function nearAndShown(o: Object3D, camera: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  _pos.setFromMatrixPosition(o.matrixWorld);
  _cam.setFromMatrixPosition(camera.matrixWorld);
  return _pos.distanceToSquared(_cam) < NEAR2;
}

// ---------------------------------------------------------------------------- lò xo con lắc

interface DangleSpec {
  /** Điểm treo (toạ độ cha). */
  pivot: V3;
  /** Hướng từ điểm treo tới đầu món đồ lúc nghỉ (toạ độ cha). */
  rest: V3;
  /** Dài con lắc (m). */
  len: number;
  /** Độ cứng kéo về dáng nghỉ (1/s²), cản (1/s), hệ số trọng lực (dây vải cứng thì nhỏ). */
  stiff: number;
  damp: number;
  grav: number;
  /** Lệch tối đa khỏi dáng nghỉ (radian). */
  max: number;
  /** Mặt chặn (toạ độ cha): hướng con lắc phải có thành phần theo `wall` ≥ `wallMin` (khỏi xuyên vào ngực, hông). */
  wall?: V3;
  wallMin?: number;
  /** Bản lề: chỉ lắc quanh trục này (dây súng quay quanh đường nối hai khoen). */
  hinge?: V3;
}

const DOWN_G = new Vector3(0, -9.8, 0);
const _inv = new Matrix4();
const _p = new Vector3();
const _restW = new Vector3();
const _target = new Vector3();
const _acc = new Vector3();
const _d = new Vector3();
const _dl = new Vector3();
const _v3 = new Vector3();

interface DangleState {
  init: boolean;
  tip: Vector3;
  vel: Vector3;
  last: Vector3;
  rest: Vector3;
  wall: Vector3 | null;
  hinge: Vector3 | null;
  far: boolean;
}

/**
 * Con lắc lò xo cho một nhóm treo: nhóm đặt ở điểm treo, hình bên trong dựng sẵn ở dáng nghỉ (toạ độ cha, đã dời về
 * điểm treo). Mỗi khung: tính đầu con lắc trong thế giới (trọng lực + lò xo về dáng nghỉ + cản), giữ đúng độ dài, đổi
 * về toạ độ cha, chặn góc / mặt chặn / bản lề, rồi xoay nhóm từ hướng nghỉ sang hướng hiện tại. Không cấp phát.
 */
function useDangle(ref: RefObject<Group | null>, spec: DangleSpec) {
  const st = useRef<DangleState | null>(null);
  st.current ??= {
    init: false,
    tip: new Vector3(),
    vel: new Vector3(),
    last: new Vector3(),
    rest: new Vector3(...spec.rest).normalize(),
    wall: spec.wall ? new Vector3(...spec.wall).normalize() : null,
    hinge: spec.hinge ? new Vector3(...spec.hinge).normalize() : null,
    far: false,
  };
  useFrame(({ camera }, raw) => {
    const g = ref.current;
    const s = st.current!;
    const parent = g?.parent;
    if (!g || !parent) return;
    if (!nearAndShown(g, camera)) {
      // Ra xa: về dáng nghỉ một lần rồi thôi tính; lại gần thì bắt đầu lại từ dáng nghỉ.
      if (!s.far) {
        s.far = true;
        s.init = false;
        g.quaternion.identity();
      }
      return;
    }
    s.far = false;
    const dt = Math.min(raw, 1 / 30);
    if (dt <= 0) return;
    const P = parent.matrixWorld;
    _p.set(...spec.pivot).applyMatrix4(P);
    _restW.copy(s.rest).transformDirection(P);
    // Lần đầu, hoặc dịch chuyển tức thời (hồi sinh, dịch chỗ): đặt lại ở dáng nghỉ.
    if (!s.init || s.last.distanceToSquared(_p) > 2.25) {
      s.init = true;
      s.tip.copy(_p).addScaledVector(_restW, spec.len);
      s.vel.set(0, 0, 0);
    }
    s.last.copy(_p);
    _target.copy(_p).addScaledVector(_restW, spec.len);
    _acc.copy(DOWN_G).multiplyScalar(spec.grav).add(_v3.subVectors(_target, s.tip).multiplyScalar(spec.stiff));
    s.vel.addScaledVector(_acc, dt).multiplyScalar(Math.exp(-spec.damp * dt));
    s.tip.addScaledVector(s.vel, dt);
    // Giữ đúng độ dài; bỏ phần vận tốc dọc dây.
    _d.subVectors(s.tip, _p);
    if (_d.lengthSq() < 1e-10) _d.copy(_restW);
    _d.normalize();
    // Sang toạ độ cha để chặn.
    _inv.copy(P).invert();
    _dl.copy(_d).transformDirection(_inv);
    if (s.hinge) {
      _dl.addScaledVector(s.hinge, -_dl.dot(s.hinge));
      if (_dl.lengthSq() < 1e-8) _dl.copy(s.rest);
      _dl.normalize();
    }
    if (s.wall) {
      const k = _dl.dot(s.wall) - (spec.wallMin ?? 0);
      if (k < 0) _dl.addScaledVector(s.wall, -k).normalize();
    }
    const ang = _dl.angleTo(s.rest);
    if (ang > spec.max) {
      // Kéo về trên mặt phẳng chứa hai hướng cho đúng góc tối đa.
      _v3.copy(_dl).addScaledVector(s.rest, -Math.cos(ang)).normalize();
      _dl.copy(s.rest).multiplyScalar(Math.cos(spec.max)).addScaledVector(_v3, Math.sin(spec.max));
    }
    g.quaternion.setFromUnitVectors(s.rest, _dl);
    // Ghi ngược đầu con lắc đã chặn vào thế giới để lần sau tính tiếp từ đó.
    _d.copy(_dl).transformDirection(P);
    s.tip.copy(_p).addScaledVector(_d, spec.len);
    s.vel.addScaledVector(_d, -s.vel.dot(_d));
  });
}

/** Một món treo: nhóm đặt ở điểm treo, hình dời về điểm treo. */
function Dangle({ spec, children }: { spec: DangleSpec; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useDangle(ref, spec);
  return (
    <group ref={ref} position={spec.pivot}>
      <group position={[-spec.pivot[0], -spec.pivot[1], -spec.pivot[2]]}>{children}</group>
    </group>
  );
}

// ---------------------------------------------------------------------------- vật liệu

const mats = new Map<string, MeshStandardMaterial>();
/** Thép thẻ bài, xích: sáng, bóng (loé nắng). */
function steel(opacity: number): MeshStandardMaterial {
  const key = `steel|${opacity}`;
  let m = mats.get(key);
  if (!m) {
    m = withRim(new MeshStandardMaterial({ color: "#a7abaf", metalness: 0.9, roughness: 0.28, transparent: opacity < 1, opacity }));
    m.userData.detail = "none";
    mats.set(key, m);
  }
  return m;
}

/** Hình nhỏ: không đổ bóng, ẩn khi người ở xa (RemotePlayers ẩn mọi khối đánh dấu `tiny`). */
const TINY = { tiny: true };

// ---------------------------------------------------------------------------- hình (dựng một lần)

const geoCache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Ngực trước ở độ cao y (toạ độ eo), có áo giáp thì tính ra ngoài tấm chắn. */
const chestZ = (y: number, armored: boolean) => (armored ? 0.172 : ringAt(TORSO, y, "f") + 0.008);

/** Thẻ bài: hai thẻ thép bo góc chồng lệch nhau, xích bi vòng lên cổ (toạ độ eo, dáng nghỉ). */
function tagsShape(armored: boolean): BufferGeometry {
  return cached(`tags|${armored}`, () => {
    const z = chestZ(0.34, armored);
    const parts: BufferGeometry[] = [];
    for (const s of [-1, 1]) parts.push(capsule(new Vector3(s * 0.045, 0.468, 0.075), new Vector3(s * 0.006, 0.372, z), 0.0018, 4, 1));
    const tag = (x: number, y: number, dz: number, rz: number) =>
      loft(
        [
          { y: 0.026, w: 0 },
          { y: 0.024, w: 0.012, f: 0.0012, n: 3 },
          { y: -0.024, w: 0.012, f: 0.0012, n: 3 },
          { y: -0.026, w: 0 },
        ].map((r) => ({ ...r, b: r.f })),
        10,
      )
        .rotateZ(rz)
        .translate(x, y, z + dz);
    parts.push(tag(0, 0.346, 0.002, 0.08), tag(0.007, 0.34, 0.0045, -0.16));
    parts.push(ellipsoid([0.0035, 0.0035, 0.0035], [0.002, 0.372, z + 0.002], undefined, [6, 4]));
    return merge(parts);
  });
}

/** Bình nước trong bao vải bên hông (toạ độ quay theo hông: +z hướng ra ngoài, treo xuống từ móc thắt lưng ở gốc). */
function canteenShape(): BufferGeometry {
  return cached("canteen", () =>
    merge([
      // Móc cài thắt lưng.
      block(0.03, 0.03, 0.008, [0, -0.012, 0.004]),
      // Thân bình (bao vải): khối bo tròn dẹt, nắp bao.
      loft(
        [
          { y: -0.02, w: 0 },
          { y: -0.024, w: 0.03, f: 0.02, b: 0.016, z: 0.024, n: 3 },
          { y: -0.04, w: 0.038, f: 0.026, b: 0.02, z: 0.026, n: 3 },
          { y: -0.15, w: 0.04, f: 0.028, b: 0.02, z: 0.026, n: 3 },
          { y: -0.165, w: 0.032, f: 0.022, b: 0.016, z: 0.026, n: 3 },
          { y: -0.168, w: 0 },
        ],
        14,
      ),
      block(0.07, 0.022, 0.05, [0, -0.034, 0.029]),
    ]),
  );
}

/** Đuôi dây nén balo thừa ra, rủ xuống dưới đáy balo (toạ độ eo, dáng nghỉ). */
function tailShape(side: 1 | -1, bottom: number, back: number): BufferGeometry {
  return cached(`tail|${side}|${bottom}|${back}`, () => merge([...strap([[side * 0.085, bottom + 0.012, back], [side * 0.087, bottom - 0.04, back - 0.004], [side * 0.088, bottom - 0.085, back - 0.002]], 0.026, 0.004, [0, bottom, 0])]));
}

/** Ăng-ten dẻo của bộ đàm (toạ độ eo, dáng nghỉ): hai đoạn mảnh dần. */
function antennaShape(): BufferGeometry {
  return cached("antenna", () => merge([capsule(new Vector3(0.09, 0.41, -0.165), new Vector3(0.1, 0.62, -0.19), 0.0035, 4, 1), capsule(new Vector3(0.1, 0.62, -0.19), new Vector3(0.105, 0.78, -0.22), 0.0028, 4, 1)]));
}

/** Dây súng (toạ độ súng): võng xuống dưới khẩu súng giữa khoen trước và khoen báng, cùng hai khoen kim loại. */
function slingShape(front: V3, rear: V3, sag: number): BufferGeometry {
  return cached(`sling|${front.join()}|${rear.join()}`, () => {
    const pts: V3[] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const drop = sag * 4 * t * (1 - t);
      pts.push([front[0] + (rear[0] - front[0]) * t, front[1] + (rear[1] - front[1]) * t - drop, front[2] + (rear[2] - front[2]) * t]);
    }
    const mid: V3 = [(front[0] + rear[0]) / 2 + 0.2, (front[1] + rear[1]) / 2, (front[2] + rear[2]) / 2];
    return merge(strap(pts, 0.022, 0.003, mid));
  });
}

// ---------------------------------------------------------------------------- gắn vào người

/**
 * Đồ treo trên nửa thân trên (gắn trong nhóm thân, toạ độ eo): thẻ bài trên ngực; đuôi dây nén balo; ăng-ten bộ đàm.
 */
export function TorsoDangles({ armor, pack, gear, metal, opacity }: { armor: number; pack: number; gear: MeshStandardMaterial; metal: MeshStandardMaterial; opacity: number }) {
  const armored = armor > 0;
  const tags = useMemo<DangleSpec>(() => {
    const pivot: V3 = [0, 0.47, 0.06];
    const z = chestZ(0.34, armored);
    const rest = new Vector3(0, 0.34 - pivot[1], z - pivot[2]);
    const len = rest.length();
    rest.normalize();
    // Mặt chặn: không lọt vào trong ngực (thẻ nằm áp ngực lúc đứng thẳng, cúi người thì đong đưa ra trước).
    return { pivot, rest: [rest.x, rest.y, rest.z], len, stiff: 25, damp: 2.6, grav: 1, max: 0.9, wall: [0, 0, 1], wallMin: rest.z - 0.02 };
  }, [armored]);
  const packBottom = pack === 1 ? 0.07 : pack === 3 ? 0.11 : 0;
  const packBack = pack === 1 ? -0.255 : -0.18;
  const tail = (side: 1 | -1): DangleSpec => ({ pivot: [side * 0.085, packBottom + 0.012, packBack], rest: [0, -1, -0.03], len: 0.09, stiff: 55, damp: 3.5, grav: 0.8, max: 0.8, wall: [0, 0, -1], wallMin: -0.2 });
  return (
    <>
      {/* Đổi áo giáp thì dựng lại (dáng nghỉ khác). */}
      <Dangle key={armored ? "vest" : "shirt"} spec={tags}>
        <mesh geometry={tagsShape(armored)} material={steel(opacity)} userData={TINY} />
      </Dangle>
      {(pack === 1 || pack === 3) &&
        ([1, -1] as const).map((s) => (
          <Dangle key={s} spec={tail(s)}>
            <mesh geometry={tailShape(s, packBottom, packBack)} material={gear} castShadow />
          </Dangle>
        ))}
      {pack === 2 && (
        // Ăng-ten: con lắc ngược (lò xo cứng giữ dựng đứng), rung lắc khi chạy, tiếp đất.
        <Dangle spec={{ pivot: [0.09, 0.41, -0.165], rest: [0.015, 0.37, -0.055], len: 0.37, stiff: 160, damp: 4, grav: 0.35, max: 0.6 }}>
          <mesh geometry={antennaShape()} material={metal} />
        </Dangle>
      )}
    </>
  );
}

/** Bình nước bên hông phải sau (gắn trong nhóm thân, cạnh thắt lưng). */
export function BeltDangles({ gear }: { gear: MeshStandardMaterial }) {
  // Đặt quanh vành thắt lưng như các túi khác (góc 0 là giữa bụng, âm là sang phải).
  const a = -2.25;
  const x = Math.sin(a) * 0.192;
  const z = Math.cos(a) * 0.14;
  return (
    <group position={[x, 0.975, z]} rotation-y={a}>
      <Dangle spec={{ pivot: [0, 0, 0], rest: [0, -1, 0], len: 0.1, stiff: 45, damp: 4.5, grav: 1, max: 0.75, wall: [0, 0, 1], wallMin: -0.12 }}>
        <mesh geometry={canteenShape()} material={gear} castShadow />
      </Dangle>
    </group>
  );
}

/** Dây súng võng dưới súng trường (gắn trong nhóm súng): lắc quanh đường nối hai khoen khi chạy, giật súng. */
export function GunSling({ weaponId, material }: { weaponId: string; material: MeshStandardMaterial }) {
  const sling = useMemo(() => {
    const stock = stockLength(weaponId);
    if (stock < 0.15 || weaponId === "rpg7") return null;
    // Khoen trước dưới ốp lót tay, khoen sau dưới báng; cả hai lệch sang trái súng (+x).
    const sup = supportOffset(weaponId, "");
    const front: V3 = [0.022, Math.min(sup[1], 0) - 0.02, sup[2] + 0.06];
    const rear: V3 = [0.03, -0.035, -stock + 0.07];
    const mid: V3 = [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2, (front[2] + rear[2]) / 2];
    const axis = new Vector3(rear[0] - front[0], rear[1] - front[1], rear[2] - front[2]).normalize();
    const sag = Math.min(0.16, Math.hypot(front[2] - rear[2], front[1] - rear[1]) * 0.22);
    // Hướng nghỉ: thẳng xuống, vuông góc với trục bản lề.
    const rest = new Vector3(0, -1, 0).addScaledVector(axis, axis.y).normalize();
    const spec: DangleSpec = { pivot: mid, rest: [rest.x, rest.y, rest.z], len: sag, stiff: 20, damp: 2.4, grav: 1, max: 1.1, hinge: [axis.x, axis.y, axis.z] };
    return { spec, geo: slingShape(front, rear, sag) };
  }, [weaponId]);
  if (!sling) return null;
  return (
    <Dangle key={weaponId} spec={sling.spec}>
      <mesh geometry={sling.geo} material={material} castShadow />
    </Dangle>
  );
}

// ---------------------------------------------------------------------------- đầu: liếc theo hướng quay, chớp mắt

let lidGeo: BufferGeometry | null = null;
let eyeCenters: [V3, V3] | null = null;
/** Mí trên dùng để chớp: chỏm cầu úp trên nhãn cầu (như mí trong head.ts, to hơn một chút để phủ kín khi nhắm). */
function lids() {
  lidGeo ??= new SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  eyeCenters ??= [-1, 1].map((s) => [s * 0.033, 0.106, facePoint(s * 0.033, 0.106).z - 0.0028] as V3) as [V3, V3];
  return { geo: lidGeo, centers: eyeCenters };
}
const LID_SCALE: V3 = [0.0141, 0.0135, 0.0112];
/** Góc mí lúc mở (trùng mí cố định) và lúc nhắm (úp kín mặt trước nhãn cầu). */
const LID_OPEN = 0.34;
const LID_SHUT = 1.62;

let seedN = 1;

/**
 * Bọc mọi thứ của đầu (gắn ngay trong nhóm đầu): xoay thêm chút theo hướng nhìn (đầu đi trước khi quay người, đứng
 * yên thì thỉnh thoảng liếc quanh), và hai mí chớp ngẫu nhiên mỗi 3–5 giây (đôi khi chớp hai lần liền).
 */
export function HeadRig({ skin, motion, children }: { skin: MeshStandardMaterial; motion?: () => { moving: boolean; aiming?: boolean; firing?: number; prone?: boolean }; children: ReactNode }) {
  const rig = useRef<Group>(null);
  const lidL = useRef<Mesh>(null);
  const lidR = useRef<Mesh>(null);
  const st = useRef<{ rand: () => number; yaw: number; rate: number; lastYaw: number; init: boolean; turn: number; glance: number; glanceP: number; nextGlance: number; nextBlink: number; blinkAt: number; double: boolean; t: number } | null>(null);
  if (!st.current) {
    const rand = mulberry32(seedN++ * 7919);
    st.current = { rand, yaw: 0, rate: 0, lastYaw: 0, init: false, turn: 0, glance: 0, glanceP: 0, nextGlance: 2 + rand() * 3, nextBlink: 1 + rand() * 3, blinkAt: -1, double: false, t: 0 };
  }
  const { geo, centers } = lids();
  useFrame(({ camera }, raw) => {
    const g = rig.current;
    const s = st.current!;
    if (!g || !g.parent) return;
    if (!nearAndShown(g, camera)) {
      s.init = false;
      return;
    }
    const dt = Math.min(raw, 0.1);
    if (dt <= 0) return;
    s.t += dt;
    // Tốc độ quay người (theo hướng thân trên trong thế giới), làm mượt.
    const e = g.parent.matrixWorld.elements;
    const yaw = Math.atan2(e[8]!, e[10]!);
    if (!s.init) {
      s.init = true;
      s.lastYaw = yaw;
    }
    let dy = yaw - s.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    else if (dy < -Math.PI) dy += Math.PI * 2;
    s.lastYaw = yaw;
    s.rate += (dy / dt - s.rate) * Math.min(1, dt * 8);
    const m = motion?.();
    const busy = !!m && (!!m.aiming || !!m.prone);
    // Đứng yên, không ngắm: thỉnh thoảng liếc sang một bên rồi nhìn lại.
    if (s.t > s.nextGlance) {
      const r = s.rand;
      const look = !busy && !m?.moving && r() < 0.7;
      s.glance = look ? (r() - 0.5) * 1.0 : 0;
      s.glanceP = look ? (r() - 0.4) * 0.18 : 0;
      s.nextGlance = s.t + (look ? 1.2 + r() * 1.8 : 2 + r() * 3);
    }
    if (busy || m?.moving) {
      s.glance = 0;
      s.glanceP = 0;
    }
    // Đầu đi trước hướng quay người một chút (dương là quay sang trái, +x).
    const lead = Math.max(-0.45, Math.min(0.45, s.rate * 0.11)) * (busy ? 0.35 : 1);
    s.turn += (lead + s.glance - s.turn) * Math.min(1, dt * 6);
    g.rotation.y = s.turn;
    g.rotation.x += (-s.glanceP - g.rotation.x) * Math.min(1, dt * 5);
    // Chớp mắt: mí sập xuống nhanh, mở ra chậm hơn (~0,15 s).
    if (s.t > s.nextBlink) {
      s.blinkAt = s.t;
      s.double = s.rand() < 0.15;
      s.nextBlink = s.t + 3 + s.rand() * 2;
    }
    const k = s.blinkAt < 0 ? 1 : (s.t - s.blinkAt) / 0.15;
    let shut = k < 1 ? (k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6) : 0;
    if (s.double && k >= 1 && k < 2.2) {
      const k2 = (k - 1.2) / 1;
      shut = k2 > 0 && k2 < 1 ? (k2 < 0.4 ? k2 / 0.4 : 1 - (k2 - 0.4) / 0.6) : 0;
    }
    for (const lid of [lidL.current, lidR.current]) {
      if (!lid) continue;
      lid.visible = shut > 0.02;
      lid.rotation.x = LID_OPEN + (LID_SHUT - LID_OPEN) * shut;
    }
  });
  return (
    <group ref={rig}>
      {children}
      <mesh ref={lidL} geometry={geo} material={skin} position={centers[1]} scale={LID_SCALE} visible={false} />
      <mesh ref={lidR} geometry={geo} material={skin} position={centers[0]} scale={LID_SCALE} visible={false} />
    </group>
  );
}
