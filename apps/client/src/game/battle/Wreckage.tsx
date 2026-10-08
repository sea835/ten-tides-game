import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from "three";
import { mapOf, type BattleBox, type World } from "@tentides/content";
import { Messages, type CollapseMessage } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { useProfile } from "../graphics.ts";
import { refreshSoon } from "../staticShadow.ts";
import { localPosition, shake } from "../shared.ts";
import { playCrumble } from "../sound/guns.ts";
import { effects } from "./runtime.ts";
import { physicsProbe } from "./surface.ts";

// Công trình đổ nát trên client: đọc `broken` trong state (server quyết định khối nào hư, vỡ, nhà nào sập), ẩn khối
// đã vỡ và gỡ va chạm của nó (đạn, người đi xuyên qua chỗ đó), tường hư thì sạm tối dần. Lúc vỡ: gạch đá, ván gỗ văng
// ra rơi lộp độp, bụi tung mù mịt; nhà sập thì bụi cuộn cả khu, màn hình rung, tiếng đổ rền.

/**
 * Cầu nối với Structures: từng khối (theo số thứ tự trong bản đồ) nằm ở instance nào của lưới nào, màu gốc, và hàm
 * gỡ / dựng lại va chạm. Structures ghi vào đây khi dựng, Wreckage đọc để ẩn hiện.
 */
export const wreck = {
  instances: [] as ({ mesh: InstancedMesh; local: number; color: Color } | undefined)[],
  /** Collider (Rapier handle) → số thứ tự khối: Shooter dùng để biết đạn găm vào khối nào (xuyên vách mỏng). */
  colliderBox: new Map<number, number>(),
  removeCollider: null as null | ((i: number) => void),
  restoreCollider: null as null | ((i: number) => void),
};

const MAX_CHUNKS = 700;
const MAX_DUST = 160;

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
  s: number;
  floor: number;
  rest: number;
  life: number;
}

interface Dust {
  x: number;
  y: number;
  z: number;
  born: number;
  life: number;
  size: number;
  rise: number;
}

/** Màu mảnh vỡ theo chất liệu (gạch đỏ, vữa trắng xám, gỗ nâu...). */
const CHUNK_COLOR: Partial<Record<BattleBox["mat"], string>> = {
  brick: "#9a4a36",
  plaster: "#cfc6b6",
  concrete: "#9c978e",
  stone: "#8d877c",
  wood: "#7a5a38",
  sandbag: "#a8966b",
  sign: "#b8261f",
  fence: "#8a8a8a",
  roof: "#8c4a3a",
};

const dummy = new Object3D();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const ZERO = new Matrix4().makeScale(0, 0, 0);

function dustTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, "rgba(255,255,255,0.9)");
  r.addColorStop(0.5, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Ma trận gốc của khối (dựng lại khi khối "lành" trở lại, vd. sang trận mới). */
function boxMatrix(b: BattleBox, out: Matrix4) {
  dummy.rotation.set(b.pitch, b.rot, 0, "YXZ");
  _q.setFromEuler(dummy.rotation);
  return out.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.w, b.h, b.d));
}

