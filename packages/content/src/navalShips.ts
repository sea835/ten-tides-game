import type { NavalRole, NavalWeaponId, ShipBox, ShipClass, ShipMount, ShipPart, ShipRole } from "./naval.ts";

// Hình năm lớp chiến hạm (theo toạ độ riêng của tàu, xem naval.ts): thân tàu thật (mũi nhọn, boong cong lên ở mũi,
// đuôi vát) cắt thành lát mỏng để làm khối va chạm, lan can quanh mạn, thượng tầng nhiều tầng có cầu thang, tháp pháo,
// ổ phòng không, ống phóng; cùng các chi tiết chỉ để vẽ (ống khói, cột buồm, ra-đa, xuồng cứu sinh, pháo phụ, cần
// cẩu, máy bay đậu, ô giếng phóng...). Kích thước gần tàu thật thu nhỏ một chút cho vừa bản đồ.

/** Dáng thân tàu: máy vẽ dựng vỏ tàu trơn theo đúng đường viền này, server dùng các lát cắt theo nó. */
export interface HullSpec {
  L: number;
  B: number;
  /** Boong chính ở giữa tàu (m trên mặt nước), mớn nước. */
  deck: number;
  draft: number;
  /** Boong cong lên ở mũi, ở đuôi (m). */
  sheer: number;
  sternSheer: number;
  /** Từ đâu (z) thân bắt đầu thon về mũi, về đuôi. */
  bowStart: number;
  sternStart: number;
  /** Bề ngang đuôi tàu (phần của bề ngang giữa tàu). */
  transom: number;
  /** Tàu ngầm: mặt cắt tròn, boong là sàn hẹp trên lưng. */
  round?: boolean;
}

export type DecorKind =
  | "box"
  | "cyl"
  | "funnel"
  | "mast"
  | "radar"
  | "dish"
  | "boat"
  | "gun"
  | "cells"
  | "jet"
  | "pad"
  | "crane"
  | "window"
  | "panel"
  | "prop"
  | "fin"
  | "anchor"
  | "light"
  | "flag"
  | "wire";

/** Chi tiết chỉ để vẽ (không va chạm, không trúng đạn riêng); thuộc bộ phận `part` thì cháy đen theo bộ phận đó. */
export interface ShipDecor {
  kind: DecorKind;
  x: number;
  y: number;
  z: number;
  w?: number;
  h?: number;
  d?: number;
  r?: number;
  /** Hướng (rad, quanh trục đứng) hay độ nghiêng tuỳ loại. */
  rot?: number;
  n?: number;
  mat?: ShipBox["mat"];
  part?: string;
}

/** Nửa bề ngang thân tàu ở mặt boong tại z. */
export function halfBeamAt(h: HullSpec, z: number): number {
  const hb = h.B / 2;
  if (z > h.bowStart) {
    const t = Math.min(1, (z - h.bowStart) / (h.L / 2 - h.bowStart));
    return hb * Math.pow(Math.max(0, 1 - t * t), 0.62);
  }
  if (z < h.sternStart) {
    const t = Math.min(1, (h.sternStart - z) / (h.L / 2 + h.sternStart));
    return hb * (1 - (1 - h.transom) * t * t);
  }
  return hb;
}

/** Độ cao mặt boong chính tại z (cong lên ở mũi, ở đuôi). */
export function deckAt(h: HullSpec, z: number): number {
  const f = Math.max(0, z / (h.L / 2));
  const a = Math.max(0, -z / (h.L / 2));
  return h.deck + h.sheer * Math.pow(f, 2.2) + h.sternSheer * Math.pow(a, 2.5);
}

// ---------------------------------------------------------------------------- khối dựng chung

type V3 = readonly [number, number, number];

/** Thân tàu cắt lát dọc (va chạm, trúng đạn, sàn đi lại), lan can theo mép boong, vách ngang ở chỗ mép đổi bề ngang. */
function hullSlices(h: HullSpec, out: ShipBox[], opts: { slice?: number; rails?: boolean; walk?: number } = {}) {
  const step = opts.slice ?? 4;
  const n = Math.ceil(h.L / step);
  let prevHw = -1;
  for (let i = 0; i < n; i++) {
    const z0 = -h.L / 2 + i * step;
    const z1 = Math.min(h.L / 2, z0 + step);
    const zc = (z0 + z1) / 2;
    // Bề ngang lát lấy chỗ hẹp hơn của hai đầu (khỏi đứng trên khoảng không ở mép mũi), bớt chút cho lan can.
    const hw = Math.max(0.4, Math.min(halfBeamAt(h, z0), halfBeamAt(h, z1)) - 0.12);
    const top = deckAt(h, zc);
    const part = zc > h.L * 0.2 ? "bow" : zc < -h.L * 0.2 ? "stern" : "mid";
    if (h.round) {
      // Tàu ngầm: thân tròn dưới nước, trên lưng là sàn hẹp đi lại được.
      const walk = Math.min(hw, (opts.walk ?? 3.4) / 2);
      out.push({ x: 0, y: (-h.draft + 0.6) / 2, z: zc, w: hw * 2, h: h.draft + 0.6, d: z1 - z0 + 0.02, mat: "hull", solid: true, part, hidden: true });
      out.push({ x: 0, y: (0.6 + top) / 2, z: zc, w: walk * 2, h: top - 0.6, d: z1 - z0 + 0.02, mat: "hull", solid: true, part, hidden: true });
      continue;
    }
    out.push({ x: 0, y: (top - h.draft) / 2, z: zc, w: hw * 2, h: top + h.draft, d: z1 - z0 + 0.02, mat: "hull", solid: true, part, hidden: true });
    if (opts.rails !== false) {
      for (const s of [-1, 1]) {
        out.push({ x: s * (hw - 0.05), y: top + 0.55, z: zc, w: 0.1, h: 1.1, d: z1 - z0 + 0.04, mat: "rail", solid: true });
        // Vách nối hai đoạn lan can lệch nhau (mép boong thu hẹp về mũi, về đuôi): không lách ra ngoài được.
        if (prevHw > 0 && Math.abs(prevHw - hw) > 0.05) {
          const a = Math.min(prevHw, hw);
          const b = Math.max(prevHw, hw);
          out.push({ x: (s * (a + b)) / 2, y: top + 0.55, z: z0, w: b - a + 0.1, h: 1.1, d: 0.1, mat: "rail", solid: true });
        }
      }
      // Mũi, đuôi: thanh chắn ngang.
      if (i === n - 1 || i === 0) out.push({ x: 0, y: top + 0.55, z: i === 0 ? z0 + 0.05 : z1 - 0.05, w: hw * 2, h: 1.1, d: 0.1, mat: "rail", solid: true });
    }
    prevHw = hw;
  }
}

