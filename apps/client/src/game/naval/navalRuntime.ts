import { deckBelow, shipClass, shipToWorld, worldToShip, type ShipPose } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";

// Trạng thái hải chiến phía client dùng chung giữa các phần: tư thế vẽ của hai chiến hạm (đã nội suy, ngoại suy tới
// hiện tại), mang người chơi theo tàu khi đứng trên boong, vị trí điều khiển mình đang đứng, đơn vị mình đang lái.

interface Pose extends ShipPose {
  cls: string;
}

const cur = new Map<string, Pose>();
const prev = new Map<string, Pose>();
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
  /**
   * Thước ngắm pháo: bậc tầm dọc tâm ngắm (toạ độ màn hình 0–1, mét), dấu bóng đón đầu trên màn hình, tầm tới địch,
   * quãng địch đi trong lúc đạn bay, độ tản (2σ dọc / ngang, m), bóng đón có nằm trong vùng tản quanh điểm ngắm không.
   */
  gun: {
    on: false,
    ladder: [] as { x: number; y: number; d: number }[],
    lead: { on: false, x: 0, y: 0 },
    enemyRange: 0,
    leadMove: 0,
    spreadLong: 0,
    spreadSide: 0,
    onTarget: false,
  },
};

/** Đơn vị mình đang lái (tên lửa, ngư lôi dẫn đường, máy bay): vị trí dự đoán trên máy mình (vẽ, camera). */
export const myUnit = { id: "", x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0 };

/** Trạng thái server gần nhất của từng tàu và lúc nó đến (để dự đoán tàu đi tiếp tới hiện tại). */
const seen = new Map<string, { x: number; z: number; rotY: number; at: number }>();
let lastAt = 0;

/**
 * Cập nhật tư thế vẽ hai tàu cho khung hình này (gọi đầu khung, trước người chơi và camera). `n`: số khung (gọi nhiều
 * lần cùng một khung chỉ tính một lần).
 *
 * Tàu nặng, đi đều, quay chậm: vẽ theo kiểu dự đoán (đi tiếp theo tốc độ, hướng mũi) rồi kéo dần về chỗ server báo
 * (đã tính thêm quãng tàu đi được từ lúc gói đến). Không nội suy giữa các gói như người: hai gói dồn cục hay đến trễ
 * không làm tàu giật, nhảy, mà người đứng trên boong đi theo tàu cũng mượt.
 */
export function updateShips(room: IslandRoom, n: number) {
  if (n === frame) return;
  frame = n;
  const now = performance.now() / 1000;
  const dt = lastAt ? Math.min(0.25, Math.max(0, now - lastAt)) : 0;
  lastAt = now;
  const ships = room.state.naval?.ships;
  for (const id of [...cur.keys()])
    if (!ships?.has(id)) {
      cur.delete(id);
      prev.delete(id);
      seen.delete(id);
    }
  ships?.forEach((s, id) => {
    const old = cur.get(id);
    if (old) prev.set(id, { ...old });
    let last = seen.get(id);
    if (!last || last.x !== s.x || last.z !== s.z || last.rotY !== s.rotY) {
      last = { x: s.x, z: s.z, rotY: s.rotY, at: now };
      seen.set(id, last);
    }
    // Chỗ tàu lúc này theo server: gói cuối đi tiếp theo tốc độ một đoạn ngắn.
    const age = Math.min(0.3, now - last.at);
    const tx = s.x + Math.sin(s.rotY) * s.speed * age;
    const tz = s.z + Math.cos(s.rotY) * s.speed * age;
    const p: Pose = old ?? { x: tx, y: s.y, z: tz, rotY: s.rotY, cls: s.cls };
    if (old) {
      p.x += Math.sin(p.rotY) * s.speed * dt;
      p.z += Math.cos(p.rotY) * s.speed * dt;
      if (Math.hypot(tx - p.x, tz - p.z) > 25) {
        p.x = tx;
        p.z = tz;
        p.rotY = s.rotY;
      } else {
        const k = 1 - Math.exp(-dt * 3);
        p.x += (tx - p.x) * k;
        p.z += (tz - p.z) * k;
        p.rotY += Math.atan2(Math.sin(s.rotY - p.rotY), Math.cos(s.rotY - p.rotY)) * k;
      }
      p.y += (s.y - p.y) * (1 - Math.exp(-dt * 4));
    }
    p.cls = s.cls;
    cur.set(id, p);
    if (!old) prev.set(id, { ...p });
  });
}

