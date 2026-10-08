import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, InstancedBufferGeometry, MeshStandardMaterial } from "three";
import type { World } from "@tentides/content";
import { useQuality } from "../graphics.ts";
import { windStrength } from "../nature.ts";
import { ParticleRing, particleClock, puffs } from "./gpuParticles.ts";

// Đất đá văng tung toé khi nổ (lựu đạn, mìn, RPG, đạn pháo): những cục đất sẫm màu bay vọt lên, xoay lộn, kéo theo
// vệt bụi, rơi xuống đất nảy một cái rồi trượt dừng, lún dần vào đất. Tính trên GPU: lúc nổ CPU chỉ tính một lần chỗ
// cục đất rơi xuống (độ cao mặt đất ở đó) và ghi vào bộ đệm vòng; vertex shader tự tính vị trí, góc lộn ở từng khung
// (bay theo trọng lực → nảy → trượt chậm dần → lún). Vệt bụi cũng được tính sẵn lúc nổ, hẹn giờ hiện ra dọc đường bay.
// Trước đây CPU tích phân, dò mặt đất và ghép ma trận cho tới 220 cục mỗi khung.

const MAX_CHUNKS = 320;
const G = 9.8;

/** Số cục đất mỗi vụ nổ theo mức đồ hoạ. */
const PER_BLAST = { high: 22, medium: 15, low: 8 } as const;

let ring: ParticleRing | null = null;
function chunkRing(): ParticleRing {
  if (!ring) {
    ring = new ParticleRing(MAX_CHUNKS, ["aStart", "aVel", "aLand", "aShape"]);
    // Hình khối đa diện thay cho tấm vuông của hạt khói.
    const ico = new IcosahedronGeometry(1, 0);
    const g = ring.geometry as InstancedBufferGeometry;
    g.index = null;
    g.setAttribute("position", ico.getAttribute("position"));
    g.setAttribute("normal", ico.getAttribute("normal"));
    g.deleteAttribute("uv");
  }
  return ring;
}

let world: World | null = null;
let quality: keyof typeof PER_BLAST = "medium";

/** Vụ nổ ở (x, y, z): đất đá văng lên. Gọi từ chỗ nhận tin nổ. */
export function spawnDebris(x: number, y: number, z: number, big: boolean) {
  if (!world) return;
  const r = chunkRing();
  const now = particleClock.value;
  const wind = 0.6 * windStrength.value;
  const n = Math.round(PER_BLAST[quality] * (big ? 1.4 : 1));
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const out = (3 + Math.random() * 7) * (big ? 1.3 : 1);
    const x0 = x + Math.cos(a) * 0.5;
    const y0 = y + 0.3;
    const z0 = z + Math.sin(a) * 0.5;
    const vx = Math.cos(a) * out;
    const vy = (6 + Math.random() * 9) * (big ? 1.25 : 1);
    const vz = Math.sin(a) * out;
    const size = (0.07 + Math.random() * Math.random() * 0.22) * (big ? 1.2 : 1);
    const life = 3 + Math.random() * 1.5;
    // Lúc chạm đất: giải phương trình bay với mặt đất ở chỗ nổ, rồi tính lại một lần với mặt đất ở chỗ rơi.
    const hit = (ground: number) => {
      const c = y0 - (ground + size * 0.5);
      return (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, c))) / G;
    };
    let tHit = hit(world.heightAt(x0, z0));
    const ground = world.heightAt(x0 + vx * tHit, z0 + vz * tHit);
    tHit = hit(ground);
    // Nảy một cái (rơi đủ nhanh thì nảy lên 28% tốc độ rơi), rồi trượt dừng.
    const vHit = G * tHit - vy;
    const bounce = vHit > 1.5 ? vHit * 0.28 : 0;
    const spin = 4 + Math.random() * 10;
    r.write(
      [
        [x0, y0, z0, now],
        [vx, vy, vz, life],
        [tHit, ground + size * 0.5, bounce, spin],
        [size, Math.random(), Math.random() * 6, Math.random() * 6],
      ],
      now + life,
    );
    // Vệt bụi kéo theo khi cục đất bay (chừng 0,9 giây đầu), hẹn giờ hiện trên GPU (tuổi âm: chưa sinh).
    for (let t = 0.04 + Math.random() * 0.05; t < Math.min(0.9, tHit) && puffs.length < 1300; t += 0.07 + Math.random() * 0.05) {
      puffs.push({ x: x0 + vx * t, y: y0 + vy * t - 0.5 * G * t * t, z: z0 + vz * t, vx: wind * 0.3, vy: 0.2, vz: 0, size: 0.25 + size * 1.5, grow: 0.9, life: 0.9 + Math.random() * 0.5, age: -t, r: 0.42, g: 0.36, b: 0.28, alpha: 0.35, dense: false });
    }
  }
}

