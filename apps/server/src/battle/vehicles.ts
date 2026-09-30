import {
  TANK,
  bulletAt,
  bulletSteps,
  cannonMuzzle,
  cannonPitch,
  insideBox,
  rayBody,
  rayTank,
  raycastBoxes,
  raycastTerrain,
  tankFits,
  tankStep,
} from "@tentides/content";
import { Messages, VehicleState, type BoomMessage, type CorrectMessage, type HitMessage, type ShotMessage, type VehicleMoveMessage } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";

// Xe tăng: server giữ máu, người lái, hướng tháp pháo; người lái là người chơi thì máy họ tự lái (server kiểm tra tốc
// độ), là máy thì server lái (theo đội hình, tránh nhà cửa, lùi ra khi kẹt). Pháo bắn đạn nổ bay theo đường cong: server
// dò đường đạn một lần lúc bắn (đồi, nhà, xe khác, người), hẹn giờ nổ đúng lúc đạn tới nơi. Người ngồi trong xe không
// trúng đạn thường; nổ (lựu đạn, mìn, pháo) làm mất máu xe; xe nổ tung thì người lái chết theo, xác xe nằm lại làm chỗ nấp.

/** Đạn pháo đang bay: nổ ở (x, y, z) sau `left` giây; `direct` là xe bị bắn trúng thẳng (mất thêm máu). */
interface Shell {
  left: number;
  x: number;
  y: number;
  z: number;
  owner: string;
  direct: string;
}

/** Não máy lái xe (dùng chung với Brain của bots). */
interface Driver {
  tankSpeed: number;
  stuck: number;
  backUp: number;
}

export class Vehicles {
  private seq = 0;
  private shells: Shell[] = [];
  private readyAt = new Map<string, number>();
  private lastMoveAt = new Map<string, number>();

  constructor(private readonly room: BattleRoom) {}

  clear() {
    this.room.state.vehicles.clear();
    this.shells = [];
    this.readyAt.clear();
    this.lastMoveAt.clear();
  }

  /** Tìm chỗ đặt xe quanh (x, z) trong khoảng bán kính [r0, r1] (đất bằng, không vướng nhà). */
  findSpot(x: number, z: number, r0: number, r1: number, rand: () => number): { x: number; z: number; rotY: number } | null {
    const map = this.room.map;
    for (let tries = 0; tries < 60; tries++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const rotY = rand() * Math.PI * 2;
      if (Math.hypot(px, pz) > 175) continue;
      if (!tankFits(map, px, pz, rotY) || !tankFits(map, px, pz, rotY + Math.PI / 2)) continue;
      if ([...this.room.state.vehicles.values()].some((v) => Math.hypot(v.x - px, v.z - pz) < 9)) continue;
      return { x: px, z: pz, rotY };
    }
    return null;
  }

  spawn(x: number, z: number, rotY: number, team: string, driver = ""): string {
    const id = `v${++this.seq}`;
    const v = new VehicleState();
    v.kind = "tank";
    v.x = x;
    v.z = z;
    v.y = this.room.map.world.heightAt(x, z);
    v.rotY = rotY;
    v.turret = rotY;
    v.hp = TANK.hp;
    v.team = team;
    this.room.state.vehicles.set(id, v);
    if (driver) this.seat(driver, id);
    return id;
  }

