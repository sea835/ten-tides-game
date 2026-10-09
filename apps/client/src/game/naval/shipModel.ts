import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, PlaneGeometry, RingGeometry, SphereGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deckAt, halfBeamAt, type ShipBox, type ShipClass, type ShipDecor } from "@tentides/content";

// Dựng hình chiến hạm cho máy vẽ (toạ độ riêng của tàu): vỏ tàu trơn theo đúng dáng thân (sơn chống hà đỏ dưới
// nước, vạch đen mớn nước, thân xám, sọc màu phe), mặt boong (ván gỗ / thép), lan can song chắn, cầu thang bậc, các
// khối thượng tầng, và mọi chi tiết trang trí (ống khói, cột buồm, ra-đa, xuồng, pháo phụ, máy bay đậu...). Gộp theo
// (vật liệu, bộ phận) cho ít lệnh vẽ; bộ phận hỏng thì cả nhóm của nó đổi sang màu cháy đen.

export type ModelMat = ShipBox["mat"] | "loft" | "boat" | "marking" | "bronze" | "funnelCap" | "team";

export interface ModelPart {
  key: string;
  mat: ModelMat;
  part: string;
  geometry: BufferGeometry;
}

/** Pháp tuyến bằng 0 hay NaN (mặt thoái hoá) thay bằng hướng lên: shader chia cho độ dài sẽ ra NaN, hình đen. */
function saneNormals(g: BufferGeometry) {
  const n = g.getAttribute("normal");
  if (!n) return;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i);
    const y = n.getY(i);
    const z = n.getZ(i);
    const l = Math.hypot(x, y, z);
    if (!Number.isFinite(l) || l < 1e-4) n.setXYZ(i, 0, 1, 0);
    else if (Math.abs(l - 1) > 1e-3) n.setXYZ(i, x / l, y / l, z / l);
  }
}