function block(out: ShipBox[], x: number, y0: number, z: number, w: number, h: number, d: number, part: string, mat: ShipBox["mat"] = "steel") {
  out.push({ x, y: y0 + h / 2, z, w, h, d, mat, solid: true, part });
}

/**
 * Lan can quanh mép sàn trên của một khối thượng tầng; `gaps`: chỗ cầu thang lên tới mép (x, z) thì chừa lối rộng
 * 2,4 m ở cạnh gần đó nhất.
 */
function roofRails(out: ShipBox[], x: number, top: number, z: number, w: number, d: number, gaps: readonly (readonly [number, number])[] = []) {
  const y = top + 0.55;
  const GAP = 1.2;
  /** Một cạnh từ a tới b (theo trục dọc cạnh), cắt bỏ các khoảng quanh lối lên. */
  const edge = (along: "x" | "z", fixed: number, a: number, b: number, holes: number[]) => {
    const cuts = holes.map((c) => [c - GAP, c + GAP] as const).sort((p, q) => p[0] - q[0]);
    let from = a;
    const put = (lo: number, hi: number) => {
      if (hi - lo < 0.2) return;
      const mid = (lo + hi) / 2;
      if (along === "z") out.push({ x: fixed, y, z: mid, w: 0.1, h: 1.1, d: hi - lo, mat: "rail", solid: true });
      else out.push({ x: mid, y, z: fixed, w: hi - lo, h: 1.1, d: 0.1, mat: "rail", solid: true });
    };
    for (const [lo, hi] of cuts) {
      put(from, Math.min(b, lo));
      from = Math.max(from, hi);
    }
    put(from, b);
  };
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  const near = (side: "x0" | "x1" | "z0" | "z1") =>
    gaps
      .filter(([gx, gz]) => {
        const dist = { x0: Math.abs(gx - x0), x1: Math.abs(gx - x1), z0: Math.abs(gz - z0), z1: Math.abs(gz - z1) };
        const best = Math.min(dist.x0, dist.x1, dist.z0, dist.z1);
        return dist[side] === best && best < 2.5;
      })
      .map(([gx, gz]) => (side === "x0" || side === "x1" ? gz : gx));
  edge("z", x0 + 0.05, z0, z1, near("x0"));
  edge("z", x1 - 0.05, z0, z1, near("x1"));
  edge("x", z0 + 0.05, x0, x1, near("z0"));
  edge("x", z1 - 0.05, x0, x1, near("z1"));
}

/** Cầu thang (dốc) từ độ cao y0 lên y1 dọc theo z, từ z0 tới z1, bề ngang w, tại hoành độ x. */
function stairs(out: ShipBox[], x: number, y0: number, y1: number, z0: number, z1: number, w = 1.4) {
  const rise = y1 - y0;
  const run = z1 - z0;
  const len = Math.hypot(rise, run);
  out.push({ x, y: (y0 + y1) / 2 - 0.1, z: (z0 + z1) / 2, w, h: 0.2, d: len, pitch: -Math.atan2(rise, run), mat: "steel", solid: true });
}

/** Bệ tháp pháo cố định (tháp xoay vẽ riêng theo hướng ngắm). */
function barbette(out: ShipBox[], m: ShipMount, part: string, size: number, depth: number) {
  out.push({ x: m.pivot[0], y: m.pivot[1] - depth / 2, z: m.pivot[2], w: size, h: depth, d: size, mat: "dark", solid: true, part });
}

function role(r: NavalRole, name: string, brief: string, station: V3, face: number, weapons: readonly NavalWeaponId[], helm = false): ShipRole {
  return { role: r, name, brief, station, face, weapons, helm };
}

function sections(h: HullSpec): ShipPart[] {
  const r = Math.max(h.B * 0.75, 6);
  return [
    { id: "bow", name: "Khoang mũi", kind: "section", hp: 99999, at: [0, h.deck - 1, h.L * 0.33], r },
    { id: "mid", name: "Khoang giữa", kind: "section", hp: 99999, at: [0, h.deck - 1, 0], r },
    { id: "stern", name: "Khoang đuôi", kind: "section", hp: 99999, at: [0, h.deck - 1, -h.L * 0.35], r },
  ];
}

const D = (kind: DecorKind, x: number, y: number, z: number, o: Partial<ShipDecor> = {}): ShipDecor => ({ kind, x, y, z, ...o });

/** Cọc buộc dây, nắp hầm, cửa sổ thân tàu, neo: chi tiết boong chung cho tàu nổi. */
function deckDetail(h: HullSpec, decor: ShipDecor[], skip: (z: number) => boolean = () => false) {
  // Neo hai bên mũi.
  const za = h.L / 2 - h.L * 0.09;
  for (const s of [-1, 1]) decor.push(D("anchor", s * (halfBeamAt(h, za) - 0.1), deckAt(h, za) - 1.6, za, { r: Math.max(0.7, h.B * 0.045), rot: s }));
  // Cọc buộc dây dọc mép boong.
  for (let z = -h.L / 2 + 6; z < h.L / 2 - 8; z += 14) {
    if (skip(z)) continue;
    for (const s of [-1, 1]) decor.push(D("cyl", s * (halfBeamAt(h, z) - 1.1), deckAt(h, z) + 0.3, z, { r: 0.22, h: 0.6, mat: "dark" }));
  }
  // Hàng cửa sổ tròn trên thân (dải tối).
  for (let z = -h.L / 2 + 10; z < h.L / 2 - 14; z += 2.6) {
    if (Math.abs(z) > h.L * 0.38) continue;
    for (const s of [-1, 1]) decor.push(D("window", s * (halfBeamAt(h, z) + 0.02), deckAt(h, z) - 1.4, z, { w: 0.06, h: 0.45, d: 0.45, mat: "glass", n: 1 }));
  }
}

/** Chân vịt, bánh lái dưới đuôi. */
function propulsion(h: HullSpec, decor: ShipDecor[], screws: number) {
  const z = -h.L / 2 + h.L * 0.05;
  const y = -h.draft * 0.7;
  const r = Math.min(h.draft * 0.32, 2.6);
  for (let i = 0; i < screws; i++) {
    const x = screws === 1 ? 0 : (i - (screws - 1) / 2) * (h.B * 0.28);
    decor.push(D("prop", x, y, z, { r }));
  }
  decor.push(D("fin", 0, y, z - r - 0.6, { w: 0.4, h: h.draft * 0.7, d: r * 1.6, mat: "dark" }));
}

// ---------------------------------------------------------------------------- thiết giáp hạm