/** Bán kính thân người, bậc bước lên được (m), chiều cao thân (đụng tường). */
const BODY_R = 0.38;
const STEP = 0.5;
const BODY_H = 1.75;
const KNEE = 1;

/**
 * Đi bộ trên boong theo toạ độ riêng của tàu: chân ở (x, y, z) (thế giới, theo tư thế tàu khung trước), muốn dời
 * (mx, mz) theo phương ngang thế giới và (dy) theo phương đứng. Sàn, dốc, bậc là mặt trên các khối của tàu; thành,
 * thượng tầng, lan can chặn lại. Trả về chỗ chân mới (thế giới, theo tư thế tàu khung này) và có đứng trên sàn không.
 * Không qua bộ va chạm của Rapier: khối va chạm của tàu đang chạy được dò ở chỗ cũ một nhịp, đứng trên boong là bị
 * đẩy đi lung tung.
 */
export function walkDeck(id: string, x: number, y: number, z: number, mx: number, dy: number, mz: number): { x: number; y: number; z: number; grounded: boolean } | null {
  const was = prev.get(id);
  const now = cur.get(id);
  if (!was || !now) return null;
  const cls = shipClass(now.cls);
  const [lx, ly, lz] = worldToShip(was, x, y, z);
  const c = Math.cos(was.rotY);
  const sn = Math.sin(was.rotY);
  let nx = lx + c * mx - sn * mz;
  let nz = lz + sn * mx + c * mz;
  // Tường: khối đứng cao hơn bậc bước, chạm thân người thì đẩy ra theo cạnh gần nhất. Đang lên cầu thang thì so với
  // chỗ chân sắp đặt tới (mặt bậc ở chỗ mới), không thì mép sàn trên đầu cầu thang thành tường.
  const ahead = deckBelow(cls, nx, ly + STEP - 0.6, nz);
  const footY = Number.isFinite(ahead) ? Math.max(ly, ahead) : ly;
  for (let pass = 0; pass < 3; pass++) {
    for (const b of cls.boxes) {
      if (!b.solid || b.pitch) continue;
      const top = b.y + b.h / 2;
      const bottom = b.y - b.h / 2;
      if (top <= footY + STEP || bottom >= footY + BODY_H) continue;
      // Mép thấp (bậc, mép sàn trên đầu cầu thang) chỉ chặn khi bàn chân bước hẳn vào; cao quá gối thì chặn cả thân.
      const r = top - footY > KNEE ? BODY_R : 0.05;
      const ex = b.w / 2 + r;
      const ez = b.d / 2 + r;
      const ox = nx - b.x;
      const oz = nz - b.z;
      if (Math.abs(ox) >= ex || Math.abs(oz) >= ez) continue;
      if (ex - Math.abs(ox) < ez - Math.abs(oz)) nx = b.x + (ox < 0 ? -ex : ex);
      else nz = b.z + (oz < 0 ? -ez : ez);
    }
  }
  // Sàn: mặt trên cao nhất không quá một bậc trên chân; rơi tới đó thì đứng, bậc nhỏ đi xuống thì bám sàn.
  let ny = ly + dy;
  const floor = deckBelow(cls, nx, ly + STEP - 0.6, nz);
  let grounded = false;
  if (Number.isFinite(floor) && (ny <= floor || (dy <= 0 && ny - floor < 0.35))) {
    ny = floor;
    grounded = true;
  }
  const [wx, wy, wz] = shipToWorld(now, nx, ny, nz);
  return { x: wx, y: wy, z: wz, grounded };
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
