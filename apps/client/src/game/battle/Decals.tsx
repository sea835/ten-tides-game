import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
} from "three";
import type { World } from "@tentides/content";
import { playImpact } from "../sound/guns.ts";
import { puffs } from "./Effects.tsx";
import { effects, type Impact } from "./runtime.ts";
import { surfaceAt, type HitSurface } from "./surface.ts";

// Chỗ đạn găm: lỗ đạn để lại trên tường, sàn, đất (dán theo pháp tuyến mặt, xoay ngẫu nhiên, mỗi chất liệu một kiểu:
// bê tông vỡ mẻ, nứt chân chim; kim loại thủng, viền sáng trầy sơn; gỗ toác dằm; đất lõm hố), vết máu bắn lên tường phía
// sau người trúng đạn; kèm bụi đúng màu chất liệu, mảnh vụn văng ra rơi xuống, tia lửa khi găm vào kim loại, nước bắn
// tung khi trúng mặt nước, và tiếng găm theo chất liệu.

type DecalKind = "concrete" | "metal" | "wood" | "dirt" | "blood";
const KINDS: DecalKind[] = ["concrete", "metal", "wood", "dirt", "blood"];
/** Mỗi loại giữ tối đa chừng này lỗ, lỗ cũ nhất bị thay (vòng tròn). */
const MAX_DECALS = 300;
const MAX_BITS = 500;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Đa giác méo quanh tâm (mép vỡ không tròn trịa). */
function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, jag: number, n = 18) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - jag + Math.random() * jag * 2);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function radial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, string][]) {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, c] of stops) grad.addColorStop(at, c);
  g.fillStyle = grad;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
}