  /** Cho người `pid` ngồi vào ghế lái xe `vid`. */
  private seat(pid: string, vid: string) {
    const p = this.room.state.players.get(pid);
    const v = this.room.state.vehicles.get(vid);
    if (!p || !v) return;
    p.vehicle = vid;
    v.driver = pid;
    if (!v.team) v.team = p.team;
    p.crouching = p.prone = p.aiming = false;
    p.moving = false;
    p.kit.reloading = false;
    p.kit.healing = "";
    this.syncOccupant(p, v);
    this.room.clientOf(pid)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  private syncOccupant(p: { x: number; y: number; z: number; rotY: number }, v: VehicleState) {
    p.x = v.x;
    p.y = v.y;
    p.z = v.z;
    p.rotY = v.turret;
  }

  /** Chỗ xuống xe: bên hông xe, chỗ trống trên mặt đất. */
  private exitSpot(v: VehicleState): { x: number; y: number; z: number } {
    const map = this.room.map;
    const c = Math.cos(v.rotY);
    const s = Math.sin(v.rotY);
    for (const [u, w] of [
      [-2.8, 0],
      [2.8, 0],
      [0, -4.4],
      [0, 4.4],
      [-3, -3],
      [3, -3],
    ] as const) {
      const x = v.x + c * u + s * w;
      const z = v.z - s * u + c * w;
      const h = map.world.heightAt(x, z);
      if (h < 0.3 || insideBox(map.index, x, h + 0.9, z, 0.4)) continue;
      return { x, y: h + 0.05, z };
    }
    return { x: v.x, y: v.y + TANK.half[1] * 2 + 0.1, z: v.z };
  }

  /** Xuống xe (người chơi bấm E, hay máy nhường ghế cho người chơi cùng đội). */
  exit(pid: string) {
    const p = this.room.state.players.get(pid);
    const v = p?.vehicle ? this.room.state.vehicles.get(p.vehicle) : undefined;
    if (!p || !v) {
      if (p) p.vehicle = "";
      return;
    }
    const at = this.exitSpot(v);
    p.vehicle = "";
    if (v.driver === pid) v.driver = "";
    v.moving = false;
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    this.room.clientOf(pid)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  /** Bấm E cạnh xe: xe trống (hay máy cùng đội đang lái) thì lên ghế lái. Đang ngồi xe thì xuống. */
  enter(pid: string) {
    const s = this.room.state;
    const p = s.players.get(pid);
    if (!p || !p.alive || !this.room.fighting()) return;
    if (p.vehicle) return this.exit(pid);
    let best = "";
    let bestD: number = TANK.enter;
    for (const [vid, v] of s.vehicles) {
      if (v.hp <= 0) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d > bestD || Math.abs(v.y - p.y) > 4) continue;
      const driver = v.driver ? s.players.get(v.driver) : undefined;
      // Xe có người lái: chỉ đổi chỗ được với máy cùng đội.
      if (driver && !(driver.bot && p.team && driver.team === p.team)) continue;
      if (!driver && v.team && p.team && v.team !== p.team && s.battleMode === "squad") continue;
      best = vid;
      bestD = d;
    }
    if (!best) return;
    const v = s.vehicles.get(best)!;
    if (v.driver) this.exit(v.driver);
    this.seat(pid, best);
    v.team = p.team;
  }

  /** Người chơi lái: nhận vị trí mới nếu hợp lý (không vượt tốc độ xe). */
  move(pid: string, m: VehicleMoveMessage) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const v = p?.vehicle ? s.vehicles.get(p.vehicle) : undefined;
    if (!p || !v || !p.alive || v.driver !== pid || v.hp <= 0) return;
    const now = Date.now();
    const elapsed = Math.max(100, now - (this.lastMoveAt.get(pid) ?? now - 100));
    const dist = Math.hypot(m.x - v.x, m.z - v.z);
    if (dist > TANK.forward * 1.8 * (elapsed / 1000) + 0.5 || Math.hypot(m.x, m.z) > 240) {
      this.room.clientOf(pid)?.send(Messages.correct, { x: v.x, y: v.y, z: v.z } satisfies CorrectMessage);
      return;
    }
    this.lastMoveAt.set(pid, now);
    v.x = m.x;
    v.y = this.room.map.world.heightAt(m.x, m.z);
    v.z = m.z;
    v.rotY = m.rotY;
    v.turret = m.turret;
    v.pitch = Math.max(TANK.pitchDown, Math.min(TANK.pitchUp, m.pitch));
    v.moving = m.moving;
    this.syncOccupant(p, v);
  }

