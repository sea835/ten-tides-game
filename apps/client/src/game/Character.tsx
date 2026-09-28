import { useMemo, useRef, type Ref } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, type Group } from "three";
import { ItemModel, LONG_ITEMS } from "./ItemModel.tsx";

export interface Motion {
  moving: boolean;
  running?: boolean;
  sitting?: boolean;
  swimming?: boolean;
  /** Đang leo cây (id cây hoặc true). */
  climbing?: boolean | string;
  /** Động tác vừa làm (swing, chop, throw, shoot, stab, eat) và bộ đếm để diễn đúng một lần. */
  act?: string;
  actN?: number;
  /** Còn choáng / chóng mặt bao nhiêu giây. */
  stun?: number;
  dizzy?: number;
}

/** Mỗi động tác kéo dài bao lâu (giây). */
const ACT_SECONDS: Record<string, number> = { swing: 0.32, chop: 0.42, throw: 0.4, shoot: 0.35, stab: 0.3, eat: 0.9 };

/** Ngồi bệt: hông hạ xuống chừng này, chân duỗi ra trước. */
const SIT_DROP = 0.55;

const SKIN = ["#f1c9a0", "#e0ac7e", "#c68a5e", "#9c6a44"];
const HAIR = ["#2b1d14", "#4a3020", "#7a4a26", "#1c1c1c", "#b07a3a"];

/** Chọn tông da và tóc cố định theo màu áo, để mỗi người trông khác nhau mà máy nào cũng giống. */
function looks(color: string) {
  const n = [...color].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7) >>> 0;
  return { skin: SKIN[n % SKIN.length]!, hair: HAIR[(n >>> 3) % HAIR.length]!, pants: new Color(color).multiplyScalar(0.35).getStyle() };
}

/**
 * Nhân vật low-poly: đầu, tóc, thân áo theo màu người chơi, tay chân vung khi đi, balo sau lưng.
 * Chân đặt ở y = 0, nhìn theo trục +z. `motion` được đọc mỗi khung hình để tạo dáng đi.
 */
