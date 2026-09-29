import { useMemo, useRef, type Ref } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  BoxGeometry,
  Vector2,
  Vector3,
  Euler,
  type Group,
} from "three";
import { hitStopScale } from "./battle/runtime.ts";
import { ItemModel, LONG_ITEMS } from "./ItemModel.tsx";
import { GunModel, HelmetModel, KnifeModel, ThrowableModel, VestModel, aimLineHeight, stockLength, supportOffset } from "./GunModel.tsx";
import { camoTexture } from "./camo.ts";
import { mulberry32 } from "./nature.ts";
import type { DetailKind } from "./textures.ts";

export interface Motion {
  moving: boolean;
  running?: boolean;
  sitting?: boolean;
  /** Đang trượt (chạy rồi bấm ngồi). */
  sliding?: boolean;
  swimming?: boolean;
  /** Đang leo cây (id cây hoặc true). */
  climbing?: boolean | string;
  /** Động tác vừa làm (swing, chop, throw, shoot, stab, eat) và bộ đếm để diễn đúng một lần. */
  act?: string;
  actN?: number;
  /** Còn choáng / chóng mặt bao nhiêu giây. */
  stun?: number;
  dizzy?: number;
  /** Ngồi xổm (Battleground): hạ người, đi khom. */
  crouching?: boolean;
  /** Đang ngắm: giương súng lên vai. */
  aiming?: boolean;
  /** Góc ngẩng nhìn (radian, dương là nhìn lên). */
  aimPitch?: number;
  /** Bộ đếm phát bắn: mỗi lần tăng thì súng giật một cái. */
  firing?: number;
  /** Nòng súng sát vật cản (0–1): dựng súng lên (súng lục thì chĩa xuống) cho khỏi xuyên tường. */
  wall?: number;
  /** Đang thay đạn: tiến trình 0–1 (không thay thì bỏ trống). */
  reload?: number;
  /** Vừa rút món mới: 1 là đang ở dưới, về 0 là đã cầm chắc. */
  swap?: number;
  /** Đang rút chốt lựu đạn (tay vung ra sau chờ ném). */
  cook?: boolean;
  /** Tốc độ ngang thật (m/s): có thì nhịp bước khớp tốc độ (không lướt), không thì theo cờ đi / chạy. */
  speed?: number;
}

/** Mỗi động tác kéo dài bao lâu (giây). */
const ACT_SECONDS: Record<string, number> = { swing: 0.32, chop: 0.42, throw: 0.4, shoot: 0.35, stab: 0.3, eat: 0.9 };

// ---------------------------------------------------------------------------- tỉ lệ cơ thể (người cao ~1,78 m)

/** Khớp hông, dài đùi, dài cẳng chân (mắt cá ở y ≈ 0.09). */
const HIP_Y = 0.93;
const HIP_X = 0.095;
const THIGH = 0.43;
const SHIN = 0.41;
/** Eo: gốc xoay của nửa thân trên. Vai, dài cánh tay trên, cẳng tay (tính từ eo). */
const WAIST_Y = 1.0;
const SHOULDER_Y = 0.44;
const SHOULDER_X = 0.19;
const UPPER = 0.29;
const FORE = 0.26;
/** Gốc đầu (đỉnh cổ) tính từ eo. */
const NECK_Y = 0.55;

/** Ngồi bệt: hông hạ xuống chừng này, chân duỗi ra trước. */
const SIT_DROP = 0.74;
/** Ngồi xổm: hông hạ chừng này. */
const CROUCH_DROP = 0.45;

const SKIN = ["#f1c9a0", "#e0ac7e", "#c68a5e", "#9c6a44"];
const HAIR = ["#2b1d14", "#4a3020", "#7a4a26", "#1c1c1c", "#b07a3a"];

/** Chọn tông da và tóc cố định theo màu áo, để mỗi người trông khác nhau mà máy nào cũng giống. */
function looks(color: string) {
  const n = [...color].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7) >>> 0;
  return { skin: SKIN[n % SKIN.length]!, hair: HAIR[(n >>> 3) % HAIR.length]!, pants: new Color(color).multiplyScalar(0.35).getStyle() };
}

// ---------------------------------------------------------------------------- vật liệu dùng chung

const mats = new Map<string, MeshStandardMaterial>();

/** Vật liệu theo màu, loại vân, độ trong (tạo một lần, mọi nhân vật dùng chung). */
function mat(color: string, detail: DetailKind | "none", opacity: number, rough = 0.85): MeshStandardMaterial {
  const key = `${color}|${detail}|${opacity}|${rough}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: rough, transparent: opacity < 1, opacity });
    m.userData.detail = detail;
    m.userData.detailSpace = "object";
    // Da mặt nhỏ: vân da nhẹ thôi kẻo loang lổ như râu.
    if (detail === "skin") m.userData.detailStrength = 0.25;
    mats.set(key, m);
  }
  return m;
}

/** Vải rằn ri (có ảnh vân nên trình phủ vân bỏ qua). `tint` làm quần tối hơn áo một chút. */
function camoMat(outfit: string, tint: string, opacity: number): MeshStandardMaterial {
  const key = `camo|${outfit}|${tint}|${opacity}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color: tint, map: camoTexture(outfit), roughness: 0.92, transparent: opacity < 1, opacity });
    mats.set(key, m);
  }
  return m;
}

