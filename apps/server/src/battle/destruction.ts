import { boxDurability, treeDurability, trunkRadius, type BattleBox, type BattleMap } from "@tentides/content";
import { Messages, type CollapseMessage, type FxMessage, type IslandState } from "@tentides/protocol";

// Phá huỷ công trình và cây trong trận: tường, vách, bao cát mất độ bền khi trúng đạn, trúng nổ; hết độ bền thì vỡ
// (mất va chạm, đạn và người đi xuyên qua). Toà nhà mất quá nhiều tường thì sập cả nhà (tường, sàn, mái đổ hết, người
// ở trong bị đè). Cây trúng nhiều đạn hay trúng nổ thì gãy đổ theo hướng bị bắn. Mọi thay đổi nằm trong state
// (`broken`, `stumps`) nên người vào giữa trận cũng thấy đúng cảnh đổ nát.

/** Mức hư gửi đi theo bậc (1/16) cho đỡ tốn băng thông: bắn liên thanh vào tường không gửi mỗi viên một lần. */
const LEVEL_STEP = 16;
/** Tỉ lệ tường (tính theo diện tích) đã vỡ để toà nhà sập. */
export const COLLAPSE_RATIO = 0.4;
/** Người đứng trong nhà khi sập mất chừng này máu (mảnh vỡ đè). */
export const COLLAPSE_DAMAGE = 70;
export const BROKEN = 255;

export interface DestructionHost {
  readonly state: IslandState;
  readonly map: BattleMap;
  broadcast(type: string, message: unknown): void;
  /** Gây sát thương lên người (sập nhà đè). */
  crush(id: string, amount: number, attacker: string): void;
}

interface Building {
  boxes: number[];
  /** Diện tích tường phá được (m²), và phần đã vỡ. */
  wallArea: number;
  broken: number;
  collapsed: boolean;
}

export class Destruction {
  private hp = new Float32Array(0);
  private full = new Float32Array(0);
  private treeHp = new Float32Array(0);
  private buildings = new Map<number, Building>();
  constructor(private readonly host: DestructionHost) {}

  /** Dựng lại độ bền cho bản đồ hiện tại (đầu trận, đổi bản đồ): mọi thứ nguyên vẹn. */
  reset() {
    const map = this.host.map;
    if (!map) return;
    const boxes = map.index.boxes;
    this.hp = new Float32Array(boxes.length);
    this.full = new Float32Array(boxes.length);
    this.buildings.clear();
    boxes.forEach((b, i) => {
      const hp = boxDurability(b);
      this.hp[i] = hp;
      this.full[i] = hp;
      if (b.building === undefined) return;
      let g = this.buildings.get(b.building);
      if (!g) this.buildings.set(b.building, (g = { boxes: [], wallArea: 0, broken: 0, collapsed: false }));
      g.boxes.push(i);
      if (b.part === "wall" && hp > 0) g.wallArea += wallArea(b);
    });
    map.index.dead?.fill(0);
    const trees = map.world.trees;
    this.treeHp = new Float32Array(trees.length);
    trees.forEach((t, i) => (this.treeHp[i] = treeDurability(t)));
    map.treeDead?.fill(0);
    this.host.state.broken.clear();
    this.host.state.stumps.clear();
  }

  /** Khối `i` chịu `amount` sát thương (đạn, nổ). `by`: người gây ra (để tính công khi nhà sập đè người). */
  hitBox(i: number, amount: number, by = "") {
    const full = this.full[i] ?? 0;
    if (full <= 0 || amount <= 0 || this.host.map.index.dead?.[i]) return;
    const before = this.hp[i]!;
    const hp = Math.max(0, before - amount);
    this.hp[i] = hp;
    if (hp <= 0) {
      this.breakBox(i, by);
      return;
    }
    const level = Math.max(1, Math.min(254, Math.round((1 - hp / full) * 254)));
    const key = String(i);
    const old = this.host.state.broken.get(key) ?? 0;
    if (level - old >= LEVEL_STEP) this.host.state.broken.set(key, level);
  }

  /** Vỡ hẳn khối `i`, rồi xem toà nhà của nó còn đứng nổi không. */
  breakBox(i: number, by = "") {
    const dead = this.host.map.index.dead;
    if (!dead || dead[i]) return;
    dead[i] = 1;
    this.hp[i] = 0;
    this.host.state.broken.set(String(i), BROKEN);
    const b = this.host.map.index.boxes[i]!;
    if (b.building === undefined) return;
    const g = this.buildings.get(b.building);
    if (!g || g.collapsed) return;
    if (b.part === "wall" && (this.full[i] ?? 0) > 0) g.broken += wallArea(b);
    if (g.wallArea > 0 && g.broken / g.wallArea >= COLLAPSE_RATIO) this.collapse(b.building, by);
  }

