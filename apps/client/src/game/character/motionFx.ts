import type { World } from "@tentides/content";
import { MAX_EMBERS, embers, puffs } from "../battle/Effects.tsx";
import { physicsProbe } from "../battle/surface.ts";
import type { GroundProbe } from "./locomotion.ts";

// Hiệu ứng của chuyển động nhân vật (Battleground): bụi đất tung lên khi đáp đất, vệt bụi khi trượt / lao người
// nằm sấp, vài tia lửa khi tay quệt đất lúc trượt. Dùng chung đám khói và tia lửa của Effects (đã có trần số lượng).

/** Đám khói chung đông quá mức này thì thôi thêm bụi chân (nhường chỗ cho khói nổ, khói súng). */
const PUFF_ROOM = 820;
/** Tia lửa chung đông quá mức này thì thôi thêm tia quệt đất. */
const EMBER_ROOM = MAX_EMBERS - 60;

/**
 * Bụi đất tung ra quanh (x, y, z): `n` cụm, văng ngang chừng `spread` m/s, theo hướng (dx, dz) nếu có (vệt bụi phía
 * sau người đang trượt). Màu đất khô, mờ dần trong chừng một giây.
 */
export function kickDust(x: number, y: number, z: number, n: number, spread: number, dx = 0, dz = 0, size = 0.35): void {
  for (let k = 0; k < n && puffs.length < PUFF_ROOM; k++) {
    const a = Math.random() * Math.PI * 2;
    const sp = spread * (0.4 + Math.random() * 0.6);
    const shade = 0.85 + Math.random() * 0.25;
    puffs.push({
      x: x + Math.cos(a) * 0.12,
      y: y + 0.06,
      z: z + Math.sin(a) * 0.12,
      vx: Math.cos(a) * sp + dx,
      vy: 0.25 + Math.random() * 0.5,
      vz: Math.sin(a) * sp + dz,
      size: size * (0.7 + Math.random() * 0.6),
      grow: 1.1,
      life: 0.7 + Math.random() * 0.6,
      age: 0,
      r: 0.52 * shade,
      g: 0.46 * shade,
      b: 0.37 * shade,
      alpha: 0.32,
      dense: false,
    });
  }
}

/** Vài tia lửa nhỏ văng ngược hướng trượt (tay, báng súng quệt sỏi đá). */
export function scrapeSparks(x: number, y: number, z: number, n: number, dx: number, dz: number): void {
  for (let k = 0; k < n && embers.length < EMBER_ROOM; k++) {
    const a = (Math.random() - 0.5) * 1.6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sp = 1.5 + Math.random() * 2.5;
    embers.push({
      x,
      y: y + 0.03,
      z,
      vx: (-dx * c + dz * s) * sp,
      vy: 0.6 + Math.random() * 1.4,
      vz: (-dz * c - dx * s) * sp,
      age: 0,
      life: 0.15 + Math.random() * 0.25,
      size: 0.012 + Math.random() * 0.014,
    });
  }
}

/**
 * Dò mặt đất cho chân nhân vật: có tia vật lý (đang trong trận) thì bắn tia thẳng xuống từ trên đầu gối (sàn nhà,
 * cầu, bao cát đều tính), không thì lấy độ cao địa hình và pháp tuyến bằng sai phân. Không thấy đất trong tầm thì NaN.
 */
export function groundProbe(world: World): GroundProbe {
  return (x, y, z, n) => {
    const cast = physicsProbe.cast;
    if (cast) {
      const hit = cast(x, y + 0.55, z, 0, -1, 0, 1.15);
      if (!hit) return Number.NaN;
      n.x = hit.nx;
      n.y = hit.ny;
      n.z = hit.nz;
      return y + 0.55 - hit.t;
    }
    const h = world.heightAt(x, z);
    if (Math.abs(h - y) > 0.6) return Number.NaN;
    const e = 0.25;
    const gx = world.heightAt(x + e, z) - world.heightAt(x - e, z);
    const gz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
    const l = Math.hypot(gx, 2 * e, gz);
    n.x = -gx / l;
    n.y = (2 * e) / l;
    n.z = -gz / l;
    return h;
  };
}
