import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from "three";
import {
  BUILD_RADIUS,
  SNAP_GRID,
  STOREY,
  TIDE_MEAN,
  snapBase,
  snapFromRecord,
  snapOffset,
  snapPiece,
  snapProblem,
  snapReach,
  snapTerrain,
  snapY,
  worldCatalog,
  type SnapKind,
  type SnapObstacle,
  type SnapPiece,
  type World,
} from "@tentides/content";
import { getHud, setHud } from "./hudStore.ts";
import { look } from "./input.ts";
import { buildGhost, localPosition } from "./shared.ts";

// Dựng nhà kiểu lắp ghép quanh lửa trại (xem snap.ts của content): sàn gỗ, vách gỗ, cầu thang, tháp canh khớp vào
// lưới 3 m, chồng được nhiều tầng. Bóng xanh/đỏ dùng đúng hàm kiểm tra của server nên xanh là server nhận.
// Gốc toạ độ mỗi mảnh ở mặt sàn của tầng nó đứng (y = snapY), giữa ô (vách: giữa cạnh, chạy theo trục x).

const PLANK = "#8a6038";
const PLANK_DARK = "#6b4a2b";
const POLE = "#5a3d22";
const HALF = SNAP_GRID / 2;
/** Cầu thang: số bậc và chiều cao mỗi bậc (vừa với autostep 0,5 m của nhân vật). */
const STEPS = 8;
const RISE = STOREY / STEPS;
const RUN = SNAP_GRID / STEPS;
const WALL_H = 2.8;
const POST_INSET = 0.18;

function Mat({ color, ghost }: { color: string; ghost?: string }) {
  return ghost ? <meshBasicMaterial color={ghost} transparent opacity={0.35} depthWrite={false} /> : <meshStandardMaterial color={color} flatShading roughness={0.9} side={DoubleSide} />;
}