function battleship(): ShipClass {
  const h: HullSpec = { L: 170, B: 30, deck: 7, draft: 9.5, sheer: 3.6, sternSheer: 0.6, bowStart: 28, sternStart: -46, transom: 0.62 };
  const boxes: ShipBox[] = [];
  const decor: ShipDecor[] = [];
  hullSlices(h, boxes);
  const dk = (z: number) => deckAt(h, z);
  const gun = (z: number, y: number, rest: number): ShipMount => ({ weapon: "bbGun", pivot: [0, y, z], rest, arc: 2.4, barrels: 3, barrel: 18 });
  const t1 = gun(54, dk(54) + 2.4, 0);
  const t2 = gun(36, dk(36) + 6, 0);
  const t3 = gun(-58, dk(-58) + 2.4, Math.PI);
  barbette(boxes, t1, "t1", 11, 5);
  barbette(boxes, t2, "t2", 11, 8.5);
  barbette(boxes, t3, "t3", 11, 5);

  // Thượng tầng: tầng 1 rộng (sàn đi lại quanh ống khói), tháp chỉ huy, buồng lái, tháp quan sát, thượng tầng sau.
  const D1 = dk(0);
  const S1 = { z: -4, d: 52, w: 20, h: 4.6 };
  block(boxes, 0, D1, S1.z, S1.w, S1.h, S1.d, "mid");
  const top1 = D1 + S1.h;
  roofRails(boxes, 0, top1, S1.z, S1.w, S1.d, [[8, S1.z - S1.d / 2]]);
  block(boxes, 0, top1, 13, 13, 4, 18, "bridge");
  const top2 = top1 + 4;
  block(boxes, 0, top2, 16.5, 10, 3.4, 9, "bridge", "glass");
  const top3 = top2 + 3.4;
  boxes.push({ x: 0, y: top3 + 0.15, z: 16.5, w: 11, h: 0.3, d: 10, mat: "deck", solid: true, part: "bridge" });
  roofRails(boxes, 0, top3 + 0.3, 16.5, 11, 10, [[-3.2, 11.5]]);
  // Tháp quan sát (cột ăn-ten ba chân) trên buồng lái.
  block(boxes, 0, top3 + 0.3, 20, 3.2, 9, 3.2, "bridge", "steel");
  decor.push(D("box", 0, top3 + 9.6, 20, { w: 6, h: 1.2, d: 5, mat: "steel", part: "bridge" }));
  decor.push(D("mast", 0, top3 + 10.2, 20, { h: 11, r: 0.35, part: "radar" }));
  decor.push(D("radar", 0, top3 + 17.5, 20, { w: 5, part: "radar" }));
  decor.push(D("dish", 0, top3 + 12, 21.2, { r: 1.4, rot: 0.3, part: "radar" }));
  decor.push(D("flag", 0, top3 + 21, 20, { h: 2.2 }));
  // Cửa kính buồng lái, kính phía trước tháp chỉ huy.
  decor.push(D("window", 0, top2 + 2.3, 21.05, { w: 9.4, h: 1.1, d: 0.06, mat: "glass" }));
  decor.push(D("window", 0, top1 + 2.6, 22.05, { w: 11, h: 0.8, d: 0.06, mat: "glass" }));
  for (const s of [-1, 1]) decor.push(D("window", s * 5.03, top2 + 2.3, 16.5, { w: 0.06, h: 1.1, d: 8, mat: "glass" }));
  // Hai ống khói (buồng máy) và cột ăn-ten chính phía sau.
  for (const fz of [-7, -20]) {
    block(boxes, 0, top1, fz, 5.4, 9.5, 7.4, "engine", "dark");
    decor.push(D("funnel", 0, top1, fz, { w: 6, d: 8, h: 10.5, rot: 0.06, part: "engine" }));
  }
  decor.push(D("mast", 0, top1, -26, { h: 18, r: 0.4 }));
  decor.push(D("radar", 0, top1 + 15, -26, { w: 3.6 }));
  // Thượng tầng sau, cần cẩu và máy phóng thuỷ phi cơ ở đuôi.
  block(boxes, 0, dk(-38), -38, 12, 3.6, 12, "mid");
  roofRails(boxes, 0, dk(-38) + 3.6, -38, 12, 12);
  decor.push(D("box", 0, dk(-38) + 3.6, -38, { w: 4, h: 3, d: 4, mat: "steel" }));
  decor.push(D("dish", 0, dk(-38) + 7.2, -38, { r: 1.2, rot: 0.4 }));
  decor.push(D("crane", 0, dk(-76), -76, { h: 9, d: 14, rot: Math.PI * 0.85 }));
  for (const s of [-1, 1]) decor.push(D("box", s * 8, dk(-70) + 0.6, -70, { w: 1.2, h: 1.2, d: 14, mat: "dark", rot: s * 0.3 }));
  decor.push(D("jet", -8, dk(-70) + 1.8, -70, { rot: 0.3, r: 0.6 }));
  // Pháo phụ 127 ly hai bên tầng 1 (chỉ để vẽ), đèn pha, xuồng cứu sinh.
  for (const s of [-1, 1]) {
    for (const z of [8, -2, -14]) decor.push(D("gun", s * 8.3, top1, z, { w: 3.2, d: 3.6, h: 1.8, n: 2, r: 5.5, rot: (s * Math.PI) / 2 }));
    decor.push(D("light", s * 5.6, top2, 21, { r: 0.6 }));
    for (const z of [-28, -33]) decor.push(D("boat", s * 8.6, top1 + 1.4, z, { w: 2.4, d: 8.5 }));
  }
  // Cầu thang: boong chính → tầng 1 (sau), tầng 1 → tháp chỉ huy, tháp chỉ huy → nóc buồng lái.
  stairs(boxes, 8, dk(-41), top1, -41.5, S1.z - S1.d / 2 + 0.6, 1.6);
  stairs(boxes, 4, top1, top2, -1.5, 4.6, 1.4);
  stairs(boxes, -3.2, top2, top3 + 0.3, 6.6, 12.1, 1.3);

  // Phòng không 40 ly bốn nòng: hai bên tầng 1 phía trước, phía sau, và boong đuôi.
  const aa = (x: number, y: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc: 1.9, barrels: 4, barrel: 3.2 });
  const aas = [aa(8.4, top1 + 1, 18, Math.PI / 2), aa(-8.4, top1 + 1, 18, -Math.PI / 2), aa(8.4, top1 + 1, -24, Math.PI / 2), aa(-8.4, top1 + 1, -24, -Math.PI / 2), aa(9.5, dk(-50) + 1, -50, Math.PI * 0.7), aa(-9.5, dk(-50) + 1, -50, -Math.PI * 0.7)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.5, z: m.pivot[2], w: 3, h: 1, d: 3, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const tp = (s: number): ShipMount => ({ weapon: "torpedo", pivot: [s * 12.6, D1 + 0.9, 30], rest: (s * Math.PI) / 2, arc: 0.85, barrels: 3, barrel: 6 });
  for (const [i, s] of [1, -1].entries()) boxes.push({ x: s * 12.6, y: D1 + 0.45, z: 30, w: 1.8, h: 0.9, d: 4, mat: "dark", solid: true, part: `tp${i + 1}` });
  deckDetail(h, decor);
  propulsion(h, decor, 4);
  return {
    id: "battleship",
    name: "Thiết giáp hạm",
    brief: "Dài 170 m, máu trâu, ba tháp pháo chính 406 ly (mỗi tháp ba nòng) bắn xa nhất, sáu ổ phòng không, ngư lôi hai mạn. Chậm, quay chậm.",
    hp: 5400,
    length: h.L,
    beam: h.B,
    deck: h.deck,
    draft: h.draft,
    speed: 13,
    reverse: 4,
    accel: 0.8,
    turn: 0.05,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu (W/S tốc độ, A/D bẻ lái), bắn ngư lôi hai mạn (chuột trái).", [0, top3 + 0.3, 14], 0, ["torpedo"], true),
      role("gunner", "Pháo thủ chính", "Ba tháp pháo chính: ngắm vào mặt biển, máy tự tính góc nâng; chuột trái bắn loạt.", [5.5, top1, -26], 0, ["bbGun"]),
      role("aa", "Phòng không", "Sáu ổ pháo phòng không: bắn máy bay, tên lửa, lính trên boong tàu địch.", [-7.6, top1, 0], -Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(h),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 750, at: [0, top2 + 1.5, 16], r: 7 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 850, at: [0, top1 + 3, -13], r: 8 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 260, at: [0, top3 + 16, 20], r: 3.5 },
      { id: "t1", name: "Tháp pháo 1", kind: "turret", hp: 680, at: t1.pivot, r: 6.5, mount: t1 },
      { id: "t2", name: "Tháp pháo 2", kind: "turret", hp: 680, at: t2.pivot, r: 6.5, mount: t2 },
      { id: "t3", name: "Tháp pháo 3", kind: "turret", hp: 680, at: t3.pivot, r: 6.5, mount: t3 },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 170, at: m.pivot, r: 2.6, mount: m })),
      { id: "tp1", name: "Ống phóng ngư lôi trái", kind: "torpedo", hp: 280, at: tp(1).pivot, r: 3, mount: tp(1) },
      { id: "tp2", name: "Ống phóng ngư lôi phải", kind: "torpedo", hp: 280, at: tp(-1).pivot, r: 3, mount: tp(-1) },
    ],
    boxes,
    hull: h,
    decor,
  };
}

