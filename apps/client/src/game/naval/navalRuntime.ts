import { deckBelow, shipClass, shipToWorld, worldToShip, type ShipPose } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { sampleTrackAt, shipTime, shipTracks } from "../netInterp.ts";

// Trạng thái hải chiến phía client dùng chung giữa các phần: tư thế vẽ của hai chiến hạm (đã nội suy, ngoại suy tới
// hiện tại), mang người chơi theo tàu khi đứng trên boong, vị trí điều khiển mình đang đứng, đơn vị mình đang lái.

interface Pose extends ShipPose {
  cls: string;
}

const cur = new Map<string, Pose>();
const prev = new Map<string, Pose>();
const scratch = { x: 0, y: 0, z: 0, rotY: 0 };
let frame = -1;

/** Vị trí điều khiển mình đang đứng (−1: đi bộ), đơn vị đang lái (tên lửa, ngư lôi, máy bay), góc nhìn. */
export const navalLocal = {
  station: -1,
  unit: "",
  /** Lệnh máy, bánh lái đang gửi (người lái tàu). */
  throttle: 0,
  rudder: 0,
  /** Đang giữ F dập lửa. */
  dousing: false,
  /** Điểm ngắm pháo chính trên mặt biển (thế giới) và tầm (m). */
  aimX: 0,
  aimZ: 0,
  aimRange: 0,
  /** Hướng tới điểm ngắm (thế giới), thời gian bay của đạn tới đó (giây); máy bay: bom rơi mất bao lâu. */
  aimYaw: 0,
  flight: 0,
  bombT: 0,
  /** Đang phóng to ống nhòm. */
  zoom: false,
  /** Thứ làm được bằng F khi đi bộ: vào vị trí, dập lửa, leo lên tàu; dòng nhắc. */
  near: { kind: "" as "" | "station" | "fire" | "board", station: -1, label: "" },
  /** Dấu ngắm đón đầu (phòng không), toạ độ màn hình 0–1. */
  leads: [] as { x: number; y: number; kind: string; d: number }[],
  /** Dấu tàu địch trên màn hình (front: ở phía trước camera). */
  enemy: { on: false, front: false, x: 0, y: 0, dist: 0 },
};

/** Đơn vị mình đang lái (tên lửa, ngư lôi dẫn đường, máy bay): vị trí dự đoán trên máy mình (vẽ, camera). */
export const myUnit = { id: "", x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0 };

/**
 * Cập nhật tư thế vẽ hai tàu cho khung hình này (gọi đầu khung, trước người chơi và camera). `n`: số khung (gọi nhiều
 * lần cùng một khung chỉ tính một lần).
 */
export function updateShips(room: IslandRoom, n: number) {
  if (n === frame) return;
  frame = n;
  const t = shipTime();
  const ships = room.state.naval?.ships;
  for (const id of [...cur.keys()])
    if (!ships?.has(id)) {
      cur.delete(id);
      prev.delete(id);
    }
  ships?.forEach((s, id) => {
    const old = cur.get(id);
    if (old) prev.set(id, { ...old });
    const p: Pose = old ?? { x: s.x, y: s.y, z: s.z, rotY: s.rotY, cls: s.cls };
    if (sampleTrackAt(shipTracks, id, t, scratch)) {
      p.x = scratch.x;
      p.y = scratch.y;
      p.z = scratch.z;
      p.rotY = scratch.rotY;
    } else {
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
      p.rotY = s.rotY;
    }
    p.cls = s.cls;
    cur.set(id, p);
    if (!old) prev.set(id, { ...p });
  });
}

/** Tư thế vẽ của tàu (khoá là phe), hay undefined. */
export function shipPose(id: string): Pose | undefined {
  return cur.get(id);
}

export function shipPoses(): ReadonlyMap<string, Pose> {
  return cur;
}

/**
 * Mang người đứng trên boong theo tàu: chân ở (x, y, z) có nằm trên mặt sàn tàu nào không (theo tư thế khung trước);
 * nếu có, trả về độ dời (thế giới) và góc quay tàu vừa đi trong khung này.
 */
export function carryAt(x: number, y: number, z: number): { ship: string; dx: number; dy: number; dz: number; dyaw: number } | null {
  for (const [id, now] of cur) {
    const was = prev.get(id);
    if (!was) continue;
    const cls = shipClass(now.cls);
    const [lx, ly, lz] = worldToShip(was, x, y, z);
    if (Math.abs(lx) > cls.beam / 2 + 0.6 || Math.abs(lz) > cls.length / 2 + 0.6) continue;
    const floor = deckBelow(cls, lx, ly + 0.4, lz);
    if (!Number.isFinite(floor) || ly - floor > 3) continue;
    const [nx, ny, nz] = shipToWorld(now, lx, ly, lz);
    const dyaw = Math.atan2(Math.sin(now.rotY - was.rotY), Math.cos(now.rotY - was.rotY));
    return { ship: id, dx: nx - x, dy: ny - y, dz: nz - z, dyaw };
  }
  return null;
}

/**
 * Chỗ đứng trên boong theo trạng thái server (vị trí người và tàu cùng một gói): tàu nào, toạ độ riêng của tàu; để
 * đặt người lên tàu đang vẽ trên máy mình (tàu vẽ trễ, sớm hơn server một chút theo mạng).
 */
export function deckOfState(room: IslandRoom, p: { x: number; y: number; z: number }): { ship: string; local: [number, number, number] } | null {
  let hit: { ship: string; local: [number, number, number] } | null = null;
  room.state.naval?.ships.forEach((s, id) => {
    if (hit) return;
    const cls = shipClass(s.cls);
    const local = worldToShip(s, p.x, p.y, p.z);
    if (Math.abs(local[0]) > cls.beam / 2 + 0.6 || Math.abs(local[2]) > cls.length / 2 + 0.6) return;
    const floor = deckBelow(cls, local[0], local[1] + 0.4, local[2]);
    if (Number.isFinite(floor) && local[1] - floor < 3) hit = { ship: id, local };
  });
  return hit;
}

/** Tàu có boong ngay dưới điểm này (để vẽ người khác cùng nhịp với tàu), hay "". */
export function shipUnder(x: number, y: number, z: number): string {
  for (const [id, p] of cur) {
    const cls = shipClass(p.cls);
    const [lx, ly, lz] = worldToShip(p, x, y, z);
    if (Math.abs(lx) > cls.beam / 2 + 1 || Math.abs(lz) > cls.length / 2 + 1) continue;
    if (ly > -1 && ly < cls.deck + 25) return id;
  }
  return "";
}

/** Đổi điểm toạ độ riêng của tàu sang thế giới theo tư thế vẽ. */
export function shipPoint(id: string, lx: number, ly: number, lz: number): [number, number, number] | null {
  const p = cur.get(id);
  return p ? shipToWorld(p, lx, ly, lz) : null;
}

// Xem trong console khi dev (tư thế vẽ hai tàu, vị trí điều khiển, đơn vị đang lái).
if (import.meta.env.DEV) (globalThis as { __naval?: unknown }).__naval = { poses: cur, navalLocal, myUnit };
