import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, Vector2, Vector4, type InstancedMesh } from "three";
import type { Node, NodeBuilder } from "three/webgpu";
import { Fn, attribute, buffer, cameraWorldMatrix, dot, exp, float, floor, fract, instanceIndex, length, max, min, mix, positionGeometry, select, sin, uniform, varyingProperty, vec2, vec3, vec4 } from "three/tsl";
import type { F, V2, V3 } from "../gpu/slots.ts";

// Hạt hiệu ứng tính trên GPU (khói, bụi, tia lửa). Trước đây CPU giữ một mảng hạt, mỗi khung hình cộng vận tốc, lực
// cản, gió, nở to, mờ dần cho từng hạt (tới 900 hạt khói, 360 tia lửa) rồi ghép ma trận và tải lại cả bộ đệm lên card.
// Giờ mỗi hạt chỉ được ghi MỘT lần lúc sinh ra (chỗ, vận tốc, lúc sinh, tuổi thọ, màu) vào một ô của bộ đệm vòng trên
// card; vertex shader tự tính vị trí, cỡ, độ mờ ở thời điểm hiện tại bằng công thức đóng (lực cản mũ, trọng lực, gió
// theo độ cao). Mỗi khung CPU chỉ cập nhật đồng hồ và vài đồng phục (gió, sức ép nổ), và tải lên đúng mấy ô vừa ghi.

/** Đồng hồ chung của hạt (giây, chạy chậm lại khi hitstop): uniform TSL, ghi bằng `.value`, mọi vật liệu hạt đọc chung. */
export const particleClock = uniform(0);

/** Đống nhị phân nhỏ giữ lúc tắt của các hạt còn sống, để biết nhanh còn bao nhiêu hạt (khỏi duyệt cả bộ đệm). */
class DeathHeap {
  private a: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    let i = a.length;
    a.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= v) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = v;
  }
  /** Bỏ các hạt đã tắt trước thời điểm `now`. */
  drain(now: number) {
    const a = this.a;
    while (a.length && a[0]! <= now) {
      const last = a.pop()!;
      if (!a.length) break;
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1]! < a[c]!) c++;
        if (a[c]! >= last) break;
        a[i] = a[c]!;
        i = c;
      }
      a[i] = last;
    }
  }
  clear() {
    this.a = [];
  }
}

/**
 * Bộ đệm vòng các hạt: mỗi hạt 4 vec4 thuộc tính instance. Ghi đè ô cũ nhất khi đầy. Chỉ tải lên card phần ô vừa ghi
 * trong khung (addUpdateRange), không tải lại cả bộ đệm.
 */
export class ParticleRing {
  readonly geometry: InstancedBufferGeometry;
  private readonly attrs: InstancedBufferAttribute[];
  private next = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private readonly deaths = new DeathHeap();

  constructor(
    readonly max: number,
    names: readonly string[],
  ) {
    const g = new InstancedBufferGeometry();
    const base = new PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    this.attrs = names.map((n) => {
      const a = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(n, a);
      return a;
    });
    // Ô chưa dùng: tuổi thọ 0 (shader ẩn đi).
    g.instanceCount = max;
    this.geometry = g;
  }

  /** Số hạt còn sống (ước lượng, không quá sức chứa). */
  get length(): number {
    this.deaths.drain(particleClock.value);
    return Math.min(this.max, this.deaths.size);
  }

  /** Ghi một hạt: `rows[k]` là 4 số của thuộc tính thứ k; `death` là lúc tắt (theo particleClock). */
  write(rows: readonly (readonly [number, number, number, number])[], death: number) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    for (let k = 0; k < this.attrs.length; k++) {
      const r = rows[k]!;
      (this.attrs[k]!.array as Float32Array).set(r, i * 4);
    }
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i);
    this.deaths.push(death);
  }

  /** Gọi mỗi khung trước khi vẽ: đánh dấu đoạn ô vừa ghi để tải lên card. */
  flush() {
    if (this.dirtyTo < 0) return;
    // Đúng đoạn ô vừa ghi (ghi vòng qua cuối bộ đệm thì đoạn này phủ cả bộ đệm, hiếm khi xảy ra).
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  clear() {
    for (const a of this.attrs) (a.array as Float32Array).fill(0);
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
    this.deaths.clear();
    this.next = 0;
  }
}

// ---------------------------------------------------------------------------- khói, bụi

export interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  life: number;
  age: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** Khói dày (bom khói): đứng yên chỗ (không trôi theo gió), không mờ dần theo tuổi cho tới gần cuối. */
  dense: boolean;
}

export const MAX_PUFFS = 1400;
export const puffRing = new ParticleRing(MAX_PUFFS, ["aStart", "aVel", "aSize", "aTint"]);

