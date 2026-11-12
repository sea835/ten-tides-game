import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, InstancedBufferGeometry, MeshStandardMaterial } from "three";
import { Fn, attribute, exp, float, max, positionLocal, select, vec3 } from "three/tsl";
import { slots, type V3 } from "../gpu/slots.ts";
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

/** Xoay vec3 theo ba góc Euler: Rz * Ry * Rx (cùng thứ tự với shader cũ). */
function rotate(v: V3, e: V3): V3 {
  const cx = e.x.cos();
  const sx = e.x.sin();
  const cy = e.y.cos();
  const sy = e.y.sin();
  const cz = e.z.cos();
  const sz = e.z.sin();
  const a = vec3(v.x, cx.mul(v.y).sub(sx.mul(v.z)), sx.mul(v.y).add(cx.mul(v.z)));
  const b = vec3(cy.mul(a.x).add(sy.mul(a.z)), a.y, sy.negate().mul(a.x).add(cy.mul(a.z)));
  return vec3(cz.mul(b.x).sub(sz.mul(b.y)), sz.mul(b.x).add(cz.mul(b.y)), b.z);
}

/**
 * Vị trí đỉnh của cục đất, tính trên GPU (gán vào `positionNode` của vật liệu chuẩn): bay theo trọng lực, chạm đất nảy
 * một cái, trượt chậm dần, lún; xoay lộn theo góc. Pháp tuyến: vật liệu để `flatShading` nên pháp tuyến tự suy ra từ
 * mặt đã dịch, không cần xoay riêng.
 */
const debrisPosition = Fn(() => {
  const aStart = attribute("aStart", "vec4");
  const aVel = attribute("aVel", "vec4");
  const aLand = attribute("aLand", "vec4");
  const aShape = attribute("aShape", "vec4");
  const age = particleClock.sub(aStart.w);
  const life = aVel.w;
  const dead = life.lessThanEqual(0).or(age.lessThan(0)).or(age.greaterThanEqual(life));
  const tHit = aLand.x;
  const ground = aLand.y;
  const bounce = aLand.z;
  const spinRate = aLand.w;
  // Trước khi chạm đất: đạn đạo.
  const flyP = aStart.xyz.add(aVel.xyz.mul(age)).sub(vec3(0, age.mul(age).mul(4.9), 0));
  // Sau khi chạm đất: nảy một cái (bay lại theo trọng lực, chậm đi một nửa theo phương ngang), rồi trượt chậm dần
  // trên mặt đất (lực cản e^(-6 t)).
  const land = aStart.xz.add(aVel.xz.mul(tHit));
  const tb = bounce.mul(2).div(9.8);
  const s = age.sub(tHit);
  const u = s.sub(tb);
  const bounceXZ = land.add(aVel.xz.mul(0.55).mul(s));
  const bounceY = ground.add(bounce.mul(s)).sub(s.mul(s).mul(4.9));
  const slideXZ = land.add(aVel.xz.mul(0.55).mul(tb)).add(aVel.xz.mul(0.3).mul(float(1).sub(exp(u.mul(-6)))).div(6));
  const inBounce = s.lessThan(tb);
  const groundP = vec3(select(inBounce, bounceXZ.x, slideXZ.x), select(inBounce, bounceY, ground), select(inBounce, bounceXZ.y, slideXZ.y));
  const flying = age.lessThan(tHit);
  const p = select(flying, flyP, groundP).toVar();
  const spun = select(flying, spinRate.mul(age), spinRate.mul(tHit.add(s.min(1).mul(0.5))));
  // Cuối đời lún dần xuống đất.
  const sink = max(float(0), age.sub(life.sub(0.8))).div(0.8);
  const size = aShape.x;
  const shade = aShape.y;
  p.y.subAssign(sink.mul(size));
  const euler = vec3(aShape.z.add(spun), aShape.w, aShape.z.mul(0.7).add(spun.mul(0.7)));
  const scale = vec3(size.mul(shade.mul(0.4).add(1.1)), size.mul(shade.mul(0.3).add(0.7)), size);
  // Chưa sinh, đã tắt, ô trống: co về 0 (không vẽ điểm ảnh nào).
  const S = select(dead, vec3(0), scale);
  return rotate(positionLocal.mul(S), euler).add(p);
});

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
    slots(m).positionNode = debrisPosition();
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => r.flush());
  return <mesh geometry={r.geometry} material={material} frustumCulled={false} />;
}
