import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3, type Group } from "three";
import { WEAPON } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { getCameraView } from "../camera.ts";
import { GunModel, sightHeight } from "../GunModel.tsx";
import { view } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun } from "./Shooter.tsx";
import { recoil, stance } from "./runtime.ts";

// Súng trước mặt khi nhìn bằng mắt (góc thứ nhất): cầm thấp bên phải, lắc theo bước chân, trễ theo cú xoay chuột,
// giật như lò xo khi bắn (báng lùi vào vai, nòng hất lên, lệch ngang, nghiêng), nhún khi đáp đất; ngắm thì nâng
// lên giữa mắt cho thước ngắm trùng tâm màn hình; thay đạn thì hạ nòng xuống; dí sát tường thì dựng nòng lên, kéo
// súng về ngực. Vật liệu vẽ đè lên cảnh (viewMaterial) nên không bao giờ xuyên qua tường. Nhìn qua ống ngắm thì ẩn.

const HIP = new Vector3(0.24, -0.25, -0.5);
const offset = new Vector3();
const q = new Quaternion();
const tilt = new Quaternion();
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const axisZ = new Vector3(0, 0, 1);

/** Lò xo tắt dần (gần tới hạn) cho từng trục giật. */
interface Spring {
  x: number;
  v: number;
}
function step(sp: Spring, dt: number, k: number, c: number) {
  sp.v += (-k * sp.x - c * sp.v) * dt;
  sp.x += sp.v * dt;
}

export function ViewModel({ room }: { room: IslandRoom }) {
  const g = useRef<Group>(null);
  const s = useRef({
    aim: 0,
    bob: 0,
    drop: 0,
    wall: 0,
    sprint: 0,
    yawLag: 0,
    pitchLag: 0,
    lastYaw: 0,
    lastPitch: 0,
    fired: 0,
    back: { x: 0, v: 0 } as Spring,
    rise: { x: 0, v: 0 } as Spring,
    side: { x: 0, v: 0 } as Spring,
    roll: { x: 0, v: 0 } as Spring,
    land: { x: 0, v: 0 } as Spring,
    lastLand: 0,
  });
  const weapon = useRoomSnapshot(room, (st) => {
    const p = st.players.get(myId(room));
    const k = p?.kit;
    if (!k || !p.alive) return "";
    const slot = k.active;
    return slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "";
  });
  const def = WEAPON.get(weapon);
  const sight = def ? sightHeight(weapon) : 0;

  useFrame(({ camera }, rawDt) => {
    const m = g.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    const scoped = stance.aiming && stance.zoom >= 3;
    const show = !!def && getCameraView() === "first" && !scoped;
    m.visible = show;
    if (!show) {
      st.fired = recoil.fired;
      st.lastYaw = view.yaw;
      st.lastPitch = view.pitch;
      return;
    }
    const ease = (rate: number) => Math.min(1, dt * rate);
    st.wall += (stance.wall - st.wall) * ease(12);
    const aimTarget = stance.aiming ? 1 - st.wall : 0;
    st.aim += (aimTarget - st.aim) * ease(14);
    st.sprint += ((stance.sprinting && !stance.aiming ? 1 : 0) - st.sprint) * ease(8);
    if (stance.moving && !stance.airborne) st.bob += dt * (4 + stance.speed * 1.25);
    const reloading = gun.reloadUntil > performance.now();
    st.drop += ((reloading ? 1 : 0) - st.drop) * ease(8);

    // Phát bắn mới: đá lò xo. Ngắm thì giật gọn hơn (tì vai chắc).
    if (recoil.fired !== st.fired) {
      const n = recoil.fired - st.fired;
      st.fired = recoil.fired;
      const p = recoil.power * n * (1 - st.aim * 0.35);
      st.back.v += 1.6 * p;
      st.rise.v += 3.2 * p;
      st.side.v += (Math.random() - 0.5) * 1.6 * p;
      st.roll.v += (Math.random() - 0.5) * 4 * p;
    }
    // Đáp đất: súng trĩu xuống rồi bật về.
    if (stance.land > st.lastLand + 0.05) st.land.v -= stance.land * 2.2;
    st.lastLand = stance.land;
    step(st.back, dt, 320, 26);
    step(st.rise, dt, 240, 22);
    step(st.side, dt, 200, 20);
    step(st.roll, dt, 180, 18);
    step(st.land, dt, 140, 14);

    // Súng trễ theo cú xoay chuột một chút rồi đuổi kịp.
    st.yawLag += (view.yaw - st.lastYaw) * 0.6;
    st.pitchLag += (view.pitch - st.lastPitch) * 0.6;
    st.lastYaw = view.yaw;
    st.lastPitch = view.pitch;
    st.yawLag = Math.max(-0.3, Math.min(0.3, st.yawLag)) * Math.exp(-dt * 12);
    st.pitchLag = Math.max(-0.3, Math.min(0.3, st.pitchLag)) * Math.exp(-dt * 12);
    const bobAmt = (0.008 + Math.min(1, stance.speed / 7) * 0.02) * (1 - st.aim * 0.85) * (stance.moving && !stance.airborne ? 1 : 0.15);
    const hip = 1 - st.aim;
    // Hông → ngắm: đưa thước ngắm về giữa mắt. Sát tường: kéo súng về ngực, hạ thấp.
    offset.set(
      HIP.x * hip + Math.sin(st.bob) * bobAmt + st.yawLag * 0.3 * hip + st.side.x * 0.02 - st.wall * 0.06 - st.sprint * 0.06,
      HIP.y * hip - sight * st.aim + (Math.abs(Math.cos(st.bob)) - 0.5) * bobAmt - st.drop * 0.12 + st.pitchLag * 0.2 * hip + st.land.x * 0.05 - st.wall * 0.06 - st.sprint * 0.03,
      HIP.z * hip - 0.3 * st.aim + st.back.x * 0.05 + st.wall * 0.24 + st.sprint * 0.06,
    );
    offset.applyQuaternion(camera.quaternion);
    m.position.copy(camera.position).add(offset);
    // Nòng quay theo camera; súng GunModel chĩa +z nên xoay nửa vòng.
    // Giật: hất nòng lên, lệch, nghiêng. Chạy: ôm chéo. Sát tường: dựng nòng lên trời.
    q.copy(camera.quaternion);
    tilt.setFromAxisAngle(axisX, st.rise.x * 0.08 - st.drop * 0.6 + st.wall * 1.05 + st.land.x * -0.08);
    q.multiply(tilt);
    tilt.setFromAxisAngle(axisY, st.side.x * 0.04 + st.sprint * 0.55 + st.wall * 0.25);
    q.multiply(tilt);
    tilt.setFromAxisAngle(axisZ, st.roll.x * 0.05 + st.sprint * 0.25 + st.wall * 0.35);
    q.multiply(tilt);
    m.quaternion.copy(q);
    m.rotateY(Math.PI);
  });

  return <group ref={g}>{def && <GunModel weaponId={weapon} scale={1} view />}</group>;
}
