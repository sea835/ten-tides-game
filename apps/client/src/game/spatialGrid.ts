// Lưới băm không gian đều (uniform spatial hash) cho vật đứng yên trên mặt đất: chia mặt phẳng XZ thành ô cạnh `cell`
// mét, mỗi ô giữ danh sách vật nằm trong đó. Hỏi "vật nào trong bán kính r quanh điểm p" chỉ phải xét các ô chạm vòng
// tròn thay vì cả bản đồ: số phép thử tỉ lệ với số vật ở gần, không phải tổng số vật (vài trăm món đồ rơi rải khắp
// đảo, người chơi chỉ thấy vài chục món quanh mình).

export interface GridItem {
  x: number;
  z: number;
}

export class SpatialGrid<T extends GridItem> {
  private readonly cells = new Map<number, Set<T>>();
  private readonly where = new Map<T, number>();

  constructor(private readonly cell: number) {}

  /** Khoá ô (gộp hai chỉ số nguyên vào một số, đủ cho bản đồ ±1 000 000 ô mỗi chiều). */
  private key(cx: number, cz: number): number {
    return (cx + 1_000_000) * 2_000_003 + (cz + 1_000_000);
  }

  private keyOf(x: number, z: number): number {
    return this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
  }

  get size(): number {
    return this.where.size;
  }

  /** Thêm vật, hoặc dời vật đã có sang ô mới nếu nó đã di chuyển. */
  upsert(item: T) {
    const k = this.keyOf(item.x, item.z);
    const old = this.where.get(item);
    if (old === k) return;
    if (old !== undefined) this.cells.get(old)?.delete(item);
    let set = this.cells.get(k);
    if (!set) this.cells.set(k, (set = new Set()));
    set.add(item);
    this.where.set(item, k);
  }

  remove(item: T) {
    const k = this.where.get(item);
    if (k === undefined) return;
    const set = this.cells.get(k);
    set?.delete(item);
    if (set && set.size === 0) this.cells.delete(k);
    this.where.delete(item);
  }

  /** Gọi `visit` cho mọi vật cách (x, z) không quá `radius` mét (đo trên mặt phẳng XZ). */
  query(x: number, z: number, radius: number, visit: (item: T, d2: number) => void) {
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / this.cell);
    const x1 = Math.floor((x + radius) / this.cell);
    const z0 = Math.floor((z - radius) / this.cell);
    const z1 = Math.floor((z + radius) / this.cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const set = this.cells.get(this.key(cx, cz));
        if (!set) continue;
        for (const item of set) {
          const dx = item.x - x;
          const dz = item.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) visit(item, d2);
        }
      }
    }
  }
}
