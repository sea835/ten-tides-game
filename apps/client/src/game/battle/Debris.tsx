import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, MeshStandardMaterial, Object3D, type InstancedMesh } from "three";
import type { World } from "@tentides/content";
import { useQuality } from "../graphics.ts";
import { windStrength } from "../nature.ts";
import { puffs } from "./Effects.tsx";

// Đất đá văng tung toé khi nổ (lựu đạn, mìn, RPG, đạn pháo): những cục đất sẫm màu bay vọt lên, xoay lộn, kéo theo
// vệt bụi, rơi xuống đất nảy vài cái rồi lún dần vào đất. Một instanced mesh, số cục có hạn theo mức đồ hoạ.

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  /** Lần thả bụi kế tiếp (giây tuổi). */
  dust: number;
  shade: number;
}

const MAX_CHUNKS = 220;
const chunks: Chunk[] = [];
/** Cục đất chờ tạo (vụ nổ đẩy vào, Debris rút ra theo giới hạn số lượng của mức đồ hoạ). */
const pending: { x: number; y: number; z: number; big: boolean }[] = [];

/** Vụ nổ ở (x, y, z): đất đá văng lên. Gọi từ chỗ nhận tin nổ. */
export function spawnDebris(x: number, y: number, z: number, big: boolean) {
  if (pending.length < 8) pending.push({ x, y, z, big });
}

/** Số cục đất mỗi vụ nổ theo mức đồ hoạ. */
const PER_BLAST = { high: 22, medium: 15, low: 8 } as const;

export function Debris({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const quality = useQuality();
  const dummy = useMemo(() => new Object3D(), []);
  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), []);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#4a3a2a", roughness: 1, flatShading: true });
    // Cục đất cố ý để cạnh sắc (không làm mịn, không phủ vân).
    m.userData.detail = "none";
    m.userData.faceted = true;
    return m;
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const m = mesh.current;
    if (!m) return;
    while (pending.length) {
      const b = pending.pop()!;
      const n = Math.round(PER_BLAST[quality] * (b.big ? 1.4 : 1));
      for (let k = 0; k < n && chunks.length < MAX_CHUNKS; k++) {
        const a = Math.random() * Math.PI * 2;
        const out = (3 + Math.random() * 7) * (b.big ? 1.3 : 1);
        chunks.push({
          x: b.x + Math.cos(a) * 0.5,
          y: b.y + 0.3,
          z: b.z + Math.sin(a) * 0.5,
          vx: Math.cos(a) * out,
          vy: (6 + Math.random() * 9) * (b.big ? 1.25 : 1),
          vz: Math.sin(a) * out,
          rx: Math.random() * 6,
          ry: Math.random() * 6,
          rz: Math.random() * 6,
          spin: 4 + Math.random() * 10,
          size: (0.07 + Math.random() * Math.random() * 0.22) * (b.big ? 1.2 : 1),
          age: 0,
          life: 3 + Math.random() * 1.5,
          dust: 0.04,
          shade: Math.random(),
        });
      }
    }
    const wind = 0.6 * windStrength.value;
    let n = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]!;
      c.age += dt;
      if (c.age >= c.life) {
        chunks[i] = chunks[chunks.length - 1]!;
        chunks.pop();
        continue;
      }
      c.vy -= 9.8 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      const ground = world.heightAt(c.x, c.z);
      const airborne = c.y > ground + c.size * 0.5;
      if (!airborne) {
        // Chạm đất: nảy thấp dần, trượt chậm lại, thôi xoay.
        c.y = ground + c.size * 0.5;
        if (c.vy < -1.5) {
          c.vy = -c.vy * 0.28;
          c.vx *= 0.55;
          c.vz *= 0.55;
          c.spin *= 0.5;
        } else {
          c.vy = 0;
          c.vx *= Math.exp(-dt * 6);
          c.vz *= Math.exp(-dt * 6);
          c.spin *= Math.exp(-dt * 5);
        }
      } else if (c.age > c.dust && c.age < 0.9 && puffs.length < 860) {
        // Vệt bụi kéo theo cục đất đang bay.
        c.dust = c.age + 0.07 + Math.random() * 0.05;
        puffs.push({ x: c.x, y: c.y, z: c.z, vx: wind * 0.3, vy: 0.2, vz: 0, size: 0.25 + c.size * 1.5, grow: 0.9, life: 0.9 + Math.random() * 0.5, age: 0, r: 0.42, g: 0.36, b: 0.28, alpha: 0.35, dense: false });
      }
      c.rx += c.spin * dt;
      c.rz += c.spin * 0.7 * dt;
      // Cuối đời lún dần xuống đất.
      const sink = Math.max(0, c.age - (c.life - 0.8)) / 0.8;
      dummy.position.set(c.x, c.y - sink * c.size, c.z);
      dummy.rotation.set(c.rx, c.ry, c.rz);
      dummy.scale.set(c.size * (1.1 + c.shade * 0.4), c.size * (0.7 + c.shade * 0.3), c.size);
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.visible = n > 0;
    if (n > 0) m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_CHUNKS]} frustumCulled={false} visible={false} />;
}
