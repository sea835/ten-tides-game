import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import type { Group } from "three";
import type { GroundItemState, ProjectileState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { ItemModel, LONG_ITEMS } from "./ItemModel.tsx";
import { LootModel } from "./GunModel.tsx";
import { SpatialGrid } from "./spatialGrid.ts";
import { setAwake, setCastShadow } from "./culling.ts";

// Đồ nằm dưới đất (thả ra, ném đi, rơi từ thú, cây) và đồ đang bay. Đồ dưới đất khẽ nhún, lấp lánh cho dễ thấy;
// đồ đang bay xoay tít theo đường vòng cung server tính. Đồ dưới đất ẩn khi ở xa camera (lưới không gian, xem
// useGroundManager).

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

/** Món đồ trong bộ quản lý: vị trí (cho lưới không gian) và trạng thái hiện/ẩn, đổ bóng hiện tại. */
interface Entry {
  x: number;
  z: number;
  item: GroundItemState;
  group: Group;
  seed: number;
  awake: boolean;
  shadow: boolean | null;
  /** Lượt quét gần nhất thấy món này trong tầm (để biết món nào vừa ra khỏi tầm). */
  seen: number;
}

/** Xa hơn chừng này (m) thì ẩn món đồ. */
const VIEW = 70;
/** Gần hơn chừng này thì mới nhún, xoay (xa hơn thì chuyển động nhỏ cỡ đó không thấy được). */
const ANIMATE = 40;
/** Gần hơn chừng này thì mới đổ bóng. */
const SHADOW = 18;
/** Quét lại tầm nhìn mỗi chừng này giây (đồ nằm yên, người chơi đi vài mét giữa hai lần quét). */
const SCAN = 0.2;

/**
 * Mọi món đồ dưới đất dùng chung một vòng cập nhật thay vì mỗi món một useFrame (vài trăm món rải khắp đảo Battleground):
 * lưới không gian tìm món trong tầm quanh camera, món ngoài tầm thì ngủ (ẩn, thôi tính ma trận), món ở xa thôi đổ bóng
 * và thôi nhún.
 */
function useGroundManager() {
  return useMemo(() => {
    const grid = new SpatialGrid<Entry>(24);
    const entries = new Map<string, Entry>();
    let scan = 0;
    let nextScan = 0;
    return {
      add(id: string, item: GroundItemState, group: Group) {
        const e: Entry = { x: item.x, z: item.z, item, group, seed: Math.random() * 10, awake: true, shadow: null, seen: -1 };
        setAwake(group, false);
        e.awake = false;
        entries.set(id, e);
        grid.upsert(e);
        nextScan = 0;
      },
      remove(id: string) {
        const e = entries.get(id);
        if (!e) return;
        grid.remove(e);
        entries.delete(id);
      },
      frame(cx: number, cz: number, time: number) {
        if (time >= nextScan) {
          nextScan = time + SCAN;
          scan++;
          // Đồ có thể đổi chỗ (bị đẩy, rơi xuống đất): cập nhật ô trong lưới.
          for (const e of entries.values()) {
            e.x = e.item.x;
            e.z = e.item.z;
            grid.upsert(e);
          }
          grid.query(cx, cz, VIEW, (e, d2) => {
            e.seen = scan;
            if (!e.awake) {
              e.awake = true;
              setAwake(e.group, true);
            }
            const shadow = d2 < SHADOW * SHADOW;
            if (shadow !== e.shadow) {
              e.shadow = shadow;
              setCastShadow(e.group, shadow);
            }
          });
          for (const e of entries.values()) {
            if (e.awake && e.seen !== scan) {
              e.awake = false;
              setAwake(e.group, false);
            }
          }
        }
        for (const e of entries.values()) {
          if (!e.awake) continue;
          const g = e.group;
          const dx = e.item.x - cx;
          const dz = e.item.z - cz;
          if (dx * dx + dz * dz > ANIMATE * ANIMATE) {
            g.position.set(e.item.x, e.item.y + 0.08, e.item.z);
            continue;
          }
          const t = time + e.seed;
          g.position.set(e.item.x, e.item.y + 0.08 + Math.abs(Math.sin(t * 2)) * 0.08, e.item.z);
          g.rotation.y = t * 0.6;
        }
      },
    };
  }, []);
}

type GroundManager = ReturnType<typeof useGroundManager>;

function Ground({ id, item, battle, manager }: { id: string; item: GroundItemState; battle: boolean; manager: GroundManager }) {
  const g = useRef<Group>(null);
  useEffect(() => {
    manager.add(id, item, g.current!);
    return () => manager.remove(id);
  }, [id, item, manager]);
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
  const manager = useGroundManager();
  useFrame(({ camera, clock }) => manager.frame(camera.position.x, camera.position.z, clock.elapsedTime));
  return (
    <>
      {items.map(([id, item]) => (
        <Ground key={id} id={id} item={item} battle={battle} manager={manager} />
      ))}
      {!battle &&
        flying.map(([id, p]) => (
          <Flying key={id} p={p} />
        ))}
    </>
  );
}
