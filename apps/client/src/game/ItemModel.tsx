import type { ReactNode } from "react";

// Hình dáng low-poly của từng món đồ, dùng chung cho đồ cầm trên tay, nằm dưới đất và đang bay.
// Quy ước: chỗ cầm ở gốc toạ độ, thân món đồ chĩa theo trục +y (cầm tay thì xoay cho chĩa ra trước).

type V3 = [number, number, number];

function M({ c, e = 0 }: { c: string; e?: number }) {
  return <meshStandardMaterial color={c} emissive={e ? c : "#000000"} emissiveIntensity={e} toneMapped={e === 0} flatShading roughness={0.8} userData={{ detailSpace: "object" }} />;
}

function Box({ s, p = [0, 0, 0], r = [0, 0, 0], c, e }: { s: V3; p?: V3; r?: V3; c: string; e?: number }) {
  return (
    <mesh position={p} rotation={r} castShadow>
      <boxGeometry args={s} />
      <M c={c} e={e} />
    </mesh>
  );
}

function Cyl({ r, h, p = [0, 0, 0], rot = [0, 0, 0], c, top, e }: { r: number; h: number; p?: V3; rot?: V3; c: string; top?: number; e?: number }) {
  return (
    <mesh position={p} rotation={rot} castShadow>
      <cylinderGeometry args={[top ?? r, r, h, 6]} />
      <M c={c} e={e} />
    </mesh>
  );
}

function Ball({ r, p = [0, 0, 0], s = [1, 1, 1], c, e }: { r: number; p?: V3; s?: V3; c: string; e?: number }) {
  return (
    <mesh position={p} scale={s} castShadow>
      <icosahedronGeometry args={[r, 0]} />
      <M c={c} e={e} />
    </mesh>
  );
}

const WOOD = "#7a5230";
const DARK_WOOD = "#4a3020";
const STEEL = "#b8bec6";

