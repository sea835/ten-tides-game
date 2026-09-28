import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  type BufferGeometry,
  type Group,
  type Mesh,
} from "three";
import { worldCatalog } from "@tentides/content";
import type { CreatureState } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { localPosition } from "./shared.ts";

// Sinh vật: server cho đi lại, client chỉ nội suy vị trí và tạo dáng. Mỗi loài là một bộ khối low-poly
// khai báo bằng dữ liệu (hình, kích thước, vị trí, màu, kiểu cử động), nên thêm loài mới chỉ cần thêm một mục.
// Con xa quá 90 m thì không vẽ.

type Shape = "box" | "ball" | "cone" | "cyl" | "gem";
/** legA/legB: chân bước so le · wingL/wingR: vỗ cánh · tail: vẫy đuôi · fin: quẫy vây · bell: sứa co bóp · wave: uốn theo đốt · sway: đung đưa. */
type Anim = "legA" | "legB" | "wingL" | "wingR" | "tail" | "fin" | "bell" | "wave" | "sway";

interface Part {
  g: Shape;
  /** Hộp: kích thước thật. Khối tròn, nón, trụ: bán kính theo bề ngang, chiều cao theo trục y. */
  s: [number, number, number];
  p: [number, number, number];
  r?: [number, number, number];
  c: string;
  /** Độ phát sáng (0 là không). */
  e?: number;
  a?: Anim;
  /** Thứ tự đốt cho kiểu cử động "wave". */
  i?: number;
}

interface Model {
  parts: Part[];
  /** Nổi lên trên mặt đất chừng này (vẹt đậu lơ lửng như đang bay chuyền cành). */
  hover?: number;
}

const leg = (x: number, z: number, len: number, c: string, a: Anim, w = 0.07): Part => ({ g: "box", s: [w, len, w], p: [x, len / 2, z], c, a });

function chain(n: number, step: number, radius: number, c: string, taper = 0.6, extra?: (k: number) => Part[]): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < n; k++) {
    const r = radius * (1 - (k / n) * (1 - taper));
    out.push({ g: "ball", s: [r, r * 0.8, r * 1.3], p: [0, r * 0.8, -k * step], c, a: "wave", i: k });
    if (extra) out.push(...extra(k).map((p) => ({ ...p, a: "wave" as Anim, i: k })));
  }
  return out;
}

