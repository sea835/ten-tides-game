import { useEffect, useMemo } from "react";
import { useRapier } from "@react-three/rapier";
import { BufferGeometry, Color, Euler, MeshStandardMaterial, Quaternion, SphereGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SANDBAG } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { LootModel } from "../GunModel.tsx";
import { teamColor } from "./Vehicles.tsx";

// Khí tài đặt xuống đất (server giữ trong `state.traps`): hộp tiếp đạn của lính Quân Nhu (thùng gỗ, cờ nhỏ màu phe)
// và bờ bao cát (ba lớp bao xếp so le, có hộp va chạm khớp đúng khối server dùng để chặn đạn: người không đi xuyên,
// đạn của mình găm vào). Bao cát bị bắn thì sạm dần theo độ bền còn lại.

interface Item {
  key: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  team: string;
  /** Độ hư (0 nguyên, 1–2 nứt, 3 sắp vỡ). */
  wear: number;
}

/** Hình bờ bao cát (toạ độ khối: tâm đáy ở gốc, dài theo x, dày theo z), dựng một lần. */
let wallGeo: BufferGeometry | null = null;
function sandbagWall(): BufferGeometry {
  if (wallGeo) return wallGeo;
  const parts: BufferGeometry[] = [];
  const rows = 3;
  const bagH = SANDBAG.h / rows;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let r = 0; r < rows; r++) {
    const n = r % 2 === 0 ? 4 : 3;
    const bagW = SANDBAG.w / 4;
    const start = -((n - 1) * bagW) / 2;
    for (let i = 0; i < n; i++) {
      const g = new SphereGeometry(1, 10, 6);
      // Bao dẹt, đầy, hơi lệch nhau cho đỡ máy móc; lớp trên hẹp hơn một chút.
      g.scale(bagW * 0.56, bagH * 0.62, SANDBAG.d * 0.52 * (1 - r * 0.06));
      g.rotateY(rnd() * 0.15);
      g.translate(start + i * bagW + rnd() * 0.03, bagH * (r + 0.5), rnd() * 0.04);
      parts.push(g);
    }
  }
  wallGeo = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  wallGeo.computeVertexNormals();
  return wallGeo;
}

/** Vật liệu bao cát theo độ hư (dùng chung). */
const wearMats: MeshStandardMaterial[] = [];
function sandbagMat(wear: number): MeshStandardMaterial {
  const k = Math.max(0, Math.min(3, wear));
  if (!wearMats[k]) wearMats[k] = new MeshStandardMaterial({ color: new Color("#b09a6c").multiplyScalar(1 - k * 0.14), roughness: 1 });
  return wearMats[k]!;
}

const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");

/** Một bờ bao cát: hình và hộp va chạm (cố định) đúng khối của server. */
function Sandbag({ it }: { it: Item }) {
  const { world, rapier } = useRapier();
  useEffect(() => {
    _q.setFromEuler(_e.set(0, it.rot, 0));
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    world.createCollider(
      rapier.ColliderDesc.cuboid(SANDBAG.w / 2, SANDBAG.h / 2, SANDBAG.d / 2)
        .setTranslation(it.x, it.y + SANDBAG.h / 2, it.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
      body,
    );
    return () => {
      if (world.getRigidBody(body.handle)) world.removeRigidBody(body);
    };
  }, [world, rapier, it.x, it.y, it.z, it.rot]);
  return <mesh geometry={sandbagWall()} material={sandbagMat(it.wear)} position={[it.x, it.y, it.z]} rotation-y={it.rot} castShadow receiveShadow />;
}

/** Hộp tiếp đạn: thùng gỗ, cột cờ nhỏ màu phe để đồng đội nhận ra từ xa. */
function AmmoBox({ it }: { it: Item }) {
  const color = teamColor(it.team);
  return (
    <group position={[it.x, it.y, it.z]} rotation-y={it.rot}>
      <LootModel id="ammobox" />
      <mesh position={[0.2, 0.55, -0.12]}>
        <cylinderGeometry args={[0.008, 0.008, 0.5, 5]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[0.27, 0.72, -0.12]}>
        <boxGeometry args={[0.14, 0.09, 0.005]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Deployables({ room }: { room: IslandRoom }) {
  const sig = useRoomSnapshot(room, (s) =>
    [...s.traps.entries()]
      .filter(([, t]) => t.defId === "ammobox" || t.defId === "sandbag")
      .map(([k, t]) => `${k}|${t.defId}|${t.x.toFixed(2)}|${t.y.toFixed(2)}|${t.z.toFixed(2)}|${t.rot.toFixed(3)}|${t.team}|${t.hp >= 99 ? 0 : t.hp > 66 ? 1 : t.hp > 33 ? 2 : 3}`)
      .join(";"),
  );
  const items = useMemo<Item[]>(
    () =>
      sig
        ? sig.split(";").map((row) => {
            const [key = "", kind = "", x, y, z, rot, team = "", wear] = row.split("|");
            return { key, kind, x: Number(x), y: Number(y), z: Number(z), rot: Number(rot), team, wear: Number(wear) };
          })
        : [],
    [sig],
  );
  return (
    <>
      {items.map((it) => (it.kind === "sandbag" ? <Sandbag key={it.key} it={it} /> : <AmmoBox key={it.key} it={it} />))}
    </>
  );
}
