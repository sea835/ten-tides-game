import { WAR_BASES, WAR_SITES, boatFits, vehicleFits } from "@tentides/content";
import type { BattleRoom } from "./BattleRoom.ts";
import type { Vehicles } from "./vehicles.ts";

// Xe trinh sát, thuyền tuần tra đặt sẵn trên bản đồ lúc vào trận (bỏ trống, ai tới trước lên trước). Chiến trường:
// mỗi phe hai xe trinh sát ở căn cứ, hai thuyền neo ngoài bờ biển gần Nhà máy Xi măng (G) và Pháo đài Đá (B, đối
// xứng); xe nổ, xác xe dọn đi rồi thì một lúc sau có xe mới đúng chỗ cũ. Đảo sinh tồn: vài xe trinh sát rải ở các
// khu, hai thuyền neo ngoài khơi hai phía đảo. Tắt xe cơ giới (`vehiclesEnabled` false) thì không đặt gì.

/** Chờ chừng này giây sau khi xác xe được dọn thì có xe mới (chiến trường). */
export const FLEET_RESPAWN = 30;
const WAR_JEEPS_PER_SIDE = 2;
const ISLAND_JEEPS = 3;

/**
 * Chủ phòng có bật xe cơ giới không (`state.vehiclesEnabled`; trạng thái phòng đã chạm trần 63 trường của schema
 * nên chỉ đọc nếu có, không có thì coi như bật).
 */
function vehiclesOn(room: BattleRoom): boolean {
  return room.state.settings.vehiclesEnabled;
}

interface Slot {
  kind: "jeep" | "boat";
  x: number;
  z: number;
  rotY: number;
  team: string;
  vid: string;
  wait: number;
}

export class Fleet {
  private slots: Slot[] = [];

  constructor(
    private readonly room: BattleRoom,
    private readonly vehicles: Vehicles,
  ) {}

  clear() {
    this.slots = [];
  }

  /** Đặt xe lúc bắt đầu trận (sau xe tăng). */
  setup() {
    this.slots = [];
    const s = this.room.state;
    if (!vehiclesOn(this.room)) return;
    const map = this.room.map;
    const rand = Math.random;
    if (map.layout === "war") {
      for (const side of ["blue", "red"] as const) {
        const base = WAR_BASES[side];
        const out = Math.sign(-base.x);
        for (let k = 0; k < WAR_JEEPS_PER_SIDE; k++) {
          const spot = this.vehicles.findSpot(base.x + out * 30, base.z + (k ? 16 : -16), 0, 14, rand, "jeep") ?? this.vehicles.findSpot(base.x + out * 50, base.z, 0, 35, rand, "jeep");
          if (spot) this.add("jeep", spot.x, spot.z, out > 0 ? Math.PI / 2 : -Math.PI / 2, side);
        }
      }
      for (const id of ["g", "b"]) {
        const site = WAR_SITES.find((w) => w.id === id);
        const spot = site && shoreWater(this.room, site.x, site.z);
        if (spot) this.add("boat", spot.x, spot.z, spot.rotY, "");
      }
    } else {
      const sites = map.sites.filter((x) => x.kind !== "minefield");
      for (let k = 0, tries = 0; k < ISLAND_JEEPS && tries < 20; tries++) {
        const site = sites[Math.floor(rand() * sites.length)];
        if (!site) break;
        const spot = this.vehicles.findSpot(site.x, site.z, Math.max(site.rx, site.rz) + 4, Math.max(site.rx, site.rz) + 30, rand, "jeep");
        if (!spot) continue;
        this.add("jeep", spot.x, spot.z, spot.rotY, "");
        k++;
      }
      const a0 = rand() * Math.PI * 2;
      for (const a of [a0, a0 + Math.PI]) {
        const spot = shoreWater(this.room, Math.cos(a) * 60, Math.sin(a) * 60, [Math.cos(a), Math.sin(a)]);
        if (spot) this.add("boat", spot.x, spot.z, spot.rotY, "");
      }
    }
  }

  private add(kind: Slot["kind"], x: number, z: number, rotY: number, team: string) {
    const slot: Slot = { kind, x, z, rotY, team, vid: "", wait: 0 };
    slot.vid = this.vehicles.spawn(x, z, rotY, team, "", kind);
    this.slots.push(slot);
  }

  /** Chiến trường: xe của chỗ nào đã nổ và xác đã dọn thì một lúc sau có xe mới (chỗ cũ có vật cản thì tìm quanh đó). */
  tick(dt: number) {
    const s = this.room.state;
    if (s.battleMode !== "war" || s.phase !== "battle" || !vehiclesOn(this.room)) return;
    for (const slot of this.slots) {
      if (s.vehicles.has(slot.vid)) continue;
      slot.wait += dt;
      if (slot.wait < FLEET_RESPAWN) continue;
      slot.wait = 0;
      const map = this.room.map;
      let at: { x: number; z: number; rotY: number } | null = { x: slot.x, z: slot.z, rotY: slot.rotY };
      const crowded = [...s.vehicles.values()].some((v) => Math.hypot(v.x - slot.x, v.z - slot.z) < 7);
      if (crowded || !vehicleFits(slot.kind, map, slot.x, slot.z, slot.rotY)) at = this.vehicles.findSpot(slot.x, slot.z, 4, 25, Math.random, slot.kind);
      if (at) slot.vid = this.vehicles.spawn(at.x, at.z, at.rotY, slot.team, "", slot.kind);
    }
  }
}

/**
 * Chỗ neo thuyền ngoài bờ gần (x, z): dò ra biển theo vài hướng (hay theo `prefer`), lấy chỗ nước sâu đầu tiên thuyền
 * nằm được, mũi quay vào bờ (để ủi bãi đổ quân).
 */
export function shoreWater(room: BattleRoom, x: number, z: number, prefer?: [number, number]): { x: number; z: number; rotY: number } | null {
  const map = room.map;
  const dirs: [number, number][] = prefer ? [prefer] : [];
  for (let k = 0; k < 16; k++) dirs.push([Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2)]);
  let best: { x: number; z: number; rotY: number; d: number } | null = null;
  for (const [dx, dz] of dirs) {
    for (let r = 10; r < 260; r += 3) {
      const px = x + dx * r;
      const pz = z + dz * r;
      if (Math.abs(px) > (map.half ?? 240) - 8 || Math.abs(pz) > (map.half ?? 240) - 8) break;
      if (map.world.heightAt(px, pz) > -2.5) continue;
      // Ra xa thêm chút cho khỏi mắc cạn, mũi quay về bờ.
      const qx = px + dx * 6;
      const qz = pz + dz * 6;
      const rotY = Math.atan2(-dx, -dz);
      if (!boatFits(map, qx, qz, rotY)) break;
      if (!best || r < best.d) best = { x: qx, z: qz, rotY, d: r };
      break;
    }
    if (prefer && best) break;
  }
  return best ? { x: best.x, z: best.z, rotY: best.rotY } : null;
}
