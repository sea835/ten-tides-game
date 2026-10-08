import { WATER_LEVEL, insideBox, raycastBoxes, type BattleMap } from "@tentides/content";

// Lưới dẫn đường cho máy (bot): chia bản đồ thành ô CELL mét, mỗi ô đi được hay không (nước sâu, trong tường, trong
// khối nhà), mỗi cạnh giữa hai ô kề có đi qua được không (tường mỏng chắn giữa, dốc quá đứng). Tính lười: chỉ dò ô,
// cạnh nào thuật toán tìm đường chạm tới, rồi nhớ lại (bản đồ chiến trường ~450 × 450 ô, dò hết từ đầu thì khựng
// lúc vào trận). Tìm đường bằng A* (8 hướng, không cắt góc tường) có giới hạn số ô duyệt: hết hạn mức thì trả về
// đường tới ô gần đích nhất đã thấy, máy đi tới đó rồi tìm tiếp. Đường tìm được làm mượt (bỏ các điểm giữa khi đi
// thẳng được) để máy không đi zíc zắc theo ô lưới. Tường bị phá, nhà sập: dò lại vùng đó.

const CELL = 1.5;
/** Mắt cá tới hông: độ cao dò tường so với mặt đất, và bán kính thân người. */
const PROBE_Y = 0.9;
const BODY = 0.35;
/** Chênh độ cao tối đa giữa hai ô kề (m) mà vẫn leo được. */
const MAX_STEP = 1.2;
/** Nước sâu hơn mức này dưới mặt biển thì không lội qua (khớp bước đi của máy). */
const DEEP = WATER_LEVEL - 0.7;

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export interface NavPoint {
  x: number;
  z: number;
}

/** Hàng đợi ưu tiên nhị phân (chỉ số ô, khoá f) dùng lại giữa các lần tìm. */
class Heap {
  private ids = new Int32Array(1024);
  private keys = new Float32Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(id: number, key: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      this.ids = ids;
      const keys = new Float32Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.ids[i] = this.ids[p]!;
      this.keys[i] = this.keys[p]!;
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids[--this.size]!;
    const lastKey = this.keys[this.size]!;
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1]! < this.keys[c]!) c++;
      if (this.keys[c]! >= lastKey) break;
      this.ids[i] = this.ids[c]!;
      this.keys[i] = this.keys[c]!;
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

export class NavGrid {
  readonly n: number;
  private readonly half: number;
  /** Ô: 0 chưa dò, 1 đi được, 2 không. */
  private readonly cell: Uint8Array;
  /** Cạnh theo 8 hướng (2 bit mỗi hướng: 0 chưa dò, 1 qua được, 2 bị chặn). */
  private readonly edge: Uint16Array;
  private readonly heightCache: Float32Array;
  /** Hệ số chi phí thêm theo ô (bãi mìn...), 1 là bình thường. */
  private readonly cost: (x: number, z: number) => number;
  // Bộ nhớ dùng lại cho A*.
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private readonly heap = new Heap();
  /** Bản sao trạng thái khối đã vỡ, để biết khối nào mới vỡ mà dò lại vùng đó. */
  private deadSeen: Uint8Array | null = null;
  /** Số ô đã duyệt (thống kê, kiểm thử). */
  expanded = 0;

