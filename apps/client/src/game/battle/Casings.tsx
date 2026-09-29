import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CylinderGeometry, MeshStandardMaterial, Object3D, type InstancedMesh } from "three";
import type { World } from "@tentides/content";
import { playShellDrop } from "../sound/guns.ts";
import { effects, type Casing } from "./runtime.ts";
import { physicsProbe } from "./surface.ts";

// Vỏ đạn: văng ra cửa thoát bên phải súng, xoay lộn, rơi xuống sàn (dò tia vật lý tìm sàn nhà, bậc thang, mặt đất),
// nảy vài cái kêu leng keng, rồi nằm lại một lúc mới biến mất. Vỏ đồng thau bóng, dài ngắn theo cỡ đạn.

const MAX_CASINGS = 160;
/** Vỏ nằm trên sàn chừng này giây rồi mới dọn. */
const LINGER = 12;

interface Live extends Casing {
  floor: number;
  hard: boolean;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  bounces: number;
  rest: number;
  started: boolean;
}

const dummy = new Object3D();

export function Casings({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const live = useRef<Live[]>([]);
  const res = useMemo(() => {
    // Vỏ súng trường: dài 4,5 cm, cổ thắt; dựng bằng một ống thuôn (đầu +y hẹp hơn).
    const geo = new CylinderGeometry(0.0038, 0.0048, 0.045, 8, 1);
    const mat = new MeshStandardMaterial({ color: "#c8a04a", metalness: 0.9, roughness: 0.28 });
    mat.userData.detail = "none";
    return { geo, mat };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  useFrame(({ camera }, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now() / 1000;
    for (const c of effects.casings.splice(0)) {
      // Xa quá thì không cần vẽ vỏ đạn.
      if (Math.hypot(c.x - camera.position.x, c.z - camera.position.z) > 40) continue;
      if (live.current.length >= MAX_CASINGS) live.current.shift();
      live.current.push({ ...c, floor: 0, hard: true, rx: Math.random() * 6, ry: Math.random() * 6, rz: 0, spin: 18 + Math.random() * 20, bounces: 0, rest: 0, started: false });
    }
    let n = 0;
    const list = live.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      if (now < c.at) continue;
      if (!c.started) {
        c.started = true;
        // Tìm sàn ngay dưới chỗ vỏ văng ra (sàn nhà tầng trên, bậc cầu thang...), không có thì mặt đất.
        const ground = world.heightAt(c.x, c.z);
        const hit = physicsProbe.cast?.(c.x, c.y, c.z, 0, -1, 0, Math.max(0.1, c.y - ground + 0.5));
        c.floor = hit ? c.y - hit.t : ground;
        c.hard = !!hit && c.y - hit.t > ground + 0.05;
      }
      if (c.rest > 0) {
        c.rest += dt;
        if (c.rest > LINGER) {
          list.splice(i, 1);
          continue;
        }
      } else {
        c.vy -= 9.8 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.spin * dt;
        c.rz += c.spin * 0.6 * dt;
        c.vx *= Math.exp(-dt * 0.4);
        c.vz *= Math.exp(-dt * 0.4);
        const r = 0.005 * c.size;
        if (c.y < c.floor + r) {
          c.y = c.floor + r;
          if (c.bounces === 0 && Math.hypot(c.x - camera.position.x, c.z - camera.position.z) < 14)
            playShellDrop(c, c.kind, c.hard || world.surface(c.x, c.z).ground ? "hard" : "soft");
          c.bounces++;
          c.vy = Math.abs(c.vy) * (c.hard ? 0.35 : 0.15);
          c.vx *= 0.5;
          c.vz *= 0.5;
          c.spin *= 0.5;
          // Nằm xuống (trục vỏ nằm ngang), lăn một chút rồi thôi.
          if (c.vy < 0.4 || c.bounces > 3) {
            c.rest = 0.001;
            c.rx = Math.PI / 2;
            c.rz = 0;
          }
        }
      }
      if (n >= MAX_CASINGS) continue;
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(c.rx, c.ry, c.rz);
      dummy.scale.set(c.size, c.size * (c.size > 1.1 ? 1.25 : c.size < 0.9 ? 0.55 : 1), c.size);
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[res.geo, res.mat, MAX_CASINGS]} frustumCulled={false} castShadow={false} />;
}