/** Sợi ghillie: màu theo đỉnh, hai mặt. */
function strandMat(opacity: number): MeshStandardMaterial {
  const key = `strand|${opacity}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 1, transparent: opacity < 1, opacity });
    m.userData.detail = "none";
    mats.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------- hình khối dùng chung

/** Ô vân rằn ri phủ chừng này mét vải. */
const CAMO_TILE = 0.45;

/**
 * Khối tiện tròn (thân, tay, chân) từ biên dạng [bán kính, y] theo y tăng dần. UV được nhân theo kích thước thật
 * để vân rằn ri to đều trên mọi bộ phận.
 */
function lathe(profile: [number, number][], segs: number): LatheGeometry {
  const g = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segs,
  );
  const rMax = Math.max(...profile.map(([r]) => r));
  const len = profile[profile.length - 1]![1] - profile[0]![1];
  const su = Math.max(1, Math.round((Math.PI * 2 * rMax) / CAMO_TILE));
  const sv = len / CAMO_TILE;
  const uv = g.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

const sphere = (w: number, h: number) => new SphereGeometry(1, w, h);

/** Mọi hình của nhân vật, dựng một lần khi cần. */
function makeGeometry() {
  return {
    // Thân trên từ eo lên vai (toạ độ eo): eo thon, ngực nở, vai xuôi vào cổ.
    torso: lathe(
      [
        [0.0, -0.07],
        [0.148, -0.06],
        [0.147, 0.02],
        [0.151, 0.1],
        [0.164, 0.19],
        [0.177, 0.28],
        [0.18, 0.35],
        [0.172, 0.41],
        [0.152, 0.46],
        [0.112, 0.5],
        [0.062, 0.53],
        [0.0, 0.545],
      ],
      20,
    ),
    // Hông và mông (toạ độ thân, y tuyệt đối).
    pelvis: lathe(
      [
        [0.0, 0.8],
        [0.08, 0.805],
        [0.135, 0.84],
        [0.163, 0.88],
        [0.17, 0.94],
        [0.162, 1.0],
        [0.15, 1.05],
        [0.0, 1.06],
      ],
      20,
    ),
    // Đùi (gốc ở khớp hông, chĩa xuống): to ở trên, thon về gối.
    thigh: lathe(
      [
        [0.0, -0.46],
        [0.05, -0.455],
        [0.06, -0.43],
        [0.066, -0.36],
        [0.078, -0.22],
        [0.086, -0.1],
        [0.09, -0.02],
        [0.084, 0.04],
        [0.0, 0.07],
      ],
      14,
    ),
    // Cẳng chân: bắp chân phồng, thon về mắt cá.
    shin: lathe(
      [
        [0.0, -0.43],
        [0.04, -0.42],
        [0.043, -0.38],
        [0.05, -0.28],
        [0.061, -0.14],
        [0.059, -0.06],
        [0.054, 0.0],
        [0.044, 0.035],
        [0.0, 0.045],
      ],
      14,
    ),
    upperArm: lathe(
      [
        [0.0, -0.31],
        [0.036, -0.3],
        [0.041, -0.27],
        [0.047, -0.16],
        [0.053, -0.06],
        [0.055, 0.0],
        [0.044, 0.04],
        [0.0, 0.055],
      ],
      12,
    ),
    foreArm: lathe(
      [
        [0.0, -0.268],
        [0.027, -0.262],
        [0.03, -0.24],
        [0.039, -0.14],
        [0.045, -0.06],
        [0.042, 0.0],
        [0.034, 0.03],
        [0.0, 0.04],
      ],
      12,
    ),
    ball: sphere(12, 8),
    small: sphere(10, 7),
    tiny: sphere(7, 5),
    skull: sphere(22, 16),
    jaw: sphere(16, 10),
    hair: new SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.53),
    neck: new CylinderGeometry(0.047, 0.055, 0.14, 14),
    collar: new CylinderGeometry(0.064, 0.074, 0.045, 16, 1, true),
    cuff: new CylinderGeometry(1, 1, 1, 12, 1, true),
    belt: new CylinderGeometry(1, 1, 1, 20, 1, true),
    box: new BoxGeometry(1, 1, 1),
    shaft: new CylinderGeometry(0.052, 0.056, 0.15, 12),
    bedroll: new CylinderGeometry(0.11, 0.11, 0.4, 10),
  };
}

let geoCache: ReturnType<typeof makeGeometry> | null = null;
const geo = () => (geoCache ??= makeGeometry());

// ---------------------------------------------------------------------------- ghillie

const GHILLIE_COLORS = ["#4b5a2c", "#5f6b36", "#3a4424", "#6f6440", "#7f7448", "#2f3a1f", "#56502e"];

/**
 * Chùm sợi ghillie mọc trên một mặt bầu dục (tâm c, bán trục r), chỉ ở vùng thoả `keep`. Mỗi sợi là dải lá
 * ba đốt rũ xuống theo trọng lực, pháp tuyến lấy theo mặt thân nên cả khối sáng tối mềm như một bụi cỏ.
 */
function strands(seed: number, count: number, c: [number, number, number], r: [number, number, number], keep: (n: Vector3) => boolean, len: [number, number]): BufferGeometry {
  const rand = mulberry32(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = new Vector3();
  const p = new Vector3();
  const d = new Vector3();
  const w = new Vector3();
  const color = new Color();
  const WIDTH = [0.35, 1, 0.75, 0.15];
  let made = 0;
  for (let tries = 0; made < count && tries < count * 30; tries++) {
    // Điểm ngẫu nhiên trên mặt cầu rồi kéo giãn thành bầu dục.
    n.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (n.lengthSq() > 1 || n.lengthSq() < 0.01) continue;
    n.normalize();
    if (!keep(n)) continue;
    made++;
    p.set(c[0] + n.x * r[0], c[1] + n.y * r[1], c[2] + n.z * r[2]);
    const normal = new Vector3(n.x / r[0], n.y / r[1], n.z / r[2]).normalize();
    d.copy(normal).multiplyScalar(0.6).add(new Vector3((rand() - 0.5) * 0.6, -0.65, (rand() - 0.5) * 0.6)).normalize();
    w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(d).normalize();
    const L = len[0] + rand() * (len[1] - len[0]);
    const width = 0.025 + rand() * 0.03;
    color.set(GHILLIE_COLORS[Math.floor(rand() * GHILLIE_COLORS.length)]!).multiplyScalar(0.8 + rand() * 0.4);
    const base = pos.length / 3;
    const q = p.clone();
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        d.add(new Vector3((rand() - 0.5) * 0.5, -0.55, (rand() - 0.5) * 0.5)).normalize();
        q.addScaledVector(d, L / 3);
      }
      const hw = (width * WIDTH[i]!) / 2;
      pos.push(q.x - w.x * hw, q.y - w.y * hw, q.z - w.z * hw, q.x + w.x * hw, q.y + w.y * hw, q.z + w.z * hw);
      for (let k = 0; k < 2; k++) {
        nor.push(normal.x, normal.y, normal.z);
        // Gốc sợi tối hơn ngọn (khuất trong đám).
        const shade = 0.65 + i * 0.12;
        col.push(color.r * shade, color.g * shade, color.b * shade);
      }
      if (i > 0) {
        const a = base + (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.userData.smooth = true;
  return g;
}

let ghillieCache: { torso: BufferGeometry; head: BufferGeometry; thigh: BufferGeometry; arm: BufferGeometry } | null = null;
function ghillie() {
  return (ghillieCache ??= {
    // Vai, lưng, ngực trên (toạ độ eo). Phía trước bụng thưa hơn để còn cầm súng.
    torso: strands(11, 260, [0, 0.27, -0.005], [0.2, 0.3, 0.15], (n) => n.y > -0.55 && (n.z < 0.35 || n.y > 0.45), [0.12, 0.3]),
    // Mũ trùm: đỉnh, sau gáy, hai bên; chừa mặt.
    head: strands(12, 80, [0, 0.11, -0.01], [0.11, 0.125, 0.12], (n) => n.y > -0.2 && !(n.z > 0.4 && n.y < 0.55), [0.08, 0.2]),
    thigh: strands(13, 45, [0, -0.18, 0], [0.095, 0.2, 0.09], (n) => n.y > -0.6, [0.1, 0.22]),
    arm: strands(14, 28, [0, -0.1, 0], [0.058, 0.13, 0.058], (n) => n.y > -0.5, [0.08, 0.18]),
  });
}

// ---------------------------------------------------------------------------- IK hai khúc cho tay cầm súng

const _dir = new Vector3();
const _bend = new Vector3();
const _elbow = new Vector3();
const _fore = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _basis = new Matrix4();
const _t = new Vector3();

/**
 * Đặt cánh tay trên và cẳng tay sao cho cổ tay chạm `target` (toạ độ thân trên), khuỷu hướng về phía `pole`.
 * Cánh tay trên xoay theo cơ sở dựng từ hướng khuỷu, cẳng tay chỉ gập quanh trục x của nó.
 */
function solveArm(upper: Group, fore: Group, shoulder: Vector3, target: Vector3, pole: Vector3) {
  _dir.subVectors(target, shoulder);
  const dist = Math.min(Math.max(_dir.length(), 0.08), UPPER + FORE - 0.004);
  _dir.normalize();
  const cosA = (UPPER * UPPER + dist * dist - FORE * FORE) / (2 * UPPER * dist);
  const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
  _bend.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_bend.lengthSq() < 1e-6) _bend.set(0, -1, 0).addScaledVector(_dir, _dir.y);
  _bend.normalize();
  _elbow.copy(_dir).multiplyScalar(Math.cos(A)).addScaledVector(_bend, Math.sin(A));
  // Hướng cẳng tay: từ khuỷu tới cổ tay.
  _fore.copy(_dir).multiplyScalar(dist).addScaledVector(_elbow, -UPPER).normalize();
  _y.copy(_elbow).negate();
  _z.copy(_fore).addScaledVector(_y, -_fore.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
  _z.normalize();
  _x.crossVectors(_y, _z);
  upper.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
  const cosB = (UPPER * UPPER + FORE * FORE - dist * dist) / (2 * UPPER * FORE);
  fore.rotation.set(-(Math.PI - Math.acos(Math.min(1, Math.max(-1, cosB)))), 0, 0);
}

const _gunPos = new Vector3();
const _gunQ = new Quaternion();
const _qA = new Quaternion();
const _eul = new Euler();
const _inv = new Matrix4();
const _anchor = new Vector3();
const _eye = new Vector3();
const _off = new Vector3();
const _grip = new Vector3();
const _support = new Vector3();
const _shR = new Vector3(-SHOULDER_X, SHOULDER_Y, 0);
const _shL = new Vector3(SHOULDER_X, SHOULDER_Y, 0);
const _poleR = new Vector3();
const _poleL = new Vector3();
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ---------------------------------------------------------------------------- nhân vật

type V3 = [number, number, number];

/** Một khối của nhân vật: hình và vật liệu dùng chung, đổ bóng và nhận bóng. */
function P({ g, m, p, s, r }: { g: BufferGeometry; m: MeshStandardMaterial; p?: V3; s?: V3 | number; r?: V3 }) {
  return <mesh geometry={g} material={m} position={p} scale={s} rotation={r} castShadow receiveShadow />;
}

/**
 * Nhân vật người: đầu có hàm, mũi, tai, mắt, lông mày, tóc; thân ngực eo hông; tay có khuỷu và bàn tay; chân có gối
 * và giày. Chân đặt ở y = 0, nhìn theo trục +z (bên phải nhân vật là -x). `motion` được đọc mỗi khung hình để tạo dáng.
 * Battleground: `outfit` (vải rằn ri), `armor`/`helmet` (cấp 0–3), `weapon` (súng cầm hai tay, ngắm theo `aimPitch`).
 */
export function Character({
  color,
  opacity = 1,
  carrying = false,
  held = "",
  motion,
  outfit,
  armor = 0,
  helmet = 0,
  weapon,
  sight = "",
  throwable = "",
  knife = false,
  ref,
}: {
  color: string;
  opacity?: number;
  /** Đang vác rương kho báu: ai nhìn cũng thấy. */
  carrying?: boolean;
  /** Món đang cầm trên tay phải. */
  held?: string;
  motion?: () => Motion;
  /** Trang phục rằn ri (id trong OUTFITS); không có thì mặc áo theo màu người chơi. */
  outfit?: string;
  /** Cấp áo giáp 0–3. */
  armor?: number;
  /** Cấp mũ 0–3. */
  helmet?: number;
  /** Súng đang cầm (id trong WEAPONS): cầm hai tay, được ưu tiên hơn `held`. */
  weapon?: string;
  /** Ống ngắm lắp trên súng đang cầm (id trong SIGHTS). */
  sight?: string;
  /** Lựu đạn, bom khói, bom choáng, mìn đang cầm trên tay phải. */
  throwable?: string;
  /** Tay không (đã cất súng): cầm dao. */
  knife?: boolean;
  ref?: Ref<Group>;
}) {
  const look = useMemo(() => looks(color), [color]);
  const G = geo();
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const shinL = useRef<Group>(null);
  const shinR = useRef<Group>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const foreL = useRef<Group>(null);
  const foreR = useRef<Group>(null);
  const handL = useRef<Group>(null);
  const handR = useRef<Group>(null);
  const knifeR = useRef<Group>(null);
  const body = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const gun = useRef<Group>(null);
  const butt = useRef<Group>(null);
  const stars = useRef<Group>(null);
  const swirl = useRef<Group>(null);
  const anim = useRef({ phase: 0, amount: 0, sit: 0, slide: 0, swim: 0, lie: 0, climb: 0, crouch: 0, aim: 0, run: 0, pitch: 0, kick: 0, wall: 0, fireN: -1, actN: -1, act: "", actT: 99, climbPhase: 0 });

  const gunId = weapon || "";
  const pistol = gunId === "p92" || gunId === "deagle";
  const itemInHand = gunId ? "" : held;

  useFrame((_, raw) => {
    // Chặn dt như LocalPlayer: dt thô khiến `a.actT` nhảy quá thời lượng trong một bước,
    // nên hành động một lần (swing/chop/throw/shoot) bị bỏ qua hoàn toàn, không phát ra gì.
    // Nhân hitstop thêm: nhân vật đứng lại một nhịp ngắn khi trúng đạn.
    const dt = Math.min(raw, 0.05) * hitStopScale();
    const m = motion?.() ?? { moving: false };
    const a = anim.current;
    const now = performance.now();
    // Động tác mới (máy khác thấy qua bộ đếm): bắt đầu diễn từ đầu. Lần đầu thấy thì bỏ qua.
    if (m.actN !== undefined && m.actN !== a.actN) {
      if (a.actN !== -1) {
        a.act = m.act ?? "";
        a.actT = 0;
      }
      a.actN = m.actN;
    }
    // Phát bắn mới: súng giật về sau, nòng hất lên rồi hồi lại.
    if (m.firing !== undefined && m.firing !== a.fireN) {
      if (a.fireN !== -1) a.kick = 1;
      a.fireN = m.firing;
    }
    a.kick *= Math.exp(-dt * 16);
    a.actT += dt;
    const ease = (k: number) => Math.min(1, dt * k);
    a.climb += ((m.climbing ? 1 : 0) - a.climb) * ease(8);
    if (m.climbing && m.moving) a.climbPhase += dt * 9;
    const crouching = !!m.crouching && !m.swimming && !m.climbing && !m.sitting && !m.sliding;
    a.crouch += ((crouching ? 1 : 0) - a.crouch) * ease(9);
    const target = m.moving ? (m.running && !crouching ? 1 : 0.6) : 0;
    a.amount += (target - a.amount) * ease(10);
    a.sit += (((m.sitting && !m.moving) || m.sliding ? 1 : 0) - a.sit) * ease(8);
    a.slide += ((m.sliding ? 1 : 0) - a.slide) * ease(12);
    a.swim += ((m.swimming ? 1 : 0) - a.swim) * ease(5);
    a.aim += ((m.aiming ? 1 : 0) - a.aim) * ease(12);
    a.run += ((m.running && m.moving && !m.aiming && !crouching ? 1 : 0) - a.run) * ease(8);
    a.pitch += ((m.aimPitch ?? 0) - a.pitch) * ease(20);
    a.wall += ((m.wall ?? 0) - a.wall) * ease(10);
    // Bơi tới thì nằm sấp gần ngang mặt nước; đứng yên thì đạp nước, người thẳng đứng.
    a.lie += ((m.swimming ? (m.moving ? 1.3 : 0.12) : 0) - a.lie) * ease(4);
    const crouch = a.crouch;
    // Đi khom thì bước ngắn, chậm hơn.
    // Nhịp bước: biết tốc độ thật thì mỗi bước đi đúng một sải (đi khom sải ngắn, chạy sải dài), chân không trượt trên đất.
    const stride = crouching ? 0.5 : m.running ? 1.05 : 0.7;
    const moving = a.amount > 0.05 || m.swimming;
    // Trần cao hơn trước (24) để bước ở tốc độ chạy 16 m/s còn khớp sải chân, không còn trượt nhẹ.
    const rate = m.swimming ? 7 : m.speed !== undefined ? Math.min(40, (Math.PI * m.speed) / stride) : m.running && !crouching ? 17 : 12.5 - 3 * crouch;
    if (moving) {
      a.phase += dt * rate;
    } else {
      // Dừng lại thì nội suy về bội số gần nhất của π cho bằng 0. Trước đây phase đứng yên giữa
      // chừng nên chân dừng ở góc ngẫu nhiên, khác nhau mỗi lần chạy.
      const near = Math.round(a.phase / Math.PI) * Math.PI;
      a.phase += (near - a.phase) * Math.min(1, dt * 10);
    }
    const swim = a.swim;
    const climb = a.climb;
    const sit = a.sit * (1 - swim);
    const slide = a.slide * (1 - swim);
    const amount = a.amount * (1 - 0.45 * crouch);
    const run = m.running ? 1 : 0;

    // ------------------------------------------------ chân: đùi, gối, cổ chân
    // Đi: đùi vung trước sau; gối gập khi chân đang đưa ra trước (pha vung), duỗi thẳng lúc chạm đất.
    const legPose = (side: 1 | -1) => {
      const ph = a.phase + (side === 1 ? 0 : Math.PI);
      const sw = Math.sin(ph) * 0.75 * amount;
      let thigh = sw;
      let knee = amount * (0.12 + (0.55 + 0.85 * run) * Math.max(0, -Math.cos(ph - 0.35)));
      // Ngồi xổm: chân trái chống trước, gối phải quỳ gần chạm đất; đi khom thì hai chân gập đều.
      const idleCrouch = 1 - Math.min(1, a.amount / 0.3);
      const kneelT = side === 1 ? -1.3 : -0.4;
      const kneelK = side === 1 ? 2.05 : 1.95;
      // Đi khom: đùi vung rõ trước sau, gối gập thêm khi nhấc chân (pha vung), duỗi ra khi chân chống sau.
      const walkK = Math.min(1, a.amount / 0.5);
      const cT = lerp(-1.08, kneelT, idleCrouch) + Math.sin(ph) * 0.5 * walkK;
      const cK = lerp(2.16, kneelK, idleCrouch) + (0.55 * Math.max(0, -Math.cos(ph - 0.35)) - 0.3 * Math.max(0, Math.cos(ph))) * walkK;
      thigh = lerp(thigh, cT, crouch);
      knee = lerp(knee, cK, crouch);
      // Ngồi bệt: đùi nằm ngang ra trước, gối hơi co.
      thigh = lerp(thigh, -1.42, sit);
      knee = lerp(knee, 0.25, sit);
      // Bơi: đập chân nhỏ và nhanh.
      thigh = lerp(thigh, Math.sin(a.phase * 2 + (side === 1 ? 0 : Math.PI)) * 0.35, swim);
      knee = lerp(knee, 0.25 + 0.2 * Math.sin(a.phase * 2 + (side === 1 ? 0.8 : 0.8 + Math.PI)), swim);
      // Leo cây: hai chân co quặp thay phiên đạp.
      const pull = Math.sin(a.climbPhase) * (side === 1 ? 1 : -1);
      thigh = lerp(thigh, -1.1 - pull * 0.4, climb);
      knee = lerp(knee, 1.35 + pull * 0.3, climb);
      // Cổ chân giữ bàn chân gần song song mặt đất (quỳ thì mũi giày chống xuống).
      const flat = -(thigh + knee);
      const kneelFoot = side === -1 ? (1.25 + flat) * crouch * idleCrouch : 0;
      const foot = flat * (1 - swim * 0.6) * (1 - climb * 0.5) + kneelFoot + (1 - sit) * (1 - crouch) * amount * 0.25 * Math.sin(ph + 0.6);
      return { thigh, knee, foot };
    };
    for (const [side, leg, shin, foot] of [
      [1, legL, shinL, footL],
      [-1, legR, shinR, footR],
    ] as const) {
      const p = legPose(side);
      if (leg.current) {
        leg.current.rotation.x = p.thigh;
        // Ngồi thì hai chân hơi dạng; ngồi xổm thì hai gối mở ra.
        leg.current.rotation.z = side * (0.04 + 0.1 * sit + 0.12 * crouch);
      }
      if (shin.current) shin.current.rotation.x = p.knee;
      if (foot.current) foot.current.rotation.x = p.foot;
    }

    // ------------------------------------------------ tay khi không cầm súng (và khi đang bơi, leo)
    const swing = Math.sin(a.phase) * 0.75 * amount * (1 - swim);
    const stroke = swim * (a.amount > 0.05 ? 1 : 0.35);
    const pull = Math.sin(a.climbPhase);
    // Khuỷu: hơi co khi đi, co nhiều khi chạy.
    const elbowWalk = (0.18 + amount * (0.35 + 0.95 * run)) * (1 - sit) * (1 - swim) + 0.45 * sit + 0.15 * swim;
    let armLx = ((swing * 0.9 * (1 - sit) - 0.75 * sit - 0.7 * slide) * (1 - swim) + (-Math.PI + Math.sin(a.phase) * 1.6) * stroke) * (1 - climb) + (-2.6 + pull * 0.45) * climb;
    let armRx = ((-swing * 0.9 * (1 - sit) - 0.75 * sit) * (1 - swim) + (-Math.PI - Math.sin(a.phase) * 1.6) * stroke) * (1 - climb) + (-2.6 - pull * 0.45) * climb;
    let elbowL = elbowWalk * (1 - climb) + 0.35 * climb;
    let elbowR = elbowL;
    // Ngồi xổm tay tì lên gối.
    armLx = lerp(armLx, -0.55, crouch * 0.8);
    armRx = lerp(armRx, -0.35, crouch * 0.8);
    elbowL = lerp(elbowL, 0.9, crouch * 0.8);
    elbowR = lerp(elbowR, 0.8, crouch * 0.8);
    // Đang cầm đồ thì tay phải hơi đưa ra trước.
    if (itemInHand && climb < 0.5 && swim < 0.5) {
      armRx = armRx * 0.5 - 0.3;
      elbowR = 0.55;
    }
    // Cầm lựu đạn: tay phải đưa ra trước ngực; rút chốt thì vung tay ra sau lên cao chờ ném. Cầm dao: tay thủ thấp.
    if (!gunId && (throwable || knife) && climb < 0.5 && swim < 0.5) {
      armRx = m.cook ? -2.7 : throwable ? -0.6 : -0.45;
      elbowR = m.cook ? 1.5 : throwable ? 1.35 : 1.1;
    }
    // Động tác một lần: vung, chặt, ném, bắn, đâm, ăn.
    const dur = ACT_SECONDS[a.act] ?? 0;
    let lunge = 0;
    let twist = 0;
    let acting = false;
    if (a.actT < dur) {
      const k = a.actT / dur;
      const snap = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
      acting = a.act !== "shoot";
      switch (a.act) {
        case "swing":
          armRx = -2.4 + 2.9 * Math.min(1, k * 2.2);
          elbowR = 0.5 * (1 - k);
          twist = Math.sin(k * Math.PI) * 0.5;
          break;
        case "chop":
          armRx = -3.1 + 3.5 * Math.min(1, Math.max(0, k - 0.2) * 2);
          elbowR = 0.25;
          lunge = Math.sin(k * Math.PI) * 0.2;
          break;
        case "throw":
          armRx = k < 0.45 ? -2.9 * (k / 0.45) : -2.9 + 2.6 * ((k - 0.45) / 0.55);
          elbowR = k < 0.45 ? 1.4 * (k / 0.45) : 1.4 * (1 - (k - 0.45) / 0.55);
          twist = Math.sin(k * Math.PI) * 0.4;
          break;
        case "shoot":
          armRx = -1.55 + snap * 0.35;
          elbowR = 0.1;
          break;
        case "stab":
          armRx = -1.5 + (1 - snap) * 0.3;
          elbowR = (1 - snap) * 0.9;
          lunge = snap * 0.45;
          break;
        case "eat":
          armRx = -0.75 + Math.sin(a.actT * 18) * 0.08;
          elbowR = 2.15;
          break;
      }
    }

    // ------------------------------------------------ thân: nhún, ngả, hạ thấp
    // Đâm dao thì cất súng ra sau lưng một nhịp, dao hiện trong tay phải.
    const stabbing = a.act === "stab" && a.actT < (ACT_SECONDS.stab ?? 0);
    const withGun = !!gunId && climb < 0.3 && swim < 0.3 && !stabbing;
    if (knifeR.current) knifeR.current.visible = (knife || stabbing) && climb < 0.5 && swim < 0.5;
    if (body.current) {
      const bob = a.amount < 0.05 ? Math.sin(now / 700) * 0.008 : Math.abs(Math.cos(a.phase)) * 0.05 * amount;
      // Xoay quanh gót chân nên phải nhấc người lên theo góc nằm để đầu vẫn nhô khỏi mặt nước.
      body.current.position.y = (bob * (1 - sit) - SIT_DROP * sit - CROUCH_DROP * crouch) * (1 - swim) + 0.95 * Math.sin(a.lie) + Math.sin(a.phase * 0.5) * 0.04 * swim;
      // Chạy thì người đổ về trước; ngồi thì hơi ngả ra sau, trượt thì ngả hẳn ra sau; leo cây thì áp vào thân cây.
      body.current.rotation.x = (0.1 * a.amount * (m.running ? 1.5 : 1) * (1 - slide) * (1 - crouch) - 0.4 * slide) * (1 - swim) * (1 - climb) + a.lie + 0.32 * climb + lunge * 0.4;
      body.current.position.z = lunge * 0.5 - 0.2 * climb;
      body.current.rotation.y = twist;
      // Chóng mặt thì loạng choạng.
      body.current.rotation.z = (m.dizzy ?? 0) > 0 ? Math.sin(now / 260) * 0.12 : 0;
    }
    const aimW = withGun ? a.aim : 0;
    const pitch = Math.max(-1.2, Math.min(1.2, a.pitch));
    if (torso.current) {
      // Ngồi xổm thì lưng khom về trước; ngắm súng trường thì vai trái đưa lên trước; ngắm cao thấp thì lưng cong theo.
      torso.current.rotation.x = 0.28 * crouch * (1 - aimW * 0.5) - 0.12 * sit - pitch * 0.25 * aimW;
      torso.current.rotation.y = (withGun && !pistol ? -0.22 * aimW - 0.1 * (1 - aimW) : 0) + twist * 0.3;
      torso.current.rotation.z = Math.sin(a.phase) * 0.03 * amount;
      torso.current.position.set(0, WAIST_Y, 0);
    }
    if (head.current) {
      // Đầu ngẩng theo hướng nhìn, bù lại độ khom lưng; áp má vào báng khi ngắm súng trường.
      const lean = torso.current ? torso.current.rotation.x : 0;
      head.current.rotation.x = -pitch * (0.55 + 0.25 * aimW) - lean * 0.85 + (pistol ? 0.02 : 0.3) * aimW;
      head.current.rotation.y = torso.current ? -torso.current.rotation.y * 0.8 : 0;
      head.current.rotation.z = withGun && !pistol ? 0.14 * aimW : 0;
      head.current.position.z = 0.012 + (pistol ? 0.01 : 0.045) * aimW;
      head.current.position.y = NECK_Y - (pistol ? 0 : 0.045) * aimW;
    }

    // ------------------------------------------------ súng: vị trí cầm, tay ôm súng
    if (gun.current) gun.current.visible = withGun;
    if (withGun && gun.current && torso.current && body.current && armR.current && armL.current && foreR.current && foreL.current) {
      torso.current.updateMatrix();
      _anchor.set(0, SHOULDER_Y, 0).applyMatrix4(torso.current.matrix);
      const sightH = aimLineHeight(gunId, sight);
      // Mắt phải (toạ độ thân) là tâm xoay khi ngắm: đường ngắm luôn đi qua mắt.
      _eye.copy(_anchor).add(_off.set(-0.035, pistol ? 0.22 : 0.14, pistol ? 0.11 : 0.17));
      const runW = a.run * (1 - aimW);
      let rx: number, ry: number, rz: number;
      if (pistol) {
        // Súng lục: hạ nòng trước ngực; ngắm thì duỗi hai tay ra trước mặt.
        _gunPos.copy(_anchor).add(_off.set(-0.06, -0.24, 0.3));
        rx = 0.55 - pitch * 0.5;
        ry = 0.05;
        rz = 0;
        _off.set(0, -sightH - 0.015, 0.44).applyAxisAngle(X_AXIS, -pitch);
      } else {
        // Súng trường: cầm ngang hông chĩa về trước; chạy thì ôm chéo trước ngực; ngắm thì tì báng vào vai.
        _gunPos.copy(_anchor).add(_off.set(lerp(-0.13, -0.08, runW), lerp(-0.22, -0.18, runW), lerp(0.24, 0.18, runW)));
        rx = lerp(0.22 - pitch * 0.55, 0.45, runW);
        ry = lerp(0.14, 0.75, runW);
        rz = lerp(0, 0.25, runW);
        _off.set(0, -sightH - 0.008, Math.max(0.2, stockLength(gunId) - 0.1)).applyAxisAngle(X_AXIS, -pitch);
      }
      _off.add(_eye);
      _gunPos.lerp(_off, aimW);
      _gunQ.setFromEuler(_eul.set(rx, ry, rz));
      _qA.setFromEuler(_eul.set(-pitch, 0, 0));
      _gunQ.slerp(_qA, aimW);
      // Sát tường: súng trường dựng nòng lên trời kéo sát ngực, súng lục chĩa xuống đất ôm trước ngực.
      if (a.wall > 0.01) {
        _off.copy(_anchor).add(pistol ? _t.set(-0.05, -0.3, 0.17) : _t.set(-0.1, -0.1, 0.12));
        _gunPos.lerp(_off, a.wall);
        _qA.setFromEuler(pistol ? _eul.set(1.25, 0.1, 0) : _eul.set(-1.15, 0.3, 0.35));
        _gunQ.slerp(_qA, a.wall);
      }
      // Giật: lùi về sau theo nòng, nòng hất lên.
      if (a.kick > 0.001) {
        _gunPos.addScaledVector(_t.set(0, 0, 1).applyQuaternion(_gunQ), -0.04 * a.kick * (pistol ? 0.7 : 1));
        _gunQ.multiply(_qA.setFromAxisAngle(X_AXIS, -(pistol ? 0.16 : 0.07) * a.kick));
      }
      // Rút súng: đưa từ dưới lên, nòng chúc xuống; thay đạn: nghiêng súng lật cửa băng đạn ra ngoài.
      const sw = m.swap ?? 0;
      if (sw > 0.001) {
        _gunPos.y -= 0.28 * sw;
        _gunQ.multiply(_qA.setFromAxisAngle(X_AXIS, 0.9 * sw));
      }
      if (m.reload !== undefined && m.reload >= 0 && m.reload < 1) {
        const cant = Math.sin(Math.min(1, m.reload / 0.9) * Math.PI);
        _gunQ.multiply(_qA.setFromAxisAngle(Z_AXIS, -0.45 * cant));
      }
      gun.current.position.copy(_gunPos);
      gun.current.quaternion.copy(_gunQ);
      // Tay phải nắm tay cầm, tay trái đỡ ốp lót tay (súng lục thì ôm tay phải). Đổi sang toạ độ thân trên.
      _inv.copy(torso.current.matrix).invert();
      _grip.copy(_gunPos).applyMatrix4(_inv);
      _support.set(...supportOffset(gunId)).applyQuaternion(_gunQ).add(_gunPos).applyMatrix4(_inv);
      // Thay đạn: tay trái rời ốp lót tay xuống hông lấy băng mới rồi đẩy vào; băng cũ biến mất một lúc.
      const r = m.reload;
      const magG = gun.current.getObjectByName("mag");
      if (magG) magG.visible = !(r !== undefined && r > 0.28 && r < 0.62);
      if (r !== undefined && r >= 0 && r < 1) {
        const away = Math.sin(Math.min(1, Math.max(0, (r - 0.12) / 0.66)) * Math.PI);
        _support.lerp(_t.set(0.16, -0.32, 0.1), away * 0.85);
      }
      // Cổ tay lùi khỏi điểm nắm một đoạn theo hướng từ vai tới (lòng bàn tay nằm đúng chỗ cầm).
      _grip.addScaledVector(_t.subVectors(_grip, _shR).normalize(), -0.065);
      _support.addScaledVector(_t.subVectors(_support, _shL).normalize(), -0.06);
      // Khuỷu phải chĩa xuống và ra ngoài (ngắm súng trường thì nâng khuỷu), khuỷu trái chĩa xuống.
      _poleR.set(-0.8, lerp(-1, -0.35, aimW * (pistol ? 0 : 1)), -0.2);
      _poleL.set(0.35, -1, -0.1);
      if (!acting) solveArm(armR.current, foreR.current, _shR, _grip, _poleR);
      solveArm(armL.current, foreL.current, _shL, _support, _poleL);
      if (handR.current) handR.current.rotation.set(0.2, 0, -0.35);
      if (handL.current) handL.current.rotation.set(0.1, 0.4, pistol ? 0.6 : 0.9);
    }
    if (!withGun || acting) {
      if (armR.current && (!withGun || acting)) {
        armR.current.rotation.set(armRx, 0, -0.1 * (1 - climb) - 0.35 * climb);
        foreR.current?.rotation.set(-elbowR, 0, 0);
        handR.current?.rotation.set(0, 0, 0);
      }
      if (!withGun && armL.current) {
        armL.current.rotation.set(armLx, 0, 0.1 * (1 - climb) + 0.35 * climb);
        foreL.current?.rotation.set(-elbowL, 0, 0);
        handL.current?.rotation.set(0, 0, 0);
      }
    }

    if (butt.current) {
      // Chổng mông: to ra khi leo, lắc qua lắc lại khi đang trèo.
      const wiggle = m.climbing && m.moving ? Math.sin(a.climbPhase * 2) * 0.18 : Math.sin(now / 500) * 0.05 * climb;
      butt.current.scale.setScalar(0.9 + 0.55 * climb);
      butt.current.position.set(wiggle, 0.89, -0.02 - 0.12 * climb);
      butt.current.rotation.z = wiggle * 0.8;
    }
    const t = now / 1000;
    if (stars.current) {
      stars.current.visible = (m.stun ?? 0) > 0;
      stars.current.rotation.y = t * 5;
    }
    if (swirl.current) {
      swirl.current.visible = (m.dizzy ?? 0) > 0 && !((m.stun ?? 0) > 0);
      swirl.current.rotation.y = -t * 7;
    }
  });

  // ------------------------------------------------ vật liệu của người này (dùng chung theo màu)
  const o = opacity;
  const soldier = !!outfit;
  const shirt = outfit ? camoMat(outfit, "#ffffff", o) : mat(color, "fabric", o);
  const pants = outfit ? camoMat(outfit, "#d6d6d6", o) : mat(look.pants, "fabric", o);
  const skin = mat(look.skin, "skin", o, 0.62);
  const hair = mat(look.hair, "fur", o, 0.9);
  const glove = soldier ? mat("#2a2a26", "fabric", o) : skin;
  const boot = mat(soldier ? "#302a22" : "#3b2a1c", "skin", o, 0.7);
  const sole = mat("#18161a", "none", o, 0.95);
  const beltMat = mat(soldier ? "#2c2a22" : "#3a2616", "skin", o, 0.7);
  const eyeWhite = mat("#f1ede6", "none", o, 0.3);
  const iris = mat("#231812", "none", o, 0.25);
  const lip = mat(new Color(look.skin).multiplyScalar(0.78).getStyle(), "skin", o, 0.5);
  const cuffMat = soldier ? shirt : mat(new Color(color).multiplyScalar(0.8).getStyle(), "fabric", o);
  const ghil = outfit === "ghillie" ? ghillie() : null;
  const strandM = strandMat(o);

  /** Cánh tay: tay trên (cơ vai, bắp), khuỷu, cẳng tay, cổ tay áo, bàn tay (lòng, bốn ngón gộp, ngón cái). */
  const arm = (side: 1 | -1) => {
    const right = side === -1;
    const inward = -side;
    return (
      <group ref={right ? armR : armL} position={[side * SHOULDER_X, SHOULDER_Y, 0]}>
        <P g={G.ball} m={shirt} p={[side * 0.004, -0.03, 0]} s={[0.052, 0.058, 0.054]} />
        <P g={G.upperArm} m={shirt} />
        {soldier && side === 1 && <P g={G.cuff} m={mat(color, "fabric", o)} p={[0, -0.1, 0]} s={[0.0525, 0.035, 0.0525]} />}
        {ghil && <mesh geometry={ghil.arm} material={strandM} castShadow />}
        <group ref={right ? foreR : foreL} position={[0, -UPPER, 0]}>
          <P g={G.small} m={shirt} s={0.043} />
          <P g={G.foreArm} m={shirt} />
          <P g={G.cuff} m={cuffMat} p={[0, -0.225, 0]} s={[0.034, 0.03, 0.034]} />
          <group ref={right ? handR : handL} position={[0, -FORE, 0]}>
            <P g={G.small} m={glove} p={[0, -0.05, 0.004]} s={[0.016, 0.046, 0.037]} />
            <P g={G.small} m={glove} p={[0, -0.098, 0.016]} s={[0.014, 0.038, 0.032]} r={[0.55, 0, 0]} />
            <P g={G.tiny} m={glove} p={[inward * 0.01, -0.045, 0.036]} s={[0.0095, 0.028, 0.0105]} r={[0.5, 0, inward * 0.3]} />
            {right && (
              <group ref={knifeR} visible={false} position={[0, -0.075, 0.012]} rotation={[Math.PI / 2 + 0.55, 0, 0]}>
                <KnifeModel opacity={o} />
              </group>
            )}
            {right && throwable && !gunId && (
              <group position={[0, -0.085, 0.02]}>
                <ThrowableModel id={throwable} />
              </group>
            )}
            {right && itemInHand && (
              // Cầm trong nắm tay phải: đồ dài chĩa ra trước theo cánh tay, đồ nhỏ nắm gọn.
              <group position={[0, -0.075, 0.01]} rotation={LONG_ITEMS.has(itemInHand) ? [Math.PI / 2 + 0.7, 0, 0] : [Math.PI, 0, 0]}>
                <ItemModel itemId={itemInHand} scale={LONG_ITEMS.has(itemInHand) ? 1 : 0.9} />
              </group>
            )}
          </group>
        </group>
      </group>
    );
  };

  /** Chân: đùi, gối, cẳng chân, ống quần, giày (cổ giày, mũi, đế). */
  const leg = (side: 1 | -1) => (
    <group ref={side === 1 ? legL : legR} position={[side * HIP_X, HIP_Y, 0]}>
      <P g={G.thigh} m={pants} />
      {ghil && <mesh geometry={ghil.thigh} material={strandM} castShadow />}
      <group ref={side === 1 ? shinL : shinR} position={[0, -THIGH, 0]}>
        <P g={G.ball} m={pants} p={[0, 0, 0.008]} s={0.06} />
        <P g={G.shin} m={pants} />
        {!soldier && <P g={G.cuff} m={pants} p={[0, -0.36, 0]} s={[0.058, 0.05, 0.058]} />}
        <group ref={side === 1 ? footL : footR} position={[0, -SHIN, 0]}>
          <P g={G.shaft} m={boot} p={[0, soldier ? 0.04 : 0.02, 0]} s={[1, soldier ? 1.4 : 1, 1]} />
          <P g={G.ball} m={boot} p={[0, -0.03, 0.052]} s={[0.05, 0.05, 0.122]} />
          <P g={G.box} m={sole} p={[0, -0.079, 0.05]} s={[0.09, 0.022, 0.25]} />
        </group>
      </group>
    </group>
  );

  return (
    <group ref={ref}>
      <group ref={body}>
        {leg(1)}
        {leg(-1)}
        {/* Hông, mông (bình thường nằm trong quần, leo cây thì chổng ra), thắt lưng. */}
        <P g={G.pelvis} m={pants} s={[1, 1, 0.72]} />
        <group ref={butt} position={[0, 0.89, -0.03]}>
          {[-0.07, 0.07].map((x) => (
            <P key={x} g={G.ball} m={pants} p={[x, 0, -0.02]} s={0.1} />
          ))}
        </group>
        <P g={G.belt} m={beltMat} p={[0, 1.0, 0]} s={[0.158, 0.045, 0.118]} />
        <P g={G.box} m={mat("#9a8a5a", "metal", o, 0.4)} p={[0, 1.0, 0.118]} s={[0.045, 0.034, 0.012]} />
        {/* Nửa thân trên: xoay quanh eo. */}
        <group ref={torso} position={[0, WAIST_Y, 0]}>
          <P g={G.torso} m={shirt} s={[1, 1, 0.66]} />
          <mesh geometry={G.collar} material={cuffMat} position={[0, 0.515, 0.004]} castShadow />
          {armor > 0 && <VestModel level={armor} opacity={o} />}
          {ghil && <mesh geometry={ghil.torso} material={strandM} castShadow />}
          {arm(1)}
          {arm(-1)}
          {/* Cổ và đầu: hộp sọ, hàm, cằm, mũi, tai, mắt, lông mày, môi, tóc. */}
          <P g={G.neck} m={skin} p={[0, 0.5, 0.005]} />
          <group ref={head} position={[0, NECK_Y, 0]}>
            <P g={G.skull} m={skin} p={[0, 0.1, -0.005]} s={[0.091, 0.112, 0.104]} />
            <P g={G.jaw} m={skin} p={[0, 0.045, 0.022]} s={[0.071, 0.058, 0.078]} />
            <P g={G.small} m={skin} p={[0, 0.022, 0.07]} s={[0.03, 0.024, 0.026]} />
            <P g={G.small} m={skin} p={[0, 0.084, 0.098]} s={[0.014, 0.03, 0.02]} r={[-0.35, 0, 0]} />
            <P g={G.tiny} m={skin} p={[0, 0.066, 0.11]} s={[0.017, 0.013, 0.014]} />
            {[-1, 1].map((sx) => (
              <group key={sx}>
                <P g={G.small} m={skin} p={[sx * 0.09, 0.092, -0.006]} s={[0.013, 0.03, 0.02]} r={[0, sx * 0.3, 0]} />
                <P g={G.tiny} m={eyeWhite} p={[sx * 0.033, 0.107, 0.088]} s={[0.0135, 0.0095, 0.009]} />
                <P g={G.tiny} m={iris} p={[sx * 0.033, 0.107, 0.0955]} s={[0.0068, 0.0068, 0.003]} />
                <P g={G.box} m={hair} p={[sx * 0.034, 0.126, 0.095]} s={[0.034, 0.008, 0.012]} r={[0.15, 0, sx * -0.12]} />
              </group>
            ))}
            <P g={G.tiny} m={lip} p={[0, 0.048, 0.094]} s={[0.023, 0.0065, 0.01]} />
            {helmet < 2 && <P g={G.hair} m={hair} p={[0, 0.104, -0.012]} s={[0.097, 0.12, 0.112]} r={[-0.32, 0, 0]} />}
            <P g={G.ball} m={hair} p={[0, 0.085, -0.045]} s={[0.087, 0.085, 0.075]} />
            {helmet > 0 && <HelmetModel level={helmet} opacity={o} />}
            {ghil && <mesh geometry={ghil.head} material={strandM} castShadow />}
          </group>
          {/* Balo (chế độ đảo hoang). */}
          {!soldier && (
            <>
              <P g={G.box} m={mat("#6b4f2a", "fabric", o)} p={[0, 0.17, -0.22]} s={[0.36, 0.46, 0.2]} />
              <P g={G.box} m={mat("#5a4122", "fabric", o)} p={[0, 0.08, -0.33]} s={[0.26, 0.18, 0.05]} />
              <P g={G.bedroll} m={mat("#4f7a3a", "fabric", o)} p={[0, 0.45, -0.22]} r={[0, 0, Math.PI / 2]} />
            </>
          )}
        </group>
        {/* Súng: cầm hai tay (vị trí và hướng đặt mỗi khung hình). */}
        {gunId && (
          <group ref={gun} name="weapon" visible={false}>
            <GunModel weaponId={gunId} sight={sight} opacity={o} />
          </group>
        )}
        {/* Choáng: sao vàng bay vòng quanh đầu. Chóng mặt: vòng xoáy. */}
        <group ref={stars} position={[0, 2.05, 0]} visible={false}>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * 0.32, Math.sin(k * 1.7) * 0.05, Math.sin((k * Math.PI) / 2) * 0.32]}>
              <octahedronGeometry args={[0.07, 0]} />
              <meshBasicMaterial color="#ffe14d" toneMapped={false} />
            </mesh>
          ))}
        </group>
        <group ref={swirl} position={[0, 2.05, 0]} visible={false}>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.22, 0.02, 4, 16, Math.PI * 1.5]} />
            <meshBasicMaterial color="#b98cff" toneMapped={false} />
          </mesh>
          <mesh rotation-x={Math.PI / 2} scale={0.55}>
            <torusGeometry args={[0.22, 0.03, 4, 16, Math.PI * 1.5]} />
            <meshBasicMaterial color="#e2cbff" toneMapped={false} />
          </mesh>
        </group>
        {carrying && (
          <group position={[0, 2.0, -0.2]}>
            <mesh castShadow>
              <boxGeometry args={[0.7, 0.4, 0.45]} />
              <meshStandardMaterial color="#7a4a1e" />
            </mesh>
            <mesh position-y={0.2}>
              <boxGeometry args={[0.72, 0.08, 0.47]} />
              <meshStandardMaterial color="#d4a017" emissive="#ffb000" emissiveIntensity={1.4} toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