  /** Bắn pháo theo hướng tháp pháo, góc nòng: dò đường đạn một lần, hẹn giờ nổ. */
  fire(pid: string, turret: number, pitch: number) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !v || !p.alive || v.driver !== pid || v.hp <= 0 || !this.room.fighting()) return;
    const now = Date.now();
    if (now < (this.readyAt.get(vid) ?? 0)) return;
    this.readyAt.set(vid, now + TANK.reload * 1000);
    v.turret = turret;
    v.pitch = Math.max(TANK.pitchDown, Math.min(TANK.pitchUp, pitch));
    v.shots = (v.shots + 1) % 65536;
    const { o, d } = cannonMuzzle(v, v.turret, v.pitch);
    const max = 450;
    const steps = bulletSteps(TANK.velocity, max);
    let hitS = max;
    let direct = "";
    for (let i = 1; i < steps.length; i++) {
      const a = bulletAt(o, d, TANK.velocity, steps[i - 1]!);
      const b = bulletAt(o, d, TANK.velocity, steps[i]!);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const cd: [number, number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
      let t = Math.min(raycastBoxes(this.room.map.index, a, cd, len), raycastTerrain(this.room.map.world, a, cd, len));
      let hitTank = "";
      for (const [oid, other] of s.vehicles) {
        if (oid === vid) continue;
        const tt = rayTank(other, a, cd, len);
        if (tt < t) {
          t = tt;
          hitTank = oid;
        }
      }
      for (const q of s.players.values()) {
        if (!q.alive || q === p || q.vehicle) continue;
        const h = rayBody(a, cd, { x: q.x, y: q.y, z: q.z, rotY: q.rotY, crouch: q.crouching, prone: q.prone });
        if (h && h.t < t) {
          t = h.t;
          hitTank = "";
        }
      }
      if (t < len) {
        hitS = steps[i - 1]! + (t / len) * (steps[i]! - steps[i - 1]!);
        direct = hitTank;
        break;
      }
    }
    const e = bulletAt(o, d, TANK.velocity, hitS);
    this.shells.push({ left: hitS / TANK.velocity, x: e[0], y: e[1], z: e[2], owner: pid, direct });
    this.room.broadcast(Messages.shot, { id: pid, w: "tank", o, e: [e] } satisfies ShotMessage);
    this.room.bots.onShot(pid, v.x, v.z, 250);
  }

  /** Mất máu xe; hết máu thì nổ tung, người lái chết theo. */
  damage(vid: string, amount: number, attacker: string) {
    const s = this.room.state;
    const v = s.vehicles.get(vid);
    if (!v || v.hp <= 0 || this.room.state.phase !== "battle") return;
    const a = attacker ? s.players.get(attacker) : undefined;
    // Không bắn hỏng xe của đội mình.
    if (a && a.team && a.team === v.team && s.battleMode === "squad" && attacker !== v.driver) return;
    v.hp = Math.max(0, Math.round(v.hp - amount));
    if (attacker && attacker !== v.driver) this.room.clientOf(attacker)?.send(Messages.hit, { kind: v.hp <= 0 ? "kill" : "body", armor: true, amount: Math.round(amount) } satisfies HitMessage);
    if (v.driver) this.room.bots.onHurt(v.driver, attacker);
    if (v.hp > 0) return;
    // Nổ tung: người lái chết, xác xe nằm lại.
    v.moving = false;
    this.room.broadcast(Messages.boom, { kind: "shell", x: v.x, y: v.y + 1.5, z: v.z } satisfies BoomMessage);
    const driver = v.driver;
    v.driver = "";
    if (driver) {
      const p = s.players.get(driver);
      if (p) {
        p.vehicle = "";
        this.room.kill(driver, attacker, "tank", false);
      }
    }
  }

  /** Nổ gần xe (lựu đạn, mìn, pháo): xe mất máu theo khoảng cách. */
  blast(x: number, y: number, z: number, radius: number, maxDamage: number, owner: string) {
    for (const [vid, v] of this.room.state.vehicles) {
      if (v.hp <= 0) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.y + 1.2 - y, v.z - z) - 2);
      if (d > radius) continue;
      const k = Math.pow(1 - d / radius, 1.2);
      this.damage(vid, maxDamage * k * TANK.blastFactor, owner);
    }
  }

  /** Máy lái xe: đi tới `goal` (nếu có), quay tháp pháo về `target`, ngắm xong thì bắn. */
  driveAI(vid: string, pid: string, brain: Driver, goal: { x: number; z: number } | null, target: { x: number; y: number; z: number; vehicle: string; prone: boolean; crouching: boolean } | null, dt: number) {
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0 || v.driver !== pid) return;
    const map = this.room.map;
    let throttle = 0;
    let steer = 0;
    if (brain.backUp > 0) {
      // Kẹt: lùi ra, bẻ lái một bên.
      brain.backUp -= dt;
      throttle = -1;
      steer = 0.7;
    } else if (goal) {
      const dx = goal.x - v.x;
      const dz = goal.z - v.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(want - v.rotY), Math.cos(want - v.rotY));
      steer = Math.max(-1, Math.min(1, diff * 2));
      throttle = Math.abs(diff) > 1.1 ? 0.1 : dist > 25 ? 1 : 0.55;
    }
    const step = tankStep(map, v, throttle, steer, brain.tankSpeed, dt);
    brain.tankSpeed = step.speed;
    if (step.blocked && throttle > 0) {
      brain.stuck += dt;
      if (brain.stuck > 1.2) {
        brain.stuck = 0;
        brain.backUp = 1.4;
      }
    } else brain.stuck = Math.max(0, brain.stuck - dt);
    v.x = step.pose.x;
    v.y = step.pose.y;
    v.z = step.pose.z;
    v.rotY = step.pose.rotY;
    v.moving = Math.abs(step.speed) > 0.3;
    // Tháp pháo: quay về mục tiêu (hay về trước mũi xe khi rảnh).
    let want = v.rotY;
    let wantPitch = 0;
    let dist = 0;
    if (target) {
      dist = Math.hypot(target.x - v.x, target.z - v.z);
      want = Math.atan2(target.x - v.x, target.z - v.z);
      const ty = target.y + (target.vehicle ? 1.3 : target.prone ? 0.2 : target.crouching ? 0.7 : 1);
      wantPitch = cannonPitch(dist - TANK.barrel, ty - (v.y + TANK.gunY));
    }
    const diff = Math.atan2(Math.sin(want - v.turret), Math.cos(want - v.turret));
    const turn = TANK.turret * dt;
    v.turret += Math.max(-turn, Math.min(turn, diff));
    v.pitch += Math.max(-0.5 * dt, Math.min(0.5 * dt, wantPitch - v.pitch));
    const p = this.room.state.players.get(pid);
    if (p) this.syncOccupant(p, v);
    if (target && Math.abs(diff) < 0.03 && Math.abs(wantPitch - v.pitch) < 0.02 && dist > 8) {
      // Bắn lệch chút ít theo khoảng cách (máy không bắn trúng tuyệt đối).
      const err = 0.004 + dist * 0.00012;
      this.fire(pid, v.turret + (Math.random() - 0.5) * 2 * err, v.pitch + (Math.random() - 0.5) * err);
    }
  }

  tick(dt: number) {
    const s = this.room.state;
    // Người trong xe đi theo xe (máy khác vẽ xe; vị trí người dùng cho bản đồ, vùng độc).
    for (const v of s.vehicles.values()) {
      if (!v.driver) continue;
      const p = s.players.get(v.driver);
      if (!p || !p.alive || p.vehicle === "") {
        v.driver = "";
        v.moving = false;
        continue;
      }
      if (!p.bot) this.syncOccupant(p, v);
    }
    if (!this.shells.length) return;
    const keep: Shell[] = [];
    for (const sh of this.shells) {
      sh.left -= dt;
      if (sh.left > 0) {
        keep.push(sh);
        continue;
      }
      if (sh.direct) this.damage(sh.direct, TANK.armorDamage, sh.owner);
      this.room.explode(sh.x, sh.y, sh.z, "shell", sh.owner, TANK.radius, TANK.damage);
    }
    this.shells = keep;
  }
}