/** Khói chung: các nơi khác chỉ cần thêm hạt (`push`) và hỏi còn bao nhiêu hạt (`length`) như mảng cũ. */
export const puffs = {
  push(...list: Puff[]): number {
    const now = particleClock.value;
    for (const p of list) {
      const t0 = now - p.age;
      puffRing.write(
        [
          [p.x, p.y, p.z, t0],
          [p.vx, p.vy, p.vz, p.life],
          [p.size, p.grow, p.dense ? 1 : 0, p.alpha],
          [p.r, p.g, p.b, 0],
        ],
        t0 + p.life,
      );
    }
    return puffRing.length;
  },
  get length(): number {
    return puffRing.length;
  },
};

/** Đồng phục chung của khói: gió, sức ép nổ (tối đa 4 vụ gần nhất), chỗ khói bị thổi thủng (tối đa 4). Đồng hồ là `particleClock`. */
export const puffUniforms = {
  uTime: particleClock,
  uWind: uniform(new Vector2()),
  uPush: [0, 1, 2, 3].map(() => uniform(new Vector4(0, 0, 0, -99))),
  uClear: [0, 1, 2, 3].map(() => uniform(new Vector4())),
};
let pushSlot = 0;

/** Vụ nổ ở (x, z): khói dày gần đó bị thổi bạt ra (shader tính theo khoảng cách tới tâm nổ). */
export function blastPush(x: number, z: number, radius: number) {
  puffUniforms.uPush[pushSlot]!.value.set(x, z, radius, particleClock.value);
  pushSlot = (pushSlot + 1) % 4;
}

/** Các khoảng trống trong bom khói đang bị lựu đạn thổi thủng: (tâm x, tâm z, bán kính, độ mạnh 0–1). */
export function setSmokeClears(list: readonly [number, number, number, number][]) {
  const u = puffUniforms.uClear;
  for (let k = 0; k < 4; k++) {
    const c = list[k];
    if (c) u[k]!.value.set(c[0], c[1], c[2], c[3]);
    else u[k]!.value.set(0, 0, 0, 0);
  }
}

/** Màu và độ đục của hạt khói (tính ở đỉnh trong `puffPosition`, fragment đọc lại). */
export const puffTint = varyingProperty("vec4", "vPuffTint");

/**
 * Nút vị trí cho mỗi đỉnh của hạt khói (gán vào `positionNode`, hệ thế giới vì lưới hạt nằm ở gốc, không xoay). Tính vị
 * trí hiện tại bằng công thức đóng; hạt chưa sinh hay đã tắt thì cả bốn đỉnh dồn về một điểm (tam giác suy biến, không
 * vẽ điểm ảnh nào). Cũng ghi `puffTint`.
 */
export const puffPosition = Fn(() => {
  const aStart = attribute("aStart", "vec4");
  const aVel = attribute("aVel", "vec4");
  const aSize = attribute("aSize", "vec4");
  const aTint = attribute("aTint", "vec4");
  const age = particleClock.sub(aStart.w);
  const life = aVel.w;
  const alive = life.greaterThan(0).and(age.greaterThanEqual(0)).and(age.lessThan(life));
  const dense = aSize.z.greaterThan(0.5);
  const k = select(dense, float(0.55), float(1.2));
  // Vận tốc giảm theo hàm mũ e^(-k t): quãng đường = v0 (1 - e^(-k t)) / k.
  const travel = float(1).sub(exp(k.mul(age).negate())).div(k);
  const p = aStart.xyz.toVar();
  p.addAssign(vec3(aVel.x.mul(travel), aVel.y.mul(select(dense, travel, age)), aVel.z.mul(travel)));
  // Càng lên cao gió càng mạnh: hệ số min(2, 0.5 + 0.3 t), lấy tích phân theo thời gian.
  const drift = select(age.lessThan(5), age.mul(0.5).add(age.mul(age).mul(0.15)), age.sub(5).mul(2).add(6.25));
  p.addAssign(vec3(puffUniforms.uWind.x, 0, puffUniforms.uWind.y).mul(drift).mul(select(dense, float(0), float(1))));
  const alpha = aSize.w.toVar();
  // Sức ép nổ thổi bạt khói dày ra xung quanh.
  for (const b of puffUniforms.uPush) {
    const since = particleClock.sub(b.w);
    const d = p.xz.sub(b.xy);
    const dd = max(length(d), 0.001);
    const valid = dense.and(since.greaterThanEqual(0)).and(since.lessThanEqual(4)).and(aStart.w.lessThanEqual(b.w)).and(dd.lessThanEqual(b.z));
    const push = float(14).mul(float(1).sub(dd.div(b.z))).mul(float(1).sub(exp(since.mul(-0.55)))).div(0.55);
    const off = d.div(dd).mul(push);
    p.addAssign(select(valid, vec3(off.x, push.mul(0.3), off.y), vec3(0)));
  }
  // Khoảng trống lựu đạn thổi thủng: khói trong vòng bị đẩy ra mép và mỏng đi.
  for (const c of puffUniforms.uClear) {
    const d = p.xz.sub(c.xy);
    const dd = max(length(d), 0.001);
    const valid = dense.and(c.w.greaterThan(0)).and(dd.lessThan(c.z));
    const off = d.div(dd).mul(c.z.sub(dd)).mul(c.w);
    p.addAssign(select(valid, vec3(off.x, 0, off.y), vec3(0)));
    alpha.mulAssign(select(valid, mix(float(1), float(0.25), c.w), float(1)));
  }
  const f = age.div(life);
  alpha.mulAssign(select(dense, min(float(1), age.mul(1.5)).mul(float(1).sub(max(float(0), f.sub(0.8)).div(0.2))), float(1).sub(f)));
  puffTint.assign(vec4(aTint.rgb, alpha));
  const size = aSize.x.add(aSize.y.mul(age)).mul(select(alive, float(1), float(0)));
  return p.add(billboardOffset(size));
});

