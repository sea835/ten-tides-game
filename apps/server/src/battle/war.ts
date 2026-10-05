import { MAX_HP, ROLES, WAR_BASES, WATER_LEVEL, WEAPON, floorBelow, insideBox, warSquadLeader, type SquadRole } from "@tentides/content";
import { FlagState, Messages, WAR_TICKETS_DEFAULT, type CorrectMessage, type PlayerState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { addAmmo, ammoOf, receive, resetKit, weaponIn } from "./kit.ts";
import { awardXp } from "./xp.ts";

// Chiến trường 50 vs 50: phe Xanh (căn cứ phía tây) đấu phe Đỏ (phía đông). Mỗi phe có số vé quân; mỗi người gục
// mất một vé; phe giữ quá 4/7 cứ điểm thì cứ 3 giây đối phương mất thêm một vé. Đứng trong vùng một cứ điểm mà không
// có địch thì chiếm dần (đông người chiếm nhanh hơn), có cả hai phe thì giằng co. Gục rồi thì chờ vài giây, chọn lớp
// lính và chỗ hồi sinh (căn cứ, cứ điểm phe mình giữ, hay cạnh đội trưởng tổ mình). Đứng cạnh hòm đạn dã chiến (Kho
// Quân Nhu, căn cứ) thì được tiếp đạn. Mỗi phe ba xe tăng ở căn cứ, xe nổ thì một lúc sau có xe mới.
// Hết vé là thua.

export type Side = "blue" | "red";
export const SIDES: readonly Side[] = ["blue", "red"];
/** Vé quân lúc đầu mỗi phe (mặc định; chủ phòng chỉnh qua `state.warTickets`), thời gian chờ hồi sinh, nhịp trừ vé theo cứ điểm (giây). */
export const WAR_TICKETS = WAR_TICKETS_DEFAULT;
export const RESPAWN_SECONDS = 8;
const BLEED_EVERY = 3;
/** Giữ quá phần này số cứ điểm (4/7) thì đối phương bị trừ vé dần. */
const BLEED_SHARE = 4 / 7;
/** Hòm đạn dã chiến: bán kính đứng cạnh, thời gian chờ giữa hai lần tiếp đạn (giây). */
const SUPPLY_RADIUS = 3.5;
const SUPPLY_COOLDOWN = 15;
/** Chờ quá chừng này giây (sau khi được hồi sinh) mà chưa chọn chỗ thì tự hồi sinh ở căn cứ. */
const AUTO_RESPAWN = 10;
/** Tốc độ chiếm cứ điểm: phần tiến độ mỗi giây cho mỗi người (tối đa 4 người tính). */
const CAPTURE_RATE = 0.045;
const TANKS_PER_SIDE = 3;
const TANK_RESPAWN = 45;
/** Màu băng tay mỗi phe. */
export const SIDE_COLOR: Record<Side, string> = { blue: "#2f6bff", red: "#e0332b" };

/** Lớp lính của máy: cứ 10 máy thì 5 súng trường, 1 bắn tỉa, 2 súng máy, 2 chống tăng (lái tăng tính riêng). */
const BOT_ROLES: readonly SquadRole[] = ["rifle", "rifle", "antitank", "support", "rifle", "sniper", "rifle", "antitank", "support", "rifle"];

/** Người đứng trong vùng cứ điểm (tính chiếm cứ điểm). */
export function inFlag(f: FlagState, p: PlayerState): boolean {
  return Math.hypot(p.x - f.x, p.z - f.z) <= f.r && Math.abs(p.y - f.y) <= 12;
}

export class War {
  private bleed = 0;
  private tankTimer: Record<Side, number> = { blue: 0, red: 0 };
  /** Người chơi đã tự chọn lớp lính gần nhất (để tự hồi sinh). */
  private lastRole = new Map<string, SquadRole>();
  /** Lần tiếp đạn kế tiếp được phép của từng người (giây theo đồng hồ trận), nhịp dò hòm đạn. */
  private supplyAt = new Map<string, number>();
  private clock = 0;
  private supplyScan = 0;

  constructor(private readonly room: BattleRoom) {}

  /** Phe người chơi đang ở (người chưa chọn thì chia đều). */
  private sideCounts(): Record<Side, number> {
    const c = { blue: 0, red: 0 };
    for (const p of this.room.state.players.values()) if (!p.bot && (p.team === "blue" || p.team === "red")) c[p.team]++;
    return c;
  }

  /** Ở sảnh: người chơi chọn phe (hay tự chia khi vào phòng). */
  pickSide(id: string, side: Side) {
    const p = this.room.state.players.get(id);
    if (!p) return;
    p.team = side;
    p.color = SIDE_COLOR[side];
  }

  /** Người mới vào: cho vào phe ít người hơn. */
  assign(id: string) {
    const p = this.room.state.players.get(id);
    if (!p || p.team === "blue" || p.team === "red") return;
    const c = this.sideCounts();
    this.pickSide(id, c.blue <= c.red ? "blue" : "red");
  }

  /** Bắt đầu trận: chia phe, thêm máy cho đủ mỗi phe `perSide` người, dựng cứ điểm, vé quân, xe tăng. */
  start(perSide: number) {
    const s = this.room.state;
    const humans = [...s.players.entries()].filter(([, p]) => !p.bot);
    for (const [id] of humans) this.assign(id);
    const c = this.sideCounts();
    // Tắt xe cơ giới: không có máy lái tăng, không đặt xe.
    const tanks = s.settings.vehiclesEnabled ? TANKS_PER_SIDE : 0;
    this.room.bots.buildWar(Math.max(0, perSide - c.blue), Math.max(0, perSide - c.red), BOT_ROLES, tanks);
    for (const p of s.players.values()) {
      if (p.team !== "blue" && p.team !== "red") continue;
      p.color = SIDE_COLOR[p.team];
    }
    s.flags.clear();
    for (const f of this.room.map.flags ?? []) {
      const fs = new FlagState();
      fs.name = f.name;
      fs.x = f.x;
      fs.y = f.y;
      fs.z = f.z;
      fs.r = f.r;
      s.flags.set(f.id, fs);
    }
    s.ticketsBlue = s.settings.warTickets || WAR_TICKETS;
    s.ticketsRed = s.settings.warTickets || WAR_TICKETS;
    this.bleed = 0;
    this.clock = 0;
    this.supplyAt.clear();
    this.tankTimer = { blue: 0, red: 0 };
    // Vùng an toàn không dùng: phủ cả bản đồ.
    s.zone.x = s.zone.nx = 0;
    s.zone.z = s.zone.nz = 0;
    s.zone.r = s.zone.nr = 2000;
    s.zone.dps = 0;
    // Xe tăng đậu ở căn cứ; máy lái tăng ngồi sẵn.
    for (const side of SIDES) for (let k = 0; k < tanks; k++) this.spawnTank(side);
    // Xe trinh sát ở căn cứ, thuyền tuần tra neo ngoài bờ biển.
    this.room.vehicles.fleet.setup();
    for (const [id, p] of s.players) {
      p.respawn = 0;
      this.place(id, p, "hq");
      this.equip(p, (p.bot ? (p.role as SquadRole) : this.lastRole.get(id)) || "rifle");
    }
    this.seatTankers();
  }

  /** Chỗ hồi sinh: quanh căn cứ (phía trận địa) hay quanh một cứ điểm phe mình giữ. */
  private spawnPoint(side: Side, at: string): { x: number; z: number } {
    const map = this.room.map;
    const rand = Math.random;
    let cx: number;
    let cz: number;
    let r0: number;
    let r1: number;
    const flag = at !== "hq" ? this.room.state.flags.get(at) : undefined;
    if (flag && flag.owner === side) {
      cx = flag.x;
      cz = flag.z;
      r0 = flag.r * 0.4;
      r1 = flag.r + 6;
    } else {
      const base = WAR_BASES[side];
      // Trước cổng căn cứ, hướng về giữa bản đồ.
      cx = base.x + Math.sign(-base.x) * 38;
      cz = base.z;
      r0 = 2;
      r1 = 16;
    }
    for (let tries = 0; tries < 30; tries++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = map.world.heightAt(x, z);
      if (h < WATER_LEVEL + 0.8 || insideBox(map.index, x, h + 1, z, 0.5)) continue;
      return { x, z };
    }
    return { x: cx, z: cz };
  }

  /** Đội trưởng tổ của người này (cùng phe, còn sống, không phải chính mình), hay undefined. */
  leaderOf(id: string): PlayerState | undefined {
    const s = this.room.state;
    const p = s.players.get(id);
    const lid = warSquadLeader(s.players.entries(), id);
    const leader = lid && lid !== id ? s.players.get(lid) : undefined;
    return p && leader && leader.alive && leader.team === p.team ? leader : undefined;
  }

  /** Chỗ hồi sinh cạnh đội trưởng: cùng tầng với đội trưởng (trên sàn nhà, mặt cầu…), không kẹt tường, không dưới nước. */
  private besideLeader(id: string): { x: number; y: number; z: number } | null {
    const leader = this.leaderOf(id);
    if (!leader) return null;
    const map = this.room.map;
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = (leader.vehicle ? 4.5 : 1.8) + Math.random() * 3;
      const x = leader.x + Math.cos(a) * r;
      const z = leader.z + Math.sin(a) * r;
      const y = floorBelow(map, x, leader.y + 1.2, z);
      if (Math.abs(y - leader.y) > 1.5 || y < WATER_LEVEL + 0.3 || insideBox(map.index, x, y + 1, z, 0.4)) continue;
      return { x, y, z };
    }
    return null;
  }

  private place(id: string, p: PlayerState, at: string) {
    const side = p.team as Side;
    const lead = at === "lead" ? this.besideLeader(id) : null;
    const pt = lead ?? this.spawnPoint(side, at === "lead" ? "hq" : at);
    p.x = pt.x;
    p.z = pt.z;
    p.y = lead ? lead.y + 0.05 : this.room.map.world.heightAt(pt.x, pt.z) + 0.05;
    p.rotY = side === "blue" ? Math.PI / 2 : -Math.PI / 2;
    this.room.clientOf(id)?.send(Messages.correct, { x: p.x, y: p.y, z: p.z } satisfies CorrectMessage);
  }

  /** Đồ theo lớp lính: súng chính, ống ngắm, súng lục, giáp mũ cấp 2, lựu đạn, băng gạc (tiền giữ nguyên). */
  equip(p: PlayerState, role: SquadRole) {
    const money = p.kit.money;
    const outfit = p.kit.outfit;
    resetKit(p.kit, money);
    p.kit.outfit = role === "sniper" ? "ghillie" : outfit === "ghillie" ? "woodland" : outfit;
    const spec = ROLES[role];
    const gun = spec.guns[Math.floor(Math.random() * spec.guns.length)]!;
    const def = WEAPON.get(gun)!;
    receive(p.kit, gun, []);
    addAmmo(p.kit, def.ammo, def.mag * (def.class === "lmg" ? 2 : 4));
    if (spec.sight) receive(p.kit, `sight:${spec.sight}`, []);
    receive(p.kit, "p92", []);
    addAmmo(p.kit, "9mm", 30);
    receive(p.kit, "armor:2", []);
    receive(p.kit, "helmet:2", []);
    for (const extra of spec.extras) receive(p.kit, extra, []);
    p.kit.active = "primary1";
    p.role = role;
    p.hp = MAX_HP;
    p.maxHp = MAX_HP;
    p.alive = true;
    p.crouching = p.prone = p.aiming = false;
    p.vehicle = "";
  }

  /** Gục: mất một vé, chờ hồi sinh. */
  onDeath(id: string) {
    const s = this.room.state;
    const p = s.players.get(id);
    if (!p) return;
    if (p.team === "blue") s.ticketsBlue = Math.max(0, s.ticketsBlue - 1);
    else if (p.team === "red") s.ticketsRed = Math.max(0, s.ticketsRed - 1);
    p.respawn = RESPAWN_SECONDS;
    this.room.bots.forget(id);
  }

  /** Người chơi chọn chỗ và lớp lính để hồi sinh (khi đã hết giờ chờ). */
  respawn(id: string, at: string, role: SquadRole) {
    const s = this.room.state;
    const p = s.players.get(id);
    if (!p || p.alive || p.respawn > 0 || s.phase !== "battle" && s.phase !== "prep") return;
    this.lastRole.set(id, role);
    p.respawn = 0;
    const flag = at !== "hq" ? s.flags.get(at) : undefined;
    this.equip(p, role);
    // Cạnh đội trưởng (đội trưởng gục rồi thì về căn cứ), cứ điểm phe mình đang giữ, hay căn cứ.
    this.place(id, p, at === "lead" ? "lead" : flag && flag.owner === p.team ? at : "hq");
    // Lớp lái tăng: có xe trống ở căn cứ thì ngồi luôn.
    if (role === "tanker") this.seatIn(id, p);
    this.room.updateAliveCount();
  }

  /** Chỗ hồi sinh tốt nhất cho máy: cứ điểm phe mình gần cứ điểm chưa chiếm nhất (tiền tuyến), không thì căn cứ. */
  private frontSpawn(side: Side): string {
    const s = this.room.state;
    const owned = [...s.flags.entries()].filter(([, f]) => f.owner === side && (side === "blue" ? f.red : f.blue) === 0);
    const targets = [...s.flags.values()].filter((f) => f.owner !== side);
    if (!owned.length || Math.random() < 0.3) return "hq";
    let best = "hq";
    let bestD = Infinity;
    for (const [id, f] of owned) {
      const d = targets.length ? Math.min(...targets.map((t) => Math.hypot(t.x - f.x, t.z - f.z))) : Math.random() * 100;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Đứng cạnh hòm đạn dã chiến: nạp lại đạn dự trữ cho súng chính (tối đa vài băng), mỗi người cách nhau ít giây. */
  private resupply() {
    const supplies = this.room.map.supplies ?? [];
    if (!supplies.length) return;
    for (const [id, p] of this.room.state.players) {
      if (!p.alive || p.vehicle || (this.supplyAt.get(id) ?? 0) > this.clock) continue;
      if (!supplies.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < SUPPLY_RADIUS && Math.abs(c.y - p.y) < 3)) continue;
      let gave = false;
      for (const slot of ["primary1", "primary2"] as const) {
        const def = weaponIn(p.kit, slot);
        if (!def) continue;
        const want = def.mag * (def.class === "lmg" ? 2 : 4);
        const have = ammoOf(p.kit, def.ammo);
        if (have >= want) continue;
        addAmmo(p.kit, def.ammo, want - have);
        gave = true;
      }
      if (gave) this.supplyAt.set(id, this.clock + SUPPLY_COOLDOWN);
    }
  }

  private spawnTank(side: Side) {
    const base = WAR_BASES[side];
    const out = Math.sign(-base.x);
    const spot = this.room.vehicles.findSpot(base.x + out * 44, base.z, 0, 22, Math.random) ?? this.room.vehicles.findSpot(base.x + out * 60, base.z, 0, 40, Math.random);
    if (!spot) return;
    this.room.vehicles.spawn(spot.x, spot.z, out > 0 ? Math.PI / 2 : -Math.PI / 2, side);
  }

  /** Người lái tăng (máy) đang ở căn cứ mà có xe trống thì lên xe. */
  private seatTankers() {
    for (const [id, p] of this.room.state.players) if (p.bot && p.alive && p.role === "tanker" && !p.vehicle) this.seatIn(id, p);
  }

  private seatIn(id: string, p: PlayerState) {
    for (const [vid, v] of this.room.state.vehicles) {
      if (v.hp <= 0 || v.driver || v.team !== p.team || v.kind !== "tank") continue;
      if (Math.hypot(v.x - p.x, v.z - p.z) > 90) continue;
      this.room.vehicles.board(id, vid);
      return;
    }
  }

  /** Chiếm xong cứ điểm: ai phe mình còn sống đứng trong vùng đều được XP chiếm cứ điểm. */
  private creditCapture(f: FlagState, side: Side) {
    for (const [id, p] of this.room.state.players) {
      if (p.alive && p.team === side && inFlag(f, p)) awardXp(id, "capture");
    }
  }

  tick(dt: number) {
    const s = this.room.state;
    if (s.phase !== "battle" && s.phase !== "prep") return;
    // Hồi sinh: máy tự hồi sinh ở tiền tuyến; người chơi chọn, chờ lâu quá thì tự về căn cứ.
    for (const [id, p] of s.players) {
      if (p.alive) continue;
      if (p.team !== "blue" && p.team !== "red") continue;
      p.respawn -= dt;
      if (p.respawn > 0) continue;
      if (p.bot) {
        const role = (p.role as SquadRole) || "rifle";
        this.equip(p, role);
        this.place(id, p, role === "tanker" ? "hq" : this.frontSpawn(p.team as Side));
        if (role === "tanker") this.seatIn(id, p);
        p.respawn = 0;
        this.room.updateAliveCount();
      } else if (p.respawn < -AUTO_RESPAWN) {
        p.respawn = 0;
        this.respawn(id, "hq", this.lastRole.get(id) ?? "rifle");
      } else p.respawn = Math.max(-AUTO_RESPAWN - 1, p.respawn);
    }
    if (s.phase !== "battle") return;
    // Chiếm cứ điểm.
    for (const f of s.flags.values()) {
      let blue = 0;
      let red = 0;
      for (const p of s.players.values()) {
        if (!p.alive) continue;
        if (!inFlag(f, p)) continue;
        if (p.team === "blue") blue++;
        else if (p.team === "red") red++;
      }
      f.blue = Math.min(255, blue);
      f.red = Math.min(255, red);
      if (blue && red) continue;
      const push = (Math.min(4, blue) - Math.min(4, red)) * CAPTURE_RATE * dt;
      if (!push) continue;
      const before = f.progress;
      f.progress = Math.max(-1, Math.min(1, f.progress + push));
      // Qua mốc 0 là mất cứ điểm (thành trung lập); chạm ±1 là chiếm xong.
      if (f.owner === "blue" && f.progress < 0 && before >= 0) f.owner = "";
      if (f.owner === "red" && f.progress > 0 && before <= 0) f.owner = "";
      if (f.progress >= 1 && f.owner !== "blue") {
        f.owner = "blue";
        this.room.broadcastFlag(f.name, "blue");
        this.creditCapture(f, "blue");
      }
      if (f.progress <= -1 && f.owner !== "red") {
        f.owner = "red";
        this.room.broadcastFlag(f.name, "red");
        this.creditCapture(f, "red");
      }
    }
    // Phe giữ quá 4/7 cứ điểm: cứ 3 giây đối phương mất một vé.
    this.bleed += dt;
    if (this.bleed >= BLEED_EVERY) {
      this.bleed -= BLEED_EVERY;
      const drain = bleedOf(s.flags.values());
      s.ticketsRed = Math.max(0, s.ticketsRed - drain.red);
      s.ticketsBlue = Math.max(0, s.ticketsBlue - drain.blue);
    }
    this.clock += dt;
    this.supplyScan -= dt;
    if (this.supplyScan <= 0) {
      this.supplyScan = 1;
      this.resupply();
    }
    // Xe tăng: thiếu xe thì một lúc sau có xe mới ở căn cứ (dọn bớt xác xe).
    for (const side of s.settings.vehiclesEnabled ? SIDES : []) {
      const alive = [...s.vehicles.values()].filter((v) => v.kind === "tank" && v.team === side && v.hp > 0).length;
      if (alive >= TANKS_PER_SIDE) {
        this.tankTimer[side] = 0;
        continue;
      }
      this.tankTimer[side] += dt;
      if (this.tankTimer[side] < TANK_RESPAWN) continue;
      this.tankTimer[side] = 0;
      // Xác xe cũ cháy một lúc rồi tự được dọn (vehicles.ts).
      this.spawnTank(side);
      this.seatTankers();
    }
    // Hết vé: thua.
    if (s.ticketsBlue <= 0 || s.ticketsRed <= 0) this.room.endWar(s.ticketsBlue > 0 ? "blue" : "red");
  }
}

/** Số vé mỗi phe bị trừ trong một nhịp trừ vé: phe giữ quá 4/7 số cứ điểm làm đối phương mất một vé. */
export function bleedOf(flags: Iterable<{ owner: string }>): { blue: number; red: number } {
  let blue = 0;
  let red = 0;
  let total = 0;
  for (const f of flags) {
    total++;
    if (f.owner === "blue") blue++;
    else if (f.owner === "red") red++;
  }
  return { red: total && blue > total * BLEED_SHARE ? 1 : 0, blue: total && red > total * BLEED_SHARE ? 1 : 0 };
}