  /** Toà nhà sập: mọi khối trừ móng vỡ hết; ai đứng trong nhà bị đè. */
  collapse(building: number, by = "") {
    const g = this.buildings.get(building);
    if (!g || g.collapsed) return;
    g.collapsed = true;
    const boxes = this.host.map.index.boxes;
    const dead = this.host.map.index.dead!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const i of g.boxes) {
      const b = boxes[i]!;
      if (b.part === "base") continue;
      const r = Math.hypot(b.w, b.d) / 2;
      minX = Math.min(minX, b.x - r);
      maxX = Math.max(maxX, b.x + r);
      minZ = Math.min(minZ, b.z - r);
      maxZ = Math.max(maxZ, b.z + r);
      minY = Math.min(minY, b.y - b.h / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
      if (dead[i]) continue;
      dead[i] = 1;
      this.hp[i] = 0;
      this.host.state.broken.set(String(i), BROKEN);
    }
    for (const [id, p] of this.host.state.players) {
      if (!p.alive || p.vehicle) continue;
      if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ || p.y < minY - 0.5 || p.y > maxY) continue;
      this.host.crush(id, COLLAPSE_DAMAGE, by);
    }
    this.host.broadcast(Messages.collapse, { building, x: (minX + maxX) / 2, y: minY, z: (minZ + maxZ) / 2, r: Math.max(maxX - minX, maxZ - minZ) / 2, h: maxY - minY } satisfies CollapseMessage);
  }

  /** Thân cây `i` chịu sát thương; gãy thì đổ theo hướng `dir` (radian, hướng đạn / sức ép đẩy). */
  hitTree(i: number, amount: number, dir: number) {
    const map = this.host.map;
    if (!map.treeDead || map.treeDead[i] || amount <= 0) return;
    this.treeHp[i] = (this.treeHp[i] ?? 0) - amount;
    if (this.treeHp[i]! > 0) return;
    map.treeDead[i] = 1;
    const t = map.world.trees[i]!;
    this.host.state.stumps.push(t.id);
    this.host.broadcast(Messages.fx, { kind: "fell", x: t.x, y: map.world.heightAt(t.x, t.z), z: t.z, dir, treeId: t.id } satisfies FxMessage);
  }

  /** Sức nổ tại (x, y, z): khối, cây trong bán kính mất độ bền theo khoảng cách (nổ sát tường thì thủng tường). */
  blast(x: number, y: number, z: number, radius: number, power: number, by = "") {
    const map = this.host.map;
    const reach = radius * 1.2;
    const index = map.index;
    // Chép danh sách trước: vỡ khối trong vòng lặp có thể làm sập nhà (đánh dấu thêm khối vỡ).
    const near: number[] = [];
    const cell = index.cell;
    for (let gx = Math.floor((x - reach - 8) / cell); gx <= Math.floor((x + reach + 8) / cell); gx++)
      for (let gz = Math.floor((z - reach - 8) / cell); gz <= Math.floor((z + reach + 8) / cell); gz++) {
        const list = index.grid.get((gx + 32768) * 65536 + (gz + 32768));
        if (list) for (const i of list) if (!near.includes(i)) near.push(i);
      }
    for (const i of near) {
      if (index.dead?.[i] || (this.full[i] ?? 0) <= 0) continue;
      const d = distToBox(index.boxes[i]!, index.axes, i, x, y, z);
      if (d > reach) continue;
      this.hitBox(i, power * 3.2 * Math.pow(1 - d / reach, 1.1), by);
    }
    const trees = map.world.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i]!;
      const d = Math.max(0, Math.hypot(t.x - x, t.z - z) - trunkRadius(t));
      if (d > reach) continue;
      this.hitTree(i, power * 2 * (1 - d / reach), Math.atan2(t.x - x, t.z - z));
    }
  }
}

/** Diện tích mặt tường (hai cạnh lớn nhất của khối). */
function wallArea(b: BattleBox): number {
  const s = [b.w, b.h, b.d].sort((p, q) => q - p);
  return s[0]! * s[1]!;
}

/** Khoảng cách từ điểm tới khối (0 nếu ở trong), theo trục riêng của khối. */
export function distToBox(b: BattleBox, axes: Float64Array, i: number, x: number, y: number, z: number): number {
  const k = i * 9;
  const rx = x - b.x;
  const ry = y - b.y;
  const rz = z - b.z;
  const du = Math.max(0, Math.abs(rx * axes[k]! + ry * axes[k + 1]! + rz * axes[k + 2]!) - b.w / 2);
  const dv = Math.max(0, Math.abs(rx * axes[k + 3]! + ry * axes[k + 4]! + rz * axes[k + 5]!) - b.h / 2);
  const dw = Math.max(0, Math.abs(rx * axes[k + 6]! + ry * axes[k + 7]! + rz * axes[k + 8]!) - b.d / 2);
  return Math.hypot(du, dv, dw);
}