export function Wreckage({ room, world }: { room: IslandRoom; world: World }) {
  const map = mapOf(world);
  const profile = useProfile();
  const low = profile.post === "none" || profile.grass === 0;
  const chunkMesh = useRef<InstancedMesh>(null);
  const dustMesh = useRef<InstancedMesh>(null);
  const levels = useRef(new Uint8Array(map.boxes.length));
  const seen = useRef(new Uint8Array(map.boxes.length));
  const chunks = useRef<Chunk[]>([]);
  const dust = useRef<Dust[]>([]);
  const chunkRing = useRef(0);
  const colors = useRef(new Float32Array(MAX_CHUNKS * 3));
  const res = useMemo(() => {
    const chunkGeo = new BoxGeometry(1, 1, 1);
    const chunkMat = new MeshStandardMaterial({ roughness: 0.95 });
    chunkMat.userData.detail = "none";
    const dustGeo = new PlaneGeometry(1, 1);
    const dustMat = new MeshBasicMaterial({ color: "#b9ae9b", map: dustTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
    dustMat.userData.detail = "none";
    return { chunkGeo, chunkMat, dustGeo, dustMat };
  }, []);
  useEffect(
    () => () => {
      res.chunkGeo.dispose();
      res.chunkMat.dispose();
      res.dustGeo.dispose();
      res.dustMat.map?.dispose();
      res.dustMat.dispose();
    },
    [res],
  );
  // Màu từng mảnh vỡ: gắn thuộc tính màu trước lần vẽ đầu (thêm sau thì phải dịch lại shader).
  useLayoutEffect(() => {
    const m = chunkMesh.current;
    if (m && !m.instanceColor) m.instanceColor = new InstancedBufferAttribute(colors.current, 3);
  }, []);
  // Bản đồ của client dùng chung cache: mặt nạ khối vỡ để bề mặt trúng đạn, dò sàn... bỏ qua khối đã vỡ.
  useEffect(() => {
    const idx = map.index;
    if (!idx.dead || idx.dead.length !== idx.boxes.length) idx.dead = new Uint8Array(idx.boxes.length);
    else idx.dead.fill(0);
    levels.current = new Uint8Array(map.boxes.length);
    seen.current = new Uint8Array(map.boxes.length);
    return () => {
      idx.dead?.fill(0);
    };
  }, [map]);

  const addDust = (x: number, y: number, z: number, size: number, life: number, rise: number) => {
    if (dust.current.length >= MAX_DUST) dust.current.shift();
    dust.current.push({ x, y, z, size, life, rise, born: performance.now() / 1000 });
  };

  /** Khối vỡ: gạch đá văng ra quanh khối, bụi bốc lên. `collapse`: đổ sụp (mảnh rơi thẳng xuống, ít văng). */
  const burst = (b: BattleBox, collapse: boolean) => {
    const vol = b.w * b.h * b.d;
    const n = Math.round(Math.min(collapse ? 10 : 22, Math.max(4, vol * 16)) * (low ? 0.5 : 1));
    const color = new Color(CHUNK_COLOR[b.mat] ?? "#9c978e");
    const cr = Math.cos(b.rot);
    const sr = Math.sin(b.rot);
    for (let k = 0; k < n; k++) {
      // Điểm ngẫu nhiên trong khối (theo trục riêng của khối).
      const u = (Math.random() - 0.5) * b.w;
      const v = (Math.random() - 0.5) * b.d;
      const x = b.x + u * cr + v * sr;
      const z = b.z - u * sr + v * cr;
      const y = b.y + (Math.random() - 0.5) * b.h;
      const out = collapse ? 1 : 3.5;
      const a = Math.random() * Math.PI * 2;
      const ground = world.heightAt(x, z);
      const slot = chunkRing.current++ % MAX_CHUNKS;
      const c: Chunk = {
        x,
        y,
        z,
        vx: Math.cos(a) * out * Math.random(),
        vy: collapse ? -Math.random() * 2 : 1 + Math.random() * 3.5,
        vz: Math.sin(a) * out * Math.random(),
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        spin: 3 + Math.random() * 8,
        s: (b.mat === "wood" ? 0.08 : 0.1) + Math.random() * (collapse ? 0.35 : 0.22),
        floor: ground,
        rest: 0,
        life: collapse ? 40 : 25,
      };
      // Sàn ngay dưới (tầng dưới còn đứng thì mảnh nằm trên sàn tầng dưới).
      const hit = physicsProbe.cast?.(x, y, z, 0, -1, 0, Math.max(0.2, y - ground + 0.3));
      if (hit) c.floor = Math.max(ground, y - hit.t);
      chunks.current[slot] = c;
      colors.current.set([color.r * (0.8 + Math.random() * 0.3), color.g * (0.8 + Math.random() * 0.3), color.b * (0.8 + Math.random() * 0.3)], slot * 3);
    }
    const mesh = chunkMesh.current;
    if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (!collapse) for (let k = 0; k < (low ? 1 : 3); k++) addDust(b.x + (Math.random() - 0.5) * b.w, b.y + (Math.random() - 0.3) * b.h, b.z + (Math.random() - 0.5) * b.d, 1.2 + vol * 0.4, 2.2, 0.35);
  };

  // Nhà sập: bụi cuộn khắp chân nhà, rung màn hình, tiếng đổ rền.
  useEffect(
    () =>
      room.onMessage(Messages.collapse, (m: CollapseMessage) => {
        const puffs = low ? 10 : 24;
        for (let k = 0; k < puffs; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * m.r * 1.1;
          addDust(m.x + Math.cos(a) * r, m.y + Math.random() * Math.min(6, m.h * 0.5), m.z + Math.sin(a) * r, 3 + Math.random() * 4, 5 + Math.random() * 3, 0.6);
        }
        const d = Math.hypot(m.x - localPosition.x, m.z - localPosition.z);
        if (d < 70) shake.amount = Math.min(1.6, shake.amount + (1 - d / 70) * 1.3);
        playCrumble({ x: m.x, y: m.y + 2, z: m.z }, "concrete", 1);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room],
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now() / 1000;
    const boxes = map.boxes;
    const dead = map.index.dead;

    // --- đồng bộ mức hư theo state (ít khối hư nên duyệt mỗi khung hình vẫn rẻ)
    const lv = levels.current;
    const mark = seen.current;
    mark.fill(0);
    let crumbles = 0;
    const apply = (i: number, next: number) => {
      const prev = lv[i]!;
      if (prev === next) return;
      lv[i] = next;
      const inst = wreck.instances[i];
      const b = boxes[i]!;
      if (next === 255) {
        if (inst) {
          inst.mesh.setMatrixAt(inst.local, ZERO);
          inst.mesh.instanceMatrix.needsUpdate = true;
          // Khối sập: bóng tĩnh vẽ lại ngay (khỏi còn bóng của bức tường đã mất).
          refreshSoon();
        }
        wreck.removeCollider?.(i);
        if (dead) dead[i] = 1;
        effects.clearIn.push(b);
        // Nhà sập (nhiều khối cùng lúc) thì mảnh rơi thẳng xuống; tường lẻ thì văng ra.
        const collapse = b.part === "floor" || b.part === "roof";
        if (Math.hypot(b.x - camera.position.x, b.z - camera.position.z) < 150) {
          burst(b, collapse);
          if (!collapse && crumbles++ < 2) playCrumble({ x: b.x, y: b.y, z: b.z }, b.mat === "wood" ? "wood" : b.mat === "sandbag" ? "dirt" : "concrete", 0);
        }
        return;
      }
      if (prev === 255) {
        // Khối lành lại (trận mới): dựng lại hình và va chạm.
        if (inst) {
          inst.mesh.setMatrixAt(inst.local, boxMatrix(b, _m));
          inst.mesh.instanceMatrix.needsUpdate = true;
          refreshSoon();
        }
        wreck.restoreCollider?.(i);
        if (dead) dead[i] = 0;
      }
      if (inst) {
        // Tường hư sạm tối dần (bụi, vết nứt, cháy xém).
        const c = inst.color.clone().multiplyScalar(1 - 0.55 * (next / 254));
        inst.mesh.setColorAt(inst.local, c);
        if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
      }
    };
    room.state.broken.forEach((v, k) => {
      const i = Number(k);
      if (!(i >= 0 && i < lv.length)) return;
      mark[i] = 1;
      apply(i, v);
    });
    for (let i = 0; i < lv.length; i++) if (lv[i] && !mark[i]) apply(i, 0);

    // --- mảnh vỡ
    const cm = chunkMesh.current;
    if (cm) {
      let n = 0;
      const list = chunks.current;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c) continue;
        if (c.rest > 0) {
          c.rest += dt;
          if (c.rest > c.life) {
            list[i] = undefined as unknown as Chunk;
            cm.setMatrixAt(i, ZERO);
            continue;
          }
        } else {
          c.vy -= 9.8 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.z += c.vz * dt;
          c.rx += c.spin * dt;
          c.ry += c.spin * 0.7 * dt;
          if (c.y < c.floor + c.s * 0.5) {
            c.y = c.floor + c.s * 0.5;
            c.vy = Math.abs(c.vy) * 0.25;
            c.vx *= 0.45;
            c.vz *= 0.45;
            c.spin *= 0.4;
            if (c.vy < 0.5) c.rest = 0.001;
          }
        }
        // Nằm lâu thì lún dần vào đống đổ nát rồi biến mất.
        const sink = c.rest > c.life - 3 ? (c.rest - (c.life - 3)) / 3 : 0;
        dummy.position.set(c.x, c.y - sink * c.s, c.z);
        dummy.rotation.set(c.rx, c.ry, 0);
        dummy.scale.set(c.s, c.s * 0.6, c.s * 0.8);
        dummy.updateMatrix();
        cm.setMatrixAt(i, dummy.matrix);
        n = Math.max(n, i + 1);
      }
      cm.count = n;
      cm.instanceMatrix.needsUpdate = true;
    }

    // --- bụi: nở to, bốc lên chậm, mờ dần; luôn quay mặt về camera
    const dm = dustMesh.current;
    if (dm) {
      const list = dust.current;
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        const age = (now - p.born) / p.life;
        if (age >= 1) {
          list.splice(i, 1);
          continue;
        }
      }
      for (const p of list) {
        const age = (now - p.born) / p.life;
        const grow = p.size * (0.5 + Math.sqrt(age) * 1.3);
        dummy.position.set(p.x, p.y + p.rise * age * p.life, p.z);
        dummy.quaternion.copy(camera.quaternion);
        // Mờ dần theo tuổi: co về 0 ở cuối cho khỏi phải chỉnh độ trong từng hạt.
        const fade = age < 0.15 ? age / 0.15 : 1 - Math.pow((age - 0.15) / 0.85, 1.5);
        dummy.scale.setScalar(grow * (0.35 + 0.65 * fade));
        dummy.updateMatrix();
        dm.setMatrixAt(n++, dummy.matrix);
      }
      dm.count = n;
      dm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={chunkMesh} args={[res.chunkGeo, res.chunkMat, MAX_CHUNKS]} frustumCulled={false} castShadow receiveShadow />
      <instancedMesh ref={dustMesh} args={[res.dustGeo, res.dustMat, MAX_DUST]} frustumCulled={false} renderOrder={5} />
    </>
  );
}