const MODELS: Record<string, Model> = {
  turtle: {
    parts: [
      { g: "ball", s: [0.55, 0.22, 0.7], p: [0, 0.22, 0], c: "#4f6d35" },
      { g: "ball", s: [0.5, 0.08, 0.62], p: [0, 0.08, 0], c: "#c9b98a" },
      { g: "ball", s: [0.14, 0.12, 0.16], p: [0, 0.18, 0.72], c: "#8a9a5a" },
      { g: "box", s: [0.42, 0.05, 0.2], p: [0.45, 0.1, 0.35], r: [0, -0.4, 0], c: "#8a9a5a", a: "fin" },
      { g: "box", s: [0.42, 0.05, 0.2], p: [-0.45, 0.1, 0.35], r: [0, 0.4, 0], c: "#8a9a5a", a: "fin" },
      { g: "box", s: [0.25, 0.05, 0.14], p: [0.3, 0.1, -0.5], c: "#8a9a5a", a: "legB" },
      { g: "box", s: [0.25, 0.05, 0.14], p: [-0.3, 0.1, -0.5], c: "#8a9a5a", a: "legA" },
    ],
  },
  crab: {
    parts: [
      { g: "ball", s: [0.32, 0.14, 0.24], p: [0, 0.22, 0], c: "#c4452c" },
      { g: "ball", s: [0.1, 0.08, 0.1], p: [0.28, 0.25, 0.28], c: "#d9583c", a: "sway" },
      { g: "ball", s: [0.1, 0.08, 0.1], p: [-0.28, 0.25, 0.28], c: "#d9583c", a: "sway" },
      { g: "box", s: [0.03, 0.12, 0.03], p: [0.08, 0.36, 0.18], c: "#222" },
      { g: "box", s: [0.03, 0.12, 0.03], p: [-0.08, 0.36, 0.18], c: "#222" },
      ...[-0.12, 0, 0.12].flatMap((z, k) => [
        { g: "box" as Shape, s: [0.34, 0.03, 0.03] as [number, number, number], p: [0.3, 0.12, z] as [number, number, number], r: [0, 0, -0.5] as [number, number, number], c: "#a33a24", a: (k % 2 ? "legA" : "legB") as Anim },
        { g: "box" as Shape, s: [0.34, 0.03, 0.03] as [number, number, number], p: [-0.3, 0.12, z] as [number, number, number], r: [0, 0, 0.5] as [number, number, number], c: "#a33a24", a: (k % 2 ? "legB" : "legA") as Anim },
      ]),
    ],
  },
  parrot: {
    hover: 1.6,
    parts: [
      { g: "ball", s: [0.13, 0.2, 0.13], p: [0, 0.2, 0], r: [0.4, 0, 0], c: "#8f9aa3" },
      { g: "ball", s: [0.1, 0.1, 0.1], p: [0, 0.4, 0.07], c: "#b7c0c6" },
      { g: "cone", s: [0.04, 0.09, 0.04], p: [0, 0.38, 0.18], r: [1.9, 0, 0], c: "#222" },
      { g: "box", s: [0.08, 0.02, 0.3], p: [0, 0.08, -0.2], r: [-0.5, 0, 0], c: "#c0392b", a: "tail" },
      { g: "box", s: [0.3, 0.02, 0.16], p: [0.15, 0.25, 0], c: "#7d8891", a: "wingR" },
      { g: "box", s: [0.3, 0.02, 0.16], p: [-0.15, 0.25, 0], c: "#7d8891", a: "wingL" },
    ],
  },
  dolphin: {
    parts: [
      { g: "ball", s: [0.32, 0.3, 1.1], p: [0, 0, 0], c: "#7d8fa3" },
      { g: "ball", s: [0.26, 0.2, 0.9], p: [0, -0.08, 0], c: "#c9d3dc" },
      { g: "cone", s: [0.08, 0.35, 0.08], p: [0, -0.02, 1.2], r: [Math.PI / 2, 0, 0], c: "#7d8fa3" },
      { g: "cone", s: [0.08, 0.4, 0.2], p: [0, 0.38, -0.1], r: [-0.4, 0, 0], c: "#6d7f93" },
      { g: "box", s: [0.7, 0.04, 0.25], p: [0, 0, -1.15], c: "#6d7f93", a: "fin" },
      { g: "box", s: [0.35, 0.03, 0.18], p: [0.3, -0.15, 0.3], r: [0, 0, -0.5], c: "#6d7f93" },
      { g: "box", s: [0.35, 0.03, 0.18], p: [-0.3, -0.15, 0.3], r: [0, 0, 0.5], c: "#6d7f93" },
    ],
  },
  shark: {
    parts: [
      { g: "ball", s: [0.45, 0.42, 1.6], p: [0, 0, 0], c: "#5d6d7e" },
      { g: "ball", s: [0.38, 0.28, 1.3], p: [0, -0.14, 0.1], c: "#dfe6ea" },
      { g: "cone", s: [0.1, 0.8, 0.35], p: [0, 0.65, 0], r: [-0.3, 0, 0], c: "#3b4652" },
      { g: "box", s: [0.08, 0.9, 0.35], p: [0, 0.1, -1.7], r: [0.3, 0, 0], c: "#3b4652", a: "tail" },
      { g: "box", s: [0.7, 0.04, 0.3], p: [0.5, -0.2, 0.4], r: [0, 0, -0.4], c: "#4b5866" },
      { g: "box", s: [0.7, 0.04, 0.3], p: [-0.5, -0.2, 0.4], r: [0, 0, 0.4], c: "#4b5866" },
      { g: "box", s: [0.05, 0.05, 0.05], p: [0.25, 0.1, 1.2], c: "#111" },
      { g: "box", s: [0.05, 0.05, 0.05], p: [-0.25, 0.1, 1.2], c: "#111" },
    ],
  },
  goat: {
    parts: [
      { g: "box", s: [0.45, 0.42, 0.85], p: [0, 0.75, 0], c: "#d9d2c5" },
      { g: "box", s: [0.26, 0.3, 0.36], p: [0, 1.05, 0.52], c: "#e7e1d6" },
      { g: "cone", s: [0.05, 0.3, 0.05], p: [0.08, 1.3, 0.45], r: [-0.6, 0, 0], c: "#5a4a3a" },
      { g: "cone", s: [0.05, 0.3, 0.05], p: [-0.08, 1.3, 0.45], r: [-0.6, 0, 0], c: "#5a4a3a" },
      { g: "box", s: [0.08, 0.15, 0.06], p: [0, 0.85, 0.72], c: "#bdb4a4" },
      leg(0.15, 0.3, 0.55, "#bdb4a4", "legA", 0.09),
      leg(-0.15, 0.3, 0.55, "#bdb4a4", "legB", 0.09),
      leg(0.15, -0.3, 0.55, "#bdb4a4", "legB", 0.09),
      leg(-0.15, -0.3, 0.55, "#bdb4a4", "legA", 0.09),
      { g: "box", s: [0.08, 0.14, 0.08], p: [0, 0.98, -0.45], c: "#d9d2c5", a: "tail" },
    ],
  },
  monkey: {
    parts: [
      { g: "ball", s: [0.22, 0.28, 0.2], p: [0, 0.55, 0], c: "#7b5a3c" },
      { g: "ball", s: [0.16, 0.16, 0.16], p: [0, 0.9, 0.06], c: "#7b5a3c" },
      { g: "ball", s: [0.11, 0.1, 0.06], p: [0, 0.87, 0.18], c: "#d7b58f" },
      { g: "ball", s: [0.06, 0.06, 0.03], p: [0.15, 0.95, 0.04], c: "#d7b58f" },
      { g: "ball", s: [0.06, 0.06, 0.03], p: [-0.15, 0.95, 0.04], c: "#d7b58f" },
      leg(0.12, 0.05, 0.35, "#6a4c33", "legA"),
      leg(-0.12, 0.05, 0.35, "#6a4c33", "legB"),
      { g: "box", s: [0.06, 0.4, 0.06], p: [0.24, 0.55, 0.05], r: [0, 0, 0.3], c: "#6a4c33", a: "legB" },
      { g: "box", s: [0.06, 0.4, 0.06], p: [-0.24, 0.55, 0.05], r: [0, 0, -0.3], c: "#6a4c33", a: "legA" },
      { g: "cyl", s: [0.03, 0.8, 0.03], p: [0, 0.6, -0.4], r: [-0.9, 0, 0], c: "#6a4c33", a: "tail" },
    ],
  },
  boar: {
    parts: [
      { g: "box", s: [0.55, 0.5, 1.05], p: [0, 0.6, 0], c: "#4a3528" },
      { g: "box", s: [0.12, 0.2, 0.8], p: [0, 0.92, 0], c: "#2e2019" },
      { g: "box", s: [0.4, 0.38, 0.4], p: [0, 0.62, 0.66], c: "#4a3528" },
      { g: "box", s: [0.22, 0.18, 0.14], p: [0, 0.52, 0.9], c: "#8a6a5a" },
      { g: "cone", s: [0.03, 0.18, 0.03], p: [0.1, 0.52, 0.94], r: [-0.8, 0, 0], c: "#f2ecdc" },
      { g: "cone", s: [0.03, 0.18, 0.03], p: [-0.1, 0.52, 0.94], r: [-0.8, 0, 0], c: "#f2ecdc" },
      { g: "box", s: [0.04, 0.04, 0.02], p: [0.12, 0.72, 0.87], c: "#e0322b", e: 1.2 },
      { g: "box", s: [0.04, 0.04, 0.02], p: [-0.12, 0.72, 0.87], c: "#e0322b", e: 1.2 },
      leg(0.18, 0.35, 0.4, "#3a281e", "legA", 0.12),
      leg(-0.18, 0.35, 0.4, "#3a281e", "legB", 0.12),
      leg(0.18, -0.35, 0.4, "#3a281e", "legB", 0.12),
      leg(-0.18, -0.35, 0.4, "#3a281e", "legA", 0.12),
      { g: "box", s: [0.04, 0.2, 0.04], p: [0, 0.7, -0.55], c: "#2e2019", a: "tail" },
    ],
  },
  snake: { parts: chain(9, 0.2, 0.09, "#2e4a3a", 0.5, (k) => (k % 2 ? [{ g: "box", s: [0.1, 0.02, 0.06], p: [0, 0.16, -k * 0.2], c: "#e0c341" }] : [])) },
  bat: {
    parts: [
      { g: "ball", s: [0.1, 0.12, 0.1], p: [0, 0, 0], c: "#2a2326" },
      { g: "cone", s: [0.03, 0.08, 0.03], p: [0.05, 0.12, 0.02], c: "#2a2326" },
      { g: "cone", s: [0.03, 0.08, 0.03], p: [-0.05, 0.12, 0.02], c: "#2a2326" },
      { g: "box", s: [0.4, 0.015, 0.2], p: [0.2, 0.02, 0], c: "#3b3036", a: "wingR" },
      { g: "box", s: [0.4, 0.015, 0.2], p: [-0.2, 0.02, 0], c: "#3b3036", a: "wingL" },
    ],
  },
  twin_bat: {
    parts: [
      { g: "ball", s: [0.14, 0.16, 0.13], p: [0, 0, 0], c: "#3a1f2a" },
      { g: "ball", s: [0.08, 0.08, 0.08], p: [0.09, 0.15, 0.06], c: "#3a1f2a" },
      { g: "ball", s: [0.08, 0.08, 0.08], p: [-0.09, 0.15, 0.06], c: "#3a1f2a" },
      { g: "box", s: [0.03, 0.03, 0.02], p: [0.1, 0.17, 0.13], c: "#ff2b2b", e: 2.5 },
      { g: "box", s: [0.03, 0.03, 0.02], p: [-0.1, 0.17, 0.13], c: "#ff2b2b", e: 2.5 },
      { g: "box", s: [0.55, 0.015, 0.28], p: [0.28, 0.02, 0], c: "#4a2a36", a: "wingR" },
      { g: "box", s: [0.55, 0.015, 0.28], p: [-0.28, 0.02, 0], c: "#4a2a36", a: "wingL" },
    ],
  },
  jellyfish: {
    parts: [
      { g: "ball", s: [0.35, 0.25, 0.35], p: [0, 0.25, 0], c: "#ff9de2", e: 1.4, a: "bell" },
      ...Array.from({ length: 6 }, (_, k): Part => ({
        g: "cyl",
        s: [0.015, 0.8, 0.015],
        p: [Math.cos(k) * 0.18, -0.25, Math.sin(k) * 0.18],
        c: "#ffc4ef",
        e: 0.8,
        a: "sway",
      })),
    ],
  },
  fish: {
    parts: [
      { g: "ball", s: [0.12, 0.16, 0.35], p: [0, 0, 0], c: "#dfe9ec", e: 0.35 },
      { g: "box", s: [0.02, 0.2, 0.15], p: [0, 0, -0.4], c: "#c9d6db", a: "tail" },
      { g: "box", s: [0.02, 0.1, 0.12], p: [0, 0.16, 0], c: "#c9d6db" },
    ],
  },
  fox: {
    parts: [
      { g: "box", s: [0.28, 0.28, 0.7], p: [0, 0.48, 0], c: "#2b2d42" },
      { g: "box", s: [0.24, 0.22, 0.26], p: [0, 0.62, 0.42], c: "#2b2d42" },
      { g: "cone", s: [0.08, 0.2, 0.08], p: [0, 0.58, 0.62], r: [Math.PI / 2, 0, 0], c: "#1d1e2e" },
      { g: "cone", s: [0.06, 0.16, 0.05], p: [0.08, 0.8, 0.38], c: "#2b2d42" },
      { g: "cone", s: [0.06, 0.16, 0.05], p: [-0.08, 0.8, 0.38], c: "#2b2d42" },
      { g: "box", s: [0.05, 0.04, 0.02], p: [0.07, 0.66, 0.56], c: "#5ff7ff", e: 3 },
      { g: "box", s: [0.05, 0.04, 0.02], p: [-0.07, 0.66, 0.56], c: "#5ff7ff", e: 3 },
      leg(0.1, 0.22, 0.34, "#1d1e2e", "legA"),
      leg(-0.1, 0.22, 0.34, "#1d1e2e", "legB"),
      leg(0.1, -0.22, 0.34, "#1d1e2e", "legB"),
      leg(-0.1, -0.22, 0.34, "#1d1e2e", "legA"),
      { g: "ball", s: [0.1, 0.1, 0.35], p: [0, 0.5, -0.5], r: [0.4, 0, 0], c: "#3d4060", a: "tail" },
    ],
  },
  octopus: {
    parts: [
      { g: "ball", s: [0.3, 0.35, 0.3], p: [0, 0.45, 0], c: "#9c6b5b" },
      { g: "box", s: [0.05, 0.05, 0.02], p: [0.12, 0.4, 0.27], c: "#f2e14c", e: 1 },
      { g: "box", s: [0.05, 0.05, 0.02], p: [-0.12, 0.4, 0.27], c: "#f2e14c", e: 1 },
      ...Array.from({ length: 8 }, (_, k): Part => ({
        g: "cyl",
        s: [0.04, 0.6, 0.02],
        p: [Math.cos((k / 8) * Math.PI * 2) * 0.3, 0.12, Math.sin((k / 8) * Math.PI * 2) * 0.3],
        r: [Math.sin((k / 8) * Math.PI * 2) * 1.1, 0, -Math.cos((k / 8) * Math.PI * 2) * 1.1],
        c: "#8a5a4b",
        a: "sway",
      })),
    ],
  },
  lizard: {
    parts: [
      { g: "box", s: [0.4, 0.22, 1.1], p: [0, 0.25, 0], c: "#3b2f2f" },
      { g: "box", s: [0.1, 0.05, 1], p: [0, 0.37, 0], c: "#ff6a1a", e: 2.2 },
      { g: "box", s: [0.3, 0.05, 0.12], p: [0, 0.37, 0.2], c: "#ff6a1a", e: 2 },
      { g: "box", s: [0.3, 0.05, 0.12], p: [0, 0.37, -0.25], c: "#ff6a1a", e: 2 },
      { g: "box", s: [0.26, 0.18, 0.35], p: [0, 0.27, 0.7], c: "#3b2f2f" },
      { g: "box", s: [0.04, 0.03, 0.02], p: [0.1, 0.33, 0.87], c: "#ffd21a", e: 2 },
      { g: "box", s: [0.04, 0.03, 0.02], p: [-0.1, 0.33, 0.87], c: "#ffd21a", e: 2 },
      { g: "cone", s: [0.1, 0.9, 0.08], p: [0, 0.2, -1], r: [-Math.PI / 2, 0, 0], c: "#3b2f2f", a: "tail" },
      { g: "box", s: [0.35, 0.06, 0.08], p: [0.3, 0.12, 0.35], r: [0, 0, -0.4], c: "#2a2020", a: "legA" },
      { g: "box", s: [0.35, 0.06, 0.08], p: [-0.3, 0.12, 0.35], r: [0, 0, 0.4], c: "#2a2020", a: "legB" },
      { g: "box", s: [0.35, 0.06, 0.08], p: [0.3, 0.12, -0.35], r: [0, 0, -0.4], c: "#2a2020", a: "legB" },
      { g: "box", s: [0.35, 0.06, 0.08], p: [-0.3, 0.12, -0.35], r: [0, 0, 0.4], c: "#2a2020", a: "legA" },
    ],
  },
  crystal_crab: {
    parts: [
      { g: "ball", s: [0.36, 0.16, 0.28], p: [0, 0.22, 0], c: "#6a4b6b" },
      ...Array.from({ length: 6 }, (_, k): Part => ({
        g: "gem",
        s: [0.07, 0.22 + (k % 3) * 0.08, 0.07],
        p: [Math.cos(k * 1.1) * 0.18, 0.42, Math.sin(k * 1.1) * 0.12],
        r: [Math.sin(k) * 0.4, 0, Math.cos(k) * 0.4],
        c: "#7ff3ff",
        e: 1.8,
      })),
      { g: "ball", s: [0.12, 0.09, 0.12], p: [0.32, 0.25, 0.3], c: "#8a5a8b", a: "sway" },
      { g: "ball", s: [0.12, 0.09, 0.12], p: [-0.32, 0.25, 0.3], c: "#8a5a8b", a: "sway" },
      ...[-0.12, 0, 0.12].flatMap((z, k): Part[] => [
        { g: "box", s: [0.36, 0.03, 0.03], p: [0.32, 0.12, z], r: [0, 0, -0.5], c: "#4f384f", a: k % 2 ? "legA" : "legB" },
        { g: "box", s: [0.36, 0.03, 0.03], p: [-0.32, 0.12, z], r: [0, 0, 0.5], c: "#4f384f", a: k % 2 ? "legB" : "legA" },
      ]),
    ],
  },
  centipede: {
    parts: chain(10, 0.26, 0.16, "#5b2a3a", 0.7, (k) => [
      { g: "box", s: [0.6, 0.03, 0.04], p: [0, 0.06, -k * 0.26], r: [0, 0, 0], c: "#2e1520" },
      ...(k === 0
        ? [
            { g: "box" as Shape, s: [0.05, 0.04, 0.02] as [number, number, number], p: [0.07, 0.22, 0.18] as [number, number, number], c: "#b6ff3a", e: 2.5 },
            { g: "box" as Shape, s: [0.05, 0.04, 0.02] as [number, number, number], p: [-0.07, 0.22, 0.18] as [number, number, number], c: "#b6ff3a", e: 2.5 },
          ]
        : []),
    ]),
  },
  eel: {
    parts: chain(10, 0.22, 0.12, "#3c4a2a", 0.5, (k) =>
      k === 0
        ? [
            { g: "box", s: [0.04, 0.04, 0.02], p: [0.06, 0.13, 0.14], c: "#f5f03a", e: 2.5 },
            { g: "box", s: [0.04, 0.04, 0.02], p: [-0.06, 0.13, 0.14], c: "#f5f03a", e: 2.5 },
            { g: "box", s: [0.04, 0.04, 0.02], p: [0, 0.19, 0.12], c: "#f5f03a", e: 2.5 },
          ]
        : k % 3 === 1
          ? [{ g: "box", s: [0.02, 0.1, 0.06], p: [0, 0.22, -k * 0.22], c: "#8fe3ff", e: 1.5 }]
          : [],
    ),
  },
};

