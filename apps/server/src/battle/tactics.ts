import { WATER_LEVEL, raycastBoxes, type BattleMap } from "@tentides/content";
import type { NavGrid } from "./nav.ts";

// Chọn chỗ đứng cho máy theo chiến thuật: chỗ bắn tỉa (cao, xa, nhìn thẳng được vào mục tiêu), chỗ nấp khi giữ cứ
// điểm (trong nhà, sau tường thấp, hướng ra phía địch tới), hướng canh gác (nhìn ra khoảng trống phía địch chứ không
// úp mặt vào tường). Các hàm dò nhiều tia nên chỉ gọi khi đổi mục tiêu, kết quả máy nhớ lại.

export interface Spot {
  x: number;
  z: number;
}

export interface TacticsHost {
  map: BattleMap;
  nav: NavGrid;
  height(x: number, z: number): number;
  visible(eye: [number, number, number], x: number, y: number, z: number): boolean;
}

/** Khoảng trống (m) nhìn theo hướng `yaw` từ mắt, tới `max` (tường, nhà, đồi chắn). */
export function freeAhead(host: TacticsHost, x: number, y: number, z: number, yaw: number, max: number): number {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  let free = Math.min(max, raycastBoxes(host.map.index, [x, y, z], [dx, 0, dz], max));
  for (let t = 3; t < free; t += 3) {
    if (host.height(x + dx * t, z + dz * t) > y - 0.2) {
      free = t;
      break;
    }
  }
  return free;
}

/**
 * Hướng canh gác: trong 16 hướng quanh mình, chọn hướng vừa thoáng (nhìn được xa) vừa gần hướng địch có thể tới
 * (`threat`, radian; NaN nếu không rõ). Đứng sát tường thì quay ra phía thoáng thay vì nhìn vào tường.
 */
export function lookOut(host: TacticsHost, x: number, y: number, z: number, threat: number): number {
  let best = Number.isNaN(threat) ? 0 : threat;
  let bestScore = -Infinity;
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    const free = freeAhead(host, x, y + 1.4, z, yaw, 40) / 40;
    const toward = Number.isNaN(threat) ? 0 : Math.cos(yaw - threat);
    // Nhìn vào tường gần (dưới 4 m) là vô ích dù đúng hướng địch.
    const score = free < 0.1 ? -2 + free : free + 0.6 * toward;
    if (score > bestScore) {
      bestScore = score;
      best = yaw;
    }
  }
  return best;
}

/**
 * Chỗ bắn tỉa cho mục tiêu (tx, tz): trên vành 55–135 m quanh mục tiêu, lệch về phía `home` (phe mình), đi tới được,
 * từ đó nằm (mắt thấp) vẫn nhìn thẳng được vào mục tiêu; chỗ càng cao càng tốt. Không có chỗ nào thì null.
 */
export function overwatch(host: TacticsHost, tx: number, tz: number, homeYaw: number, rand = Math.random): Spot | null {
  const ty = host.height(tx, tz) + 1.2;
  let best: Spot | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 28; k++) {
    const a = homeYaw + (rand() - 0.5) * 2.4;
    const r = 55 + rand() * 80;
    const x = tx + Math.sin(a) * r;
    const z = tz + Math.cos(a) * r;
    const y = host.height(x, z);
    if (y < WATER_LEVEL + 0.5 || !host.nav.walkable(x, z)) continue;
    if (!host.visible([x, y + 0.6, z], tx, ty, tz)) continue;
    const score = (y - ty) * 0.6 + rand() * 4 - Math.abs(r - 95) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}

/** Có mái che phía trên không (đứng trong nhà). */
function indoor(host: TacticsHost, x: number, y: number, z: number): boolean {
  return raycastBoxes(host.map.index, [x, y + 1.2, z], [0, 1, 0], 8) < 8;
}

/**
 * Chỗ nấp để giữ khu vực tâm (cx, cz) bán kính r, địch tới từ hướng `threat`: ưu tiên trong nhà, có vật chắn ngang
 * thân ở phía địch (tường, bao cát) mà đầu vẫn nhìn ra được, không quá xa tâm. Mỗi lần gọi bốc ngẫu nhiên nên các máy
 * tản ra nhiều chỗ khác nhau.
 */
export function coverSpot(host: TacticsHost, cx: number, cz: number, r: number, threat: number, rand = Math.random): Spot | null {
  let best: Spot | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 18; k++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (!host.nav.walkable(x, z)) continue;
    const y = host.height(x, z);
    let score = rand() * 0.8 - (d / Math.max(1, r)) * 0.6;
    if (indoor(host, x, y, z)) score += 2;
    if (!Number.isNaN(threat)) {
      const dx = Math.sin(threat);
      const dz = Math.cos(threat);
      const body = raycastBoxes(host.map.index, [x, y + 0.7, z], [dx, 0, dz], 2.2);
      const head = raycastBoxes(host.map.index, [x, y + 1.45, z], [dx, 0, dz], 6);
      // Vật chắn ngang ngực ở phía địch, đầu vẫn ló ra nhìn được (cửa sổ, tường thấp, bao cát): chỗ nấp lý tưởng.
      if (body < 2.2 && head >= 6) score += 2.2;
      else if (body < 2.2) score += 0.6;
      if (freeAhead(host, x, y + 1.45, z, threat, 30) > 15) score += 0.8;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}
