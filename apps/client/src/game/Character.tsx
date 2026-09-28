import { useMemo, useRef, type Ref } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, type Group } from "three";

export interface Motion {
  moving: boolean;
  running?: boolean;
  sitting?: boolean;
}

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
  motion,
  ref,
}: {
  color: string;
  opacity?: number;
  /** Đang vác rương kho báu: ai nhìn cũng thấy. */
  carrying?: boolean;
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
  const anim = useRef({ phase: 0, amount: 0, sit: 0 });

  useFrame((_, dt) => {
    const m = motion?.() ?? { moving: false };
    const a = anim.current;
    const target = m.moving ? (m.running ? 1 : 0.6) : 0;
    a.amount += (target - a.amount) * Math.min(1, dt * 10);
    a.sit += ((m.sitting && !m.moving ? 1 : 0) - a.sit) * Math.min(1, dt * 8);
    a.phase += dt * (m.running ? 17 : 12.5) * (a.amount > 0.05 ? 1 : 0);
    const swing = Math.sin(a.phase) * 0.75 * a.amount;
    const sit = a.sit;
    // Ngồi: đùi gập ra trước gần nằm ngang, hai chân hơi dạng; tay chống lên gối.
    if (legL.current) {
      legL.current.rotation.x = swing * (1 - sit) - 1.45 * sit;
      legL.current.rotation.z = -0.12 * sit;
    }
    if (legR.current) {
      legR.current.rotation.x = -swing * (1 - sit) - 1.45 * sit;
      legR.current.rotation.z = 0.12 * sit;
    }
    if (armL.current) armL.current.rotation.x = -swing * 0.9 * (1 - sit) - 0.75 * sit;
    if (armR.current) armR.current.rotation.x = swing * 0.9 * (1 - sit) - 0.75 * sit;
    if (body.current) {
      const bob = a.amount < 0.05 ? Math.sin(performance.now() / 700) * 0.012 : Math.abs(Math.cos(a.phase)) * 0.06 * a.amount;
      body.current.position.y = bob * (1 - sit) - SIT_DROP * sit;
      // Chạy thì người đổ về trước; ngồi thì hơi ngả ra sau.
      body.current.rotation.x = 0.12 * a.amount * (m.running ? 1.5 : 1) - 0.12 * sit;
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