/** Vị trí, góc lộn của cục đất tính trong vertex shader (thay khối biến đổi chuẩn của MeshStandardMaterial). */
const DEBRIS_VERTEX_HEAD = /* glsl */ `
  attribute vec4 aStart;
  attribute vec4 aVel;
  attribute vec4 aLand;
  attribute vec4 aShape;
  uniform float uTime;
  float vDead;
  mat3 tenRot(vec3 e) {
    float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
    return rz * ry * rx;
  }
`;
const DEBRIS_TRANSFORM = /* glsl */ `
  float age = uTime - aStart.w;
  float life = aVel.w;
  vDead = (life <= 0.0 || age < 0.0 || age >= life) ? 1.0 : 0.0;
  float tHit = aLand.x;
  float ground = aLand.y;
  float bounce = aLand.z;
  float spinRate = aLand.w;
  vec3 p;
  float spun;
  if (age < tHit) {
    p = aStart.xyz + aVel.xyz * age;
    p.y -= 4.9 * age * age;
    spun = spinRate * age;
  } else {
    vec2 land = aStart.xz + aVel.xz * tHit;
    float tb = 2.0 * bounce / 9.8;
    float s = age - tHit;
    vec2 q;
    float y;
    if (s < tb) {
      // Nảy một cái: bay lại theo trọng lực, chậm đi một nửa theo phương ngang.
      q = land + aVel.xz * 0.55 * s;
      y = ground + bounce * s - 4.9 * s * s;
    } else {
      // Trượt chậm dần trên mặt đất (lực cản e^(-6 t)).
      float u = s - tb;
      q = land + aVel.xz * 0.55 * tb + aVel.xz * 0.3 * (1.0 - exp(-6.0 * u)) / 6.0;
      y = ground;
    }
    p = vec3(q.x, y, q.y);
    spun = spinRate * (tHit + 0.5 * min(s, 1.0));
  }
  // Cuối đời lún dần xuống đất.
  float sink = max(0.0, age - (life - 0.8)) / 0.8;
  float size = aShape.x;
  float shade = aShape.y;
  p.y -= sink * size;
  mat3 R = tenRot(vec3(aShape.z + spun, aShape.w, aShape.z * 0.7 + spun * 0.7));
  vec3 S = vec3(size * (1.1 + shade * 0.4), size * (0.7 + shade * 0.3), size);
  // Chưa sinh, đã tắt, ô trống: co về 0 (không vẽ điểm ảnh nào).
  if (vDead > 0.5) S = vec3(0.0);
`;

export function Debris({ world: w }: { world: World }) {
  const q = useQuality();
  useEffect(() => {
    world = w;
    quality = q;
  }, [w, q]);
  const r = chunkRing();
  useEffect(() => () => r.clear(), [r]);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#4a3a2a", roughness: 1, flatShading: true });
    // Cục đất cố ý để cạnh sắc (không làm mịn, không phủ vân).
    m.userData.detail = "none";
    m.userData.faceted = true;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = particleClock;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${DEBRIS_VERTEX_HEAD}`)
        .replace("#include <beginnormal_vertex>", `${DEBRIS_TRANSFORM}\nvec3 objectNormal = R * normal;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif`)
        .replace("#include <begin_vertex>", "vec3 transformed = R * (position * S) + p;");
    };
    m.customProgramCacheKey = () => "gpu-debris";
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => r.flush());
  return <mesh geometry={r.geometry} material={material} frustumCulled={false} />;
}