/** Hình dáng một mảnh lắp ghép. `ground`: mảnh ở tầng trệt (sàn có móng cọc chôn xuống đất). */
export function SnapPieceModel({ kind, ghost, ground = false }: { kind: SnapKind; ghost?: string; ground?: boolean }) {
  switch (kind) {
    case "floor":
      return (
        <group>
          <mesh position={[0, -0.1, 0]} castShadow={!ghost} receiveShadow>
            <boxGeometry args={[SNAP_GRID - 0.04, 0.2, SNAP_GRID - 0.04]} />
            <Mat color={PLANK} ghost={ghost} />
          </mesh>
          {/* Ván lát: mấy đường rãnh tối cho ra sàn ván. */}
          {!ghost &&
            [-1, 0, 1].map((k) => (
              <mesh key={k} position={[k * 0.75, 0.005, 0]}>
                <boxGeometry args={[0.04, 0.01, SNAP_GRID - 0.1]} />
                <meshStandardMaterial color={PLANK_DARK} />
              </mesh>
            ))}
          {ground &&
            !ghost &&
            [-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx},${sz}`} position={[sx * (HALF - POST_INSET), -0.8, sz * (HALF - POST_INSET)]} castShadow>
                  <cylinderGeometry args={[0.12, 0.14, 1.4, 6]} />
                  <meshStandardMaterial color={POLE} flatShading />
                </mesh>
              )),
            )}
        </group>
      );
    case "wall":
      return (
        <group>
          <mesh position={[0, WALL_H / 2 - (ground ? 0.3 : 0), 0]} castShadow={!ghost} receiveShadow>
            <boxGeometry args={[SNAP_GRID, WALL_H + (ground ? 0.6 : 0), 0.18]} />
            <Mat color={PLANK} ghost={ghost} />
          </mesh>
          {!ghost &&
            [0.7, 1.5, 2.3].map((y) => (
              <mesh key={y} position={[0, y, 0]}>
                <boxGeometry args={[SNAP_GRID + 0.01, 0.05, 0.2]} />
                <meshStandardMaterial color={PLANK_DARK} />
              </mesh>
            ))}
        </group>
      );
    case "stairs":
      return (
        <group>
          {Array.from({ length: STEPS }, (_, k) => (
            <mesh key={k} position={[0, (k + 1) * RISE - 0.06, -HALF + (k + 0.5) * RUN]} castShadow={!ghost} receiveShadow>
              <boxGeometry args={[1.6, 0.12, RUN + 0.02]} />
              <Mat color={PLANK} ghost={ghost} />
            </mesh>
          ))}
          {/* Hai thanh dầm hai bên. */}
          {!ghost &&
            [-0.85, 0.85].map((x) => (
              <mesh key={x} position={[x, STOREY / 2, 0]} rotation-x={-Math.atan2(STOREY, SNAP_GRID)} castShadow>
                <boxGeometry args={[0.1, 0.25, Math.hypot(STOREY, SNAP_GRID)]} />
                <meshStandardMaterial color={PLANK_DARK} flatShading />
              </mesh>
            ))}
        </group>
      );
    case "tower":
      return (
        <group>
          {/* Bốn cột từ chân (tầng trệt thì chôn sâu thêm) lên quá sàn gác một mét làm cột lan can. */}
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh key={`${sx},${sz}`} position={[sx * (HALF - POST_INSET), (STOREY + 1 - (ground ? 0.6 : 0)) / 2, sz * (HALF - POST_INSET)]} castShadow={!ghost}>
                <cylinderGeometry args={[0.14, 0.16, STOREY + 1 + (ground ? 0.6 : 0), 6]} />
                <Mat color={POLE} ghost={ghost} />
              </mesh>
            )),
          )}
          {/* Sàn gác trên nóc. */}
          <mesh position={[0, STOREY - 0.1, 0]} castShadow={!ghost} receiveShadow>
            <boxGeometry args={[SNAP_GRID - 0.04, 0.2, SNAP_GRID - 0.04]} />
            <Mat color={PLANK} ghost={ghost} />
          </mesh>
          {/* Lan can thấp và giằng chéo. */}
          {!ghost &&
            [0, 1, 2, 3].map((k) => (
              <group key={k} rotation-y={(k * Math.PI) / 2}>
                <mesh position={[0, STOREY + 0.9, HALF - POST_INSET]}>
                  <boxGeometry args={[SNAP_GRID - 0.3, 0.08, 0.08]} />
                  <meshStandardMaterial color={POLE} flatShading />
                </mesh>
                <mesh position={[0, STOREY / 2, HALF - POST_INSET]} rotation-z={Math.atan2(STOREY - 0.4, SNAP_GRID - 0.4)}>
                  <boxGeometry args={[Math.hypot(STOREY - 0.4, SNAP_GRID - 0.4), 0.08, 0.08]} />
                  <meshStandardMaterial color={POLE} flatShading />
                </mesh>
              </group>
            ))}
        </group>
      );
  }
}

/** Va chạm của một mảnh (cùng gốc toạ độ với mô hình). */
function SnapCollider({ kind, ground }: { kind: SnapKind; ground: boolean }) {
  switch (kind) {
    case "floor":
      return <CuboidCollider args={[HALF, 0.1, HALF]} position={[0, -0.1, 0]} />;
    case "wall":
      return <CuboidCollider args={[HALF, (WALL_H + (ground ? 0.6 : 0)) / 2, 0.09]} position={[0, WALL_H / 2 - (ground ? 0.3 : 0), 0]} />;
    case "stairs":
      return (
        <>
          {Array.from({ length: STEPS }, (_, k) => (
            <CuboidCollider key={k} args={[0.8, ((k + 1) * RISE) / 2, RUN / 2]} position={[0, ((k + 1) * RISE) / 2, -HALF + (k + 0.5) * RUN]} />
          ))}
        </>
      );
    case "tower":
      return (
        <>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => <CylinderCollider key={`${sx},${sz}`} args={[STOREY / 2, 0.15]} position={[sx * (HALF - POST_INSET), STOREY / 2, sz * (HALF - POST_INSET)]} />),
          )}
          <CuboidCollider args={[HALF, 0.1, HALF]} position={[0, STOREY - 0.1, 0]} />
        </>
      );
  }
}

export interface PlacedBuilding {
  id: string;
  kind: string;
  dx: number;
  dz: number;
  rot: number;
  level: number;
}

/** Các mảnh lắp ghép đã dựng (đi theo lửa trại). */
export function SnapPieces({ world, camp, buildings }: { world: World; camp: { x: number; z: number }; buildings: readonly PlacedBuilding[] }) {
  const pieces = useMemo(
    () =>
      buildings.flatMap((b) => {
        const snap = worldCatalog.buildings.get(b.kind)?.snap;
        if (!snap) return [];
        const piece = snapFromRecord(snap, b.dx, b.dz, b.rot, b.level);
        const base = snapBase(world.heightAt, camp.x, camp.z, piece);
        return [{ ...b, snap, y: snapY(base, piece.level), ground: piece.level === 0 }];
      }),
    [buildings, world, camp.x, camp.z],
  );
  return (
    <>
      {pieces.map((p) => (
        <group key={p.id} position={[camp.x + p.dx, p.y, camp.z + p.dz]} rotation-y={p.rot}>
          <SnapPieceModel kind={p.snap} ground={p.ground} />
          <RigidBody type="fixed" colliders={false}>
            <SnapCollider kind={p.snap} ground={p.ground} />
          </RigidBody>
        </group>
      ))}
    </>
  );
}

/** Mảnh lắp ghép của trại hiện có, dựng lại từ bản ghi trong state. */
export function snapPiecesOf(buildings: readonly PlacedBuilding[]): SnapPiece[] {
  return buildings.flatMap((b) => {
    const snap = worldCatalog.buildings.get(b.kind)?.snap;
    return snap ? [snapFromRecord(snap, b.dx, b.dz, b.rot, b.level)] : [];
  });
}

/**
 * Bóng mảnh lắp ghép trước mặt: bắt vào lưới, xanh là dựng được, đỏ là không (kèm lý do trên HUD). Tầng mặc định là
 * tầng mình đang đứng; lăn chuột nâng hạ thêm (vd. đứng dưới đất đặt sàn tầng 1 cạnh tháp canh).
 */
export function SnapGhost({
  world,
  camp,
  kind,
  snap,
  buildings,
  obstacles,
  enough,
}: {
  world: World;
  camp: { x: number; z: number; packed: boolean };
  kind: string;
  snap: SnapKind;
  buildings: readonly PlacedBuilding[];
  obstacles: readonly SnapObstacle[];
  enough: boolean;
}) {
  const group = useRef<Group>(null);
  const pieces = useMemo(() => snapPiecesOf(buildings), [buildings]);
  const terrain = useMemo(() => snapTerrain(world, camp.x, camp.z, obstacles, TIDE_MEAN + 0.3), [world, camp.x, camp.z, obstacles]);
  const last = useRef({ i: NaN, j: NaN, lv: -1, dir: -1, ok: false, y: 0, problem: "" as string | null, px: 0, pz: 0, rot: 0, level: 0 });
  // Tính lại khi trại, các mảnh đã dựng hay vật liệu đổi.
  useEffect(() => {
    last.current.i = NaN;
  }, [pieces, terrain, enough, camp.packed]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // Ngắm trước mặt chừng 4 m theo hướng camera.
    const x = localPosition.x - Math.sin(look.yaw) * 4;
    const z = localPosition.z - Math.cos(look.yaw) * 4;
    const feetCell = terrain.cell(Math.round((localPosition.x - camp.x) / SNAP_GRID), Math.round((localPosition.z - camp.z) / SNAP_GRID)).base;
    const standing = Math.max(0, Math.floor((localPosition.y - feetCell + 0.6) / STOREY));
    const level = Math.max(0, Math.min(3, standing + buildGhost.lift));
    const dx = x - camp.x;
    const dz = z - camp.z;
    // Chỉ tính lại khi đổi ô, đổi tầng hay đổi hướng (đỡ tạo đối tượng mới mỗi khung hình).
    const i = Math.round((dx / SNAP_GRID) * 2);
    const j = Math.round((dz / SNAP_GRID) * 2);
    const dir = snap === "stairs" ? Math.round(look.yaw / (Math.PI / 2)) : 0;
    const l = last.current;
    if (i !== l.i || j !== l.j || level !== l.lv || dir !== l.dir) {
      const piece = snapPiece(snap, dx, dz, level, look.yaw);
      const problem = camp.packed ? "Phải dựng lửa trại trước đã." : snapProblem(pieces, piece, terrain, snapReach(BUILD_RADIUS));
      const o = snapOffset(piece);
      const base = snapBase(world.heightAt, camp.x, camp.z, piece);
      Object.assign(l, { i, j, lv: level, dir, ok: !problem && enough, problem, y: snapY(base, piece.level), px: camp.x + o.dx, pz: camp.z + o.dz, rot: o.rot, level: piece.level });
      g.traverse((obj) => {
        const m = (obj as Mesh).material as MeshBasicMaterial | undefined;
        if (m && "color" in m) m.color.set(l.ok ? "#6dff8a" : "#ff5a4a");
      });
    }
    // Gửi điểm ngắm thô; server bắt lưới đúng như ở đây.
    Object.assign(buildGhost, { x, z, rot: look.yaw, ok: l.ok, kind, level: l.level });
    g.position.set(l.px, l.y, l.pz);
    g.rotation.y = l.rot;
    const hud = getHud();
    const reason = l.problem ?? (enough ? "" : "Thiếu vật liệu");
    if (hud.buildOk !== l.ok || hud.buildReason !== reason || hud.buildLevel !== l.level) setHud({ buildOk: l.ok, buildReason: reason, buildLevel: l.level });
  });
  return (
    <group ref={group}>
      <SnapPieceModel kind={snap} ghost="#6dff8a" />
    </group>
  );
}
