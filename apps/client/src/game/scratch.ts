import type { useRapier } from "@react-three/rapier";

// Đồ dùng lại cho các vòng lặp mỗi khung hình: tia vật lý dò va chạm. Trước đây mỗi lần dò tạo một `new rapier.Ray`
// (cộng hai object toạ độ), vài lần mỗi khung hình ⇒ rác cho bộ thu gom. Rapier đọc toạ độ tia ngay trong lệnh dò,
// không giữ lại, nên một tia dùng chung là đủ (chỉ cần dò xong mới đặt lại tia cho lần sau).

type Rapier = ReturnType<typeof useRapier>["rapier"];
type Ray = InstanceType<Rapier["Ray"]>;
interface Vec {
  x: number;
  y: number;
  z: number;
}

let ray: Ray | null = null;

/** Tia dùng chung, đặt gốc (ox, oy, oz) và hướng (dx, dy, dz). Dùng ngay trong lệnh dò, không cất giữ. */
export function scratchRay(rapier: Rapier, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray {
  if (!ray) ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const o = ray.origin;
  const d = ray.dir;
  o.x = ox;
  o.y = oy;
  o.z = oz;
  d.x = dx;
  d.y = dy;
  d.z = dz;
  return ray;
}

/** Như `scratchRay`, gốc và hướng lấy từ hai vector có sẵn (Vector3 của three cũng được). */
export function scratchRayFrom(rapier: Rapier, origin: Vec, dir: Vec): Ray {
  return scratchRay(rapier, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
}
