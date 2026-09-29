import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { Vector3 } from "three";
import { HEALS, WEAPON, type WeaponDef } from "@tentides/content";
import { Messages, type FireMessage, type HitMessage, type HurtMessage, type KitState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { clampPitch, getCameraView, toggleCameraView } from "../camera.ts";
import { isTyping, keys, look } from "../input.ts";
import { getSettings } from "../settings.ts";
import { localAim, localMotion, localPosition, shake } from "../shared.ts";
import { playArmorHit, playDraw, playDryFire, playHeal, playHitMarker, playHurt, playReload, playThrow, playGunshot, playBolt, playImpact } from "../sound/guns.ts";
import { bodies, effects, getBattleHud, localAvatar, localBody, menuOpen, recoil, setBattleHud, stance } from "./runtime.ts";
import { muzzleOffset } from "../GunModel.tsx";

// Bắn súng trên máy mình: chuột trái bắn (giữ để bắn liên thanh), chuột phải ngắm (ống ngắm thì phóng to),
// R thay đạn, 1–3 đổi súng, 4–6 lựu đạn / bom khói / mìn, 7–8 băng gạc / hộp cứu thương, lăn chuột đổi món,
// X cất súng, B mở cửa hàng, Tab bảng điểm.
// Mỗi phát: tia từ camera qua tâm ngắm tìm điểm muốn bắn, rồi tia thật từ đầu nòng tới điểm đó (lệch theo độ toả),
// dò trúng người khác theo đúng chỗ họ đang hiện trên màn hình mình, gửi server kiểm tra lại.

type Slot = "primary1" | "primary2" | "pistol" | "frag" | "smoke" | "mine" | "";
const GUN_SLOTS = ["primary1", "primary2", "pistol"] as const;

function magOf(kit: KitState, slot: string): number {
  return slot === "primary1" ? kit.mag1 : slot === "primary2" ? kit.mag2 : slot === "pistol" ? kit.magP : 0;
}

/** Súng đang cầm và băng đạn dự đoán trên máy (server trả số thật sau). */
export const gun = { slot: "" as Slot, weapon: "", mag: 0, lastShot: 0, reloadUntil: 0, cancelReload: null as null | (() => void), healUntil: 0, cancelHeal: null as null | (() => void) };

/** Tia gặp thân người (hình trụ đứng + đầu cầu). Trả về khoảng cách và phần trúng. */
function rayPerson(o: Vector3, d: Vector3, b: { x: number; y: number; z: number; crouch: boolean }): { t: number; part: "head" | "body" } | null {
  const headY = b.y + (b.crouch ? 1.12 : 1.62);
  // Đầu: hình cầu bán kính 0,15.
  let best: { t: number; part: "head" | "body" } | null = null;
  {
    const ox = o.x - b.x;
    const oy = o.y - headY;
    const oz = o.z - b.z;
    const bq = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - 0.15 * 0.15;
    const disc = bq * bq - c;
    if (disc >= 0) {
      const t = -bq - Math.sqrt(disc);
      if (t > 0) best = { t, part: "head" };
    }
  }
  // Thân: trụ đứng bán kính 0,3 từ chân tới vai.
  const top = b.y + (b.crouch ? 0.98 : 1.46);
  const ox = o.x - b.x;
  const oz = o.z - b.z;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-8) {
    const bq = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - 0.3 * 0.3;
    const disc = bq * bq - a * c;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / a;
      const y = o.y + d.y * t;
      if (t > 0 && y > b.y + 0.05 && y < top && (!best || t < best.t)) best = { t, part: "body" };
    }
  }
  return best;
}

