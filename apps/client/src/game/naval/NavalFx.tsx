import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, InstancedMesh, MeshBasicMaterial, Object3D, SphereGeometry } from "three";
import { aaAimPoint, aaEye, ballisticAt, mountCovers, NAVAL_WEAPONS, rayShip, shipClass, shipToWorld } from "@tentides/content";
import { Messages, type NavalFxMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { localPosition, shake } from "../shared.ts";
import { effects } from "../battle/runtime.ts";
import { embers, puffs } from "../battle/gpuParticles.ts";
import { spawnDebris } from "../battle/Debris.tsx";
import { playCannon, playExplosion, playGunshot } from "../sound/guns.ts";
import { playFlares, playMissileLaunch } from "../sound/air.ts";
import { play } from "../sound/sfx.ts";
import { shipPose } from "./navalRuntime.ts";

// Hiệu ứng hải chiến: đạn pháo bay cầu vồng (vẽ theo đường đạn đạo từ lúc bắn, dừng khi chạm tàu hay mặt nước), lửa
// khói đầu nòng, cột nước khi trượt, nổ khi trúng, tia lửa, bộ phận vỡ, khói phóng tên lửa, mồi nhử chớp sáng, bom
// chìm nổ tung vòm nước, đạn vạch phòng không (từ bộ đếm loạt bắn của tàu) và của máy bay. Tiếng nổ to (cột lửa khói
// khi trúng boong) server đã gửi qua boom như đạn pháo thường.

interface Shell {
  o: [number, number, number];
  v: [number, number, number];
  born: number;
  weapon: string;
  from: string;
  smoked: number;
}

const MAX_SHELLS = 96;
const shells: Shell[] = [];
/** Lần cuối phát tiếng pháo từng ụ (một loạt ba nòng chỉ một tiếng). */
const lastBang = new Map<string, number>();

function near(x: number, y: number, z: number): number {
  return Math.hypot(x - localPosition.x, y - localPosition.y, z - localPosition.z);
}

/** Cột nước dựng đứng (pháo, ngư lôi, máy bay rơi): bọt trắng phụt cao rồi rơi, vòng bọt toả ra mặt nước. */
export function waterColumn(x: number, z: number, size: number) {
  const n = Math.round(10 + size * 10);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 1.2;
    const up = (6 + Math.random() * 10) * size;
    puffs.push({
      x: x + Math.cos(a) * r,
      y: 0.4,
      z: z + Math.sin(a) * r,
      vx: Math.cos(a) * size * 0.8,
      vy: up,
      vz: Math.sin(a) * size * 0.8,
      size: 0.9 * size + 0.4,
      grow: 1.6,
      life: 1.6 + Math.random() * 1.4 + size * 0.4,
      age: 0,
      r: 0.92,
      g: 0.95,
      b: 0.98,
      alpha: 0.65,
      dense: false,
    });
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    puffs.push({
      x,
      y: 0.25,
      z,
      vx: Math.cos(a) * 4 * size,
      vy: 0.2,
      vz: Math.sin(a) * 4 * size,
      size: 1.2 * size,
      grow: 2.2,
      life: 2.5 + size,
      age: 0,
      r: 0.9,
      g: 0.94,
      b: 0.97,
      alpha: 0.45,
      dense: false,
    });
  }
}

/** Lửa khói đầu nòng pháo lớn: chớp cam, cụm khói xám dày bay theo hướng bắn. */
function muzzleBlast(x: number, y: number, z: number, d: readonly number[], big: boolean) {
  const s = big ? 1.6 : 0.8;
  effects.flashes.push({ x, y, z, born: performance.now() / 1000, lightOnly: true });
  for (let k = 0; k < (big ? 12 : 6); k++)
    puffs.push({
      x,
      y,
      z,
      vx: d[0]! * (8 + Math.random() * 10) * s,
      vy: d[1]! * 8 * s + Math.random(),
      vz: d[2]! * (8 + Math.random() * 10) * s,
      size: 0.8 * s,
      grow: 0.8,
      life: 0.3,
      age: 0,
      r: 1,
      g: 0.6,
      b: 0.2,
      alpha: 0.9,
      dense: false,
    });
  for (let k = 0; k < (big ? 14 : 7); k++)
    puffs.push({
      x,
      y,
      z,
      vx: d[0]! * (3 + Math.random() * 6) * s + (Math.random() - 0.5) * 2,
      vy: d[1]! * 3 + Math.random(),
      vz: d[2]! * (3 + Math.random() * 6) * s + (Math.random() - 0.5) * 2,
      size: 1.2 * s,
      grow: 1.5,
      life: 3 + Math.random() * 2,
      age: 0,
      r: 0.62,
      g: 0.6,
      b: 0.58,
      alpha: 0.5,
      dense: false,
    });
}

