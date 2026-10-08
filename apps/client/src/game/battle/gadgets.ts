import { Vector3, type Camera } from "three";
import { BULLET_GRAVITY, GADGETS, M203, REPAIR, SPOT, gadgetIn, isSoldierClass, vehicleSpec, CLASSES, type GadgetId } from "@tentides/content";
import { Messages, type GadgetMessage, type PlayerState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { localAim, localPosition, shake } from "../shared.ts";
import { view } from "../input.ts";
import { playInject, playLauncher, playPlace, playWrench } from "../sound/gadgets.ts";
import { playDryFire } from "../sound/guns.ts";
import { enemyAlong } from "./comms.ts";
import { recoil, stance } from "./runtime.ts";
import { physicsProbe } from "./surface.ts";

// Khí tài lớp lính trên máy mình: phím 0 rút khí tài (bấm lần nữa đổi sang khí tài thứ hai của lớp), chuột trái dùng.
// Máy mình diễn ngay (tiếng, động tác), server kiểm tra lại rồi mới tính (Adrenaline, đạn M203, dấu ống nhòm, hộp
// đạn, bao cát, sửa xe, mìn chống tăng).

export const GADGET_KEY_LABEL = "0";

/** Chế độ có lớp lính không (sinh tồn solo thì không). */
export function gadgetsOn(room: IslandRoom): boolean {
  const m = room.state.battleMode;
  return m === "war" || m === "squad";
}

/** Khí tài đang cầm trên tay (rỗng nếu đang cầm thứ khác). */
export function heldGadget(room: IslandRoom, p: PlayerState | undefined): GadgetId | "" {
  if (!p || !gadgetsOn(room)) return "";
  const slot = p.kit.active;
  return slot === "gadget1" || slot === "gadget2" ? gadgetIn(p.gear.cls, slot) : "";
}

/** Các ô khí tài của mình: khí tài, còn bao nhiêu lượt (−1 là không tính lượt). */
export function gadgetSlots(room: IslandRoom, p: PlayerState | undefined): { slot: "gadget1" | "gadget2"; id: GadgetId; left: number }[] {
  if (!p || !gadgetsOn(room) || !isSoldierClass(p.gear.cls)) return [];
  return CLASSES[p.gear.cls].gadgets.map((id, k) => ({ slot: k === 0 ? ("gadget1" as const) : ("gadget2" as const), id, left: GADGETS[id].charges ? (k === 0 ? p.gear.n1 : p.gear.n2) : -1 }));
}

/** Trạng thái khí tài trên máy mình (đọc ở HUD): hết thời gian chờ lúc nào, đang sửa xe nào. */
export const gadgetFx = {
  readyAt: {} as Partial<Record<GadgetId, number>>,
  repairVid: "",
  repairAt: 0,
};

const _dir = new Vector3();

/** Xe phe mình (hay chưa của ai) còn hư, ở trong tầm mỏ lết; rỗng nếu không có. */
export function repairTarget(room: IslandRoom, team: string): string {
  let best = "";
  let bestD = REPAIR.reach + 0.6;
  for (const [vid, v] of room.state.vehicles) {
    if (v.hp <= 0 || (v.team && v.team !== team)) continue;
    const spec = vehicleSpec(v.kind);
    if (v.hp >= spec.hp) continue;
    const dx = localPosition.x - v.x;
    const dz = localPosition.z - v.z;
    const c = Math.cos(v.rotY);
    const s = Math.sin(v.rotY);
    const side = Math.max(0, Math.abs(dx * c - dz * s) - spec.half[0]);
    const along = Math.max(0, Math.abs(dx * s + dz * c) - spec.half[2]);
    const d = Math.hypot(side, along);
    if (d < bestD && Math.abs(localPosition.y - v.y) < 3) {
      bestD = d;
      best = vid;
    }
  }
  return best;
}

/**
 * Mỗi khung hình khi đang cầm khí tài `id` (Shooter gọi): `pressed` là vừa bấm chuột trái, `held` đang giữ, `aim`
 * đang giữ chuột phải. Ống nhòm, M203 thì chuột phải ngắm; còn lại bấm là dùng.
 */
export function gadgetFrame(room: IslandRoom, me: PlayerState, id: GadgetId, camera: Camera, input: { pressed: boolean; held: boolean; aim: boolean }, now: number, ready: boolean) {
  // Ngắm: ống nhòm phóng to (nhìn qua ống, ẩn tay); M203 kéo súng lên ngắm như thường.
  const aimable = id === "binoculars" || id === "m203";
  stance.aiming = aimable && input.aim && ready && !stance.sprinting;
  stance.zoom = id === "binoculars" ? SPOT.zoom : id === "m203" ? 1.3 : 1;
  stance.scoped = id === "binoculars";
  stance.spread = 0.03;
  const send = (m: GadgetMessage) => room.send(Messages.gadget, m);
  if (id === "repair") {
    if (!input.held || !ready) {
      gadgetFx.repairVid = "";
      return;
    }
    const vid = repairTarget(room, me.team);
    gadgetFx.repairVid = vid;
    if (!vid || now - gadgetFx.repairAt < 250) return;
    gadgetFx.repairAt = now;
    send({ use: "repair", target: vid });
    const v = room.state.vehicles.get(vid);
    if (v) playWrench({ x: v.x, y: v.y + 1, z: v.z });
    stance.meleeAt = now;
    return;
  }
  if (!input.pressed || !ready) return;
  if (now < (gadgetFx.readyAt[id] ?? 0)) {
    playDryFire();
    return;
  }
  camera.getWorldDirection(_dir);
  switch (id) {
    case "syringe":
      send({ use: "syringe" });
      playInject();
      stance.throwAt = now;
      break;
    case "m203": {
      if (stance.sprinting) return;
      // Điểm đang nhắm (dò tia từ camera), rồi bắn từ trước ngực tới đó, ngóc nòng bù độ rơi theo cự ly.
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const hit = physicsProbe.cast?.(cx + _dir.x * 0.4, cy + _dir.y * 0.4, cz + _dir.z * 0.4, _dir.x, _dir.y, _dir.z, 200) ?? null;
      const t = hit ? hit.t + 0.4 : 80;
      const px = cx + _dir.x * t;
      const py = cy + _dir.y * t;
      const pz = cz + _dir.z * t;
      const o: [number, number, number] = [localPosition.x + _dir.x * 0.6, localPosition.y + (stance.prone ? 0.35 : stance.crouching ? 1.05 : 1.45), localPosition.z + _dir.z * 0.6];
      let dx = px - o[0];
      let dy = py - o[1];
      let dz = pz - o[2];
      const dist = Math.hypot(dx, dy, dz) || 1;
      const flat = Math.hypot(dx, dz) || 1;
      const lift = Math.atan((0.5 * BULLET_GRAVITY * Math.min(90, Math.max(4, dist))) / (M203.velocity * M203.velocity));
      const pitch = Math.atan2(dy, flat) + lift;
      dx /= flat;
      dz /= flat;
      dy = Math.tan(pitch);
      send({ use: "m203", o, d: [dx, dy, dz] });
      playLauncher(null);
      recoil.fired++;
      recoil.vPitch += 0.9;
      recoil.vRoll += 0.4;
      recoil.kick = 1;
      shake.amount = Math.min(0.6, shake.amount + 0.12);
      localAim.yaw = view.yaw;
      localAim.at = now;
      break;
    }
    case "binoculars": {
      const me2 = myId(room);
      const target = enemyAlong(room, me2, camera.position.x, camera.position.y, camera.position.z, _dir.x, _dir.y, _dir.z, SPOT.range);
      if (!target) {
        playDryFire();
        return;
      }
      send({ use: "binoculars", target });
      break;
    }
    case "ammobox":
    case "sandbag":
    case "atmine":
      send({ use: id });
      playPlace({ x: localPosition.x, y: localPosition.y, z: localPosition.z }, id === "ammobox" ? "box" : id === "sandbag" ? "sandbag" : "mine");
      stance.throwAt = now;
      break;
  }
  gadgetFx.readyAt[id] = now + GADGETS[id].cooldown * 1000;
}
