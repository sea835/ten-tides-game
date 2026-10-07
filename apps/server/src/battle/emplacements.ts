import { BULLET_GRAVITY, HMG, MORTAR, clampElevation, clampTraverse, emplacementSpots, inTraverse, isEmplacement, mortarMuzzle, mountMuzzle, rayBody, rayVehicle, raycastBoxes, raycastTerrain, raycastTrunks, vehicleSpec, type EmplacementSpot } from "@tentides/content";
import { Messages, VehicleState, type MortarFxMessage, type PlayerState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import type { Vehicles } from "./vehicles.ts";

// Vũ khí cố định: ổ đại liên sau bao cát và cối 82 ly, đặt sẵn trên bản đồ (chiến trường: ở các cứ điểm, căn cứ;
// đảo sinh tồn: vài ổ ở rìa các khu). Dùng chung hệ ghế của xe chở quân (VehicleState, ghế 0 là xạ thủ; bấm F lên /
// xuống), nhưng không chạy được. Không theo công tắc "xe cơ giới" của chủ phòng (`vehiclesEnabled`): đây là công sự
// của bản đồ, luôn có. Đạn thường gần như không làm hư bao cát; nổ thì có — hết máu thì nổ tung, xạ thủ chết theo,
// xác nằm lại như xe; chiến trường thì một lúc sau có ổ mới đúng chỗ cũ. Xạ thủ lộ nửa người trên (trúng đạn, mảnh nổ
// như đi bộ; vòng bao cát chặn đạn vào chân, bụng).
// Cối: server giữ nhịp nạp đạn, kẹp góc ngẩng, mô phỏng quả đạn bay theo trọng lực từng nhịp (va địa hình, nhà, cây,
// xe, người thì nổ qua room.explode), báo mọi máy lúc bắn (vẽ quả đạn bay) và lúc đạn sắp rơi (tiếng rít).
// Máy (chiến trường) đi ngang ổ đại liên trống gần cứ điểm thì có khi vào ngồi canh, quét đạn vào lính địch trong cung
// xoay; lâu không thấy ai thì bỏ đi.

/** Chờ chừng này giây sau khi xác được dọn thì có ổ mới (chiến trường). */
export const EMPLACEMENT_RESPAWN = 40;
/** Máy vào ổ đại liên trống khi đi ngang trong chừng này mét; ngồi không thấy địch chừng này giây thì bỏ đi. */
const BOT_MAN_RANGE = 10;
const BOT_IDLE = 45;
const BOT_SIGHT = 150;

interface Slot extends EmplacementSpot {
  vid: string;
  wait: number;
}

/** Quả đạn cối đang bay. */
interface MortarShell {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  owner: string;
  /** Cối đã bắn (bỏ qua va chạm với chính nó lúc mới rời nòng). */
  from: string;
  whistled: boolean;
}

/** Não máy ngồi ổ đại liên. */
interface Gunner {
  target: string;
  scan: number;
  idle: number;
  burst: number;
  pause: number;
}

export class Emplacements {
  private seq = 0;
  private slots: Slot[] = [];
  private shells: MortarShell[] = [];
  private readyAt = new Map<string, number>();
  private gunners = new Map<string, Gunner>();
  private manScan = 0;

  constructor(
    private readonly room: BattleRoom,
    private readonly vehicles: Vehicles,
  ) {}

  clear() {
    this.slots = [];
    this.shells = [];
    this.readyAt.clear();
    this.gunners.clear();
  }

  /** Đặt mọi vũ khí cố định của bản đồ (lúc bắt đầu trận, trước xe cộ để xe tránh chỗ). */
  setup() {
    this.clear();
    for (const spot of emplacementSpots(this.room.map)) {
      const slot: Slot = { ...spot, vid: "", wait: 0 };
      slot.vid = this.spawn(slot);
      this.slots.push(slot);
    }
  }

  private spawn(at: EmplacementSpot): string {
    const id = `e${++this.seq}`;
    const v = new VehicleState();
    v.kind = at.kind;
    v.x = at.x;
    v.z = at.z;
    v.y = this.room.map.world.heightAt(at.x, at.z);
    v.rotY = at.rotY;
    v.turret = at.rotY;
    v.pitch = at.kind === "mortar" ? (60 * Math.PI) / 180 : 0;
    v.hp = vehicleSpec(at.kind).hp;
    this.room.state.vehicles.set(id, v);
    return id;
  }

  /** Người này đang ngồi vũ khí cố định (lộ người ra ngoài: trúng đạn, mảnh nổ như đi bộ). */
  exposed(p: PlayerState): boolean {
    if (!p.vehicle) return false;
    const v = this.room.state.vehicles.get(p.vehicle);
    return !!v && isEmplacement(v.kind);
  }

  /** Số quả đạn cối đang bay (kiểm thử). */
  inFlight(): number {
    return this.shells.length;
  }

  /**
   * Pháo thủ cối bắn: đúng ghế, cối còn lành, đã nạp xong (MORTAR.reload giây), góc ngẩng kẹp về 45°–85°; lệch ngẫu
   * nhiên chút ít rồi thả quả đạn bay theo trọng lực.
   */
  fire(pid: string, turret: number, elev: number) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !v || !p.alive || v.hp <= 0 || v.kind !== "mortar" || v.driver !== pid || !this.room.fighting()) return;
    if (!Number.isFinite(turret) || !Number.isFinite(elev)) return;
    const now = Date.now();
    if (now < (this.readyAt.get(vid) ?? 0)) return;
    this.readyAt.set(vid, now + MORTAR.reload * 1000);
    v.turret = turret;
    v.pitch = clampElevation(elev);
    v.shots = (v.shots + 1) % 65536;
    p.rotY = v.turret;
    const az = v.turret + (Math.random() - 0.5) * 2 * MORTAR.spread;
    const el = v.pitch + (Math.random() - 0.5) * 2 * MORTAR.spread;
    const { o, d } = mortarMuzzle(v, az, el);
    const sh: MortarShell = { x: o[0], y: o[1], z: o[2], vx: d[0] * MORTAR.velocity, vy: d[1] * MORTAR.velocity, vz: d[2] * MORTAR.velocity, age: 0, owner: pid, from: vid, whistled: false };
    this.shells.push(sh);
    this.room.broadcast(Messages.mortarFx, { kind: "fire", vid, x: o[0], y: o[1], z: o[2], vx: sh.vx, vy: sh.vy, vz: sh.vz, t: 0 } satisfies MortarFxMessage);
    this.room.bots.onShot(pid, v.x, v.z, 200);
  }

  tick(dt: number) {
    const s = this.room.state;
    for (const slot of this.slots) {
      const v = s.vehicles.get(slot.vid);
      // Bỏ trống thì không thuộc phe nào (ai tới trước dùng trước).
      if (v && v.hp > 0 && !v.driver && v.team) v.team = "";
      if (v || s.battleMode !== "war" || s.phase !== "battle") continue;
      // Chiến trường: xác đã dọn thì một lúc sau có ổ mới đúng chỗ cũ (có xe đậu đè lên thì chờ tiếp).
      slot.wait += dt;
      if (slot.wait < EMPLACEMENT_RESPAWN) continue;
      if ([...s.vehicles.values()].some((o) => Math.hypot(o.x - slot.x, o.z - slot.z) < 4)) continue;
      slot.wait = 0;
      slot.vid = this.spawn(slot);
    }
    this.manNests(dt);
    if (this.shells.length) this.tickShells(dt);
  }

  // -------------------------------------------------------------------------- đạn cối

  private tickShells(dt: number) {
    const keep: MortarShell[] = [];
    for (const sh of this.shells) if (!this.stepShell(sh, dt)) keep.push(sh);
    this.shells = keep;
  }

  /** Một nhịp bay của quả đạn (chia nhỏ cho đều); true nếu đã nổ hay bỏ đi. */
  private stepShell(sh: MortarShell, dt: number): boolean {
    const map = this.room.map;
    const g = BULLET_GRAVITY;
    const n = Math.max(1, Math.ceil(dt / 0.05));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      sh.age += h;
      if (sh.age > MORTAR.maxFlight) return true;
      const a: [number, number, number] = [sh.x, sh.y, sh.z];
      const b: [number, number, number] = [sh.x + sh.vx * h, sh.y + sh.vy * h - 0.5 * g * h * h, sh.z + sh.vz * h];
      sh.vy -= g * h;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
      const cd: [number, number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
      let t = Math.min(raycastBoxes(map.index, a, cd, len, true), raycastTerrain(map.world, a, cd, len), raycastTrunks(map.world, a, cd, len, map.treeDead));
      // Rơi xuống biển: nổ trên mặt nước.
      if (b[1] < 0 && cd[1] < 0) t = Math.min(t, Math.max(0, -a[1] / cd[1]));
      let direct = "";
      for (const [vid, v] of this.room.state.vehicles) {
        if (vid === sh.from && sh.age < 1) continue;
        if (Math.abs(v.x - a[0]) + Math.abs(v.z - a[2]) > len + 12) continue;
        const hv = rayVehicle(v, a, cd, len);
        if (hv && hv.t < t) {
          t = hv.t;
          direct = vid;
        }
      }
      for (const q of this.room.state.players.values()) {
        if (!q.alive || (q.vehicle && !this.exposed(q)) || Math.abs(q.x - a[0]) + Math.abs(q.z - a[2]) > len + 4) continue;
        const hb = rayBody(a, cd, { x: q.x, y: q.y, z: q.z, rotY: q.rotY, crouch: q.crouching, prone: q.prone, lean: q.lean });
        if (hb && hb.t < t) {
          t = hb.t;
          direct = "";
        }
      }
      if (t < len) {
        const back = Math.min(t, 0.25);
        const x = a[0] + cd[0] * (t - back);
        const y = a[1] + cd[1] * (t - back);
        const z = a[2] + cd[2] * (t - back);
        if (direct) this.vehicles.damage(direct, MORTAR.armor, sh.owner, "mortar");
        this.room.explode(x, y + 0.2, z, "shell", sh.owner, MORTAR.radius, MORTAR.damage, "mortar", direct);
        return true;
      }
      sh.x = b[0];
      sh.y = b[1];
      sh.z = b[2];
      if (!sh.whistled && sh.vy < 0) {
        // Sắp rơi: tính chỗ chạm đất dự đoán, báo mọi máy phát tiếng rít ở đó.
        const ground = Math.max(0, map.world.heightAt(sh.x, sh.z));
        const tg = (sh.vy + Math.sqrt(Math.max(0, sh.vy * sh.vy + 2 * g * (sh.y - ground)))) / g;
        if (tg < MORTAR.whistle) {
          sh.whistled = true;
          this.room.broadcast(Messages.mortarFx, { kind: "whistle", vid: sh.from, x: sh.x + sh.vx * tg, y: ground, z: sh.z + sh.vz * tg, vx: sh.vx, vy: sh.vy, vz: sh.vz, t: tg } satisfies MortarFxMessage);
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------- máy ngồi ổ đại liên

  /** Chiến trường: máy đi bộ ngang qua ổ đại liên trống thì có khi vào ngồi canh. */
  private manNests(dt: number) {
    const s = this.room.state;
    this.manScan -= dt;
    if (this.manScan > 0 || s.battleMode !== "war" || s.phase !== "battle") return;
    this.manScan = 2;
    for (const slot of this.slots) {
      if (slot.kind !== "hmg_nest") continue;
      const v = s.vehicles.get(slot.vid);
      if (!v || v.hp <= 0 || v.driver) continue;
      for (const [id, p] of s.players) {
        if (!p.bot || !p.alive || p.vehicle || p.role === "tanker" || p.role === "sniper") continue;
        if (Math.hypot(p.x - v.x, p.z - v.z) > BOT_MAN_RANGE || Math.random() < 0.5) continue;
        this.vehicles.board(id, slot.vid);
        v.team = p.team;
        this.gunners.set(id, { target: "", scan: 0, idle: 0, burst: 0, pause: 0.6 });
        break;
      }
    }
  }

  /**
   * Máy đang ngồi vũ khí cố định (gọi từ bots mỗi nhịp): ổ đại liên thì tìm lính địch trong cung xoay, trong tầm, nhìn
   * thấy; xoay súng về đó rồi bắn từng loạt (lệch nhiều khi xa). Cối thì máy không biết dùng: xuống.
   */
  tickBot(id: string, p: PlayerState, v: VehicleState, dt: number) {
    const s = this.room.state;
    if (v.kind !== "hmg_nest" || s.phase !== "battle") {
      if (v.kind !== "hmg_nest") this.vehicles.exit(id);
      return;
    }
    let g = this.gunners.get(id);
    if (!g) {
      g = { target: "", scan: 0, idle: 0, burst: 0, pause: 0.6 };
      this.gunners.set(id, g);
    }
    const pivot = mountMuzzle(v.kind, v, 0, 0).pivot;
    const eye: [number, number, number] = [pivot[0], pivot[1] + 0.25, pivot[2]];
    const usable = (o: PlayerState) => o.alive && this.room.bots.hostile(p, o) && (!o.vehicle || this.exposed(o));
    const aimAt = (o: PlayerState): [number, number, number] => [o.x, o.y + (o.prone ? 0.25 : o.crouching ? 0.8 : 1.25), o.z];
    g.scan -= dt;
    if (g.scan <= 0) {
      g.scan = 0.4 + Math.random() * 0.2;
      let best = "";
      let bestD = BOT_SIGHT;
      for (const [oid, o] of s.players) {
        if (!usable(o)) continue;
        const d = Math.hypot(o.x - v.x, o.z - v.z);
        if (d > bestD || d < 2 || !inTraverse(v.kind, v.rotY, Math.atan2(o.x - pivot[0], o.z - pivot[2]))) continue;
        const at = aimAt(o);
        if (!this.room.bots.visible(eye, at[0], at[1], at[2])) continue;
        best = oid;
        bestD = d;
      }
      g.target = best;
    }
    const t = g.target ? s.players.get(g.target) : undefined;
    if (!t || !usable(t)) {
      g.target = "";
      g.idle += dt;
      // Rảnh: súng quét chậm qua lại trước mặt.
      v.turret = clampTraverse(v.kind, v.rotY, v.rotY + Math.sin(g.idle * 0.4) * 0.8);
      v.pitch = 0;
      p.rotY = v.turret;
      if (g.idle > BOT_IDLE) {
        this.gunners.delete(id);
        this.vehicles.exit(id);
      }
      return;
    }
    g.idle = 0;
    const at = aimAt(t);
    const want = clampTraverse(v.kind, v.rotY, Math.atan2(at[0] - pivot[0], at[2] - pivot[2]));
    const dist = Math.hypot(at[0] - pivot[0], at[2] - pivot[2]);
    const wantPitch = Math.atan2(at[1] - pivot[1], dist);
    const diff = Math.atan2(Math.sin(want - v.turret), Math.cos(want - v.turret));
    const turn = 2.2 * dt;
    v.turret += Math.max(-turn, Math.min(turn, diff));
    v.pitch += Math.max(-turn, Math.min(turn, wantPitch - v.pitch));
    p.rotY = v.turret;
    if (Math.abs(diff) > 0.06) return;
    if (g.pause > 0) {
      g.pause -= dt;
      return;
    }
    if (g.burst <= 0) g.burst = 5 + Math.floor(Math.random() * 6);
    // Bắn một phát qua đường đại liên của người chơi (server dò lại như mọi phát khác); trúng hay trượt theo tầm.
    const chance = Math.max(0.06, Math.min(0.45, 0.55 - dist / 160)) * (t.prone ? 0.6 : t.crouching ? 0.8 : 1) * (t.moving ? 0.8 : 1);
    const hit = Math.random() < chance;
    const miss = hit ? 0.1 : 1 + Math.random() * 1.5;
    const a = Math.random() * Math.PI * 2;
    const m = mountMuzzle(v.kind, v, v.turret, v.pitch);
    const tx = at[0] + Math.cos(a) * miss * (hit ? 0.3 : 1);
    const ty = at[1] + Math.sin(a) * miss * 0.5;
    const tz = at[2] + Math.sin(a) * miss * (hit ? 0.3 : 1);
    const dx = tx - m.o[0];
    const dy = ty - m.o[1];
    const dz = tz - m.o[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    this.vehicles.gun(id, { o: m.o, d: [dx / dl, dy / dl, dz / dl], hits: hit ? [{ target: g.target, part: Math.random() < 0.08 ? "head" : "body", d: dl, ray: 0 }] : [] });
    g.burst -= 1;
    g.pause = g.burst <= 0 ? 0.5 + Math.random() * 0.6 : 60 / HMG.rpm;
  }
}
