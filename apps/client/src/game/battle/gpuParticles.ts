import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, Vector2, Vector4 } from "three";

// Hạt hiệu ứng tính trên GPU (khói, bụi, tia lửa). Trước đây CPU giữ một mảng hạt, mỗi khung hình cộng vận tốc, lực
// cản, gió, nở to, mờ dần cho từng hạt (tới 900 hạt khói, 360 tia lửa) rồi ghép ma trận và tải lại cả bộ đệm lên card.
// Giờ mỗi hạt chỉ được ghi MỘT lần lúc sinh ra (chỗ, vận tốc, lúc sinh, tuổi thọ, màu) vào một ô của bộ đệm vòng trên
// card; vertex shader tự tính vị trí, cỡ, độ mờ ở thời điểm hiện tại bằng công thức đóng (lực cản mũ, trọng lực, gió
// theo độ cao). Mỗi khung CPU chỉ cập nhật đồng hồ và vài đồng phục (gió, sức ép nổ), và tải lên đúng mấy ô vừa ghi.

/** Đồng hồ chung của hạt (giây, chạy chậm lại khi hitstop), shader đọc qua uniform `uTime`. */
export const particleClock = { value: 0 };

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

/** Đồng phục chung của khói: đồng hồ, gió, sức ép nổ (tối đa 4 vụ gần nhất), chỗ khói bị thổi thủng (tối đa 4). */
export const puffUniforms = {
  uTime: particleClock,
  uWind: { value: new Vector2() },
  uPush: { value: [new Vector4(0, 0, 0, -99), new Vector4(0, 0, 0, -99), new Vector4(0, 0, 0, -99), new Vector4(0, 0, 0, -99)] },
  uClear: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
};
let pushSlot = 0;

/** Vụ nổ ở (x, z): khói dày gần đó bị thổi bạt ra (shader tính theo khoảng cách tới tâm nổ). */
export function blastPush(x: number, z: number, radius: number) {
  puffUniforms.uPush.value[pushSlot]!.set(x, z, radius, particleClock.value);
  pushSlot = (pushSlot + 1) % 4;
}

/** Các khoảng trống trong bom khói đang bị lựu đạn thổi thủng: (tâm x, tâm z, bán kính, độ mạnh 0–1). */
export function setSmokeClears(list: readonly [number, number, number, number][]) {
  const u = puffUniforms.uClear.value;
  for (let k = 0; k < 4; k++) {
    const c = list[k];
    if (c) u[k]!.set(c[0], c[1], c[2], c[3]);
    else u[k]!.set(0, 0, 0, 0);
  }
}

export const puffVertex = /* glsl */ `
  attribute vec4 aStart;
  attribute vec4 aVel;
  attribute vec4 aSize;
  attribute vec4 aTint;
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec4 uPush[4];
  uniform vec4 uClear[4];
  varying vec2 vUv;
  varying vec4 vTint;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    float age = uTime - aStart.w;
    float life = aVel.w;
    // Chưa sinh hay đã tắt: đẩy ra ngoài màn hình.
    if (life <= 0.0 || age < 0.0 || age >= life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    bool dense = aSize.z > 0.5;
    float k = dense ? 0.55 : 1.2;
    // Vận tốc giảm theo hàm mũ e^(-k t): quãng đường = v0 (1 - e^(-k t)) / k.
    float travel = (1.0 - exp(-k * age)) / k;
    vec3 p = aStart.xyz;
    p.xz += aVel.xz * travel;
    p.y += aVel.y * (dense ? travel : age);
    if (!dense) {
      // Càng lên cao gió càng mạnh: hệ số min(2, 0.5 + 0.3 t), lấy tích phân theo thời gian.
      float drift = age < 5.0 ? 0.5 * age + 0.15 * age * age : 6.25 + 2.0 * (age - 5.0);
      p.xz += uWind * drift;
    }
    float alpha = aSize.w;
    if (dense) {
      // Sức ép nổ thổi bạt khói dày ra xung quanh.
      for (int i = 0; i < 4; i++) {
        vec4 b = uPush[i];
        float since = uTime - b.w;
        if (since < 0.0 || since > 4.0 || aStart.w > b.w) continue;
        vec2 d = p.xz - b.xy;
        float dd = max(length(d), 0.001);
        if (dd > b.z) continue;
        float push = 14.0 * (1.0 - dd / b.z) * (1.0 - exp(-0.55 * since)) / 0.55;
        p.xz += d / dd * push;
        p.y += push * 0.3;
      }
      // Khoảng trống lựu đạn thổi thủng: khói trong vòng bị đẩy ra mép và mỏng đi.
      for (int i = 0; i < 4; i++) {
        vec4 c = uClear[i];
        if (c.w <= 0.0) continue;
        vec2 d = p.xz - c.xy;
        float dd = max(length(d), 0.001);
        if (dd >= c.z) continue;
        p.xz += d / dd * (c.z - dd) * c.w;
        alpha *= mix(1.0, 0.25, c.w);
      }
    }
    float f = age / life;
    alpha *= dense ? min(1.0, age * 1.5) * (1.0 - max(0.0, f - 0.8) / 0.2) : (1.0 - f);
    vTint = vec4(aTint.rgb, alpha);
    float size = aSize.x + aSize.y * age;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    vec4 mvPosition = mv;
    #include <fog_vertex>
  }
`;

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

export const emberVertex = /* glsl */ `
  attribute vec4 aStart;
  attribute vec4 aVel;
  attribute vec4 aSize;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float age = uTime - aStart.w;
    float life = aVel.w;
    if (life <= 0.0 || age < 0.0 || age >= life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Ngang: lực cản e^(-1.2 t); đứng: trọng lực.
    vec3 p = aStart.xyz;
    p.xz += aVel.xz * (1.0 - exp(-1.2 * age)) / 1.2;
    p.y += aVel.y * age - 4.9 * age * age;
    float size = aSize.x * (1.0 - age / life) * 2.2;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }
`;