class Bucket {
  private groups = new Map<string, BufferGeometry[]>();
  add(mat: ModelMat, part: string | undefined, g: BufferGeometry) {
    const key = `${mat}|${part ?? ""}`;
    // Gộp được thì mọi hình phải cùng bộ thuộc tính: bỏ uv nếu có, thêm sau cho đồng nhất.
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv" && name !== "color") geo.deleteAttribute(name);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new Float32BufferAttribute(new Float32Array((geo.getAttribute("position").count * 2) | 0), 2));
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const list = this.groups.get(key) ?? [];
    list.push(geo);
    this.groups.set(key, list);
  }
  build(): ModelPart[] {
    const out: ModelPart[] = [];
    for (const [key, list] of this.groups) {
      for (const g of list) saneNormals(g);
      const [mat, part] = key.split("|") as [ModelMat, string];
      const withColor = list.some((g) => g.getAttribute("color"));
      if (withColor) for (const g of list) if (!g.getAttribute("color")) g.setAttribute("color", new Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));
      const geometry = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      if (geometry) out.push({ key, mat, part, geometry });
    }
    return out;
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) => {
  const g = new BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  return g.translate(x, y, z);
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------- vỏ tàu

const RED = new Color("#7b2a22");
const BOOT = new Color("#141516");
const GREY = new Color("#5d646c");
const SUB = new Color("#26292c");

/** Vỏ tàu trơn: các mặt cắt ngang dọc thân nối lại; màu theo độ cao (sơn chống hà, vạch mớn nước, thân, sọc phe). */
function hullLoft(cls: ShipClass, team: Color): BufferGeometry {
  const h = cls.hull;
  const L = h.L;
  // Mặt cắt dày hơn ở mũi (đường cong gắt).
  const zs: number[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    zs.push(-L / 2 + L * (t < 0.7 ? t : 0.7 + (t - 0.7)));
  }
  for (let z = L * 0.2; z < L / 2; z += 0.6) zs.push(z);
  zs.sort((a, b) => a - b);
  const pos: number[] = [];
  const col: number[] = [];
  const ring = (z: number): { x: number; y: number; c: Color }[] => {
    const hw = halfBeamAt(h, z);
    const top = deckAt(h, z);
    const bow = smooth(0, L * 0.08, L / 2 - z);
    const stern = 0.5 + 0.5 * smooth(0, L * 0.1, z + L / 2);
    const keel = -h.draft * Math.pow(bow, 0.55) * stern;
    const pts: { x: number; y: number; c: Color }[] = [];
    if (h.round) {
      const r = Math.max(0.05, hw);
      const yc = top - r * 1.05 + 0.05;
      for (let k = 0; k <= 16; k++) {
        const a = -Math.PI / 2 + (k / 16) * Math.PI;
        pts.push({ x: Math.cos(a) * r, y: yc + Math.sin(a) * r * 1.05, c: SUB });
      }
      return pts;
    }
    const under = (y: number) => {
      const f = 0.97 * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, y / keel), 4)), 0.25);
      return f * (0.35 + 0.65 * Math.pow(bow, 0.7));
    };
    const ys = [keel, keel * 0.97, keel * 0.88, keel * 0.7, keel * 0.45, keel * 0.2, -0.45, -0.38, 0.32, 0.4, top - 1.7, top - 1.6, top - 1.15, top - 1.05, top];
    for (const y of ys) {
      const f = y <= 0 ? (y <= keel + 1e-6 ? 0 : under(y)) : 0.97 + 0.03 * Math.min(1, y / Math.max(0.1, top));
      const c = y < -0.4 ? RED : y < 0.36 ? BOOT : y > top - 1.65 && y < top - 1.1 ? team : GREY;
      pts.push({ x: hw * f, y, c });
    }
    return pts;
  };
  // Tam giác thoái hoá (mũi nhọn, sống đáy chụm lại) bỏ đi: pháp tuyến bằng 0 thành NaN trong shader, quầng sáng
  // (bloom) loang NaN ra thành mảng đen.
  const tri: number[] = [];
  const triCol: number[] = [];
  const push = (x: number, y: number, z: number, c: Color) => {
    tri.push(x, y, z);
    triCol.push(c.r, c.g, c.b);
    if (tri.length < 9) return;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tri as [number, number, number, number, number, number, number, number, number];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area > 1e-6) {
      pos.push(...tri);
      col.push(...triCol);
    }
    tri.length = 0;
    triCol.length = 0;
  };
  let prev = ring(zs[0]!);
  // Đuôi tàu: mặt phẳng đứng (vát) đóng lại.
  const tz = zs[0]!;
  for (let k = 0; k < prev.length - 1; k++) {
    const a = prev[k]!;
    const b = prev[k + 1]!;
    for (const s of [-1, 1]) {
      push(0, a.y, tz, a.c);
      push(s * a.x, a.y, tz, a.c);
      push(s * b.x, b.y, tz, b.c);
      push(0, a.y, tz, a.c);
      push(s * b.x, b.y, tz, b.c);
      push(0, b.y, tz, b.c);
    }
  }
  let pz = zs[0]!;
  for (let i = 1; i < zs.length; i++) {
    const z = zs[i]!;
    const cur = ring(z);
    for (let k = 0; k < cur.length - 1; k++) {
      const a0 = prev[k]!;
      const a1 = prev[k + 1]!;
      const b0 = cur[k]!;
      const b1 = cur[k + 1]!;
      for (const s of [-1, 1]) {
        push(s * a0.x, a0.y, pz, a0.c);
        push(s * b0.x, b0.y, z, b0.c);
        push(s * b1.x, b1.y, z, b1.c);
        push(s * a0.x, a0.y, pz, a0.c);
        push(s * b1.x, b1.y, z, b1.c);
        push(s * a1.x, a1.y, pz, a1.c);
      }
    }
    prev = cur;
    pz = z;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Mặt boong chính theo mép thân (uv theo mét, cho vân ván gỗ / thép chống trượt). */
function deckSurface(cls: ShipClass): BufferGeometry {
  const h = cls.hull;
  const pos: number[] = [];
  const uv: number[] = [];
  const width = (z: number) => (h.round ? Math.min(halfBeamAt(h, z), 2.6) : halfBeamAt(h, z) * 0.995);
  const step = 0.8;
  for (let z = -h.L / 2; z < h.L / 2 - 0.01; z += step) {
    const z1 = Math.min(h.L / 2, z + step);
    const w0 = width(z);
    const w1 = width(z1);
    const y0 = deckAt(h, z) + 0.015;
    const y1 = deckAt(h, z1) + 0.015;
    const quad = [
      [-w0, y0, z],
      [w1, y1, z1],
      [w0, y0, z],
      [-w0, y0, z],
      [-w1, y1, z1],
      [w1, y1, z1],
    ];
    for (const [x, y, zz] of quad) {
      pos.push(x!, y!, zz!);
      uv.push(x! / 3, zz! / 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------- lan can, cầu thang

/** Lan can song chắn: tay vịn trên, thanh giữa, cọc đứng cách nhau 1,5 m. */
function railing(b: ShipBox, out: Bucket) {
  const along = b.d >= b.w;
  const len = along ? b.d : b.w;
  const top = b.y + b.h / 2;
  const bottom = b.y - b.h / 2;
  for (const y of [top - 0.03, bottom + b.h * 0.5]) out.add("rail", b.part, along ? box(0.05, 0.05, len, b.x, y, b.z) : box(len, 0.05, 0.05, b.x, y, b.z));
  const n = Math.max(1, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len * i) / n;
    out.add("rail", b.part, along ? box(0.05, b.h, 0.05, b.x, b.y, b.z + t) : box(0.05, b.h, 0.05, b.x + t, b.y, b.z));
  }
}

/** Cầu thang bậc theo khối dốc: bậc 0,25 m, hai thành bên. */
function staircase(b: ShipBox, out: Bucket) {
  const pitch = b.pitch ?? 0;
  const run = b.d * Math.cos(pitch);
  const rise = -b.d * Math.sin(pitch);
  const n = Math.max(2, Math.round(Math.abs(rise) / 0.25));
  const y0 = b.y + 0.1 - rise / 2;
  const z0 = b.z - run / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.add("steel", b.part, box(b.w, 0.07, (run / n) * 1.05, b.x, y0 + rise * t - 0.03, z0 + run * t));
  }
  for (const s of [-1, 1]) {
    const g = new BoxGeometry(0.08, 0.35, b.d);
    g.rotateX(pitch);
    g.translate(b.x + (s * b.w) / 2, b.y + 0.12, b.z);
    out.add("steel", b.part, g);
    // Tay vịn.
    const r = new BoxGeometry(0.05, 0.05, b.d);
    r.rotateX(pitch);
    r.translate(b.x + (s * b.w) / 2, b.y + 1.05, b.z);
    out.add("rail", b.part, r);
  }
}

// ---------------------------------------------------------------------------- chi tiết

function decorGeometry(d: ShipDecor, out: Bucket) {
  const { x, y, z } = d;
  const rot = d.rot ?? 0;
  const part = d.part;
  switch (d.kind) {
    case "box":
      out.add(d.mat ?? "steel", part, box(d.w ?? 1, d.h ?? 1, d.d ?? 1, x, y + (d.h ?? 1) / 2, z, rot));
      return;
    case "window":
      out.add("glass", part, box(d.w ?? 1, d.h ?? 1, d.d ?? 1, x, y, z));
      return;
    case "fin":
      out.add(d.mat ?? "hull", part, box(d.w ?? 1, d.h ?? 1, d.d ?? 1, x, y, z));
      return;
    case "cyl": {
      const r = d.r ?? 0.3;
      const hh = d.h ?? 1;
      const g = new CylinderGeometry(r, r, hh, 12);
      if (rot === 1) g.rotateX(Math.PI / 2).translate(x, y, z);
      else g.translate(x, y + hh / 2, z);
      out.add(d.mat ?? "steel", part, g);
      return;
    }
    case "funnel": {
      const hh = d.h ?? 8;
      const body = new CylinderGeometry(0.5, 0.53, hh, 24, 1, true);
      body.scale(d.w ?? 4, 1, d.d ?? 5);
      body.translate(0, hh / 2, 0);
      body.rotateX(-rot);
      body.translate(x, y, z);
      out.add("steel", part, body);
      const cap = new CylinderGeometry(0.52, 0.52, 1.4, 24, 1, true);
      cap.scale(d.w ?? 4, 1, d.d ?? 5);
      cap.translate(0, hh - 0.7, 0);
      cap.rotateX(-rot);
      cap.translate(x, y, z);
      out.add("funnelCap", part, cap);
      // Lòng ống khói tối, vành trên.
      const top = new CylinderGeometry(0.5, 0.5, 0.1, 24);
      top.scale((d.w ?? 4) * 0.94, 1, (d.d ?? 5) * 0.94);
      top.translate(0, hh - 0.3, 0);
      top.rotateX(-rot);
      top.translate(x, y, z);
      out.add("dark", part, top);
      return;
    }
    case "mast": {
      const hh = d.h ?? 10;
      const r = d.r ?? 0.3;
      out.add("steel", part, new CylinderGeometry(r * 0.55, r, hh, 8).translate(x, y + hh / 2, z));
      for (const [k, w] of [
        [0.72, hh * 0.38],
        [0.88, hh * 0.24],
      ] as const)
        out.add("steel", part, box(w, 0.14, 0.14, x, y + hh * k, z));
      out.add("steel", part, box(hh * 0.16, 0.12, hh * 0.16, x, y + hh * 0.55, z));
      // Dây chằng (nghiêng) hai bên.
      for (const s of [-1, 1]) {
        const g = new BoxGeometry(0.04, hh * 0.8, 0.04);
        g.rotateZ(s * 0.18);
        g.translate(x - s * hh * 0.07, y + hh * 0.4, z);
        out.add("dark", part, g);
      }
      return;
    }
    case "radar": {
      const w = d.w ?? 4;
      out.add("steel", part, new CylinderGeometry(0.18, 0.25, 0.8, 8).translate(x, y + 0.4, z));
      out.add("dark", part, box(w, 0.7, 0.18, x, y + 1.1, z));
      for (let i = 0; i < 6; i++) out.add("steel", part, box(0.05, 0.75, 0.22, x - w / 2 + (w * (i + 0.5)) / 6, y + 1.1, z));
      return;
    }
    case "dish": {
      const r = d.r ?? 1;
      const g = new SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
      g.rotateX(Math.PI / 2 - rot);
      g.translate(x, y + r, z);
      out.add("accent", part, g);
      out.add("steel", part, new CylinderGeometry(0.12, 0.18, r, 6).translate(x, y + r / 2, z));
      return;
    }
    case "boat": {
      const w = d.w ?? 2;
      const len = d.d ?? 7;
      const hullG = new SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      hullG.scale(w / 2, 0.9, len / 2).translate(x, y, z);
      out.add("boat", part, hullG);
      const cover = new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.32);
      cover.scale(w / 2.1, 0.6, len / 2.1).translate(x, y - 0.05, z);
      out.add("accent", part, cover);
      // Cần treo xuồng.
      for (const s of [-0.35, 0.35]) out.add("steel", part, box(0.12, 1.8, 0.12, x - Math.sign(x || 1) * (w * 0.6), y - 0.4, z + s * len));
      return;
    }
    case "gun": {
      const w = d.w ?? 3;
      const hh = d.h ?? 1.6;
      const dd = d.d ?? 3.5;
      const len = d.r ?? 5;
      const n = d.n ?? 2;
      const parts: BufferGeometry[] = [];
      parts.push(new CylinderGeometry(w * 0.55, w * 0.6, 0.4, 16).translate(0, 0.2, 0));
      const house = new BoxGeometry(w, hh, dd);
      // Mặt trước vát: kéo các đỉnh mặt trước phía trên lùi lại.
      const p = house.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0 && p.getY(i) > 0) p.setZ(i, p.getZ(i) - dd * 0.25);
      house.computeVertexNormals();
      parts.push(house.translate(0, 0.4 + hh / 2, 0));
      for (let i = 0; i < n; i++) {
        const b = new CylinderGeometry(0.12, 0.16, len, 8).rotateX(Math.PI / 2);
        b.translate((i - (n - 1) / 2) * 0.55, 0.4 + hh * 0.45, dd * 0.3 + len / 2);
        parts.push(b);
      }
      const g = mergeGeometries(parts.map((q) => (q.index ? q.toNonIndexed() : q)))!;
      g.rotateY(rot);
      g.translate(x, y, z);
      out.add("steel", part, g);
      return;
    }
    case "cells": {
      const w = d.w ?? 6;
      const dd = d.d ?? 8;
      const n = d.n ?? 8;
      const cols = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < cols; j++) out.add("steel", part, box((w / cols) * 0.82, 0.06, (dd / n) * 0.82, x - w / 2 + (w * (j + 0.5)) / cols, y + 0.03, z - dd / 2 + (dd * (i + 0.5)) / n));
      return;
    }
    case "jet": {
      const k = d.r ?? 1;
      const parts: { g: BufferGeometry; mat: ModelMat }[] = [];
      parts.push({ g: new BoxGeometry(1.2, 1.2, 11).translate(0, 1.6, 0), mat: "steel" });
      parts.push({ g: new CylinderGeometry(0, 0.6, 2, 8).rotateX(Math.PI / 2).translate(0, 1.6, 6.4), mat: "steel" });
      // Cánh gập lên khi đậu trên sàn.
      for (const s of [-1, 1]) {
        const wing = new BoxGeometry(2.6, 0.16, 3).translate(s * 1.9, 1.5, 0.2);
        const tip = new BoxGeometry(0.16, 2.2, 2.4).translate(s * 3.2, 2.5, 0.2);
        parts.push({ g: wing, mat: "team" }, { g: tip, mat: "team" });
        parts.push({ g: new BoxGeometry(1.8, 0.12, 1.5).translate(s * 1.3, 1.7, -4.6), mat: "team" });
      }
      parts.push({ g: new BoxGeometry(0.14, 2, 1.8).translate(0, 2.8, -4.6), mat: "steel" });
      parts.push({ g: new SphereGeometry(0.55, 10, 6).scale(1, 0.7, 2).translate(0, 2.3, 3), mat: "glass" });
      for (const [gx, gz] of [
        [0, 4],
        [-1.1, -0.6],
        [1.1, -0.6],
      ] as const)
        parts.push({ g: new CylinderGeometry(0.28, 0.28, 0.25, 10).rotateZ(Math.PI / 2).translate(gx, 0.3, gz), mat: "dark" }, { g: new BoxGeometry(0.1, 0.9, 0.1).translate(gx, 0.75, gz), mat: "steel" });
      for (const { g, mat } of parts) {
        g.scale(k, k, k);
        g.rotateY(rot);
        g.translate(x, y, z);
        out.add(mat, part, g);
      }
      return;
    }
    case "pad": {
      const r = d.r ?? 6;
      out.add("marking", part, new RingGeometry(r - 0.35, r, 40).rotateX(-Math.PI / 2).translate(x, y, z));
      for (const [bx, bw, bd] of [
        [-1.4, 0.5, 4],
        [1.4, 0.5, 4],
        [0, 2.8, 0.5],
      ] as const)
        out.add("marking", part, new PlaneGeometry(bw, bd).rotateX(-Math.PI / 2).translate(x + bx, y, z));
      return;
    }
    case "crane": {
      const hh = d.h ?? 8;
      const len = d.d ?? 12;
      out.add("steel", part, new CylinderGeometry(0.5, 0.7, hh, 10).translate(x, y + hh / 2, z));
      const boom = new BoxGeometry(0.5, 0.5, len);
      boom.translate(0, 0, len / 2);
      boom.rotateX(-0.5);
      boom.rotateY(rot);
      boom.translate(x, y + hh - 0.5, z);
      out.add("accent", part, boom);
      return;
    }
    case "panel": {
      const r = d.r ?? 2.4;
      const g = new CylinderGeometry(r, r, 0.25, 8);
      g.rotateY(Math.PI / 8);
      g.rotateX(Math.PI / 2 - 0.25);
      g.rotateY(rot);
      g.translate(x, y, z);
      out.add("dark", part, g);
      return;
    }
    case "prop": {
      const r = d.r ?? 2;
      out.add("bronze", part, new CylinderGeometry(r * 0.18, r * 0.22, r * 0.5, 10).rotateX(Math.PI / 2).translate(x, y, z));
      for (let i = 0; i < 4; i++) {
        const blade = new BoxGeometry(r * 0.38, r, 0.12);
        blade.translate(0, r / 2, 0);
        blade.rotateY(0.5);
        blade.rotateZ((i * Math.PI) / 2);
        blade.translate(x, y, z);
        out.add("bronze", part, blade);
      }
      return;
    }
    case "anchor": {
      const r = d.r ?? 1;
      const s = Math.sign(rot || 1);
      out.add("dark", part, new CylinderGeometry(r * 0.55, r * 0.55, 0.2, 14).rotateZ(Math.PI / 2).translate(x + s * 0.05, y, z));
      out.add("dark", part, box(0.18, r * 1.4, 0.2, x + s * 0.15, y - r * 0.4, z));
      out.add("dark", part, box(0.2, 0.22, r * 1.3, x + s * 0.15, y - r * 1.05, z));
      return;
    }
    case "light": {
      const r = d.r ?? 0.6;
      out.add("steel", part, new CylinderGeometry(0.12, 0.15, 0.8, 8).translate(x, y + 0.4, z));
      out.add("steel", part, new CylinderGeometry(r, r * 0.8, r * 1.4, 12).rotateX(Math.PI / 2).translate(x, y + 0.8 + r, z));
      out.add("glass", part, new CylinderGeometry(r * 0.85, r * 0.85, 0.05, 12).rotateX(Math.PI / 2).translate(x, y + 0.8 + r, z + r * 0.72));
      return;
    }
    case "flag": {
      const hh = d.h ?? 2;
      out.add("team", part, new PlaneGeometry(hh * 1.5, hh).translate((hh * 1.5) / 2, -hh / 2, 0).rotateY(Math.PI / 2).translate(x, y, z));
      return;
    }
    case "wire":
      out.add("dark", part, box(d.w ?? 20, 0.05, 0.08, x, y, z, rot));
      return;
  }
}