const geometries: Record<Shape, BufferGeometry> = {
  box: new BoxGeometry(1, 1, 1),
  ball: new IcosahedronGeometry(1, 2),
  cone: new ConeGeometry(1, 1, 10),
  cyl: new CylinderGeometry(1, 1, 1, 10),
  gem: new OctahedronGeometry(1, 0),
};

const materials = new Map<string, MeshStandardMaterial>();
function material(color: string, emissive = 0): MeshStandardMaterial {
  const key = `${color}:${emissive}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, emissive: emissive ? color : "#000000", emissiveIntensity: emissive, toneMapped: emissive === 0 });
    materials.set(key, m);
  }
  return m;
}

const VISIBLE_RANGE = 90;

const barMats = {
  back: new MeshBasicMaterial({ color: "#1a1010", transparent: true, opacity: 0.7, depthTest: false }),
  fill: new MeshBasicMaterial({ color: "#e0413a", depthTest: false }),
  star: new MeshBasicMaterial({ color: "#ffe066", toneMapped: false }),
};

function CreatureView({ creature }: { creature: CreatureState }) {
  const def = worldCatalog.creatures.get(creature.species);
  const model = def ? MODELS[def.model] : undefined;
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const parts = useRef<(Group | null)[]>([]);
  const anim = useRef({ phase: Math.random() * 10, speed: 0, lastX: creature.x, lastZ: creature.z, hp: creature.hp, flash: 0, hitAt: -99 });
  const bar = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const stars = useRef<Group>(null);
  const size = def?.size ?? 1;

  useFrame(({ clock, camera }, rawDt) => {
    const g = root.current;
    if (!g || !model) return;
    const dt = Math.min(rawDt, 0.05);
    const t = Math.min(1, dt * 8);
    g.position.x += (creature.x - g.position.x) * t;
    g.position.y += (creature.y + (model.hover ?? 0) - g.position.y) * t;
    g.position.z += (creature.z - g.position.z) * t;
    const diff = Math.atan2(Math.sin(creature.rotY - g.rotation.y), Math.cos(creature.rotY - g.rotation.y));
    g.rotation.y += diff * Math.min(1, dt * 6);
    g.visible = localPosition.distanceTo(g.position) < VISIBLE_RANGE;
    if (!g.visible) return;

    const a = anim.current;
    const moved = Math.hypot(g.position.x - a.lastX, g.position.z - a.lastZ) / Math.max(dt, 1e-3);
    a.lastX = g.position.x;
    a.lastZ = g.position.z;
    a.speed += (Math.min(moved, 6) - a.speed) * Math.min(1, dt * 5);
    const flying = model.hover || def?.fly;
    a.phase += dt * (flying ? 18 : 4 + a.speed * 4);
    const swing = Math.sin(a.phase) * Math.min(1, a.speed / 1.5 + 0.08);
    const time = clock.elapsedTime;
    // Bị đánh trúng: giật nảy, bẹp người rồi phồng lại; thanh máu hiện lên một lúc.
    if (creature.hp < a.hp) {
      a.flash = 1;
      a.hitAt = time;
    }
    a.hp = creature.hp;
    a.flash = Math.max(0, a.flash - dt * 4);
    if (body.current) {
      // Lúc lao tới tấn công thì chồm người về trước.
      body.current.rotation.x = (creature.mode === "chase" || creature.mode === "attack" ? 0.12 : 0) - a.flash * 0.35;
      const squash = 1 + Math.sin(a.flash * Math.PI) * 0.3;
      body.current.scale.set(size * squash, (size / squash) * (creature.stunned ? 0.92 : 1), size * squash);
      body.current.position.x = (Math.random() - 0.5) * a.flash * 0.25;
    }
    if (bar.current && fill.current) {
      const showing = time - a.hitAt < 4 && creature.hp > 0;
      bar.current.visible = showing;
      if (showing) {
        bar.current.quaternion.copy(camera.quaternion);
        const k = Math.max(0, Math.min(1, creature.hp / (def?.hp ?? 1)));
        fill.current.scale.x = Math.max(0.001, k);
        fill.current.position.x = -(1 - k) * 0.5;
      }
    }
    if (stars.current) {
      stars.current.visible = creature.stunned;
      stars.current.rotation.y = time * 5;
    }

    model.parts.forEach((part, i) => {
      const p = parts.current[i];
      if (!p || !part.a) return;
      const base = part.r ?? [0, 0, 0];
      switch (part.a) {
        case "legA":
          p.rotation.x = base[0] + swing * 0.7;
          break;
        case "legB":
          p.rotation.x = base[0] - swing * 0.7;
          break;
        case "wingL":
          p.rotation.z = base[2] - Math.sin(a.phase) * 0.9;
          break;
        case "wingR":
          p.rotation.z = base[2] + Math.sin(a.phase) * 0.9;
          break;
        case "tail":
          p.rotation.y = base[1] + Math.sin(a.phase * 1.3) * 0.4;
          break;
        case "fin":
          p.rotation.x = base[0] + Math.sin(time * 3 + i) * 0.35;
          break;
        case "bell": {
          const k = 1 + Math.sin(time * 2.4) * 0.15;
          p.scale.set(k, 1 / k, k);
          break;
        }
        case "wave":
          p.position.x = part.p[0] + Math.sin(a.phase * 0.8 - (part.i ?? 0) * 0.7) * 0.07 * (part.i ?? 0) * 0.5;
          break;
        case "sway":
          p.rotation.z = base[2] + Math.sin(time * 1.6 + i) * 0.25;
          break;
      }
    });
  });

  if (!model || !def) return null;
  return (
    <group ref={root} position={[creature.x, creature.y, creature.z]} userData={{ detail: "fur" }}>
      <group ref={body} scale={size}>
        {model.parts.map((part, i) => (
          <group key={i} ref={(el) => void (parts.current[i] = el)} position={part.p} rotation={part.r ?? [0, 0, 0]}>
            <mesh geometry={geometries[part.g]} material={material(part.c, part.e)} scale={part.s} castShadow={size >= 1 && !part.e} />
          </group>
        ))}
      </group>
      <group ref={bar} position-y={size * 1.35 + 0.4} visible={false}>
        <mesh scale={[size * 0.9 + 0.3, 0.09, 1]} material={barMats.back}>
          <planeGeometry />
        </mesh>
        <group scale={[size * 0.9 + 0.3, 1, 1]}>
          <mesh ref={fill} position-z={0.01} scale={[1, 0.07, 1]} material={barMats.fill}>
            <planeGeometry />
          </mesh>
        </group>
      </group>
      <group ref={stars} position-y={size * 1.2 + 0.3} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI * 2) / 3) * 0.35 * size, 0, Math.sin((i * Math.PI * 2) / 3) * 0.35 * size]} material={barMats.star} scale={0.09 + size * 0.03}>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Các sinh vật server đang cho đi lại. */
export function Wildlife({ room }: { room: IslandRoom }) {
  const [list, setList] = useState<[string, CreatureState][]>([]);
  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const refresh = () => setList([...room.state.creatures.entries()]);
    const offAdd = callbacks.onAdd("creatures", refresh);
    const offRemove = callbacks.onRemove("creatures", refresh);
    refresh();
    return () => {
      offAdd();
      offRemove();
    };
  }, [room]);
  const views = useMemo(() => list.map(([id, c]) => <CreatureView key={id} creature={c} />), [list]);
  return <>{views}</>;
}