const TEXTURES: Record<DecalKind, () => CanvasTexture> = {
  // Bê tông: quầng bụi xám mờ, mảng vỡ mẻ sáng hơn (lõi bê tông lộ ra), vài vết nứt, lỗ đen sâu ở giữa.
  concrete: () =>
    canvas(128, (g, s) => {
      const c = s / 2;
      radial(g, c, c, c, [
        [0, "rgba(60,58,55,0.55)"],
        [0.55, "rgba(90,88,84,0.25)"],
        [1, "rgba(90,88,84,0)"],
      ]);
      g.strokeStyle = "rgba(30,28,26,0.75)";
      g.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) {
        let a = Math.random() * Math.PI * 2;
        let x = c;
        let y = c;
        g.beginPath();
        g.moveTo(x, y);
        const len = rand(20, 52);
        for (let t = 0; t < len; t += 6) {
          a += rand(-0.5, 0.5);
          x += Math.cos(a) * 6;
          y += Math.sin(a) * 6;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      blob(g, c, c, 24, 0.35);
      g.fillStyle = "rgba(196,190,178,0.95)";
      g.fill();
      blob(g, c, c, 15, 0.3);
      g.fillStyle = "rgba(120,114,106,1)";
      g.fill();
      radial(g, c, c, 11, [
        [0, "rgba(8,7,6,1)"],
        [0.7, "rgba(20,18,16,1)"],
        [1, "rgba(20,18,16,0)"],
      ]);
    }),
  // Kim loại: lỗ thủng nhỏ tròn, mép lật sáng (kim loại trần), sơn tróc quanh, vệt cháy xém.
  metal: () =>
    canvas(128, (g, s) => {
      const c = s / 2;
      radial(g, c, c, c * 0.8, [
        [0, "rgba(25,22,20,0.6)"],
        [0.6, "rgba(40,36,32,0.2)"],
        [1, "rgba(40,36,32,0)"],
      ]);
      blob(g, c, c, 22, 0.25, 12);
      g.fillStyle = "rgba(170,172,176,0.9)";
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "rgba(235,238,242,0.95)";
      g.beginPath();
      g.arc(c, c, 13, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "rgba(5,5,6,1)";
      g.beginPath();
      g.arc(c, c, 10, 0, Math.PI * 2);
      g.fill();
    }),
  // Gỗ: lỗ tối, dằm gỗ sáng toác theo thớ (dọc), quầng sẫm.
  wood: () =>
    canvas(128, (g, s) => {
      const c = s / 2;
      radial(g, c, c, c * 0.7, [
        [0, "rgba(40,24,12,0.5)"],
        [1, "rgba(40,24,12,0)"],
      ]);
      g.strokeStyle = "rgba(214,178,128,0.95)";
      for (let k = 0; k < 16; k++) {
        g.lineWidth = rand(1.5, 4);
        const x = c + rand(-12, 12);
        const up = Math.random() < 0.5 ? -1 : 1;
        g.beginPath();
        g.moveTo(x, c);
        g.lineTo(x + rand(-5, 5), c + up * rand(14, 42));
        g.stroke();
      }
      blob(g, c, c, 11, 0.3, 10);
      g.fillStyle = "rgba(18,10,5,1)";
      g.fill();
    }),
  // Đất: hố lõm sẫm, mép đất tơi, vài hạt văng.
  dirt: () =>
    canvas(128, (g, s) => {
      const c = s / 2;
      radial(g, c, c, c, [
        [0, "rgba(28,20,12,0.95)"],
        [0.35, "rgba(52,40,26,0.8)"],
        [0.7, "rgba(70,56,38,0.35)"],
        [1, "rgba(70,56,38,0)"],
      ]);
      g.fillStyle = "rgba(40,30,20,0.8)";
      for (let k = 0; k < 30; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(26, 58);
        g.beginPath();
        g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rand(1, 3.2), 0, Math.PI * 2);
        g.fill();
      }
    }),
  // Máu bắn lên tường: mảng chính, giọt văng xa, vệt chảy.
  blood: () =>
    canvas(256, (g, s) => {
      const c = s / 2;
      g.fillStyle = "rgba(92,6,6,0.92)";
      blob(g, c, c, 38, 0.45, 22);
      g.fill();
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(30, 120);
        g.beginPath();
        g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rand(1.5, 9) * (1 - r / 160), 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(70,4,4,0.85)";
      for (let k = 0; k < 4; k++) g.fillRect(c + rand(-25, 25), c, rand(3, 6), rand(30, 90));
    }),
};

const DECAL_SIZE: Record<DecalKind, [number, number]> = {
  concrete: [0.1, 0.16],
  metal: [0.06, 0.09],
  wood: [0.1, 0.14],
  dirt: [0.16, 0.24],
  blood: [0.5, 0.9],
};

/** Màu bụi, lượng bụi, mảnh vụn và tia lửa theo chất liệu. */
const FX: Record<HitSurface, { dust: [number, number, number]; puffs: number; bits: number; bitColor: string; sparks: number }> = {
  concrete: { dust: [0.66, 0.64, 0.6], puffs: 4, bits: 5, bitColor: "#8e8a82", sparks: 1 },
  metal: { dust: [0.5, 0.5, 0.52], puffs: 2, bits: 0, bitColor: "#777", sparks: 9 },
  wood: { dust: [0.55, 0.42, 0.28], puffs: 3, bits: 6, bitColor: "#b08a5a", sparks: 0 },
  dirt: { dust: [0.5, 0.41, 0.3], puffs: 6, bits: 7, bitColor: "#4a3a28", sparks: 0 },
  water: { dust: [0.85, 0.9, 0.95], puffs: 7, bits: 0, bitColor: "#fff", sparks: 0 },
  flesh: { dust: [0.45, 0.03, 0.03], puffs: 5, bits: 0, bitColor: "#600", sparks: 0 },
};

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  spark: boolean;
  color: Color;
}

const Z = new Vector3(0, 0, 1);
const _n = new Vector3();
const _q = new Quaternion();
const _roll = new Quaternion();
const dummy = new Object3D();