function boom(x: number, y: number, z: number, big: boolean) {
  effects.blasts.push({ kind: big ? "mine" : "frag", x, y, z, born: performance.now() / 1000, big, seed: Math.random() * 10 });
  playExplosion({ x, y, z }, big ? "mine" : "frag");
  const d = near(x, y, z);
  shake.amount = Math.min(1.4, shake.amount + Math.max(0, (big ? 1.4 : 0.8) - d / 40));
}

function sparks(x: number, y: number, z: number, n: number) {
  for (let k = 0; k < n; k++)
    embers.push({
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * 9,
      vy: 2 + Math.random() * 7,
      vz: (Math.random() - 0.5) * 9,
      age: 0,
      life: 0.5 + Math.random() * 0.8,
      size: 0.1,
    });
}

/** Tàu đang nổ dây chuyền lúc chìm: hầm đạn nổ tung, rồi từng tiếng nổ dọc thân, cột khói đen bốc cao. */
interface Sinker {
  ship: string;
  born: number;
  next: number;
  x: number;
  z: number;
  smoke: number;
}
const sinkers: Sinker[] = [];
/** Thời gian nổ dây chuyền, thời gian cột khói còn bốc (giây). */
const SINK_BLASTS = 9;
const SINK_SMOKE = 40;

function startSink(ship: string, x: number, z: number) {
  const now = performance.now() / 1000;
  for (let i = sinkers.length - 1; i >= 0; i--) if (sinkers[i]!.ship === ship) sinkers.splice(i, 1);
  sinkers.push({ ship, born: now, next: now, x, z, smoke: now });
}

/** Điểm ngẫu nhiên trên boong / trong thân tàu `ship` (toạ độ thế giới), theo dáng tàu đang vẽ. */
function hullPoint(sk: Sinker, along: number): [number, number, number] {
  const pose = shipPose(sk.ship);
  const s = room0?.state.naval?.ships.get(sk.ship);
  if (!pose || !s) return [sk.x, 3, sk.z];
  const cls = shipClass(s.cls);
  const lz = along * cls.length * 0.45;
  const lx = (Math.random() - 0.5) * cls.beam * 0.7;
  const ly = cls.deck * (0.3 + Math.random() * 0.9);
  const p = shipToWorld(pose, lx, ly, lz);
  sk.x = pose.x;
  sk.z = pose.z;
  return [p[0], Math.max(0.8, p[1]), p[2]];
}

/** Cầu lửa to: lõi cam chói phồng nhanh, vỏ khói đen cuộn lên, tia lửa, mảnh thép văng. */
function fireball(x: number, y: number, z: number, size: number) {
  effects.flashes.push({ x, y, z, born: performance.now() / 1000 });
  for (let k = 0; k < Math.round(14 * size); k++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.random() * 1.3;
    const v = (4 + Math.random() * 9) * size;
    puffs.push({
      x,
      y,
      z,
      vx: Math.cos(a) * Math.cos(e) * v,
      vy: Math.sin(e) * v + 2 * size,
      vz: Math.sin(a) * Math.cos(e) * v,
      size: 1.6 * size,
      grow: 1.4,
      life: 0.6 + Math.random() * 0.6,
      age: 0,
      r: 1,
      g: 0.45 + Math.random() * 0.3,
      b: 0.1,
      alpha: 0.95,
      dense: false,
    });
  }
  for (let k = 0; k < Math.round(12 * size); k++) {
    const a = Math.random() * Math.PI * 2;
    const v = (1.5 + Math.random() * 4) * size;
    puffs.push({
      x: x + Math.cos(a) * size,
      y: y + Math.random() * 2 * size,
      z: z + Math.sin(a) * size,
      vx: Math.cos(a) * v,
      vy: 3 + Math.random() * 5 * size,
      vz: Math.sin(a) * v,
      size: 2.2 * size,
      grow: 2.2,
      life: 5 + Math.random() * 5,
      age: 0,
      r: 0.09,
      g: 0.08,
      b: 0.08,
      alpha: 0.75,
      dense: true,
    });
  }
  for (let k = 0; k < Math.round(30 * size); k++)
    embers.push({
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * 22 * size,
      vy: 5 + Math.random() * 18 * size,
      vz: (Math.random() - 0.5) * 22 * size,
      age: 0,
      life: 1 + Math.random() * 2,
      size: 0.16,
    });
}

