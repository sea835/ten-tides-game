import {
  ARTILLERY,
  JUGGERNAUT,
  MAX_POINTS,
  MINIGUN,
  SPECIAL_DROP,
  SPECIAL_LOOT,
  STREAKS,
  TACTICAL_POINTS,
  TOW,
  UAV,
  WEAPON,
  airdropClear,
  airdropSpot,
  armorFactor,
  artilleryImpacts,
  floorBelow,
  minigunRpm,
  rayBody,
  rayVehicle,
  raycastBoxes,
  raycastTerrain,
  raycastTrunks,
  towSteer,
  type ArmorFace,
  type PointKind,
  type StreakId,
  type WeaponDef,
} from "@tentides/content";
import { Messages, ProjectileState, TrapState, type PlayerState, type PointsMessage, type ShotMessage, type StreakFxMessage, type StreakMessage, type TowSteerMessage } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { GUN_SLOTS, addAmmo, giveWeapon, setMag } from "./kit.ts";

// Điểm chi viện chiến thuật (Chiến trường, Đồng đội; sinh tồn solo thì không): server cộng điểm khi hạ gục, chiếm cứ
// điểm, tiếp tế, sửa xe, hồi sinh, phá xe địch (điểm nằm trong `gear.tp`, giữ qua các lần gục), rồi kiểm tra mỗi lần
// gọi chi viện: đủ điểm, hết thời gian chờ, toạ độ hợp lệ.
// - UAV: `state.traps` thêm một mục "uav" (phe, giây còn lại) — người vào giữa trận cũng thấy máy bay, phe đó thấy địch
//   trên bản đồ nhỏ.
// - Mưa pháo: mục "artillery" trong `traps` (khói đỏ ở chỗ chấm, giây còn lại); mỗi loạt báo trước tiếng rít ("salvo"),
//   tới giờ thì nổ qua room.explode (phá tường, sập nhà như đạn pháo xe tăng).
// - Thùng chi viện: thả dù qua Airdrops.dropAt tới chỗ chọn; giáp Juggernaut nhặt như đồ thường (BattleRoom.pickup gọi
//   wear), Minigun quay nòng (allowShot), TOW dẫn đường bằng dây (guided / steer, tên lửa trong `projectiles`).

/** Các phòng đang chạy: để earnPoints (gọi từ awardXp) tìm được phòng của người chơi chỉ với id. */
const ROOMS = new Set<Streaks>();

/** Cộng điểm chiến thuật cho người chơi `playerId` ở phòng người đó đang chơi (awardXp gọi). Trả về số điểm đã cộng. */
export function earnPoints(playerId: string, kind: PointKind, times = 1): number {
  for (const s of ROOMS) if (s.has(playerId)) return s.earn(playerId, kind, times);
  return 0;
}

interface Salvo {
  at: number;
  pts: [number, number, number][];
  warned: boolean;
}

interface Strike {
  key: string;
  owner: string;
  /** Giây kể từ lúc gọi. */
  t: number;
  salvos: Salvo[];
}

interface Missile {
  key: string;
  owner: string;
  pos: [number, number, number];
  dir: [number, number, number];
  life: number;
  flown: number;
  /** Lệnh lái gần nhất: mắt, hướng ngắm, lúc nhận (đồng hồ của Streaks, giây). */
  eye: [number, number, number];
  aim: [number, number, number];
  wireAt: number;
  def: WeaponDef;
}

export class Streaks {
  /** Đồng hồ (ms) và bộ số ngẫu nhiên; thử nghiệm thay được. */
  now: () => number = () => Date.now();
  random: () => number = Math.random;
  private ready = new Map<string, number>();
  private uavs = new Map<string, { team: string; left: number }>();
  private strikes: Strike[] = [];
  private missiles: Missile[] = [];
  /** Minigun: phát đầu loạt và phát gần nhất (ms) theo người. */
  private bursts = new Map<string, { start: number; last: number }>();
  /** Đồng hồ nội bộ (giây, tăng theo tick) cho lệnh lái tên lửa. */
  private clock = 0;
  private seq = 0;

  constructor(private readonly room: BattleRoom) {
    ROOMS.add(this);
  }