export function BulletHoles({ world }: { world: World }) {
  const meshes = useRef<Partial<Record<DecalKind, InstancedMesh | null>>>({});
  const ring = useRef<Record<DecalKind, number>>({ concrete: 0, metal: 0, wood: 0, dirt: 0, blood: 0 });
  const bitMesh = useRef<InstancedMesh>(null);
  const sparkMesh = useRef<InstancedMesh>(null);
  const bits = useRef<Bit[]>([]);
  const pending = useRef<Impact[]>([]);

  // Tạo và huỷ trong cùng một effect (StrictMode chạy hai lần).
  const res = useMemo(() => ({ geometry: new PlaneGeometry(1, 1), bitGeo: new BoxGeometry(1, 1, 1) }), []);
  const materials = useMemo(() => {
    const out = {} as Record<DecalKind, MeshStandardMaterial>;
    for (const k of KINDS) {
      const m = new MeshStandardMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: k === "metal" ? 0.45 : k === "blood" ? 0.35 : 0.95,
        metalness: k === "metal" ? 0.5 : 0,
      });
      m.userData.detail = "none";
      out[k] = m;
    }
    return out;
  }, []);
  const bitMat = useMemo(() => {
    const m = new MeshStandardMaterial({ roughness: 0.95 });
    m.userData.detail = "none";
    return m;
  }, []);
  const sparkMat = useMemo(() => new MeshBasicMaterial({ color: new Color(4, 2.4, 0.9), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), []);
  useEffect(() => {
    for (const k of KINDS) {
      materials[k].map = TEXTURES[k]();
      materials[k].needsUpdate = true;
    }
    return () => {
      for (const k of KINDS) {
        materials[k].map?.dispose();
        materials[k].map = null;
      }
    };
  }, [materials]);
  useEffect(
    () => () => {
      res.geometry.dispose();
      res.bitGeo.dispose();
      for (const k of KINDS) materials[k].dispose();
      bitMat.dispose();
      sparkMat.dispose();
    },
    [res, materials, bitMat, sparkMat],
  );

  const addDecal = (kind: DecalKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, scale = 1) => {
    const m = meshes.current[kind];
    if (!m) return;
    const i = ring.current[kind] % MAX_DECALS;
    ring.current[kind]++;
    m.count = Math.min(MAX_DECALS, ring.current[kind]);
    _n.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(Z, _n);
    _roll.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    dummy.quaternion.copy(_q).multiply(_roll);
    const [lo, hi] = DECAL_SIZE[kind];
    dummy.scale.setScalar(rand(lo, hi) * scale);
    dummy.position.set(x + _n.x * 0.012, y + _n.y * 0.012, z + _n.z * 0.012);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
  };

  const addBit = (b: Omit<Bit, "age">) => {
    if (bits.current.length >= MAX_BITS) bits.current.shift();
    bits.current.push({ ...b, age: 0 });
  };

  const spawn = (imp: Impact, camDist: number) => {
    const surface: HitSurface = imp.blood ? "flesh" : (imp.surface ?? surfaceAt(world, imp.x, imp.y, imp.z, imp.nx, imp.ny, imp.nz));
    const fx = FX[surface];
    const near = camDist < 45;
    const size = imp.size ?? 1;
    // Lỗ đạn.
    if (!imp.noHole && surface !== "water" && surface !== "flesh" && camDist < 160) addDecal(surface, imp.x, imp.y, imp.z, imp.nx, imp.ny, imp.nz, size);
    // Bụi phụt ra theo pháp tuyến, nước thì bắn cột lên.
    const water = surface === "water";
    for (let k = 0; k < fx.puffs; k++) {
      const up = water ? rand(2.5, 5) : 0;
      puffs.push({
        x: imp.x,
        y: imp.y,
        z: imp.z,
        vx: imp.nx * rand(0.8, 3) + rand(-0.5, 0.5),
        vy: imp.ny * rand(0.8, 3) + rand(0, 0.6) + up,
        vz: imp.nz * rand(0.8, 3) + rand(-0.5, 0.5),
        size: water ? 0.18 : surface === "flesh" ? 0.22 : 0.2 + Math.random() * 0.15,
        grow: water ? 0.5 : surface === "flesh" ? 0.6 : 1.1,
        life: water ? 0.7 : surface === "flesh" ? 0.45 : rand(0.8, 1.4),
        age: 0,
        r: fx.dust[0],
        g: fx.dust[1],
        b: fx.dust[2],
        alpha: water ? 0.75 : surface === "flesh" ? 0.9 : 0.55,
        dense: false,
      });
    }
    if (!near) return;
    // Mảnh vụn văng ra rồi rơi, nảy.
    const bitColor = new Color(fx.bitColor);
    for (let k = 0; k < fx.bits; k++)
      addBit({
        x: imp.x,
        y: imp.y,
        z: imp.z,
        vx: imp.nx * rand(1.5, 4) + rand(-1.2, 1.2),
        vy: imp.ny * rand(1.5, 4) + rand(0.5, 2.5),
        vz: imp.nz * rand(1.5, 4) + rand(-1.2, 1.2),
        life: rand(0.6, 1.3),
        size: rand(0.012, 0.03),
        spin: rand(-15, 15),
        spark: false,
        color: bitColor,
      });
    // Tia lửa: nhanh, sáng, tắt rất nhanh.
    const sparks = fx.sparks > 1 ? fx.sparks : Math.random() < 0.3 ? fx.sparks : 0;
    for (let k = 0; k < sparks; k++)
      addBit({
        x: imp.x,
        y: imp.y,
        z: imp.z,
        vx: imp.nx * rand(2, 7) + rand(-3, 3),
        vy: imp.ny * rand(2, 7) + rand(-1, 3),
        vz: imp.nz * rand(2, 7) + rand(-3, 3),
        life: rand(0.12, 0.35),
        size: rand(0.012, 0.022),
        spin: 0,
        spark: true,
        color: bitColor,
      });
    if (surface !== "flesh") playImpact(imp, surface);
  };

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = camera.position;
    // Đạn bay xa tới nơi muộn hơn: giữ lại tới lúc đạn tới mới phụt bụi, để lỗ.
    const nowS = performance.now() / 1000;
    const waiting = pending.current;
    waiting.push(...effects.impacts.splice(0));
    for (let i = waiting.length - 1; i >= 0; i--) {
      const imp = waiting[i]!;
      if ((imp.at ?? 0) > nowS) continue;
      waiting.splice(i, 1);
      spawn(imp, Math.hypot(imp.x - cam.x, imp.y - cam.y, imp.z - cam.z));
    }
    for (const s of effects.splats.splice(0)) if (Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z) < 120) addDecal("blood", s.x, s.y, s.z, s.nx, s.ny, s.nz, s.scale);

    const bm = bitMesh.current;
    const sm = sparkMesh.current;
    if (!bm || !sm) return;
    let nb = 0;
    let ns = 0;
    const list = bits.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      b.age += dt;
      if (b.age >= b.life) {
        list.splice(i, 1);
        continue;
      }
      b.vy -= (b.spark ? 6 : 14) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const floor = world.heightAt(b.x, b.z);
      if (b.y < floor && !b.spark) {
        b.y = floor;
        b.vy *= -0.3;
        b.vx *= 0.5;
        b.vz *= 0.5;
      }
      const k = 1 - b.age / b.life;
      if (b.spark) {
        // Tia lửa: vệt dài theo hướng bay.
        const speed = Math.hypot(b.vx, b.vy, b.vz) || 1;
        _n.set(b.vx / speed, b.vy / speed, b.vz / speed);
        dummy.quaternion.setFromUnitVectors(Z, _n);
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.set(b.size * k, b.size * k, Math.min(0.12, speed * 0.012));
        dummy.updateMatrix();
        sm.setMatrixAt(ns++, dummy.matrix);
      } else {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(b.age * b.spin, b.age * b.spin * 0.7, 0);
        dummy.scale.setScalar(b.size * Math.min(1, k * 3));
        dummy.updateMatrix();
        bm.setMatrixAt(nb, dummy.matrix);
        bm.setColorAt(nb++, b.color);
      }
    }
    bm.count = nb;
    sm.count = ns;
    bm.instanceMatrix.needsUpdate = true;
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    sm.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            meshes.current[k] = m;
            // Chưa có lỗ nào thì không vẽ gì; mỗi lần thêm thì tăng dần tới MAX.
            if (m) m.count = Math.min(MAX_DECALS, ring.current[k]);
          }}
          args={[res.geometry, materials[k], MAX_DECALS]}
          frustumCulled={false}
          receiveShadow
          renderOrder={2}
        />
      ))}
      <instancedMesh ref={bitMesh} args={[res.bitGeo, bitMat, MAX_BITS]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={sparkMesh} args={[res.bitGeo, sparkMat, MAX_BITS]} frustumCulled={false} renderOrder={9} />
    </>
  );
}
