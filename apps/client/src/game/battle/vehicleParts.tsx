import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ConeGeometry, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, type Group } from "three";
import { WRECK_SECONDS } from "@tentides/content";

// Phần dùng chung giữa xe tăng (Vehicles.tsx) và xe trinh sát, thuyền (Carriers.tsx): ai đang giữ camera khi ngồi
// xe, bảng điều khiển xe chở quân, xe gần nhất lên được (cho dòng nhắc), và xác xe cháy (khói đen, lửa).

/**
 * Bộ điều khiển nào đang giữ `seat` (camera, thân nhân vật theo xe): "tank" (lái xe tăng), "carrier" (xe chở quân),
 * "emplacement" (vũ khí cố định: ổ đại liên, cối — Emplacements.tsx), "heli" (trực thăng — Heli.tsx).
 */
export const seatOwner = { kind: "" as "" | "tank" | "carrier" | "emplacement" | "heli" };

/** Xe gần nhất lên được: loại xe và ghế sẽ ngồi (cho dòng nhắc "F lên xe"). */
export const nearInfo = { kind: "", seat: "" };

/** Bảng điều khiển xe chở quân (xe trinh sát, thuyền) cho HUD đọc mỗi khung hình. */
export const carrierHud = {
  active: false,
  kind: "",
  seat: 0,
  hp: 0,
  maxHp: 1,
  speed: 0,
  gunner: false,
  zoom: false,
  /** Ghế: tên, người ngồi (tên người), có phải mình. */
  seats: [] as { name: string; who: string; mine: boolean }[],
  /** Đầu nòng đại liên đang chĩa tới đâu trên màn hình. */
  aimX: 0.5,
  aimY: 0.5,
  aimOn: false,
  /** Đổi khi danh sách ghế đổi (HUD vẽ lại phần chữ). */
  seatsKey: "",
};

/** Bảng điều khiển vũ khí cố định (ổ đại liên, cối) cho HUD đọc mỗi khung hình. */
export const emplacementHud = {
  active: false,
  kind: "" as "" | "hmg_nest" | "mortar",
  hp: 0,
  maxHp: 1,
  zoom: false,
  /** Đại liên: đầu nòng đang chĩa tới đâu trên màn hình; súng đã chạm mép cung xoay chưa. */
  aimX: 0.5,
  aimY: 0.5,
  aimOn: false,
  clamped: false,
  /** Cối: chỗ đặt, phương vị (rad, thế giới), góc ngẩng (rad), tầm (m), điểm rơi dự đoán, thời gian bay, nạp đạn (0–1). */
  x: 0,
  z: 0,
  az: 0,
  elev: 0,
  range: 0,
  impactX: 0,
  impactZ: 0,
  flight: 0,
  reload: 1,
  /** Cứ điểm (vẽ trên bản đồ nhỏ của cối) và khoá đổi danh sách. */
  flags: [] as { id: string; x: number; z: number; color: string }[],
  flagsKey: "",
};

// ---------------------------------------------------------------------------- xác xe cháy

const SMOKE = new MeshStandardMaterial({ color: "#171717", roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
const SMOKE_LIGHT = new MeshStandardMaterial({ color: "#3a3734", roughness: 1, transparent: true, opacity: 0.32, depthWrite: false });
const FLAME = new MeshBasicMaterial({ color: "#ff7a1a", transparent: true, opacity: 0.85, depthWrite: false });
const FLAME_CORE = new MeshBasicMaterial({ color: "#ffd36a", transparent: true, opacity: 0.9, depthWrite: false });
const PUFF = new SphereGeometry(1, 8, 6);
const TONGUE = new ConeGeometry(0.35, 1.3, 6);
TONGUE.translate(0, 0.65, 0);

const PUFFS = 11;
const TONGUES = 5;

/**
 * Xác xe đang cháy: cột khói đen đặc bốc cao, vài lưỡi lửa liếm trên thân (tắt dần theo thời gian cháy). `wreck` là
 * xe đã nổ; `size` là cỡ xe (xe tăng 1, xe nhỏ hơn thì nhỏ hơn); `top` là độ cao nóc xe.
 */
export function WreckFire({ wreck, size = 1, top = 2 }: { wreck: boolean; size?: number; top?: number }) {
  const smoke = useRef<Group>(null);
  const fire = useRef<Group>(null);
  const since = useRef(0);
  const seeds = useMemo(() => Array.from({ length: Math.max(PUFFS, TONGUES) }, () => Math.random()), []);
  useFrame(() => {
    const s = smoke.current;
    const f = fire.current;
    if (!s || !f) return;
    s.visible = f.visible = wreck;
    if (!wreck) {
      since.current = 0;
      return;
    }
    const t = performance.now() / 1000;
    if (!since.current) since.current = t;
    // Cháy to lúc đầu, về sau lửa lụi dần, khói mỏng đi.
    const age = t - since.current;
    const burn = Math.max(0.15, 1 - age / WRECK_SECONDS);
    s.children.forEach((p, i) => {
      const u = (t * 0.18 + i / PUFFS + seeds[i]! * 0.05) % 1;
      const drift = u * u * 4;
      p.position.set(Math.sin(i * 2.1 + t * 0.3) * (0.3 + u) * size + drift * 0.6, top + u * 14 * size, Math.cos(i * 1.7 + t * 0.2) * (0.3 + u) * size + drift * 0.3);
      p.scale.setScalar((0.7 + u * 3.2) * size * (0.6 + 0.4 * burn));
    });
    f.children.forEach((p, i) => {
      const flick = 0.75 + 0.35 * Math.sin(t * (9 + i * 2.3) + seeds[i]! * 10) + 0.15 * Math.sin(t * 23 + i);
      p.scale.set(size * (0.8 + 0.3 * flick), size * flick * burn * 1.4, size * (0.8 + 0.3 * flick));
      p.visible = burn > 0.2 || i < 2;
    });
  });
  const ring = useMemo(() => Array.from({ length: TONGUES }, (_, i) => [Math.cos((i / TONGUES) * Math.PI * 2) * 0.7, Math.sin((i / TONGUES) * Math.PI * 2) * 1.1] as const), []);
  return (
    <>
      <group ref={smoke} visible={false}>
        {Array.from({ length: PUFFS }, (_, i) => (
          <mesh key={i} geometry={PUFF} material={i % 3 === 2 ? SMOKE_LIGHT : SMOKE} />
        ))}
      </group>
      <group ref={fire} visible={false}>
        {ring.map(([x, z], i) => (
          <mesh key={i} geometry={TONGUE} material={i % 2 ? FLAME_CORE : FLAME} position={[x * size, top - 0.35, z * size]} />
        ))}
      </group>
    </>
  );
}