  /** Phòng đóng: thôi nhận điểm qua earnPoints. */
  dispose() {
    ROOMS.delete(this);
  }

  has(id: string): boolean {
    return this.room.state.players.has(id);
  }

  /** Chế độ có chi viện không (Chiến trường, Đồng đội). */
  enabled(): boolean {
    return this.room.state.battleMode === "war" || this.room.state.battleMode === "squad";
  }

  /** Trận mới (hay về sảnh): xoá điểm, giáp Juggernaut, UAV, mưa pháo, tên lửa đang bay. */
  clear() {
    const s = this.room.state;
    for (const p of s.players.values()) {
      p.gear.tp = 0;
      p.gear.jugg = false;
    }
    for (const key of this.uavs.keys()) s.traps.delete(key);
    for (const st of this.strikes) s.traps.delete(st.key);
    for (const m of this.missiles) s.projectiles.delete(m.key);
    this.uavs.clear();
    this.strikes = [];
    this.missiles = [];
    this.ready.clear();
    this.bursts.clear();
  }

  private tell(id: string, kind: string, amount: number, total: number) {
    this.room.clientOf(id)?.send(Messages.points, { kind, amount, total } satisfies PointsMessage);
  }

  private reject(id: string, reason: string) {
    this.room.clientOf(id)?.send(Messages.rejected, { reason });
  }

  /** Cộng điểm cho một sự kiện (chỉ người thật, đang đánh, chế độ có chi viện). Trả về số điểm đã cộng. */
  earn(id: string, kind: PointKind, times = 1): number {
    const p = this.room.state.players.get(id);
    const n = Math.max(0, Math.floor(times));
    if (!p || p.bot || !n || !this.enabled() || this.room.state.phase !== "battle") return 0;
    const before = p.gear.tp;
    p.gear.tp = Math.min(MAX_POINTS, before + TACTICAL_POINTS[kind] * n);
    const amount = p.gear.tp - before;
    if (amount > 0) this.tell(id, kind, amount, p.gear.tp);
    return amount;
  }

  /** Phe (hay đội) của người chơi: UAV báo cho cả phe; không đội thì chỉ mình. */
  private sideOf(id: string, p: PlayerState): string {
    return p.team || id;
  }

