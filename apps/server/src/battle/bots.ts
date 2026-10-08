import { HELI, MAX_HP, ROLES, SMOKE_CLEAR, SMOKE_SIGHT, SQUAD_ROLES, START_MONEY, TANK, WAR_BASES, WATER_LEVEL, WEAPON, deckTop, flightTime, insideBox, isEmplacement, raycastBoxes, raycastTrunks, warRoute, type SquadRole } from "@tentides/content";
import type { PlayerState } from "@tentides/protocol";
import type { BattleRoom } from "./BattleRoom.ts";
import { addAmmo, isGunSlot, magOf, receive, resetKit, weaponIn } from "./kit.ts";
import { NavGrid, type NavPoint } from "./nav.ts";
import { coverSpot, lookOut, overwatch, type TacticsHost } from "./tactics.ts";
import { HeliPilots } from "./heliPilot.ts";

// Máy (bot) cho Battleground: đi lang thang trong vùng an toàn (hay đi theo đội hình của đội trưởng ở chế độ Đồng đội),
// tránh tường và nước, thấy ai trong tầm nhìn (không bị tường, đồi che) thì quay lại bắn từng loạt, trúng hay trật tuỳ
// khoảng cách; bị bắn thì quay sang kẻ bắn mình. Bắn qua đúng hàm `fire` của người chơi nên cũng bị kiểm tra đạn, tốc độ
// bắn, tường chắn như ai. Công bằng: máy chỉ nhìn thấy trong hình nón phía trước (sát bên thì nghe tiếng chân), người
// ngồi xổm, nằm sấp, mặc ghillie thì khó thấy hơn; chỉ bắn khi đang thật sự thấy mục tiêu; mất dấu thì đi tới chỗ thấy
// lần cuối chứ không bám theo vị trí thật; nghe tiếng súng hay bị bắn trúng thì chỉ biết hướng đại khái để đi dò.
// Chế độ Đồng đội: mỗi máy có vai trò (tay súng trường, bắn tỉa nằm bắn từ xa, súng máy, lái xe tăng), không bắn người
// cùng đội, nghe lệnh người dẫn đội (theo sau, giữ chỗ, tới điểm).
// Chạy nhẹ với 50 máy: mỗi máy nhìn quanh lệch nhịp nhau, chỉ dò tia tới vài người gần nhất trong tầm, độ cao địa hình
// lấy từ lưới tính sẵn.
// Đi lại theo lưới dẫn đường (nav.ts, tìm đường A*): vòng qua nhà, tường, sông thay vì đi thẳng rồi kẹt; đứng mãi
// không nhích thì tìm đường lại, vẫn kẹt thì lùi ra chỗ trống gần đó. Chiến thuật theo lớp lính (tactics.ts): bắn tỉa
// tìm chỗ cao xa nhìn thẳng vào cứ điểm rồi nằm rình, bắn vài phát thì đổi chỗ; súng máy xả áp chế vào chỗ địch vừa
// nấp; tay súng ném lựu đạn vào địch nấp sau tường, trong nhà; phe giữ cứ điểm vào nhà, nấp sau tường thấp, phục kích
// chờ địch tới gần mới nổ súng; máu thấp thì ném khói rút lui. Đứng canh thì nhìn ra khoảng trống phía địch tới.

const NAMES = [
  "Hải Âu", "Cá Mập", "Kền Kền", "Rắn Hổ", "Bão Cát", "Sói Xám", "Đại Bàng", "Chim Cắt", "Báo Đốm", "Gấu Nâu", "Cú Mèo", "Mãng Xà",
  "Hổ Mang", "Linh Miêu", "Diều Hâu", "Bọ Cạp", "Cá Sấu", "Tê Giác", "Sư Tử", "Báo Săn", "Quạ Đen", "Ó Biển", "Nhím", "Chồn",
  "Sấm Sét", "Lốc Xoáy", "Mũi Tên", "Thép", "Đá Tảng", "Bóng Đêm",
];
const LOADOUTS = ["m416", "akm", "scar", "ump45", "vector", "sks", "s686", "s1897", "dp28", "m416", "akm"];
/** Tầm nhìn (m) theo vai trò; lái tăng nhìn từ tháp pháo, xa hơn. */
const SIGHT: Record<string, number> = { "": 75, leader: 85, rifle: 85, support: 85, sniper: 150, tanker: 160 };
/** Tầm máy dùng IGLA khoá trực thăng (m), ngắn hơn tầm tối đa của người chơi. */
const BOT_AA_RANGE = 260;
/** Đội hình mũi tên sau lưng đội trưởng: (ngang, dọc) theo hướng đội trưởng nhìn, dương là bên phải / phía trước. */
const SLOTS: readonly [number, number][] = [
  [-4, -4],
  [4, -4],
  [-8, -8],
  [8, -8],
  [0, -10],
  [-12, -12],
];
/** Xe tăng đi sau đội hình một đoạn. */
const TANK_SLOT: [number, number] = [0, -18];

interface Brain {
  wx: number;
  wz: number;
  target: string;
  /** Chỗ thấy mục tiêu lần cuối, và lúc này có đang thấy không. */
  lx: number;
  ly: number;
  lz: number;
  sees: boolean;
  seen: number;
  react: number;
  burst: number;
  pause: number;
  scan: number;
  strafe: number;
  /** Chỗ trong đội hình. */
  slot: number;
  /** Chờ bao lâu nữa mới ném lựu đạn tiếp (giây). */
  nade: number;
  /** Chiến trường: cứ điểm đang nhắm, tới lúc nào thì chọn lại, chỗ đứng trong vùng (góc, bán kính 0–1). */
  goal: string;
  goalUntil: number;
  ga: number;
  gr: number;
  /** Máy chống tăng: xe tăng địch đang nhắm (id người lái), lần dò kế tiếp. */
  at: string;
  atScan: number;
  /** Kẹt: thử né sang bên trong chừng này giây. */
  detour: number;
  detourDir: number;
  /** Xe tăng: vận tốc hiện tại, thời gian kẹt, đang lùi ra. */
  tankSpeed: number;
  stuck: number;
  backUp: number;
  /** Đường đang đi (lưới dẫn đường), điểm kế tiếp, đích lúc tìm đường, cần tìm lại. */
  path: NavPoint[] | null;
  pathI: number;
  pgx: number;
  pgz: number;
  replan: boolean;
  /** Đo kẹt: chỗ đứng lúc bắt đầu đo, thời gian đã đo, số lần kẹt liền; đang lùi ra chỗ trống (giây, toạ độ). */
  progX: number;
  progZ: number;
  progT: number;
  stuckN: number;
  unstick: number;
  ux: number;
  uz: number;
  /** Hướng canh gác đang nhìn và lúc tính lại. */
  lookYaw: number;
  lookAt: number;
  /** Chỗ đứng chiến thuật cho khu vực hiện tại (khoá khu vực, toạ độ, loại chỗ). */
  tacKey: string;
  tacX: number;
  tacZ: number;
  tacKind: "" | "overwatch" | "cover" | "open";
  /** Số phát đã bắn từ chỗ bắn tỉa hiện tại (bắn vài phát thì đổi chỗ). */
  shots: number;
  /** Lúc mất dấu mục tiêu, lúc bị bắn gần nhất (giây trận). */
  lostAt: number;
  hurtAt: number;
  /** Đang rút lui (giây còn lại) về chỗ (rx, rz); chờ ném khói lần sau. */
  retreat: number;
  rx: number;
  rz: number;
  smokeCd: number;
}

/** Lệnh của người chơi cho một máy trên chiến trường (vẽ vùng trên bản đồ): đánh chiếm hay giữ khu vực. */
export interface WarCommand {
  kind: "attack" | "hold";
  x: number;
  z: number;
  r: number;
  /** Người ra lệnh, hết hạn lúc (Date.now(), ms). */
  by: string;
  until: number;
}

/** Chỗ đứng của máy: toạ độ, khoảng cách tới đó, loại chỗ (bắn tỉa, nấp, chỗ trống), hướng địch tới (NaN nếu không rõ). */
interface Placement {
  x: number;
  z: number;
  far: number;
  kind: "" | "overwatch" | "cover" | "open";
  threat: number;
}

export interface SquadOrder {
  kind: "follow" | "hold" | "move";
  x: number;
  z: number;
  /** Hướng lúc ra lệnh (để xếp đội hình khi giữ chỗ, tới điểm). */
  rot: number;
}

/** Lưới độ cao địa hình tính sẵn (ô 2 m) để máy dò tầm nhìn, bước đi mà khỏi tính lại địa hình mỗi lần. */
class HeightGrid {
  private readonly n: number;
  private readonly data: Float32Array;
  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    private readonly half = 210,
    private readonly cell = 2,
  ) {
    this.n = Math.floor((half * 2) / cell) + 1;
    this.data = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.data[j * this.n + i] = heightAt(-half + i * cell, -half + j * cell);
  }
  at(x: number, z: number): number {
    const fx = (x + this.half) / this.cell;
    const fz = (z + this.half) / this.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.n - 1 || j >= this.n - 1) return this.heightAt(x, z);
    const u = fx - i;
    const v = fz - j;
    const k = j * this.n + i;
    const d = this.data;
    return (d[k]! * (1 - u) + d[k + 1]! * u) * (1 - v) + (d[k + this.n]! * (1 - u) + d[k + this.n + 1]! * u) * v;
  }
}