// ---------------------------------------------------------------------------- tàu khu trục

function destroyer(): ShipClass {
  const h: HullSpec = { L: 115, B: 12.5, deck: 5, draft: 4.6, sheer: 2.4, sternSheer: 0.3, bowStart: 16, sternStart: -36, transom: 0.68 };
  const boxes: ShipBox[] = [];
  const decor: ShipDecor[] = [];
  hullSlices(h, boxes, { slice: 3 });
  const dk = (z: number) => deckAt(h, z);
  const gun = (z: number, y: number, rest: number): ShipMount => ({ weapon: "ddGun", pivot: [0, y, z], rest, arc: 2.5, barrels: 2, barrel: 6.5 });
  const g1 = gun(38, dk(38) + 1.6, 0);
  const g2 = gun(-42, dk(-42) + 1.6, Math.PI);
  // Thượng tầng giữa: tầng 1, buồng lái kính, cột ra-đa; nhà sau đỡ tháp pháo bắn vượt.
  const D1 = dk(18);
  block(boxes, 0, D1, 19, 8, 3.2, 14, "mid");
  const top1 = D1 + 3.2;
  roofRails(boxes, 0, top1, 19, 8, 14, [[2.4, 12]]);
  block(boxes, 0, top1, 21, 6, 2.6, 7, "bridge", "glass");
  const top2 = top1 + 2.6;
  boxes.push({ x: 0, y: top2 + 0.15, z: 21, w: 6.6, h: 0.3, d: 7.6, mat: "deck", solid: true, part: "bridge" });
  roofRails(boxes, 0, top2 + 0.3, 21, 6.6, 7.6, [[-2.4, 17.2]]);
  decor.push(D("window", 0, top1 + 1.6, 24.55, { w: 5.6, h: 0.9, d: 0.06, mat: "glass" }));
  decor.push(D("mast", 0, top2 + 0.3, 19.5, { h: 12, r: 0.25, part: "radar" }));
  decor.push(D("radar", 0, top2 + 9, 19.5, { w: 3.2, part: "radar" }));
  decor.push(D("flag", 0, top2 + 12.3, 19.5, { h: 1.6 }));
  block(boxes, 0, top2 + 0.3, 19.2, 0.8, 4, 0.8, "radar", "dark");
  block(boxes, 0, dk(-28), -28, 6, 2.6, 10, "mid");
  const topA = dk(-28) + 2.6;
  const g3: ShipMount = { weapon: "ddGun", pivot: [0, topA + 1.5, -30], rest: Math.PI, arc: 2.3, barrels: 2, barrel: 6.5 };
  barbette(boxes, g1, "g1", 4.6, 2.4);
  barbette(boxes, g2, "g2", 4.6, 2.4);
  barbette(boxes, g3, "g3", 4.6, 1.6);
  // Hai ống khói nghiêng, ống phóng ngư lôi giữa tàu, giá bom chìm ở đuôi.
  for (const fz of [4, -8]) {
    block(boxes, 0, dk(fz), fz, 3, 6, 4, "engine", "dark");
    decor.push(D("funnel", 0, dk(fz), fz, { w: 3.4, d: 4.6, h: 7.2, rot: 0.12, part: "engine" }));
  }
  const tpm: ShipMount = { weapon: "torpedo", pivot: [0, dk(-17) + 1, -17], rest: Math.PI / 2, arc: Math.PI, barrels: 4, barrel: 7 };
  boxes.push({ x: 0, y: dk(-17) + 0.45, z: -17, w: 2.4, h: 0.9, d: 2.4, mat: "dark", solid: true, part: "tp1" });
  const dc: ShipMount = { weapon: "depth", pivot: [0, dk(-54) + 0.7, -54], rest: Math.PI, arc: 0.2, barrels: 2, barrel: 1 };
  for (const s of [-1, 1]) boxes.push({ x: s * 2.2, y: dk(-54) + 0.6, z: -54, w: 1.2, h: 1.2, d: 4, mat: "dark", solid: true, part: "dc" });
  for (const s of [-1, 1]) decor.push(D("cyl", s * 4.5, dk(-46) + 0.6, -46, { r: 0.35, h: 1.2, mat: "dark", part: "dc" }));
  // Phòng không: hai bên tầng 1, một ụ trên bệ cao giữa hai ống khói.
  const aa = (x: number, y: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc: 1.9, barrels: 2, barrel: 2.8 });
  const aas = [aa(3.1, top1 + 0.9, 14, Math.PI / 2), aa(-3.1, top1 + 0.9, 14, -Math.PI / 2), aa(0, dk(-1) + 2.6, -1.5, Math.PI)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.5, z: m.pivot[2], w: 2, h: 1, d: 2, mat: "dark", solid: true, part: `aa${i + 1}` }));
  boxes.push({ x: 0, y: dk(-1) + 0.8, z: -1.5, w: 2, h: 1.6, d: 2, mat: "steel", solid: true });
  for (const s of [-1, 1]) decor.push(D("boat", s * 4.6, dk(-2) + 1.6, -4, { w: 1.6, d: 6 }));
  // Cầu thang: boong → tầng 1 (sau), tầng 1 → nóc buồng lái.
  stairs(boxes, 2.4, dk(8), top1, 7.2, 12.6, 1.2);
  stairs(boxes, -2.4, top1, top2 + 0.3, 13.4, 17.8, 1.0);
  deckDetail(h, decor);
  propulsion(h, decor, 2);
  return {
    id: "destroyer",
    name: "Tàu khu trục",
    brief: "Như thiết giáp hạm thu nhỏ: ba tháp pháo 127 ly bắn nhanh (sát thương thấp hơn), ngư lôi bốn ống, bom chìm diệt tàu ngầm. Nhanh, quay gắt, máu mỏng.",
    hp: 2500,
    length: h.L,
    beam: h.B,
    deck: h.deck,
    draft: h.draft,
    speed: 18,
    reverse: 5,
    accel: 1.6,
    turn: 0.1,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu, bắn ngư lôi (chuột trái), thả bom chìm ở đuôi (chuột phải).", [0, top2 + 0.3, 21.6], 0, ["torpedo", "depth"], true),
      role("gunner", "Pháo thủ", "Ba tháp pháo 127 ly: ngắm mặt biển, chuột trái bắn.", [0, top1, 14.4], 0, ["ddGun"]),
      role("aa", "Phòng không", "Ba ổ phòng không: máy bay, tên lửa, lính trên boong địch.", [-4.2, dk(-12), -12], -Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections(h),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 460, at: [0, top1 + 1.5, 21], r: 4.5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 520, at: [0, dk(-2) + 2, -2], r: 6 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 190, at: [0, top2 + 9, 19.5], r: 2.6 },
      { id: "g1", name: "Tháp pháo mũi", kind: "turret", hp: 380, at: g1.pivot, r: 3.2, mount: g1 },
      { id: "g2", name: "Tháp pháo đuôi", kind: "turret", hp: 380, at: g2.pivot, r: 3.2, mount: g2 },
      { id: "g3", name: "Tháp pháo sau", kind: "turret", hp: 380, at: g3.pivot, r: 3.2, mount: g3 },
      { id: "tp1", name: "Ống phóng ngư lôi", kind: "torpedo", hp: 260, at: tpm.pivot, r: 2.8, mount: tpm },
      { id: "dc", name: "Giá bom chìm", kind: "depth", hp: 220, at: dc.pivot, r: 3, mount: dc },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 150, at: m.pivot, r: 2, mount: m })),
    ],
    boxes,
    hull: h,
    decor,
  };
}

