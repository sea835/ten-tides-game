import {
  FLARES,
  HELI,
  HYDRA,
  IGLA_LOCK,
  MISSILE,
  advanceLock,
  flareDecoys,
  heliCrashDamage,
  heliGround,
  heliMoveOk,
  heliProbe,
  heliRocketAim,
  lockReady,
  missileStep,
  raycastBoxes,
  raycastTerrain,
  type LockState,
  type MissileState,
} from "@tentides/content";
import { Messages, type AirFxMessage, type CorrectMessage, type VehicleMoveMessage, type VehicleState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import type { Vehicles } from "./vehicles.ts";

// Trực thăng và phòng không: phi công tự bay trên máy mình (gửi vị trí 15 lần / giây), server kiểm tra tốc độ, trần
// bay, không chui vào đất / nhà (heliMoveOk), tính sát thương va chạm (rơi mạnh xuống đất, đâm vào nhà). Rocket mũi
// phóng qua đường launch chung (như RPG); hết rocket, pháo sáng thì đáp xuống sân đỗ nhà để nạp lại. Trực thăng không
// người lái thì tự quay rơi chậm xuống đất; đậu dưới biển thì ngập máy.
// Tên lửa vác vai IGLA: người cầm báo đang giữ tâm ngắm lên trực thăng (aaLock), server cộng dồn thời gian khoá (đứt
// quãng thì khoá lại), kiểm tra tầm và đường ngắm; khoá chín thì phát bắn thành tên lửa đuổi theo (server mô phỏng,
// giới hạn góc quay), không thì bay thẳng. Tổ lái thấy cảnh báo theo `alert`; pháo sáng mồi được tên lửa trong tầm và
// cắt mọi khoá đang giữ trong lúc cháy.

/** Tên lửa đang bay (kèm người bắn, lúc gửi vị trí lần cuối cho các máy vẽ). */
interface Flying extends MissileState {
  id: string;
  owner: string;
  sendLeft: number;
  sx: number;
  sy: number;
  sz: number;
}

/** Giãn cách gửi vị trí tên lửa cho các máy (giây). */
const MISSILE_SEND = 0.1;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Air {
  private seq = 0;
  private missiles: Flying[] = [];
  /** Khoá đang giữ theo người ngắm. */
  private locks = new Map<string, LockState>();
  /** Theo id trực thăng: lúc thả pháo sáng gần nhất (ms), pháo sáng còn cháy (s), lúc bắn rocket kế (ms), ống kế tiếp. */
  private flareAt = new Map<string, number>();
  private flareBurn = new Map<string, number>();
  private rocketAt = new Map<string, number>();
  private pod = new Map<string, number>();
  /** Lúc nhận gói vị trí gần nhất (ms), giây chờ đợt nạp đạn kế. */
  private moveAt = new Map<string, number>();
  private rearmLeft = new Map<string, number>();
  /** Sân đỗ nhà của từng trực thăng (đáp ở đây thì được nạp rocket, pháo sáng). */
  private home = new Map<string, { x: number; z: number }>();

  constructor(
    private readonly room: BattleRoom,
    private readonly vehicles: Vehicles,
  ) {}

  clear() {
    this.missiles = [];
    this.locks.clear();
    this.flareAt.clear();
    this.flareBurn.clear();
    this.rocketAt.clear();
    this.pod.clear();
    this.moveAt.clear();
    this.rearmLeft.clear();
    this.home.clear();
  }

  /** Trực thăng mới: đầy rocket, pháo sáng; chỗ đặt là sân đỗ nhà. */
  arm(vid: string, v: VehicleState) {
    v.rockets = HELI.rockets;
    v.flares = HELI.flares;
    this.home.set(vid, { x: v.x, z: v.z });
  }

  /** Sân đỗ nhà của trực thăng `vid` (máy lái về đây nạp đạn). */
  homeOf(vid: string): { x: number; z: number } | undefined {
    return this.home.get(vid);
  }

  /** Khoá IGLA đã chín (giữ đủ lâu) chưa. */
  lockReadyFor(pid: string): boolean {
    return lockReady(this.locks.get(pid) ?? null, Date.now());
  }

  /** Số tên lửa đang bay (thử nghiệm, HUD). */
  get flying(): readonly MissileState[] {
    return this.missiles;
  }

  /**
   * Gói vị trí của phi công. Trả false nếu bị từ chối (đã gửi lệnh sửa vị trí). Va chạm: lấy tốc độ va chạm máy phi
   * công báo, hay server tự thấy (rơi nhanh sát đất), cái nào lớn hơn; đủ mạnh thì mất máu, quá mạnh thì nổ tung.
   */
  move(pid: string, vid: string, v: VehicleState, m: VehicleMoveMessage): boolean {
    const map = this.room.map;
    const now = Date.now();
    const elapsed = Math.max(0.1, (now - (this.moveAt.get(vid) ?? now - 100)) / 1000);
    if (!heliMoveOk(map, v, m, elapsed)) {
      this.room.clientOf(pid)?.send(Messages.correct, { x: v.x, y: v.y, z: v.z } satisfies CorrectMessage);
      return false;
    }
    const ground = heliGround(map, m.x, m.z);
    const vy = (m.y - v.y) / elapsed;
    let impact = Math.min(m.impact ?? 0, 60);
    if (m.y - ground < 0.6 && vy < -HELI.safeSink) impact = Math.max(impact, -vy);
    this.moveAt.set(vid, now);
    v.x = m.x;
    v.y = Math.max(ground, m.y);
    v.z = m.z;
    v.rotY = m.rotY;
    v.tilt = clamp(m.tilt ?? 0, -HELI.tiltMax, HELI.tiltMax);
    v.roll = clamp(m.roll ?? 0, -HELI.rollMax - 0.12, HELI.rollMax + 0.12);
    v.moving = m.moving;
    const dmg = heliCrashDamage(impact);
    if (dmg > 0) this.vehicles.damage(vid, dmg, "", "crash");
    return true;
  }

  /** Phi công bắn một quả rocket mũi (luân phiên hai ống) theo hướng ngắm `yaw`, `pitch` (kẹp vào nón quanh mũi). */
  rocket(pid: string, vid: string, v: VehicleState, yaw: number, pitch: number) {
    if (v.driver !== pid || v.hp <= 0 || v.rockets <= 0 || !this.room.fighting()) return;
    const now = Date.now();
    if (now < (this.rocketAt.get(vid) ?? 0)) return;
    this.rocketAt.set(vid, now + HELI.rocketGap * 1000 * 0.85);
    v.rockets -= 1;
    const k = this.pod.get(vid) ?? 0;
    this.pod.set(vid, k + 1);
    const { o, d } = heliRocketAim(v, k, yaw, pitch);
    // Tản nhẹ.
    const spread = HYDRA.hipSpread;
    d[0] += (Math.random() - 0.5) * spread;
    d[1] += (Math.random() - 0.5) * spread;
    d[2] += (Math.random() - 0.5) * spread;
    const l = Math.hypot(d[0], d[1], d[2]);
    this.vehicles.launch(pid, o, [d[0] / l, d[1] / l, d[2] / l], HYDRA.velocity, HYDRA.explosive!, HYDRA.id, vid, HYDRA.boost);
    this.room.bots.onShot(pid, v.x, v.z, 200);
  }

  /** Phi công thả pháo sáng: mồi tên lửa đang đuổi theo (trong tầm), cắt mọi khoá đang giữ trong lúc pháo cháy. */
  flare(pid: string) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !p.alive || !v || v.kind !== "heli" || v.driver !== pid || v.hp <= 0 || v.flares <= 0 || !this.room.fighting()) return;
    const now = Date.now();
    if (now < (this.flareAt.get(vid) ?? 0) + HELI.flareCooldown * 1000) return;
    this.flareAt.set(vid, now);
    this.flareBurn.set(vid, FLARES.burn);
    v.flares -= 1;
    for (const [shooter, lock] of this.locks) if (lock.vid === vid) this.locks.delete(shooter);
    for (const m of this.missiles) if (m.target === vid) this.tryDecoy(m, v);
    this.room.broadcast(Messages.airFx, { kind: "flare", id: vid, x: v.x, y: v.y + 0.8, z: v.z, px: 0, py: 0, pz: 0, speed: 0 } satisfies AirFxMessage);
    this.updateAlert(vid, v, now);
  }

  /** Pháo sáng đang cháy quanh trực thăng `v`: tên lửa trong tầm có thể bị mồi (rẽ về đám pháo sáng, bỏ trực thăng). */
  private tryDecoy(m: Flying, v: VehicleState, roll = Math.random()) {
    if (m.decoy) return;
    const dist = Math.hypot(m.x - v.x, m.y - v.y, m.z - v.z);
    if (!flareDecoys(dist, roll)) return;
    m.decoy = { x: v.x, y: v.y - 4, z: v.z };
    m.target = "";
  }

  /** Người cầm IGLA đang ngắm vào trực thăng `vid`: kiểm tra rồi cộng dồn thời gian khoá. */
  lock(pid: string, vid: string) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const v = s.vehicles.get(vid);
    const ok = !!p && !!v && this.canLock(pid, vid);
    if (!ok) {
      this.locks.delete(pid);
      return;
    }
    const now = Date.now();
    this.locks.set(pid, advanceLock(this.locks.get(pid) ?? null, vid, now));
    this.updateAlert(vid, v!, now);
  }

  /** Người `pid` có khoá được trực thăng `vid` không: cầm IGLA, đi bộ, trực thăng địch đang bay, trong tầm, thấy được. */
  canLock(pid: string, vid: string): boolean {
    const s = this.room.state;
    const p = s.players.get(pid);
    const v = s.vehicles.get(vid);
    if (!p || !p.alive || p.vehicle || !v || v.kind !== "heli" || v.hp <= 0 || !this.room.fighting()) return false;
    const kit = p.kit as unknown as Record<string, string>;
    if (kit[p.kit.active] !== "igla") return false;
    if ((this.flareBurn.get(vid) ?? 0) > 0) return false;
    if (s.battleMode !== "solo" && p.team && v.team === p.team) return false;
    const map = this.room.map;
    if (v.y - heliGround(map, v.x, v.z) < IGLA_LOCK.minAlt) return false;
    const eye: [number, number, number] = [p.x, p.y + 1.55, p.z];
    const dx = v.x - eye[0];
    const dy = v.y + 1.2 - eye[1];
    const dz = v.z - eye[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > IGLA_LOCK.range || dist < 1) return false;
    const d: [number, number, number] = [dx / dist, dy / dist, dz / dist];
    const reach = dist - 3;
    return raycastTerrain(map.world, eye, d, reach) >= reach && raycastBoxes(map.index, eye, d, reach, true) >= reach;
  }

  /** Khoá đang giữ của người `pid` (thử nghiệm, HUD). */
  lockOf(pid: string): LockState | null {
    return this.locks.get(pid) ?? null;
  }

  /** Bắn IGLA (đã qua kiểm tra súng, đạn ở BattleRoom.fire): khoá chín thì tên lửa đuổi theo, không thì bay thẳng. */
  fireMissile(pid: string, o: [number, number, number], dir: [number, number, number]) {
    const now = Date.now();
    const lock = this.locks.get(pid) ?? null;
    this.locks.delete(pid);
    const target = lockReady(lock, now) && this.canLock(pid, lock!.vid) ? lock!.vid : "";
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const m: Flying = {
      id: `m${++this.seq}`,
      owner: pid,
      x: o[0],
      y: o[1],
      z: o[2],
      dx: dir[0] / l,
      dy: dir[1] / l,
      dz: dir[2] / l,
      speed: MISSILE.speed,
      age: 0,
      target,
      decoy: null,
      sendLeft: 0,
      sx: o[0],
      sy: o[1],
      sz: o[2],
    };
    this.missiles.push(m);
    const v = target ? this.room.state.vehicles.get(target) : undefined;
    if (v && (this.flareBurn.get(target) ?? 0) > 0) this.tryDecoy(m, v);
    this.room.broadcast(Messages.airFx, { kind: "missile", id: m.id, x: m.x, y: m.y, z: m.z, px: m.x, py: m.y, pz: m.z, speed: m.speed } satisfies AirFxMessage);
    if (v) this.updateAlert(target, v, now);
  }

  /** Cảnh báo cho tổ lái: tên lửa đang bay tới (3), đã bị khoá (2), đang bị ngắm (1). */
  private updateAlert(vid: string, v: VehicleState, now: number) {
    let alert = 0;
    for (const m of this.missiles) if (m.target === vid) alert = 3;
    if (alert < 3)
      for (const lock of this.locks.values()) {
        if (lock.vid !== vid || now - lock.at > IGLA_LOCK.gap * 1000) continue;
        alert = Math.max(alert, lock.held >= IGLA_LOCK.time ? 2 : 1);
      }
    if (v.alert !== alert) v.alert = alert;
  }

  tick(dt: number) {
    const s = this.room.state;
    const map = this.room.map;
    const now = Date.now();
    for (const [vid, left] of this.flareBurn) {
      if (left - dt <= 0) this.flareBurn.delete(vid);
      else this.flareBurn.set(vid, left - dt);
    }
    for (const [vid, v] of s.vehicles) {
      if (v.kind !== "heli") continue;
      if (v.hp <= 0) {
        // Xác trực thăng rơi thẳng xuống đất.
        const g = heliGround(map, v.x, v.z);
        if (v.y > g) v.y = Math.max(g, v.y - 14 * dt);
        if (v.alert) v.alert = 0;
        continue;
      }
      // Hệ thống tự vệ: tên lửa đã bay tới gần (dưới 220 m) mà phi công chưa thả pháo sáng thì tự thả (còn pháo sáng,
      // hết thời gian chờ). Trước đây phi công mới tập bay chưa kịp nghe còi đã bị tên lửa hạ ngay sau khi cất cánh.
      if (v.driver && v.alert >= 3 && v.flares > 0 && !this.flareBurn.has(vid)) {
        for (const m of this.missiles)
          if (m.target === vid && Math.hypot(m.x - v.x, m.y - v.y, m.z - v.z) < 220) {
            this.flare(v.driver);
            break;
          }
      }
      let ground = heliGround(map, v.x, v.z);
      // Bỏ trống trên không: mặt đỗ thật bên dưới (nóc nhà, bệ bê tông) chứ không chỉ mặt đất.
      if (!v.driver && v.y - ground > 0.05) ground = heliProbe(map, v.x, v.y, v.z, v.rotY).floor;
      const alt = v.y - ground;
      if (!v.driver && alt > 0.05) {
        // Không người lái: cánh quạt tự quay, rơi chậm xuống; chạm đất thì hư nhẹ.
        const fall = HELI.sink * 0.8 * dt;
        v.y = Math.max(ground, v.y - fall);
        v.tilt *= 0.95;
        v.roll *= 0.95;
        if (v.y <= ground) {
          const dmg = heliCrashDamage(HELI.sink * 0.8);
          if (dmg > 0) this.vehicles.damage(vid, dmg, "", "crash");
        }
      }
      if (alt < 0.4 && v.hp > 0) {
        // Đậu dưới biển: ngập máy.
        if (map.world.heightAt(v.x, v.z) < -0.4 && v.y < 0.4) this.vehicles.damage(vid, HELI.drown * dt, "", "crash");
        // Đáp ở sân đỗ nhà: nạp dần rocket, pháo sáng.
        const home = this.home.get(vid);
        if (home && Math.hypot(v.x - home.x, v.z - home.z) < HELI.rearmRadius && (v.rockets < HELI.rockets || v.flares < HELI.flares)) {
          const left = (this.rearmLeft.get(vid) ?? HELI.rearmEvery) - dt;
          if (left <= 0) {
            v.rockets = Math.min(HELI.rockets, v.rockets + 2);
            if (v.flares < HELI.flares) v.flares += 1;
            this.rearmLeft.set(vid, HELI.rearmEvery);
          } else this.rearmLeft.set(vid, left);
        }
      }
      this.updateAlert(vid, v, now);
    }
    for (const [pid, lock] of this.locks) if (now - lock.at > IGLA_LOCK.gap * 1000 * 2) this.locks.delete(pid);
    if (this.missiles.length) this.flyMissiles(dt);
  }

  /** Tên lửa bay một bước: đuổi theo trực thăng (hay đám pháo sáng), chạm đất / nhà / tới gần mục tiêu thì nổ. */
  private flyMissiles(dt: number) {
    const s = this.room.state;
    const map = this.room.map;
    const keep: Flying[] = [];
    for (const m of this.missiles) {
      const tv = m.target ? s.vehicles.get(m.target) : undefined;
      if (m.target && (!tv || tv.hp <= 0)) m.target = "";
      const aim = m.decoy ?? (tv && m.target ? { x: tv.x, y: tv.y + 1.2, z: tv.z } : null);
      if (m.decoy) m.decoy.y -= 3 * dt;
      const o: [number, number, number] = [m.x, m.y, m.z];
      const len = missileStep(m, aim, dt);
      const d: [number, number, number] = [m.dx, m.dy, m.dz];
      let end = Math.min(raycastTerrain(map.world, o, d, len), raycastBoxes(map.index, o, d, len, true));
      if (m.y < 0 && end > len) end = len;
      let hitVid = "";
      // Ngòi cận đích: trực thăng nào (trừ khi vừa rời ống) có tâm gần đoạn bay này.
      if (m.age > MISSILE.arm)
        for (const [vid, v] of s.vehicles) {
          if (v.kind !== "heli" || v.hp <= 0) continue;
          const cx = v.x - o[0];
          const cy = v.y + 1.2 - o[1];
          const cz = v.z - o[2];
          const t = clamp(cx * d[0] + cy * d[1] + cz * d[2], 0, len);
          const miss = Math.hypot(cx - d[0] * t, cy - d[1] * t, cz - d[2] * t);
          if (miss <= MISSILE.fuse && t < end) {
            end = t;
            hitVid = vid;
          }
        }
      const decoyed = m.decoy && Math.hypot(m.x - m.decoy.x, m.y - m.decoy.y, m.z - m.decoy.z) < 6;
      if (end < len || decoyed || m.age > MISSILE.life) {
        const t = Math.min(end, len);
        const x = o[0] + d[0] * t;
        const y = o[1] + d[1] * t;
        const z = o[2] + d[2] * t;
        this.room.broadcast(Messages.airFx, { kind: "end", id: m.id, x, y, z, px: m.sx, py: m.sy, pz: m.sz, speed: m.speed } satisfies AirFxMessage);
        if (hitVid) this.vehicles.damage(hitVid, MISSILE.armor, m.owner, "igla");
        this.room.explode(x, y, z, "shell", m.owner, MISSILE.radius, MISSILE.damage, "igla", hitVid);
        continue;
      }
      m.sendLeft -= dt;
      if (m.sendLeft <= 0) {
        m.sendLeft = MISSILE_SEND;
        this.room.broadcast(Messages.airFx, { kind: "missile", id: m.id, x: m.x, y: m.y, z: m.z, px: m.sx, py: m.sy, pz: m.sz, speed: m.speed } satisfies AirFxMessage);
        m.sx = m.x;
        m.sy = m.y;
        m.sz = m.z;
      }
      keep.push(m);
    }
    this.missiles = keep;
  }
}