  constructor(
    private readonly map: BattleMap,
    private readonly heightAt: (x: number, z: number) => number,
    cost?: (x: number, z: number) => number,
  ) {
    this.half = map.half ?? 240;
    this.n = Math.ceil((this.half * 2) / CELL);
    const size = this.n * this.n;
    this.cell = new Uint8Array(size);
    this.edge = new Uint16Array(size);
    this.heightCache = new Float32Array(size).fill(NaN);
    this.g = new Float32Array(size);
    this.parent = new Int32Array(size);
    this.stamp = new Uint32Array(size);
    this.closed = new Uint32Array(size);
    this.cost = cost ?? (() => 1);
    if (map.index.dead) this.deadSeen = map.index.dead.slice();
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x + this.half) / CELL);
    const j = Math.floor((z + this.half) / CELL);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  private cx(id: number): number {
    return -this.half + ((id % this.n) + 0.5) * CELL;
  }

  private cz(id: number): number {
    return -this.half + (Math.floor(id / this.n) + 0.5) * CELL;
  }

  /** Ô lưới khối (16 m) chứa điểm này không có khối nào: khỏi dò tường (phần lớn bản đồ là đồng trống). */
  private bare(x: number, z: number): boolean {
    const index = this.map.index;
    const list = index.grid.get((Math.floor(x / index.cell) + 32768) * 65536 + (Math.floor(z / index.cell) + 32768));
    return !list || list.length === 0;
  }

  private h(id: number): number {
    let v = this.heightCache[id]!;
    if (Number.isNaN(v)) {
      v = this.heightAt(this.cx(id), this.cz(id));
      this.heightCache[id] = v;
    }
    return v;
  }

  private open(id: number): boolean {
    let c = this.cell[id]!;
    if (c === 0) {
      const x = this.cx(id);
      const z = this.cz(id);
      const y = this.h(id);
      c = y < DEEP || (!this.bare(x, z) && insideBox(this.map.index, x, y + PROBE_Y, z, BODY)) ? 2 : 1;
      this.cell[id] = c;
    }
    return c === 1;
  }

  /** Đi thẳng từ tâm ô `a` sang ô kề `b` (hướng d) được không. */
  private pass(a: number, b: number, d: number): boolean {
    const bits = (this.edge[a]! >> (d * 2)) & 3;
    if (bits) return bits === 1;
    let ok = this.open(a) && this.open(b);
    if (ok) {
      const ha = this.h(a);
      const hb = this.h(b);
      const len = DIRS[d]![2] * CELL;
      if (Math.abs(hb - ha) > MAX_STEP * DIRS[d]![2]) ok = false;
      else if (this.bare(this.cx(a), this.cz(a)) && this.bare(this.cx(b), this.cz(b))) ok = true;
      else {
        const o: [number, number, number] = [this.cx(a), ha + PROBE_Y, this.cz(a)];
        const dx = this.cx(b) - o[0];
        const dy = hb - ha;
        const dz = this.cz(b) - o[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        ok = raycastBoxes(this.map.index, o, [dx / l, dy / l, dz / l], l) >= l - 0.01 && len > 0;
      }
    }
    this.edge[a] = (this.edge[a]! & ~(3 << (d * 2))) | ((ok ? 1 : 2) << (d * 2));
    return ok;
  }

  private neighbour(id: number, d: number): number {
    const i = id % this.n;
    const j = Math.floor(id / this.n);
    const ni = i + DIRS[d]![0];
    const nj = j + DIRS[d]![1];
    if (ni < 0 || nj < 0 || ni >= this.n || nj >= this.n) return -1;
    return nj * this.n + ni;
  }

  /** Điểm này đứng được không. */
  walkable(x: number, z: number): boolean {
    const id = this.idx(x, z);
    return id >= 0 && this.open(id);
  }

  /** Ô đi được gần (x, z) nhất trong bán kính `r` mét (tìm theo vòng xoắn), hay null. */
  nearestWalkable(x: number, z: number, r = 6): NavPoint | null {
    const id = this.idx(x, z);
    if (id >= 0 && this.open(id)) return { x, z };
    const steps = Math.ceil(r / CELL);
    let best: NavPoint | null = null;
    let bestD = Infinity;
    for (let dj = -steps; dj <= steps; dj++)
      for (let di = -steps; di <= steps; di++) {
        const k = this.idx(x + di * CELL, z + dj * CELL);
        if (k < 0 || !this.open(k)) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = { x: this.cx(k), z: this.cz(k) };
        }
      }
    return best;
  }

  /** Đi thẳng từ A tới B (không vướng tường, nước sâu, vách dốc) được không. */
  clearLine(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    let prev = this.idx(ax, az);
    if (prev < 0 || !this.open(prev)) return false;
    let py = this.heightAt(ax, az);
    for (let k = 1; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps;
      const z = az + ((bz - az) * k) / steps;
      const id = this.idx(x, z);
      if (id < 0 || !this.open(id)) return false;
      const y = this.heightAt(x, z);
      if (Math.abs(y - py) > MAX_STEP) return false;
      if (id !== prev) {
        // Đổi ô: dò tường giữa điểm trước và điểm này.
        const ox = ax + ((bx - ax) * (k - 1)) / steps;
        const oz = az + ((bz - az) * (k - 1)) / steps;
        const dx = x - ox;
        const dy = y - py;
        const dz = z - oz;
        const l = Math.hypot(dx, dy, dz) || 1;
        if (raycastBoxes(this.map.index, [ox, py + PROBE_Y, oz], [dx / l, dy / l, dz / l], l) < l) return false;
        prev = id;
      }
      py = y;
    }
    return true;
  }

  /**
   * Đường đi từ (sx, sz) tới (tx, tz): danh sách điểm (không gồm điểm xuất phát), đã làm mượt. Đích không tới được
   * hay hết hạn mức `budget` ô: đường tới ô gần đích nhất đã duyệt. null nếu đang đứng ở chỗ không có lưới.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, budget = 6000): NavPoint[] | null {
    let start = this.idx(sx, sz);
    if (start < 0) return null;
    if (!this.open(start)) {
      const near = this.nearestWalkable(sx, sz, 3);
      if (!near) return null;
      start = this.idx(near.x, near.z);
    }
    let goal = this.idx(tx, tz);
    if (goal < 0 || !this.open(goal)) {
      const near = this.nearestWalkable(tx, tz, 8);
      goal = near ? this.idx(near.x, near.z) : -1;
    }
    const gx = goal >= 0 ? this.cx(goal) : tx;
    const gz = goal >= 0 ? this.cz(goal) : tz;
    const heur = (id: number) => {
      const dx = Math.abs(this.cx(id) - gx) / CELL;
      const dz = Math.abs(this.cz(id) - gz) / CELL;
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL;
    };
    if (++this.gen >= 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.parent[start] = -1;
    this.stamp[start] = gen;
    heap.push(start, heur(start));
    let best = start;
    let bestH = heur(start);
    let found = -1;
    let used = 0;
    while (heap.size > 0 && used < budget) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      used++;
      if (cur === goal) {
        found = cur;
        break;
      }
      const hc = heur(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      for (let d = 0; d < 8; d++) {
        const nb = this.neighbour(cur, d);
        if (nb < 0 || this.closed[nb] === gen) continue;
        // Đi chéo: hai ô kề vuông góc cũng phải qua được (không lách qua góc tường).
        if (d >= 4) {
          const a = this.neighbour(cur, DIRS[d]![0] > 0 ? 0 : 1);
          const b = this.neighbour(cur, DIRS[d]![1] > 0 ? 2 : 3);
          if (a < 0 || b < 0 || !this.pass(cur, a, DIRS[d]![0] > 0 ? 0 : 1) || !this.pass(cur, b, DIRS[d]![1] > 0 ? 2 : 3)) continue;
        }
        if (!this.pass(cur, nb, d)) continue;
        const ng = this.g[cur]! + DIRS[d]![2] * CELL * this.cost(this.cx(nb), this.cz(nb));
        if (this.stamp[nb] === gen && ng >= this.g[nb]!) continue;
        this.stamp[nb] = gen;
        this.g[nb] = ng;
        this.parent[nb] = cur;
        heap.push(nb, ng + heur(nb));
      }
    }
    this.expanded += used;
    const end = found >= 0 ? found : best;
    const cells: number[] = [];
    for (let c = end; c >= 0 && c !== start; c = this.parent[c]!) cells.push(c);
    cells.reverse();
    const raw: NavPoint[] = cells.map((c) => ({ x: this.cx(c), z: this.cz(c) }));
    // Tới được đúng ô đích: điểm cuối là đích thật (không phải tâm ô).
    if (found >= 0 && raw.length && this.walkable(tx, tz)) raw[raw.length - 1] = { x: tx, z: tz };
    return this.smooth(sx, sz, raw);
  }

  /** Bỏ các điểm giữa khi đi thẳng qua được (nhìn trước tối đa 10 điểm cho rẻ). */
  private smooth(sx: number, sz: number, pts: NavPoint[]): NavPoint[] {
    if (pts.length <= 2) return pts;
    const out: NavPoint[] = [];
    let ax = sx;
    let az = sz;
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 10);
      while (j > i && !this.clearLine(ax, az, pts[j]!.x, pts[j]!.z)) j--;
      out.push(pts[j]!);
      ax = pts[j]!.x;
      az = pts[j]!.z;
      i = j + 1;
    }
    return out;
  }

  /** Khối mới vỡ (tường bị phá, nhà sập): quên kết quả dò quanh chúng để lần sau dò lại. */
  refresh() {
    const dead = this.map.index.dead;
    if (!dead) return;
    if (!this.deadSeen || this.deadSeen.length !== dead.length) {
      this.deadSeen = dead.slice();
      return;
    }
    for (let i = 0; i < dead.length; i++) {
      if (dead[i] === this.deadSeen[i]) continue;
      this.deadSeen[i] = dead[i]!;
      const b = this.map.index.boxes[i]!;
      const r = Math.hypot(b.w, b.d) / 2 + CELL * 2;
      for (let z = b.z - r; z <= b.z + r; z += CELL)
        for (let x = b.x - r; x <= b.x + r; x += CELL) {
          const id = this.idx(x, z);
          if (id < 0) continue;
          this.cell[id] = 0;
          this.edge[id] = 0;
        }
    }
  }
}
