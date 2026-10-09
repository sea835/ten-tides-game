import {
  FIRE,
  JET,
  MAX_HP,
  NAVAL_HALF,
  NAVAL_RESPAWN,
  NAVAL_STARTS,
  NAVAL_TIME,
  NAVAL_WEAPONS,
  SMALL_ARMS_SHIP,
  SONAR,
  SUB,
  TORPEDO_DEPTH,
  UNIT_HP,
  WEAPON,
  armorOf,
  ballisticAt,
  clampMountYaw,
  deckBelow,
  firePoint,
  insideShip,
  isShipClass,
  jetStep,
  navalMissileStep,
  mountCovers,
  partAt,
  rayShip,
  shellElevation,
  shipAground,
  shipClass,
  shipStep,
  shipToWorld,
  torpedoStep,
  worldToShip,
  type NavalWeaponId,
  type ShipClass,
  type ShipMount,
  type ShipPart,
  type ShipPose,
  type UnitPose,
} from "@tentides/content";
import {
  Messages,
  NavalUnitState,
  ShipState,
  type CorrectMessage,
  type NavalActMessage,
  type NavalAimMessage,
  type NavalFireMessage,
  type NavalFxMessage,
  type NavalHelmMessage,
  type NavalPickMessage,
  type NavalUnitMessage,
  type PlayerState,
} from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { addAmmo, receive, resetKit } from "./kit.ts";
import { awardXp } from "./xp.ts";

// Hải chiến 3 vs 3: mỗi phe một chiến hạm (lớp tàu chủ phòng / người trong phe chọn ở sảnh), ba vị trí điều khiển
// theo lớp tàu (lái tàu + ngư lôi, pháo chính, phòng không, máy bay, tên lửa, ngư lôi dẫn đường...). Người chơi đi lại
// trên boong (server mang theo tàu khi tàu chạy), tới bàn điều khiển bấm F để vào vị trí. Máy (bot) lấp các vị trí còn
// trống, đứng sẵn tại vị trí của mình.
//
// Đạn pháo, bom bay theo đường đạn (server mô phỏng, báo client điểm bắn và vận tốc đầu để vẽ); đạn phòng không, đạn
// máy bay bay nhanh, dò va chạm từng nhịp với tên lửa, máy bay, người, thân tàu. Ngư lôi thẳng, ngư lôi / tên lửa /
// máy bay do máy (bot) điều khiển chạy trên server; do người lái thì máy người lái tính vị trí (phản hồi tức thì),
// server kiểm tra tốc độ và va chạm. Trúng tàu: trừ máu thân tàu và bộ phận (vũ khí hỏng là thôi bắn được), có thể
// gây cháy; lửa lớn dần, ăn máu tàu, lan sang bộ phận bên cạnh — người trên tàu đứng cạnh giữ F để dập. Tàu hết máu
// là chìm, phe kia thắng; hết giờ thì tàu còn nhiều máu (theo phần trăm) hơn thắng.

export type Side = "blue" | "red";
const SIDES: readonly Side[] = ["blue", "red"];

type V3 = [number, number, number];

interface Shell {
  pos: V3;
  v: V3;
  life: number;
  owner: string;
  team: string;
  from: string;
  weapon: NavalWeaponId;
  /** Giây kể từ lúc bắn (bỏ qua tàu mình lúc mới rời nòng). */
  age: number;
}

interface Flak {
  pos: V3;
  v: V3;
  life: number;
  owner: string;
  team: string;
  from: string;
  /** Đạn máy bay (true) hay phòng không. */
  jet: boolean;
}

interface Charge {
  x: number;
  y: number;
  z: number;
  fuse: number;
  owner: string;
  team: string;
}

interface UnitData {
  /** Máy (bot) điều khiển trên server, hay người lái gửi vị trí lên. */
  bot: boolean;
  wantYaw: number;
  wantPitch: number;
  throttle: number;
  life: number;
  /** Giây kể từ lần cuối người lái báo vị trí. */
  quiet: number;
  /** Máy bay: chờ bắn, chờ thả bom (bot). */
  gunAt: number;
}

interface BotBrain {
  /** Chỗ thấy tàu địch lần cuối (tàu ngầm lặn thì mất dấu). */
  seenX: number;
  seenZ: number;
  /** Đang đi dập lửa: toạ độ riêng trên tàu. */
  local: V3;
  busy: number;
  aimErr: number;
  next: number;
  unit: string;
  zig: number;
}

/** Tốc độ đi bộ của máy trên boong (m/s). */
const BOT_WALK = 3.2;
/** Chênh lệch tối đa giữa vị trí người lái báo và vị trí đơn vị (m) mỗi giây. */
const UNIT_SLACK = 1.45;

/** Mã vị trí điều khiển trong `p.vehicle`: "ship:<id phe>:<số vị trí>". */
export function stationSeat(ship: string, station: number): string {
  return `ship:${ship}:${station}`;
}
export function parseSeat(seat: string): { ship: string; station: number } | null {
  if (!seat.startsWith("ship:")) return null;
  const [, ship, st] = seat.split(":");
  return ship ? { ship, station: Number(st) || 0 } : null;
}

export class Naval {
  private shells: Shell[] = [];
  private flak: Flak[] = [];
  private charges: Charge[] = [];
  private units = new Map<string, UnitData>();
  private brains = new Map<string, BotBrain>();
  /** Lệnh lái của từng tàu (từ người / máy ở vị trí lái). */
  private helm = new Map<string, { throttle: number; rudder: number }>();
  /** Lần dập lửa gần nhất của từng người (giây theo đồng hồ trận). */
  private dousing = new Map<string, number>();
  /** Lần bắn phòng không / súng máy bay gần nhất theo tàu / máy bay. */
  private aaAt = new Map<string, number>();
  /** Ai gây sát thương cuối cho tàu (tính công đánh chìm). */
  private lastHit = new Map<string, string>();
  private seq = 0;
  private clock = 0;
  private sinkTimer = 0;
  private ending: Side | "" = "";

  constructor(private readonly room: BattleRoom) {}

  private get ns() {
    return this.room.state.naval;
  }

  ship(id: string): ShipState | undefined {
    return this.ns.ships.get(id);
  }

  cls(s: ShipState): ShipClass {
    return shipClass(s.cls);
  }

  pose(s: ShipState): ShipPose {
    return { x: s.x, y: s.y, z: s.z, rotY: s.rotY };
  }

  clear() {
    this.ns.ships.clear();
    this.ns.units.clear();
    this.ns.timeLeft = 0;
    this.shells = [];
    this.flak = [];
    this.charges = [];
    this.units.clear();
    this.brains.clear();
    this.helm.clear();
    this.dousing.clear();
    this.lastHit.clear();
    this.air.clear();
    this.burnAcc.clear();
    this.coolF.clear();
    this.fireF.clear();
    this.partF.clear();
    this.ending = "";
    this.sinkTimer = 0;
  }

  // -------------------------------------------------------------------------- sảnh

  private sideCounts(): Record<Side, number> {
    const c = { blue: 0, red: 0 };
    for (const p of this.room.state.players.values()) if (!p.bot && (p.team === "blue" || p.team === "red")) c[p.team]++;
    return c;
  }

  /** Người mới vào sảnh hải chiến: vào phe ít người hơn (mỗi phe tối đa 3 người). */
  assign(id: string) {
    const p = this.room.state.players.get(id);
    if (!p) return;
    const c = this.sideCounts();
    if (p.team === "blue" || p.team === "red") {
      if (c[p.team] <= 3) return;
    }
    p.team = c.blue <= c.red ? "blue" : "red";
    p.color = p.team === "blue" ? "#2f6bff" : "#e0332b";
    if (!/^[012]$/.test(p.role)) p.role = String(this.freeRole(p.team, id));
  }

  /** Vị trí còn trống của phe (người chơi chọn trước). */
  private freeRole(team: string, except: string): number {
    const taken = new Set<string>();
    for (const [id, p] of this.room.state.players) if (id !== except && !p.bot && p.team === team) taken.add(p.role);
    for (const k of [0, 1, 2]) if (!taken.has(String(k))) return k;
    return 0;
  }

  /** Sảnh: chọn lớp tàu cho phe mình, chọn vị trí. */
  pick(id: string, msg: NavalPickMessage) {
    const p = this.room.state.players.get(id);
    if (!p || (p.team !== "blue" && p.team !== "red")) return;
    const st = this.room.state.settings;
    if (msg.ship && isShipClass(msg.ship)) {
      if (p.team === "blue") st.shipBlue = msg.ship;
      else st.shipRed = msg.ship;
    }
    if (msg.station !== undefined) {
      // Vị trí đã có người khác trong phe chọn thì đổi chỗ cho nhau.
      for (const [qid, q] of this.room.state.players) if (qid !== id && !q.bot && q.team === p.team && q.role === String(msg.station)) q.role = p.role;
      p.role = String(msg.station);
    }
  }

  /** Chủ phòng chọn lớp tàu cho phe toàn máy. */
  pickFor(side: Side, ship: string) {
    if (!isShipClass(ship)) return;
    if (side === "blue") this.room.state.settings.shipBlue = ship;
    else this.room.state.settings.shipRed = ship;
  }

  // -------------------------------------------------------------------------- vào trận

  start() {
    const s = this.room.state;
    this.clear();
    for (const [id, p] of s.players) if (!p.bot) this.assign(id);
    s.zone.x = s.zone.nx = 0;
    s.zone.z = s.zone.nz = 0;
    s.zone.r = s.zone.nr = 4000;
    s.zone.dps = 0;
    for (const side of SIDES) {
      const ship = new ShipState();
      const cls = isShipClass(side === "blue" ? s.settings.shipBlue : s.settings.shipRed) ? (side === "blue" ? s.settings.shipBlue : s.settings.shipRed) : side === "blue" ? "battleship" : "destroyer";
      const spec = shipClass(cls);
      const at = NAVAL_STARTS[side];
      ship.cls = spec.id;
      ship.team = side;
      ship.x = at.x;
      ship.z = at.z;
      ship.rotY = at.rotY;
      ship.hp = ship.maxHp = spec.hp;
      ship.air = 100;
      this.ns.ships.set(side, ship);
      this.helm.set(side, { throttle: 0, rudder: 0 });
      // Máy lấp các vị trí người chơi chưa chọn.
      const taken = new Set<number>();
      for (const p of s.players.values()) if (!p.bot && p.team === side) taken.add(Number(p.role) || 0);
      for (const k of [0, 1, 2]) {
        if (taken.has(k)) continue;
        const bid = `nb_${side}${k}`;
        this.room.bots.addNavalBot(bid, side, k);
      }
    }
    this.ns.timeLeft = NAVAL_TIME;
    for (const [id, p] of s.players) {
      if (p.team !== "blue" && p.team !== "red") continue;
      this.equip(p);
      this.spawnOnShip(id, p, p.bot);
    }
  }

  /** Súng ngắn, tiểu liên, băng gạc: lính trên boong đánh nhau với lính trên boong tàu địch, máy bay sà thấp. */
  private equip(p: PlayerState) {
    const outfit = p.kit.outfit;
    resetKit(p.kit, 0);
    p.kit.outfit = outfit;
    const gun = p.bot ? "ump45" : "m416";
    const def = WEAPON.get(gun)!;
    receive(p.kit, gun, []);
    addAmmo(p.kit, def.ammo, def.mag * 4);
    receive(p.kit, "p92", []);
    addAmmo(p.kit, "9mm", 30);
    receive(p.kit, "bandage", []);
    receive(p.kit, "bandage", []);
    p.kit.active = "primary1";
    p.hp = p.maxHp = MAX_HP;
    p.alive = true;
    p.respawn = 0;
  }

