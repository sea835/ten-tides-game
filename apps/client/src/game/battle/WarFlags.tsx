import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, type Mesh } from "three";
import type { FlagState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";

// Cứ điểm trên chiến trường: lá cờ trên đỉnh cột (bay phần phật, màu phe đang giữ: xanh, đỏ, trắng là chưa ai),
// vòng tròn trên mặt đất đánh dấu vùng chiếm, chữ cái nổi trên cao để nhìn từ xa biết cứ điểm nào.

export const SIDE_COLORS: Record<string, string> = { blue: "#2f6bff", red: "#e0332b", "": "#e8e8e0" };

const cloth = new PlaneGeometry(2.2, 1.4, 12, 4).translate(1.1, 0, 0);
const ringGeo = new RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);

function Flag({ id, f, mySide }: { id: string; f: FlagState; mySide: string }) {
  const mesh = useRef<Mesh>(null);
  const [owner, setOwner] = useState(f.owner);
  const mats = useMemo(() => {
    const flag = new MeshStandardMaterial({ color: SIDE_COLORS[owner] ?? "#e8e8e0", side: DoubleSide, roughness: 0.8 });
    const ring = new MeshBasicMaterial({ color: SIDE_COLORS[owner] ?? "#e8e8e0", transparent: true, opacity: 0.45, depthWrite: false });
    return { flag, ring };
  }, [owner]);
  useEffect(() => () => void (mats.flag.dispose(), mats.ring.dispose()), [mats]);
  // Lá cờ bay: dịch đỉnh lưới theo sóng (chỉ khi ở gần mới cần mượt, cờ nhỏ nên rẻ).
  const base = useMemo(() => Float32Array.from(cloth.attributes.position!.array), []);
  const geo = useMemo(() => cloth.clone(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    if (f.owner !== owner) setOwner(f.owner);
    const t = clock.elapsedTime;
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      pos.setZ(i, Math.sin(x * 2.4 - t * 5 + Number(id.charCodeAt(0))) * 0.18 * (x / 2.2));
    }
    pos.needsUpdate = true;
  });
  const ours = owner && owner === mySide;
  return (
    <group position={[f.x, f.y, f.z]}>
      <mesh ref={mesh} geometry={geo} material={mats.flag} position={[0.06, 7.7, 0]} castShadow />
      <mesh geometry={ringGeo} material={mats.ring} scale={f.r} position-y={0.12} />
      <Html position={[0, 10.5, 0]} center zIndexRange={[3, 0]} className={`b-flag-tag ${owner || "neutral"} ${ours ? "ours" : ""}`}>
        {id}
      </Html>
    </group>
  );
}

export function WarFlags({ room }: { room: IslandRoom }) {
  const [list, setList] = useState<[string, FlagState][]>([]);
  const [mySide, setMySide] = useState("");
  useEffect(() => {
    const cb = Callbacks.get(room);
    const refresh = () => setList([...(room.state.flags as unknown as Map<string, FlagState>).entries()]);
    const a = cb.onAdd("flags", refresh);
    const r = cb.onRemove("flags", refresh);
    refresh();
    return () => {
      a();
      r();
    };
  }, [room]);
  useFrame(() => {
    const side = room.state.players.get(myId(room))?.team ?? "";
    if (side !== mySide) setMySide(side);
  });
  return (
    <>
      {list.map(([id, f]) => (
        <Flag key={id} id={id} f={f} mySide={mySide} />
      ))}
    </>
  );
}