/** Sàn bay tàu sân bay: vạch sơn (đường băng chéo, vạch tim, vạch an toàn, số hiệu) vẽ lên một tấm phẳng. */
function flightMarkings(cls: ShipClass, out: Bucket) {
  const decks = cls.boxes.filter((b) => b.mat === "flight");
  for (const b of decks) {
    const top = b.y + b.h / 2 + 0.02;
    // Mép sàn: vạch trắng hai bên.
    for (const s of [-1, 1]) out.add("marking", undefined, new PlaneGeometry(0.3, b.d - 2).rotateX(-Math.PI / 2).translate(b.x + s * (b.w / 2 - 1), top, b.z));
  }
  const main = decks[0];
  if (!main) return;
  const top = main.y + main.h / 2 + 0.025;
  // Vạch tim đứt quãng (vàng) dọc sàn, đường băng chéo (trắng) ở đuôi, vạch dừng, số hiệu ở mũi.
  for (let z = main.z - main.d / 2 + 30; z < main.z + main.d / 2 - 8; z += 9) out.add("accent", undefined, new PlaneGeometry(0.5, 5).rotateX(-Math.PI / 2).translate(main.x - 4, top, z));
  // Đường hạ cánh chéo sang mạn trái: từ gần đuôi (giữa sàn) chạy về phía mũi lệch trái, nằm gọn trong sàn bay.
  const angle = 0.16;
  const cx = 13;
  const cz = -42;
  const along = (t: number, side: number): [number, number] => [cx + Math.sin(angle) * t + side * Math.cos(angle), cz + Math.cos(angle) * t - side * Math.sin(angle)];
  for (let t = -56; t <= 46; t += 8) {
    const [x, z] = along(t, 0);
    out.add("marking", undefined, new PlaneGeometry(0.45, 5).rotateX(-Math.PI / 2).rotateY(angle).translate(x, top + 0.005, z));
  }
  for (const s of [-1, 1]) {
    const [x, z] = along(-5, s * 9);
    out.add("marking", undefined, new PlaneGeometry(0.4, 106).rotateX(-Math.PI / 2).rotateY(angle).translate(x, top + 0.004, z));
  }
  // Số hiệu: hai chữ số to (mỗi nét một tấm).
  const digit = (cx: number, cz: number, segs: string) => {
    const S: Record<string, [number, number, number, number]> = {
      a: [0, 3, 3, 0.6],
      b: [1.5, 1.5, 0.6, 3],
      c: [1.5, -1.5, 0.6, 3],
      d: [0, -3, 3, 0.6],
      e: [-1.5, -1.5, 0.6, 3],
      f: [-1.5, 1.5, 0.6, 3],
      g: [0, 0, 3, 0.6],
    };
    for (const c of segs) {
      const [sx, sz, w, dd] = S[c]!;
      // Đọc được khi nhìn từ đuôi lên mũi: x ngược (mạn phải là âm).
      out.add("marking", undefined, new PlaneGeometry(w, dd).rotateX(-Math.PI / 2).translate(cx - sx, top + 0.006, cz + sz));
    }
  };
  digit(4, main.z + main.d / 2 - 22, "abdeg");
  digit(-2, main.z + main.d / 2 - 22, "abcdfg");
}