const MODELS: Record<string, () => ReactNode> = {
  machete: () => (
    <>
      <Cyl r={0.035} h={0.22} p={[0, 0.02, 0]} c={DARK_WOOD} />
      <Box s={[0.09, 0.55, 0.015]} p={[0.02, 0.4, 0]} c={STEEL} />
    </>
  ),
  axe: () => (
    <>
      <Cyl r={0.03} h={0.75} p={[0, 0.3, 0]} c={WOOD} />
      <Box s={[0.22, 0.16, 0.05]} p={[0.09, 0.62, 0]} c={STEEL} />
    </>
  ),
  spear: () => (
    <>
      <Cyl r={0.025} h={1.6} p={[0, 0.55, 0]} c="#c9b27a" />
      <mesh position={[0, 1.42, 0]} castShadow>
        <coneGeometry args={[0.05, 0.22, 4]} />
        <M c="#d8d2c0" />
      </mesh>
    </>
  ),
  slingshot: () => (
    <>
      <Cyl r={0.025} h={0.2} p={[0, 0.02, 0]} c={WOOD} />
      <Cyl r={0.02} h={0.16} p={[0.05, 0.18, 0]} rot={[0, 0, -0.4]} c={WOOD} />
      <Cyl r={0.02} h={0.16} p={[-0.05, 0.18, 0]} rot={[0, 0, 0.4]} c={WOOD} />
      <Box s={[0.14, 0.01, 0.01]} p={[0, 0.25, 0]} c="#c44" />
    </>
  ),
  flintlock: () => (
    <>
      <Box s={[0.05, 0.2, 0.08]} p={[0, 0.02, -0.03]} r={[0.4, 0, 0]} c={WOOD} />
      <Cyl r={0.025} h={0.7} p={[0, 0.4, 0]} c="#555a60" />
    </>
  ),
  torch: () => (
    <>
      <Cyl r={0.035} top={0.045} h={0.55} p={[0, 0.2, 0]} c={DARK_WOOD} />
      <mesh position={[0, 0.55, 0]}>
        <coneGeometry args={[0.09, 0.28, 5]} />
        <M c="#ffb347" e={3} />
      </mesh>
    </>
  ),
  lantern: () => (
    <>
      <Box s={[0.16, 0.2, 0.16]} p={[0, 0.12, 0]} c="#6b5a3a" />
      <Box s={[0.11, 0.14, 0.11]} p={[0, 0.12, 0]} c="#ffd27a" e={2.5} />
    </>
  ),
  hammer: () => (
    <>
      <Cyl r={0.03} h={0.45} p={[0, 0.18, 0]} c={WOOD} />
      <Box s={[0.2, 0.09, 0.09]} p={[0, 0.42, 0]} c="#6f747a" />
    </>
  ),
  shovel: () => (
    <>
      <Cyl r={0.03} h={1.1} p={[0, 0.45, 0]} c={WOOD} />
      <Box s={[0.2, 0.26, 0.03]} p={[0, 1.08, 0]} c="#8c9096" />
    </>
  ),
  stone: () => <Ball r={0.1} p={[0, 0.08, 0]} c="#8f8a84" />,
  coconut: () => <Ball r={0.13} p={[0, 0.1, 0]} c="#5a4020" />,
  wood: () => <Cyl r={0.07} h={0.7} p={[0, 0.3, 0]} c="#8a6038" />,
  palm_sprout: () => (
    <>
      <Ball r={0.09} p={[0, 0.06, 0]} c="#6b4a2a" />
      <Box s={[0.03, 0.25, 0.1]} p={[0, 0.2, 0]} r={[0, 0, 0.3]} c="#58b04a" />
    </>
  ),
  sapling: () => (
    <>
      <Cyl r={0.08} top={0.1} h={0.1} p={[0, 0.03, 0]} c="#6b4a2a" />
      <Cyl r={0.012} h={0.3} p={[0, 0.2, 0]} c="#5a4028" />
      <Ball r={0.1} p={[0, 0.36, 0]} c="#4f9a3c" />
    </>
  ),
  raw_meat: () => <Ball r={0.13} p={[0, 0.08, 0]} s={[1.3, 0.7, 1]} c="#c84a4a" />,
  fish: () => (
    <>
      <Ball r={0.07} p={[0, 0.18, 0]} s={[0.6, 2.2, 1]} c="#9fb6c2" />
      <Box s={[0.12, 0.08, 0.01]} p={[0, 0.02, 0]} c="#8aa2ad" />
    </>
  ),
  feather: () => <Box s={[0.05, 0.3, 0.01]} p={[0, 0.15, 0]} r={[0, 0, 0.2]} c="#e6e1d6" />,
  hide: () => <Box s={[0.4, 0.02, 0.3]} p={[0, 0.02, 0]} c="#8a6a4a" />,
  bone: () => (
    <>
      <Cyl r={0.025} h={0.4} p={[0, 0.2, 0]} c="#ece3cf" />
      <Ball r={0.05} p={[0, 0.42, 0]} c="#ece3cf" />
      <Ball r={0.05} p={[0, 0, 0]} c="#ece3cf" />
    </>
  ),
  crystal_shard: () => (
    <mesh position={[0, 0.1, 0]} scale={[0.5, 1, 0.5]}>
      <octahedronGeometry args={[0.12, 0]} />
      <M c="#7ff3ff" e={1.8} />
    </mesh>
  ),
  ink_sac: () => <Ball r={0.08} p={[0, 0.07, 0]} c="#2a2440" />,
  camp_kit: () => (
    <>
      <Box s={[0.5, 0.3, 0.4]} p={[0, 0.15, 0]} c="#8a6a42" />
      <Cyl r={0.05} h={0.6} p={[0, 0.2, 0.25]} rot={[0, 0, Math.PI / 2]} c={DARK_WOOD} />
    </>
  ),
  rum: () => (
    <>
      <Cyl r={0.05} h={0.22} p={[0, 0.11, 0]} c="#5a2a12" />
      <Cyl r={0.02} h={0.1} p={[0, 0.27, 0]} c="#5a2a12" />
    </>
  ),
  water_bottle: () => <Cyl r={0.06} h={0.25} p={[0, 0.12, 0]} c="#6f8fa8" />,
  first_aid_kit: () => (
    <>
      <Box s={[0.26, 0.16, 0.1]} p={[0, 0.08, 0]} c="#eeeeee" />
      <Box s={[0.08, 0.02, 0.105]} p={[0, 0.08, 0]} c="#d33" />
    </>
  ),
  hardtack: () => <Box s={[0.14, 0.04, 0.1]} p={[0, 0.02, 0]} c="#d9b97a" />,
  gunpowder: () => (
    <>
      <Cyl r={0.1} h={0.18} p={[0, 0.09, 0]} c="#3a3430" />
      <Cyl r={0.01} h={0.1} p={[0, 0.22, 0]} c="#c9b98a" />
    </>
  ),
  rope: () => (
    <mesh position={[0, 0.06, 0]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[0.12, 0.035, 5, 10]} />
      <M c="#c9b27a" />
    </mesh>
  ),
};

/** Món đồ bất kỳ; món chưa có hình riêng thì là một gói nhỏ màu theo id. */
export function ItemModel({ itemId, scale = 1 }: { itemId: string; scale?: number }) {
  const make = MODELS[itemId];
  if (make) return <group scale={scale}>{make()}</group>;
  const hue = [...itemId].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 360;
  return (
    <group scale={scale}>
      <Box s={[0.18, 0.14, 0.12]} p={[0, 0.07, 0]} c={`hsl(${hue} 35% 45%)`} />
    </group>
  );
}

/** Món dài (cầm như vũ khí) thì cầm dọc cánh tay; món nhỏ thì nắm gọn trong lòng bàn tay. */
export const LONG_ITEMS = new Set(["machete", "axe", "spear", "flintlock", "torch", "hammer", "shovel", "wood", "bone", "slingshot", "fish", "feather"]);
