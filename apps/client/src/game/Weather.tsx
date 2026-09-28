import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshStandardMaterial,
  Object3D,
  type InstancedMesh,
  type LineSegments,
  type MeshBasicMaterial,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WATER_LEVEL, type World } from "@tentides/content";
import type { IslandRoom } from "../net.ts";
import { useQuality } from "./graphics.ts";
import { mulberry32, windStrength } from "./nature.ts";
import { play } from "./sound/sfx.ts";
import { localEnv, localPosition, shake, sky, weatherFx } from "./shared.ts";

// Thời tiết của ngày hiện ra trên trời và dưới đất: mây trôi (nhiều ít, trắng hay xám chì), mưa rơi quanh người,
// bão thì gió giật, sấm chớp; sương mù thì nhìn không xa; động đất thì mặt đất rung từng đợt.
// Ban đêm trời quang thì có đom đóm lập lòe trên đất liền. Chỉ là hình ảnh: luật chơi đọc thời tiết từ engine.

/** Mức mây, mưa, sương, bão, động đất của từng kiểu thời tiết. */
const TARGETS: Record<string, Partial<typeof weatherFx>> = {
  sunny: { cloud: 0.15 },
  cloudy: { cloud: 0.6 },
  rain: { cloud: 0.85, rain: 0.65 },
  fog: { cloud: 0.4, fog: 1 },
  storm: { cloud: 1, rain: 1, storm: 1 },
  quake: { cloud: 0.45, quake: 1 },
};

/** Chuyển dần sang thời tiết mới; tính mức gió cho cây cỏ. */
function WeatherState({ room }: { room: IslandRoom }) {
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = room.state;
    const target = s.phase === "lobby" || s.phase === "create" || s.phase === "pack" ? {} : (TARGETS[s.weather] ?? {});
    const k = Math.min(1, dt * 0.35);
    for (const key of ["cloud", "rain", "fog", "storm", "quake"] as const) {
      const goal = target[key] ?? (key === "cloud" ? 0.15 : 0);
      weatherFx[key] += (goal - weatherFx[key]) * k;
    }
    windStrength.value = 1 + weatherFx.rain * 0.8 + weatherFx.storm * 2.2;
  });
  return null;
}

// ---------------------------------------------------------------------------- mây

const CLOUDS = 48;