// ---------------------------------------------------------------------------- tàu tên lửa

function cruiser(): ShipClass {
  const h: HullSpec = { L: 140, B: 17, deck: 6, draft: 7, sheer: 2.6, sternSheer: 0.2, bowStart: 22, sternStart: -46, transom: 0.82 };
  const boxes: ShipBox[] = [];
  const decor: ShipDecor[] = [];
  hullSlices(h, boxes);
  const dk = (z: number) => deckAt(h, z);
  // Giếng phóng thẳng đứng mũi, đuôi (ô nắp phẳng mặt boong).
  const vls = (z: number): ShipMount => ({ weapon: "missile", pivot: [0, dk(z) + 0.3, z], rest: 0, arc: Math.PI, barrels: 1, barrel: 1 });
  const v1 = vls(42);
  const v2 = vls(-46);
  for (const [id, m] of [
    ["v1", v1],
    ["v2", v2],
  ] as const) {
    boxes.push({ x: 0, y: m.pivot[1] - 0.15, z: m.pivot[2], w: 6.4, h: 0.3, d: 8, mat: "dark", solid: true, part: id });
    decor.push(D("cells", 0, m.pivot[1], m.pivot[2], { w: 6, d: 7.6, n: 8, part: id }));
  }
  // Nhà trước (ra-đa mảng pha bốn mặt, buồng lái trên nóc), nhà sau; hai cụm ống khói vuông.
  const DF = dk(18);
  block(boxes, 0, DF, 19, 13, 7, 30, "mid");
  const topF = DF + 7;
  roofRails(boxes, 0, topF, 19, 13, 30, [[-3, 4]]);
  block(boxes, 0, topF, 28.5, 11, 3, 9, "bridge", "glass");
  const topB = topF + 3;
  boxes.push({ x: 0, y: topB + 0.15, z: 28.5, w: 11.4, h: 0.3, d: 9.4, mat: "deck", solid: true, part: "bridge" });
  roofRails(boxes, 0, topB + 0.3, 28.5, 11.4, 9.4, [[0, 23.8]]);
  decor.push(D("window", 0, topF + 2, 33.05, { w: 10.4, h: 1, d: 0.06, mat: "glass" }));
  for (const [x, z, rot] of [
    [0, 34.05, 0],
    [6.55, 22, Math.PI / 2],
    [-6.55, 22, -Math.PI / 2],
  ] as const)
    decor.push(D("panel", x, DF + 4.6, z, { r: 2.4, rot, part: "radar" }));
  const DA = dk(-20);
  block(boxes, 0, DA, -20, 12, 6, 28, "mid");
  const topA = DA + 6;
  roofRails(boxes, 0, topA, -20, 12, 28, [[3, -6]]);
  for (const s of [-1, 1]) decor.push(D("panel", s * 6.05, DA + 3.6, -10, { r: 2.2, rot: (s * Math.PI) / 2, part: "radar" }));
  block(boxes, 0, topF, 12, 2.6, 4, 2.6, "radar", "steel");
  decor.push(D("mast", 0, topF + 4, 12, { h: 9, r: 0.3, part: "radar" }));
  decor.push(D("radar", 0, topF + 10, 12, { w: 4.4, part: "radar" }));
  decor.push(D("dish", 0, topF + 6.5, 12.9, { r: 0.9, rot: 0.2, part: "radar" }));
  decor.push(D("flag", 0, topF + 13.2, 12, { h: 1.8 }));
  decor.push(D("mast", 0, topA, -14, { h: 8, r: 0.3 }));
  decor.push(D("dish", 0, topA + 6, -14, { r: 1.1, rot: 0.5 }));
  for (const [fz, fy] of [
    [6, topF],
    [-31, topA],
  ] as const) {
    block(boxes, 0, fy, fz, 4.2, 3.4, 3.4, "engine", "dark");
    for (const s of [-1, 1]) decor.push(D("funnel", s * 1.2, fy, fz, { w: 1.8, d: 3.2, h: 3.8, rot: 0, part: "engine" }));
  }
  // Pháo 127 ly tự động mũi, đuôi (chỉ để vẽ), sàn trực thăng đuôi.
  decor.push(D("gun", 0, dk(56), 56, { w: 3.4, d: 4.4, h: 2.2, n: 1, r: 7, rot: 0 }));
  decor.push(D("gun", 0, dk(-36), -36, { w: 3.4, d: 4.4, h: 2.2, n: 1, r: 7, rot: Math.PI }));
  decor.push(D("pad", 0, dk(-58) + 0.03, -58, { r: 6 }));
  // Phòng không (pháo bắn nhanh) và ống phóng mồi nhử.
  const aa = (x: number, y: number, z: number, rest: number, arc: number): ShipMount => ({ weapon: "aa", pivot: [x, y, z], rest, arc, barrels: 1, barrel: 2.6 });
  const aas = [aa(0, topB + 1.2, 31.6, 0, 2.6), aa(4.8, topA + 1, -31, Math.PI / 2, 1.9), aa(-4.8, topA + 1, -31, -Math.PI / 2, 1.9)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.6, z: m.pivot[2], w: 2, h: 1.2, d: 2, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const dec: ShipMount = { weapon: "decoy", pivot: [5, topF + 0.5, 8], rest: Math.PI / 2, arc: Math.PI, barrels: 2, barrel: 1 };
  boxes.push({ x: 5, y: topF + 0.3, z: 8, w: 1.6, h: 0.6, d: 1.6, mat: "dark", solid: true, part: "decoy" });
  for (const s of [-1, 1]) decor.push(D("boat", s * 7.4, dk(0) + 1.4, 0, { w: 2, d: 6.5 }));
  // Cầu thang: boong → nhà trước (lên từ phía sau), boong → nhà sau (xuống về phía trước), nhà trước → nóc buồng lái.
  stairs(boxes, -3, dk(-4), topF, -4.5, 4.6, 1.4);
  stairs(boxes, 3, topA, dk(0), -6.6, 3.4, 1.4);
  stairs(boxes, 0, topF, topB + 0.3, 17.5, 24.4, 1.2);
  deckDetail(h, decor, (z) => Math.abs(z - 42) < 5 || Math.abs(z + 46) < 5);
  propulsion(h, decor, 2);
  return {
    id: "cruiser",
    name: "Tàu tên lửa",
    brief: "Hai cụm giếng phóng tên lửa chống hạm: người phóng nhìn từ đầu tên lửa, tự lái vào mục tiêu (tên lửa bay chậm, phòng không bắn hạ được). Hoa tiêu lái tàu, phóng mồi nhử, ra-đa soi tàu ngầm.",
    hp: 3100,
    length: h.L,
    beam: h.B,
    deck: h.deck,
    draft: h.draft,
    speed: 16,
    reverse: 4.5,
    accel: 1.2,
    turn: 0.075,
    roles: [
      role("navigator", "Hoa tiêu", "Lái tàu; chuột phải phóng mồi nhử (lừa tên lửa, ngư lôi địch); ra-đa soi tàu ngầm trong 450 m.", [0, topB + 0.3, 27], 0, ["decoy"], true),
      role("missile", "Sĩ quan tên lửa", "Chuột trái phóng tên lửa, nhìn từ đầu tên lửa, rê chuột lái vào tàu địch. Tránh lưới phòng không.", [4.2, topF, 17], 0, ["missile"]),
      role("aa", "Phòng không", "Ba ổ pháo bắn nhanh: máy bay, tên lửa, lính trên boong địch.", [0, topA, -22], Math.PI, ["aa"]),
    ],
    parts: [
      ...sections(h),
      { id: "bridge", name: "Cầu chỉ huy", kind: "bridge", hp: 560, at: [0, topF + 1.5, 28.5], r: 5.5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 620, at: [0, DF, -2], r: 7 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 280, at: [0, topF + 7, 12], r: 3.5 },
      { id: "v1", name: "Giếng phóng mũi", kind: "vls", hp: 480, at: v1.pivot, r: 4.2, mount: v1 },
      { id: "v2", name: "Giếng phóng đuôi", kind: "vls", hp: 480, at: v2.pivot, r: 4.2, mount: v2 },
      { id: "decoy", name: "Ống phóng mồi nhử", kind: "decoy", hp: 200, at: dec.pivot, r: 1.8, mount: dec },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 160, at: m.pivot, r: 2, mount: m })),
    ],
    boxes,
    hull: h,
    decor,
  };
}

