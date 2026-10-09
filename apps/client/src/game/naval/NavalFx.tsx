import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, InstancedMesh, MeshBasicMaterial, Object3D, SphereGeometry } from "three";
import { ballisticAt, mountCovers, NAVAL_WEAPONS, rayShip, shipClass, shipToWorld } from "@tentides/content";
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
      // Nước sủi trắng quanh thân, tiếng nổ nồi hơi.
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
      boom(m.x, 2, m.z, true);
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
  for (const part of cls.parts) {
    const m = part.mount;
    if (!m || m.weapon !== "aa" || (s.parts.get(part.id) ?? 100) <= 0 || !mountCovers(pose, m, s.aaYaw)) continue;
    const [px, py, pz] = shipToWorld(pose, m.pivot[0], m.pivot[1], m.pivot[2]);
    const yaw = s.aaYaw + (Math.random() - 0.5) * w.spread * 2;
    const pitch = Math.max(-0.2, s.aaPitch) + (Math.random() - 0.5) * w.spread * 2;
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
    effects.flashes.push({ x: ox, y: oy, z: oz, born: now });
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
    const off = room.onMessage(Messages.navalFx, (m: NavalFxMessage) => onFx(room, m));
    return () => {
      off();
      shells.length = 0;
    };
  }, [room]);

  useFrame(() => {
    const now = performance.now() / 1000;
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