  /** Đặt người lên tàu phe mình, cạnh vị trí của mình; máy (và tàu ngầm đang lặn) vào luôn vị trí. */
  private spawnOnShip(id: string, p: PlayerState, man: boolean) {
    const ship = this.ship(p.team);
    if (!ship || ship.sunk) return;
    const cls = this.cls(ship);
    const k = Math.max(0, Math.min(2, Number(p.role) || 0));
    const role = cls.roles[k]!;
    const st = role.station;
    if (man || ship.dive) {
      this.man(id, p, ship, k);
      return;
    }
    // Đứng cạnh bàn điều khiển (lùi về sau một bước), trên mặt sàn.
    const lz = st[2] - 1.6;
    const floor = deckBelow(cls, st[0], st[1] + 0.5, lz);
    const [x, y, z] = shipToWorld(this.pose(ship), st[0], Number.isFinite(floor) ? floor : st[1], lz);
    p.vehicle = "";
    p.x = x;
    p.y = y + 0.05;
    p.z = z;
    p.rotY = ship.rotY + role.face;
    this.room.clientOf(id)?.send(Messages.correct, this.correctOf(p));
  }

  // -------------------------------------------------------------------------- vị trí điều khiển

  /** Người đang đứng vị trí nào trên tàu nào (hay null). */
  seatOf(p: PlayerState): { ship: ShipState; id: string; station: number } | null {
    const seat = parseSeat(p.vehicle);
    const ship = seat && this.ship(seat.ship);
    return seat && ship ? { ship, id: seat.ship, station: seat.station } : null;
  }

  private man(id: string, p: PlayerState, ship: ShipState, station: number) {
    ship.crew.set(String(station), id);
    p.vehicle = stationSeat(ship.team, station);
    p.crouching = p.prone = false;
    this.placeAtStation(p, ship, station);
  }

  private placeAtStation(p: PlayerState, ship: ShipState, station: number) {
    const role = this.cls(ship).roles[station]!;
    const [x, y, z] = shipToWorld(this.pose(ship), role.station[0], role.station[1], role.station[2]);
    p.x = x;
    p.y = y;
    p.z = z;
  }