// ---------------------------------------------------------------------------- tàu sân bay

function carrier(): ShipClass {
  const h: HullSpec = { L: 220, B: 34, deck: 10, draft: 10.5, sheer: 1.2, sternSheer: 0, bowStart: 50, sternStart: -82, transom: 0.82 };
  const FD = 20;
  const boxes: ShipBox[] = [];
  const decor: ShipDecor[] = [];
  hullSlices(h, boxes, { rails: false, slice: 5 });
  // Vách nhà chứa máy bay hai bên, sàn bay rộng chìa ra hai mạn (phần chéo bên trái là đường hạ cánh).
  for (const s of [-1, 1]) boxes.push({ x: s * 16.4, y: (h.deck + FD) / 2, z: 0, w: 1, h: FD - h.deck, d: 186, mat: "hull", solid: true, part: "mid", hidden: true });
  const deckMain = { x: 1, z: 2, w: 50, d: 212 };
  const deckAngle = { x: 29.5, z: -35, w: 7, d: 90 };
  for (const p of [deckMain, deckAngle]) boxes.push({ x: p.x, y: FD - 0.5, z: p.z, w: p.w, h: 1, d: p.d, mat: "flight", solid: true, part: "mid" });
  // Lan can quanh mép sàn bay.
  const railY = FD + 0.55;
  boxes.push({ x: -23.95, y: railY, z: deckMain.z, w: 0.1, h: 1.1, d: deckMain.d, mat: "rail", solid: true });
  boxes.push({ x: 25.95, y: railY, z: (108 + -80 + 10) / 2 + 20, w: 0.1, h: 1.1, d: 98, mat: "rail", solid: true });
  boxes.push({ x: 25.95, y: railY, z: -92, w: 0.1, h: 1.1, d: 24, mat: "rail", solid: true });
  boxes.push({ x: 32.95, y: railY, z: deckAngle.z, w: 0.1, h: 1.1, d: deckAngle.d, mat: "rail", solid: true });
  for (const z of [deckAngle.z - deckAngle.d / 2, deckAngle.z + deckAngle.d / 2]) boxes.push({ x: 29.5, y: railY, z, w: 7, h: 1.1, d: 0.1, mat: "rail", solid: true });
  for (const z of [deckMain.z - deckMain.d / 2 + 0.05, deckMain.z + deckMain.d / 2 - 0.05]) boxes.push({ x: deckMain.x, y: railY, z, w: deckMain.w, h: 1.1, d: 0.1, mat: "rail", solid: true });
  // Đảo chỉ huy bên mạn phải: hai tầng, buồng lái kính, cột ra-đa cao, ống khói.
  const IX = -19.5;
  block(boxes, IX, FD, 4, 7, 6, 40, "bridge", "steel");
  const top1 = FD + 6;
  roofRails(boxes, IX, top1, 4, 7, 40, [[IX, -16]]);
  block(boxes, IX - 0.5, top1, 4, 5, 3.6, 20, "bridge", "glass");
  const top2 = top1 + 3.6;
  boxes.push({ x: IX - 0.5, y: top2 + 0.15, z: 4, w: 5.6, h: 0.3, d: 20.6, mat: "deck", solid: true, part: "bridge" });
  roofRails(boxes, IX - 0.5, top2 + 0.3, 4, 5.6, 20.6, [[IX - 0.5, -6.3]]);
  decor.push(D("window", IX + 2.03, top1 + 2.2, 4, { w: 0.06, h: 1, d: 19, mat: "glass" }));
  decor.push(D("window", IX - 0.5, top1 + 2.2, 14.03, { w: 4.6, h: 1, d: 0.06, mat: "glass" }));
  block(boxes, IX - 0.5, top2 + 0.3, 11, 1.6, 6, 1.6, "radar", "steel");
  decor.push(D("mast", IX - 0.5, top2 + 6.3, 11, { h: 9, r: 0.35, part: "radar" }));
  decor.push(D("radar", IX - 0.5, top2 + 13, 11, { w: 5.2, part: "radar" }));
  decor.push(D("dish", IX - 0.5, top2 + 9, 12, { r: 1.5, rot: 0.3, part: "radar" }));
  decor.push(D("flag", IX - 0.5, top2 + 15.6, 11, { h: 2 }));
  block(boxes, IX, top1, 20, 4.6, 4.2, 5.4, "engine", "dark");
  decor.push(D("funnel", IX, top1, 20, { w: 5, d: 6, h: 5, rot: 0.04, part: "engine" }));
  // Máy phóng hai đường ở mũi, đường băng chéo, máy bay đậu đuôi mạn phải, thang nâng máy bay.
  const cat: ShipMount = { weapon: "jetGun", pivot: [8, FD + 0.1, 72], rest: 0, arc: 0.1, barrels: 1, barrel: 1 };
  boxes.push({ x: 8, y: FD + 0.05, z: 72, w: 1.2, h: 0.1, d: 60, mat: "accent", solid: false, part: "cat" });
  decor.push(D("box", -6, FD + 0.03, 74, { w: 1.2, h: 0.06, d: 56, mat: "accent" }));
  for (const [x, z] of [
    [-14, -60],
    [-14, -72],
    [-14, -84],
    [-6, -66],
    [-6, -78],
    [-14, 40],
    [-14, 52],
  ] as const)
    decor.push(D("jet", x, FD, z, { rot: -Math.PI * 0.62, r: 1 }));
  for (const z of [-40, 30]) decor.push(D("box", -21, FD + 0.02, z, { w: 6, h: 0.04, d: 14, mat: "steel" }));
  for (let i = 0; i < 4; i++) decor.push(D("wire", 14, FD + 0.04, -58 + i * 9, { w: 26, rot: 0.15 }));
  // Phòng không trên các ụ chìa ra mép sàn bay.
  const aa = (x: number, z: number, rest: number): ShipMount => ({ weapon: "aa", pivot: [x, FD + 1, z], rest, arc: 1.7, barrels: 2, barrel: 2.8 });
  const aas = [aa(24.5, 96, Math.PI / 2), aa(-22.5, 92, -Math.PI / 2), aa(31.5, -20, Math.PI / 2), aa(-22.5, -36, -Math.PI / 2), aa(23, -98, Math.PI * 0.8), aa(-21, -98, -Math.PI * 0.8)];
  aas.forEach((m, i) => boxes.push({ x: m.pivot[0], y: m.pivot[1] - 0.5, z: m.pivot[2], w: 2.2, h: 1, d: 2.2, mat: "dark", solid: true, part: `aa${i + 1}` }));
  const tp = (s: number): ShipMount => ({ weapon: "torpedo", pivot: [s * 16.8, h.deck - 2, -30], rest: (s * Math.PI) / 2, arc: 0.85, barrels: 2, barrel: 4 });
  // Cầu thang: sàn bay → tầng 1 đảo (từ phía sau), tầng 1 → nóc buồng lái.
  stairs(boxes, IX, FD, top1, -24, -15.4, 1.8);
  stairs(boxes, IX - 0.5, top1, top2 + 0.3, -12.5, -5.7, 1.4);
  deckDetail(h, decor);
  propulsion(h, decor, 4);
  return {
    id: "carrier",
    name: "Tàu sân bay",
    brief: "Dài 220 m. Phi công cất cánh tiêm kích bom từ sàn bay (súng 20 ly, ba quả bom 500 kg, bay sát tàu mẹ để nạp lại). Sáu ổ súng phòng không. Thuyền trưởng lái tàu, bắn ngư lôi.",
    hp: 4800,
    length: h.L,
    beam: 66,
    deck: FD,
    draft: h.draft,
    speed: 14,
    reverse: 4,
    accel: 0.8,
    turn: 0.045,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu (W/S tốc độ, A/D bẻ lái), bắn ngư lôi hai mạn (chuột trái).", [IX - 0.5, top2 + 0.3, 2], 0, ["torpedo"], true),
      role("pilot", "Phi công", "Đứng ở máy phóng, chuột trái cất cánh. Bay theo hướng chuột, W/S ga, chuột trái súng, chuột phải thả bom, F bỏ máy bay.", [14, FD, 64], 0, ["jetGun", "bomb"]),
      role("aa", "Phòng không", "Sáu ổ súng máy phòng không: bắn máy bay, tên lửa, lính trên boong địch.", [18, FD, -30], Math.PI / 2, ["aa"]),
    ],
    parts: [
      ...sections({ ...h, deck: h.deck + 4 }),
      { id: "bridge", name: "Đảo chỉ huy", kind: "bridge", hp: 680, at: [IX, top1, 4], r: 7 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 800, at: [0, h.deck - 2, -14], r: 9 },
      { id: "radar", name: "Ra-đa", kind: "radar", hp: 250, at: [IX - 0.5, top2 + 12, 11], r: 3 },
      { id: "cat", name: "Máy phóng", kind: "catapult", hp: 540, at: cat.pivot, r: 6, mount: cat },
      ...aas.map((m, i) => ({ id: `aa${i + 1}`, name: `Phòng không ${i + 1}`, kind: "aa" as const, hp: 170, at: m.pivot, r: 2.2, mount: m })),
      { id: "tp1", name: "Ống phóng ngư lôi trái", kind: "torpedo", hp: 260, at: tp(1).pivot, r: 3, mount: tp(1) },
      { id: "tp2", name: "Ống phóng ngư lôi phải", kind: "torpedo", hp: 260, at: tp(-1).pivot, r: 3, mount: tp(-1) },
    ],
    boxes,
    hull: h,
    decor,
  };
}