export function Shooter({ room }: { room: IslandRoom }) {
  const { world: physics, rapier } = useRapier();
  const input = useRef({ fire: false, firePressed: false, aimHeld: false, aimToggle: false });
  const tmp = useRef({ o: new Vector3(), d: new Vector3(), p: new Vector3(), right: new Vector3(), fwd: new Vector3() });
  const bloom = useRef(0);

  const kit = () => room.state.players.get(myId(room))?.kit;
  const alive = () => room.state.players.get(myId(room))?.alive ?? false;

  // Lệnh từ bàn phím, chuột.
  useEffect(() => {
    const locked = () => !!document.pointerLockElement;
    const switchTo = (slot: Slot) => {
      const k = kit();
      if (!k || !alive()) return;
      if (slot && (GUN_SLOTS as readonly string[]).includes(slot) && !(k as unknown as Record<string, string>)[slot]) return;
      if ((slot === "frag" || slot === "smoke" || slot === "mine") && k[slot] <= 0) return;
      gun.cancelReload?.();
      gun.cancelReload = null;
      gun.reloadUntil = 0;
      gun.cancelHeal?.();
      gun.cancelHeal = null;
      gun.healUntil = 0;
      room.send(Messages.switchSlot, { slot });
      if (slot) playDraw();
    };
    const cycle = (step: number) => {
      const k = kit();
      if (!k) return;
      const list: Slot[] = [...GUN_SLOTS.filter((s) => (k as unknown as Record<string, string>)[s]), ...(["frag", "smoke", "mine"] as const).filter((s) => k[s] > 0)];
      if (!list.length) return;
      const i = list.indexOf(k.active as Slot);
      switchTo(list[(i + step + list.length) % list.length]!);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      switch (e.code) {
        case "Digit1":
          return switchTo("primary1");
        case "Digit2":
          return switchTo("primary2");
        case "Digit3":
          return switchTo("pistol");
        case "Digit4":
          return switchTo("frag");
        case "Digit5":
          return switchTo("smoke");
        case "Digit6":
          return switchTo("mine");
        case "KeyX":
          return switchTo("");
        case "KeyT":
          toggleCameraView();
          look.pitch = clampPitch(look.pitch);
          return;
        case "KeyR":
          return reload();
        case "Digit7":
          return heal("bandage");
        case "Digit8":
          return heal("medkit");
        case "KeyB": {
          const open = !getBattleHud().buyOpen;
          setBattleHud({ buyOpen: open });
          if (open) document.exitPointerLock?.();
          return;
        }
        case "Tab":
          e.preventDefault();
          setBattleHud({ scoreboard: true });
          return;
        case "Escape":
          if (getBattleHud().buyOpen) setBattleHud({ buyOpen: false });
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") setBattleHud({ scoreboard: false });
    };
    const onDown = (e: MouseEvent) => {
      if (!locked() || menuOpen()) return;
      if (e.button === 0) {
        input.current.fire = true;
        input.current.firePressed = true;
        // Gục rồi: bấm để xem người kế tiếp.
        if (!alive()) nextSpectate(room);
      }
      if (e.button === 2) {
        if (getSettings().toggleAim) input.current.aimToggle = !input.current.aimToggle;
        input.current.aimHeld = true;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) input.current.fire = false;
      if (e.button === 2) input.current.aimHeld = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!locked() || menuOpen()) return;
      cycle(Math.sign(e.deltaY));
    };
    const onMenu = (e: MouseEvent) => {
      if (locked()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("contextmenu", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Tin từ server: trúng ai, bị ai bắn.
  useEffect(() => {
    const offHit = room.onMessage(Messages.hit, (h: HitMessage) => {
      setBattleHud({ hit: { at: performance.now(), kind: h.kind, armor: h.armor } });
      playHitMarker(h.kind);
    });
    const offHurt = room.onMessage(Messages.hurt, (h: HurtMessage) => {
      const angle = Math.atan2(h.x - localPosition.x, h.z - localPosition.z);
      const hurts = [...getBattleHud().hurts.filter((x) => performance.now() - x.at < 1500), { at: performance.now(), angle, amount: h.amount }];
      setBattleHud({ hurts });
      if (h.armor) playArmorHit();
      playHurt();
      shake.amount = Math.min(0.6, shake.amount + h.amount / 120);
      // Bị thương thì hết băng bó.
      gun.cancelHeal?.();
      gun.cancelHeal = null;
      gun.healUntil = 0;
    });
    return () => {
      offHit();
      offHurt();
    };
  }, [room]);

  const reload = () => {
    const k = kit();
    if (!k || !alive()) return;
    const def = WEAPON.get((k as unknown as Record<string, string>)[k.active] ?? "");
    if (!def || gun.reloadUntil > performance.now()) return;
    if (magOf(k, k.active) >= def.mag || (k.ammo.get(def.ammo) ?? 0) <= 0) return;
    room.send(Messages.reload);
    gun.reloadUntil = performance.now() + def.reload * 1000;
    gun.cancelReload = playReload(def.id, def.reload);
  };

  const heal = (kind: "bandage" | "medkit") => {
    const me = room.state.players.get(myId(room));
    if (!me || !me.alive || me.kit[kind] <= 0 || me.hp >= HEALS[kind].cap) return;
    room.send(Messages.heal, { kind });
    gun.healUntil = performance.now() + HEALS[kind].seconds * 1000;
    gun.cancelHeal = playHeal(kind, HEALS[kind].seconds);
  };

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const me = room.state.players.get(myId(room));
    const k = me?.kit;
    const inp = input.current;
    const now = performance.now();
    if (!me || !k || !me.alive || menuOpen()) {
      stance.aiming = false;
      inp.fire = false;
      return;
    }
    const slot = k.active as Slot;
    const weaponId = (GUN_SLOTS as readonly string[]).includes(slot) ? (k as unknown as Record<string, string>)[slot]! : "";
    const def = WEAPON.get(weaponId);
    // Đổi súng hoặc server cập nhật băng đạn: lấy lại số đạn thật (trừ lúc vừa bắn, gói tin chưa kịp về).
    const serverMag = magOf(k, slot);
    if (gun.slot !== slot || gun.weapon !== weaponId) {
      gun.mag = serverMag;
      gun.slot = slot;
      gun.weapon = weaponId;
    } else if (now - gun.lastShot > 350) gun.mag = serverMag;
    if (!k.reloading && gun.reloadUntil && now > gun.reloadUntil + 400) gun.reloadUntil = 0;
    const reloading = k.reloading || gun.reloadUntil > now;

    // Ngắm.
    const wantAim = (getSettings().toggleAim ? inp.aimToggle : inp.aimHeld) && !!def && !reloading && !stance.sprinting;
    stance.aiming = wantAim;
    stance.zoom = def ? def.zoom : 1;
    stance.holdFire = inp.fire;

    // Độ toả: ngắm thì chụm, đi lại, nhảy thì toả; bắn liền nhiều phát thì toả dần (hồi lại khi thả cò).
    bloom.current = Math.max(0, bloom.current - dt * 0.12);
    if (def) {
      let spread = stance.aiming ? def.adsSpread : def.hipSpread;
      if (stance.moving) spread *= stance.aiming ? 1.6 : 1.5;
      if (stance.airborne) spread *= 3;
      if (stance.crouching) spread *= 0.75;
      stance.spread = spread + bloom.current;
    }

    // Giật súng hồi dần một phần về chỗ cũ.
    const back = recoil.pitch * Math.min(1, dt * 4);
    recoil.pitch -= back;
    look.pitch += back * 0.55;
    recoil.kick = Math.max(0, recoil.kick - dt * 6);

    // Hướng camera, trục ngang.
    const { o, d, p, right, fwd } = tmp.current;
    camera.getWorldDirection(fwd);
    right.set(-fwd.z, 0, fwd.x).normalize();

    if (!inp.fire && !inp.firePressed) return;
    const pressed = inp.firePressed;
    inp.firePressed = false;
    if (stance.sprinting) return;

    // Lựu đạn, bom khói: ném theo hướng nhìn; mìn: đặt dưới chân.
    if (slot === "frag" || slot === "smoke") {
      if (!pressed) return;
      const eye = new Vector3(localPosition.x, localPosition.y + 1.5, localPosition.z).addScaledVector(fwd, 0.5);
      const v = fwd.clone().multiplyScalar(17).add(new Vector3(0, 3.5, 0));
      room.send(Messages.battleThrow, { kind: slot, o: [eye.x, eye.y, eye.z], v: [v.x, v.y, v.z] });
      playThrow();
      localAim.yaw = look.yaw;
      localAim.at = now;
      return;
    }
    if (slot === "mine") {
      if (pressed) room.send(Messages.placeMine);
      return;
    }
    if (!def) return;
    if (!def.auto && !pressed) return;
    if (reloading || gun.healUntil > now) return;
    if (now - gun.lastShot < 60000 / def.rpm) return;
    if (gun.mag <= 0) {
      if (pressed) playDryFire();
      reload();
      return;
    }
    fire(def, camera.position, fwd, right);
  });

  const fire = (def: WeaponDef, camPos: Vector3, fwd: Vector3, right: Vector3) => {
    const now = performance.now();
    const { o, d, p } = tmp.current;
    gun.lastShot = now;
    gun.mag -= 1;
    const me = myId(room);
    // Điểm muốn bắn: tia từ camera qua tâm ngắm, bỏ qua đoạn từ camera tới trước mặt nhân vật (khỏi trúng chính mình).
    const first = getCameraView() === "first" || (stance.aiming && stance.zoom >= 3);
    const skip = first ? 0.3 : Math.max(0, (localPosition.x - camPos.x) * fwd.x + (localPosition.y + 1.5 - camPos.y) * fwd.y + (localPosition.z - camPos.z) * fwd.z) + 0.6;
    const maxRange = Math.min(600, def.range * 3);
    o.copy(camPos).addScaledVector(fwd, skip);
    let aimT = maxRange;
    const hitCam = physics.castRay(new rapier.Ray(o, fwd), maxRange, true, undefined, undefined, undefined, localBody.current ?? undefined);
    if (hitCam) aimT = hitCam.timeOfImpact;
    for (const [id, b] of bodies) {
      if (id === me || !b.alive) continue;
      const h = rayPerson(o, fwd, b);
      if (h && h.t < aimT) aimT = h.t;
    }
    p.copy(o).addScaledVector(fwd, aimT);
    // Đầu nòng: trước ngực lệch phải (góc thứ ba), hay ngay dưới mắt (góc nhất / ống ngắm).
    let muzzle = first
      ? camPos.clone().addScaledVector(fwd, 0.4).addScaledVector(right, 0.08).add(new Vector3(0, -0.07, 0))
      : new Vector3(localPosition.x, localPosition.y + (stance.crouching ? 1.05 : 1.42), localPosition.z).addScaledVector(right, 0.28).addScaledVector(fwd, 0.75);
    // Góc thứ ba: lấy đúng đầu nòng khẩu súng trên tay nhân vật.
    const held = first ? null : localAvatar.current?.getObjectByName("weapon");
    if (held?.visible) {
      const at = held.localToWorld(new Vector3(...muzzleOffset(def.id)));
      if (at.distanceTo(localPosition) < 3) muzzle = at;
    }
    const rays: [number, number, number][] = [];
    const hits: FireMessage["hits"] = [];
    const ends: Vector3[] = [];
    for (let k = 0; k < def.pellets; k++) {
      d.copy(p).sub(muzzle).normalize();
      // Lệch ngẫu nhiên trong hình nón độ toả.
      const spread = stance.spread * (def.pellets > 1 ? 1 : 0.5 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const up = new Vector3().crossVectors(d, right).normalize();
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      rays.push([d.x, d.y, d.z]);
      let t = maxRange;
      let normal = { x: 0, y: 1, z: 0 };
      const hw = physics.castRayAndGetNormal(new rapier.Ray(muzzle, d), maxRange, true, undefined, undefined, undefined, localBody.current ?? undefined);
      if (hw) {
        t = hw.timeOfImpact;
        normal = hw.normal;
      }
      let target = "";
      let part: "head" | "body" = "body";
      for (const [id, b] of bodies) {
        if (id === me || !b.alive) continue;
        const h = rayPerson(muzzle, d, b);
        if (h && h.t < t) {
          t = h.t;
          target = id;
          part = h.part;
        }
      }
      const end = muzzle.clone().addScaledVector(d, t);
      ends.push(end);
      if (target) hits.push({ target, part, d: t, ray: k });
      if (t < maxRange) {
        effects.impacts.push({ x: end.x, y: end.y, z: end.z, nx: normal.x, ny: normal.y, nz: normal.z, born: now / 1000, blood: !!target });
        if (!target && t < 60) playImpact(end, end.y < 0.3 ? "water" : "concrete");
      }
    }
    const seconds = now / 1000;
    for (const e of ends) effects.tracers.push({ ox: muzzle.x, oy: muzzle.y, oz: muzzle.z, ex: e.x, ey: e.y, ez: e.z, born: seconds, mine: true });
    effects.flashes.push({ x: muzzle.x, y: muzzle.y, z: muzzle.z, born: seconds });
    playGunshot(def.id, muzzle, true);
    if (def.class === "sniper") setTimeout(() => playBolt(), 450);
    room.send(Messages.fire, { weapon: def.id, o: [muzzle.x, muzzle.y, muzzle.z], rays, hits } satisfies FireMessage);
    // Giật: nòng hất lên, lệch ngang ngẫu nhiên; ngắm, ngồi xổm thì đỡ giật.
    const tame = (stance.aiming ? 0.7 : 1) * (stance.crouching ? 0.8 : 1);
    const kick = def.recoil * tame * (0.85 + Math.random() * 0.3);
    look.pitch -= kick;
    recoil.pitch += kick;
    look.yaw += (Math.random() - 0.45) * def.recoilSide * 2 * tame;
    recoil.kick = Math.min(1, recoil.kick + 0.5);
    bloom.current = Math.min(def.hipSpread, bloom.current + def.recoil * 0.25);
    localMotion.firing = (localMotion.firing + 1) % 65536;
    localAim.yaw = look.yaw;
    localAim.at = now;
    shake.amount = Math.min(0.25, shake.amount + (def.class === "sniper" || def.class === "shotgun" ? 0.12 : 0.03));
    if (gun.mag <= 0) setTimeout(reload, 200);
  };

  return null;
}

/** Gục rồi: chuyển sang xem người còn sống kế tiếp. */
export function nextSpectate(room: IslandRoom) {
  const alive = [...room.state.players.entries()].filter(([, p]) => p.alive).map(([id]) => id);
  if (!alive.length) return;
  const cur = getBattleHud().spectating;
  const i = alive.indexOf(cur);
  setBattleHud({ spectating: alive[(i + 1) % alive.length]! });
}