  /** Người bấm F ở bàn điều khiển: vào vị trí `station` (−1: rời vị trí). */
  station(id: string, station: number) {
    const p = this.room.state.players.get(id);
    if (!p || !p.alive) return;
    const cur = this.seatOf(p);
    if (station < 0) {
      if (!cur) return;
      // Tàu ngầm đang lặn: không ra boong được.
      if (cur.ship.dive || cur.ship.y < -2) return;
      this.leaveStation(id, p);
      // Bước ra cạnh bàn điều khiển.
      const cls = this.cls(cur.ship);
      const st = cls.roles[cur.station]!.station;
      const lz = st[2] - 1.4;
      const floor = deckBelow(cls, st[0], st[1] + 0.5, lz);
      const [x, y, z] = shipToWorld(this.pose(cur.ship), st[0], Number.isFinite(floor) ? floor : st[1], lz);
      p.x = x;
      p.y = y + 0.05;
      p.z = z;
      this.room.clientOf(id)?.send(Messages.correct, this.correctOf(p));
      return;
    }
    const ship = this.ship(p.team);
    if (!ship || ship.sunk || cur) return;
    const cls = this.cls(ship);
    const role = cls.roles[station];
    if (!role) return;
    const occupant = ship.crew.get(String(station));
    const occ = occupant ? this.room.state.players.get(occupant) : undefined;
    // Vị trí có người (còn sống) đứng rồi: máy thì nhường, người thì thôi.
    if (occ && occ.alive && parseSeat(occ.vehicle)) {
      if (!occ.bot) return;
      this.leaveStation(occupant!, occ);
      const b = this.brains.get(occupant!);
      if (b) b.local = [role.station[0] + 1.5, role.station[1], role.station[2] - 1.5];
    }
    // Phải đứng gần bàn điều khiển.
    const [lx, ly, lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
    if (Math.hypot(lx - role.station[0], lz - role.station[2]) > 4.5 || Math.abs(ly - role.station[1]) > 2.5) return;
    this.man(id, p, ship, station);
  }

  private leaveStation(id: string, p: PlayerState) {
    const cur = this.seatOf(p);
    if (cur && cur.ship.crew.get(String(cur.station)) === id) cur.ship.crew.delete(String(cur.station));
    p.vehicle = "";
  }

  /** Người rời phòng / gục: rời vị trí. */
  onDeath(id: string) {
    const p = this.room.state.players.get(id);
    if (!p) return;
    this.leaveStation(id, p);
    p.respawn = NAVAL_RESPAWN;
    // Máy bay của phi công vẫn bay (lái từ xa trên tàu) nhưng không còn ai lái: rơi.
    for (const [uid, u] of this.ns.units) if (u.owner === id && (u.kind === "missile" || u.kind === "gtorpedo")) this.units.get(uid)!.bot = true;
  }

  /** Người đang đứng vị trí nào của tàu mình (số vị trí, −1 nếu không). */
  stationOf(id: string): number {
    const p = this.room.state.players.get(id);
    const seat = p ? parseSeat(p.vehicle) : null;
    return seat ? seat.station : -1;
  }

  private roleOf(id: string, p: PlayerState) {
    const seat = this.seatOf(p);
    if (!seat || seat.ship.crew.get(String(seat.station)) !== id) return null;
    return { ship: seat.ship, cls: this.cls(seat.ship), station: seat.station, role: this.cls(seat.ship).roles[seat.station]! };
  }

  // -------------------------------------------------------------------------- điều khiển

  helmInput(id: string, msg: NavalHelmMessage) {
    const p = this.room.state.players.get(id);
    const r = p && this.roleOf(id, p);
    if (!r || !r.role.helm) return;
    this.helm.set(r.ship.team, { throttle: msg.throttle, rudder: msg.rudder });
    if (msg.dive !== undefined && r.cls.id === "submarine") r.ship.dive = msg.dive && r.ship.air > 5;
  }

  aim(id: string, msg: NavalAimMessage) {
    const p = this.room.state.players.get(id);
    const r = p && this.roleOf(id, p);
    if (!r) return;
    if (r.role.weapons.includes("aa")) {
      r.ship.aaYaw = msg.yaw;
      r.ship.aaPitch = msg.pitch;
    } else if (msg.x !== undefined && msg.z !== undefined) {
      r.ship.aimX = msg.x;
      r.ship.aimZ = msg.z;
      r.ship.aimPitch = msg.pitch;
    }
  }

  /** Bộ phận còn dùng được (máu > 0). */
  partOk(ship: ShipState, part: string): boolean {
    return this.partHp(ship, part) > 0;
  }

  private cooling(ship: ShipState, part: string): boolean {
    return (this.coolF.get(`${ship.team}:${part}`) ?? 0) > 0;
  }

  private cool(ship: ShipState, part: string, seconds: number) {
    this.coolF.set(`${ship.team}:${part}`, seconds);
    ship.cool.set(part, seconds);
  }

  /** Đặt máu bộ phận (phần trăm, số thực); trạng thái nhận số nguyên làm tròn lên. */
  private setPart(ship: ShipState, part: string, pct: number) {
    const v = Math.max(0, Math.min(100, pct));
    this.partF.set(`${ship.team}:${part}`, v);
    const shown = Math.ceil(v);
    if (shown >= 100) ship.parts.delete(part);
    else if (ship.parts.get(part) !== shown) ship.parts.set(part, shown);
  }

  private partHp(ship: ShipState, part: string): number {
    return this.partF.get(`${ship.team}:${part}`) ?? ship.parts.get(part) ?? 100;
  }

  private setFire(ship: ShipState, part: string, v: number) {
    const key = `${ship.team}:${part}`;
    if (v <= 0) {
      this.fireF.delete(key);
      ship.fires.delete(part);
      return;
    }
    this.fireF.set(key, Math.min(100, v));
    const shown = Math.max(1, Math.round(Math.min(100, v)));
    if (ship.fires.get(part) !== shown) ship.fires.set(part, shown);
  }

  private fireOf(ship: ShipState, part: string): number {
    return this.fireF.get(`${ship.team}:${part}`) ?? ship.fires.get(part) ?? 0;
  }

  fire(id: string, msg: NavalFireMessage) {
    const p = this.room.state.players.get(id);
    if (!p || !p.alive || this.room.state.phase !== "battle") return;
    const weapon = msg.weapon as NavalWeaponId;
    // Phi công đang bay: súng máy bay, thả bom.
    if (weapon === "jetGun") return this.jetGun(id);
    const r = this.roleOf(id, p);
    if (!r) return;
    // Phi công đứng ở máy phóng: cất cánh.
    if (msg.weapon === "jet") {
      if (r.role.role === "pilot") this.launchJet(id, r.ship);
      return;
    }
    if (!r.role.weapons.includes(weapon)) return;
    switch (weapon) {
      case "bbGun":
      case "ddGun":
        this.salvo(id, r.ship, weapon, msg.x ?? r.ship.aimX, msg.z ?? r.ship.aimZ);
        break;
      case "aa":
        r.ship.aaYaw = msg.yaw;
        r.ship.aaPitch = msg.pitch;
        this.aaVolley(id, r.ship);
        break;
      case "torpedo":
        this.torpedo(id, r.ship, msg.yaw, false);
        break;
      case "gtorpedo":
        this.torpedo(id, r.ship, msg.yaw, true, r.station);
        break;
      case "missile":
        this.missile(id, r.ship, msg.yaw);
        break;
      case "depth":
        this.depthCharge(id, r.ship);
        break;
      case "decoy":
        this.decoy(r.ship);
        break;
    }
  }

  private fx(msg: NavalFxMessage) {
    this.room.broadcast(Messages.navalFx, msg);
  }

  /** Loạt pháo chính: mọi tháp pháo còn tốt, đã nạp xong, quay tới được điểm ngắm đều bắn. */
  private salvo(owner: string, ship: ShipState, weapon: "bbGun" | "ddGun", tx: number, tz: number) {
    const cls = this.cls(ship);
    const w = NAVAL_WEAPONS[weapon];
    const pose = this.pose(ship);
    let fired = false;
    for (const part of cls.parts) {
      const m = part.mount;
      if (!m || m.weapon !== weapon || !this.partOk(ship, part.id) || this.cooling(ship, part.id)) continue;
      const pv = shipToWorld(pose, m.pivot[0], m.pivot[1], m.pivot[2]);
      const yaw = Math.atan2(tx - pv[0], tz - pv[2]);
      if (!mountCovers(pose, m, yaw)) continue;
      const d = Math.hypot(tx - pv[0], tz - pv[2]);
      const elev = shellElevation(w.speed, Math.min(d, w.range), -pv[1]);
      if (!Number.isFinite(elev)) continue;
      for (let k = 0; k < m.barrels; k++) {
        const ey = elev + (Math.random() - 0.5) * w.spread * 2;
        const ay = yaw + (Math.random() - 0.5) * w.spread * 2;
        const sp = w.speed * (1 + (Math.random() - 0.5) * 0.01);
        const v: V3 = [Math.sin(ay) * Math.cos(ey) * sp, Math.sin(ey) * sp, Math.cos(ay) * Math.cos(ey) * sp];
        const o: V3 = [pv[0] + (v[0] / sp) * m.barrel, pv[1] + (v[1] / sp) * m.barrel, pv[2] + (v[2] / sp) * m.barrel];
        this.shells.push({ pos: o, v, life: 30, owner, team: ship.team, from: ship.team, weapon, age: 0 });
        this.fx({ k: "shell", x: o[0], y: o[1], z: o[2], v, weapon, ship: ship.team, part: part.id });
      }
      this.cool(ship, part.id, w.reload);
      fired = true;
    }
    if (fired) ship.shots = (ship.shots + 1) % 65535;
  }

  /** Loạt phòng không: mọi ổ còn tốt quay tới được hướng ngắm bắn một phát (đạn vạch). */
  private aaVolley(owner: string, ship: ShipState) {
    const last = this.aaAt.get(ship.team) ?? -1;
    if (this.clock - last < NAVAL_WEAPONS.aa.reload * 0.9) return;
    this.aaAt.set(ship.team, this.clock);
    const cls = this.cls(ship);
    const pose = this.pose(ship);
    const w = NAVAL_WEAPONS.aa;
    let fired = false;
    for (const part of cls.parts) {
      const m = part.mount;
      if (!m || m.weapon !== "aa" || !this.partOk(ship, part.id) || !mountCovers(pose, m, ship.aaYaw)) continue;
      const pv = shipToWorld(pose, m.pivot[0], m.pivot[1], m.pivot[2]);
      const yaw = ship.aaYaw + (Math.random() - 0.5) * w.spread * 2;
      const pitch = Math.max(-0.2, ship.aaPitch) + (Math.random() - 0.5) * w.spread * 2;
      const cp = Math.cos(pitch);
      const d: V3 = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
      this.flak.push({ pos: [pv[0] + d[0] * m.barrel, pv[1] + d[1] * m.barrel, pv[2] + d[2] * m.barrel], v: [d[0] * w.speed, d[1] * w.speed, d[2] * w.speed], life: w.range / w.speed, owner, team: ship.team, from: ship.team, jet: false });
      fired = true;
    }
    if (fired) ship.aaShots = (ship.aaShots + 1) % 65535;
  }

  private newUnit(kind: string, ship: ShipState, owner: string, at: V3, yaw: number, pitch: number, speed: number, bot: boolean, life: number): string {
    const id = `u${++this.seq}`;
    const u = new NavalUnitState();
    u.kind = kind;
    u.team = ship.team;
    u.owner = owner;
    u.ship = ship.team;
    u.x = at[0];
    u.y = at[1];
    u.z = at[2];
    u.yaw = yaw;
    u.pitch = pitch;
    u.speed = speed;
    u.hp = kind === "plane" ? UNIT_HP.plane : kind === "missile" ? UNIT_HP.missile : UNIT_HP.torpedo;
    this.ns.units.set(id, u);
    this.units.set(id, { bot, wantYaw: yaw, wantPitch: pitch, throttle: 0, life, quiet: 0, gunAt: 0 });
    return id;
  }

  private isBot(id: string): boolean {
    return this.room.state.players.get(id)?.bot ?? true;
  }

  /** Ngư lôi: ống còn tốt, nạp xong, quay tới được hướng (thẳng) — dẫn đường thì ống của vị trí người bắn. */
  private torpedo(owner: string, ship: ShipState, yaw: number, guided: boolean, station = 0) {
    const cls = this.cls(ship);
    const pose = this.pose(ship);
    const weapon = guided ? "gtorpedo" : "torpedo";
    const tubes = cls.parts.filter((p) => p.mount?.weapon === weapon && this.partOk(ship, p.id) && !this.cooling(ship, p.id));
    // Tàu ngầm hai sĩ quan: người vị trí 1 dùng ống mũi, vị trí 2 ống đuôi.
    const pick = guided ? tubes.filter((p) => (station === 2 ? p.mount!.rest !== 0 : p.mount!.rest === 0)) : tubes;
    const tube = pick.find((p) => mountCovers(pose, p.mount!, yaw, guided ? Math.PI : 0)) ?? (guided ? pick[0] : undefined);
    if (!tube) return;
    const m = tube.mount!;
    const fireYaw = guided ? ship.rotY + m.rest : clampMountYaw(pose, m, yaw);
    const w = NAVAL_WEAPONS[weapon];
    const shots = guided ? 1 : Math.min(2, m.barrels);
    for (let k = 0; k < shots; k++) {
      const spread = guided ? 0 : (k - (shots - 1) / 2) * 0.06;
      const pv = shipToWorld(pose, m.pivot[0], m.pivot[1], m.pivot[2]);
      const out = Math.max(cls.beam / 2, 3) + 2;
      const at: V3 = [pv[0] + Math.sin(fireYaw + spread) * out, TORPEDO_DEPTH, pv[2] + Math.cos(fireYaw + spread) * out];
      this.newUnit(guided ? "gtorpedo" : "torpedo", ship, owner, at, fireYaw + spread, 0, w.speed, guided ? this.isBot(owner) : true, guided ? w.range : w.range / w.speed);
    }
    this.cool(ship, tube.id, w.reload);
    this.fx({ k: "launch", x: pose.x, y: 0, z: pose.z, weapon, ship: ship.team, part: tube.id });
  }

  /** Tên lửa phóng thẳng đứng từ giếng phóng còn tốt, rồi người phóng lái (hay máy lái). */
  private missile(owner: string, ship: ShipState, yaw: number) {
    const cls = this.cls(ship);
    const vls = cls.parts.find((p) => p.mount?.weapon === "missile" && this.partOk(ship, p.id) && !this.cooling(ship, p.id));
    if (!vls) return;
    // Mỗi lúc chỉ một tên lửa của mỗi người.
    for (const u of this.ns.units.values()) if (u.owner === owner && u.kind === "missile") return;
    const pv = shipToWorld(this.pose(ship), vls.mount!.pivot[0], vls.mount!.pivot[1] + 1.5, vls.mount!.pivot[2]);
    this.newUnit("missile", ship, owner, pv, yaw, 1.2, NAVAL_WEAPONS.missile.speed, this.isBot(owner), NAVAL_WEAPONS.missile.range);
    this.cool(ship, vls.id, NAVAL_WEAPONS.missile.reload);
    this.fx({ k: "launch", x: pv[0], y: pv[1], z: pv[2], weapon: "missile", ship: ship.team, part: vls.id });
  }

  private depthCharge(owner: string, ship: ShipState) {
    const cls = this.cls(ship);
    const rack = cls.parts.find((p) => p.mount?.weapon === "depth" && this.partOk(ship, p.id) && !this.cooling(ship, p.id));
    if (!rack) return;
    for (const side of [-1, 1]) {
      const [x, , z] = shipToWorld(this.pose(ship), side * 2.5, 0, -cls.length / 2 - 2);
      this.charges.push({ x, y: 0, z, fuse: 2.6 + Math.random() * 0.8, owner, team: ship.team });
    }
    this.cool(ship, rack.id, NAVAL_WEAPONS.depth.reload);
    this.fx({ k: "launch", x: ship.x, y: 0, z: ship.z, weapon: "depth", ship: ship.team, part: rack.id });
  }

  private decoy(ship: ShipState) {
    const cls = this.cls(ship);
    const tube = cls.parts.find((p) => p.mount?.weapon === "decoy" && this.partOk(ship, p.id) && !this.cooling(ship, p.id));
    if (!tube) return;
    ship.decoy = 12;
    this.cool(ship, tube.id, NAVAL_WEAPONS.decoy.reload);
    // Mồi nhử bay ra bên mạn, nổ chớp sáng, phát nhiễu ra-đa.
    const [x, , z] = shipToWorld(this.pose(ship), 40, 0, -10);
    this.newUnit("decoy", ship, "", [x, 18, z], ship.rotY, 0, 0, true, 12);
    this.fx({ k: "decoy", x, y: 18, z, ship: ship.team });
  }

  /** Phi công đứng ở máy phóng: cất cánh nếu đã có máy bay. */
  private launchJet(owner: string, ship: ShipState) {
    if (ship.jet || ship.jetWait > 0) return;
    const cls = this.cls(ship);
    const cat = cls.parts.find((p) => p.kind === "catapult");
    if (!cat || !this.partOk(ship, cat.id)) return;
    const at = shipToWorld(this.pose(ship), cat.at[0], cat.at[1] + 1.2, cat.at[2] + 12);
    const id = this.newUnit("plane", ship, owner, at, ship.rotY, 0.12, JET.cruise * 0.85, this.isBot(owner), 9999);
    this.ns.units.get(id)!.bombs = JET.bombs;
    ship.jet = id;
    this.fx({ k: "launch", x: at[0], y: at[1], z: at[2], weapon: "plane", ship: ship.team, part: cat.id });
  }

  private jetGun(owner: string) {
    const ship = [...this.ns.ships.values()].find((s) => s.jet && this.ns.units.get(s.jet)?.owner === owner);
    const u = ship && this.ns.units.get(ship.jet);
    if (!u) return;
    const last = this.aaAt.get(ship.jet) ?? -1;
    if (this.clock - last < NAVAL_WEAPONS.jetGun.reload * 0.9) return;
    this.aaAt.set(ship.jet, this.clock);
    const w = NAVAL_WEAPONS.jetGun;
    const cp = Math.cos(u.pitch);
    const d: V3 = [Math.sin(u.yaw) * cp, Math.sin(u.pitch), Math.cos(u.yaw) * cp];
    for (const side of [-1, 1]) {
      const ox = u.x + Math.cos(u.yaw) * side * 2.2 + d[0] * 4;
      const oz = u.z - Math.sin(u.yaw) * side * 2.2 + d[2] * 4;
      const sp = w.speed + u.speed;
      this.flak.push({ pos: [ox, u.y + d[1] * 4, oz], v: [d[0] * sp, d[1] * sp, d[2] * sp], life: w.range / w.speed, owner, team: u.team, from: ship.team, jet: true });
    }
    this.fx({ k: "jet", x: u.x, y: u.y, z: u.z, v: [d[0], d[1], d[2]], team: u.team });
  }

  /** Thả bom: rơi theo quán tính máy bay. */
  private bomb(owner: string) {
    const ship = [...this.ns.ships.values()].find((s) => s.jet && this.ns.units.get(s.jet)?.owner === owner);
    const u = ship && this.ns.units.get(ship.jet);
    if (!u || u.bombs <= 0) return;
    const last = this.aaAt.get(`${ship.jet}:bomb`) ?? -9;
    if (this.clock - last < 0.6) return;
    this.aaAt.set(`${ship.jet}:bomb`, this.clock);
    u.bombs--;
    const cp = Math.cos(u.pitch);
    const v: V3 = [Math.sin(u.yaw) * cp * u.speed, Math.sin(u.pitch) * u.speed, Math.cos(u.yaw) * cp * u.speed];
    const o: V3 = [u.x, u.y - 1.6, u.z];
    this.shells.push({ pos: o, v, life: 20, owner, team: u.team, from: "", weapon: "bomb", age: 1 });
    this.fx({ k: "bomb", x: o[0], y: o[1], z: o[2], v, team: u.team });
  }

  act(id: string, msg: NavalActMessage) {
    const p = this.room.state.players.get(id);
    if (!p || !p.alive) return;
    if (msg.act === "bomb") return this.bomb(id);
    if (msg.act === "eject") {
      // Phi công bỏ máy bay (máy bay rơi), về lại tàu.
      for (const s of this.ns.ships.values()) {
        const u = s.jet ? this.ns.units.get(s.jet) : undefined;
        if (u?.owner === id) this.downUnit(s.jet, "");
      }
      return;
    }
    if (msg.act === "board") return this.board(id, p);
    if (msg.act === "extinguish") return this.douse(id, p);
  }

  /** Đang bơi sát mạn tàu mình: leo lưới lên boong (gần đuôi). */
  private board(id: string, p: PlayerState) {
    const ship = this.ship(p.team);
    if (!ship || ship.sunk || ship.dive || ship.y < -2) return;
    const cls = this.cls(ship);
    const [lx, , lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
    if (Math.abs(lx) > cls.beam / 2 + 10 || Math.abs(lz) > cls.length / 2 + 10) return;
    const tz = Math.max(-cls.length / 2 + 8, Math.min(cls.length / 2 - 14, lz));
    // Chỗ đứng gần mạn nhất có sàn ở bên mạn đó (mép boong cong, sàn bay chìa ra không đều).
    let tx = 0;
    let floor = deckBelow(cls, 0, cls.deck + 1, tz);
    for (let k = cls.beam / 2 - 1.5; k > 0; k -= 0.5) {
      const x = Math.sign(lx || 1) * k;
      const f = deckBelow(cls, x, cls.deck + 1, tz);
      if (Number.isFinite(f) && !insideShip(cls, x, f + 1, tz)) {
        tx = x;
        floor = f;
        break;
      }
    }
    const [x, y, z] = shipToWorld(this.pose(ship), tx, Number.isFinite(floor) ? floor : cls.deck, tz);
    p.x = x;
    p.y = y + 0.1;
    p.z = z;
    this.room.clientOf(id)?.send(Messages.correct, this.correctOf(p));
  }

  /** Giữ F cạnh đám cháy trên tàu mình: dập dần (mỗi lần gọi tính theo thời gian từ lần trước, tối đa 0,4 giây). */
  private douse(id: string, p: PlayerState) {
    const ship = this.ship(p.team);
    if (!ship || ship.sunk || ship.fires.size === 0) return;
    const last = this.dousing.get(id) ?? this.clock - 0.25;
    const dt = Math.min(0.4, Math.max(0, this.clock - last));
    this.dousing.set(id, this.clock);
    const cls = this.cls(ship);
    const [lx, ly, lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
    let best: ShipPart | null = null;
    let bestD: number = FIRE.reach;
    for (const pid of ship.fires.keys()) {
      const part = cls.parts.find((q) => q.id === pid);
      if (!part) continue;
      const [fx, fy, fz] = firePoint(cls, part);
      const d = Math.hypot(lx - fx, (ly - fy) * 0.6, lz - fz);
      if (d < bestD) {
        bestD = d;
        best = part;
      }
    }
    if (!best) return;
    const left = this.fireOf(ship, best.id) - FIRE.douse * dt;
    this.setFire(ship, best.id, left);
    if (left <= 0) awardXp(id, "repair");
  }

  /** Máy người lái báo vị trí tên lửa / ngư lôi dẫn đường / máy bay. */
  unitMove(id: string, msg: NavalUnitMessage) {
    const u = this.ns.units.get(msg.id);
    const d = this.units.get(msg.id);
    if (!u || !d || u.owner !== id || d.bot) return;
    const max = u.kind === "plane" ? JET.max : u.kind === "missile" ? NAVAL_WEAPONS.missile.speed : NAVAL_WEAPONS.gtorpedo.speed;
    const moved = Math.hypot(msg.x - u.x, msg.y - u.y, msg.z - u.z);
    const budget = max * UNIT_SLACK * Math.max(0.1, d.quiet + 0.05) + 6;
    if (moved > budget) return;
    // Không cho bay / chạy ra quá xa ngoài bản đồ.
    const edge = NAVAL_HALF + 120;
    u.x = Math.max(-edge, Math.min(edge, msg.x));
    u.y = u.kind === "gtorpedo" ? TORPEDO_DEPTH : Math.min(JET.ceiling + 5, msg.y);
    u.z = Math.max(-edge, Math.min(edge, msg.z));
    u.yaw = msg.yaw;
    u.pitch = msg.pitch;
    u.roll = msg.roll;
    u.speed = Math.min(max, msg.speed);
    d.quiet = 0;
  }

  // -------------------------------------------------------------------------- trúng tàu

  /** Tàu ngầm đang lặn (đạn pháo, bom, tên lửa chỉ trúng khi nổ sát). */
  private submerged(ship: ShipState): boolean {
    return ship.cls === "submarine" && ship.y < -4;
  }

  /**
   * Tàu `ship` có thấy tàu `enemy` không: tàu nổi luôn thấy; tàu ngầm đang lặn chỉ lộ khi ở gần (260 m), hay trong
   * vùng ra-đa còn tốt của tàu tên lửa (450 m), hay ngay sau khi phóng ngư lôi (vệt bọt).
   */
  sees(ship: ShipState, enemy: ShipState): boolean {
    if (!this.submerged(enemy)) return true;
    const d = Math.hypot(enemy.x - ship.x, enemy.z - ship.z);
    if (d < 260) return true;
    if (ship.cls === "cruiser" && this.partOk(ship, "radar") && d < 450) return true;
    if (ship.cls === "destroyer" && this.partOk(ship, "radar") && d < SONAR) return true;
    // Vừa phóng ngư lôi: lộ vị trí vài giây (bọt khí, tiếng ống phóng).
    if ((this.coolF.get(`${enemy.team}:tb`) ?? 0) > NAVAL_WEAPONS.torpedo.reload - 4) return true;
    return ["gt1", "gt2"].some((t) => (this.coolF.get(`${enemy.team}:${t}`) ?? 0) > NAVAL_WEAPONS.gtorpedo.reload - 4);
  }

  /**
   * Trúng tàu ở `at` (thế giới): trừ máu thân tàu và bộ phận gần chỗ trúng nhất, có thể gây cháy; nổ lan sát thương
   * người trên boong quanh đó.
   */
  hitShip(ship: ShipState, partId: string, dmg: number, weapon: NavalWeaponId, attacker: string, at: V3, fireChance: number, blast = 0) {
    if (ship.sunk || this.room.state.phase !== "battle") return;
    const cls = this.cls(ship);
    dmg *= armorOf(cls.id, weapon);
    ship.hp = Math.max(0, ship.hp - Math.round(dmg));
    if (attacker) this.lastHit.set(ship.team, attacker);
    const part = cls.parts.find((p) => p.id === partId);
    if (part && part.kind !== "section") {
      const before = this.partHp(ship, part.id);
      const after = Math.max(0, before - (dmg / part.hp) * 100);
      this.setPart(ship, part.id, after);
      if (before > 0 && after === 0) {
        this.fx({ k: "wreck", x: at[0], y: at[1], z: at[2], ship: ship.team, part: part.id });
        if (part.kind === "catapult" && ship.jet) this.downUnit(ship.jet, attacker);
      }
    }
    if (Math.random() < fireChance) {
      const pid = part ? part.id : partAt(cls, ...worldToShip(this.pose(ship), at[0], at[1], at[2]));
      const cur = this.fireOf(ship, pid);
      if (cur < 30) {
        this.setFire(ship, pid, 30);
        if (!cur) this.fx({ k: "fire", x: at[0], y: at[1], z: at[2], ship: ship.team, part: pid });
      }
    }
    if (attacker) {
      const a = this.room.state.players.get(attacker);
      if (a && !a.bot && a.team !== ship.team) this.room.clientOf(attacker)?.send(Messages.hit, { kind: "body", armor: true, amount: Math.round(dmg) });
    }
    // Sức nổ trên boong: người đứng quanh đó trúng mảnh (nổ to thì hiện cả cột lửa khói như đạn pháo).
    if (blast > 0) this.room.explode(at[0], at[1], at[2], "shell", attacker, blast, dmg * 0.6, weapon);
    if (ship.hp <= 0) this.sink(ship, attacker);
  }

  private sink(ship: ShipState, killer: string) {
    if (ship.sunk) return;
    ship.sunk = true;
    ship.hp = 0;
    ship.throttle = 0;
    this.fx({ k: "sink", x: ship.x, y: 0, z: ship.z, ship: ship.team });
    // Người trên tàu chìm theo (gục), người đã nhảy xuống biển thì thôi.
    const cls = this.cls(ship);
    for (const [id, p] of this.room.state.players) {
      if (!p.alive || p.team !== ship.team) continue;
      const [lx, , lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
      if (parseSeat(p.vehicle) || (Math.abs(lx) < cls.beam / 2 + 2 && Math.abs(lz) < cls.length / 2 + 2 && !p.swimming)) this.room.kill(id, killer || this.lastHit.get(ship.team) || "", "naval", false);
    }
    if (!this.ending) {
      this.ending = ship.team === "blue" ? "red" : "blue";
      this.sinkTimer = 5;
    }
  }

  private downUnit(uid: string, killer: string) {
    const u = this.ns.units.get(uid);
    if (!u) return;
    this.fx({ k: u.kind === "plane" ? "down" : "blast", x: u.x, y: u.y, z: u.z, weapon: u.kind, team: u.team });
    if (u.kind === "plane") {
      const ship = this.ship(u.ship);
      if (ship && ship.jet === uid) {
        ship.jet = "";
        ship.jetWait = JET.respawn;
      }
      if (killer) awardXp(killer, "kill");
    }
    this.ns.units.delete(uid);
    this.units.delete(uid);
  }

  /** Tên lửa, ngư lôi, bom nổ ở `at`: tìm tàu trúng (hay nổ sát tàu ngầm đang lặn). */
  private impact(weapon: NavalWeaponId, owner: string, team: string, at: V3, ship: ShipState | null, part: string) {
    const w = NAVAL_WEAPONS[weapon];
    if (ship) {
      this.hitShip(ship, part, w.damage, weapon, owner, at, w.fire, w.splash);
      this.fx({ k: weapon === "torpedo" || weapon === "gtorpedo" ? "blast" : "hit", x: at[0], y: at[1], z: at[2], ship: ship.team, part, weapon });
      return;
    }
    // Trượt: cột nước; tàu ngầm lặn gần đó chịu sức ép.
    this.fx({ k: "splash", x: at[0], y: 0, z: at[2], weapon });
    for (const s of this.ns.ships.values()) {
      if (s.team === team || !this.submerged(s) || s.sunk) continue;
      const d = Math.hypot(at[0] - s.x, at[2] - s.z);
      const reach = this.cls(s).length / 2 + w.splash;
      if (d < reach) this.hitShip(s, "mid", w.damage * 0.4 * (1 - d / reach), weapon, owner, at, 0);
    }
  }

  // -------------------------------------------------------------------------- nhịp trận

  tick(dt: number) {
    const s = this.room.state;
    if (s.battleMode !== "naval" || (s.phase !== "battle" && s.phase !== "prep")) return;
    this.clock += dt;
    const battle = s.phase === "battle";
    for (const ship of this.ns.ships.values()) this.tickShip(ship, dt, battle);
    this.collideShips(dt);
    this.carry(dt);
    if (battle) {
      this.tickShells(dt);
      this.tickFlak(dt);
      this.tickCharges(dt);
      this.tickUnits(dt);
      this.tickBots(dt);
      this.tickRespawn(dt);
      this.timer += dt;
      if (this.timer >= 1) {
        this.timer -= 1;
        if (this.ns.timeLeft > 0) this.ns.timeLeft--;
      }
    } else for (const [id, p] of s.players) if (p.bot && !parseSeat(p.vehicle)) this.botMan(id, p);
    if (this.ending) {
      this.sinkTimer -= dt;
      if (this.sinkTimer <= 0) {
        const w = this.ending;
        this.ending = "";
        this.room.endNaval(w);
      }
    } else if (battle && this.ns.timeLeft <= 0) {
      const b = this.ship("blue");
      const r = this.ship("red");
      const share = (x?: ShipState) => (x ? x.hp / Math.max(1, x.maxHp) : 0);
      this.room.endNaval(share(b) >= share(r) ? "blue" : "red");
    }
  }
  private timer = 0;

  /** Pose cũ của từng tàu ở nhịp trước (mang người trên boong theo). */
  private prev = new Map<string, ShipPose>();

  private tickShip(ship: ShipState, dt: number, battle: boolean) {
    const cls = this.cls(ship);
    this.prev.set(ship.team, this.pose(ship));
    // Hồi nạp các ụ.
    for (const k of [...ship.cool.keys()]) {
      const key = `${ship.team}:${k}`;
      const left = (this.coolF.get(key) ?? 0) - dt;
      if (left <= 0) {
        this.coolF.delete(key);
        ship.cool.delete(k);
        continue;
      }
      this.coolF.set(key, left);
      // Trạng thái chỉ đổi theo bước 0,1 giây (đỡ tốn đường truyền).
      const shown = Math.ceil(left * 10) / 10;
      if (ship.cool.get(k) !== shown) ship.cool.set(k, shown);
    }
    if (ship.decoy > 0) ship.decoy = Math.max(0, ship.decoy - dt);
    if (ship.jetWait > 0) ship.jetWait = Math.max(0, ship.jetWait - dt);
    if (ship.sunk) {
      // Chìm dần, nghiêng mũi.
      ship.y = Math.max(-cls.deck - cls.draft - 14, ship.y - dt * 0.8);
      ship.speed *= 1 - dt * 0.5;
      return;
    }
    // Máy hỏng: còn 40% sức; cầu chỉ huy hỏng: bẻ lái yếu.
    const drive = this.partOk(ship, "engine") ? 1 : 0.4;
    const steer = this.partOk(ship, "bridge") ? 1 : 0.55;
    // Không ai đứng vị trí lái: giữ máy như cũ, bánh lái về giữa.
    const helmStation = cls.roles.findIndex((r) => r.helm);
    const h = battle ? (this.helm.get(ship.team) ?? { throttle: 0, rudder: 0 }) : { throttle: 0, rudder: 0 };
    if (!ship.crew.has(String(helmStation))) h.rudder = 0;
    ship.throttle = h.throttle;
    ship.rudder = h.rudder;
    const map = this.room.map;
    const next = shipStep(cls, { pose: this.pose(ship), speed: ship.speed }, h.throttle, h.rudder, dt, drive, steer, (x, z, r) => shipAground(cls, map, x, z, r));
    ship.x = next.pose.x;
    ship.z = next.pose.z;
    ship.rotY = next.pose.rotY;
    ship.speed = next.speed;
    // Tàu ngầm lặn / nổi, dưỡng khí.
    if (cls.id === "submarine") {
      if (ship.air <= 0) ship.dive = false;
      const want = ship.dive ? SUB.depth : 0;
      ship.y += Math.max(-SUB.rate * dt, Math.min(SUB.rate * dt, want - ship.y));
      // Dưỡng khí tính số thực riêng (trạng thái chỉ gửi số nguyên).
      const cur = this.air.get(ship.team) ?? ship.air;
      const air = ship.y < -4 ? cur - (100 / SUB.air) * dt : cur + (100 / SUB.air) * SUB.recharge * dt;
      const a = Math.max(0, Math.min(100, air));
      this.air.set(ship.team, a);
      if (Math.round(a) !== ship.air) ship.air = Math.round(a);
      // Lặn: người đứng trên boong bị cuốn xuống nước (người đứng vị trí thì ở trong tàu); nước dập tắt mọi đám cháy.
      if (ship.y < -0.8) this.sweepDeck(ship);
      if (ship.y < -3) for (const pid of [...ship.fires.keys()]) this.setFire(ship, pid, 0);
    }
    // Lửa: lớn dần, ăn máu, lan sang bộ phận khác.
    if (battle && ship.fires.size) {
      let burn = 0;
      for (const pid of [...ship.fires.keys()]) {
        const grown = Math.min(100, this.fireOf(ship, pid) + FIRE.grow * dt);
        burn += grown / 100;
        this.setFire(ship, pid, grown);
        const part = cls.parts.find((q) => q.id === pid);
        if (part && part.kind !== "section") {
          const before = this.partHp(ship, pid);
          if (before > 0) {
            this.setPart(ship, pid, before - (FIRE.partBurn * grown * dt) / 100);
            if (this.partHp(ship, pid) === 0) {
              const [x, y, z] = shipToWorld(this.pose(ship), ...firePoint(cls, part));
              this.fx({ k: "wreck", x, y, z, ship: ship.team, part: pid });
            }
          }
        }
        // Lửa lớn lan sang bộ phận gần nhất chưa cháy.
        if (grown > 70 && ship.fires.size < FIRE.max && Math.random() < FIRE.spread * dt) {
          const near = cls.parts.filter((q) => q.id !== pid && !ship.fires.has(q.id)).sort((a, b) => dist3(a.at, part?.at ?? a.at) - dist3(b.at, part?.at ?? b.at))[0];
          if (near) {
            this.setFire(ship, near.id, 25);
            const [x, y, z] = shipToWorld(this.pose(ship), ...firePoint(cls, near));
            this.fx({ k: "fire", x, y, z, ship: ship.team, part: near.id });
          }
        }
      }
      const loss = burn * FIRE.burn * dt;
      this.burnAcc.set(ship.team, (this.burnAcc.get(ship.team) ?? 0) + loss);
      const acc = this.burnAcc.get(ship.team)!;
      if (acc >= 1) {
        this.burnAcc.set(ship.team, acc - Math.floor(acc));
        ship.hp = Math.max(0, ship.hp - Math.floor(acc));
        if (ship.hp <= 0) this.sink(ship, this.lastHit.get(ship.team) ?? "");
      }
      // Người đứng trong đám cháy bị bỏng.
      for (const [id, p] of this.room.state.players) {
        if (!p.alive || p.team !== ship.team || parseSeat(p.vehicle)) continue;
        const [lx, ly, lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
        for (const [pid, v] of ship.fires) {
          const part = cls.parts.find((q) => q.id === pid);
          if (!part || v < 50) continue;
          const [fx, fy, fz] = firePoint(cls, part);
          if (Math.hypot(lx - fx, lz - fz) < 1.6 && Math.abs(ly - fy) < 2) this.room.damage(id, 10 * dt * (v / 100), "zone", "", "fire");
        }
      }
    }
  }
  private burnAcc = new Map<string, number>();
  private air = new Map<string, number>();
  /** Giá trị thực (không làm tròn) của thời gian nạp, độ lớn đám cháy, máu bộ phận: khoá "<tàu>:<bộ phận>". */
  private coolF = new Map<string, number>();
  private fireF = new Map<string, number>();
  private partF = new Map<string, number>();

  private sweepDeck(ship: ShipState) {
    const cls = this.cls(ship);
    for (const [id, p] of this.room.state.players) {
      if (!p.alive || p.team !== ship.team || parseSeat(p.vehicle)) continue;
      const [lx, ly, lz] = worldToShip(this.pose(ship), p.x, p.y, p.z);
      if (Math.abs(lx) > cls.beam / 2 + 1 || Math.abs(lz) > cls.length / 2 + 1 || ly > cls.deck + 8 || p.swimming) continue;
      // Còn vị trí trống: vào trong tàu; không thì bị nước cuốn đi.
      const free = [0, 1, 2].find((k) => !ship.crew.has(String(k)));
      if (free !== undefined) this.man(id, p, ship, free);
    }
  }

  /** Hai tàu chồng lên nhau: đẩy ra, đâm nhau mất máu theo tốc độ. */
  private collideShips(dt: number) {
    const [a, b] = [this.ship("blue"), this.ship("red")];
    if (!a || !b || a.sunk || b.sunk) return;
    const ca = this.cls(a);
    const cb = this.cls(b);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    const reach = (ca.length + cb.length) * 0.32;
    if (d >= reach || d < 1e-3) return;
    const push = (reach - d) * 0.5;
    const nx = (b.x - a.x) / d;
    const nz = (b.z - a.z) / d;
    a.x -= nx * push;
    a.z -= nz * push;
    b.x += nx * push;
    b.z += nz * push;
    const rel = Math.abs(a.speed) + Math.abs(b.speed);
    if (rel > 3 && this.room.state.phase === "battle") {
      const dmg = rel * 30 * dt;
      this.hitShip(a, "bow", dmg, "torpedo", "", [a.x, 2, a.z], 0);
      this.hitShip(b, "bow", dmg, "torpedo", "", [b.x, 2, b.z], 0);
    }
    a.speed *= 1 - dt * 2;
    b.speed *= 1 - dt * 2;
  }

  /**
   * Mang người theo tàu: người đứng vị trí đặt lại đúng chỗ; người đi bộ trên boong (người chơi đứng yên không gửi vị
   * trí) dời theo tàu; máy đi dập lửa đặt theo toạ độ riêng.
   */
  private carry(dt: number) {
    void dt;
    for (const [id, p] of this.room.state.players) {
      if (!p.alive) continue;
      const seat = this.seatOf(p);
      if (seat) {
        this.placeAtStation(p, seat.ship, seat.station);
        p.rotY = seat.ship.rotY + this.cls(seat.ship).roles[seat.station]!.face;
        continue;
      }
      const b = p.bot ? this.brains.get(id) : undefined;
      const ship = this.ship(p.team);
      if (b && ship) {
        const [x, y, z] = shipToWorld(this.pose(ship), b.local[0], b.local[1], b.local[2]);
        p.x = x;
        p.y = y;
        p.z = z;
        continue;
      }
      if (p.swimming) continue;
      for (const sh of this.ns.ships.values()) {
        const prev = this.prev.get(sh.team);
        if (!prev) continue;
        const cls = this.cls(sh);
        const [lx, ly, lz] = worldToShip(prev, p.x, p.y, p.z);
        if (Math.abs(lx) > cls.beam / 2 + 0.5 || Math.abs(lz) > cls.length / 2 + 0.5) continue;
        const floor = deckBelow(cls, lx, ly + 0.3, lz);
        if (!Number.isFinite(floor) || ly - floor > 1.5) continue;
        const [x, y, z] = shipToWorld(this.pose(sh), lx, ly, lz);
        p.x = x;
        p.y = y;
        p.z = z;
        p.rotY += sh.rotY - prev.rotY;
        break;
      }
    }
  }

  /** Tàu có boong ngay dưới chân người này (hay null) và toạ độ riêng của chỗ đứng. */
  deckOf(p: { x: number; y: number; z: number }): { ship: ShipState; local: [number, number, number] } | null {
    for (const sh of this.ns.ships.values()) {
      const cls = this.cls(sh);
      const local = worldToShip(this.pose(sh), p.x, p.y, p.z);
      if (Math.abs(local[0]) > cls.beam / 2 + 0.6 || Math.abs(local[2]) > cls.length / 2 + 0.6) continue;
      const floor = deckBelow(cls, local[0], local[1] + 0.4, local[2]);
      if (Number.isFinite(floor) && local[1] - floor < 3) return { ship: sh, local };
    }
    return null;
  }

  /** Gói đặt lại vị trí cho máy người chơi: đứng trên boong thì kèm toạ độ riêng của tàu. */
  correctOf(p: { x: number; y: number; z: number }): CorrectMessage {
    const d = this.deckOf(p);
    const msg: CorrectMessage = { x: p.x, y: p.y, z: p.z };
    if (d) msg.deck = { ship: d.ship.team, x: d.local[0], y: d.local[1], z: d.local[2] };
    return msg;
  }

  /**
   * Người chơi báo vị trí theo toạ độ riêng của tàu (đứng trên boong): đổi sang thế giới theo tàu của server. Toạ độ
   * ngoài thân tàu thì bỏ (dùng vị trí thế giới như thường).
   */
  deckMove(move: { x: number; y: number; z: number; deck?: { ship: string; x: number; y: number; z: number } }) {
    const d = move.deck;
    const ship = d && this.ship(d.ship);
    if (!d || !ship || ship.sunk) return;
    const cls = this.cls(ship);
    if (Math.abs(d.x) > cls.beam / 2 + 1 || Math.abs(d.z) > cls.length / 2 + 1 || d.y < -cls.draft - 2 || d.y > cls.deck + 30) return;
    const [x, y, z] = shipToWorld(this.pose(ship), d.x, d.y, d.z);
    move.x = x;
    move.y = y;
    move.z = z;
  }

  /** Tốc độ tàu dưới chân người này (m/s), để kiểm tra vị trí người chơi gửi lên rộng ra cho đúng. */
  carrySpeed(p: PlayerState): number {
    for (const sh of this.ns.ships.values()) {
      const cls = this.cls(sh);
      const [lx, , lz] = worldToShip(this.pose(sh), p.x, p.y, p.z);
      if (Math.abs(lx) < cls.beam / 2 + 4 && Math.abs(lz) < cls.length / 2 + 4) return Math.abs(sh.speed) + cls.turn * cls.length * 0.5;
    }
    return 0;
  }

  private tickShells(dt: number) {
    const keep: Shell[] = [];
    for (const sh of this.shells) {
      sh.age += dt;
      sh.life -= dt;
      const from = sh.pos;
      const to = ballisticAt(sh.pos, sh.v, dt);
      const nv: V3 = [sh.v[0], sh.v[1] - 9.81 * dt, sh.v[2]];
      const seg: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const len = Math.hypot(...seg);
      const dir: V3 = [seg[0] / len, seg[1] / len, seg[2] / len];
      let done = false;
      for (const ship of this.ns.ships.values()) {
        if (ship.sunk || (ship.team === sh.from && sh.age < 1.5)) continue;
        if (this.submerged(ship)) continue;
        const hit = rayShip(this.cls(ship), this.pose(ship), from, dir, len);
        if (!hit) continue;
        const at: V3 = [from[0] + dir[0] * hit.t, from[1] + dir[1] * hit.t, from[2] + dir[2] * hit.t];
        this.impact(sh.weapon, sh.owner, sh.team, at, ship, hit.part);
        done = true;
        break;
      }
      if (!done) {
        const ground = this.room.map.world.heightAt(to[0], to[2]);
        if (to[1] <= Math.max(0, ground) || sh.life <= 0) {
          // Rơi xuống nước / đảo: tìm điểm chạm mặt nước dọc đoạn.
          const t = from[1] > 0 && to[1] < 0 ? from[1] / (from[1] - to[1]) : 1;
          const at: V3 = [from[0] + seg[0] * t, Math.max(0, ground), from[2] + seg[2] * t];
          if (ground > 0.5) this.room.explode(at[0], at[1], at[2], "shell", sh.owner, NAVAL_WEAPONS[sh.weapon].splash, NAVAL_WEAPONS[sh.weapon].damage * 0.4, sh.weapon);
          this.impact(sh.weapon, sh.owner, sh.team, at, null, "");
          done = true;
        }
      }
      if (!done) {
        sh.pos = to;
        sh.v = nv;
        keep.push(sh);
      }
    }
    this.shells = keep;
  }

  private tickFlak(dt: number) {
    const keep: Flak[] = [];
    const s = this.room.state;
    for (const f of this.flak) {
      f.life -= dt;
      const from = f.pos;
      const to: V3 = [from[0] + f.v[0] * dt, from[1] + f.v[1] * dt, from[2] + f.v[2] * dt];
      let done = false;
      // Tên lửa, máy bay địch: ngòi nổ cận đích (lọt trong bán kính quanh đường đạn).
      for (const [uid, u] of this.ns.units) {
        if (u.team === f.team || (u.kind !== "missile" && u.kind !== "plane")) continue;
        const r = u.kind === "plane" ? 4.5 : 3;
        if (segPointDist(from, to, [u.x, u.y, u.z]) > r) continue;
        u.hp -= f.jet ? NAVAL_WEAPONS.jetGun.damage : NAVAL_WEAPONS.aa.damage;
        if (u.hp <= 0) this.downUnit(uid, f.owner);
        done = true;
        break;
      }
      // Người (lính trên boong địch, người đứng vị trí lộ ra ngoài).
      if (!done)
        for (const [pid, p] of s.players) {
          if (!p.alive || p.team === f.team) continue;
          const cy = p.y + (p.prone ? 0.3 : p.crouching ? 0.8 : 1.1);
          if (segPointDist(from, to, [p.x, cy, p.z]) > 0.55) continue;
          const dealt = this.room.damage(pid, (f.jet ? NAVAL_WEAPONS.jetGun : NAVAL_WEAPONS.aa).damage * 2.4, "body", f.owner, f.jet ? "jetGun" : "aa", [from[0], from[2]]);
          if (dealt && f.owner) this.room.clientOf(f.owner)?.send(Messages.hit, { kind: dealt.killed ? "kill" : "body", armor: dealt.armor, amount: Math.round(dealt.amount) });
          done = true;
          break;
        }
      // Thân tàu địch: trầy xước (ít máu), không xuyên.
      if (!done)
        for (const ship of this.ns.ships.values()) {
          if (ship.team === f.team || ship.sunk || this.submerged(ship)) continue;
          const seg: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
          const len = Math.hypot(...seg);
          const hit = rayShip(this.cls(ship), this.pose(ship), from, [seg[0] / len, seg[1] / len, seg[2] / len], len);
          if (!hit) continue;
          if (Math.random() < 0.5) this.hitShip(ship, hit.part, SMALL_ARMS_SHIP, f.jet ? "jetGun" : "aa", f.owner, to, f.jet ? NAVAL_WEAPONS.jetGun.fire : NAVAL_WEAPONS.aa.fire);
          done = true;
          break;
        }
      if (!done && (to[1] < 0 || f.life <= 0)) done = true;
      if (!done) {
        f.pos = to;
        f.v[1] -= 9.81 * dt * 0.5;
        keep.push(f);
      }
    }
    this.flak = keep;
  }

  private tickCharges(dt: number) {
    const keep: Charge[] = [];
    for (const c of this.charges) {
      c.fuse -= dt;
      c.y -= 5 * dt;
      if (c.fuse > 0) {
        keep.push(c);
        continue;
      }
      this.fx({ k: "depth", x: c.x, y: 0, z: c.z });
      for (const ship of this.ns.ships.values()) {
        if (ship.team === c.team || ship.sunk) continue;
        const cls = this.cls(ship);
        const [lx, ly, lz] = worldToShip(this.pose(ship), c.x, c.y, c.z);
        const dx = Math.max(0, Math.abs(lx) - cls.beam / 2);
        const dz = Math.max(0, Math.abs(lz) - cls.length / 2);
        const dy = Math.max(0, Math.abs(ly + cls.draft / 2) - cls.draft / 2);
        const d = Math.hypot(dx, dy, dz);
        const w = NAVAL_WEAPONS.depth;
        // Bom chìm: tàu ngầm chịu đủ, tàu nổi chỉ chịu sức ép dưới đáy.
        if (d < w.splash) this.hitShip(ship, partAt(cls, lx, ly, lz), w.damage * (1 - d / w.splash) * (cls.id === "submarine" ? 1 : 0.35), "depth", c.owner, [c.x, 0, c.z], 0);
      }
    }
    this.charges = keep;
  }

  private tickUnits(dt: number) {
    const map = this.room.map;
    for (const [uid, u] of [...this.ns.units]) {
      const d = this.units.get(uid);
      if (!d) continue;
      d.life -= dt;
      d.quiet += dt;
      // Người lái im quá lâu (rớt mạng): máy tự lái tiếp.
      if (!d.bot && d.quiet > 1.5) d.bot = true;
      if (u.kind === "decoy") {
        if (d.life <= 0) this.ns.units.delete(uid);
        continue;
      }
      if (d.bot || u.kind === "torpedo") this.stepUnit(uid, u, d, dt);
      if (u.kind === "plane" && d.bot && !this.botOwner(u)) {
        // Máy bay không người lái (phi công rời): rơi.
        u.pitch = Math.max(-1, u.pitch - dt * 0.3);
      }
      if (d.life <= 0) {
        if (u.kind === "missile") this.impact("missile", u.owner, u.team, [u.x, 0, u.z], null, "");
        this.downUnit(uid, "");
        continue;
      }
      // Va chạm: tàu, nước, đảo.
      const ground = map.world.heightAt(u.x, u.z);
      let hitShip: ShipState | null = null;
      let part = "";
      for (const ship of this.ns.ships.values()) {
        if (ship.sunk) continue;
        if (ship.team === u.team && u.kind !== "plane") continue;
        if (u.kind === "plane" && ship.team === u.team) continue;
        const cls = this.cls(ship);
        const [lx, ly, lz] = worldToShip(this.pose(ship), u.x, u.y, u.z);
        if (Math.abs(lx) > cls.beam + 4 || Math.abs(lz) > cls.length / 2 + 6) continue;
        if (!insideShip(cls, lx, ly, lz, u.kind === "missile" ? 1 : 0.4)) continue;
        hitShip = ship;
        part = partAt(cls, lx, ly, lz);
        break;
      }
      const weapon: NavalWeaponId = u.kind === "plane" ? "bomb" : (u.kind as NavalWeaponId);
      if (hitShip) {
        const dmg = u.kind === "plane" ? 220 : NAVAL_WEAPONS[weapon].damage;
        this.hitShip(hitShip, part, dmg, weapon, u.owner, [u.x, u.y, u.z], NAVAL_WEAPONS[weapon].fire, NAVAL_WEAPONS[weapon].splash);
        this.fx({ k: "blast", x: u.x, y: u.y, z: u.z, ship: hitShip.team, part, weapon });
        this.ns.units.delete(uid);
        this.units.delete(uid);
        if (u.kind === "plane") this.downUnit(uid, "");
        continue;
      }
      const underwater = u.kind === "torpedo" || u.kind === "gtorpedo";
      if ((underwater && ground > TORPEDO_DEPTH + 0.5) || (!underwater && (u.y < Math.max(0.3, ground + 0.5)))) {
        if (u.kind === "plane") this.fx({ k: "splash", x: u.x, y: 0, z: u.z, weapon: "plane" });
        if (u.kind === "missile") this.impact("missile", u.owner, u.team, [u.x, Math.max(0, ground), u.z], null, "");
        else if (underwater) this.fx({ k: "blast", x: u.x, y: 0, z: u.z, weapon: u.kind });
        this.downUnit(uid, "");
        continue;
      }
      // Máy bay bay sát tàu mẹ, thấp: nạp lại bom.
      if (u.kind === "plane") {
        const home = this.ship(u.ship);
        if (home && u.bombs < JET.bombs && Math.hypot(u.x - home.x, u.z - home.z) < JET.rearm && u.y < 70) u.bombs = JET.bombs;
      }
    }
  }

  private botOwner(u: NavalUnitState): boolean {
    const p = this.room.state.players.get(u.owner);
    return !!p && p.alive && p.bot;
  }

  /** Đơn vị do server lái (ngư lôi thẳng, đơn vị của máy, đơn vị bị mồi nhử lừa). */
  private stepUnit(uid: string, u: NavalUnitState, d: UnitData, dt: number) {
    const pose: UnitPose = { x: u.x, y: u.y, z: u.z, yaw: u.yaw, pitch: u.pitch, roll: u.roll, speed: u.speed };
    // Mồi nhử: tên lửa, ngư lôi dẫn đường lao về mồi nhử gần nhất.
    for (const dec of this.ns.units.values()) {
      if (dec.kind !== "decoy" || dec.team === u.team) continue;
      if ((u.kind === "missile" || u.kind === "gtorpedo") && Math.hypot(dec.x - u.x, dec.z - u.z) < 320) {
        d.wantYaw = Math.atan2(dec.x - u.x, dec.z - u.z);
        d.wantPitch = Math.atan2(dec.y - u.y, Math.hypot(dec.x - u.x, dec.z - u.z));
        if (Math.hypot(dec.x - u.x, dec.y - u.y, dec.z - u.z) < 8) d.life = 0;
      }
    }
    let next: UnitPose;
    if (u.kind === "missile") next = navalMissileStep(pose, d.wantYaw, d.wantPitch, dt);
    else if (u.kind === "torpedo" || u.kind === "gtorpedo") next = torpedoStep(pose, d.wantYaw, u.kind === "gtorpedo", dt);
    else next = jetStep(pose, d.wantYaw, d.wantPitch, d.throttle, dt);
    void uid;
    u.x = next.x;
    u.y = next.y;
    u.z = next.z;
    u.yaw = next.yaw;
    u.pitch = next.pitch;
    u.roll = next.roll;
    u.speed = next.speed;
  }

  private tickRespawn(dt: number) {
    for (const [id, p] of this.room.state.players) {
      if (p.alive || (p.team !== "blue" && p.team !== "red")) continue;
      const ship = this.ship(p.team);
      if (!ship || ship.sunk) continue;
      p.respawn -= dt;
      if (p.respawn > 0) continue;
      this.equip(p);
      this.spawnOnShip(id, p, p.bot);
      this.room.updateAliveCount();
    }
  }

  // -------------------------------------------------------------------------- máy (bot)

  private brain(id: string): BotBrain {
    let b = this.brains.get(id);
    if (!b) {
      b = { local: [0, 0, 0], busy: 0, aimErr: 0, next: 0, unit: "", zig: Math.random() * 10, seenX: NaN, seenZ: NaN };
      this.brains.set(id, b);
    }
    return b;
  }

  /** Máy vào lại vị trí của mình (bỏ trạng thái đi dập lửa). */
  private botMan(id: string, p: PlayerState) {
    const ship = this.ship(p.team);
    if (!ship || ship.sunk) return;
    const k = Math.max(0, Math.min(2, Number(p.role) || 0));
    const occ = ship.crew.get(String(k));
    if (occ && occ !== id) {
      const q = this.room.state.players.get(occ);
      if (q && q.alive && parseSeat(q.vehicle)) return;
    }
    this.brains.delete(id);
    this.man(id, p, ship, k);
  }

  private enemyOf(side: string): ShipState | undefined {
    return this.ship(side === "blue" ? "red" : "blue");
  }

  private tickBots(dt: number) {
    for (const [id, p] of this.room.state.players) {
      if (!p.bot || !p.alive) continue;
      const ship = this.ship(p.team);
      if (!ship || ship.sunk) continue;
      const enemy = this.enemyOf(p.team);
      const seat = this.seatOf(p);
      const b = this.brain(id);
      if (!seat) {
        this.botFireFight(id, p, ship, b, dt);
        continue;
      }
      const cls = this.cls(ship);
      const role = cls.roles[seat.station]!;
      if (role.helm) this.botHelm(ship, cls, enemy, b, dt);
      if (!enemy || enemy.sunk) continue;
      b.next -= dt;
      for (const w of role.weapons) this.botWeapon(id, p, ship, cls, enemy, w, b, dt);
      // Tàu đang cháy: người rảnh đi dập lửa (trừ người lái, phi công). Phòng không đi ngay khi trời không có máy bay,
      // tên lửa địch; pháo thủ, sĩ quan ngư lôi khi lửa nhiều hay vũ khí của mình hỏng hết.
      if (!role.helm && role.role !== "pilot" && ship.fires.size && !ship.dive) {
        const usable = role.weapons.some((w) => cls.parts.some((q) => q.mount?.weapon === w && this.partOk(ship, q.id)));
        const big = [...ship.fires.values()].some((v) => v > 55);
        const air = [...this.ns.units.values()].some((u) => u.team !== ship.team && (u.kind === "plane" || u.kind === "missile") && Math.hypot(u.x - ship.x, u.z - ship.z) < 800);
        const go = !usable || (role.role === "aa" ? !air : ship.fires.size >= 3 || (big && ship.fires.size >= 2));
        if (go) {
          this.leaveStation(id, p);
          const st = role.station;
          b.local = [st[0], st[1], st[2]];
          b.busy = 0;
        }
      }
    }
  }

  private botFireFight(id: string, p: PlayerState, ship: ShipState, b: BotBrain, dt: number) {
    const cls = this.cls(ship);
    if (!ship.fires.size || ship.dive) {
      this.botMan(id, p);
      return;
    }
    let target: ShipPart | null = null;
    let bestD = Infinity;
    for (const pid of ship.fires.keys()) {
      const part = cls.parts.find((q) => q.id === pid);
      if (!part) continue;
      const fp = firePoint(cls, part);
      const d = Math.hypot(fp[0] - b.local[0], fp[2] - b.local[2]);
      if (d < bestD) {
        bestD = d;
        target = part;
      }
    }
    if (!target) return this.botMan(id, p);
    const fp = firePoint(cls, target);
    // Đứng cách đám cháy một bước, đi thẳng trên mặt sàn.
    const dx = fp[0] - b.local[0];
    const dz = fp[2] - b.local[2] - 1.5;
    const d = Math.hypot(dx, dz);
    if (d > 1.2) {
      const step = Math.min(d, BOT_WALK * dt);
      const nx = b.local[0] + (dx / d) * step;
      const nz = b.local[2] + (dz / d) * step;
      const floor = deckBelow(cls, nx, Math.max(b.local[1], fp[1]) + 2, nz);
      b.local = [nx, Number.isFinite(floor) ? floor : b.local[1], nz];
      p.rotY = ship.rotY + Math.atan2(dx, dz);
      p.moving = true;
    } else {
      p.moving = false;
      this.douse(id, p);
    }
  }

  /** Lái tàu: giữ cự ly ưa thích, quay mạn về phía địch, tránh đảo, mép bản đồ, lách ngư lôi; tàu ngầm lặn khi gần địch. */
  private botHelm(ship: ShipState, cls: ShipClass, enemy: ShipState | undefined, b: BotBrain, dt: number) {
    b.zig += dt;
    const prefer = { battleship: 750, carrier: 1100, cruiser: 850, destroyer: 520, submarine: 380 }[cls.id];
    let throttle = 0.6;
    let wantYaw = ship.rotY;
    if (enemy && !enemy.sunk && !this.sees(ship, enemy)) {
      // Mất dấu tàu ngầm: tàu khu trục lùng về chỗ thấy lần cuối, tàu khác chạy chữ chi chậm quanh đó.
      if (!Number.isFinite(b.seenX)) {
        b.seenX = enemy.x + (Math.random() - 0.5) * 300;
        b.seenZ = enemy.z + (Math.random() - 0.5) * 300;
      }
      const d = Math.hypot(b.seenX - ship.x, b.seenZ - ship.z);
      wantYaw = Math.atan2(b.seenX - ship.x, b.seenZ - ship.z) + Math.sin(b.zig * 0.25) * 0.7;
      throttle = cls.id === "destroyer" ? 0.9 : 0.45;
      if (d < 120) {
        b.seenX = ship.x + (Math.random() - 0.5) * 600;
        b.seenZ = ship.z + (Math.random() - 0.5) * 600;
      }
    } else if (enemy && !enemy.sunk) {
      b.seenX = enemy.x;
      b.seenZ = enemy.z;
      const dx = enemy.x - ship.x;
      const dz = enemy.z - ship.z;
      const d = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      if (d > prefer + 120) {
        wantYaw = bearing + Math.sin(b.zig * 0.15) * 0.25;
        throttle = 1;
      } else if (d < prefer - 150 && cls.id !== "submarine") {
        wantYaw = bearing + Math.PI;
        throttle = 0.9;
      } else {
        // Quay mạn: giữ địch ở ngang mạn (bên nào gần hướng hiện tại hơn).
        const left = bearing + Math.PI / 2;
        const right = bearing - Math.PI / 2;
        wantYaw = Math.abs(wrap(left - ship.rotY)) < Math.abs(wrap(right - ship.rotY)) ? left : right;
        wantYaw += Math.sin(b.zig * 0.2) * 0.3;
        throttle = 0.75;
      }
      if (cls.id === "submarine") ship.dive = ship.air > 25 && d < 1100 ? true : ship.air < 12 ? false : ship.dive;
      // Tàu khu trục săn tàu ngầm đang lặn: chạy thẳng qua đầu nó (đón đầu) để thả bom chìm.
      if (cls.id === "destroyer" && this.submerged(enemy) && d < SONAR) {
        const t = d / Math.max(4, ship.speed + 2);
        wantYaw = Math.atan2(enemy.x + Math.sin(enemy.rotY) * enemy.speed * t - ship.x, enemy.z + Math.cos(enemy.rotY) * enemy.speed * t - ship.z);
        throttle = 1;
      }
    }
    // Lách ngư lôi địch đang lao tới.
    for (const u of this.ns.units.values()) {
      if (u.team === ship.team || (u.kind !== "torpedo" && u.kind !== "gtorpedo")) continue;
      const dist = Math.hypot(u.x - ship.x, u.z - ship.z);
      if (dist > 280) continue;
      const toShip = Math.atan2(ship.x - u.x, ship.z - u.z);
      if (Math.abs(wrap(toShip - u.yaw)) < 0.5) {
        wantYaw = u.yaw + (wrap(ship.rotY - u.yaw) > 0 ? 0.15 : -0.15);
        throttle = 1;
      }
    }
    // Tránh đảo, mép bản đồ: dò trước 160 m; vướng thì bẻ sang phía trống.
    const map = this.room.map;
    const probe = (yaw: number, dist: number) => shipAground(cls, map, ship.x + Math.sin(yaw) * dist, ship.z + Math.cos(yaw) * dist, yaw);
    if (probe(ship.rotY, 120) || probe(wantYaw, 160)) {
      for (const off of [0.6, -0.6, 1.2, -1.2, 2, -2]) {
        if (!probe(ship.rotY + off, 140)) {
          wantYaw = ship.rotY + off;
          break;
        }
      }
    }
    const err = wrap(wantYaw - ship.rotY);
    const rudder = Math.max(-1, Math.min(1, -err * 3));
    this.helm.set(ship.team, { throttle, rudder });
  }

  private botWeapon(id: string, p: PlayerState, ship: ShipState, cls: ShipClass, enemy: ShipState, w: NavalWeaponId, b: BotBrain, dt: number) {
    const pose = this.pose(ship);
    const ep = this.pose(enemy);
    const ecls = this.cls(enemy);
    const range = Math.hypot(enemy.x - ship.x, enemy.z - ship.z);
    const lead = (t: number): [number, number] => [enemy.x + Math.sin(enemy.rotY) * enemy.speed * t, enemy.z + Math.cos(enemy.rotY) * enemy.speed * t];
    const hidden = !this.sees(ship, enemy);
    switch (w) {
      case "bbGun":
      case "ddGun": {
        if (hidden || b.next > 0) return;
        const spec = NAVAL_WEAPONS[w];
        if (range > spec.range) return;
        let [tx, tz] = [enemy.x, enemy.z];
        for (let k = 0; k < 2; k++) {
          const t = range / (spec.speed * 0.92);
          [tx, tz] = lead(t);
        }
        // Sai số ngắm giảm dần qua từng loạt (canh chỉnh pháo).
        b.aimErr = b.aimErr > 0 ? Math.max(0.4, b.aimErr * 0.75) : 1;
        const err = range * 0.035 * b.aimErr;
        tx += (Math.random() - 0.5) * err * 2;
        tz += (Math.random() - 0.5) * err * 2;
        ship.aimX = tx;
        ship.aimZ = tz;
        this.salvo(id, ship, w, tx, tz);
        b.next = 1;
        return;
      }
      case "aa": {
        // Mục tiêu gần nhất: máy bay, tên lửa địch trong tầm.
        let best: NavalUnitState | null = null;
        let bestD = NAVAL_WEAPONS.aa.range;
        for (const u of this.ns.units.values()) {
          if (u.team === ship.team || (u.kind !== "missile" && u.kind !== "plane")) continue;
          const d = Math.hypot(u.x - ship.x, u.y - 10, u.z - ship.z);
          if (d < bestD) {
            bestD = d;
            best = u;
          }
        }
        if (!best) {
          // Trời yên: quét boong tàu địch trong tầm (lính trên boong, xước vỏ, có khi gây cháy).
          if (hidden || range > 640) return;
          const aim = shipToWorld(ep, 0, ecls.deck + 1.5, (Math.random() - 0.5) * ecls.length * 0.6);
          const oy = cls.deck + 4;
          ship.aaYaw = Math.atan2(aim[0] - ship.x, aim[2] - ship.z) + (Math.random() - 0.5) * 0.02;
          ship.aaPitch = Math.atan2(aim[1] - oy, range) + (Math.random() - 0.5) * 0.01;
          this.aaVolley(id, ship);
          return;
        }
        const t = bestD / NAVAL_WEAPONS.aa.speed;
        const cp = Math.cos(best.pitch);
        const tx = best.x + Math.sin(best.yaw) * cp * best.speed * t;
        const ty = best.y + Math.sin(best.pitch) * best.speed * t;
        const tz = best.z + Math.cos(best.yaw) * cp * best.speed * t;
        const ox = ship.x;
        const oz = ship.z;
        const oy = cls.deck + 4;
        // Máy ngắm sai nhiều hơn với tên lửa bay sát mặt biển, lượn né (nhỏ, nhanh).
        const noise = best.kind === "missile" ? 0.045 : 0.035;
        ship.aaYaw = Math.atan2(tx - ox, tz - oz) + (Math.random() - 0.5) * noise;
        ship.aaPitch = Math.atan2(ty - oy, Math.hypot(tx - ox, tz - oz)) + (Math.random() - 0.5) * noise;
        this.aaVolley(id, ship);
        b.next = 0.5;
        return;
      }
      case "torpedo": {
        // Tàu ngầm đang lặn sâu hơn đường chạy ngư lôi: bắn ngư lôi vô ích (tàu khu trục dùng bom chìm).
        if (b.next > 0 || range > 820 || hidden || this.submerged(enemy)) return;
        // Ngư lôi bắn đón đầu.
        const [tx, tz] = lead(range / NAVAL_WEAPONS.torpedo.speed);
        const yaw = Math.atan2(tx - ship.x, tz - ship.z);
        const tube = cls.parts.find((q) => q.mount?.weapon === "torpedo" && this.partOk(ship, q.id) && !this.cooling(ship, q.id) && mountCovers(pose, q.mount!, yaw));
        if (!tube) return;
        this.torpedo(id, ship, yaw, false);
        b.next = 6;
        return;
      }
      case "depth": {
        if (enemy.cls !== "submarine") return;
        // Tàu ngầm sắp lọt dưới đuôi tàu (bom chìm chìm mất vài giây: thả sớm một chút).
        const [lx, , lz] = worldToShip(pose, enemy.x, 0, enemy.z);
        if (Math.abs(lx) < 22 && lz < cls.length / 2 && lz > -cls.length / 2 - 30) {
          this.depthCharge(id, ship);
        }
        return;
      }
      case "decoy": {
        const threat = [...this.ns.units.values()].some((u) => u.team !== ship.team && (u.kind === "missile" || u.kind === "gtorpedo") && Math.hypot(u.x - ship.x, u.z - ship.z) < 420);
        if (threat) this.decoy(ship);
        return;
      }
      case "missile":
      case "gtorpedo": {
        const mine = [...this.ns.units.entries()].find(([, u]) => u.owner === id && u.kind === w);
        if (mine) {
          const [uid, u] = mine;
          const data = this.units.get(uid)!;
          const d = Math.hypot(enemy.x - u.x, enemy.z - u.z);
          const t = d / u.speed;
          const [tx, tz] = lead(t);
          // Tên lửa bay sát mặt biển, lượn chữ S né đạn phòng không; gần mục tiêu thì lao thẳng vào thân tàu.
          const weave = w === "missile" && d > 260 ? Math.sin(this.clock * 1.7 + b.zig) * 0.35 : 0;
          data.wantYaw = Math.atan2(tx - u.x, tz - u.z) + weave;
          const cruise = w === "missile" ? (d > 200 ? 5 : ecls.deck * 0.6) : 0;
          data.wantPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(cruise - u.y, Math.max(30, Math.min(d, 120)))));
          return;
        }
        if (b.next > 0 || hidden || range > (w === "missile" ? 1600 : 950)) return;
        if (w === "missile") this.missile(id, ship, Math.atan2(enemy.x - ship.x, enemy.z - ship.z));
        else this.torpedo(id, ship, Math.atan2(enemy.x - ship.x, enemy.z - ship.z), true, Number(p.role) || 1);
        b.next = 4;
        return;
      }
      case "jetGun":
      case "bomb": {
        if (w === "bomb") return;
        this.botPilot(id, ship, enemy, ecls, ep, b, dt);
        return;
      }
    }
  }

  /**
   * Phi công máy: cất cánh, lấy độ cao, vòng ra xa rồi lao vào tàu địch theo đường thẳng (bay thấp 40 m), thả bom đúng
   * lúc điểm rơi dự đoán trùng chỗ tàu địch sẽ tới (đón đầu), vừa lao vừa bắn súng; bay qua rồi kéo lên vòng lại; hết
   * bom thì về sát tàu mẹ nạp.
   */
  private botPilot(id: string, ship: ShipState, enemy: ShipState, ecls: ShipClass, ep: ShipPose, b: BotBrain, dt: number) {
    if (!ship.jet) {
      if (ship.jetWait <= 0 && b.next <= 0) {
        this.launchJet(id, ship);
        b.next = 3;
        b.busy = 0;
      }
      return;
    }
    const u = this.ns.units.get(ship.jet);
    const d = u && this.units.get(ship.jet);
    if (!u || !d) return;
    d.bot = true;
    d.throttle = 0.5;
    const cp = Math.cos(u.pitch);
    const vh = u.speed * cp;
    // Bom thả lúc này rơi chừng T giây (từ độ cao hiện tại xuống mặt boong địch).
    const vy = Math.sin(u.pitch) * u.speed;
    const h = Math.max(1, u.y - ecls.deck);
    const T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * h)) / 9.81;
    const lead = (t: number): [number, number] => [ep.x + Math.sin(ep.rotY) * enemy.speed * t, ep.z + Math.cos(ep.rotY) * enemy.speed * t];
    const [lx, lz] = lead(T);
    const dist = Math.hypot(lx - u.x, lz - u.z);
    const headTo = Math.atan2(lx - u.x, lz - u.z);
    let wantY = 95;
    let wantYaw = headTo;
    // b.busy: 0 lao vào, 1 bay qua kéo lên (đếm giây).
    if (u.bombs === 0) {
      wantYaw = Math.atan2(ship.x - u.x, ship.z - u.z);
      wantY = 45;
    } else if (b.busy > 0) {
      b.busy -= dt;
      wantYaw = u.yaw;
      wantY = 110;
    } else if (dist < 900) {
      wantY = dist > 420 ? 70 : 40;
      const err = Math.abs(wrap(headTo - u.yaw));
      if (dist < 520 && err < 0.12 && this.clock - (this.aaAt.get(ship.jet) ?? -1) > 0.08) this.jetGun(id);
      // Điểm rơi dự đoán nếu thả ngay: phía trước máy bay vh·T mét.
      const ix = u.x + Math.sin(u.yaw) * vh * T;
      const iz = u.z + Math.cos(u.yaw) * vh * T;
      const [elx, , elz] = worldToShip({ x: lx, y: 0, z: lz, rotY: ep.rotY }, ix, 0, iz);
      if (err < 0.1 && Math.abs(elx) < ecls.beam / 2 + 3 && Math.abs(elz) < ecls.length / 2) {
        this.bomb(id);
        if (u.bombs === 0) b.busy = 6;
      }
      // Lỡ đà (đã bay qua mục tiêu): kéo lên vòng lại.
      if (dist < 60) b.busy = 5;
    }
    d.wantYaw = wantYaw;
    d.wantPitch = Math.max(-0.45, Math.min(0.5, Math.atan2(wantY - u.y, 200)));
    // Tránh đâm xuống biển.
    if (u.y < 22) d.wantPitch = 0.45;
  }
}

function dist3(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Khoảng cách từ điểm tới đoạn thẳng (3 chiều). */
function segPointDist(a: readonly number[], b: readonly number[], p: readonly number[]): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const ap = [p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!];
  const l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (ab[0]! * ap[0]! + ab[1]! * ap[1]! + ab[2]! * ap[2]!) / l2));
  return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t);
}

export const NAVAL_SIDES = SIDES;
export type { ShipMount };
