import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, type MeshStandardMaterial, type Texture } from "three";
import {
  Fn,
  If,
  abs,
  atan,
  clamp,
  dot,
  floor,
  fract,
  materialColor,
  materialMetalness,
  materialNormal,
  materialRoughness,
  max,
  mix,
  modelViewMatrix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionView,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  mod,
} from "three/tsl";
import { slots, type F, type V2, type V3, type V4 } from "../gpu/slots.ts";
import { mulberry32 } from "../nature.ts";
import { detailSettings } from "../textures.ts";

// Nổi gân bề mặt cho đồ của người lính, tính thẳng trong shader theo toạ độ của vật (không cần UV, không tải ảnh):
// - "wrinkle": nếp nhăn vải quần áo (nếp ngang uốn lượn quanh ống tay, ống quần, thân áo; chỗ dày chỗ thưa).
// - "kevlar": sợi dệt đan rổ của áo giáp mềm.
// - "ceramic": tấm gốm chống đạn ghép lục giác, rãnh giữa các viên, mỗi viên đậm nhạt khác nhau.
// - "scuff": mũ sắt sơn mờ, vết xước tróc sơn lộ kim loại sáng loé dưới nắng, vài vết móp.
// Chỉ nổi gân ở gần (mờ dần theo khoảng cách cho khỏi lấm tấm), tắt hẳn khi đồ hoạ thấp tắt vân chi tiết.

export type ReliefKind = "wrinkle" | "kevlar" | "ceramic" | "scuff";

/** Bật / tắt theo vân chi tiết của cả cảnh (đọc mỗi lần đẩy uniform, khỏi phải dựng lại shader). */
const on = uniform(1).onFrameUpdate(function () {
  this.value = detailSettings.enabled ? 1 : 0;
});

let scratchTex: Texture | null = null;

