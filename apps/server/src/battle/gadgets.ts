import {
  ADRENALINE,
  AMMO_BOX,
  AT_MINE,
  CLASSES,
  launcherExtras,
  GADGETS,
  M203,
  REPAIR,
  SANDBAG,
  SPOT,
  WEAPON,
  boxDurability,
  classSight,
  floorBelow,
  insideBox,
  isSoldierClass,
  raycastBoxes,
  raycastTerrain,
  raycastTrunks,
  setDynamicBox,
  vehicleSpec,
  type BattleBox,
  type GadgetId,
  type SoldierClass,
} from "@tentides/content";
import { Messages, PING_TTL_MS, TrapState, type GadgetMessage, type PingBroadcast, type PlayerState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { audience, hostile } from "./comms.ts";
import { GUN_SLOTS, addAmmo, ammoOf, receive, weaponIn } from "./kit.ts";
import { awardXp } from "./xp.ts";

// Khí tài của bốn lớp lính (chiến trường; đội trưởng chế độ Đồng đội). Server kiểm tra mọi lần dùng: đúng lớp, đang
// cầm khí tài đó, còn lượt, hết thời gian chờ, đứng đúng chỗ; rồi mới tác động lên trận:
// - Đột Kích: bơm Adrenaline (chạy nhanh 10 giây, server nới mức kiểm tra tốc độ), phóng lựu M203 (đạn nổ bay cong
//   qua đúng đường đạn nổ của RPG / pháo xe tăng: vehicles.launch → explode → phá tường).
// - Bắn Tỉa: ống nhòm đánh dấu địch / xe địch cho cả phe 15 giây (server dò tầm nhìn từ mắt người nhìn tới mục tiêu).
// - Quân Nhu: hộp tiếp đạn đặt dưới đất (đồng đội đứng gần được nạp đạn, lựu đạn dần; người đặt được XP tiếp tế), bờ
//   bao cát (khối chắn đạn dựng giữa trận trong chỗ trống của bản đồ: đạn, tầm nhìn, nổ đều tính tới, bắn nhiều thì vỡ).
// - Kỹ Thuật: mỏ lết sửa xe phe mình (giữ chuột, client gửi đều đặn; server tính máu theo thời gian thật, XP sửa xe),
//   mìn chống tăng (dùng chung danh sách mìn của phòng, chỉ xe địch cán qua mới nổ).
// Hộp đạn, bao cát nằm trong `state.traps` (TrapState) nên người vào giữa trận cũng thấy.

/** Số chỗ trống cuối danh sách khối dành cho bao cát (cả phòng). */
export const SANDBAG_SLOTS = 48;

interface Deployed {
  kind: "ammobox" | "sandbag";
  owner: string;
  team: string;
  x: number;
  y: number;
  z: number;
  /** Hộp đạn: còn bao lâu, tới nhịp nạp kế tiếp. Bao cát: chỗ trong chỉ mục khối. */
  life: number;
  pulse: number;
  slot: number;
  /** Thứ tự đặt (để dỡ cái cũ nhất khi vượt giới hạn). */
  n: number;
}

export type GadgetSlot = "gadget1" | "gadget2";

export class Gadgets {
  private ready = new Map<string, number>();
  private deployed = new Map<string, Deployed>();
  private seq = 0;
  /** Tiếp tế: lần cuối người đặt hộp được XP nhờ người nhận này (id đặt|id nhận → ms). */
  private xpAt = new Map<string, number>();
  /** Sửa xe: máu đã sửa chưa đổi thành XP, lần gửi gần nhất. */
  private repaired = new Map<string, number>();
  private repairAt = new Map<string, number>();
  /** Đồng hồ (ms); thử nghiệm thay được. */
  now: () => number = () => Date.now();

  constructor(private readonly room: BattleRoom) {}

  /** Dọn hết (đầu trận, về sảnh): hộp đạn, bao cát, thời gian chờ. */
  clear() {
    for (const key of [...this.deployed.keys()]) this.remove(key);
    this.room.state.traps.clear();
    this.ready.clear();
    this.xpAt.clear();
    this.repaired.clear();
    this.repairAt.clear();
  }

  /** Chế độ có lớp lính không (sinh tồn solo thì không). */
  enabled(): boolean {
    return this.room.state.battleMode === "war" || this.room.state.battleMode === "squad";
  }

  /** Gắn lớp lính `cls` cho người `p`: đủ lượt khí tài, hết Adrenaline. Rỗng là bỏ lớp. */
  equip(p: PlayerState, cls: SoldierClass | "") {
    const g = p.gear;
    g.cls = cls;
    g.boost = 0;
    const list = cls ? CLASSES[cls].gadgets : [];
    g.n1 = list[0] ? GADGETS[list[0]].charges : 0;
    g.n2 = list[1] ? GADGETS[list[1]].charges : 0;
  }

  /**
   * Đội trưởng chế độ Đồng đội vào trận với lớp đã chọn ở sảnh: súng, ống ngắm, đạn, đồ kèm và khí tài của lớp (tiền
   * giữ nguyên để mua thêm giáp, đồ ở cửa hàng).
   */
  loadout(p: PlayerState, cls: SoldierClass) {
    const spec = CLASSES[cls];
    const gun = spec.guns[Math.floor(Math.random() * spec.guns.length)]!;
    const def = WEAPON.get(gun)!;
    receive(p.kit, gun, []);
    addAmmo(p.kit, def.ammo, def.mag * (def.class === "lmg" ? 2 : 4));
    receive(p.kit, `sight:${classSight(spec, gun)}`, []);
    for (const extra of launcherExtras(spec.extras, cls === "engineer" && p.gear.aa)) receive(p.kit, extra, []);
    if (spec.outfit) p.kit.outfit = spec.outfit;
    p.kit.active = "primary1";
    this.equip(p, cls);
  }

  /** Khí tài ở ô `slot` của người `p` (rỗng nếu không có lớp, ô trống, hay chế độ không có lớp lính). */
  gadgetOf(p: PlayerState, slot: string): GadgetId | "" {
    if (!this.enabled() || !isSoldierClass(p.gear.cls)) return "";
    const k = slot === "gadget1" ? 0 : slot === "gadget2" ? 1 : -1;
    return k < 0 ? "" : (CLASSES[p.gear.cls].gadgets[k] ?? "");
  }

  /** Còn lượt của khí tài ô `slot` không (khí tài không tính lượt thì luôn còn). */
  hasCharge(p: PlayerState, slot: string): boolean {
    const id = this.gadgetOf(p, slot);
    if (!id) return false;
    if (!GADGETS[id].charges) return true;
    return (slot === "gadget1" ? p.gear.n1 : p.gear.n2) > 0;
  }

  /** Cầm được ô khí tài này không (để đổi món). */
  canHold(p: PlayerState, slot: string): boolean {
    return this.hasCharge(p, slot);
  }

  private consume(p: PlayerState, slot: GadgetSlot) {
    const id = this.gadgetOf(p, slot);
    if (!id || !GADGETS[id].charges) return;
    if (slot === "gadget1") p.gear.n1 = Math.max(0, p.gear.n1 - 1);
    else p.gear.n2 = Math.max(0, p.gear.n2 - 1);
    // Hết lượt: cầm lại súng chính.
    if (!this.hasCharge(p, slot) && p.kit.active === slot) p.kit.active = p.kit.primary1 ? "primary1" : p.kit.pistol ? "pistol" : "";
  }

  /**
   * Người `id` dùng khí tài. Trả về true nếu được chấp nhận (để thử nghiệm). Mọi kiểm tra chung: còn sống, đi bộ,
   * đang trận, đang cầm đúng khí tài đó, còn lượt, hết thời gian chờ.
   */
  use(id: string, m: GadgetMessage): boolean {
    const room = this.room;
    const p = room.state.players.get(id);
    if (!p || !p.alive || p.vehicle || !room.fighting()) return false;
    const slot = p.kit.active;
    if ((slot !== "gadget1" && slot !== "gadget2") || this.gadgetOf(p, slot) !== m.use || !this.hasCharge(p, slot)) return false;
    const now = this.now();
    const key = `${id}|${m.use}`;
    if (now < (this.ready.get(key) ?? 0)) return false;
    const ok = this.apply(id, p, slot, m, now);
    if (!ok) return false;
    this.ready.set(key, now + GADGETS[m.use].cooldown * 1000 * 0.9);
    this.consume(p, slot);
    return true;
  }

  private apply(id: string, p: PlayerState, slot: GadgetSlot, m: GadgetMessage, now: number): boolean {
    switch (m.use) {
      case "syringe":
        p.gear.boost = ADRENALINE.seconds;
        p.act = "inject";
        p.actN = (p.actN + 1) % 65536;
        return true;
      case "m203":
        return this.launch(id, p, m);
      case "binoculars":
        return !!this.spot(id, m.target ?? "");
      case "ammobox":
        return this.placeBox(id, p);
      case "sandbag":
        return this.placeSandbag(id, p);
      case "repair":
        return this.repair(id, p, m.target ?? "", now) > 0;
      case "atmine":
        return this.room.plantMine(id, p.x, p.y, p.z, true);
    }
    void slot;
    return false;
  }

  // -------------------------------------------------------------------------- Đột Kích

  /** M203: đầu nòng phải ở sát người bắn (như súng thường), hướng chuẩn hoá; đạn nổ bay cong theo đường RPG. */
  private launch(id: string, p: PlayerState, m: GadgetMessage): boolean {
    const o = m.o;
    const d = m.d;
    if (!o || !d) return false;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 4 || o[1] < p.y - 1 || o[1] > p.y + 3) return false;
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l < 1e-6) return false;
    p.shots = (p.shots + 1) % 65536;
    this.room.vehicles.launch(id, [o[0], o[1], o[2]], [d[0] / l, d[1] / l, d[2] / l], M203.velocity, { radius: M203.radius, damage: M203.damage, armor: M203.armor }, "m203");
    this.room.bots.onShot(id, p.x, p.z, 90);
    return true;
  }

  // -------------------------------------------------------------------------- Bắn Tỉa

  /**
   * Ống nhòm: mục tiêu (id người, hay "v:<id xe>") phải là địch, còn sống, trong tầm, mắt người nhìn thấy được (không
   * tường, đồi, thân cây che). Được thì báo cả phe một dấu thoi đỏ bám theo mục tiêu 15 giây. Trả về dấu đã gửi.
   */
  spot(id: string, target: string): PingBroadcast | null {
    const s = this.room.state;
    const p = s.players.get(id);
    if (!p || !p.alive || !target) return null;
    let tx: number;
    let ty: number;
    let tz: number;
    let follow = "";
    if (target.startsWith("v:")) {
      const v = s.vehicles.get(target.slice(2));
      if (!v || v.hp <= 0) return null;
      const drv = v.driver ? s.players.get(v.driver) : undefined;
      // Xe địch: có người lái là địch, hay xe của phe kia.
      if (drv ? !hostile(p, drv) : !v.team || v.team === p.team) return null;
      tx = v.x;
      ty = v.y + 1.4;
      tz = v.z;
      follow = v.driver;
    } else {
      const t = s.players.get(target);
      if (!t || !t.alive || target === id || !hostile(p, t)) return null;
      tx = t.x;
      ty = t.y + (t.prone ? 0.3 : t.crouching ? 0.8 : 1.2);
      tz = t.z;
      follow = target;
    }
    if (!this.canSee(p, tx, ty, tz)) return null;
    const out: PingBroadcast = { from: id, name: p.name, kind: "spotted", x: tx, y: ty - 1.2, z: tz, target: follow, ttl: PING_TTL_MS.spotted };
    for (const to of audience(s, id)) this.room.clientOf(to)?.send(Messages.ping, out);
    return out;
  }

  /** Từ mắt người `p` nhìn thấy điểm (x, y, z) không: trong tầm ống nhòm, không tường, đồi, thân cây chắn. */
  canSee(p: PlayerState, x: number, y: number, z: number): boolean {
    const eye: [number, number, number] = [p.x, p.y + (p.prone ? 0.35 : p.crouching ? 1.1 : 1.55), p.z];
    const dx = x - eye[0];
    const dy = y - eye[1];
    const dz = z - eye[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > SPOT.range) return false;
    if (len < 0.5) return true;
    const dir: [number, number, number] = [dx / len, dy / len, dz / len];
    const map = this.room.map;
    const reach = len - 0.6;
    return raycastBoxes(map.index, eye, dir, reach, true) === Infinity && raycastTerrain(map.world, eye, dir, reach) >= reach && raycastTrunks(map.world, eye, dir, reach, map.treeDead) === Infinity;
  }

  // -------------------------------------------------------------------------- Quân Nhu

  private put(kind: Deployed["kind"], owner: string, team: string, x: number, y: number, z: number, rot: number, slot: number, life: number): string {
    const key = `d${++this.seq}`;
    this.deployed.set(key, { kind, owner, team, x, y, z, life, pulse: 0, slot, n: this.seq });
    const t = new TrapState();
    t.defId = kind;
    t.x = x;
    t.y = y;
    t.z = z;
    t.rot = rot;
    t.team = team;
    t.owner = owner;
    t.hp = 100;
    this.room.state.traps.set(key, t);
    return key;
  }

  private remove(key: string) {
    const d = this.deployed.get(key);
    if (!d) return;
    this.deployed.delete(key);
    this.room.state.traps.delete(key);
    if (d.kind === "sandbag" && d.slot >= 0) setDynamicBox(this.room.map.index, d.slot, null);
  }

  /** Người `owner` đã có bao nhiêu món `kind` đang đặt; vượt `max` thì dỡ cái cũ nhất. */
  private limit(owner: string, kind: Deployed["kind"], max: number) {
    const mine = [...this.deployed.entries()].filter(([, d]) => d.owner === owner && d.kind === kind).sort((a, b) => a[1].n - b[1].n);
    while (mine.length >= max) this.remove(mine.shift()![0]);
  }

  /** Hộp tiếp đạn: đặt ngay dưới chân (mỗi người một hộp; đặt hộp mới thì hộp cũ biến mất). */
  private placeBox(id: string, p: PlayerState): boolean {
    const y = floorBelow(this.room.map, p.x, p.y + 0.6, p.z);
    if (Math.abs(y - p.y) > 1) return false;
    this.limit(id, "ammobox", 1);
    this.put("ammobox", id, p.team, p.x, y, p.z, p.rotY, -1, AMMO_BOX.life);
    return true;
  }

  /**
   * Bờ bao cát: dựng ngang trước mặt (cách SANDBAG.ahead m), đáy trên mặt đất / sàn chỗ đó. Không dựng được nếu chỗ
   * đó đã có tường, dốc quá, đè lên người hay xe. Mỗi người tối đa SANDBAG.max bờ (dựng thêm thì bờ cũ nhất biến mất).
   */
  placeSandbag(id: string, p: PlayerState): boolean {
    const map = this.room.map;
    const index = map.index;
    if (index.dynamicFrom === undefined) return false;
    const fx = Math.sin(p.rotY);
    const fz = Math.cos(p.rotY);
    const x = p.x + fx * SANDBAG.ahead;
    const z = p.z + fz * SANDBAG.ahead;
    const ground = floorBelow(map, x, p.y + 1.2, z);
    if (Math.abs(ground - p.y) > 0.8 || ground < 0.3) return false;
    const box: BattleBox = { x, y: ground + SANDBAG.h / 2, z, w: SANDBAG.w, h: SANDBAG.h, d: SANDBAG.d, rot: p.rotY, pitch: 0, mat: "sandbag", solid: true, part: "prop" };
    // Hai đầu và giữa bờ không được lấn vào tường có sẵn.
    const rx = Math.cos(p.rotY);
    const rz = -Math.sin(p.rotY);
    for (const k of [-0.5, 0, 0.5]) if (insideBox(index, x + rx * SANDBAG.w * k, box.y, z + rz * SANDBAG.w * k, 0.05)) return false;
    for (const q of this.room.state.players.values()) if (q.alive && !q.vehicle && Math.hypot(q.x - x, q.z - z) < 1.15 && Math.abs(q.y - ground) < 1.8) return false;
    for (const v of this.room.state.vehicles.values()) if (Math.hypot(v.x - x, v.z - z) < 4.5) return false;
    this.limit(id, "sandbag", SANDBAG.max);
    const used = new Set([...this.deployed.values()].map((d) => d.slot));
    let slot = -1;
    for (let i = index.dynamicFrom; i < index.boxes.length; i++)
      if (!used.has(i)) {
        slot = i;
        break;
      }
    if (slot < 0) {
      // Hết chỗ cả phòng: dỡ bờ cũ nhất của bất kỳ ai.
      const oldest = [...this.deployed.entries()].filter(([, d]) => d.kind === "sandbag").sort((a, b) => a[1].n - b[1].n)[0];
      if (!oldest) return false;
      slot = oldest[1].slot;
      this.remove(oldest[0]);
    }
    setDynamicBox(index, slot, box);
    this.room.destruction.setDurability(slot, boxDurability(box));
    this.put("sandbag", id, p.team, x, ground, z, p.rotY, slot, Infinity);
    return true;
  }

  /** Destruction báo: bao cát ở chỗ `slot` còn `left` (0–1) độ bền; 0 là vỡ. */
  sandbagHit(slot: number, left: number) {
    for (const [key, d] of this.deployed) {
      if (d.kind !== "sandbag" || d.slot !== slot) continue;
      if (left <= 0) {
        this.room.broadcast(Messages.fx, { kind: "poof", x: d.x, y: d.y + 0.5, z: d.z });
        this.remove(key);
      } else {
        const t = this.room.state.traps.get(key);
        const hp = Math.max(1, Math.round(left * 100));
        if (t && t.hp !== hp) t.hp = hp;
      }
      return;
    }
  }

  /**
   * Nạp cho người `q` từ hộp tiếp đạn: mỗi súng thêm một băng đạn dự trữ (tới mức trần), lựu đạn tới 2 quả, phóng lựu
   * M203 thêm một quả. Trả về true nếu có nhận được gì.
   */
  resupply(q: PlayerState): boolean {
    const kit = q.kit;
    let gave = false;
    for (const slot of GUN_SLOTS) {
      const def = weaponIn(kit, slot);
      if (!def) continue;
      const cap = def.class === "launcher" ? 4 : def.class === "pistol" ? def.mag * 3 : def.mag * (def.class === "lmg" ? 2 : 4);
      const cur = ammoOf(kit, def.ammo);
      if (cur >= cap) continue;
      addAmmo(kit, def.ammo, Math.min(def.class === "launcher" ? 1 : def.mag, cap - cur));
      gave = true;
    }
    if (kit.frag < 2 && receive(kit, "frag", [])) gave = true;
    const list = isSoldierClass(q.gear.cls) ? CLASSES[q.gear.cls].gadgets : [];
    list.forEach((g, k) => {
      if (g !== "m203" && g !== "atmine") return;
      const n = k === 0 ? q.gear.n1 : q.gear.n2;
      if (n >= GADGETS[g].charges) return;
      if (k === 0) q.gear.n1 = n + 1;
      else q.gear.n2 = n + 1;
      gave = true;
    });
    return gave;
  }

  // -------------------------------------------------------------------------- Kỹ Thuật

  /**
   * Mỏ lết: người `id` đứng sát xe `vid` (phe mình hay xe chưa của ai, chưa nổ, còn hư) thì xe hồi máu theo thời gian
   * thật giữa hai gói (tối đa nửa giây mỗi gói). Mỗi REPAIR.xpPer máu sửa được thì được XP "repair". Trả về máu đã sửa.
   */
  repair(id: string, p: PlayerState, vid: string, now = this.now()): number {
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0 || (v.team && v.team !== p.team)) return 0;
    const spec = vehicleSpec(v.kind);
    if (v.hp >= spec.hp) return 0;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    const c = Math.cos(v.rotY);
    const sn = Math.sin(v.rotY);
    const side = Math.max(0, Math.abs(dx * c - dz * sn) - spec.half[0]);
    const along = Math.max(0, Math.abs(dx * sn + dz * c) - spec.half[2]);
    if (Math.hypot(side, along) > REPAIR.reach || Math.abs(p.y - v.y) > 3) return 0;
    const last = this.repairAt.get(id) ?? now - 250;
    if (now - last < 120) return 0;
    this.repairAt.set(id, now);
    const dt = Math.min(0.5, Math.max(0, now - last) / 1000);
    const amount = Math.min(spec.hp - v.hp, REPAIR.rate * dt);
    if (amount <= 0) return 0;
    v.hp = Math.min(spec.hp, Math.round(v.hp + amount));
    let acc = (this.repaired.get(id) ?? 0) + amount;
    while (acc >= REPAIR.xpPer) {
      acc -= REPAIR.xpPer;
      awardXp(id, "repair");
    }
    this.repaired.set(id, acc);
    return amount;
  }

  /** Mìn chống tăng nổ dưới xe: xe mất nhiều máu, đứt xích; người quanh đó trúng sức nổ nhỏ. */
  atBlast(x: number, y: number, z: number, owner: string) {
    const room = this.room;
    for (const [vid, v] of room.state.vehicles) {
      if (v.hp <= 0 || Math.hypot(v.x - x, v.z - z) > AT_MINE.trigger + 1.5) continue;
      room.vehicles.damage(vid, AT_MINE.armor, owner, "atmine");
      if (v.hp > 0 && v.kind === "tank") room.vehicles.breakTracks(vid);
    }
    room.explode(x, y + 0.2, z, "mine", owner, AT_MINE.radius, AT_MINE.damage, "atmine");
  }

  // -------------------------------------------------------------------------- nhịp

  tick(dt: number) {
    const s = this.room.state;
    for (const p of s.players.values()) {
      if (p.gear.boost <= 0) continue;
      p.gear.boost = p.alive ? Math.max(0, p.gear.boost - dt) : 0;
    }
    if (!this.room.fighting()) return;
    const now = this.now();
    for (const [key, d] of [...this.deployed]) {
      if (d.kind !== "ammobox") continue;
      d.life -= dt;
      if (d.life <= 0) {
        this.remove(key);
        continue;
      }
      d.pulse -= dt;
      if (d.pulse > 0) continue;
      d.pulse = AMMO_BOX.every;
      for (const [qid, q] of s.players) {
        if (!q.alive || q.vehicle || q.team !== d.team || !d.team) continue;
        if (Math.hypot(q.x - d.x, q.z - d.z) > AMMO_BOX.radius || Math.abs(q.y - d.y) > 2) continue;
        if (!this.resupply(q) || qid === d.owner) continue;
        const pair = `${d.owner}|${qid}`;
        if (now - (this.xpAt.get(pair) ?? -Infinity) < AMMO_BOX.xpEvery * 1000) continue;
        this.xpAt.set(pair, now);
        awardXp(d.owner, "resupply");
      }
    }
  }
}