/** Mỗi khung hình: tiếng nổ dọc thân tàu đang chìm (dày lúc đầu, thưa dần), cột khói đen lâu tan. */
function tickSinks(now: number) {
  for (let i = sinkers.length - 1; i >= 0; i--) {
    const sk = sinkers[i]!;
    const t = now - sk.born;
    if (t > SINK_SMOKE) {
      sinkers.splice(i, 1);
      continue;
    }
    const far = Math.hypot(sk.x - localPosition.x, sk.z - localPosition.z) > 1400;
    if (t < SINK_BLASTS && now >= sk.next) {
      if (sk.next === sk.born) {
        // Hầm đạn nổ: ba quả cầu lửa khổng lồ cùng lúc, rung mạnh.
        for (const along of [-0.55, 0.05, 0.6]) {
          const [x, y, z] = hullPoint(sk, along);
          if (!far) fireball(x, y + 4, z, 3.2);
          boom(x, y, z, true);
          spawnDebris(x, y, z, true);
          spawnDebris(x, y + 3, z, true);
        }
        shake.amount = Math.min(2, shake.amount + Math.max(0, 2 - near(sk.x, 5, sk.z) / 200));
        sk.next = now + 0.25;
      } else {
        const [x, y, z] = hullPoint(sk, Math.random() * 2 - 1);
        const big = Math.random() < 0.45;
        if (!far) fireball(x, y, z, big ? 1.8 + Math.random() : 0.9 + Math.random() * 0.6);
        boom(x, y, z, big);
        if (Math.random() < 0.6) spawnDebris(x, y, z, big);
        sparks(x, y, z, 20);
        // Nổ dồn dập lúc đầu, thưa dần khi tàu ngập.
        sk.next = now + 0.12 + Math.random() * (0.25 + t * 0.09);
      }
    }
    // Cột khói đen bốc cao từ xác tàu, nhạt dần.
    if (!far && now - sk.smoke > 0.09) {
      sk.smoke = now;
      const fade = 1 - t / SINK_SMOKE;
      const [x, , z] = hullPoint(sk, Math.random() * 1.4 - 0.7);
      puffs.push({
        x,
        y: 2,
        z,
        vx: (Math.random() - 0.5) * 1.5 + 1.2,
        vy: 6 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 1.5,
        size: 4 + Math.random() * 3,
        grow: 2.6,
        life: 10 + Math.random() * 8,
        age: 0,
        r: 0.07,
        g: 0.065,
        b: 0.065,
        alpha: 0.6 * fade + 0.1,
        dense: true,
      });
      if (t < SINK_BLASTS * 2)
        puffs.push({
          x,
          y: 1.5,
          z,
          vx: 0,
          vy: 2 + Math.random() * 2,
          vz: 0,
          size: 2.5,
          grow: 1,
          life: 0.9,
          age: 0,
          r: 1,
          g: 0.5,
          b: 0.12,
          alpha: 0.85,
          dense: false,
        });
    }
  }
}

/** Phòng đang mở (để tính dáng tàu cho tiếng nổ dây chuyền). */
let room0: IslandRoom | null = null;

