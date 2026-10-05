import {
  HMG,
  MOUNT,
  TANK,
  TRACKS_SECONDS,
  WRECK_SECONDS,
  armorFactor,
  bulletAt,
  bulletSteps,
  flightTime,
  projectileAt,
  type Boost,
  cannonMuzzle,
  cannonPitch,
  gunnerSeat,
  insideBox,
  mountMuzzle,
  rayBody,
  rayVehicle,
  raycastBoxes,
  raycastTerrain,
  raycastTrunks,
  seatPos,
  trackHit,
  vehicleFits,
  vehicleSpec,
  vehicleStep,
  vehicleY,
  type ArmorFace,
  tankFits,
  tankGround,
  tankStep,
} from "@tentides/content";
import { Messages, VehicleState, type BoomMessage, type CorrectMessage, type HitMessage, type ShotMessage, type VehicleFxMessage, type VehicleGunMessage, type VehicleMoveMessage } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { Fleet } from "./fleet.ts";

// Xe tăng: server giữ máu, người lái, hướng tháp pháo; người lái là người chơi thì máy họ tự lái (server kiểm tra tốc
// độ), là máy thì server lái (theo đội hình, tránh nhà cửa, lùi ra khi kẹt). Pháo bắn đạn nổ bay theo đường cong: server
// dò đường đạn một lần lúc bắn (đồi, nhà, xe khác, người), hẹn giờ nổ đúng lúc đạn tới nơi. Người ngồi trong xe không
// trúng đạn thường; nổ (lựu đạn, mìn, pháo) làm mất máu xe; xe nổ tung thì người lái chết theo, xác xe nằm lại làm chỗ nấp.
// Giáp xe tăng tính theo mặt trúng (trước dày, đuôi yếu); lựu đạn, mìn nổ sát dải xích thì đứt xích vài giây. Xác xe
// cháy âm ỉ chừng một phút rưỡi (vẫn chặn đạn, chặn đường) rồi mới dọn đi.
// Xe trinh sát (4 ghế, đại liên trên thùng) và thuyền tuần tra (5 ghế, súng máy mũi): ghế 0 là ghế lái (`driver`),
// ghế khác ở `seats`; xạ thủ xoay đại liên (`turret`, `pitch`), mỗi phát server dò lại như súng cầm tay.

/** Đạn pháo đang bay: nổ ở (x, y, z) sau `left` giây; `direct` là xe bị bắn trúng thẳng (mất thêm máu). */
interface Shell {
  left: number;
  /** Nổ: bán kính, sát thương người ở tâm, sát thương thêm vào xe trúng thẳng; tên vũ khí (bảng hạ gục). */
  radius: number;
  damage: number;
  armor: number;
  weapon: string;
  x: number;
  y: number;
  z: number;
  owner: string;
  direct: string;
  /** Mặt vỏ xe trúng thẳng và cos góc tới (giáp nghiêng). */
  face: ArmorFace;
  cos: number;
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
  /** Xích đứt còn bao nhiêu giây, xác xe còn cháy bao lâu (theo id xe). */
  private tracksLeft = new Map<string, number>();
  private wreckLeft = new Map<string, number>();
  /** Đại liên: lúc được bắn phát kế (theo id xe). */
  private gunReadyAt = new Map<string, number>();
  /** Xe trinh sát, thuyền tuần tra đặt sẵn trên bản đồ (và xe mới thay xe đã nổ ở chiến trường). */
  readonly fleet: Fleet;

  constructor(private readonly room: BattleRoom) {
    this.fleet = new Fleet(room, this);
  }

  clear() {
    this.room.state.vehicles.clear();
    this.shells = [];
    this.readyAt.clear();
    this.lastMoveAt.clear();
    this.tracksLeft.clear();
    this.wreckLeft.clear();
    this.gunReadyAt.clear();
    this.fleet.clear();
  }

  /** Mọi người đang ngồi trên xe (ghế lái trước). */
  occupants(v: VehicleState): string[] {
    const out: string[] = [];
    if (v.driver) out.push(v.driver);
    for (const pid of v.seats.values()) if (pid) out.push(pid);
    return out;
  }

  /** Người `pid` ngồi ghế nào trên xe (−1: không ngồi xe này). */
  seatOf(v: VehicleState, pid: string): number {
    if (v.driver === pid) return 0;
    for (const [k, q] of v.seats) if (q === pid) return Number(k);
    return -1;
  }