export class Bots {
  private brains = new Map<string, Brain>();
  /** Lệnh của từng đội (theo id đội). */
  orders = new Map<string, SquadOrder>();
  /** Máy đang chạy tới lên xe tăng theo lệnh đội trưởng: id máy → id xe. */
  boarding = new Map<string, string>();
  private grid: HeightGrid | null = null;
  private gridMap: object | null = null;
  /** Đội trưởng từng đội, tính lại mỗi nhịp. */
  private leaders = new Map<string, string>();
  private nameSeq = 0;
  /** Lệnh vùng của người chơi cho từng máy (chiến trường). */
  commands = new Map<string, WarCommand>();
  private navGrid: NavGrid | null = null;
  private navMap: object | null = null;
  /** Hạn mức ô tìm đường còn lại trong nhịp này (chia đều cho các máy cần tìm đường). */
  private planLeft = 0;
  /** Số lần chọn chỗ chiến thuật (dò nhiều tia) còn được làm trong nhịp này. */
  private tacLeft = 0;
  /** Giây trận (cộng dồn theo nhịp). */
  private time = 0;
  /** Máy lái trực thăng (heliPilot.ts); lúc mỗi trực thăng bắt đầu bỏ trống (giây trận). */
  readonly pilots: HeliPilots;
  private heliIdle = new Map<string, number>();
  /** Máy đang (hay vừa) khoá IGLA vào trực thăng nào, tới lúc nào (giây trận). */
  private aaClaim = new Map<string, { by: string; until: number }>();

  constructor(private readonly room: BattleRoom) {
    this.pilots = new HeliPilots(room);
  }

  /** Lưới dẫn đường của bản đồ hiện tại (dựng lười, bản đồ đổi thì dựng lại). */
  nav(): NavGrid {
    const map = this.room.map;
    if (!this.navGrid || this.navMap !== map) {
      const mf = map.sites.find((x) => x.kind === "minefield");
      // Bãi mìn: đi vòng (đắt gấp 8), không cấm hẳn.
      const cost = mf ? (x: number, z: number) => (Math.hypot(x - mf.x, z - mf.z) < Math.max(mf.rx, mf.rz) + 4 ? 8 : 1) : undefined;
      this.navGrid = new NavGrid(map, (x, z) => this.height(x, z), cost);
      this.navMap = map;
    }
    return this.navGrid;
  }

  private get tactics(): TacticsHost {
    return { map: this.room.map, nav: this.nav(), height: (x, z) => this.height(x, z), visible: (e, x, y, z) => this.visible(e, x, y, z) };
  }

  private height(x: number, z: number): number {
    const map = this.room.map;
    if (!this.grid || this.gridMap !== map) {
      this.grid = new HeightGrid(map.world.heightAt, (map.half ?? 240) - 20);
      this.gridMap = map;
    }
    // Mặt cầu (khối deck) cao hơn địa hình thì đi trên mặt cầu.
    return Math.max(this.grid.at(x, z), deckTop(map.index, x, z));
  }

  /** Dựng sẵn lưới độ cao (gọi lúc vào trận, khỏi khựng ở nhịp đầu). */
  warm() {
    this.height(0, 0);
  }

  private newBot(id: string, team: string, role: SquadRole | ""): PlayerState {
    const s = this.room.state;
    const p = this.room.newPlayer();
    const k = this.nameSeq++;
    const base = NAMES[k % NAMES.length]!;
    p.name = `🤖 ${base}${k >= NAMES.length ? ` ${Math.floor(k / NAMES.length) + 1}` : ""}`;
    p.bot = true;
    p.connected = true;
    p.color = this.room.pickColor();
    p.team = team;
    p.role = role;
    p.kit.outfit = (role && ROLES[role].outfit) || ["woodland", "desert", "urban", "digital", "ghillie"][k % 5]!;
    s.players.set(id, p);
    this.brains.delete(id);
    return p;
  }

  /** Bỏ hết máy. */
  clear() {
    const s = this.room.state;
    for (const [id, p] of [...s.players]) if (p.bot) s.players.delete(id);
    this.brains.clear();
    this.orders.clear();
    this.boarding.clear();
    this.commands.clear();
    this.pilots.clear();
    this.heliIdle.clear();
    this.aaClaim.clear();
    this.nameSeq = 0;
  }

  /** Chế độ solo: thêm hoặc bớt máy cho đủ `n` (máy không đội). */
  sync(n: number) {
    const s = this.room.state;
    const ids = [...s.players.entries()].filter(([, p]) => p.bot).map(([id]) => id);
    for (const id of ids.slice(n)) {
      s.players.delete(id);
      this.brains.delete(id);
    }
    for (let k = 0; k < n - ids.length; k++) {
      let id = "";
      for (let j = 1; !id || s.players.has(id); j++) id = `bot${j}`;
      this.newBot(id, "", "");
    }
  }

  /**
   * Chế độ Đồng đội: mỗi người chơi được 5 máy đi theo (đủ vai: súng trường, bắn tỉa, lái xe tăng, súng máy); số máy
   * còn lại (theo lựa chọn của chủ phòng, tối đa `total`) chia thành các đội toàn máy 6 người.
   */
  buildSquads(humans: string[], total: number, perHuman: number) {
    this.clear();
    const s = this.room.state;
    let made = 0;
    for (const h of humans) {
      const p = s.players.get(h);
      if (!p) continue;
      p.team = h;
      p.role = "leader";
      for (let k = 0; k < perHuman; k++, made++) this.newBot(`bot${made + 1}`, h, SQUAD_ROLES[k % SQUAD_ROLES.length]!);
    }
    let squad = 0;
    while (made < total) {
      squad++;
      const team = `ai${squad}`;
      const size = Math.min(6, total - made);
      for (let k = 0; k < size; k++, made++) this.newBot(`bot${made + 1}`, team, k === 0 ? "leader" : SQUAD_ROLES[(k - 1) % SQUAD_ROLES.length]!);
    }
  }

  /**
   * Chiến trường: thêm `blue` máy phe Xanh, `red` máy phe Đỏ; mỗi phe `tankers` máy đầu tiên lái tăng, còn lại chia
   * lớp lính theo `roles` (súng trường, bắn tỉa, súng máy, chống tăng).
   */
  buildWar(blue: number, red: number, roles: readonly SquadRole[], tankers: number) {
    this.clear();
    let made = 0;
    for (const [side, n] of [
      ["blue", blue],
      ["red", red],
    ] as const) {
      for (let k = 0; k < n; k++, made++) this.newBot(`bot${made + 1}`, side, k < tankers ? "tanker" : roles[k % roles.length]!);
    }
  }

  /** Mỗi máy một bộ đồ: solo thì ngẫu nhiên; Đồng đội thì theo vai trò (súng, ống ngắm, lựu đạn, băng gạc). */
  equipAll() {
    for (const [id, p] of this.room.state.players) {
      if (!p.bot) continue;
      const outfit = p.kit.outfit;
      resetKit(p.kit, START_MONEY);
      p.kit.outfit = outfit;
      const role = p.role as SquadRole | "";
      const spec = role ? ROLES[role] : null;
      const gun = spec ? spec.guns[Math.floor(Math.random() * spec.guns.length)]! : LOADOUTS[Math.floor(Math.random() * LOADOUTS.length)]!;
      const def = WEAPON.get(gun)!;
      receive(p.kit, gun, []);
      addAmmo(p.kit, def.ammo, def.mag * (def.class === "lmg" ? 2 : 4));
      if (spec?.sight) receive(p.kit, `sight:${spec.sight}`, []);
      receive(p.kit, `armor:${1 + Math.floor(Math.random() * 2)}`, []);
      receive(p.kit, `helmet:${1 + Math.floor(Math.random() * 2)}`, []);
      for (const extra of spec?.extras ?? ["bandage", "frag"]) receive(p.kit, extra, []);
      // Súng phụ (RPG) nhận sau cùng thì thành món đang cầm: cầm lại súng chính.
      if (p.kit.primary1) p.kit.active = "primary1";
      p.hp = MAX_HP;
      p.crouching = p.prone = false;
      this.brains.set(id, this.fresh(p.x, p.z, 0));
    }
    // Chỗ trong đội hình theo thứ tự trong đội.
    const count = new Map<string, number>();
    for (const [id, p] of this.room.state.players) {
      if (!p.bot || !p.team) continue;
      const n = count.get(p.team) ?? 0;
      count.set(p.team, n + 1);
      const b = this.brains.get(id);
      if (b) b.slot = n;
    }
  }

  forget(id: string) {
    this.brains.delete(id);
    this.boarding.delete(id);
    this.pilots.forget(id);
  }

  /**
   * Lệnh lên xe tăng: chọn máy còn sống, đang đi bộ trong đội `team` (ưu tiên máy lái tăng, rồi máy gần xe nhất) chạy
   * tới xe `vid` rồi lên lái. Trả về id máy được giao, hay "" nếu không ai đi được.
   */
  orderBoard(team: string, vid: string): string {
    const s = this.room.state;
    const v = s.vehicles.get(vid);
    if (!v || v.hp <= 0 || v.driver) return "";
    for (const [bid, to] of this.boarding) if (to === vid) this.boarding.delete(bid);
    let best = "";
    let bestScore = Infinity;
    for (const [id, p] of s.players) {
      if (!p.bot || !p.alive || p.team !== team || p.vehicle) continue;
      const score = Math.hypot(p.x - v.x, p.z - v.z) + (p.role === "tanker" ? 0 : 10000);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best) this.boarding.set(best, vid);
    return best;
  }