function onFx(room: IslandRoom, m: NavalFxMessage) {
  const now = performance.now() / 1000;
  const mine = (() => {
    const me = room.state.players.get(myId(room));
    return !!me && me.team === m.ship;
  })();
  switch (m.k) {
    case "shell": {
      const v = m.v ?? [0, 0, 0];
      if (shells.length < MAX_SHELLS) shells.push({ o: [m.x, m.y, m.z], v, born: now, weapon: m.weapon ?? "bbGun", from: m.ship ?? "", smoked: 0 });
      const sp = Math.hypot(...v) || 1;
      const big = m.weapon === "bbGun";
      muzzleBlast(m.x, m.y, m.z, [v[0] / sp, v[1] / sp, v[2] / sp], big);
      const key = `${m.ship}:${m.part}`;
      if (now - (lastBang.get(key) ?? 0) > 0.4) {
        lastBang.set(key, now);
        const d = near(m.x, m.y, m.z);
        playCannon({ x: m.x, y: m.y, z: m.z }, d < 25);
        shake.amount = Math.min(1.2, shake.amount + Math.max(0, (big ? 1 : 0.4) - d / 60));
      }
      break;
    }
    case "bomb":
      if (shells.length < MAX_SHELLS) shells.push({ o: [m.x, m.y, m.z], v: m.v ?? [0, 0, 0], born: now, weapon: "bomb", from: "", smoked: 0 });
      break;
    case "splash": {
      const size =
        m.weapon === "bbGun" ? 2.2 : m.weapon === "ddGun" ? 1.2 : m.weapon === "plane" ? 1.8 : m.weapon === "bomb" ? 2 : m.weapon === "missile" ? 1.6 : 1.4;
      waterColumn(m.x, m.z, size);
      play("splash", { at: { x: m.x, y: 0, z: m.z }, volume: Math.min(1, 0.5 + size * 0.25) });
      if (m.weapon === "missile" || m.weapon === "bomb") boom(m.x, 0.5, m.z, true);
      break;
    }
    case "hit":
      // Nổ to (cột lửa khói) server đã gửi qua boom; ở đây thêm tia lửa văng, mảnh thép.
      sparks(m.x, m.y, m.z, 18);
      spawnDebris(m.x, m.y, m.z, m.weapon === "bbGun" || m.weapon === "missile" || m.weapon === "bomb");
      break;
    case "blast": {
      const under = m.y < 0.6;
      if (under) {
        waterColumn(m.x, m.z, m.weapon === "torpedo" || m.weapon === "gtorpedo" ? 2.6 : 1.4);
        play("splash", { at: { x: m.x, y: 0, z: m.z }, volume: 1 });
      }
      boom(m.x, Math.max(0.5, m.y), m.z, true);
      if (m.ship) sparks(m.x, Math.max(0.5, m.y), m.z, 24);
      break;
    }
    case "fire":
      sparks(m.x, m.y, m.z, 10);
      for (let k = 0; k < 6; k++)
        puffs.push({
          x: m.x,
          y: m.y + 0.5,
          z: m.z,
          vx: (Math.random() - 0.5) * 2,
          vy: 2 + Math.random() * 2,
          vz: (Math.random() - 0.5) * 2,
          size: 1,
          grow: 1,
          life: 0.8,
          age: 0,
          r: 1,
          g: 0.45,
          b: 0.1,
          alpha: 0.8,
          dense: false,
        });
      break;
    case "wreck":
      boom(m.x, m.y, m.z, false);
      spawnDebris(m.x, m.y, m.z, true);
      sparks(m.x, m.y, m.z, 30);
      break;
    case "sink": {
      // Nước sủi trắng quanh thân, rồi cả con tàu nổ dây chuyền (xem `tickSinks`).
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 40;
        puffs.push({
          x: m.x + Math.cos(a) * r,
          y: 0.3,
          z: m.z + Math.sin(a) * r,
          vx: 0,
          vy: 1 + Math.random() * 3,
          vz: 0,
          size: 2,
          grow: 2,
          life: 4 + Math.random() * 3,
          age: 0,
          r: 0.9,
          g: 0.93,
          b: 0.95,
          alpha: 0.5,
          dense: false,
        });
      }
      if (m.ship) startSink(m.ship, m.x, m.z);
      else boom(m.x, 2, m.z, true);
      break;
    }
    case "launch": {
      const at = { x: m.x, y: m.y, z: m.z };
      if (m.weapon === "missile") {
        playMissileLaunch(at);
        for (let k = 0; k < 26; k++)
          puffs.push({
            x: m.x,
            y: m.y,
            z: m.z,
            vx: (Math.random() - 0.5) * 6,
            vy: Math.random() * 3,
            vz: (Math.random() - 0.5) * 6,
            size: 1.6,
            grow: 2.2,
            life: 4 + Math.random() * 3,
            age: 0,
            r: 0.85,
            g: 0.84,
            b: 0.82,
            alpha: 0.6,
            dense: false,
          });
      } else if (m.weapon === "plane") {
        // Hơi nước máy phóng phụt dọc đường băng.
        for (let k = 0; k < 20; k++)
          puffs.push({
            x: m.x,
            y: m.y - 1,
            z: m.z,
            vx: (Math.random() - 0.5) * 3,
            vy: 1 + Math.random() * 2,
            vz: (Math.random() - 0.5) * 3,
            size: 1.2,
            grow: 1.6,
            life: 2,
            age: 0,
            r: 0.95,
            g: 0.95,
            b: 0.97,
            alpha: 0.5,
            dense: false,
          });
        play("whoosh", { at, volume: 1 });
      } else if (m.weapon === "depth") {
        play("splash", { at, volume: 0.6 });
      } else {
        // Ngư lôi rời ống: tiếng nén khí, bọt nước bên mạn.
        play("bubbles", { at, volume: mine ? 1 : 0.7 });
      }
      break;
    }
    case "depth":
      // Bom chìm nổ: vòm nước trắng bùng lên rồi sụp xuống.
      waterColumn(m.x, m.z, 2.4);
      for (let k = 0; k < 18; k++) {
        const a = Math.random() * Math.PI * 2;
        puffs.push({
          x: m.x,
          y: 0.5,
          z: m.z,
          vx: Math.cos(a) * 6,
          vy: 8 + Math.random() * 6,
          vz: Math.sin(a) * 6,
          size: 2.6,
          grow: 1.4,
          life: 2.2,
          age: 0,
          r: 0.95,
          g: 0.97,
          b: 1,
          alpha: 0.6,
          dense: false,
        });
      }
      playExplosion({ x: m.x, y: 0, z: m.z }, "mine");
      shake.amount = Math.min(1, shake.amount + Math.max(0, 0.8 - near(m.x, 0, m.z) / 60));
      break;
    case "decoy":
      playFlares({ x: m.x, y: m.y, z: m.z });
      for (let k = 0; k < 24; k++)
        embers.push({
          x: m.x,
          y: m.y,
          z: m.z,
          vx: (Math.random() - 0.5) * 22,
          vy: Math.random() * 10,
          vz: (Math.random() - 0.5) * 22,
          age: 0,
          life: 2 + Math.random() * 2,
          size: 0.35,
        });
      break;
    case "down":
      boom(m.x, m.y, m.z, true);
      spawnDebris(m.x, m.y, m.z, true);
      for (let k = 0; k < 16; k++)
        puffs.push({
          x: m.x,
          y: m.y,
          z: m.z,
          vx: (Math.random() - 0.5) * 10,
          vy: (Math.random() - 0.5) * 6,
          vz: (Math.random() - 0.5) * 10,
          size: 2,
          grow: 2,
          life: 5,
          age: 0,
          r: 0.12,
          g: 0.11,
          b: 0.1,
          alpha: 0.7,
          dense: false,
        });
      break;
    case "jet": {
      const d = m.v ?? [0, 0, 1];
      const reach = NAVAL_WEAPONS.jetGun.range;
      for (const side of [-1, 1]) {
        const yaw = Math.atan2(d[0], d[2]);
        const ox = m.x + Math.cos(yaw) * side * 2.2 + d[0] * 4;
        const oz = m.z - Math.sin(yaw) * side * 2.2 + d[2] * 4;
        effects.tracers.push({
          ox,
          oy: m.y,
          oz,
          ex: ox + d[0] * reach,
          ey: m.y + d[1] * reach - 2,
          ez: oz + d[2] * reach,
          born: now,
          mine: false,
          speed: NAVAL_WEAPONS.jetGun.speed,
        });
      }
      if (Math.random() < 0.5) playGunshot("m249", { x: m.x, y: m.y, z: m.z }, near(m.x, m.y, m.z) < 6);
      break;
    }
  }
}

