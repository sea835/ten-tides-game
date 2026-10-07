import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, Object3D, type InstancedMesh } from "three";
import type { World } from "@tentides/content";
import { tide } from "./tide.ts";
import { myId, type IslandRoom } from "../net.ts";
import { localMotion, localPosition } from "./shared.ts";

// Dấu vết chuyển động: chạy trên cát, đất thì tung bụi sau gót; bơi thì mặt nước gợn vòng tròn loang ra.
// Tính cho cả mình lẫn người khác (từ vị trí server gửi), chỉ trong tầm nhìn gần.

const DUST = 90;
const RIPPLES = 36;
const NEAR = 45;

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  sand: boolean;
}

interface Ring {
  x: number;
  z: number;
  life: number;
  max: number;
  size: number;
}

export function Trails({ room, world }: { room: IslandRoom; world: World }) {
  const dust = useRef<InstancedMesh>(null);
  const ripples = useRef<InstancedMesh>(null);
  const puffs = useRef<Puff[]>([]);
  const rings = useRef<Ring[]>([]);
  const last = useRef(new Map<string, { x: number; z: number; puff: number; ring: number }>());
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  const sandColor = useMemo(() => new Color("#e3cf9e"), []);
  const dirtColor = useMemo(() => new Color("#9b8466"), []);
  // Số ô đã từng vẽ, để chỉ tẩy phần vừa rút khỏi danh sách thay vì vẽ lại cả mảng.
  const dustShown = useRef(0);
  const ringShown = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (dt <= 0) return;
    const me = myId(room);
    const movers: { id: string; x: number; y: number; z: number; swimming: boolean; running: boolean }[] = [];
    movers.push({ id: me, x: localPosition.x, y: localPosition.y, z: localPosition.z, swimming: localMotion.swimming, running: localMotion.running });
    for (const [id, p] of room.state.players) {
      if (id === me || !p.alive || Math.hypot(p.x - localPosition.x, p.z - localPosition.z) > NEAR) continue;
      movers.push({ id, x: p.x, y: p.y, z: p.z, swimming: p.swimming, running: false });
    }
    for (const m of movers) {
      const prev = last.current.get(m.id) ?? { x: m.x, z: m.z, puff: 0, ring: 0 };
      const speed = Math.hypot(m.x - prev.x, m.z - prev.z) / dt;
      prev.x = m.x;
      prev.z = m.z;
      prev.puff -= dt;
      prev.ring -= dt;
      const ground = world.heightAt(m.x, m.z);
      const onGround = !m.swimming && m.y - ground < 0.3 && ground > tide.level + 0.05;
      // Chạy (hoặc người khác đi nhanh) trên đất: mỗi bước một nhúm bụi sau gót.
      if (onGround && (m.running || speed > 7.5) && prev.puff <= 0) {
        prev.puff = 0.09;
        const sand = world.zoneAt(m.x, m.z) === "beach" && ground < 3;
        for (let k = 0; k < 2; k++) {
          puffs.current.push({
            x: m.x + (Math.random() - 0.5) * 0.4,
            y: ground + 0.1,
            z: m.z + (Math.random() - 0.5) * 0.4,
            vx: (Math.random() - 0.5) * 1.2,
            vz: (Math.random() - 0.5) * 1.2,
            life: 0,
            max: 0.6 + Math.random() * 0.4,
            size: 0.18 + Math.random() * 0.14,
            sand,
          });
        }
      }
      // Bơi (hoặc lội qua chỗ nông): vòng gợn loang ra trên mặt nước.
      const wading = !m.swimming && ground < tide.level - 0.1 && m.y < tide.level + 0.2 && speed > 1;
      if ((m.swimming || wading) && Math.abs(m.y - (tide.level - 1.3)) < 1.2 + (wading ? 1 : 0) && prev.ring <= 0) {
        prev.ring = speed > 1 ? 0.28 : 0.9;
        rings.current.push({ x: m.x, z: m.z, life: 0, max: 1.6, size: speed > 1 ? 1.4 : 0.9 });
      }
      last.current.set(m.id, prev);
    }
    if (puffs.current.length > DUST) puffs.current.splice(0, puffs.current.length - DUST);
    if (rings.current.length > RIPPLES) rings.current.splice(0, rings.current.length - RIPPLES);

    const d = dust.current;
    if (d) {
      const list = puffs.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        p.life += dt;
        if (p.life >= p.max) list.splice(i, 1);
        else {
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          p.y += 0.5 * dt;
        }
      }
      // Chỉ vẽ tới độ dài thật của danh sách, tẩy đuôi khi danh sách ngắn lại.
      // Trước đây 90 + 36 ô được ghi lại và tải lên GPU mỗi khung hình kể cả khi không có gì.
      for (let i = 0; i < list.length; i++) {
        const p = list[i]!;
        const k = p.life / p.max;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.size * (0.6 + k * 1.4) * (1 - k * k));
        d.setColorAt(i, p.sand ? sandColor : dirtColor);
        dummy.rotation.set(i, i * 0.7, 0);
        dummy.updateMatrix();
        d.setMatrixAt(i, dummy.matrix);
      }
      for (let i = list.length; i < dustShown.current; i++) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        d.setMatrixAt(i, dummy.matrix);
      }
      dustShown.current = list.length;
      d.instanceMatrix.needsUpdate = true;
      if (d.instanceColor) d.instanceColor.needsUpdate = true;
    }
    const r = ripples.current;
    if (r) {
      const list = rings.current;
      for (let i = list.length - 1; i >= 0; i--) {
        list[i]!.life += dt;
        if (list[i]!.life >= list[i]!.max) list.splice(i, 1);
      }
      for (let i = 0; i < list.length; i++) {
        const ring = list[i]!;
        const k = ring.life / ring.max;
        dummy.position.set(ring.x, tide.level + 0.06, ring.z);
        dummy.scale.setScalar(ring.size * (0.4 + k * 2.2));
        // Vẽ cộng sáng: màu tối dần về đen là mờ dần.
        color.setScalar(0.45 * (1 - k));
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        r.setMatrixAt(i, dummy.matrix);
        r.setColorAt(i, color);
      }
      for (let i = list.length; i < ringShown.current; i++) {
        dummy.scale.setScalar(0);
        color.setScalar(0);
        dummy.updateMatrix();
        r.setMatrixAt(i, dummy.matrix);
        r.setColorAt(i, color);
      }
      ringShown.current = list.length;
      r.instanceMatrix.needsUpdate = true;
      if (r.instanceColor) r.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={dust} args={[undefined, undefined, DUST]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial flatShading roughness={1} transparent opacity={0.7} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ripples} args={[undefined, undefined, RIPPLES]} frustumCulled={false}>
        <ringGeometry args={[0.8, 1, 28]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </>
  );
}
