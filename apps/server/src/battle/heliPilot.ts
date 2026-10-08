import { HELI, ROCKET_CONE, heliCrashDamage, heliGround, heliStep, type HeliMotion } from "@tentides/content";
import type { PlayerState, VehicleState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";

// Máy lái trực thăng (chiến trường): người chơi lái trên máy mình rồi gửi vị trí, còn máy thì server tự bay bằng đúng
// mô hình bay đó (heliStep). Cất cánh lên độ cao an toàn (ngoài tầm RPG), bay tới cứ điểm đang giao tranh, lượn vòng
// quanh đó tìm địch; thấy địch thì quay mũi, chúc xuống bắn một loạt rocket rồi lượn tiếp; bị khoá tên lửa thì thả
// pháo sáng; hết rocket hay máu thấp thì về sân đỗ nhà đáp xuống nạp lại rồi bay tiếp.

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Độ cao bay so với mặt đất (m): đủ cao để RPG không với tới, đủ thấp để bắn rocket chính xác. */
const CRUISE = 42;
const ATTACK_ALT = 32;
/** Bán kính lượn vòng quanh khu vực giao tranh, tầm bắt đầu bắn, tầm nhìn tìm địch. */
const ORBIT = 85;
const FIRE_RANGE = 150;
const SPOT_RANGE = 190;
/** Mỗi loạt rocket, nghỉ giữa hai loạt (giây). */
const SALVO = 4;
const SALVO_GAP = 3.5;

type Mode = "takeoff" | "patrol" | "attack" | "home" | "landed";

interface PilotBrain {
  mode: Mode;
  motion: HeliMotion;
  orbit: number;
  target: string;
  fired: number;
  nextSalvo: number;
  scan: number;
  /** Đã đáp ở nhà bao lâu (chờ nạp đạn). */
  wait: number;
  /** Đồng hồ riêng (giây). */
  clock: number;
}

export class HeliPilots {
  private brains = new Map<string, PilotBrain>();

  constructor(private readonly room: BattleRoom) {}

  forget(id: string) {
    this.brains.delete(id);
  }

  clear() {
    this.brains.clear();
  }

  /** Một nhịp bay cho máy `id` đang ngồi ghế lái trực thăng `vid`. */
  tick(id: string, p: PlayerState, vid: string, v: VehicleState, home: { x: number; z: number } | undefined, dt: number) {
    const room = this.room;
    const s = room.state;
    const map = room.map;
    let b = this.brains.get(id);
    if (!b) {
      b = { mode: "takeoff", motion: { vx: 0, vy: 0, vz: 0 }, orbit: Math.random() * Math.PI * 2, target: "", fired: 0, nextSalvo: 0, scan: 0, wait: 0, clock: 0 };
      this.brains.set(id, b);
    }
    b.clock += dt;
    const ground = heliGround(map, v.x, v.z);
    const alt = v.y - ground;
    // Bị khoá, tên lửa đang bay tới: thả pháo sáng.
    if (v.alert >= 2 && v.flares > 0) room.vehicles.air.flare(id);
    // Hết rocket, máu thấp: về nhà nạp.
    if ((v.rockets <= 0 || v.hp < HELI.hp * 0.35) && b.mode !== "landed" && home) b.mode = "home";

    // Khu vực giao tranh: cứ điểm gần nhất chưa phải của phe mình.
    let area = home ?? { x: v.x, z: v.z };
    let bestD = Infinity;
    for (const f of s.flags.values()) {
      if (f.owner === p.team) continue;
      const d = Math.hypot(f.x - v.x, f.z - v.z);
      if (d < bestD) {
        bestD = d;
        area = f;
      }
    }

    // Tìm địch thấy được trong tầm (vài lần mỗi giây).
    b.scan -= dt;
    if (b.scan <= 0 && b.mode !== "home" && b.mode !== "landed" && alt > 15) {
      b.scan = 0.6;
      b.target = "";
      let best = SPOT_RANGE;
      for (const [oid, o] of s.players) {
        if (!o.alive || !o.team || o.team === p.team || o.vehicle === vid) continue;
        // Chỉ đánh mục tiêu mặt đất: rocket không điều khiển bắn trực thăng đang bay là việc của IGLA, người chơi.
        const ov = o.vehicle ? s.vehicles.get(o.vehicle) : undefined;
        if (ov?.kind === "heli") continue;
        const d = Math.hypot(o.x - v.x, o.z - v.z);
        if (d > best) continue;
        // Xe tăng địch ưu tiên (tính như gần hơn).
        const score = d * (o.vehicle ? 0.6 : 1);
        if (score > best) continue;
        if (!room.bots.visible([v.x, v.y - 0.5, v.z], o.x, o.y + 1, o.z)) continue;
        best = score;
        b.target = oid;
      }
      if (b.target && b.mode === "patrol") b.mode = "attack";
      if (!b.target && b.mode === "attack") b.mode = "patrol";
    }

    // Đích đến, độ cao mong muốn, hướng mũi.
    let gx = v.x;
    let gz = v.z;
    let wantAlt = CRUISE;
    let face = NaN;
    let maxSpeed = 30;
    let fireYaw = NaN;
    let firePitch = 0;
    switch (b.mode) {
      case "landed": {
        b.wait += dt;
        gx = v.x;
        gz = v.z;
        wantAlt = -5;
        if (b.wait > 4 && v.rockets >= HELI.rockets && v.hp > HELI.hp * 0.35) {
          b.mode = "takeoff";
          b.wait = 0;
        }
        break;
      }
      case "takeoff": {
        wantAlt = CRUISE;
        maxSpeed = alt > 20 ? 18 : 0;
        if (alt > CRUISE * 0.8) b.mode = "patrol";
        break;
      }
      case "patrol": {
        b.orbit += dt * 0.12;
        gx = area.x + Math.sin(b.orbit) * ORBIT;
        gz = area.z + Math.cos(b.orbit) * ORBIT;
        break;
      }
      case "attack": {
        const t = s.players.get(b.target);
        if (!t || !t.alive) {
          b.mode = "patrol";
          break;
        }
        const dx = t.x - v.x;
        const dz = t.z - v.z;
        const d = Math.hypot(dx, dz) || 1;
        wantAlt = ATTACK_ALT;
        face = Math.atan2(dx, dz);
        // Giữ khoảng cách bắn: xa thì tiến tới, gần quá thì lùi ra (lượn ngang).
        const keep = 105;
        gx = t.x - (dx / d) * keep;
        gz = t.z - (dz / d) * keep;
        maxSpeed = 20;
        const ty = t.y + (t.vehicle ? 1.2 : 0.8);
        // Bù rơi đạn rocket rất ít (bay nhanh), lệch chút ít theo khoảng cách.
        fireYaw = face + (Math.random() - 0.5) * 0.025;
        firePitch = Math.atan2(ty - (v.y + 0.5), d) + (Math.random() - 0.5) * 0.02;
        break;
      }
      case "home": {
        const h = home ?? { x: v.x, z: v.z };
        gx = h.x;
        gz = h.z;
        const d = Math.hypot(h.x - v.x, h.z - v.z);
        wantAlt = d > 30 ? CRUISE : d > 6 ? 10 : -5;
        maxSpeed = d > 60 ? 34 : Math.max(3, d * 0.5);
        if (d < 6 && alt < 0.3) {
          b.mode = "landed";
          b.wait = 0;
        }
        break;
      }
    }

    // Né đồi phía trước: lấy độ cao địa hình lớn nhất trên quãng 40 m trước mặt.
    const fx = Math.sin(v.rotY);
    const fz = Math.cos(v.rotY);
    let ahead = ground;
    for (let k = 10; k <= 40; k += 10) ahead = Math.max(ahead, heliGround(map, v.x + fx * k, v.z + fz * k));
    const wantY = wantAlt < 0 ? ground : Math.min(HELI.ceiling - 5, Math.max(ground, ahead) + wantAlt);

    // Bộ điều khiển: vận tốc ngang mong muốn hướng về đích, quay mũi theo hướng bay (hay về mục tiêu).
    const dx = gx - v.x;
    const dz = gz - v.z;
    const dist = Math.hypot(dx, dz);
    const sp = Math.min(maxSpeed, dist * 0.45);
    const wvx = dist > 0.5 ? (dx / dist) * sp : 0;
    const wvz = dist > 0.5 ? (dz / dist) * sp : 0;
    if (Number.isNaN(face) && sp > 4) face = Math.atan2(wvx, wvz);
    const m = b.motion;
    // Sai lệch vận tốc theo trục mũi (tiến) và trục ngang (phải là −cos, sin như heliStep).
    const ex = wvx - m.vx;
    const ez = wvz - m.vz;
    const fwdErr = ex * fx + ez * fz;
    const rightErr = ex * -fz + ez * fx;
    const yawErr = Number.isNaN(face) ? 0 : wrap(face - v.rotY);
    const input = {
      pitch: clamp(fwdErr * 0.12, -1, 1),
      strafe: clamp(rightErr * 0.12, -1, 1),
      // rotY giảm khi cần lái dương.
      yaw: clamp(-yawErr * 2, -1, 1),
      lift: clamp((wantY - v.y) * 0.3, -1, 1),
    };
    const step = heliStep(map, { x: v.x, y: v.y, z: v.z, rotY: v.rotY, tilt: v.tilt, roll: v.roll }, m, input, dt);
    b.motion = step.motion;
    v.x = step.pose.x;
    v.y = step.pose.y;
    v.z = step.pose.z;
    v.rotY = step.pose.rotY;
    v.tilt = step.pose.tilt;
    v.roll = step.pose.roll;
    v.moving = Math.hypot(step.motion.vx, step.motion.vz) > 0.5 || Math.abs(step.motion.vy) > 0.3;
    p.x = v.x;
    p.y = v.y;
    p.z = v.z;
    p.rotY = v.rotY;
    const dmg = heliCrashDamage(step.impact);
    if (dmg > 0) room.vehicles.damage(vid, dmg, "", "crash");

    // Bắn: mục tiêu nằm trong nón rocket quanh mũi, trong tầm; mỗi loạt vài quả rồi nghỉ.
    if (b.mode === "attack" && !Number.isNaN(fireYaw) && v.rockets > 0) {
      const t = s.players.get(b.target)!;
      const d = Math.hypot(t.x - v.x, t.z - v.z);
      const inCone = Math.abs(wrap(fireYaw - v.rotY)) < ROCKET_CONE.yaw * 0.8 && firePitch > ROCKET_CONE.down && firePitch < ROCKET_CONE.up;
      if (inCone && d < FIRE_RANGE && b.clock >= b.nextSalvo) {
        room.vehicles.air.rocket(id, vid, v, fireYaw, firePitch);
        if (++b.fired >= SALVO) {
          b.fired = 0;
          b.nextSalvo = b.clock + SALVO_GAP + Math.random() * 2;
        }
      }
    }
  }
}
