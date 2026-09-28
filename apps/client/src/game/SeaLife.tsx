import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, ConeGeometry, IcosahedronGeometry, MeshStandardMaterial, Object3D, type InstancedMesh } from "three";
import { WATER_LEVEL, type World } from "@tentides/content";
import { mulberry32 } from "./nature.ts";

// Cảnh vật sống chỉ để nhìn (không đồng bộ, không tương tác): san hô trên rạn, đàn cá lượn quanh rạn,
// hải âu liệng trên các đảo nhỏ. Vị trí theo seed thế giới nên máy nào cũng giống nhau; chuyển động theo đồng hồ.

const CORAL_COLORS = ["#ff7f6a", "#ffb35c", "#e85da8", "#9b7bff", "#ffe066", "#5fd3c6"];

function Coral({ world }: { world: World }) {
  const branches = useRef<InstancedMesh>(null);
  const brains = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const rand = mulberry32(world.seed ^ 0x51f);
    const out: { x: number; y: number; z: number; s: number; r: number; kind: 0 | 1; color: string }[] = [];
    for (const reef of world.reefs) {
      for (let i = 0; i < 70; i++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * reef.radius * 0.9;
        const x = reef.x + Math.cos(a) * d;
        const z = reef.z + Math.sin(a) * d;
        const y = world.heightAt(x, z);
        if (y > -0.8) continue;
        out.push({ x, y, z, s: 0.4 + rand() * 0.9, r: rand() * Math.PI, kind: rand() < 0.6 ? 0 : 1, color: CORAL_COLORS[Math.floor(rand() * CORAL_COLORS.length)]! });
      }
    }
    return out;
  }, [world]);
  const branchSpots = spots.filter((s) => s.kind === 0);
  const brainSpots = spots.filter((s) => s.kind === 1);
  const geo = useMemo(() => ({ branch: new ConeGeometry(0.25, 1.4, 5).translate(0, 0.7, 0), brain: new IcosahedronGeometry(0.6, 1) }), []);
  const mat = useMemo(() => new MeshStandardMaterial({ flatShading: true, roughness: 0.8 }), []);

  useLayoutEffect(() => {
    const dummy = new Object3D();
    const color = new Color();
    const fill = (mesh: InstancedMesh | null, list: typeof spots, flatten: boolean) => {
      if (!mesh) return;
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y + (flatten ? 0.1 : -0.05), s.z);
        dummy.rotation.set(flatten ? 0 : (s.r - 1.5) * 0.3, s.r * 2, 0);
        dummy.scale.set(s.s, flatten ? s.s * 0.55 : s.s, s.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.set(s.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(branches.current, branchSpots, false);
    fill(brains.current, brainSpots, true);
  }, [branchSpots, brainSpots]);

  return (
    <>
      {branchSpots.length > 0 && <instancedMesh key={`b${world.seed}`} ref={branches} args={[geo.branch, mat, branchSpots.length]} />}
      {brainSpots.length > 0 && <instancedMesh key={`r${world.seed}`} ref={brains} args={[geo.brain, mat, brainSpots.length]} />}
    </>
  );
}

interface Swimmer {
  cx: number;
  cz: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  color: string;
  s: number;
}

/** Đàn cá: mỗi con bơi vòng quanh tâm rạn, lệch pha và độ sâu một chút. */
function Fish({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const fish = useMemo(() => {
    const rand = mulberry32(world.seed ^ 0xf15);
    const out: Swimmer[] = [];
    const colors = ["#ffd166", "#4cc9f0", "#f15bb5", "#ffffff", "#fb8500"];
    for (const reef of world.reefs) {
      const school = colors[Math.floor(rand() * colors.length)]!;
      for (let i = 0; i < 14; i++) {
        out.push({
          cx: reef.x,
          cz: reef.z,
          y: reef.top - 0.4 - rand() * 1,
          radius: reef.radius * (0.3 + rand() * 0.4),
          speed: (0.25 + rand() * 0.15) * (rand() < 0.5 ? 1 : -1),
          phase: rand() * 0.8,
          color: school,
          s: 0.7 + rand() * 0.5,
        });
      }
    }
    return out;
  }, [world]);
  const geo = useMemo(() => new ConeGeometry(0.1, 0.4, 4).rotateX(Math.PI / 2), []);
  const mat = useMemo(() => new MeshStandardMaterial({ flatShading: true, roughness: 0.5 }), []);
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    fish.forEach((f, i) => m.setColorAt(i, c.set(f.color)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [fish]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    fish.forEach((f, i) => {
      const a = t * f.speed + f.phase;
      dummy.position.set(f.cx + Math.cos(a) * f.radius, f.y + Math.sin(t * 1.3 + i) * 0.15, f.cz + Math.sin(a) * f.radius);
      // Hướng bơi là tiếp tuyến của vòng tròn.
      dummy.rotation.set(0, -a + (f.speed > 0 ? Math.PI : 0), 0);
      dummy.scale.setScalar(f.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  if (fish.length === 0) return null;
  return <instancedMesh key={world.seed} ref={mesh} args={[geo, mat, fish.length]} frustumCulled={false} />;
}

/** Hải âu liệng vòng trên các đảo nhỏ và dọc bờ đảo chính. */
function Gulls({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const birds = useMemo(() => {
    const rand = mulberry32(world.seed ^ 0x6011);
    const centers = [...world.islets.map((it) => ({ x: it.x, z: it.z, r: it.radius })), { x: 60, z: 70, r: 25 }, { x: -80, z: -40, r: 30 }];
    return centers.flatMap((c) =>
      Array.from({ length: 3 }, () => ({ cx: c.x, cz: c.z, y: 14 + rand() * 10, radius: c.r * (0.6 + rand() * 0.6), speed: 0.15 + rand() * 0.1, phase: rand() * Math.PI * 2, s: 1, color: "#ffffff" })),
    );
  }, [world]);
  const geo = useMemo(() => {
    // Hai cánh chữ V mỏng.
    const g = new ConeGeometry(0.08, 1.4, 3).rotateZ(Math.PI / 2);
    return g;
  }, []);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#f4f4f4", flatShading: true }), []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    birds.forEach((b, i) => {
      const a = t * b.speed + b.phase;
      dummy.position.set(b.cx + Math.cos(a) * b.radius, WATER_LEVEL + b.y + Math.sin(t * 0.7 + i) * 1.2, b.cz + Math.sin(a) * b.radius);
      dummy.rotation.set(Math.sin(t * 6 + i) * 0.3, -a, Math.sin(t * 0.5 + i) * 0.3);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh key={world.seed} ref={mesh} args={[geo, mat, birds.length]} frustumCulled={false} />;
}

export function SeaLife({ world }: { world: World }) {
  return (
    <>
      <Coral world={world} />
      <Fish world={world} />
      <Gulls world={world} />
    </>
  );
}
