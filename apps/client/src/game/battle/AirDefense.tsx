import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { IGLA_LOCK, advanceLock, heliGround, lockReady, mapForState, raycastBoxes, raycastTerrain, type LockState } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { playLockBeep } from "../sound/air.ts";
import { menuOpen, stance } from "./runtime.ts";

// Tên lửa vác vai IGLA phía người bắn: cầm IGLA, ngắm (chuột phải) giữ tâm lên trực thăng địch đang bay trong tầm thì
// bắt đầu khoá: khung vuông vàng quanh mục tiêu, bíp ngắt quãng, báo server đều đặn (aaLock); giữ đủ ~2,4 giây thì
// khung đỏ, bíp cao liên tục — bắn lúc này tên lửa tự đuổi theo. Server tự tính lại thời gian khoá, tầm, đường ngắm.

/** Trạng thái khoá cho HUD đọc mỗi khung hình. */
export const aaHud = { active: false, target: "", x: 0.5, y: 0.5, on: false, progress: 0, locked: false };

const SEND_EVERY = 200;
const _cam = new Vector3();
const _fwd = new Vector3();
const _p = new Vector3();
const _o: [number, number, number] = [0, 0, 0];
const _d: [number, number, number] = [0, 0, 0];

export function AirDefense({ room }: { room: IslandRoom }) {
  const st = useRef({ lock: null as LockState | null, sendAt: 0, beepAt: 0 });
  useFrame(({ camera }) => {
    const s = st.current;
    const me = room.state.players.get(myId(room));
    const kit = me?.kit as unknown as Record<string, string> | undefined;
    const holding = !!me && me.alive && !me.vehicle && !!kit && kit[me.kit.active] === "igla";
    aaHud.active = holding;
    if (!holding || !stance.aiming || menuOpen() || room.state.phase !== "battle") {
      s.lock = null;
      aaHud.target = "";
      aaHud.on = false;
      aaHud.progress = 0;
      aaHud.locked = false;
      return;
    }
    const map = mapForState(room.state);
    camera.getWorldDirection(_fwd);
    _cam.copy(camera.position);
    let best = "";
    let bestCos = Math.cos(IGLA_LOCK.cone);
    for (const [vid, v] of room.state.vehicles) {
      if (v.kind !== "heli" || v.hp <= 0) continue;
      if (room.state.battleMode !== "solo" && me.team && v.team === me.team) continue;
      if (v.y - heliGround(map, v.x, v.z) < IGLA_LOCK.minAlt) continue;
      _p.set(v.x - _cam.x, v.y + 1.2 - _cam.y, v.z - _cam.z);
      const dist = _p.length();
      if (dist > IGLA_LOCK.range || dist < 2) continue;
      const cos = _p.dot(_fwd) / dist;
      if (cos < bestCos) continue;
      // Đường ngắm: đồi, nhà che thì không khoá được.
      _o[0] = _cam.x;
      _o[1] = _cam.y;
      _o[2] = _cam.z;
      _d[0] = _p.x / dist;
      _d[1] = _p.y / dist;
      _d[2] = _p.z / dist;
      const reach = dist - 3;
      if (raycastTerrain(map.world, _o, _d, reach) < reach || raycastBoxes(map.index, _o, _d, reach, true) < reach) continue;
      best = vid;
      bestCos = cos;
    }
    const now = performance.now();
    if (!best) {
      s.lock = null;
      aaHud.target = "";
      aaHud.on = false;
      aaHud.progress = 0;
      aaHud.locked = false;
      return;
    }
    s.lock = advanceLock(s.lock, best, now);
    if (now >= s.sendAt) {
      s.sendAt = now + SEND_EVERY;
      room.send(Messages.aaLock, { vid: best });
    }
    const locked = lockReady(s.lock, now) && s.lock.held >= IGLA_LOCK.time;
    if (now >= s.beepAt) {
      playLockBeep(locked);
      s.beepAt = now + (locked ? 140 : 320);
    }
    const v = room.state.vehicles.get(best)!;
    _p.set(v.x, v.y + 1.2, v.z).project(camera);
    aaHud.target = best;
    aaHud.on = _p.z < 1;
    aaHud.x = (_p.x + 1) / 2;
    aaHud.y = (1 - _p.y) / 2;
    aaHud.progress = Math.min(1, s.lock.held / IGLA_LOCK.time);
    aaHud.locked = locked;
  });
  return null;
}

/** Khung khoá mục tiêu của IGLA trên màn hình. */
export function AaHud() {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      el.style.display = aaHud.active ? "" : "none";
      if (!aaHud.active) return;
      if (box.current) {
        box.current.style.display = aaHud.on ? "" : "none";
        box.current.style.left = `${(aaHud.x * 100).toFixed(2)}%`;
        box.current.style.top = `${(aaHud.y * 100).toFixed(2)}%`;
        // Khung co lại dần khi khoá gần chín.
        box.current.style.transform = `translate(-50%, -50%) scale(${(1.6 - aaHud.progress * 0.6).toFixed(3)})`;
        box.current.classList.toggle("locked", aaHud.locked);
      }
      if (label.current) label.current.textContent = aaHud.locked ? "ĐÃ KHOÁ — BẮN!" : aaHud.target ? `Đang khoá… ${Math.round(aaHud.progress * 100)}%` : "Ngắm (chuột phải) giữ tâm lên trực thăng địch để khoá";
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={root} className="b-aa" style={{ display: "none" }}>
      <div ref={box} className="b-aa-box" />
      <span ref={label} className="b-aa-label" />
    </div>
  );
}