  private seatTaken(v: VehicleState, seat: number): string {
    return seat === 0 ? v.driver : (v.seats.get(String(seat)) ?? "");
  }

  private setSeat(v: VehicleState, seat: number, pid: string) {
    if (seat === 0) v.driver = pid;
    else if (pid) v.seats.set(String(seat), pid);
    else v.seats.delete(String(seat));
  }

  /** Ghế trống đầu tiên (ghế lái trước), −1 nếu đầy. */
  private freeSeat(v: VehicleState): number {
    const n = vehicleSpec(v.kind).seats;
    for (let k = 0; k < n; k++) if (!this.seatTaken(v, k)) return k;
    return -1;
  }

  /** Rời ghế trên xe đang ngồi mà không dời chỗ đứng (gục trên xe, rời phòng). */
  leave(pid: string) {
    const p = this.room.state.players.get(pid);
    const v = p?.vehicle ? this.room.state.vehicles.get(p.vehicle) : undefined;
    if (v) {
      const k = this.seatOf(v, pid);
      if (k >= 0) this.setSeat(v, k, "");
      if (k === 0) v.moving = false;
    }
    if (p) p.vehicle = "";
  }

  /** Tìm chỗ đặt xe (theo loại) quanh (x, z) trong khoảng bán kính [r0, r1] (đất bằng / mặt nước, không vướng nhà). */
  findSpot(x: number, z: number, r0: number, r1: number, rand: () => number, kind = "tank"): { x: number; z: number; rotY: number } | null {
    const map = this.room.map;
    for (let tries = 0; tries < 60; tries++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const rotY = rand() * Math.PI * 2;
      if (kind !== "boat" && Math.hypot(px, pz) > (map.half ?? 240) * 0.8) continue;
      // Xe trinh sát đậu trên đất khô (lội nước được nhưng không đặt sẵn dưới nước).
      if (kind === "jeep" && map.world.heightAt(px, pz) < 0.6) continue;
      if (!vehicleFits(kind, map, px, pz, rotY) || !vehicleFits(kind, map, px, pz, rotY + Math.PI / 2)) continue;
      if ([...this.room.state.vehicles.values()].some((v) => Math.hypot(v.x - px, v.z - pz) < 9)) continue;
      return { x: px, z: pz, rotY };
    }
    return null;
  }

  spawn(x: number, z: number, rotY: number, team: string, driver = "", kind = "tank"): string {
    // Chủ phòng tắt xe cơ giới: không đặt xe nào (trả về id rỗng).
    if (!this.room.state.settings.vehiclesEnabled) return "";
    const id = `v${++this.seq}`;
    const v = new VehicleState();
    v.kind = kind;
    v.x = x;
    v.z = z;
    v.y = vehicleY(kind, this.room.map, x, z);
    v.rotY = rotY;
    v.turret = rotY;
    v.hp = vehicleSpec(kind).hp;
    v.team = team;
    this.room.state.vehicles.set(id, v);
    if (driver) this.seat(driver, id);
    return id;
  }

  /** Cho người `pid` lên lái xe `vid` (hồi sinh làm lính lái tăng, máy lái tăng ở căn cứ). */
  board(pid: string, vid: string) {
    this.seat(pid, vid);
  }