  /** Máy đang theo lệnh lên xe: chỗ chạy tới (null nếu không có lệnh, hay lệnh hết hiệu lực); tới nơi thì lên. */
  private boardStep(id: string, p: PlayerState): { x: number; z: number } | null {
    const vid = this.boarding.get(id);
    if (!vid) return null;
    const v = this.room.state.vehicles.get(vid);
    if (!v || v.hp <= 0 || v.driver || p.vehicle || (v.team && v.team !== p.team)) {
      this.boarding.delete(id);
      return null;
    }
    if (Math.hypot(v.x - p.x, v.z - p.z) < (v.kind === "heli" ? HELI.enter * 0.7 : TANK.enter * 0.8)) {
      this.boarding.delete(id);
      this.room.vehicles.board(id, vid);
      v.team = p.team;
      return { x: p.x, z: p.z };
    }
    return { x: v.x, z: v.z };
  }

  /**
   * Chiến trường: trực thăng đậu ở sân nhà bỏ trống một lúc mà không người chơi nào của phe đứng gần thì giao một máy
   * chạy tới lái. Máy đang lái mà đáp ở nhà, có người chơi cùng phe tới sát thì xuống nhường ghế.
   */
  private crewHelis() {
    const s = this.room.state;
    if (s.battleMode !== "war" || s.phase !== "battle") return;
    // Máy được giao lên xe mà đã gục: bỏ lệnh, để giao cho máy khác.
    for (const [bid] of this.boarding) if (!s.players.get(bid)?.alive) this.boarding.delete(bid);
    for (const [vid, v] of s.vehicles) {
      if (v.kind !== "heli" || v.hp <= 0 || !v.team) continue;
      const home = this.room.vehicles.air.homeOf(vid);
      const landed = v.y - this.height(v.x, v.z) < 1.5;
      let human = Infinity;
      for (const q of s.players.values()) if (!q.bot && q.alive && q.team === v.team && !q.vehicle) human = Math.min(human, Math.hypot(q.x - v.x, q.z - v.z));
      const driver = v.driver ? s.players.get(v.driver) : undefined;
      if (driver?.bot && landed && human < 9) {
        this.room.vehicles.exit(v.driver);
        this.heliIdle.set(vid, this.time + 30);
        continue;
      }
      if (v.driver || !landed || !home || Math.hypot(v.x - home.x, v.z - home.z) > 15 || human < 40) {
        this.heliIdle.delete(vid);
        continue;
      }
      const since = this.heliIdle.get(vid);
      if (since === undefined) {
        this.heliIdle.set(vid, this.time);
        continue;
      }
      if (this.time - since < 20 || [...this.boarding.values()].includes(vid)) continue;
      let best = "";
      let bestD = 420;
      for (const [id, p] of s.players) {
        if (!p.bot || !p.alive || p.vehicle || p.team !== v.team || p.role === "tanker" || p.role === "sniper" || this.boarding.has(id)) continue;
        const d = Math.hypot(p.x - v.x, p.z - v.z);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) this.boarding.set(best, vid);
    }
  }

  onHurt(target: string, attacker: string) {
    const b = this.brains.get(target);
    const me = this.room.state.players.get(target);
    const a = this.room.state.players.get(attacker);
    if (!b || !me || !a || attacker === target) return;
    // Bị bắn: quay về phía đạn tới, biết đại khái chỗ kẻ bắn (lệch vài mét theo khoảng cách), chưa khoá mục tiêu
    // cho tới khi tự nhìn thấy.
    if (b.target !== attacker) b.react = 0.45 + Math.random() * 0.4;
    const d = Math.hypot(a.x - me.x, a.z - me.z);
    const err = Math.min(12, 1 + d * 0.12);
    b.target = attacker;
    b.lx = a.x + (Math.random() - 0.5) * 2 * err;
    b.lz = a.z + (Math.random() - 0.5) * 2 * err;
    b.ly = a.y;
    b.seen = 4;
    b.hurtAt = this.time;
    // Bắn tỉa bị lộ: bắn xong loạt này thì đổi chỗ.
    if (me.role === "sniper") b.shots = Math.max(b.shots, 3);
    if (!me.vehicle) me.rotY = Math.atan2(a.x - me.x, a.z - me.z);
    // Bị bắn thì nằm hay ngồi xuống cho khó trúng.
    if (!me.vehicle && me.role === "sniper") me.prone = true;
    else if (!me.vehicle && Math.random() < 0.5) me.crouching = true;
  }