export function Character({
  color,
  opacity = 1,
  carrying = false,
  held = "",
  motion,
  ref,
}: {
  color: string;
  opacity?: number;
  /** Đang vác rương kho báu: ai nhìn cũng thấy. */
  carrying?: boolean;
  /** Món đang cầm trên tay phải. */
  held?: string;
  motion?: () => Motion;
  ref?: Ref<Group>;
}) {
  const transparent = opacity < 1;
  const look = useMemo(() => looks(color), [color]);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const body = useRef<Group>(null);
  const butt = useRef<Group>(null);
  const stars = useRef<Group>(null);
  const swirl = useRef<Group>(null);
  const anim = useRef({ phase: 0, amount: 0, sit: 0, swim: 0, lie: 0, climb: 0, actN: -1, act: "", actT: 99, climbPhase: 0 });

  useFrame((_, dt) => {
    const m = motion?.() ?? { moving: false };
    const a = anim.current;
    // Động tác mới (máy khác thấy qua bộ đếm): bắt đầu diễn từ đầu. Lần đầu thấy thì bỏ qua.
    if (m.actN !== undefined && m.actN !== a.actN) {
      if (a.actN !== -1) {
        a.act = m.act ?? "";
        a.actT = 0;
      }
      a.actN = m.actN;
    }
    a.actT += dt;
    a.climb += ((m.climbing ? 1 : 0) - a.climb) * Math.min(1, dt * 8);
    if (m.climbing && m.moving) a.climbPhase += dt * 9;
    const target = m.moving ? (m.running ? 1 : 0.6) : 0;
    a.amount += (target - a.amount) * Math.min(1, dt * 10);
    a.sit += ((m.sitting && !m.moving ? 1 : 0) - a.sit) * Math.min(1, dt * 8);
    a.swim += ((m.swimming ? 1 : 0) - a.swim) * Math.min(1, dt * 5);
    // Bơi tới thì nằm sấp gần ngang mặt nước; đứng yên thì đạp nước, người thẳng đứng.
    a.lie += ((m.swimming ? (m.moving ? 1.3 : 0.12) : 0) - a.lie) * Math.min(1, dt * 4);
    a.phase += dt * (m.swimming ? 7 : m.running ? 17 : 12.5) * (a.amount > 0.05 || m.swimming ? 1 : 0);
    const swim = a.swim;
    // Bơi: chân đập nhanh biên độ nhỏ, tay sải vòng; đứng yên dưới nước thì đạp nước nhẹ.
    const swing = Math.sin(a.phase) * 0.75 * a.amount * (1 - swim) + Math.sin(a.phase * 2) * 0.35 * swim;
    const sit = a.sit * (1 - swim);
    // Ngồi: đùi gập ra trước gần nằm ngang, hai chân hơi dạng; tay chống lên gối.
    if (legL.current) {
      legL.current.rotation.x = swing * (1 - sit) - 1.45 * sit;
      legL.current.rotation.z = -0.12 * sit;
    }
    if (legR.current) {
      legR.current.rotation.x = -swing * (1 - sit) - 1.45 * sit;
      legR.current.rotation.z = 0.12 * sit;
    }
    const stroke = swim * (a.amount > 0.05 ? 1 : 0.35);
    const climb = a.climb;
    // Leo cây: hai tay vươn ôm thân cây thay phiên kéo lên, hai chân co quặp, mông chổng ra sau.
    const pull = Math.sin(a.climbPhase);
    if (armL.current) {
      armL.current.rotation.x = ((-swing * 0.9 * (1 - sit) - 0.75 * sit) * (1 - swim) + (-Math.PI + Math.sin(a.phase) * 1.6) * stroke) * (1 - climb) + (-2.6 + pull * 0.45) * climb;
      armL.current.rotation.z = 0.12 * (1 - climb) + 0.35 * climb;
    }
    let armRx = ((swing * 0.9 * (1 - sit) - 0.75 * sit) * (1 - swim) + (-Math.PI - Math.sin(a.phase) * 1.6) * stroke) * (1 - climb) + (-2.6 - pull * 0.45) * climb;
    // Đang cầm đồ thì tay phải hơi đưa ra trước.
    if (held && climb < 0.5 && swim < 0.5) armRx = armRx * 0.5 - 0.45;
    // Động tác một lần: vung, chặt, ném, bắn, đâm, ăn.
    const dur = ACT_SECONDS[a.act] ?? 0;
    let lunge = 0;
    let twist = 0;
    if (a.actT < dur) {
      const k = a.actT / dur;
      const snap = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
      switch (a.act) {
        case "swing":
          armRx = -2.4 + 2.9 * Math.min(1, k * 2.2);
          twist = Math.sin(k * Math.PI) * 0.5;
          break;
        case "chop":
          armRx = -3.1 + 3.5 * Math.min(1, Math.max(0, k - 0.2) * 2);
          lunge = Math.sin(k * Math.PI) * 0.2;
          break;
        case "throw":
          armRx = k < 0.45 ? -2.9 * (k / 0.45) : -2.9 + 2.6 * ((k - 0.45) / 0.55);
          twist = Math.sin(k * Math.PI) * 0.4;
          break;
        case "shoot":
          armRx = -1.55 + snap * 0.35;
          break;
        case "stab":
          armRx = -1.5;
          lunge = snap * 0.45;
          break;
        case "eat":
          armRx = -2.3 + Math.sin(a.actT * 18) * 0.15;
          break;
      }
    }
    if (armR.current) {
      armR.current.rotation.x = armRx;
      armR.current.rotation.z = -0.12 * (1 - climb) - 0.35 * climb;
    }
    if (legL.current && climb > 0.01) legL.current.rotation.x = legL.current.rotation.x * (1 - climb) + (-1.1 - pull * 0.4) * climb;
    if (legR.current && climb > 0.01) legR.current.rotation.x = legR.current.rotation.x * (1 - climb) + (-1.1 + pull * 0.4) * climb;
    if (body.current) {
      const bob = a.amount < 0.05 ? Math.sin(performance.now() / 700) * 0.012 : Math.abs(Math.cos(a.phase)) * 0.06 * a.amount;
      // Xoay quanh gót chân nên phải nhấc người lên theo góc nằm để đầu vẫn nhô khỏi mặt nước.
      body.current.position.y = (bob * (1 - sit) - SIT_DROP * sit) * (1 - swim) + 0.95 * Math.sin(a.lie) + Math.sin(a.phase * 0.5) * 0.04 * swim;
      // Chạy thì người đổ về trước; ngồi thì hơi ngả ra sau; leo cây thì ngực áp vào thân cây, mông chổng ra.
      body.current.rotation.x = (0.12 * a.amount * (m.running ? 1.5 : 1) - 0.12 * sit) * (1 - swim) * (1 - climb) + a.lie + 0.32 * climb + lunge * 0.4;
      body.current.position.z = lunge * 0.5 - 0.2 * climb;
      body.current.rotation.y = twist;
      // Chóng mặt thì loạng choạng.
      body.current.rotation.z = (m.dizzy ?? 0) > 0 ? Math.sin(performance.now() / 260) * 0.12 : 0;
    }
    if (butt.current) {
      // Chổng mông: to ra khi leo, lắc qua lắc lại khi đang trèo.
      const wiggle = m.climbing && m.moving ? Math.sin(a.climbPhase * 2) * 0.18 : Math.sin(performance.now() / 500) * 0.05 * climb;
      butt.current.scale.setScalar(0.9 + 0.55 * climb);
      butt.current.position.set(wiggle, 0.86, -0.1 - 0.12 * climb);
      butt.current.rotation.z = wiggle * 0.8;
    }
    const t = performance.now() / 1000;
    if (stars.current) {
      stars.current.visible = (m.stun ?? 0) > 0;
      stars.current.rotation.y = t * 5;
    }
    if (swirl.current) {
      swirl.current.visible = (m.dizzy ?? 0) > 0 && !((m.stun ?? 0) > 0);
      swirl.current.rotation.y = -t * 7;
    }
  });

  const mat = (c: string) => <meshStandardMaterial color={c} flatShading transparent={transparent} opacity={opacity} roughness={0.85} />;

  return (
    <group ref={ref}>
      <group ref={body}>
        {/* Chân: xoay quanh hông. */}
        {[
          [legL, -0.14],
          [legR, 0.14],
        ].map(([r, x], i) => (
          <group key={i} ref={r as typeof legL} position={[x as number, 0.82, 0]}>
            <mesh castShadow position-y={-0.4}>
              <cylinderGeometry args={[0.1, 0.085, 0.8, 5]} />
              {mat(look.pants)}
            </mesh>
            <mesh castShadow position={[0, -0.8, 0.05]}>
              <boxGeometry args={[0.18, 0.1, 0.28]} />
              {mat("#3b2a1c")}
            </mesh>
          </group>
        ))}
        {/* Mông: bình thường khuất trong quần, leo cây thì chổng ra. */}
        <group ref={butt} position={[0, 0.86, -0.1]}>
          {[-0.1, 0.1].map((x) => (
            <mesh key={x} position={[x, 0, -0.04]} castShadow>
              <icosahedronGeometry args={[0.15, 1]} />
              {mat(look.pants)}
            </mesh>
          ))}
        </group>
        {/* Thân áo. */}
        <mesh castShadow position-y={1.12}>
          <cylinderGeometry args={[0.24, 0.28, 0.66, 6]} />
          {mat(color)}
        </mesh>
        <mesh castShadow position-y={1.45}>
          <cylinderGeometry args={[0.16, 0.24, 0.08, 6]} />
          {mat(color)}
        </mesh>
        {/* Tay: xoay quanh vai. */}
        {[
          [armL, -0.33],
          [armR, 0.33],
        ].map(([r, x], i) => (
          <group key={i} ref={r as typeof armL} position={[x as number, 1.42, 0]} rotation-z={(i === 0 ? 1 : -1) * 0.12}>
            <mesh castShadow position-y={-0.28}>
              <cylinderGeometry args={[0.075, 0.065, 0.56, 5]} />
              {mat(color)}
            </mesh>
            <mesh castShadow position-y={-0.6}>
              <sphereGeometry args={[0.075, 5, 4]} />
              {mat(look.skin)}
            </mesh>
            {i === 1 && held && (
              // Cầm trong nắm tay phải: đồ dài chĩa ra trước theo cánh tay, đồ nhỏ nắm gọn.
              <group position={[0, -0.64, 0.02]} rotation={LONG_ITEMS.has(held) ? [Math.PI / 2 + 0.3, 0, 0] : [Math.PI, 0, 0]}>
                <ItemModel itemId={held} scale={LONG_ITEMS.has(held) ? 1 : 0.9} />
              </group>
            )}
          </group>
        ))}
        {/* Đầu, tóc, mắt (để thấy hướng nhìn). */}
        <mesh castShadow position-y={1.68}>
          <icosahedronGeometry args={[0.2, 1]} />
          {mat(look.skin)}
        </mesh>
        <mesh position={[0, 1.76, -0.03]} scale={[1, 0.75, 1]}>
          <icosahedronGeometry args={[0.215, 1]} />
          {mat(look.hair)}
        </mesh>
        {[-0.07, 0.07].map((x) => (
          <mesh key={x} position={[x, 1.7, 0.18]}>
            <boxGeometry args={[0.04, 0.05, 0.02]} />
            {mat("#1a1410")}
          </mesh>
        ))}
        {/* Balo. */}
        <mesh castShadow position={[0, 1.15, -0.34]}>
          <boxGeometry args={[0.42, 0.52, 0.22]} />
          {mat("#6b4f2a")}
        </mesh>
        <mesh castShadow position={[0, 1.44, -0.34]}>
          <cylinderGeometry args={[0.12, 0.12, 0.44, 6]} />
          {mat("#4f7a3a")}
        </mesh>
        {/* Choáng: sao vàng bay vòng quanh đầu. Chóng mặt: vòng xoáy. */}
        <group ref={stars} position={[0, 2.1, 0]} visible={false}>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * 0.32, Math.sin(k * 1.7) * 0.05, Math.sin((k * Math.PI) / 2) * 0.32]}>
              <octahedronGeometry args={[0.07, 0]} />
              <meshBasicMaterial color="#ffe14d" toneMapped={false} />
            </mesh>
          ))}
        </group>
        <group ref={swirl} position={[0, 2.1, 0]} visible={false}>
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
          <group position={[0, 1.95, -0.3]}>
            <mesh castShadow>
              <boxGeometry args={[0.7, 0.4, 0.45]} />
              <meshStandardMaterial color="#7a4a1e" flatShading />
            </mesh>
            <mesh position-y={0.2}>
              <boxGeometry args={[0.72, 0.08, 0.47]} />
              <meshStandardMaterial color="#d4a017" emissive="#ffb000" emissiveIntensity={1.4} toneMapped={false} flatShading />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}