  /** Cho người `pid` ngồi vào ghế `seat` (0 là ghế lái) của xe `vid`. */
  private seat(pid: string, vid: string, seat = 0) {
    const p = this.room.state.players.get(pid);
    const v = this.room.state.vehicles.get(vid);
    if (!p || !v) return;
    p.vehicle = vid;
    this.setSeat(v, seat, pid);
    if (!v.team) v.team = p.team;
    p.crouching = p.prone = p.aiming = false;
    p.moving = false;
    p.kit.reloading = false;
    p.kit.healing = "";
    this.syncOccupant(p, v, seat);
    this.room.clientOf(pid)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  private syncOccupant(p: { x: number; y: number; z: number; rotY: number }, v: VehicleState, seat = 0) {
    if (v.kind === "tank") {
      p.x = v.x;
      p.y = v.y;
      p.z = v.z;
      p.rotY = v.turret;
      return;
    }
    // Xe trinh sát, thuyền: người ngồi đúng ghế (chân thấp hơn chỗ ngồi chừng nửa mét), xạ thủ quay theo đại liên.
    const at = seatPos(v.kind, v, seat);
    p.x = at[0];
    p.y = at[1] - 0.5;
    p.z = at[2];
    p.rotY = seat === gunnerSeat(v.kind) ? v.turret : v.rotY;
  }

  /** Mọi người trên xe đi theo xe. */
  private syncCrew(v: VehicleState) {
    const s = this.room.state;
    if (v.driver) {
      const d = s.players.get(v.driver);
      if (d) this.syncOccupant(d, v, 0);
    }
    for (const [k, pid] of v.seats) {
      const q = s.players.get(pid);
      if (q) this.syncOccupant(q, v, Number(k));
    }
  }

  /**
   * Chỗ xuống xe: bên hông xe, chỗ trống trên mặt đất. Xe tăng chỉ cho xuống chỗ khô ráo; xe trinh sát xuống được
   * nước nông; thuyền ủi bãi thì lính nhảy xuống nước nông, bờ cát (mũi thuyền trước, rồi hai bên mạn).
   */
  private exitSpot(v: VehicleState): { x: number; y: number; z: number } {
    const map = this.room.map;
    const c = Math.cos(v.rotY);
    const s = Math.sin(v.rotY);
    const [hw, hh, hl] = vehicleSpec(v.kind).half;
    const shallow = v.kind === "tank" ? 0.3 : -1.3;
    const spots: readonly (readonly [number, number])[] =
      v.kind === "boat"
        ? [
            [0, hl + 1.6],
            [-1.2, hl + 1.2],
            [1.2, hl + 1.2],
            [0, hl + 3.5],
            [-hw - 1.3, 1.5],
            [hw + 1.3, 1.5],
            [-hw - 1.3, -1.5],
            [hw + 1.3, -1.5],
          ]
        : [
            [-hw - 1.1, 0],
            [hw + 1.1, 0],
            [0, -hl - 1.3],
            [0, hl + 1.3],
            [-hw - 1.3, -hl + 0.1],
            [hw + 1.3, -hl + 0.1],
          ];
    for (const [u, w] of spots) {
      const x = v.x + c * u + s * w;
      const z = v.z - s * u + c * w;
      // Mặt đất hay mặt cầu (xe đang trên cầu thì xuống ngay trên mặt cầu).
      const h = tankGround(map, x, z);
      if (h < shallow || Math.abs(Math.max(h, 0) - Math.max(v.y, 0)) > 2.5 || insideBox(map.index, x, Math.max(h, 0) + 0.9, z, 0.4)) continue;
      return { x, y: h + 0.05, z };
    }
    // Thuyền ngoài khơi: nhảy xuống nước bên mạn (bơi vào bờ).
    if (v.kind === "boat") {
      const u = -hw - 1.4;
      return { x: v.x + c * u, y: -0.9, z: v.z - s * u };
    }
    return { x: v.x, y: v.y + hh * 2 + 0.1, z: v.z };
  }

  /** Xuống xe (người chơi bấm F, hay máy nhường ghế cho người chơi cùng đội). */
  exit(pid: string) {
    const p = this.room.state.players.get(pid);
    const v = p?.vehicle ? this.room.state.vehicles.get(p.vehicle) : undefined;
    if (!p || !v) {
      if (p) p.vehicle = "";
      return;
    }
    const at = this.exitSpot(v);
    const k = this.seatOf(v, pid);
    p.vehicle = "";
    if (k >= 0) this.setSeat(v, k, "");
    if (k === 0) v.moving = false;
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    this.room.clientOf(pid)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  /**
   * Bấm F cạnh xe: xe tăng trống (hay máy cùng đội đang lái) thì lên ghế lái; xe trinh sát, thuyền thì lên ghế lái
   * nếu trống, không thì ghế trống đầu tiên. Đang ngồi xe thì xuống.
   */
  enter(pid: string) {
    const s = this.room.state;
    const p = s.players.get(pid);
    if (!p || !p.alive || !this.room.fighting()) return;
    if (p.vehicle) return this.exit(pid);
    const best = this.nearestEnterable(pid);
    if (!best) return;
    const v = s.vehicles.get(best)!;
    if (v.kind === "tank") {
      if (v.driver) this.exit(v.driver);
      this.seat(pid, best);
    } else {
      const k = this.freeSeat(v);
      if (k < 0) return;
      this.seat(pid, best, k);
    }
    v.team = p.team;
  }

  /** Xe gần nhất người `pid` lên được (trong tầm với theo loại xe), rỗng nếu không có. */
  nearestEnterable(pid: string): string {
    const s = this.room.state;
    const p = s.players.get(pid);
    if (!p) return "";
    let best = "";
    let bestD = Infinity;
    for (const [vid, v] of s.vehicles) {
      if (v.hp <= 0) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d > vehicleSpec(v.kind).enter || d > bestD || Math.abs(v.y - p.y) > 4) continue;
      if (v.kind === "tank") {
        const driver = v.driver ? s.players.get(v.driver) : undefined;
        // Xe có người lái: chỉ đổi chỗ được với máy cùng đội.
        if (driver && !(driver.bot && p.team && driver.team === p.team)) continue;
        if (!driver && v.team && p.team && v.team !== p.team && s.battleMode !== "solo") continue;
      } else {
        const crew = this.occupants(v);
        if (this.freeSeat(v) < 0) continue;
        // Có người ngồi: chỉ lên cùng đồng đội (đấu đơn thì ai cũng là địch).
        if (crew.length && (s.battleMode === "solo" || !p.team || crew.some((q) => s.players.get(q)?.team !== p.team))) continue;
        if (!crew.length && v.team && p.team && v.team !== p.team && s.battleMode !== "solo") continue;
      }
      best = vid;
      bestD = d;
    }
    return best;
  }

  /** Đổi sang ghế `seat` (đang trống) trên xe đang ngồi. */
  switchSeat(pid: string, seat: number) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !v || !p.alive || v.hp <= 0 || v.kind === "tank") return;
    if (seat >= vehicleSpec(v.kind).seats || this.seatTaken(v, seat)) return;
    const from = this.seatOf(v, pid);
    if (from < 0 || from === seat) return;
    this.setSeat(v, from, "");
    if (from === 0) v.moving = false;
    this.setSeat(v, seat, pid);
    this.syncOccupant(p, v, seat);
    this.lastMoveAt.delete(pid);
  }

  /** Người chơi lái: nhận vị trí mới nếu hợp lý (không vượt tốc độ xe, đúng mặt đất / mặt nước, xích còn lành). */
  move(pid: string, m: VehicleMoveMessage) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const v = p?.vehicle ? s.vehicles.get(p.vehicle) : undefined;
    if (!p || !v || !p.alive || v.driver !== pid || v.hp <= 0) return;
    const now = Date.now();
    const elapsed = Math.max(100, now - (this.lastMoveAt.get(pid) ?? now - 100));
    const dist = Math.hypot(m.x - v.x, m.z - v.z);
    const map = this.room.map;
    // Xe tăng nới 1,8 lần tốc độ tối đa (bù trễ mạng); xe trinh sát, thuyền chạy nhanh nên nới ít hơn. Đứt xích thì
    // không được rời chỗ (chỉ quay tại chỗ). Thuyền không lên cạn, xe trinh sát không xuống nước sâu.
    const spec = vehicleSpec(v.kind);
    const limit = v.kind === "tank" ? spec.forward * 1.8 : spec.forward * 1.45;
    const h = map.world.heightAt(m.x, m.z);
    const wrongGround = v.kind === "boat" ? h > 0.2 : v.kind === "jeep" ? h < -1.4 : false;
    if (dist > limit * (elapsed / 1000) + 0.5 || Math.hypot(m.x, m.z) > (map.half ?? 240) * 1.2 || wrongGround || (v.tracks > 0 && dist > 0.6)) {
      this.room.clientOf(pid)?.send(Messages.correct, { x: v.x, y: v.y, z: v.z } satisfies CorrectMessage);
      return;
    }
    this.lastMoveAt.set(pid, now);
    v.x = m.x;
    v.y = vehicleY(v.kind, map, m.x, m.z);
    v.z = m.z;
    v.rotY = m.rotY;
    // Xe có đại liên: súng do xạ thủ xoay, người lái không đụng tới.
    if (v.kind === "tank") {
      v.turret = m.turret;
      v.pitch = Math.max(TANK.pitchDown, Math.min(TANK.pitchUp, m.pitch));
    }
    v.moving = m.moving;
    this.syncCrew(v);
  }

  /** Xạ thủ đại liên xoay súng. */
  aim(pid: string, turret: number, pitch: number) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const v = p?.vehicle ? s.vehicles.get(p.vehicle) : undefined;
    if (!p || !v || !p.alive || v.hp <= 0 || v.kind === "tank" || this.seatOf(v, pid) !== gunnerSeat(v.kind)) return;
    v.turret = turret;
    v.pitch = Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, pitch));
    p.rotY = turret;
  }

  /**
   * Xạ thủ bắn đại liên một phát: kiểm tra ghế, nhịp bắn, đầu nòng sát trụ súng, rồi dò đường đạn như súng cầm tay
   * (tường, đồi, xe, người máy mình báo trúng), bỏ qua chính xe mình.
   */
  gun(pid: string, m: VehicleGunMessage) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !v || !p.alive || v.hp <= 0 || v.kind === "tank" || !this.room.fighting()) return;
    if (this.seatOf(v, pid) !== gunnerSeat(v.kind)) return;
    const now = Date.now();
    if (now < (this.gunReadyAt.get(vid) ?? 0)) return;
    const l = Math.hypot(m.d[0], m.d[1], m.d[2]);
    if (l < 1e-6) return;
    const d: [number, number, number] = [m.d[0] / l, m.d[1] / l, m.d[2] / l];
    // Đầu nòng phải ở sát trụ súng (nới cho xe đang chạy, trễ mạng); góc ngẩng trong tầm xoay của giá súng.
    const { pivot } = mountMuzzle(v.kind, v, 0, 0);
    if (Math.hypot(m.o[0] - pivot[0], m.o[1] - pivot[1], m.o[2] - pivot[2]) > MOUNT.barrel + 3.5) return;
    const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
    if (pitch > MOUNT.pitchUp + 0.15 || pitch < MOUNT.pitchDown - 0.15) return;
    this.gunReadyAt.set(vid, now + (60000 / HMG.rpm) * 0.8);
    v.turret = Math.atan2(d[0], d[2]);
    v.pitch = Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, pitch));
    p.rotY = v.turret;
    this.room.shootRays(pid, HMG, [m.o[0], m.o[1], m.o[2]], [d], m.hits, false, vid);
  }

  /** Đạn thường găm vào vỏ xe: sát thương nhỏ với xe tăng (theo mặt giáp), đáng kể với xe trinh sát, thuyền. */
  bulletHit(vid: string, raw: number, attacker: string, weapon: string, face: ArmorFace, cos: number) {
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0) return;
    const k = armorFactor(v.kind, face, cos, 1).mult;
    this.damage(vid, raw * vehicleSpec(v.kind).bulletFactor * k, attacker, weapon);
  }

  /** Bắn pháo theo hướng tháp pháo, góc nòng: dò đường đạn một lần, hẹn giờ nổ. */
  fire(pid: string, turret: number, pitch: number) {
    const s = this.room.state;
    const p = s.players.get(pid);
    const vid = p?.vehicle ?? "";
    const v = vid ? s.vehicles.get(vid) : undefined;
    if (!p || !v || !p.alive || v.kind !== "tank" || v.driver !== pid || v.hp <= 0 || !this.room.fighting()) return;
    const now = Date.now();
    if (now < (this.readyAt.get(vid) ?? 0)) return;
    this.readyAt.set(vid, now + TANK.reload * 1000);
    v.turret = turret;
    v.pitch = Math.max(TANK.pitchDown, Math.min(TANK.pitchUp, pitch));
    v.shots = (v.shots + 1) % 65536;
    const { o, d } = cannonMuzzle(v, v.turret, v.pitch);
    this.launch(pid, o, d, TANK.velocity, { radius: TANK.radius, damage: TANK.damage, armor: TANK.armorDamage }, "tank", vid);
    this.room.bots.onShot(pid, v.x, v.z, 250);
  }

  /**
   * Phóng một viên đạn nổ (pháo xe tăng, RPG) từ `o` theo hướng `d`: dò đường bay cong một lần (đồi, nhà, xe, người),
   * báo mọi máy vẽ vệt đạn, hẹn giờ nổ đúng lúc đạn tới nơi. `skip` là xe của chính người bắn. `boost`: rocket có động
   * cơ (RPG-7) rời ống chậm rồi tăng tốc: đường bay, độ rơi và giờ nổ tính theo thời gian bay thật (flightTime).
   */
  launch(owner: string, o: [number, number, number], d: [number, number, number], velocity: number, spec: { radius: number; damage: number; armor: number }, weapon: string, skip = "", boost?: Boost) {
    const s = this.room.state;
    const shooter = s.players.get(owner);
    const max = 450;
    const steps = bulletSteps(velocity, max);
    let hitS = max;
    let direct = "";
    let face: ArmorFace = "side";
    let cos = 1;
    for (let i = 1; i < steps.length; i++) {
      const a = projectileAt(o, d, velocity, steps[i - 1]!, boost);
      const b = projectileAt(o, d, velocity, steps[i]!, boost);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const cd: [number, number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
      let t = Math.min(raycastBoxes(this.room.map.index, a, cd, len, true), raycastTerrain(this.room.map.world, a, cd, len), raycastTrunks(this.room.map.world, a, cd, len, this.room.map.treeDead));
      let hitTank = "";
      let hitFace: ArmorFace = "side";
      let hitCos = 1;
      for (const [oid, other] of s.vehicles) {
        if (oid === skip) continue;
        const hv = rayVehicle(other, a, cd, len);
        if (hv && hv.t < t) {
          t = hv.t;
          hitTank = oid;
          hitFace = hv.face;
          hitCos = hv.cos;
        }
      }
      for (const q of s.players.values()) {
        if (!q.alive || q === shooter || q.vehicle) continue;
        const h = rayBody(a, cd, { x: q.x, y: q.y, z: q.z, rotY: q.rotY, crouch: q.crouching, prone: q.prone, lean: q.lean });
        if (h && h.t < t) {
          t = h.t;
          hitTank = "";
        }
      }
      if (t < len) {
        hitS = steps[i - 1]! + (t / len) * (steps[i]! - steps[i - 1]!);
        direct = hitTank;
        face = hitFace;
        cos = hitCos;
        break;
      }
    }
    const e = projectileAt(o, d, velocity, hitS, boost);
    this.shells.push({ left: flightTime(velocity, hitS, boost), x: e[0], y: e[1], z: e[2], owner, direct, face, cos, ...spec, weapon });
    this.room.broadcast(Messages.shot, { id: owner, w: weapon, o, e: [e] } satisfies ShotMessage);
  }

  /** Mất máu xe; hết máu thì nổ tung, mọi người trên xe chết theo, xác xe cháy một lúc. */
  damage(vid: string, amount: number, attacker: string, weapon = "tank") {
    const s = this.room.state;
    const v = s.vehicles.get(vid);
    if (!v || v.hp <= 0 || this.room.state.phase !== "battle") return;
    const a = attacker ? s.players.get(attacker) : undefined;
    const crew = this.occupants(v);
    const own = crew.includes(attacker);
    // Không bắn hỏng xe của đội mình.
    if (a && a.team && a.team === v.team && s.battleMode !== "solo" && !own) return;
    v.hp = Math.max(0, Math.round(v.hp - amount));
    if (attacker && !own) this.room.clientOf(attacker)?.send(Messages.hit, { kind: v.hp <= 0 ? "kill" : "body", armor: true, amount: Math.round(amount) } satisfies HitMessage);
    if (v.driver) this.room.bots.onHurt(v.driver, attacker);
    if (v.hp > 0) return;
    // Nổ tung: người trên xe chết, xác xe nằm lại cháy âm ỉ.
    v.moving = false;
    v.tracks = 0;
    this.tracksLeft.delete(vid);
    this.wreckLeft.set(vid, WRECK_SECONDS);
    this.room.broadcast(Messages.boom, { kind: "shell", x: v.x, y: v.y + 1.5, z: v.z } satisfies BoomMessage);
    v.driver = "";
    v.seats.clear();
    for (const pid of crew) {
      const p = s.players.get(pid);
      if (!p) continue;
      p.vehicle = "";
      this.room.kill(pid, attacker, weapon, false);
    }
  }

  /** Nổ gần xe (lựu đạn, mìn, pháo): xe mất máu theo khoảng cách; lựu đạn, mìn sát dải xích thì đứt xích. */
  blast(x: number, y: number, z: number, radius: number, maxDamage: number, owner: string, weapon: string, skip = "") {
    for (const [vid, v] of this.room.state.vehicles) {
      if (v.hp <= 0 || vid === skip) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.y + 1.2 - y, v.z - z) - 2);
      if (d > radius) continue;
      const k = Math.pow(1 - d / radius, 1.2);
      this.damage(vid, maxDamage * k * vehicleSpec(v.kind).blastFactor, owner, weapon);
      if (v.hp > 0 && trackHit(v, x, y, z, weapon)) this.breakTracks(vid);
    }
  }

  /** Đứt xích xe tăng `vid` trong TRACKS_SECONDS giây: không tiến lùi được, chỉ quay tại chỗ. */
  breakTracks(vid: string) {
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0 || v.kind !== "tank") return;
    this.tracksLeft.set(vid, TRACKS_SECONDS);
    v.tracks = TRACKS_SECONDS;
    this.room.broadcast(Messages.vehicleFx, { kind: "tracks", vid, x: v.x, y: v.y + 0.5, z: v.z } satisfies VehicleFxMessage);
  }

  /** Máy lái xe: đi tới `goal` (nếu có), quay tháp pháo về `target`, ngắm xong thì bắn. */
  driveAI(vid: string, pid: string, brain: Driver, goal: { x: number; z: number } | null, target: { x: number; y: number; z: number; vehicle: string; prone: boolean; crouching: boolean } | null, dt: number) {
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0 || v.driver !== pid || v.kind !== "tank") return;
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
      // Góc cần quay dương (rotY phải tăng) là quay trái: steer âm.
      steer = Math.max(-1, Math.min(1, -diff * 2));
      throttle = Math.abs(diff) > 1.1 ? 0.1 : dist > 25 ? 1 : 0.55;
    }
    // Đứt xích: không tiến lùi được, chỉ quay tại chỗ.
    const step = vehicleStep("tank", map, v, throttle, steer, brain.tankSpeed, dt, v.tracks <= 0);
    brain.tankSpeed = step.speed;
    if (step.blocked && throttle > 0 && v.tracks <= 0) {
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
    for (const [vid, v] of s.vehicles) {
      if (v.driver) {
        const p = s.players.get(v.driver);
        if (!p || !p.alive || p.vehicle === "") {
          v.driver = "";
          v.moving = false;
        } else if (!p.bot) this.syncOccupant(p, v, 0);
      }
      for (const [k, pid] of v.seats) {
        const q = s.players.get(pid);
        if (!q || !q.alive || q.vehicle !== vid) v.seats.delete(k);
        else this.syncOccupant(q, v, Number(k));
      }
    }
    // Xích đứt nối lại dần; xác xe cháy hết thì dọn đi.
    for (const [vid, left] of this.tracksLeft) {
      const v = s.vehicles.get(vid);
      const now = left - dt;
      if (!v || now <= 0) {
        this.tracksLeft.delete(vid);
        if (v) v.tracks = 0;
        continue;
      }
      this.tracksLeft.set(vid, now);
      const shown = Math.ceil(now);
      if (v.tracks !== shown) v.tracks = shown;
    }
    for (const [vid, left] of this.wreckLeft) {
      const now = left - dt;
      if (now > 0 && s.vehicles.has(vid)) {
        this.wreckLeft.set(vid, now);
        continue;
      }
      this.wreckLeft.delete(vid);
      s.vehicles.delete(vid);
    }
    this.fleet.tick(dt);
    if (!this.shells.length) return;
    const keep: Shell[] = [];
    for (const sh of this.shells) {
      sh.left -= dt;
      if (sh.left > 0) {
        keep.push(sh);
        continue;
      }
      if (sh.direct) this.hitArmor(sh);
      this.room.explode(sh.x, sh.y, sh.z, "shell", sh.owner, sh.radius, sh.damage, sh.weapon, sh.direct);
    }
    this.shells = keep;
  }

  /** Đạn nổ trúng thẳng vỏ xe: tính giáp theo mặt trúng; giáp trước ở góc sượt thì có thể nảy đi. */
  private hitArmor(sh: Shell) {
    const v = this.room.state.vehicles.get(sh.direct);
    if (!v || v.hp <= 0) return;
    const a = armorFactor(v.kind, sh.face, sh.cos);
    if (a.ricochet) {
      this.room.broadcast(Messages.vehicleFx, { kind: "ricochet", vid: sh.direct, x: sh.x, y: sh.y, z: sh.z } satisfies VehicleFxMessage);
      if (sh.owner) this.room.clientOf(sh.owner)?.send(Messages.hit, { kind: "body", armor: true, amount: 0 } satisfies HitMessage);
      return;
    }
    this.damage(sh.direct, sh.armor * a.mult, sh.owner, sh.weapon);
  }
}