  /** Nghe tiếng súng: máy đang rảnh ở gần thì đi dò về hướng đó (chỉ biết đại khái). Máy trong đội người chơi thì không bỏ đội đi. */
  onShot(shooter: string, x: number, z: number, loud: number) {
    const s = this.room.state;
    const who = s.players.get(shooter);
    for (const [id, p] of s.players) {
      if (!p.bot || !p.alive || id === shooter) continue;
      if (who && p.team && who.team === p.team) continue;
      const b = this.brains.get(id);
      if (!b || b.target) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > loud) continue;
      const err = 4 + d * 0.25;
      b.wx = x + (Math.random() - 0.5) * 2 * err;
      b.wz = z + (Math.random() - 0.5) * 2 * err;
      // Quay về phía tiếng súng để còn nhìn thấy.
      if (!p.vehicle) p.rotY = Math.atan2(x - p.x, z - p.z) + (Math.random() - 0.5) * 0.6;
    }
  }

  private fresh(x: number, z: number, slot: number): Brain {
    return { wx: x, wz: z, target: "", lx: x, ly: 0, lz: z, sees: false, seen: 0, react: 0, burst: 0, pause: 0, scan: Math.random() * 0.4, strafe: 0, slot, nade: 2 + Math.random() * 3, goal: "", goalUntil: 0, ga: 0, gr: 0, at: "", atScan: Math.random(), detour: 0, detourDir: 1, tankSpeed: 0, stuck: 0, backUp: 0, path: null, pathI: 0, pgx: x, pgz: z, replan: false, progX: x, progZ: z, progT: 0, stuckN: 0, unstick: 0, ux: x, uz: z, lookYaw: 0, lookAt: 0, tacKey: "", tacX: x, tacZ: z, tacKind: "", shots: 0, lostAt: -99, hurtAt: -99, retreat: 0, rx: x, rz: z, smokeCd: 0 };
  }

  /** Trực thăng còn trong vùng trời an toàn quanh sân đỗ nhà (đang cất, hạ cánh, nạp đạn): máy không nhắm vào. */
  heliShielded(v: { kind: string; x: number; z: number }, vid: string): boolean {
    if (v.kind !== "heli") return false;
    const home = this.room.vehicles.air.homeOf(vid);
    return !!home && Math.hypot(v.x - home.x, v.z - home.z) < HELI.safeRadius;
  }

  /** Hai người có phải địch của nhau không (cùng đội thì không). */
  hostile(a: PlayerState, b: PlayerState): boolean {
    return a !== b && !(a.team && a.team === b.team);
  }

  /** Đội trưởng của đội: người chơi (còn sống) dẫn đội, không thì máy còn sống đầu tiên. */
  leaderOf(team: string): string {
    return this.leaders.get(team) ?? "";
  }

  private updateLeaders() {
    this.leaders.clear();
    const s = this.room.state;
    for (const [id, p] of s.players) {
      if (!p.team || !p.alive) continue;
      const cur = this.leaders.get(p.team);
      const curP = cur ? s.players.get(cur) : undefined;
      // Người chơi luôn làm đội trưởng; giữa các máy thì máy "leader", rồi máy có số nhỏ nhất.
      const rank = (q: PlayerState, qid: string) => (!q.bot ? 0 : q.role === "leader" ? 1 : q.vehicle ? 3 : 2) * 1000 + (Number(qid.replace(/\D/g, "")) || 0);
      if (!curP || rank(p, id) < rank(curP, cur!)) this.leaders.set(p.team, id);
    }
  }

  tick(dt: number) {
    const room = this.room;
    const s = room.state;
    if (!room.fighting()) return;
    this.time += dt;
    this.planLeft = 8000;
    this.tacLeft = 4;
    // Tường bị phá, nhà sập mở ra lối đi mới: dò lại vùng đó (vài giây một lần).
    if (Math.floor(this.time / 3) !== Math.floor((this.time - dt) / 3)) {
      this.nav().refresh();
      this.crewHelis();
    }
    this.updateLeaders();
    // Người trong tầm: danh sách ngắn gọn để các máy duyệt nhanh.
    const alive: [string, PlayerState][] = [];
    for (const e of s.players) if (e[1].alive) alive.push(e);
    for (const [id, p] of alive) {
      if (!p.bot) continue;
      let b = this.brains.get(id);
      if (!b) {
        b = this.fresh(p.x, p.z, 0);
        this.brains.set(id, b);
      }
      const tank = p.vehicle ? s.vehicles.get(p.vehicle) : undefined;
      if (tank && tank.hp > 0) {
        // Máy lái xe tăng, trực thăng (ghế lái); ngồi xe khác (xe trinh sát, thuyền) thì ngồi yên theo xe.
        if (tank.kind === "tank") this.tickTanker(id, p, b, tank, alive, dt);
        else if (tank.kind === "heli" && tank.driver === id) this.pilots.tick(id, p, p.vehicle, tank, room.vehicles.air.homeOf(p.vehicle), dt);
        // Vũ khí cố định: ngồi ổ đại liên canh, quét đạn vào địch (emplacements.ts).
        else if (isEmplacement(tank.kind)) this.room.vehicles.emplacements.tickBot(id, p, tank, dt);
        continue;
      }
      this.tickSoldier(id, p, b, alive, dt);
    }
  }

  /** Nhìn quanh: chỉ thấy trong hình nón phía trước (hay sát bên), không bị tường, đồi, khói che. */
  private scan(id: string, p: PlayerState, b: Brain, alive: [string, PlayerState][], eye: [number, number, number], range: number, cone: boolean, tanks: boolean) {
    const s = this.room.state;
    const fx = Math.sin(p.rotY);
    const fz = Math.cos(p.rotY);
    const canSee = (o: PlayerState, r: number) => {
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      // Ngồi xổm, nằm sấp, đứng yên thì khó phát hiện hơn; áo ghillie (lính Bắn Tỉa) giảm 70% tầm bị phát hiện.
      const stealth = (o.prone ? 0.45 : o.crouching ? 0.7 : 1) * (o.moving ? 1 : 0.8) * (o.kit.outfit === "ghillie" ? 0.3 : 1);
      if (d > r * (o.vehicle ? 1.6 : stealth)) return false;
      if (cone && d > 5 && (dx * fx + dz * fz) / (d || 1) < 0.35) return false;
      return this.visible(eye, o.x, o.y + (o.vehicle ? 1.6 : o.prone ? 0.3 : o.crouching ? 0.8 : 1.2), o.z);
    };
    // Xạ thủ vũ khí cố định lộ người ra ngoài: bắn được như lính đi bộ.
    // Pháo xe tăng không ngóc lên bắn trực thăng đang bay.
    const airborne = (o: PlayerState) => {
      const v = o.vehicle ? s.vehicles.get(o.vehicle) : undefined;
      return !!v && v.kind === "heli" && (v.y - this.height(v.x, v.z) > 6 || this.heliShielded(v, o.vehicle));
    };
    const usable = (o: PlayerState) => o.alive && this.hostile(p, o) && ((tanks && !airborne(o)) || !o.vehicle || this.room.vehicles.emplacements.exposed(o));
    const cur = b.target ? s.players.get(b.target) : undefined;
    b.sees = !!cur && usable(cur) && canSee(cur, range * 1.3);
    if (!b.sees) {
      // Chỉ dò tia tới vài người gần nhất trong tầm (dò tia tốn kém, 50 máy thì không dò tất cả).
      const near: { id: string; o: PlayerState; d: number }[] = [];
      for (const [oid, o] of alive) {
        if (oid === id || !usable(o)) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d > range * (o.vehicle ? 1.6 : 1)) continue;
        near.push({ id: oid, o, d });
      }
      near.sort((a, c) => a.d - c.d);
      for (const n of near.slice(0, 4)) {
        if (!canSee(n.o, range)) continue;
        if (n.id !== b.target) b.react = (p.role === "sniper" ? 1.1 : 0.8) + Math.random() * 0.7;
        b.target = n.id;
        b.sees = true;
        break;
      }
    }
    const t = b.target ? s.players.get(b.target) : undefined;
    if (b.sees && t) {
      b.lx = t.x;
      b.ly = t.y;
      b.lz = t.z;
      b.seen = 4;
    } else b.seen -= 0.3;
    if (b.seen <= 0 || (t && (!t.alive || !usable(t)))) {
      // Mất dấu hẳn: thôi, đi dò quanh chỗ thấy lần cuối (máy trong đội người chơi thì về đội hình).
      if (b.target) {
        b.wx = b.lx + (Math.random() - 0.5) * 10;
        b.wz = b.lz + (Math.random() - 0.5) * 10;
      }
      b.target = "";
      b.sees = false;
    }
  }

  /** Hướng (radian) từ khu vực (x, z) về phía địch có thể tới: cứ điểm gần nhất chưa phải của phe mình, hay căn cứ địch. */
  private threatYaw(side: string, x: number, z: number): number {
    const s = this.room.state;
    if (s.battleMode !== "war" || (side !== "blue" && side !== "red")) return NaN;
    let best: { x: number; z: number } = side === "blue" ? WAR_BASES.red : WAR_BASES.blue;
    let bestD = Infinity;
    for (const f of s.flags.values()) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (f.owner === side || d < 5 || d > bestD) continue;
      bestD = d;
      best = f;
    }
    return Math.atan2(best.x - x, best.z - z);
  }

  /**
   * Chiến trường: máy nhắm tới một cứ điểm (chưa phải của phe mình, gần nhất hay gần nhì; thỉnh thoảng ở lại giữ
   * cứ điểm đang bị đánh), hay tới vùng người chơi chỉ trên bản đồ. Chỗ đứng theo vai: bắn tỉa tìm chỗ cao xa nhìn
   * thẳng vào khu vực; phe giữ khu vực tìm chỗ nấp (trong nhà, sau tường thấp) hướng ra phía địch; phe đánh rải trong
   * vùng chiếm. Xe tăng đứng ngoài rìa yểm trợ.
   */
  private warSpot(id: string, p: PlayerState, b: Brain, tank: boolean): Placement | null {
    const s = this.room.state;
    const side = p.team;
    const now = Date.now();
    const cmd = this.commands.get(id);
    let area: { key: string; x: number; z: number; r: number; defend: boolean };
    if (cmd && cmd.until > now) {
      area = { key: `cmd:${Math.round(cmd.x)}:${Math.round(cmd.z)}:${cmd.kind}`, x: cmd.x, z: cmd.z, r: cmd.r, defend: cmd.kind === "hold" };
    } else {
      if (cmd) this.commands.delete(id);
      let f = b.goal ? s.flags.get(b.goal) : undefined;
      const enemyIn = (fl: { blue: number; red: number }) => (side === "blue" ? fl.red : fl.blue);
      const secured = f && f.owner === side && Math.abs(f.progress) >= 1 && enemyIn(f) === 0;
      if (!f || now > b.goalUntil || (secured && Math.random() < 0.75)) {
        const flags = [...s.flags.entries()];
        const dist = ([, fl]: (typeof flags)[number]) => Math.hypot(fl.x - p.x, fl.z - p.z);
        const attack = flags.filter(([, fl]) => fl.owner !== side).sort((a, c) => dist(a) - dist(c));
        const defend = flags.filter(([, fl]) => fl.owner === side && enemyIn(fl) > 0);
        let pick = attack[Math.random() < 0.65 || attack.length < 2 ? 0 : 1];
        // Phe mình đang giữ cứ điểm bị đánh: máy giữ nhà ở lại phòng thủ (súng máy, bắn tỉa hay ở lại hơn).
        if (defend.length && Math.random() < (p.role === "support" || p.role === "sniper" ? 0.5 : 0.35)) pick = defend[Math.floor(Math.random() * defend.length)];
        if (!pick) pick = flags[Math.floor(Math.random() * flags.length)];
        if (!pick) return null;
        b.goal = pick[0];
        // Bắn tỉa, giữ nhà: ở lâu một chỗ; phe đánh đổi mục tiêu nhanh hơn.
        b.goalUntil = now + (p.role === "sniper" ? 30000 : 12000) + Math.random() * 12000;
        b.ga = Math.random() * Math.PI * 2;
        b.gr = Math.sqrt(Math.random());
        f = pick[1];
      }
      area = { key: `flag:${b.goal}:${f.owner === side ? "d" : "a"}`, x: f.x, z: f.z, r: f.r, defend: f.owner === side };
    }
    const threat = this.threatYaw(side, area.x, area.z);
    let x: number;
    let z: number;
    let kind: Brain["tacKind"] = "open";
    if (tank) {
      const r = area.r + 12;
      x = area.x + Math.cos(b.ga) * r;
      z = area.z + Math.sin(b.ga) * r;
    } else {
      // Đổi khu vực, hay bắn tỉa đã bắn vài phát ở chỗ cũ (lộ vị trí): chọn chỗ mới.
      const relocate = b.tacKind === "overwatch" && b.shots >= 4;
      // Chọn chỗ dò nhiều tia: mỗi nhịp chỉ vài máy (đầu trận cả trăm máy cùng chọn thì khựng server); máy chưa tới
      // lượt tạm đi về giữa khu vực.
      if ((b.tacKey !== area.key || relocate) && this.tacLeft <= 0 && b.tacKey !== area.key) {
        b.tacX = area.x;
        b.tacZ = area.z;
        b.tacKind = "open";
      } else if (b.tacKey !== area.key || relocate) {
        this.tacLeft--;
        const host = this.tactics;
        let spot: { x: number; z: number } | null = null;
        if (p.role === "sniper") {
          const base = side === "red" ? WAR_BASES.red : WAR_BASES.blue;
          spot = overwatch(host, area.x, area.z, Math.atan2(base.x - area.x, base.z - area.z));
          kind = spot ? "overwatch" : "open";
        }
        if (!spot && (area.defend || Math.random() < 0.35)) {
          spot = coverSpot(host, area.x, area.z, area.r * 0.9, Number.isNaN(threat) ? NaN : threat);
          kind = spot ? "cover" : "open";
        }
        if (!spot) {
          const r = area.r * 0.8 * b.gr;
          spot = this.nav().nearestWalkable(area.x + Math.cos(b.ga) * r, area.z + Math.sin(b.ga) * r, 8) ?? { x: area.x, z: area.z };
          kind = "open";
        }
        b.tacKey = area.key;
        b.tacX = spot.x;
        b.tacZ = spot.z;
        b.tacKind = kind;
        b.shots = 0;
      }
      x = b.tacX;
      z = b.tacZ;
      kind = b.tacKind;
    }
    return { x, z, far: Math.hypot(x - p.x, z - p.z), kind, threat };
  }

  /** Chỗ máy này nên đứng theo đội hình (hay theo lệnh), hoặc null nếu tự do (đội trưởng, máy solo). */
  private formationSpot(id: string, p: PlayerState, b: Brain, tank: boolean): Placement | null {
    if (!p.team) return null;
    if (this.room.state.battleMode === "war") return this.warSpot(id, p, b, tank);
    const s = this.room.state;
    const leaderId = this.leaderOf(p.team);
    const order = this.orders.get(p.team);
    const leader = leaderId && leaderId !== id ? s.players.get(leaderId) : undefined;
    let ax: number;
    let az: number;
    let rot: number;
    if (order && order.kind !== "follow") {
      ax = order.x;
      az = order.z;
      rot = order.rot;
    } else if (leader) {
      ax = leader.x;
      az = leader.z;
      rot = leader.rotY;
    } else return null;
    const [u, v] = tank ? TANK_SLOT : SLOTS[b.slot % SLOTS.length]!;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const x = ax + c * u + sn * v;
    const z = az - sn * u + c * v;
    return { x, z, far: Math.hypot(x - p.x, z - p.z), kind: "open", threat: NaN };
  }

  /**
   * Hướng đi (vector đơn vị) để tới (gx, gz) theo lưới dẫn đường: gần, hay đi thẳng được thì đi thẳng; không thì tìm
   * đường A* (trong hạn mức của nhịp, hết hạn mức thì tạm đi thẳng, nhịp sau tìm). null khi đã tới nơi.
   */
  private steer(p: PlayerState, b: Brain, gx: number, gz: number): [number, number] | null {
    // Đang kẹt: lùi ra chỗ trống gần đó trước đã.
    if (b.unstick > 0) {
      gx = b.ux;
      gz = b.uz;
    }
    const dx = gx - p.x;
    const dz = gz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) return null;
    // Chiến trường: cứ điểm bên kia sông thì đi qua cầu, khúc cạn gần nhất trước (đường tìm ngắn hơn hẳn).
    if (this.room.map.layout === "war") {
      const via = warRoute(p.x, p.z, gx, gz);
      gx = via.x;
      gz = via.z;
    }
    const nav = this.nav();
    const path = b.path;
    const moved = !path || Math.hypot(gx - b.pgx, gz - b.pgz) > Math.max(3, d * 0.15);
    if (moved || b.replan || b.pathI >= path.length) {
      if (d < 4 || nav.clearLine(p.x, p.z, gx, gz)) {
        b.path = [{ x: gx, z: gz }];
      } else if (this.planLeft > 1500) {
        const before = nav.expanded;
        const found = nav.findPath(p.x, p.z, gx, gz, Math.min(3500, this.planLeft));
        this.planLeft -= nav.expanded - before;
        b.path = found && found.length ? found : [{ x: gx, z: gz }];
      } else return [dx / d, dz / d];
      b.pathI = 0;
      b.pgx = gx;
      b.pgz = gz;
      b.replan = false;
    }
    const pts = b.path!;
    let wp = pts[b.pathI]!;
    while (b.pathI < pts.length - 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 1.2) wp = pts[++b.pathI]!;
    const wx = wp.x - p.x;
    const wz = wp.z - p.z;
    const wd = Math.hypot(wx, wz);
    if (wd < 0.6) {
      // Tới cuối đường mà chưa tới đích (đường tìm dở vì hết hạn mức): tìm tiếp.
      b.pathI = pts.length;
      return d > 1.5 ? [dx / d, dz / d] : null;
    }
    return [wx / wd, wz / wd];
  }

  /**
   * Bước đi một nhịp theo hướng (mx, mz): tránh tường, nước sâu; vướng thì thử lách sang hai bên; đi mãi không nhích
   * được thì tìm đường lại, vẫn kẹt thì lùi ra chỗ trống gần đó.
   */
  private stepMove(p: PlayerState, b: Brain, mx: number, mz: number, speed: number, dt: number) {
    const room = this.room;
    if (!mx && !mz) {
      p.moving = false;
      b.progT = 0;
      b.progX = p.x;
      b.progZ = p.z;
      return;
    }
    const base = Math.atan2(mx, mz);
    let stepped = false;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0]) {
      const a = base + off;
      const nx = p.x + Math.sin(a) * speed * dt;
      const nz = p.z + Math.cos(a) * speed * dt;
      const ny = this.height(nx, nz);
      // Lội được khúc cạn (nước tới gối), nước sâu thì không.
      if (ny < WATER_LEVEL - 0.7 || ny - p.y > 0.8 || insideBox(room.map.index, nx, ny + 0.9, nz, 0.35)) continue;
      p.x = nx;
      p.z = nz;
      p.y = ny;
      stepped = true;
      break;
    }
    p.moving = stepped;
    if (b.unstick > 0) b.unstick -= dt;
    // Đo tiến độ mỗi 1,2 giây.
    b.progT += dt;
    if (b.progT < 1.2) return;
    const moved = Math.hypot(p.x - b.progX, p.z - b.progZ);
    b.progT = 0;
    b.progX = p.x;
    b.progZ = p.z;
    if (moved > speed * 0.25) {
      b.stuckN = 0;
      return;
    }
    b.stuckN++;
    b.replan = true;
    if (b.stuckN >= 2) {
      // Kẹt thật: chọn một chỗ đi được cách 4–9 m rồi lùi ra đó, xong mới tìm đường lại.
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 5;
      const spot = this.nav().nearestWalkable(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 4);
      if (spot) {
        b.ux = spot.x;
        b.uz = spot.z;
        b.unstick = 1.6;
        b.path = null;
      }
      if (!p.team) this.pickWaypoint(b);
    }
  }

  /** Quay mặt canh gác: hướng thoáng về phía địch (tính lại vài giây một lần), quét qua lại nhẹ. */
  private guard(p: PlayerState, b: Brain, threat: number, dt: number) {
    if (this.time >= b.lookAt) {
      b.lookAt = this.time + 3 + Math.random() * 3;
      b.lookYaw = lookOut(this.tactics, p.x, p.y + (p.prone ? 0.4 : p.crouching ? 1.0 : 1.5) - 1.4, p.z, threat);
    }
    const want = b.lookYaw + Math.sin(this.time * 0.5 + b.slot) * 0.45;
    const diff = Math.atan2(Math.sin(want - p.rotY), Math.cos(want - p.rotY));
    p.rotY += diff * Math.min(1, dt * 3);
  }

  private tickSoldier(id: string, p: PlayerState, b: Brain, alive: [string, PlayerState][], dt: number) {
    const room = this.room;
    const s = room.state;
    const eyeH = p.prone ? 0.35 : p.crouching ? 1.05 : 1.55;
    const eye: [number, number, number] = [p.x, p.y + eyeH, p.z];
    // Bắn tỉa đã vào chỗ rình: nhìn xa hơn hẳn (ống ngắm 8x).
    const range = (SIGHT[p.role] ?? SIGHT[""]!) * (b.tacKind === "overwatch" && p.prone ? 1.5 : 1);
    b.scan -= dt;
    if (b.scan <= 0) {
      b.scan = 0.3 + Math.random() * 0.1;
      const had = b.sees;
      this.scan(id, p, b, alive, eye, range, true, false);
      if (had && !b.sees) b.lostAt = this.time;
    }

    const target = b.target ? s.players.get(b.target) : undefined;
    const kit = p.kit;
    if (!isGunSlot(kit.active) && kit.primary1) kit.active = "primary1";
    const slot = isGunSlot(kit.active) ? kit.active : null;
    const def = slot ? weaponIn(kit, slot) : undefined;
    if (slot && def && magOf(kit, slot) === 0 && !kit.reloading) room.reload(id);
    b.nade -= dt;
    b.smokeCd -= dt;

    // Có RPG: thấy xe tăng địch trong tầm thì đổi sang RPG, ngắm (bù đạn rơi) rồi bắn; không thì cầm lại súng chính.
    if (this.antiTank(id, p, b, eye, dt, target)) return;
    // Có IGLA: thấy trực thăng địch đang bay thì ngắm giữ khoá rồi phóng tên lửa đuổi theo.
    if (this.antiAir(id, p, b, eye, dt, target)) return;

    let mx = 0;
    let mz = 0;
    let goal: { x: number; z: number } | null = null;
    let speed = 5;
    let faceMove = true;
    const spot = this.formationSpot(id, p, b, false);
    const order = p.team ? this.orders.get(p.team) : undefined;
    const board = this.boardStep(id, p);
    const battle = s.phase === "battle";
    if (board) {
      // Lệnh lên xe: chạy tới xe (theo đường đi được), không dừng lại đấu súng.
      if (p.vehicle) return;
      goal = board;
      speed = 7.8;
      p.aiming = p.prone = p.crouching = false;
      p.aimPitch = 0;
    } else if (b.retreat > 0) {
      // Rút lui sau màn khói: chạy về chỗ nấp phía sau, không đấu súng.
      b.retreat -= dt;
      goal = { x: b.rx, z: b.rz };
      speed = 7.2;
      p.aiming = p.prone = p.crouching = false;
    } else if (target && target.alive && battle && !b.sees) {
      // Mất dấu: tuỳ vai. Súng máy xả áp chế vào chỗ địch vừa nấp; tay súng ném lựu đạn vào chỗ đó; bắn tỉa nằm yên
      // rình tiếp; còn lại đi dò tới chỗ thấy lần cuối (máy theo đội không đi quá xa đội hình), súng chĩa về đó.
      const dx = b.lx - p.x;
      const dz = b.lz - p.z;
      const d = Math.hypot(dx, dz) || 1;
      p.rotY = Math.atan2(dx, dz);
      p.aimPitch = Math.atan2(b.ly + 1 - eye[1], d);
      faceMove = false;
      const since = this.time - b.lostAt;
      if (kit.frag > 0 && b.nade <= 0 && d > 7 && d < 32 && since < 5 && p.role !== "sniper") {
        this.lob(id, p, b.lx, b.ly, b.lz, "frag");
      } else if (p.role === "support" && since < 2.5 && d < 90 && def && slot && !kit.reloading && magOf(kit, slot) > 0) {
        p.crouching = true;
        p.aiming = true;
        this.suppress(id, b, dt, def.id, eye, b.lx, b.ly + 1, b.lz);
      } else if (p.role === "sniper" && b.tacKind === "overwatch") {
        p.aiming = true;
      } else {
        p.aiming = false;
        p.prone = false;
        // Giữ chốt: không rời vị trí quá 12 m; tới điểm & tấn công: được truy địch xa hơn (45 m).
        const leash = spot && spot.far > (order?.kind === "hold" || spot.kind === "cover" ? 12 : order?.kind === "move" ? 45 : 30);
        if (d > 2.5 && !leash) {
          goal = { x: b.lx, z: b.lz };
          speed = 4;
        } else if (spot && spot.far > 3) {
          goal = spot;
          speed = 6;
          faceMove = true;
        }
      }
    } else if (target && target.alive && battle) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      p.rotY = Math.atan2(dx, dz);
      p.aimPitch = Math.atan2(target.y + (target.prone ? 0.3 : 1.1) - eye[1], d);
      p.aiming = d > 25;
      faceMove = false;
      // Tư thế khi đấu súng: bắn tỉa nằm bắn từ xa, súng máy ngồi, tay súng trường né qua lại.
      const hold = p.role === "sniper" || p.role === "support" || b.tacKind === "cover";
      if (p.role === "sniper" && d > 30) {
        p.prone = true;
        p.crouching = false;
      } else if ((p.role === "support" && d > 20) || b.tacKind === "cover") {
        p.crouching = true;
        p.prone = false;
      } else p.prone = false;
      if (!hold || d < 15) {
        b.strafe -= dt;
        if (b.strafe < -1.2) b.strafe = 1.2 * Math.random() + 0.3;
        const side = b.strafe > 0 ? 1 : -1;
        mx = (-dz / d) * side * 0.6;
        mz = (dx / d) * side * 0.6;
        speed = p.crouching ? 2 : 3;
      }
      // Máu thấp mà còn khói: ném khói chắn giữa hai bên rồi rút về phía sau.
      if (p.hp < 40 && kit.smoke > 0 && b.smokeCd <= 0 && d > 12) {
        b.smokeCd = 20;
        this.lob(id, p, p.x + (dx / d) * 7, p.y, p.z + (dz / d) * 7, "smoke");
        const back = this.nav().nearestWalkable(p.x - (dx / d) * 22, p.z - (dz / d) * 22, 8);
        if (back) {
          b.retreat = 4;
          b.rx = back.x;
          b.rz = back.z;
        }
      }
      // Lựu đạn vào đám địch đứng sát nhau, hay địch nấp sau vật chắn thấp (ngồi, nằm) ở tầm ném.
      if (kit.frag > 0 && b.nade <= 0 && d > 9 && d < 30 && p.role !== "sniper" && (target.crouching || target.prone || this.crowdAround(target, p, alive) >= 1)) {
        this.lob(id, p, target.x, target.y, target.z, "frag");
      }
      // Phục kích: nấp chờ địch tới gần mới nổ súng (trừ khi đã bị bắn); bắn tỉa thì bắn từ xa.
      const ambush = b.tacKind === "cover" && d > 45 && this.time - b.hurtAt > 4 && p.role !== "sniper";
      if (b.react > 0) b.react -= dt;
      else if (def && slot && !kit.reloading && !ambush) {
        const before = b.burst;
        this.shoot(id, b, dt, def.id, eye, target, d);
        if (p.role === "sniper" && b.burst !== before) b.shots++;
      }
    } else {
      p.aiming = false;
      const z = s.zone;
      if (spot) {
        // Tới chỗ của mình (theo đội hình, theo vai); xa thì chạy; tới nơi thì đứng canh theo vai.
        if (spot.far > 2) {
          goal = spot;
          speed = spot.far > 14 ? 7.8 : spot.far > 6 ? 5.6 : 3.5;
          p.crouching = false;
          p.prone = false;
        } else {
          faceMove = false;
          if (spot.kind === "overwatch") {
            p.prone = true;
            p.crouching = false;
          } else {
            p.prone = false;
            p.crouching = spot.kind === "cover" || order?.kind === "hold" || order?.kind === "move" || s.battleMode === "war";
          }
          const leader = s.players.get(this.leaderOf(p.team));
          // Giữ chốt (Đồng đội): mỗi máy canh một hướng, quay lưng vào giữa. Chiến trường: nhìn ra phía địch tới.
          if (s.battleMode === "war") this.guard(p, b, spot.threat, dt);
          else if (order?.kind === "hold" && Math.hypot(spot.x - order.x, spot.z - order.z) > 1) this.guard(p, b, Math.atan2(spot.x - order.x, spot.z - order.z), dt);
          else if (leader) p.rotY = leader.rotY + ((b.slot % 2 ? 1 : -1) * (0.4 + (b.slot >> 1) * 0.5));
        }
      } else {
        p.crouching = false;
        p.prone = false;
        // Đi về điểm đích trong vùng an toàn; tới nơi hoặc vùng đổi thì chọn điểm mới.
        const inNext = Math.hypot(b.wx - z.nx, b.wz - z.nz) < Math.max(8, z.nr * 0.8);
        if (Math.hypot(b.wx - p.x, b.wz - p.z) < 3 || (s.phase === "battle" && !inNext)) this.pickWaypoint(b);
        goal = { x: b.wx, z: b.wz };
        const outside = Math.hypot(p.x - z.x, p.z - z.z) > z.r - 5;
        // Đội trưởng máy đi chậm lại cho đội theo kịp.
        speed = outside ? 7.5 : p.team ? 4.2 : 5;
      }
      if (!b.target) p.aimPitch = 0;
    }
    if (goal) {
      const dir = this.steer(p, b, goal.x, goal.z);
      if (dir) {
        mx = dir[0];
        mz = dir[1];
        if (faceMove) p.rotY = Math.atan2(mx, mz);
      }
    }
    if (p.prone) speed = Math.min(speed, 1.2);
    this.stepMove(p, b, mx, mz, speed, dt);
    // Xe tăng địch tới gần: súng không xuyên được thép, ném lựu đạn vào.
    if (b.nade <= 0 && kit.frag > 0 && battle) {
      this.throwAtTank(id, p, eye);
      if (b.nade <= 0) b.nade = 1;
    }
    // Máu thấp mà không ai bắn thì băng bó.
    if (!target && p.hp < 60 && kit.bandage > 0 && !kit.healing) this.heal(id);
  }

  /** Số địch khác (cùng phe với `target`) đứng trong vòng 5 m quanh nó: đáng một quả lựu đạn. */
  private crowdAround(target: PlayerState, me: PlayerState, alive: [string, PlayerState][]): number {
    let n = 0;
    for (const [, o] of alive) {
      if (o === target || !this.hostile(me, o) || o.vehicle) continue;
      if (Math.abs(o.x - target.x) < 5 && Math.abs(o.z - target.z) < 5) n++;
    }
    return n;
  }

  /** Ném lựu đạn (hay khói) theo đường cầu vồng rơi đúng (tx, ty, tz), lệch chút ít theo khoảng cách. */
  private lob(id: string, p: PlayerState, tx: number, ty: number, tz: number, kind: "frag" | "smoke") {
    const o: [number, number, number] = [p.x, p.y + 1.5, p.z];
    const dist = Math.hypot(tx - o[0], tz - o[2]);
    const err = 0.8 + dist * 0.06;
    const ax = tx + (Math.random() - 0.5) * 2 * err;
    const az = tz + (Math.random() - 0.5) * 2 * err;
    const dx = ax - o[0];
    const dz = az - o[2];
    const dy = ty + 0.3 - o[1];
    // Bay ngang ~13 m/s, trọng lực server 20 m/s²; xa thì ném cao hơn cho qua tường, mép cửa sổ.
    const T = Math.max(0.6, Math.hypot(dx, dz) / 12);
    p.rotY = Math.atan2(dx, dz);
    this.room.throwGrenade(id, kind, o, [dx / T, (dy + 0.5 * 20 * T * T) / T, dz / T]);
    const b = this.brains.get(id);
    if (b && kind === "frag") b.nade = 9 + Math.random() * 6;
  }

  /** Súng máy bắn áp chế vào chỗ địch vừa nấp (không trúng ai, chỉ ghìm đầu, người chơi thấy đạn vèo qua). */
  private suppress(id: string, b: Brain, dt: number, weaponId: string, eye: [number, number, number], x: number, y: number, z: number) {
    const def = WEAPON.get(weaponId)!;
    if (b.pause > 0) {
      b.pause -= dt;
      return;
    }
    if (b.burst <= 0) b.burst = 4 + Math.floor(Math.random() * 5);
    const a = Math.random() * Math.PI * 2;
    const spread = 0.8 + Math.random() * 1.5;
    this.room.fire(id, weaponId, eye, [[x + Math.cos(a) * spread - eye[0], y + Math.sin(a) * spread * 0.5 - eye[1], z + Math.sin(a) * spread - eye[2]]], []);
    b.burst -= 1;
    b.pause = b.burst <= 0 ? 0.5 + Math.random() * 0.5 : 60 / def.rpm;
  }

  /** Máy mang RPG bắn xe tăng địch thấy được trong tầm. Trả về true nếu lượt này đang lo bắn xe (không đi lại). */
  private antiTank(id: string, p: PlayerState, b: Brain, eye: [number, number, number], dt: number, infantry: PlayerState | undefined): boolean {
    const s = this.room.state;
    const kit = p.kit;
    const rpgSlot = kit.primary1 === "rpg7" ? "primary1" : kit.primary2 === "rpg7" ? "primary2" : "";
    if (!rpgSlot || s.phase !== "battle") return false;
    const rockets = magOf(kit, rpgSlot) + (kit.ammo.get("rocket") ?? 0);
    b.atScan -= dt;
    if (b.atScan <= 0) {
      b.atScan = 0.5 + Math.random() * 0.2;
      b.at = "";
      let bestD = 150;
      if (rockets > 0)
        for (const v of s.vehicles.values()) {
          if (v.hp <= 0 || !v.driver) continue;
          const driver = s.players.get(v.driver);
          if (!driver || !this.hostile(p, driver)) continue;
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          // RPG không điều khiển: chỉ bắn trực thăng đang lơ lửng thấp (đáp, cất cánh) trong tầm gần.
          if (v.kind === "heli" && (v.y - this.height(v.x, v.z) > 10 || d > 90 || this.heliShielded(v, driver.vehicle))) continue;
          if (d > bestD || d < 8 || !this.visible(eye, v.x, v.y + 1.4, v.z)) continue;
          b.at = v.driver;
          bestD = d;
        }
    }
    // Lính địch sát bên thì lo bắn người trước.
    const closeInfantry = infantry && b.sees && Math.hypot(infantry.x - p.x, infantry.z - p.z) < 25;
    const tank = b.at && !closeInfantry ? s.players.get(b.at) : undefined;
    if (!tank || !tank.alive || !tank.vehicle) {
      if (kit.active === rpgSlot && kit.primary1 && rpgSlot !== "primary1") kit.active = "primary1";
      return false;
    }
    const v = s.vehicles.get(tank.vehicle);
    if (!v) return false;
    if (kit.active !== rpgSlot) {
      kit.active = rpgSlot;
      kit.reloading = false;
      b.pause = 0.8;
    }
    const def = WEAPON.get("rpg7")!;
    const dx = v.x - p.x;
    const dz = v.z - p.z;
    const d = Math.hypot(dx, dz);
    p.rotY = Math.atan2(dx, dz);
    p.aiming = true;
    p.moving = false;
    p.crouching = true;
    p.prone = false;
    const rocketEye: [number, number, number] = [p.x, p.y + 1.2, p.z];
    // Ngẩng thêm để bù đạn rơi (đạn bay chậm, rơi nhiều ở xa), lệch chút ít theo khoảng cách.
    const flight = flightTime(def.velocity, d, def.boost);
    const drop = 0.5 * 9.81 * flight * flight;
    // Trực thăng nhỏ, chao liệng: khó trúng hơn xe tăng nhiều.
    const err = (0.012 + d * 0.00012) * (v.kind === "heli" ? 3 : 1);
    const ty = v.y + 1.2 + drop - rocketEye[1];
    const aimYaw = Math.atan2(dx, dz) + (Math.random() - 0.5) * 2 * err;
    const aimPitch = Math.atan2(ty, d) + (Math.random() - 0.5) * err;
    p.aimPitch = aimPitch;
    if (magOf(kit, rpgSlot) === 0) {
      if (!kit.reloading) this.room.reload(id);
      return true;
    }
    if (b.pause > 0) {
      b.pause -= dt;
      return true;
    }
    const cp = Math.cos(aimPitch);
    this.room.fire(id, "rpg7", rocketEye, [[Math.sin(aimYaw) * cp, Math.sin(aimPitch), Math.cos(aimYaw) * cp]], []);
    b.pause = 1.5 + Math.random();
    return true;
  }

  /**
   * Máy mang IGLA: trực thăng địch đang bay trong tầm, thấy được thì cầm IGLA, chĩa theo, giữ khoá (như người chơi giữ
   * tâm ngắm) tới khi khoá chín thì phóng. Lính địch sát bên thì lo bắn người trước. Trả về true khi đang lo việc này.
   */
  private antiAir(id: string, p: PlayerState, b: Brain, eye: [number, number, number], dt: number, infantry: PlayerState | undefined): boolean {
    const s = this.room.state;
    const kit = p.kit;
    const slot = kit.primary1 === "igla" ? "primary1" : kit.primary2 === "igla" ? "primary2" : "";
    if (!slot || s.phase !== "battle") return false;
    const missiles = magOf(kit, slot) + (kit.ammo.get("missile") ?? 0);
    const air = this.room.vehicles.air;
    b.atScan -= dt;
    if (b.atScan <= 0) {
      b.atScan = 0.5 + Math.random() * 0.2;
      b.at = "";
      if (missiles > 0)
        for (const [vid, v] of s.vehicles) {
          if (v.kind !== "heli" || v.hp <= 0 || !v.driver) continue;
          const driver = s.players.get(v.driver);
          // Máy chỉ khoá trong tầm gần hơn người (260 m), không đụng trực thăng còn trong vùng trời nhà, và mỗi trực
          // thăng chỉ một máy khoá cùng lúc (không bị cả chục tên lửa từ khắp nơi bay tới một lúc).
          if (!driver || !this.hostile(p, driver) || Math.hypot(v.x - p.x, v.z - p.z) > BOT_AA_RANGE || this.heliShielded(v, vid)) continue;
          const claim = this.aaClaim.get(vid);
          if (claim && claim.by !== id && claim.until > this.time) continue;
          const was = kit.active;
          kit.active = slot;
          const ok = air.canLock(id, vid);
          kit.active = was;
          if (ok) {
            b.at = vid;
            this.aaClaim.set(vid, { by: id, until: this.time + 6 });
            break;
          }
        }
    }
    const closeInfantry = infantry && b.sees && Math.hypot(infantry.x - p.x, infantry.z - p.z) < 25;
    const v = b.at && !closeInfantry ? s.vehicles.get(b.at) : undefined;
    if (!v || v.hp <= 0) {
      if (kit.active === slot && kit.primary1 && slot !== "primary1") kit.active = "primary1";
      return false;
    }
    if (kit.active !== slot) {
      kit.active = slot;
      kit.reloading = false;
    }
    const dx = v.x - p.x;
    const dz = v.z - p.z;
    const d = Math.hypot(dx, dz);
    const o: [number, number, number] = [p.x, p.y + 1.55, p.z];
    p.rotY = Math.atan2(dx, dz);
    p.aimPitch = Math.atan2(v.y + 1.2 - o[1], d);
    p.aiming = true;
    p.moving = false;
    p.crouching = false;
    p.prone = false;
    if (magOf(kit, slot) === 0) {
      if (!kit.reloading) this.room.reload(id);
      return true;
    }
    air.lock(id, b.at);
    if (air.lockReadyFor(id)) {
      const cp = Math.cos(p.aimPitch);
      this.room.fire(id, "igla", o, [[Math.sin(p.rotY) * cp, Math.sin(p.aimPitch), Math.cos(p.rotY) * cp]], []);
      // Bắn xong thì giữ lượt khoá trực thăng này thêm một lúc (máy khác không khoá tiếp ngay), tự mình nghỉ lâu.
      this.aaClaim.set(b.at, { by: id, until: this.time + 14 });
      b.atScan = 12 + Math.random() * 6;
      b.at = "";
    }
    return true;
  }

  /** Ném lựu đạn vào xe tăng địch gần nhất trong tầm ném (thấy được): tính quỹ đạo cầu vồng rơi đúng chỗ xe. */
  private throwAtTank(id: string, p: PlayerState, eye: [number, number, number]) {
    const s = this.room.state;
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = 26;
    for (const v of s.vehicles.values()) {
      if (v.hp <= 0 || !v.driver) continue;
      const driver = s.players.get(v.driver);
      if (!driver || !this.hostile(p, driver)) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d > bestD || d < 6) continue;
      if (!this.visible(eye, v.x, v.y + 1.5, v.z)) continue;
      best = v;
      bestD = d;
    }
    if (!best) return;
    // Bay ngang ~13 m/s, trọng lực server 20 m/s²; lệch chút ít.
    const o: [number, number, number] = [p.x, p.y + 1.5, p.z];
    const tx = best.x + (Math.random() - 0.5) * 2.5;
    const tz = best.z + (Math.random() - 0.5) * 2.5;
    const dx = tx - o[0];
    const dz = tz - o[2];
    const dy = best.y + 0.6 - o[1];
    const T = Math.max(0.6, Math.hypot(dx, dz) / 13);
    p.rotY = Math.atan2(dx, dz);
    this.room.throwGrenade(id, "frag", o, [dx / T, (dy + 0.5 * 20 * T * T) / T, dz / T]);
    const b = this.brains.get(id);
    if (b) b.nade = 6 + Math.random() * 4;
  }

  /** Máy lái xe tăng: theo đội hình (hay đi lang thang), tháp pháo quay về kẻ địch thấy được, ngắm xong thì bắn. */
  private tickTanker(id: string, p: PlayerState, b: Brain, tank: { x: number; y: number; z: number; rotY: number; turret: number; pitch: number }, alive: [string, PlayerState][], dt: number) {
    const room = this.room;
    const s = room.state;
    const eye: [number, number, number] = [tank.x, tank.y + TANK.gunY + 0.4, tank.z];
    b.scan -= dt;
    if (b.scan <= 0) {
      b.scan = 0.35 + Math.random() * 0.1;
      this.scan(id, p, b, alive, eye, SIGHT.tanker!, false, true);
    }
    const target = b.sees && b.target ? s.players.get(b.target) : undefined;
    // Đi đâu: theo đội hình; không có đội trưởng thì lang thang trong vùng; đang bắn nhau thì dừng lại cho bắn trúng.
    let goal: { x: number; z: number } | null = null;
    const spot = this.formationSpot(id, p, b, true);
    if (spot) goal = spot.far > 7 ? spot : null;
    else {
      const z = s.zone;
      const inNext = Math.hypot(b.wx - z.nx, b.wz - z.nz) < Math.max(8, z.nr * 0.8);
      if (Math.hypot(b.wx - tank.x, b.wz - tank.z) < 8 || (s.phase === "battle" && !inNext)) this.pickWaypoint(b);
      goal = { x: b.wx, z: b.wz };
    }
    if (target && Math.hypot(target.x - tank.x, target.z - tank.z) < 90 && (!spot || spot.far < 40)) goal = null;
    // Đội trưởng (người chơi) đi tới sát xe: dừng lại chờ (có thể họ muốn lên lái).
    const leader = p.team ? s.players.get(this.leaderOf(p.team)) : undefined;
    if (leader && !leader.bot && Math.hypot(leader.x - tank.x, leader.z - tank.z) < 12) goal = null;
    room.vehicles.driveAI(p.vehicle, id, b, goal, target && s.phase === "battle" ? target : null, dt);
  }

  private heal(id: string) {
    const p = this.room.state.players.get(id)!;
    p.kit.bandage -= 1;
    p.hp = Math.min(75, p.hp + 15);
  }

  /** Tia nhìn từ mắt tới điểm: không bị khói, nhà, xe tăng, đồi che. */
  visible(eye: [number, number, number], x: number, y: number, z: number): boolean {
    const dx = x - eye[0];
    const dy = y - eye[1];
    const dz = z - eye[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const dir: [number, number, number] = [dx / d, dy / d, dz / d];
    // Khói che tầm nhìn.
    for (const smoke of this.room.state.smokes.values()) {
      const t = (smoke.x - eye[0]) * dir[0] + (smoke.y + SMOKE_SIGHT.lift - eye[1]) * dir[1] + (smoke.z - eye[2]) * dir[2];
      if (t < 0 || t > d) continue;
      const px = eye[0] + dir[0] * t - smoke.x;
      const py = eye[1] + dir[1] * t - smoke.y - SMOKE_SIGHT.lift;
      const pz = eye[2] + dir[2] * t - smoke.z;
      // Lựu đạn vừa thổi thủng một khoảng trong khói thì nhìn xuyên qua được chỗ đó.
      if (smoke.clear > 0 && Math.hypot(px + smoke.x - smoke.cx, pz + smoke.z - smoke.cz) < SMOKE_CLEAR.radius) continue;
      if (Math.hypot(px, py, pz) < SMOKE_SIGHT.radius) return false;
    }
    // Địa hình: dò thưa từng 2,5 m trên lưới độ cao (rẻ hơn nhiều so với dò từng mét).
    const len = d - 0.5;
    for (let t = 2.5; t < len; t += 2.5) {
      if (eye[1] + dir[1] * t < this.height(eye[0] + dir[0] * t, eye[2] + dir[2] * t) + 0.1) return false;
    }
    // Thân cây cũng che (client có va chạm thân cây): nấp sau gốc cây thì máy không thấy, không bắn xuyên được.
    return raycastBoxes(this.room.map.index, eye, dir, len, true) === Infinity && raycastTrunks(this.room.map.world, eye, dir, len, this.room.map.treeDead) === Infinity;
  }

  private shoot(id: string, b: Brain, dt: number, weaponId: string, eye: [number, number, number], target: PlayerState, d: number) {
    const me = this.room.state.players.get(id);
    // Bị bom choáng loá mắt thì không bắn được.
    if (!me || me.blind > 0) return;
    const def = WEAPON.get(weaponId)!;
    if (b.pause > 0) {
      b.pause -= dt;
      return;
    }
    if (b.burst <= 0) b.burst = def.auto ? (def.class === "lmg" ? 6 : 3) + Math.floor(Math.random() * 5) : 1;
    let targetId = "";
    for (const [tid, t] of this.room.state.players) if (t === target) targetId = tid;
    const aimY = target.y + (target.prone ? 0.25 : target.crouching ? 0.8 : 1.2);
    // Dò lại tầm nhìn ngay lúc bóp cò (lần dò định kỳ cách 0,3–0,4 s): người chơi vừa lách vào sau tường, gốc cây
    // thì máy thôi bắn, thay vì xả thêm một loạt vào chỗ nấp như thể nhìn xuyên tường.
    if (!this.visible(eye, target.x, aimY, target.z)) {
      b.sees = false;
      b.burst = 0;
      return;
    }
    // Máy bắn kém dần theo khoảng cách, bắn liền nhiều phát thì kém đi (giật súng). Bắn tỉa, nằm bắn thì giữ chính xác xa hơn.
    const reach = def.class === "sniper" ? 420 : def.class === "dmr" ? 260 : 140;
    let chance = Math.max(0.05, Math.min(def.class === "sniper" ? 0.55 : 0.42, 0.5 - d / reach));
    if (me.prone || me.crouching) chance *= 1.15;
    if (target.prone) chance *= 0.6;
    else if (target.crouching) chance *= 0.8;
    if (target.moving) chance *= 0.8;
    const pellets = def.pellets;
    const rays: [number, number, number][] = [];
    const hits: { target: string; part: "head" | "body"; d: number; ray: number }[] = [];
    for (let k = 0; k < pellets; k++) {
      const hit = Math.random() < chance;
      const miss = hit ? 0.15 : 1.2 + Math.random() * 1.5;
      const a = Math.random() * Math.PI * 2;
      const lie = target.prone && hit;
      const tx = target.x + Math.cos(a) * miss * (hit ? 0.3 : 1) + (lie ? Math.sin(target.rotY) * 0.1 : 0);
      const ty = aimY + Math.sin(a) * miss * (lie ? 0.15 : 0.6);
      const tz = target.z + Math.sin(a) * miss * (hit ? 0.3 : 1) + (lie ? Math.cos(target.rotY) * 0.1 : 0);
      rays.push([tx - eye[0], ty - eye[1], tz - eye[2]]);
      if (hit) hits.push({ target: targetId, part: Math.random() < (def.class === "sniper" ? 0.18 : 0.08) ? "head" : "body", d: Math.hypot(tx - eye[0], ty - eye[1], tz - eye[2]), ray: k });
    }
    // Đầu nòng ngay trước mặt.
    this.room.fire(id, weaponId, eye, rays, hits);
    b.burst -= 1;
    if (b.burst <= 0) b.pause = 0.35 + Math.random() * 0.6 + (def.auto ? 0 : 0.4);
    else b.pause = 60 / def.rpm;
  }

  private pickWaypoint(b: Brain) {
    const s = this.room.state;
    const z = s.zone;
    const map = this.room.map;
    const mf = map.sites.find((x) => x.kind === "minefield");
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * Math.max(10, Math.min(z.nr || 150, 150) * 0.85);
      const x = (s.phase === "battle" ? z.nx : 0) + Math.cos(a) * r;
      const zz = (s.phase === "battle" ? z.nz : 0) + Math.sin(a) * r;
      if (this.height(x, zz) < 0.8 || !this.nav().walkable(x, zz)) continue;
      if (mf && Math.hypot(x - mf.x, zz - mf.z) < Math.max(mf.rx, mf.rz) + 4) continue;
      b.wx = x;
      b.wz = zz;
      return;
    }
  }
}
