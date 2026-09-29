import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import type { Group } from "three";
import type { GroundItemState, ProjectileState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { ItemModel, LONG_ITEMS } from "./ItemModel.tsx";
import { LootModel } from "./GunModel.tsx";
import { localPosition } from "./shared.ts";

// Đồ nằm dưới đất (thả ra, ném đi, rơi từ thú, cây) và đồ đang bay. Đồ dưới đất khẽ nhún, lấp lánh cho dễ thấy;
// đồ đang bay xoay tít theo đường vòng cung server tính.

function useEntries<T>(room: IslandRoom, key: "groundItems" | "projectiles"): [string, T][] {
  const [list, setList] = useState<[string, T][]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () => setList([...(room.state[key] as unknown as Map<string, T>).entries()]);
    const offAdd = callbacks.onAdd(key, refresh);
    const offRemove = callbacks.onRemove(key, refresh);
    refresh();
    return () => {
      offAdd();
      offRemove();
    };
  }, [room, key]);
  return list;
}

function Ground({ item, battle }: { item: GroundItemState; battle: boolean }) {
  const g = useRef<Group>(null);
  const seed = useRef(Math.random() * 10);
  useFrame(({ clock }) => {
    const m = g.current;
    if (!m) return;
    m.visible = Math.hypot(item.x - localPosition.x, item.z - localPosition.z) < 70;
    const t = clock.elapsedTime + seed.current;
    m.position.set(item.x, item.y + 0.08 + Math.abs(Math.sin(t * 2)) * 0.08, item.z);
    m.rotation.y = t * 0.6;
  });
  const long = LONG_ITEMS.has(item.itemId);
  if (battle)
    return (
      <group ref={g} position={[item.x, item.y, item.z]}>
        <LootModel id={item.itemId} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.06}>
          <ringGeometry args={[0.42, 0.5, 20]} />
          <meshBasicMaterial color="#ffe08a" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    );
  return (
    <group ref={g} position={[item.x, item.y, item.z]}>
      {/* Đồ dài nằm ngang trên đất, đồ nhỏ đứng. */}
      <group rotation-z={long ? Math.PI / 2 : 0} position-y={long ? 0.05 : 0}>
        <ItemModel itemId={item.itemId} scale={1.15} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.06}>
        <ringGeometry args={[0.32, 0.4, 16]} />
        <meshBasicMaterial color="#fff3b0" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Flying({ p }: { p: ProjectileState }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => {
    const m = g.current;
    if (!m) return;
    const k = Math.min(1, dt * 20);
    m.position.x += (p.x - m.position.x) * k;
    m.position.y += (p.y - m.position.y) * k;
    m.position.z += (p.z - m.position.z) * k;
    m.rotation.x += dt * 14;
    m.rotation.z += dt * 5;
  });
  return (
    <group ref={g} position={[p.x, p.y, p.z]}>
      <ItemModel itemId={p.itemId} scale={1.1} />
    </group>
  );
}

export function GroundItems({ room }: { room: IslandRoom }) {
  const items = useEntries<GroundItemState>(room, "groundItems");
  const flying = useEntries<ProjectileState>(room, "projectiles");
  // Battleground: đồ rơi là súng, đạn, giáp...; lựu đạn đang bay vẽ riêng (battle/Effects.tsx).
  const battle = room.state.mode === "battle";
  return (
    <>
      {items.map(([id, item]) => (
        <Ground key={id} item={item} battle={battle} />
      ))}
      {!battle &&
        flying.map(([id, p]) => (
          <Flying key={id} p={p} />
        ))}
    </>
  );
}