/** Ảnh vết xước (kênh đỏ): vệt dài mảnh cong nhẹ, vết tróc sơn lốm đốm, lặp liền mép. */
function scratches(): Texture {
  if (scratchTex) return scratchTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const rand = mulberry32(4711);
  g.lineCap = "round";
  for (let i = 0; i < 34; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const len = 6 + rand() * 38;
    const bend = (rand() - 0.5) * 10;
    g.strokeStyle = `rgba(255,0,0,${0.25 + rand() * 0.5})`;
    g.lineWidth = rand() < 0.8 ? 0.7 : 1.4;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]] as const) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + oy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
  // Vết tróc sơn: cụm chấm nhỏ.
  for (let i = 0; i < 14; i++) {
    const x = rand() * S;
    const y = rand() * S;
    for (let k = 0; k < 8; k++) {
      g.fillStyle = `rgba(255,0,0,${0.4 + rand() * 0.5})`;
      const r = 0.6 + rand() * 1.8;
      g.beginPath();
      g.arc((x + (rand() - 0.5) * 9 + S) % S, (y + (rand() - 0.5) * 9 + S) % S, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  scratchTex = t;
  return t;
}

const PI = Math.PI;
const hash = (p: V2): F => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
// Toạ độ phẳng theo mặt chiếu trội nhất của pháp tuyến (tấm giáp, mặt hộp: gần như phẳng nên không cần trộn ba mặt).
const plane = (p: V3, n: V3): V2 => {
  const a = abs(n);
  return select(a.z.greaterThanEqual(a.x).and(a.z.greaterThanEqual(a.y)), p.xy, select(a.x.greaterThanEqual(a.y), p.zy, p.xz));
};

/**
 * Mỗi loại: hàm `pat(p, n)` (toạ độ và pháp tuyến của vật) trả về độ cao (m) và mặt nạ (0–1, nơi đổi màu, độ nhám,
 * độ kim loại); `step` là bước sai phân (m) để lấy độ dốc, nhỏ hơn chi tiết nhỏ nhất của vân.
 */
const PATTERN: Record<ReliefKind, { step: number; pat: (p: V3, n: V3) => V2 }> = {
  wrinkle: {
    step: 0.002,
    pat: (p) => {
      const a = atan(p.x, p.z);
      // Nếp ngang (vải dồn) uốn lượn theo góc quanh ống, chỗ dày chỗ thưa dọc ống.
      const w1 = sin(p.y.mul(95).add(sin(a.mul(3).add(p.y.mul(17))).mul(1.9)).add(sin(a.mul(5)).mul(0.7)));
      const m1 = smoothstep(0.35, 0.95, sin(a.mul(2).add(p.y.mul(23)).add(1.3)).mul(0.5).add(0.5));
      const fold = pow(abs(w1).oneMinus(), 2).mul(m1);
      // Nếp chéo dài mềm (vải căng xoắn theo thân).
      const w2 = sin(p.y.mul(41).add(a.mul(4)).add(sin(p.y.mul(29).add(a)).mul(1.3)));
      return vec2(fold.mul(0.8).add(w2.mul(0.25)).mul(0.0016), fold);
    },
  },
  kevlar: {
    step: 0.0005,
    pat: (p, n) => {
      const q = plane(p, n).div(0.006);
      const c = floor(q);
      const f = fract(q);
      // Đan rổ: ô chẵn sợi ngang, ô lẻ sợi dọc, mỗi ô ba sợi.
      const odd = mod(c.x.add(c.y), 2).greaterThan(0.5);
      const thread = select(odd, sin(fract(f.x.mul(3)).mul(PI)), sin(fract(f.y.mul(3)).mul(PI)));
      const rise = select(odd, sin(f.y.mul(PI)), sin(f.x.mul(PI)));
      return vec2(thread.mul(rise).mul(0.0003), thread.mul(rise));
    },
  },
  ceramic: {
    step: 0.0012,
    pat: (pp, n) => {
      const p = plane(pp, n).div(0.032);
      const s = vec2(1, 1.7320508);
      const hc = floor(vec4(p, p.sub(vec2(0.5, 1))).div(s.xyxy)).add(0.5);
      const h = vec4(p.sub(hc.xy.mul(s)), p.sub(hc.zw.add(0.5).mul(s)));
      const first = dot(h.xy, h.xy).lessThan(dot(h.zw, h.zw));
      const q = abs(select(first, h.xy, h.zw));
      const id = select(first, hc.xy, hc.zw.add(0.5));
      const edge = max(dot(q, s.mul(0.5)), q.x).negate().add(0.5);
      // Rãnh giữa các viên gốm, mặt viên hơi vồng.
      const tile = smoothstep(0, 0.08, edge);
      return vec2(tile.mul(0.8).add(sqrt(max(edge, 0)).mul(0.3)).mul(0.0016), tile.mul(hash(id).mul(0.25).add(0.75)));
    },
  },
  scuff: {
    step: 0.0008,
    pat: (pp, n) => {
      const p = pp.mul(2.6);
      const tex = scratches();
      const w0 = pow(abs(normalize(n)), vec3(4));
      const w = w0.div(w0.x.add(w0.y).add(w0.z).add(1e-5));
      const s = texture(tex, p.zy).r.mul(w.x).add(texture(tex, p.xz).r.mul(w.y)).add(texture(tex, p.xy).r.mul(w.z));
      // Vài vết móp nông trên vỏ mũ.
      const dent = sin(pp.x.mul(61).add(1.7)).mul(sin(pp.y.mul(47))).mul(sin(pp.z.mul(53).add(0.4)));
      return vec2(s.mul(-0.00025).sub(smoothstep(0.55, 0.95, dent).mul(0.0012)), s);
    },
  },
};

/** Đổi màu, độ nhám, độ kim loại theo mặt nạ `m` của từng loại (`k`: độ bật; 0 là giữ nguyên). */
const SURFACE: Record<
  ReliefKind,
  { color?: (rgb: V3, m: F, fade: F, k: F) => V3; rough?: (r: F, m: F, k: F) => F; metal?: (r: F, m: F, k: F) => F }
> = {
  // Đáy nếp gấp tối hơn, sống nếp sáng hơn chút (vải bị mài).
  wrinkle: { color: (rgb, m, fade, k) => rgb.mul(m.mul(0.09).mul(fade).mul(k).oneMinus()) },
  kevlar: { color: (rgb, m, fade, k) => rgb.mul(m.sub(0.5).mul(0.07).mul(fade).mul(k).add(1)) },
  // Mặt viên gốm phủ lớp bóng nhẹ, rãnh nhám tối.
  ceramic: {
    color: (rgb, m, _fade, k) => rgb.mul(mix(float(1), mix(float(0.7), m.mul(0.2).add(0.92), step(0.01, m)), k)),
    rough: (r, m, k) => mix(r, mix(float(0.95), float(0.42), m), k),
  },
  // Vết xước: tróc sơn lộ thép sáng, nhẵn, kim loại (loé sáng khi nắng chiếu).
  scuff: {
    color: (rgb, m, _fade, k) => mix(rgb, vec3(0.42, 0.43, 0.42), clamp(m.mul(1.2), 0, 0.85).mul(k)),
    rough: (r, m, k) => mix(r, float(0.25), clamp(m.mul(1.2), 0, 1).mul(k)),
    metal: (r, m, k) => mix(r, float(0.9), clamp(m.mul(1.2), 0, 1).mul(k)),
  },
};

/**
 * Gắn nổi gân bề mặt vào vật liệu (gọi một lần lúc tạo). Giữ các node có sẵn (viền sáng, vân chi tiết gắn trước) và bọc
 * lên trên để bản vá sau vẫn bọc tiếp được. `amp` nhân độ sâu nổi gân.
 */
export function withRelief<M extends MeshStandardMaterial>(m: M, kind: ReliefKind, amp = 1): M {
  if (m.userData.relief) return m;
  m.userData.relief = kind;
  const surf = SURFACE[kind];
  const { pat, step: h } = PATTERN[kind];
  const s = slots(m);
  // Ở xa thì tắt dần (nổi gân vài mm nhìn từ xa chỉ thành nhiễu hạt).
  const fade = smoothstep(4, 18, positionView.length()).oneMinus();
  // Độ cao, mặt nạ (x, y) và độ dốc (sai phân theo ba trục của vật; z, w chỉ dùng chung cho pháp tuyến bên dưới).
  // Chỉ tính khi vân chi tiết bật (điều kiện theo uniform nên mọi điểm ảnh cùng nhánh).
  const data = Fn(() => {
    const out = vec4(0).toVar();
    If(on.greaterThan(0.5), () => {
      const p = positionGeometry;
      const n = normalGeometry;
      const hm = pat(p, n);
      const g = vec3(
        pat(p.add(vec3(h, 0, 0)), n).x.sub(hm.x),
        pat(p.add(vec3(0, h, 0)), n).x.sub(hm.x),
        pat(p.add(vec3(0, 0, h)), n).x.sub(hm.x),
      ).div(h);
      out.assign(vec4(hm.y, g));
    });
    return out;
  });
  if (surf.color) {
    const c = s.colorNode ?? materialColor;
    const base = vec4(c as unknown as V4);
    s.colorNode = vec4(surf.color(base.rgb, data().x, fade, on), base.a);
  }
  if (surf.rough) s.roughnessNode = surf.rough((s.roughnessNode ?? materialRoughness) as F, data().x, on);
  if (surf.metal) s.metalnessNode = surf.metal((s.metalnessNode ?? materialMetalness) as F, data().x, on);
  // Nắn pháp tuyến theo độ dốc: đổi sang toạ độ camera bằng ba trục của vật.
  const mv = (x: number, y: number, z: number) => normalize(modelViewMatrix.mul(vec4(x, y, z, 0)).xyz);
  const baseN = (s.normalNode ?? materialNormal) as V3;
  const g = data().yzw;
  const gv = mv(1, 0, 0).mul(g.x).add(mv(0, 1, 0).mul(g.y)).add(mv(0, 0, 1).mul(g.z)).mul(amp).mul(fade);
  s.normalNode = normalize(baseN.sub(gv.sub(baseN.mul(dot(gv, baseN)))));
  m.needsUpdate = true;
  return m;
}