/** Đạn vạch phòng không: mỗi khi bộ đếm loạt bắn của tàu tăng, mọi ổ còn tốt quay tới hướng ngắm nhả một viên. */
function aaVolley(room: IslandRoom, team: string) {
  const s = room.state.naval.ships.get(team);
  const pose = shipPose(team);
  if (!s || !pose) return;
  const cls = shipClass(s.cls);
  const w = NAVAL_WEAPONS.aa;
  const now = performance.now() / 1000;
  let first = true;
  // Như server: mọi ổ bắn vào điểm hội tụ trên tia ngắm.
  const eye = shipToWorld(pose, ...aaEye(cls));
  const air = [...room.state.naval.units.values()].filter((u) => u.team !== s.team && (u.kind === "missile" || u.kind === "plane"));
  const aim = aaAimPoint(eye, s.aaYaw, Math.max(-0.2, s.aaPitch), air);
  for (const part of cls.parts) {
    const m = part.mount;
    if (!m || m.weapon !== "aa" || (s.parts.get(part.id) ?? 100) <= 0) continue;
    const [px, py, pz] = shipToWorld(pose, m.pivot[0], m.pivot[1], m.pivot[2]);
    const toYaw = Math.atan2(aim[0] - px, aim[2] - pz);
    if (!mountCovers(pose, m, toYaw)) continue;
    const yaw = toYaw + (Math.random() - 0.5) * w.spread * 2;
    const pitch = Math.max(-0.2, Math.atan2(aim[1] - py, Math.hypot(aim[0] - px, aim[2] - pz))) + (Math.random() - 0.5) * w.spread * 2;
    const cp = Math.cos(pitch);
    const d = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    const ox = px + d[0]! * m.barrel;
    const oy = py + d[1]! * m.barrel;
    const oz = pz + d[2]! * m.barrel;
    effects.tracers.push({
      ox,
      oy,
      oz,
      ex: ox + d[0]! * w.range,
      ey: oy + d[1]! * w.range - 25,
      ez: oz + d[2]! * w.range,
      born: now,
      mine: false,
      speed: w.speed,
    });
    effects.flashes.push({ x: ox, y: oy, z: oz, born: now, noLight: true });
    if (first && Math.random() < 0.6) playGunshot("dp28", { x: ox, y: oy, z: oz }, near(ox, oy, oz) < 8);
    first = false;
  }
}