// ---------------------------------------------------------------------------- tàu ngầm

function submarine(): ShipClass {
  const h: HullSpec = { L: 96, B: 8.6, deck: 1.8, draft: 7.2, sheer: 0.4, sternSheer: 0, bowStart: 30, sternStart: -26, transom: 0.05, round: true };
  const boxes: ShipBox[] = [];
  const decor: ShipDecor[] = [];
  hullSlices(h, boxes, { slice: 3, walk: 5.2 });
  // Tháp chỉ huy (sail), kính tiềm vọng, cột ăn-ten, cánh lặn trên tháp, thang lên.
  block(boxes, 0, h.deck, 14, 3.2, 6, 12, "bridge", "hull");
  const top = h.deck + 6;
  boxes.push({ x: 0, y: top + 0.15, z: 14, w: 3.4, h: 0.3, d: 12.4, mat: "deck", solid: true, part: "bridge" });
  block(boxes, 0, top + 0.3, 18.5, 0.4, 3.4, 0.4, "scope", "dark");
  decor.push(D("cyl", 0, top + 0.3, 17.2, { r: 0.18, h: 4.2, mat: "dark", part: "scope" }));
  decor.push(D("cyl", 0.5, top + 0.3, 16, { r: 0.12, h: 2.6, mat: "dark" }));
  for (const s of [-1, 1]) decor.push(D("fin", s * 3, top - 1.5, 15.5, { w: 3, h: 0.25, d: 2.2, mat: "hull" }));
  decor.push(D("flag", 0.6, top + 2.9, 16, { h: 1.2 }));
  stairs(boxes, 0, h.deck, top + 0.3, 1.4, 8.4, 1.1);
  // Pháo boong phía sau tháp (để vẽ), cánh lặn mũi, bánh lái, cánh đuôi chữ thập, chân vịt.
  decor.push(D("gun", 0, h.deck, -4, { w: 1.8, d: 2.4, h: 1.2, n: 1, r: 4, rot: 0 }));
  for (const s of [-1, 1]) decor.push(D("fin", s * 4.6, -1.2, 36, { w: 2.6, h: 0.25, d: 2.2, mat: "hull" }));
  for (const s of [-1, 1]) decor.push(D("fin", s * 2.6, -2.3, -45, { w: 3, h: 0.25, d: 2.6, mat: "hull" }));
  decor.push(D("fin", 0, -2.3, -45, { w: 0.25, h: 6, d: 2.6, mat: "hull" }));
  decor.push(D("prop", 0, -2.3, -47.4, { r: 1.6 }));
  // Cửa ống phóng ngư lôi ở mũi.
  for (const [x, y] of [
    [-1.1, -1.4],
    [1.1, -1.4],
    [-1.1, -2.8],
    [1.1, -2.8],
  ] as const)
    decor.push(D("cyl", x, y, 46.4, { r: 0.42, h: 0.2, mat: "dark", rot: 1 }));
  const bow: ShipMount = { weapon: "torpedo", pivot: [0, -1.8, h.L / 2 - 3], rest: 0, arc: 0.6, barrels: 2, barrel: 2 };
  const gt = (z: number, rest: number): ShipMount => ({ weapon: "gtorpedo", pivot: [0, -1.8, z], rest, arc: 0.4, barrels: 1, barrel: 2 });
  const g1 = gt(h.L / 2 - 6, 0);
  const g2 = gt(-h.L / 2 + 6, Math.PI);
  return {
    id: "submarine",
    name: "Tàu ngầm",
    brief: "Lặn (C) để tàng hình, tránh pháo và tên lửa (chỉ ngư lôi, bom chìm, đạn nổ sát mới trúng); dưỡng khí có hạn. Hai sĩ quan ngư lôi dẫn đường lái ngư lôi bằng chuột; thuyền trưởng ngắm kính tiềm vọng bắn ngư lôi thẳng.",
    hp: 2000,
    length: h.L,
    beam: h.B,
    deck: h.deck,
    draft: h.draft,
    speed: 12,
    reverse: 3.5,
    accel: 1,
    turn: 0.08,
    roles: [
      role("captain", "Thuyền trưởng", "Lái tàu, C lặn / nổi, ngắm kính tiềm vọng bắn hai ngư lôi mũi (chuột trái).", [0, top + 0.3, 13.4], 0, ["torpedo"], true),
      role("torpedo", "Sĩ quan ngư lôi mũi", "Chuột trái phóng ngư lôi dẫn đường, rê chuột lái theo mục tiêu.", [0, h.deck, 30], 0, ["gtorpedo"]),
      role("torpedo", "Sĩ quan ngư lôi đuôi", "Chuột trái phóng ngư lôi dẫn đường từ đuôi, rê chuột lái theo mục tiêu.", [0, h.deck, -18], Math.PI, ["gtorpedo"]),
    ],
    parts: [
      ...sections(h),
      { id: "bridge", name: "Tháp chỉ huy", kind: "bridge", hp: 430, at: [0, h.deck + 3, 14], r: 4.5 },
      { id: "engine", name: "Buồng máy", kind: "engine", hp: 460, at: [0, -1.5, -22], r: 5 },
      { id: "scope", name: "Kính tiềm vọng", kind: "periscope", hp: 150, at: [0, top + 2.5, 18], r: 1.8 },
      { id: "tb", name: "Ống ngư lôi mũi", kind: "torpedo", hp: 300, at: bow.pivot, r: 3, mount: bow },
      { id: "gt1", name: "Ống dẫn đường mũi", kind: "torpedo", hp: 260, at: g1.pivot, r: 2.6, mount: g1 },
      { id: "gt2", name: "Ống dẫn đường đuôi", kind: "torpedo", hp: 260, at: g2.pivot, r: 2.6, mount: g2 },
    ],
    boxes,
    hull: h,
    decor,
  };
}

export const SHIP_BUILDERS = { battleship, carrier, cruiser, submarine, destroyer } as const;