  /**
   * Người `id` gọi chi viện. Kiểm tra: chế độ có chi viện, đang đánh, còn sống, đủ điểm, hết thời gian chờ, toạ độ
   * hợp lệ (trong bản đồ; mưa pháo không sát mình; thùng chi viện không quá xa, có chỗ trống). Trả về true nếu gọi được.
   */
  call(id: string, m: StreakMessage): boolean {
    const room = this.room;
    const s = room.state;
    const p = s.players.get(id);
    if (!p || p.bot || !p.alive || !this.enabled() || s.phase !== "battle") return false;
    const def = STREAKS[m.kind as StreakId];
    if (!def) return false;
    if (p.gear.tp < def.cost) {
      this.reject(id, `Chưa đủ điểm chiến thuật (cần ${def.cost}).`);
      return false;
    }
    const now = this.now();
    const key = `${id}|${def.id}`;
    const ready = this.ready.get(key) ?? 0;
    if (now < ready) {
      this.reject(id, `${def.name}: chờ thêm ${Math.ceil((ready - now) / 1000)} giây.`);
      return false;
    }
    const side = this.sideOf(id, p);
    let ok = false;
    if (def.id === "uav") ok = this.uav(id, side);
    else {
      if (m.x === undefined || m.z === undefined) return false;
      const half = room.map.half ?? 240;
      if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || Math.abs(m.x) > half || Math.abs(m.z) > half) {
        this.reject(id, "Toạ độ nằm ngoài bản đồ.");
        return false;
      }
      if (def.id === "artillery") ok = this.artillery(id, p, m.x, m.z);
      else ok = this.airdrop(id, p, m.x, m.z, m.pick ?? "jugg");
    }
    if (!ok) return false;
    p.gear.tp -= def.cost;
    this.ready.set(key, now + def.cooldown * 1000);
    this.tell(id, def.id, -def.cost, p.gear.tp);
    return true;
  }

  private announce(fx: StreakFxMessage) {
    this.room.broadcast(Messages.streakFx, fx);
  }

  private uav(id: string, side: string): boolean {
    for (const u of this.uavs.values())
      if (u.team === side) {
        this.reject(id, "UAV của phe mình đang bay.");
        return false;
      }
    const key = `uav${++this.seq}`;
    const t = new TrapState();
    t.defId = "uav";
    t.team = side;
    t.owner = id;
    t.y = UAV.height;
    t.hp = UAV.seconds;
    this.room.state.traps.set(key, t);
    this.uavs.set(key, { team: side, left: UAV.seconds });
    const p = this.room.state.players.get(id)!;
    this.announce({ kind: "uav", team: side, name: p.name, x: 0, y: UAV.height, z: 0, t: UAV.seconds });
    return true;
  }

  private artillery(id: string, p: PlayerState, x: number, z: number): boolean {
    if (Math.hypot(x - p.x, z - p.z) < ARTILLERY.minRange) {
      this.reject(id, `Quá gần vị trí của mình (tối thiểu ${ARTILLERY.minRange} m).`);
      return false;
    }
    const map = this.room.map;
    const y = floorBelow(map, x, 160, z);
    const key = `arty${++this.seq}`;
    const salvos: Salvo[] = artilleryImpacts().map((at) => {
      const pts: [number, number, number][] = [];
      for (let k = 0; k < ARTILLERY.shells; k++) {
        const a = this.random() * Math.PI * 2;
        const r = Math.sqrt(this.random()) * ARTILLERY.spread;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        pts.push([sx, floorBelow(map, sx, 160, sz) + 0.3, sz]);
      }
      return { at, pts, warned: false };
    });
    this.strikes.push({ key, owner: id, t: 0, salvos });
    const t = new TrapState();
    t.defId = "artillery";
    t.x = x;
    t.y = y;
    t.z = z;
    t.team = this.sideOf(id, p);
    t.owner = id;
    t.hp = Math.ceil(salvos[salvos.length - 1]!.at);
    this.room.state.traps.set(key, t);
    this.announce({ kind: "artillery", team: t.team, name: p.name, x, y, z, t: ARTILLERY.warn });
    return true;
  }

  private airdrop(id: string, p: PlayerState, x: number, z: number, pick: "jugg" | "tow"): boolean {
    if (Math.hypot(x - p.x, z - p.z) > SPECIAL_DROP.range) {
      this.reject(id, `Chỗ thả quá xa (tối đa ${SPECIAL_DROP.range} m).`);
      return false;
    }
    const map = this.room.map;
    const spot = airdropClear(map, x, z) ? { x, y: map.world.heightAt(x, z), z } : airdropSpot(map, { x, z, r: SPECIAL_DROP.search }, () => this.random());
    if (!spot) {
      this.reject(id, "Không có chỗ trống để thả dù ở đó.");
      return false;
    }
    if (!this.room.airdrops.dropAt(spot.x, spot.y, spot.z, [...SPECIAL_LOOT[pick]])) return false;
    this.announce({ kind: "airdrop", team: this.sideOf(id, p), name: p.name, x: spot.x, y: spot.y, z: spot.z, t: 0 });
    return true;
  }

  tick(dt: number) {
    const s = this.room.state;
    this.clock += dt;
    for (const [key, u] of this.uavs) {
      u.left -= dt;
      const t = s.traps.get(key);
      if (u.left <= 0 || !t) {
        this.uavs.delete(key);
        s.traps.delete(key);
      } else if (t.hp !== Math.ceil(u.left)) t.hp = Math.ceil(u.left);
    }
    if (this.strikes.length) this.tickStrikes(dt);
    if (this.missiles.length) this.tickMissiles(dt);
  }

  private tickStrikes(dt: number) {
    const s = this.room.state;
    const keep: Strike[] = [];
    for (const st of this.strikes) {
      st.t += dt;
      for (const sv of st.salvos) {
        if (!sv.warned && st.t >= sv.at - ARTILLERY.whistle) {
          sv.warned = true;
          const [x, y, z] = sv.pts[0]!;
          this.announce({ kind: "salvo", team: "", name: "", x, y, z, t: Math.max(0, sv.at - st.t), pts: sv.pts });
        }
      }
      while (st.salvos.length && st.t >= st.salvos[0]!.at) {
        const sv = st.salvos.shift()!;
        for (const [x, y, z] of sv.pts) this.room.explode(x, y, z, "shell", st.owner, ARTILLERY.radius, ARTILLERY.damage, "artillery");
      }
      const t = s.traps.get(st.key);
      if (!st.salvos.length || !t) {
        s.traps.delete(st.key);
        continue;
      }
      const left = Math.ceil(st.salvos[st.salvos.length - 1]!.at - st.t);
      if (t.hp !== left) t.hp = left;
      keep.push(st);
    }
    this.strikes = keep;
  }

  // -------------------------------------------------------------------------- Juggernaut, Minigun

  /** Sát thương sau giáp Juggernaut (chịu đòn gấp JUGGERNAUT.soak lần). */
  soak(p: PlayerState, amount: number): number {
    return p.gear.jugg ? amount / JUGGERNAUT.soak : amount;
  }

  /**
   * Mặc giáp Juggernaut (nhặt "jugg" dưới đất): kèm Minigun và đạn. Đang mặc rồi thì không nhặt. Trả về các món phải
   * bỏ xuống (khẩu bị Minigun thay chỗ), hay null nếu không nhặt được.
   */
  wear(p: PlayerState): string[] | null {
    if (p.gear.jugg || !p.alive) return null;
    p.gear.jugg = true;
    const dropped = giveWeapon(p.kit, WEAPON.get("minigun")!);
    addAmmo(p.kit, "556", JUGGERNAUT.ammo);
    return dropped;
  }

  /** Gục: mất giáp Juggernaut, Minigun không rơi lại (không ai khác vác nổi). */
  onDeath(id: string, p: PlayerState) {
    this.bursts.delete(id);
    if (!p.gear.jugg) return;
    p.gear.jugg = false;
    for (const slot of GUN_SLOTS)
      if (p.kit[slot] === "minigun") {
        p.kit[slot] = "";
        setMag(p.kit, slot, 0);
      }
  }

  /**
   * Kiểm tra thêm cho một phát bắn (sau kiểm tra tốc độ bắn chung): Minigun chỉ bắn được khi mặc giáp Juggernaut, và
   * tốc độ bắn tăng dần từ đầu loạt (minigunRpm). Súng khác luôn được.
   */
  allowShot(id: string, p: PlayerState, def: WeaponDef, now = this.now()): boolean {
    if (def.id !== "minigun") return true;
    if (!p.gear.jugg) return false;
    const b = this.bursts.get(id);
    if (!b || now - b.last > MINIGUN.idle) {
      this.bursts.set(id, { start: now, last: now });
      return true;
    }
    if (now - b.last < (60000 / minigunRpm(def.rpm, now - b.start)) * 0.8) return false;
    b.last = now;
    return true;
  }

  // -------------------------------------------------------------------------- TOW

  /** Phóng tên lửa TOW (thay cho đường bay tính trước của RPG). Trả về true nếu là TOW (đã phóng). */
  guided(id: string, def: WeaponDef, o: [number, number, number], d: [number, number, number]): boolean {
    if (def.id !== "tow" || !def.explosive) return false;
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const dir: [number, number, number] = [d[0] / l, d[1] / l, d[2] / l];
    const key = `tow${++this.seq}`;
    this.missiles.push({ key, owner: id, pos: [o[0], o[1], o[2]], dir, life: TOW.life, flown: 0, eye: [o[0], o[1], o[2]], aim: dir, wireAt: this.clock, def });
    const ps = new ProjectileState();
    ps.itemId = "tow";
    [ps.x, ps.y, ps.z] = o;
    this.room.state.projectiles.set(key, ps);
    // Máy khác nghe tiếng phóng, thấy chớp lửa ở miệng ống (vệt ngắn); tên lửa vẽ theo `projectiles`.
    const shot: ShotMessage = { id, w: def.id, o, e: [[o[0] + dir[0] * 2, o[1] + dir[1] * 2, o[2] + dir[2] * 2]] };
    this.room.broadcast(Messages.shot, shot, { except: this.room.clientOf(id) });
    return true;
  }

  /** Lệnh lái tên lửa của người `id`: mắt phải ở sát người đó, hướng ngắm chuẩn hoá. */
  steer(id: string, m: TowSteerMessage): boolean {
    const p = this.room.state.players.get(id);
    if (!p || !p.alive) return false;
    const [ox, oy, oz] = m.o;
    // Camera góc ba có thể lùi sau lưng vài mét.
    if (Math.hypot(ox - p.x, oz - p.z) > 6 || oy < p.y - 2 || oy > p.y + 5) return false;
    const l = Math.hypot(m.d[0], m.d[1], m.d[2]);
    if (l < 0.5) return false;
    let any = false;
    for (const ms of this.missiles) {
      if (ms.owner !== id) continue;
      ms.eye = [ox, oy, oz];
      ms.aim = [m.d[0] / l, m.d[1] / l, m.d[2] / l];
      ms.wireAt = this.clock;
      any = true;
    }
    return any;
  }

  /** Còn dây dẫn: người bắn còn sống, đang cầm TOW, lệnh lái mới đây. */
  private wired(ms: Missile): boolean {
    const p = this.room.state.players.get(ms.owner);
    if (!p || !p.alive || p.vehicle) return false;
    const slot = p.kit.active;
    const held = slot === "primary1" || slot === "primary2" || slot === "pistol" ? p.kit[slot] : "";
    return held === "tow" && this.clock - ms.wireAt <= TOW.wire;
  }

  private tickMissiles(dt: number) {
    const s = this.room.state;
    const room = this.room;
    const keep: Missile[] = [];
    for (const ms of this.missiles) {
      if (this.wired(ms)) ms.dir = towSteer(ms.dir, ms.pos, ms.eye, ms.aim, TOW.turn * dt);
      const step = TOW.speed * dt;
      const a = ms.pos;
      const cd = ms.dir;
      let t = Math.min(raycastBoxes(room.map.index, a, cd, step, true), raycastTerrain(room.map.world, a, cd, step), raycastTrunks(room.map.world, a, cd, step, room.map.treeDead));
      let hit: { vid: string; face: ArmorFace; cos: number } | null = null;
      for (const [vid, v] of s.vehicles) {
        if (Math.abs(v.x - a[0]) + Math.abs(v.z - a[2]) > step + 12) continue;
        const hv = rayVehicle(v, a, cd, step);
        if (hv && hv.t < t) {
          t = hv.t;
          hit = { vid, face: hv.face, cos: hv.cos };
        }
      }
      // Người: không tính chính người bắn lúc tên lửa vừa rời ống.
      for (const [qid, q] of s.players) {
        if (!q.alive || q.vehicle || (qid === ms.owner && ms.flown < 3)) continue;
        if (Math.abs(q.x - a[0]) + Math.abs(q.z - a[2]) > step + 4) continue;
        const h = rayBody(a, cd, { x: q.x, y: q.y, z: q.z, rotY: q.rotY, crouch: q.crouching, prone: q.prone, lean: q.lean });
        if (h && h.t < t) {
          t = h.t;
          hit = null;
        }
      }
      ms.life -= dt;
      const ps = s.projectiles.get(ms.key);
      if (t < step || ms.life <= 0 || !ps) {
        const k = t < step ? t : step;
        const x = a[0] + cd[0] * k;
        const y = a[1] + cd[1] * k;
        const z = a[2] + cd[2] * k;
        s.projectiles.delete(ms.key);
        const spec = ms.def.explosive!;
        // Trúng thẳng vỏ xe: tên lửa xuyên giáp (không nảy), mạnh nhất ở hông, đuôi.
        if (hit) room.vehicles.damage(hit.vid, spec.armor * armorFactor(s.vehicles.get(hit.vid)?.kind ?? "tank", hit.face, hit.cos, 1).mult, ms.owner, "tow");
        room.explode(x, y, z, "shell", ms.owner, spec.radius, spec.damage, "tow", hit?.vid ?? "");
        continue;
      }
      ms.pos = [a[0] + cd[0] * step, a[1] + cd[1] * step, a[2] + cd[2] * step];
      ms.flown += step;
      [ps.x, ps.y, ps.z] = ms.pos;
      keep.push(ms);
    }
    this.missiles = keep;
  }
}