/** Toàn bộ hình tàu (theo lớp tàu, màu phe), gộp theo vật liệu và bộ phận. */
export function buildShipModel(cls: ShipClass, team: Color): ModelPart[] {
  const out = new Bucket();
  out.add("loft", undefined, hullLoft(cls, team));
  out.add(cls.hull.deck >= 6 && cls.id === "battleship" ? "wood" : "deck", undefined, deckSurface(cls));
  for (const b of cls.boxes) {
    if (b.hidden) continue;
    if (b.mat === "rail") {
      railing(b, out);
      continue;
    }
    if (b.pitch) {
      staircase(b, out);
      continue;
    }
    if (b.mat === "accent" && !b.solid) {
      // Đường máy phóng: rãnh tối với vạch sáng hai bên.
      out.add("dark", b.part, box(b.w, b.h, b.d, b.x, b.y, b.z));
      for (const s of [-1, 1]) out.add("marking", b.part, box(0.12, b.h + 0.01, b.d, b.x + (s * b.w) / 2, b.y, b.z));
      continue;
    }
    out.add(b.mat, b.part, box(b.w, b.h, b.d, b.x, b.y, b.z));
  }
  for (const d of cls.decor) decorGeometry(d, out);
  if (cls.id === "carrier") flightMarkings(cls, out);
  return out.build();
}
