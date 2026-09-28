import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Color, Object3D, type InstancedMesh } from "three";
import type { FxMessage } from "@tentides/protocol";
import { useFx } from "./fxStore.ts";
import { localPosition, shake } from "./shared.ts";

// Hiệu ứng khi đánh nhau, chặt cây, săn thú: chữ tượng thanh bay lên (BỐP!, PHẬP!, RẮC!), số Máu mất,
// mảnh vụn văng tứ tung (vụn gỗ, khói, bọt nước, tia lửa) và rung màn hình khi chuyện xảy ra ngay cạnh mình.

interface Word {
  key: number;
  x: number;
  y: number;
  z: number;
  text: string;
  amount?: number;
  tone: string;
}

const TONE: Record<FxMessage["kind"], string> = {
  hit: "hit",
  miss: "miss",
  chop: "chop",
  fell: "chop",
  poof: "poof",
  kill: "kill",
  eat: "eat",
  plant: "eat",
  build: "build",
  splash: "splash",
  shoot: "hit",
};

/** Màu vụn văng ra và số lượng theo loại hiệu ứng. */
const BURST: Partial<Record<FxMessage["kind"], { color: string; count: number; speed: number; size: number; up: number }>> = {
  hit: { color: "#ffd84d", count: 10, speed: 4, size: 0.08, up: 3 },
  kill: { color: "#b3121c", count: 22, speed: 5, size: 0.1, up: 4 },
  chop: { color: "#b98a55", count: 9, speed: 3.5, size: 0.09, up: 3 },
  fell: { color: "#6b9a3c", count: 30, speed: 5, size: 0.14, up: 5 },
  poof: { color: "#f2f2f2", count: 18, speed: 2.5, size: 0.22, up: 2 },
  splash: { color: "#bfe9ff", count: 16, speed: 3, size: 0.1, up: 5 },
  build: { color: "#c9b27a", count: 16, speed: 3, size: 0.12, up: 2.5 },
  eat: { color: "#ffe0a0", count: 6, speed: 1.5, size: 0.05, up: 1.5 },
  plant: { color: "#6b4a2a", count: 8, speed: 1.5, size: 0.08, up: 2 },
  shoot: { color: "#cfcfcf", count: 12, speed: 2, size: 0.18, up: 1 },
};

const MAX_BITS = 260;
const GRAVITY = 12;

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: Color;
  float: boolean;
}

export function Fx() {
  const [words, setWords] = useState<Word[]>([]);
  const mesh = useRef<InstancedMesh>(null);
  const bits = useRef<Bit[]>([]);
  const dummy = useMemo(() => new Object3D(), []);

  useFx((fx) => {
    const d = Math.hypot(fx.x - localPosition.x, fx.z - localPosition.z);
    // Chữ tượng thanh: chỉ hiện khi đủ gần để nghe thấy.
    if (fx.word && d < 45) {
      const key = performance.now() + Math.random();
      setWords((list) => [...list.slice(-14), { key, x: fx.x, y: fx.y, z: fx.z, text: fx.word!, amount: fx.amount, tone: TONE[fx.kind] }]);
      setTimeout(() => setWords((list) => list.filter((w) => w.key !== key)), 1300);
    }
    const burst = BURST[fx.kind];
    if (burst && d < 60) {
      for (let i = 0; i < burst.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = burst.speed * (0.4 + Math.random() * 0.6);
        const float = fx.kind === "poof" || fx.kind === "shoot";
        bits.current.push({
          x: fx.x,
          y: fx.y - (fx.kind === "fell" ? -2 : 0.3),
          z: fx.z,
          vx: Math.cos(a) * s,
          vy: burst.up * (0.5 + Math.random() * 0.7),
          vz: Math.sin(a) * s,
          life: 0,
          max: float ? 1.2 : 0.9 + Math.random() * 0.4,
          size: burst.size * (0.6 + Math.random() * 0.8),
          color: new Color(burst.color),
          float,
        });
      }
      if (bits.current.length > MAX_BITS) bits.current.splice(0, bits.current.length - MAX_BITS);
    }
    // Rung màn hình khi chuyện xảy ra ngay cạnh mình.
    const strength = fx.kind === "kill" ? 0.5 : fx.kind === "fell" ? 0.45 : fx.kind === "hit" ? 0.25 : fx.kind === "shoot" ? 0.2 : 0;
    if (strength > 0 && d < 12) shake.amount = Math.min(0.8, shake.amount + strength * (1 - d / 12));
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const m = mesh.current;
    if (!m) return;
    const list = bits.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      b.life += dt;
      if (b.life >= b.max) {
        list.splice(i, 1);
        continue;
      }
      if (b.float) {
        b.vx *= 0.92;
        b.vz *= 0.92;
        b.vy = 0.8;
      } else b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
    for (let i = 0; i < MAX_BITS; i++) {
      const b = list[i];
      if (!b) {
        dummy.scale.setScalar(0);
      } else {
        const k = 1 - b.life / b.max;
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(b.life * 9, b.life * 7, 0);
        dummy.scale.setScalar(b.size * (b.float ? 1 + (1 - k) * 1.5 : k));
        m.setColorAt(i, b.color);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_BITS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial flatShading roughness={0.8} />
      </instancedMesh>
      {words.map((w) => (
        <Html key={w.key} position={[w.x, w.y, w.z]} center zIndexRange={[6, 0]} className={`fx-word ${w.tone}`}>
          <span>{w.text}</span>
          {w.amount ? <small>-{w.amount}</small> : null}
        </Html>
      ))}
    </>
  );
}