function cloudGeometry(): BufferGeometry {
  const rand = mulberry32(7);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const r = 5 + rand() * 6;
    parts.push(new IcosahedronGeometry(r, 1).scale(1, 0.55, 1).translate((rand() - 0.5) * 22, (rand() - 0.3) * 3, (rand() - 0.5) * 10));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function Clouds() {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(cloudGeometry, []);
  const material = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", flatShading: true, roughness: 1, transparent: true, opacity: 0.92, fog: false }), []);
  const clouds = useMemo(() => {
    const rand = mulberry32(99);
    return Array.from({ length: CLOUDS }, (_, i) => ({
      angle: rand() * Math.PI * 2,
      radius: 40 + rand() * 190,
      y: 85 + rand() * 35,
      size: 0.7 + rand() * 0.9,
      spin: rand() * Math.PI,
      /** Mây thứ i chỉ hiện khi độ phủ vượt ngưỡng này, để trời quang chỉ lác đác vài đám. */
      cover: i / CLOUDS,
    }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  const white = useMemo(() => new Color("#ffffff"), []);
  const dark = useMemo(() => new Color("#5d6770"), []);
  const night = useMemo(() => new Color("#1b2233"), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const drift = clock.elapsedTime * (0.6 + weatherFx.storm * 2.5);
    clouds.forEach((c, i) => {
      const show = Math.min(1, Math.max(0, (weatherFx.cloud - c.cover) * 6 + 0.35));
      // Gió đẩy mây trôi về phía đông, ra khỏi vùng thì vòng lại từ phía tây.
      const x = ((((Math.cos(c.angle) * c.radius + drift * 1.5 + 240) % 480) + 480) % 480) - 240;
      const z = Math.sin(c.angle) * c.radius;
      dummy.position.set(x, c.y, z);
      dummy.rotation.set(0, c.spin, 0);
      dummy.scale.setScalar(c.size * show * (1 + weatherFx.storm * 0.35));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    // Mây chuyển xám chì khi mưa bão, sẫm lại về đêm, loé trắng khi có chớp.
    material.color.copy(white).lerp(dark, Math.max(weatherFx.rain * 0.6, weatherFx.storm)).lerp(night, sky.night * 0.85).lerp(white, weatherFx.flash);
    material.emissive.copy(material.color).multiplyScalar(0.25 * (1 - sky.night));
  });
  return <instancedMesh ref={mesh} args={[geometry, material, CLOUDS]} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------- mưa

const RAIN_AREA = 26;
const RAIN_HEIGHT = 22;

function Rain({ count }: { count: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const drops = useMemo(() => {
    const rand = mulberry32(5);
    return Array.from({ length: count }, () => ({ x: (rand() - 0.5) * 2 * RAIN_AREA, y: rand() * RAIN_HEIGHT, z: (rand() - 0.5) * 2 * RAIN_AREA, speed: 24 + rand() * 10 }));
  }, [count]);
  const dummy = useMemo(() => new Object3D(), []);

  useFrame(({ camera }, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    // Không mưa trong hang, dưới nước; lượng hạt theo độ mưa.
    const amount = weatherFx.rain * (1 - localEnv.indoor) * (localEnv.underwater ? 0 : 1);
    const visible = Math.floor(count * amount);
    m.visible = visible > 0;
    if (!m.visible) return;
    const slant = 0.15 + weatherFx.storm * 0.5;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < count; i++) {
      const d = drops[i]!;
      if (i >= visible) {
        dummy.scale.setScalar(0);
      } else {
        d.y -= d.speed * dt;
        d.x += d.speed * slant * dt;
        if (d.y < -4) {
          d.y += RAIN_HEIGHT;
          d.x = (Math.random() - 0.5) * 2 * RAIN_AREA;
          d.z = (Math.random() - 0.5) * 2 * RAIN_AREA;
        }
        // Hạt mưa đi theo camera, gói vòng trong một hộp quanh người nhìn; không rơi sát ống kính (trông như que).
        let wx = cx + ((((d.x % (2 * RAIN_AREA)) + 3 * RAIN_AREA) % (2 * RAIN_AREA)) - RAIN_AREA);
        let wz = cz + d.z;
        const near = Math.hypot(wx - cx, wz - cz);
        if (near < 2.5) {
          const k = 2.5 / Math.max(near, 0.01);
          wx = cx + (wx - cx) * k;
          wz = cz + (wz - cz) * k;
        }
        const wy = cy - 6 + d.y;
        dummy.position.set(wx, Math.max(wy, WATER_LEVEL - 50), wz);
        dummy.rotation.set(0, 0, slant * 0.9);
        dummy.scale.set(1, 1 + weatherFx.storm * 0.4, 1);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[0.018, 0.7, 0.018]} />
      <meshBasicMaterial color="#b9cfdf" transparent opacity={0.45} depthWrite={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------- sấm chớp

/** Tia chớp: đường gấp khúc từ mây xuống mặt biển xa. */
function boltGeometry(rand: () => number): BufferGeometry {
  const points: number[] = [];
  let x = 0;
  let y = 90;
  let z = 0;
  while (y > 0) {
    const nx = x + (rand() - 0.5) * 9;
    const ny = y - 6 - rand() * 8;
    const nz = z + (rand() - 0.5) * 9;
    points.push(x, y, z, nx, Math.max(0, ny), nz);
    // Nhánh rẽ ngắn.
    if (rand() < 0.3) points.push(nx, ny, nz, nx + (rand() - 0.5) * 14, ny - 8, nz + (rand() - 0.5) * 14);
    x = nx;
    y = ny;
    z = nz;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(points, 3));
  return g;
}

function Lightning() {
  const bolt = useRef<LineSegments>(null);
  const state = useRef({ next: 6, flashAt: -10, thunderAt: -1, strength: 0 });
  const geometries = useMemo(() => {
    const rand = mulberry32(3);
    return Array.from({ length: 5 }, () => boltGeometry(rand));
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = state.current;
    const b = bolt.current;
    if (weatherFx.storm > 0.3 && t > s.next) {
      // Mỗi 5–14 giây một tia chớp ở phía xa; tiếng sấm tới sau 1–3 giây.
      s.flashAt = t;
      s.next = t + 5 + Math.random() * 9;
      s.thunderAt = t + 1 + Math.random() * 2;
      s.strength = 0.6 + Math.random() * 0.4;
      if (b) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 110 + Math.random() * 80;
        b.geometry = geometries[Math.floor(Math.random() * geometries.length)]!;
        b.position.set(localPosition.x + Math.cos(angle) * dist, 0, localPosition.z + Math.sin(angle) * dist);
      }
    }
    // Lóe hai nhịp rồi tắt.
    const since = t - s.flashAt;
    const flicker = since < 0.08 ? 1 : since < 0.16 ? 0.25 : since < 0.26 ? 0.8 : Math.max(0, 1 - (since - 0.26) * 5);
    weatherFx.flash = since < 0.5 ? flicker * s.strength * (1 - localEnv.indoor) : 0;
    if (b) {
      b.visible = since < 0.3;
      (b.material as MeshBasicMaterial).opacity = flicker;
    }
    if (s.thunderAt > 0 && t > s.thunderAt) {
      s.thunderAt = -1;
      if (b) play("thunder", { at: { x: b.position.x, y: 20, z: b.position.z }, hearing: 450, volume: 1.2 * s.strength });
      shake.amount = Math.min(0.8, shake.amount + 0.18 * s.strength);
    }
  });
  return (
    <lineSegments ref={bolt} visible={false} frustumCulled={false}>
      <bufferGeometry />
      <lineBasicMaterial color="#eef4ff" transparent fog={false} blending={AdditiveBlending} toneMapped={false} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------- động đất

/** Ngày động đất: cứ 14–30 giây mặt đất rung một đợt chừng hai giây. */
function Quake() {
  const state = useRef({ next: 8, start: -10 });
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = state.current;
    if (weatherFx.quake < 0.5) return;
    if (t > s.next) {
      s.start = t;
      s.next = t + 14 + Math.random() * 16;
      play("rumble", { volume: 0.9 * weatherFx.quake });
    }
    const since = t - s.start;
    if (since < 2.2) shake.amount = Math.max(shake.amount, 0.35 * Math.sin((since / 2.2) * Math.PI) * weatherFx.quake);
  });
  return null;
}

// ---------------------------------------------------------------------------- đom đóm

const FIREFLIES = 70;

function Fireflies({ world }: { world: World }) {
  const mesh = useRef<InstancedMesh>(null);
  const flies = useMemo(() => {
    const rand = mulberry32(21);
    return Array.from({ length: FIREFLIES }, () => ({ ox: (rand() - 0.5) * 44, oz: (rand() - 0.5) * 44, h: 0.4 + rand() * 1.8, phase: rand() * 10, speed: 0.3 + rand() * 0.6 }));
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    // Chỉ ban đêm, trời không mưa, ngoài trời.
    const amount = Math.max(0, sky.night - 0.4) / 0.6 * (1 - weatherFx.rain) * (1 - localEnv.indoor) * (localEnv.underwater ? 0 : 1);
    m.visible = amount > 0.02;
    if (!m.visible) return;
    const t = clock.elapsedTime;
    // Đom đóm "neo" theo ô lưới 44 m quanh người chơi, để đi tới đâu cũng có mà không chạy theo mình.
    const cellX = Math.round(localPosition.x / 44) * 44;
    const cellZ = Math.round(localPosition.z / 44) * 44;
    flies.forEach((f, i) => {
      let x = cellX + f.ox + Math.sin(t * f.speed + f.phase) * 1.5;
      let z = cellZ + f.oz + Math.cos(t * f.speed * 0.8 + f.phase) * 1.5;
      if (x - localPosition.x > 22) x -= 44;
      if (localPosition.x - x > 22) x += 44;
      if (z - localPosition.z > 22) z -= 44;
      if (localPosition.z - z > 22) z += 44;
      const ground = world.heightAt(x, z);
      const blink = Math.max(0, Math.sin(t * 2.2 + f.phase * 3)) ** 3;
      const onLand = ground > 0.4 ? 1 : 0;
      dummy.position.set(x, ground + f.h + Math.sin(t * 1.3 + f.phase) * 0.3, z);
      dummy.scale.setScalar(0.05 * onLand * (0.4 + blink));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.setRGB(0.8, 1, 0.35).multiplyScalar((0.3 + blink * 2.5) * amount));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, FIREFLIES]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial toneMapped={false} blending={AdditiveBlending} depthWrite={false} transparent />
    </instancedMesh>
  );
}

export function Weather({ room, world }: { room: IslandRoom; world: World }) {
  const high = useQuality() === "high";
  return (
    <>
      <WeatherState room={room} />
      <Clouds />
      <Rain count={high ? 1600 : 600} />
      <Lightning />
      <Quake />
      <Fireflies world={world} />
    </>
  );
}
