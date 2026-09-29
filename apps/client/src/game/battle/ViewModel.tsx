import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3, type Group } from "three";
import { WEAPON } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { getCameraView } from "../camera.ts";
import { GunModel, sightHeight } from "../GunModel.tsx";
import { look } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun } from "./Shooter.tsx";
import { recoil, stance } from "./runtime.ts";

// Súng trước mặt khi nhìn bằng mắt (góc thứ nhất): cầm thấp bên phải, lắc theo bước chân, giật lùi khi bắn,
// ngắm thì nâng lên giữa mắt cho thước ngắm trùng tâm màn hình; thay đạn thì hạ nòng xuống. Nhìn qua ống ngắm thì ẩn.

const HIP = new Vector3(0.24, -0.25, -0.5);
const offset = new Vector3();
const q = new Quaternion();
const tilt = new Quaternion();
const axisX = new Vector3(1, 0, 0);
const axisZ = new Vector3(0, 0, 1);

export function ViewModel({ room }: { room: IslandRoom }) {
  const g = useRef<Group>(null);
  const s = useRef({ aim: 0, bob: 0, drop: 0, yawLag: 0, pitchLag: 0, lastYaw: 0, lastPitch: 0 });
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
    if (!show) return;
    st.aim += ((stance.aiming ? 1 : 0) - st.aim) * Math.min(1, dt * 14);
    if (stance.moving && !stance.airborne) st.bob += dt * (stance.sprinting ? 13 : 9);
    const reloading = gun.reloadUntil > performance.now();
    st.drop += ((reloading ? 1 : 0) - st.drop) * Math.min(1, dt * 8);
    // Súng trễ theo cú xoay chuột một chút rồi đuổi kịp.
    st.yawLag += (look.yaw - st.lastYaw) * 0.6;
    st.pitchLag += (look.pitch - st.lastPitch) * 0.6;
    st.lastYaw = look.yaw;
    st.lastPitch = look.pitch;
    st.yawLag *= Math.exp(-dt * 12);
    st.pitchLag *= Math.exp(-dt * 12);
    const bobAmt = (stance.sprinting ? 0.03 : 0.012) * (1 - st.aim * 0.8);
    // Hông → ngắm: đưa thước ngắm về giữa mắt.
    offset.set(
      HIP.x * (1 - st.aim) + Math.sin(st.bob) * bobAmt + st.yawLag * 0.3,
      HIP.y * (1 - st.aim) - sight * st.aim + Math.abs(Math.cos(st.bob)) * bobAmt - st.drop * 0.12 + st.pitchLag * 0.2,
      HIP.z * (1 - st.aim) - 0.3 * st.aim + recoil.kick * 0.06,
    );
    offset.applyQuaternion(camera.quaternion);
    m.position.copy(camera.position).add(offset);
    // Nòng quay theo camera; súng GunModel chĩa +z nên xoay nửa vòng. Giật: hất nòng lên. Chạy: nghiêng súng.
    q.copy(camera.quaternion);
    tilt.setFromAxisAngle(axisX, recoil.kick * 0.12 - st.drop * 0.6);
    q.multiply(tilt);
    tilt.setFromAxisAngle(axisZ, stance.sprinting ? 0.35 : 0);
    q.multiply(tilt);
    m.quaternion.copy(q);
    m.rotateY(Math.PI);
  });

  return <group ref={g}>{def && <GunModel weaponId={weapon} scale={1} />}</group>;
}