/** Độ lệch thế giới của một đỉnh tấm vuông xoay mặt về camera (`size` là cạnh tấm, `positionGeometry` là ±0,5). */
export function billboardOffset(size: F): V3 {
  return cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(size), 0, 0)).xyz as V3;
}

/** Ma trận instance của InstancedMesh đang dựng (cùng cách three đọc: bộ đệm đồng phục, theo `instanceIndex`). */
function instanceMatrixOf(builder: NodeBuilder) {
  const im = (builder.object as InstancedMesh).instanceMatrix;
  return (buffer(im.array as Float32Array, "mat4", Math.max(im.count, 1)) as unknown as { element(i: unknown): Node<"mat4"> }).element(instanceIndex);
}

/**
 * Vị trí đỉnh của tấm xoay mặt về camera cho InstancedMesh (tâm và cỡ lấy từ ma trận instance, bỏ phần xoay): thay cho
 * "center = instanceMatrix * (0,0,0,1); size = length(instanceMatrix[0].xyz); mv.xy += position.xy * size" của shader cũ.
 * Gán vào `positionNode`; lưới đặt ở gốc thế giới, không xoay (như trước, mọi ma trận instance là toạ độ thế giới).
 */
export const instancedBillboard = Fn((builder) => {
  const m = instanceMatrixOf(builder);
  const center = m.mul(vec4(0, 0, 0, 1)).xyz;
  const size = length(m.mul(vec4(1, 0, 0, 0)).xyz);
  return center.add(billboardOffset(size));
});

// ---------------------------------------------------------------------------- nhiễu dùng chung

/** Băm một số ngẫu nhiên từ vec2 (kiểu sin-fract quen thuộc, cùng công thức với shader cũ). */
export const hash2 = Fn(([p]: [V2]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

/** Nhiễu giá trị 2 chiều nội suy mượt. */
export const noise2 = Fn(([p]: [V2]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(mix(hash2(i), hash2(i.add(vec2(1, 0))), u.x), mix(hash2(i.add(vec2(0, 1))), hash2(i.add(vec2(1, 1))), u.x), u.y);
});

/** smoothstep an toàn khi cạnh đảo ngược (smoothstep gốc của WGSL không định nghĩa khi cạnh dưới >= cạnh trên). */
export function sstep(a: number | F, b: number | F, x: F): F {
  const lo: F = typeof a === "number" ? float(a) : a;
  const hi: F = typeof b === "number" ? float(b) : b;
  const t = x.sub(lo).div(hi.sub(lo)).clamp(0, 1);
  return t.mul(t).mul(float(3).sub(t.mul(2))) as F;
}

// ---------------------------------------------------------------------------- tia lửa

/** Tia lửa, mảnh vụn nóng đỏ văng ra từ vụ nổ (rơi theo trọng lực, tắt dần). */
export interface Ember {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}

export const MAX_EMBERS = 512;
export const emberRing = new ParticleRing(MAX_EMBERS, ["aStart", "aVel", "aSize"]);

export const embers = {
  push(...list: Ember[]): number {
    const now = particleClock.value;
    for (const e of list) {
      const t0 = now - e.age;
      emberRing.write(
        [
          [e.x, e.y, e.z, t0],
          [e.vx, e.vy, e.vz, e.life],
          [e.size, 0, 0, 0],
        ],
        t0 + e.life,
      );
    }
    return emberRing.length;
  },
  get length(): number {
    return emberRing.length;
  },
};

/** Vị trí đỉnh của tia lửa (gán vào `positionNode`): ngang chịu lực cản e^(-1,2 t), đứng chịu trọng lực, nhỏ dần theo tuổi. */
export const emberPosition = Fn(() => {
  const aStart = attribute("aStart", "vec4");
  const aVel = attribute("aVel", "vec4");
  const aSize = attribute("aSize", "vec4");
  const age = particleClock.sub(aStart.w);
  const life = aVel.w;
  const alive = life.greaterThan(0).and(age.greaterThanEqual(0)).and(age.lessThan(life));
  const travel = float(1).sub(exp(age.mul(-1.2))).div(1.2);
  const p = aStart.xyz.add(vec3(aVel.x.mul(travel), aVel.y.mul(age).sub(age.mul(age).mul(4.9)), aVel.z.mul(travel)));
  const size = aSize.x.mul(float(1).sub(age.div(life))).mul(2.2).mul(select(alive, float(1), float(0)));
  return p.add(billboardOffset(size));
});