const _o = new Object3D();

export function NavalFx({ room }: { room: IslandRoom }) {
  const mesh = useRef<InstancedMesh>(null);
  const seen = useRef(new Map<string, number>());
  const geometry = useMemo(() => new SphereGeometry(1, 8, 6), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: "#ffb35a", blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(() => {
    // Màu chói để bloom toả quầng (vượt 1 sau khi tắt tone map).
    material.color.multiplyScalar(4);
  }, [material]);
  useEffect(() => {
    room0 = room;
    const off = room.onMessage(Messages.navalFx, (m: NavalFxMessage) => onFx(room, m));
    return () => {
      off();
      shells.length = 0;
      sinkers.length = 0;
      room0 = null;
    };
  }, [room]);

  useFrame(() => {
    const now = performance.now() / 1000;
    tickSinks(now);
    // Đạn vạch phòng không theo bộ đếm loạt bắn.
    room.state.naval?.ships.forEach((s, id) => {
      const last = seen.current.get(id);
      seen.current.set(id, s.aaShots);
      if (last !== undefined && last !== s.aaShots) aaVolley(room, id);
    });
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i]!;
      const t = now - sh.born;
      const p = ballisticAt(sh.o, sh.v, t);
      const prev = ballisticAt(sh.o, sh.v, Math.max(0, t - 1 / 30));
      let done = p[1] < 0 || t > 30;
      // Chạm thân tàu (vẽ dừng đúng chỗ; nổ, cột lửa do server gửi).
      if (!done) {
        const seg = [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]] as const;
        const len = Math.hypot(...seg);
        if (len > 1e-3)
          room.state.naval?.ships.forEach((s, id) => {
            if (done || s.sunk || (id === sh.from && t < 1.5)) return;
            const pose = shipPose(id);
            if (pose && rayShip(shipClass(s.cls), pose, prev, [seg[0] / len, seg[1] / len, seg[2] / len], len)) done = true;
          });
      }
      if (done) {
        shells.splice(i, 1);
        continue;
      }
      // Vệt khói mỏng sau đạn pháo chính.
      if (sh.weapon === "bbGun" && t - sh.smoked > 0.05) {
        sh.smoked = t;
        puffs.push({
          x: p[0],
          y: p[1],
          z: p[2],
          vx: 0,
          vy: 0.2,
          vz: 0,
          size: 0.5,
          grow: 0.8,
          life: 1.4,
          age: 0,
          r: 0.8,
          g: 0.8,
          b: 0.8,
          alpha: 0.22,
          dense: false,
        });
      }
      if (n >= MAX_SHELLS) continue;
      const dist = near(p[0], p[1], p[2]);
      const r = sh.weapon === "bomb" ? 0.45 : (sh.weapon === "bbGun" ? 0.45 : 0.25) * Math.max(1, dist / 80);
      _o.position.set(p[0], p[1], p[2]);
      _o.scale.setScalar(r);
      _o.updateMatrix();
      m.setMatrixAt(n++, _o.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_SHELLS]} frustumCulled={false} />;
}
