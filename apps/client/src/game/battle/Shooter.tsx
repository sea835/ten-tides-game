import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { Vector3 } from "three";
import { HEALS, MELEE, SIGHTS, WEAPON, bulletAt, bulletDrop, bulletSteps, zoomOf, HITBOX, type SightId, type WeaponDef } from "@tentides/content";
import { Messages, type FireMessage, type HitMessage, type HurtMessage, type KitState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { clampPitch, getCameraView, toggleCameraView } from "../camera.ts";
import { isTyping, keys, look, view } from "../input.ts";
import { getSettings } from "../settings.ts";
import { localAim, localMotion, localPosition, shake } from "../shared.ts";
import { playArmorHit, playDryFire, playHeal, playHitMarker, playHurt, playReload, playThrow, playGunshot, playBolt, playKnifeHit, playKnifeSwing, playPinPull, playShotMechanics, playSpoon, playWeaponSwap } from "../sound/guns.ts";
import { bodies, effects, eject, getBattleHud, localAvatar, localBody, menuOpen, muzzle as muzzleView, recoil, setBattleHud, stance, stopHit } from "./runtime.ts";
import { physicsProbe } from "./surface.ts";
import { ejectPort, muzzleOffset } from "../GunModel.tsx";

// Bắn súng trên máy mình: chuột trái bắn (giữ để bắn liên thanh), chuột phải ngắm (ống ngắm thì phóng to),
// R thay đạn, 1–3 đổi súng, 4–6 lựu đạn / bom khói / mìn, 7–8 băng gạc / hộp cứu thương, lăn chuột đổi món,
// X cất súng, B mở cửa hàng, Tab bảng điểm.
// Mỗi phát: tia từ camera qua tâm ngắm tìm điểm muốn bắn, rồi tia thật từ đầu nòng tới điểm đó (lệch theo độ toả),
// dò trúng người khác theo đúng chỗ họ đang hiện trên màn hình mình, gửi server kiểm tra lại.

type Slot = "primary1" | "primary2" | "pistol" | "frag" | "smoke" | "flash" | "mine" | "";
const THROWN = ["frag", "smoke", "flash"] as const;
const isThrown = (slot: string): slot is (typeof THROWN)[number] => (THROWN as readonly string[]).includes(slot);
const GUN_SLOTS = ["primary1", "primary2", "pistol"] as const;

function magOf(kit: KitState, slot: string): number {
  return slot === "primary1" ? kit.mag1 : slot === "primary2" ? kit.mag2 : slot === "pistol" ? kit.magP : 0;
}

export function sightOf(kit: KitState, slot: string): string {
  return slot === "primary1" ? kit.sight1 : slot === "primary2" ? kit.sight2 : slot === "pistol" ? kit.sightP : "";
}

/** Cự ly chỉnh thước ngắm mặc định và lớn nhất (m) theo loại súng; PageUp/PageDown đổi từng 100 m khi có ống ngắm. */
export function zeroRange(def: WeaponDef, sight: string): { base: number; max: number } {
  const base = def.class === "pistol" || def.class === "shotgun" || def.class === "smg" ? 50 : 100;
  const scoped = sight in SIGHTS && SIGHTS[sight as SightId].scope;
  if (!scoped) return { base, max: base };
  return { base, max: def.class === "sniper" ? 1000 : def.class === "dmr" ? 800 : def.class === "ar" || def.class === "lmg" ? 500 : 300 };
}

/**
 * Súng đang cầm và băng đạn dự đoán trên máy (server trả số thật sau). Khai báo ở `runtime.ts`
 * cùng các kho khác của Battleground vì `LocalPlayer` (dùng chung cả hai chế độ) cần đọc nó;
 * nếu khai ở đây thì `LocalPlayer` phải import cả module nặng của Battleground vào gói cốt truyện.
 */
export { gun } from "./runtime.ts";
import { gun } from "./runtime.ts";

/**
 * Giữ lại lần bấm chuột / phím R trong chừng này (ms). Chuột phải và R bấm trong lúc đang nạp
 * hoặc mới đổi súng sẽ ra phát ngay khi trạng thái cho phép, thay vì bị bỏ.
 */
const BUFFER_INPUT = 180;

/** Vừa ngừng chạy thì phải chờ chừng này (ms) mới bắn được như thường, và phát đầu dễ trượt hơn. */
const RAISE_TIME = 220;

/** Số giả ngẫu nhiên cố định theo tên súng: mỗi khẩu một kiểu lượn ngang riêng (học được, ghì được). */
function weaponSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Giật chung nhân thêm (nặng tay hơn số liệu gốc của từng khẩu). */
const RECOIL_SCALE = 1.4;

/** Cú hất màn hình (chỉ để nhìn) và độ giật tay theo loại súng. */
const PUNCH: Record<WeaponDef["class"], { pitch: number; roll: number; body: number }> = {
  pistol: { pitch: 0.9, roll: 0.012, body: 0.7 },
  smg: { pitch: 0.55, roll: 0.006, body: 0.45 },
  ar: { pitch: 0.7, roll: 0.01, body: 0.6 },
  lmg: { pitch: 0.7, roll: 0.012, body: 0.65 },
  dmr: { pitch: 0.9, roll: 0.02, body: 0.85 },
  sniper: { pitch: 1.1, roll: 0.035, body: 1 },
  shotgun: { pitch: 1.1, roll: 0.03, body: 1 },
};

/**
 * Giật của một phát trong loạt (radian): dọc thì phát đầu nhẹ, nặng dần tới phát thứ tám rồi chững lại;
 * ngang lượn theo một đường cố định của từng khẩu (sang một bên rồi quay lại), càng về cuối loạt càng lệch, cộng chút
 * rung tay ngẫu nhiên. Ngắm, ngồi xổm thì đỡ giật; chạy, nhảy thì giật mạnh hơn.
 */
export function recoilFor(def: WeaponDef, shot: number, st: { aiming: boolean; crouching: boolean; moving: boolean; airborne: boolean }): { up: number; side: number } {
  const tame = (st.aiming ? 0.78 : 1) * (st.crouching ? 0.8 : 1) * (st.moving ? 1.15 : 1) * (st.airborne ? 1.6 : 1);
  const seed = weaponSeed(def.id) * Math.PI * 2;
  // Liên thanh: phát đầu nhẹ, nặng dần tới phát thứ tám, sau đó chững lại (nòng đã "lên" hết cỡ, chủ yếu lượn ngang).
  const ramp = def.auto ? (shot === 0 ? 0.7 : shot < 8 ? 0.9 + shot * 0.05 : Math.max(0.8, 1.25 - (shot - 8) * 0.04)) : 1;
  const up = def.recoil * RECOIL_SCALE * ramp * tame * (0.9 + Math.random() * 0.2);
  const grow = def.auto ? Math.min(1, shot / 4) : 0.4;
  const sway = Math.sin(shot * 0.42 + seed) * 0.9 + Math.sin(shot * 1.17 + seed * 1.7) * 0.35 + (seed > Math.PI ? 0.25 : -0.25) * Math.min(1, shot / 10);
  const side = def.recoilSide * RECOIL_SCALE * 1.1 * tame * (sway * grow * 1.6 + (Math.random() - 0.5) * 0.9);
  return { up, side };
}

/**
 * Tia gặp thân người (hình trụ đứng + đầu cầu). Trả về khoảng cách và phần trúng.
 * Kích thước lấy từ `HITBOX` dùng chung với server: trước đây mỗi bên tự chế số riêng và lệch
 * ~18 cm ở chiều cao đứng, nên bắn vào khoảng 1,5 m client bảo thân còn server bảo đầu, và server
 * thắng trong im lặng (client không được báo phát bắn bị từ chối).
 */
function rayPerson(o: Vector3, d: Vector3, b: { x: number; y: number; z: number; crouch: boolean }): { t: number; part: "head" | "body" } | null {
  const headY = b.y + (b.crouch ? HITBOX.headY.crouch : HITBOX.headY.stand);
  let best: { t: number; part: "head" | "body" } | null = null;
  {
    const ox = o.x - b.x;
    const oy = o.y - headY;
    const oz = o.z - b.z;
    const bq = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - HITBOX.headR * HITBOX.headR;
    const disc = bq * bq - c;
    if (disc >= 0) {
      const t = -bq - Math.sqrt(disc);
      if (t > 0) best = { t, part: "head" };
    }
  }
  // Thân: trụ đứng bán kính 0,3 từ chân tới vai.
  const top = b.y + (b.crouch ? HITBOX.bodyTop.crouch : HITBOX.bodyTop.stand);
  const ox = o.x - b.x;
  const oz = o.z - b.z;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-8) {
    const bq = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - HITBOX.bodyR * HITBOX.bodyR;
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
  // `*At` là mốc thời gian của lần bấm gần nhất, giữ lại BUFFER_INPUT ms để bấm trong lúc
  // đang nạp / mới đổi súng / vừa thả tay chạy vẫn ra phát, thay vì bị nuốt im lặng.
  const input = useRef({
    fire: false,
    firePressed: false,
    firePressedAt: 0,
    /** Người chơi bấm trong lúc đang nạp: bắn luôn phát đầu tiên khi nạp xong. */
    fireAfterReload: false,
    /** Phím R bấm trong lúc chưa bắn được: nạp ngay khoảnh khắc trạng thái cho phép. */
    reloadAt: 0,
    aimHeld: false,
    aimToggle: false,
  });
  const tmp = useRef({ o: new Vector3(), d: new Vector3(), p: new Vector3(), right: new Vector3(), fwd: new Vector3() });
  const bloom = useRef(0);

  // Cho các phần ngoài Physics mượn tia vật lý (lỗ đạn của người khác, súng người khác chạm tường).
  useEffect(() => {
    physicsProbe.cast = (ox, oy, oz, dx, dy, dz, max) => {
      const h = physics.castRayAndGetNormal(new rapier.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }), max, true, undefined, undefined, undefined, localBody.current ?? undefined);
      return h ? { t: h.timeOfImpact, nx: h.normal.x, ny: h.normal.y, nz: h.normal.z } : null;
    };
    // Dev: xem trạng thái súng, giật, hiệu ứng khi thử (window.__tentides).
    if (import.meta.env.DEV) {
      const w = window as unknown as { __tentides?: Record<string, unknown> };
      w.__tentides ??= {};
      Object.assign(w.__tentides, { gun, recoil, stance, effects, hud: getBattleHud });
    }
    return () => {
      physicsProbe.cast = null;
    };
  }, [physics, rapier]);

  const kit = () => room.state.players.get(myId(room))?.kit;
  const alive = () => room.state.players.get(myId(room))?.alive ?? false;

  // Lệnh từ bàn phím, chuột.
  useEffect(() => {
    const locked = () => !!document.pointerLockElement;
    const switchTo = (slot: Slot) => {
      const k = kit();
      if (!k || !alive()) return;
      if (slot && (GUN_SLOTS as readonly string[]).includes(slot) && !(k as unknown as Record<string, string>)[slot]) return;
      if ((isThrown(slot) || slot === "mine") && k[slot] <= 0) return;
      stance.cookAt = 0;
      gun.cancelReload?.();
      gun.cancelReload = null;
      gun.reloadUntil = 0;
      gun.cancelHeal?.();
      gun.cancelHeal = null;
      gun.healUntil = 0;
      room.send(Messages.switchSlot, { slot });
    };
    const cycle = (step: number) => {
      const k = kit();
      if (!k) return;
      const list: Slot[] = [...GUN_SLOTS.filter((s) => (k as unknown as Record<string, string>)[s]), ...(["frag", "smoke", "flash", "mine"] as const).filter((s) => k[s] > 0)];
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
          return switchTo("flash");
        case "Digit7":
          return switchTo("mine");
        case "KeyX":
          // Cất súng: cầm dao.
          return switchTo("");
        case "KeyV":
          return melee();
        case "KeyT":
          toggleCameraView();
          look.pitch = clampPitch(look.pitch);
          return;
        case "KeyR": {
          // Bấm R sớm (đang đổi súng, đang bị khóa) thì giữ lại, không bỏ.
          const done = reload();
          if (!done) input.current.reloadAt = performance.now();
          return;
        }
        case "PageUp":
        case "PageDown": {
          // Chỉnh cự ly thước ngắm (ống ngắm): đạn đi đúng tâm ở cự ly này.
          const k = kit();
          const def = k && WEAPON.get((k as unknown as Record<string, string>)[k.active] ?? "");
          if (!k || !def) return;
          const { base, max } = zeroRange(def, sightOf(k, k.active));
          stance.zero = Math.max(base, Math.min(max, stance.zero + (e.code === "PageUp" ? 100 : -100)));
          if (stance.zero < 100) stance.zero = base;
          playDryFire();
          return;
        }
        case "Digit8":
          return heal("bandage");
        case "Digit9":
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
        input.current.firePressedAt = performance.now();
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
      // Máu và VFX đã hiện ngay lúc client tự dò trúng; server chỉ để xác nhận loại (thân/đầu/hạ)
      // và có trúng giáp hay không. Nếu client chưa báo gì thì đây là lần đầu, bật dấu trúng.
      const at = performance.now();
      if (!getBattleHud().hit || at - getBattleHud().hit!.at > 400) playHitMarker(h.kind);
      setBattleHud({ hit: { at, kind: h.kind, armor: h.armor, amount: h.amount } });
      // Đóng băng ngắn cho cú đánh trúng trả về, lâu hơn nếu hạ được.
      stopHit(h.kind === "kill" ? 90 : 45);
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

  /**
   * Đâm dao (phím V lúc nào cũng được, hay chuột trái khi đã cất súng): tìm người gần nhất trong tầm với phía trước
   * mặt, báo server (server kiểm tra lại). Máy mình diễn động tác và tiếng ngay.
   */
  const melee = () => {
    const now = performance.now();
    if (!alive() || now - gun.lastMelee < MELEE.cooldown * 1000 || now < gun.readyAt) return;
    gun.lastMelee = now;
    stance.meleeAt = now;
    stance.cookAt = 0;
    gun.cancelHeal?.();
    gun.cancelHeal = null;
    gun.healUntil = 0;
    // Hướng đâm theo góc camera (`view.yaw`), không phải chuột thô (`look.yaw`): camera đi sau
    // chuột một nhịp nên đâm theo look.yaw có thể trượt khỏi chỗ mình đang nhìn khi flick nhanh.
    const fx = -Math.sin(view.yaw);
    const fz = -Math.cos(view.yaw);
    let target = "";
    let best = MELEE.range;
    for (const [id, b] of bodies) {
      if (id === myId(room) || !b.alive) continue;
      const dx = b.x - localPosition.x;
      const dz = b.z - localPosition.z;
      const d = Math.hypot(dx, dz);
      if (d > best || Math.abs(b.y - localPosition.y) > 1.6) continue;
      if (d > 0.6 && (dx * fx + dz * fz) / d < 0.45) continue;
      best = d;
      target = id;
    }
    room.send(Messages.melee, { yaw: view.yaw, ...(target ? { target } : {}) });
    playKnifeSwing();
    localAim.yaw = view.yaw;
    localAim.at = now;
    if (target) {
      const b = bodies.get(target)!;
      setTimeout(() => {
        playKnifeHit({ x: b.x, y: b.y + 1.2, z: b.z }, true);
        effects.impacts.push({ x: b.x, y: b.y + 1.2, z: b.z, nx: -fx, ny: 0.2, nz: -fz, born: performance.now() / 1000, blood: true });
      }, 140);
    }
    recoil.vPitch += 0.25;
    recoil.vRoll += 0.3;
  };

  /** Nạp băng đạn. Trả về false nếu trạng thái hiện tại chưa cho phép (để caller giữ lại lần bấm). */
  const reload = () => {
    const k = kit();
    if (!k || !alive()) return false;
    const def = WEAPON.get((k as unknown as Record<string, string>)[k.active] ?? "");
    if (!def || gun.reloadUntil > performance.now()) return false;
    if (magOf(k, k.active) >= def.mag || (k.ammo.get(def.ammo) ?? 0) <= 0) return false;
    room.send(Messages.reload);
    gun.reloadUntil = performance.now() + def.reload * 1000;
    gun.cancelReload = playReload(def.id, def.reload);
    return true;
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
    updateRecoil(dt, now);
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
    const sight = def ? sightOf(k, slot) : "";
    if (gun.slot !== slot || gun.weapon !== weaponId || stance.sight !== sight) {
      if (gun.slot !== slot || gun.weapon !== weaponId) {
        gun.mag = serverMag;
        // Rút món mới ra: hạ món cũ, đưa món mới lên (súng to mất lâu hơn); rút xong mới bắn, ném được.
        stance.swapAt = now;
        stance.swapDur = !slot ? 0.35 : isThrown(slot) || slot === "mine" ? 0.35 : def?.class === "pistol" ? 0.4 : def?.class === "sniper" || def?.class === "lmg" ? 0.75 : 0.55;
        gun.readyAt = now + stance.swapDur * 1000;
        stance.cookAt = 0;
        playWeaponSwap(!slot ? "knife" : isThrown(slot) || slot === "mine" ? "throwable" : def?.class === "pistol" ? "pistol" : "gun");
      }
      gun.slot = slot;
      gun.weapon = weaponId;
      stance.sight = sight;
      stance.zero = def ? zeroRange(def, sight).base : 100;
    } else if (now - gun.lastShot > 350) gun.mag = serverMag;
    if (!k.reloading && gun.reloadUntil && now > gun.reloadUntil + 400) gun.reloadUntil = 0;
    const reloading = k.reloading || gun.reloadUntil > now;
    // Phím R bấm sớm: nạp ngay khoảnh khắc không còn bị chặn nữa.
    if (inp.reloadAt && now >= gun.readyAt && !reloading) {
      inp.reloadAt = 0;
      reload();
    }

    // Vừa ngừng chạy: dùng lên súng mất một nhịp ngắn (nếu không, bỏ Shift là bắn được ngay khung sau,
    // thiếu hẳn cảm giác "giơ súng lên" như lúc đổi món). Hết hạn thì trở về bắn thẳng.
    if (stance.sprinting) gun.raiseUntil = Math.max(gun.raiseUntil, now + RAISE_TIME);
    // Ngắm.
    const wantAim = (getSettings().toggleAim ? inp.aimToggle : inp.aimHeld) && !!def && !reloading && !stance.sprinting && now >= gun.readyAt;
    stance.aiming = wantAim;
    stance.zoom = def ? zoomOf(def, sight) : 1;
    stance.scoped = !!sight && SIGHTS[sight as SightId]?.scope === true;
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

    // Hướng camera, trục ngang.
    const { o, d, p, right, fwd } = tmp.current;
    camera.getWorldDirection(fwd);
    right.set(-fwd.z, 0, fwd.x).normalize();

    // Lựu đạn, bom khói, bom choáng: bấm giữ chuột trái là rút chốt (tay vung ra sau), thả ra thì ném; đang giữ mà
    // bấm chuột phải thì ném thấp tay (lăn gần). Đổi món thì cắm lại chốt.
    if (isThrown(slot) && stance.cookAt && !inp.fire) {
      const underhand = inp.aimHeld;
      stance.cookAt = 0;
      stance.throwAt = now;
      gun.readyAt = now + 700;
      const eye = new Vector3(localPosition.x, localPosition.y + (underhand ? 1.0 : 1.5), localPosition.z).addScaledVector(fwd, 0.5);
      const v = fwd.clone().multiplyScalar(underhand ? 8 : 17).add(new Vector3(0, underhand ? 2 : 3.5, 0));
      room.send(Messages.battleThrow, { kind: slot, o: [eye.x, eye.y, eye.z], v: [v.x, v.y, v.z] });
      playThrow();
      setTimeout(() => playSpoon({ x: localPosition.x, y: localPosition.y + 1.5, z: localPosition.z }), 120);
      localAim.yaw = view.yaw;
      localAim.at = now;
      return;
    }

    // Bấm chuột trong lúc đang nạp hay mới rút súng vẫn được giữ lại trong khung buffer,
    // thay vì bị `return` ở dưới nuốt mất hoàn toàn (người chơi thường báo là "game lag").
    // Bấm chuột trong lúc đang nạp hay mới rút súng vẫn được giữ lại trong khung buffer,
    // thay vì bị `return` ở dưới nuốt mất hoàn toàn (người chơi thường báo là "game lag").
    const buffered = inp.firePressedAt > 0 && now - inp.firePressedAt <= BUFFER_INPUT;
    if (!inp.fire && !inp.firePressed && !buffered && !inp.fireAfterReload) return;
    const pressed = inp.firePressed || buffered || inp.fireAfterReload;
    inp.firePressed = false;
    inp.firePressedAt = 0;
    if (stance.sprinting || now < gun.readyAt) return;

    if (isThrown(slot)) {
      if (pressed && !stance.cookAt) {
        stance.cookAt = now;
        playPinPull();
      }
      return;
    }
    // Cất súng (tay cầm dao): chuột trái là đâm.
    if (!slot) {
      if (pressed) melee();
      return;
    }
    if (slot === "mine") {
      if (pressed) room.send(Messages.placeMine);
      return;
    }
    if (!def) return;
    if (!def.auto && !pressed) return;
    // Đang nạp hoặc đang hồi máu: bấm chuột sẽ thành phát đầu tiên sau khi trở lại.
    if (reloading || gun.healUntil > now) {
      if (reloading) inp.fireAfterReload = true;
      return;
    }
    if (gun.mag <= 0) {
      if (pressed) playDryFire();
      reload();
      return;
    }
    // Lịch thay vì so sánh khoảng cách: cổng cũ đánh giá đúng một lần mỗi khung hình nên tần
    // suất thực là ceil(chu kỳ / thời gian khung) — Vector 1100rpm ra 898rpm, M249 750rpm ra 599
    // rpm ở 30fps. Bắn theo lịch thì RPM trung bình đúng ở mọi tần số khung hình.
    const interval = 60000 / def.rpm;
    if (now < gun.nextShotAt) return;
    fire(def, camera.position, fwd, right);
    // Lùi mốc theo chu kỳ thay vì đặt lại, nhưng không để tụ lại quá một khung hình.
    gun.nextShotAt = Math.max(gun.nextShotAt + interval, now);
  });

  /**
   * Mỗi khung hình: rải phần giật còn nợ vào góc nhìn (khoảng 35 ms, không giật cục một khung), thả cò một nhịp thì
   * tâm ngắm hồi về chỗ cũ (phần người chơi đã tự ghì xuống thì thôi), cú hất màn hình dao động tắt dần như lò xo.
   */
  const updateRecoil = (dt: number, now: number) => {
    const take = 1 - Math.exp(-dt / 0.035);
    const dp = recoil.pendPitch * take;
    const dy = recoil.pendYaw * take;
    recoil.pendPitch -= dp;
    recoil.pendYaw -= dy;
    look.pitch = clampPitch(look.pitch - dp);
    look.yaw += dy;
    recoil.pitch += dp;
    recoil.yaw += dy;
    const def = WEAPON.get(gun.weapon);
    const interval = def ? 60000 / def.rpm : 100;
    const idle = now - gun.lastShot;
    if (idle > Math.max(140, interval * 1.3)) {
      // Loạt bắn kết thúc: về lại phát đầu, tâm ngắm trôi về chỗ cũ.
      recoil.shot = 0;
      const back = 1 - Math.exp(-dt * 7);
      const bp = recoil.pitch * back;
      const by = recoil.yaw * back;
      recoil.pitch -= bp;
      recoil.yaw -= by;
      look.pitch = clampPitch(look.pitch + bp);
      look.yaw -= by * 0.5;
    }
    // Lò xo tắt dần (gần tới hạn): hất lên rồi về, không nảy qua lại.
    const kStiff = 260;
    const damp = 27;
    recoil.vPitch += (-kStiff * recoil.punchPitch - damp * recoil.vPitch) * dt;
    recoil.vYaw += (-kStiff * recoil.punchYaw - damp * recoil.vYaw) * dt;
    recoil.vRoll += (-kStiff * recoil.punchRoll - damp * recoil.vRoll) * dt;
    recoil.punchPitch += recoil.vPitch * dt;
    recoil.punchYaw += recoil.vYaw * dt;
    recoil.punchRoll += recoil.vRoll * dt;
    recoil.kick = Math.max(0, recoil.kick - dt * 5);
  };

  const fire = (def: WeaponDef, camPos: Vector3, fwd: Vector3, right: Vector3) => {
    const now = performance.now();
    const { o, d, p } = tmp.current;
    gun.lastShot = now;
    // Súng vừa rút xong: bắn sớm hơn bình thường một chút, và lỡ tay khi vừa rời tay chạy.
    if (now < gun.raiseUntil) {
      recoil.pendPitch += def.recoil * 0.5;
      stance.spread = stance.spread * 1.35 + 0.004;
    }
    gun.mag -= 1;
    const me = myId(room);
    // Điểm muốn bắn: tia từ camera qua tâm ngắm, bỏ qua đoạn từ camera tới trước mặt nhân vật (khỏi trúng chính mình).
    const first = stance.firstPerson;
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
    // Đầu nòng thò qua tường (đứng sát vật cản): đạn xuất phát ngay mặt tường phía mình, không bắn xuyên qua được.
    {
      const from = first ? camPos.clone() : new Vector3(localPosition.x, localPosition.y + (stance.crouching ? 1.05 : 1.42), localPosition.z);
      const to = muzzle.clone().sub(from);
      const len = to.length();
      if (len > 1e-3) {
        to.divideScalar(len);
        const block = physics.castRay(new rapier.Ray(from, to), len, true, undefined, undefined, undefined, localBody.current ?? undefined);
        if (block) muzzle = from.addScaledVector(to, Math.max(0, block.timeOfImpact - 0.06));
      }
    }
    const rays: [number, number, number][] = [];
    const hits: FireMessage["hits"] = [];
    const ends: { at: Vector3; s: number }[] = [];
    const o3: [number, number, number] = [muzzle.x, muzzle.y, muzzle.z];
    // Thước ngắm chỉnh ở cự ly `zero`: nòng ngóc lên một chút để đường đạn cắt tâm ngắm đúng ở cự ly đó.
    const lift = bulletDrop(def.velocity, stance.zero) / stance.zero;
    const steps = bulletSteps(def.velocity, maxRange);
    const a3 = new Vector3();
    const b3 = new Vector3();
    const cd = new Vector3();
    for (let k = 0; k < def.pellets; k++) {
      d.copy(p).sub(muzzle).normalize();
      // Lệch ngẫu nhiên trong hình nón độ toả.
      const spread = stance.spread * (def.pellets > 1 ? 1 : 0.5 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const up = new Vector3().crossVectors(d, right).normalize();
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
      d.y += lift * Math.sqrt(1 - d.y * d.y);
      d.normalize();
      rays.push([d.x, d.y, d.z]);
      const d3: [number, number, number] = [d.x, d.y, d.z];
      // Đạn bay theo đường cong: dò từng đoạn dây cung, gặp tường hay người trước thì dừng.
      let sHit = maxRange;
      let normal = { x: 0, y: 1, z: 0 };
      let target = "";
      let part: "head" | "body" = "body";
      let wall = false;
      for (let i = 1; i < steps.length; i++) {
        a3.set(...bulletAt(o3, d3, def.velocity, steps[i - 1]!));
        b3.set(...bulletAt(o3, d3, def.velocity, steps[i]!));
        const len = cd.subVectors(b3, a3).length();
        cd.divideScalar(len || 1);
        let t = len;
        const hw = physics.castRayAndGetNormal(new rapier.Ray(a3, cd), len, true, undefined, undefined, undefined, localBody.current ?? undefined);
        if (hw) {
          t = hw.timeOfImpact;
          normal = hw.normal;
          wall = true;
        }
        for (const [id, b] of bodies) {
          if (id === me || !b.alive) continue;
          const h = rayPerson(a3, cd, b);
          if (h && h.t < t) {
            t = h.t;
            target = id;
            part = h.part;
          }
        }
        if (target || wall) {
          sHit = steps[i - 1]! + (t / (len || 1)) * (steps[i]! - steps[i - 1]!);
          break;
        }
      }
      const end = new Vector3(...bulletAt(o3, d3, def.velocity, sHit));
      ends.push({ at: end, s: sHit });
      if (target) hits.push({ target, part, d: sHit, ray: k });
      if (target || wall) {
        const size = def.class === "sniper" ? 1.35 : def.class === "dmr" ? 1.15 : def.pellets > 1 ? 0.6 : def.class === "smg" || def.class === "pistol" ? 0.85 : 1;
        const arrive = now / 1000 + sHit / def.velocity;
        effects.impacts.push({ x: end.x, y: end.y, z: end.z, nx: target ? -cd.x : normal.x, ny: target ? -cd.y : normal.y, nz: target ? -cd.z : normal.z, born: now / 1000, blood: !!target, size, at: arrive });
        // Trúng người: máu bắn lên tường, sàn phía sau (nếu có gần đó).
        if (target && k < 3) {
          const behind = physics.castRayAndGetNormal(new rapier.Ray(end, cd), 2.6, true, undefined, undefined, undefined, localBody.current ?? undefined);
          if (behind) {
            const at = end.clone().addScaledVector(cd, behind.timeOfImpact);
            effects.splats.push({ x: at.x, y: at.y, z: at.z, nx: behind.normal.x, ny: behind.normal.y, nz: behind.normal.z, scale: (part === "head" ? 1.2 : 0.8) * (1 - behind.timeOfImpact / 4) });
          }
        }
      }
    }
    const seconds = now / 1000;
    // Vệt đạn: góc nhất thì bay ra từ đầu nòng khẩu súng trước mặt (chỗ lửa đầu nòng), không phải từ mắt.
    const from = first && muzzleView.valid ? new Vector3(muzzleView.x, muzzleView.y, muzzleView.z) : muzzle;
    for (const e of ends) effects.tracers.push({ ox: from.x, oy: from.y, oz: from.z, ex: e.at.x, ey: e.at.y, ez: e.at.z, born: seconds, mine: true, speed: def.velocity });
    // Lửa đầu nòng: góc nhất thì ViewModel tự vẽ trên súng; góc ba vẽ ở đầu nòng thật.
    if (!first) effects.flashes.push({ x: muzzle.x, y: muzzle.y, z: muzzle.z, born: seconds });
    playGunshot(def.id, muzzle, true);
    if (def.class !== "sniper" && def.class !== "shotgun") playShotMechanics(def.id);
    // Vỏ đạn văng ra cửa thoát bên phải (súng khoá nòng: văng khi kéo khoá, sau phát bắn một chút; shotgun hai nòng
    // bẻ ra lúc nạp đạn).
    if (def.class !== "shotgun") {
      let ex: Vector3;
      let rx = right.x;
      let rz = right.z;
      if (first && eject.valid) {
        ex = new Vector3(eject.x, eject.y, eject.z);
        rx = eject.rx;
        rz = eject.rz;
      } else if (held?.visible) ex = held.localToWorld(new Vector3(...ejectPort(def.id)));
      else ex = muzzle.clone().addScaledVector(fwd, -0.5);
      const bolt = def.class === "sniper";
      const sp = 1.6 + Math.random() * 1.2;
      effects.casings.push({
        x: ex.x,
        y: ex.y,
        z: ex.z,
        vx: rx * sp + fwd.x * (Math.random() * 0.6 - 0.4),
        vy: 1.2 + Math.random() * 1.1,
        vz: rz * sp + fwd.z * (Math.random() * 0.6 - 0.4),
        at: seconds + (bolt ? 0.55 : 0),
        kind: "brass",
        size: def.class === "pistol" || def.class === "smg" ? 0.75 : bolt || def.class === "dmr" ? 1.3 : 1,
      });
    }
    if (def.class === "sniper") setTimeout(() => playBolt(), 450);
    // Báo trúng ngay ở máy: trước đây dấu trúng chỉ hiện khi tin server về (1 RTT), trong khi máu và
    // tia lửa đã hiện từ khung bắn — trên LAN thì quên, nhưng 60–120ms RTT thì dấu X hiện sau
    // vệt máu một cách vô lý. Server vẫn giữ quyền quyết định và sẽ ghi đè loại/số sát thương.
    if (hits.length) {
      // `part` đã đến từ rayPerson, tức đã dùng HITBOX chung với server.
      const head = hits.some((h) => h.part === "head");
      const at = performance.now();
      if (!getBattleHud().hit || at - getBattleHud().hit!.at > 200) {
        playHitMarker(head ? "head" : "body");
        setBattleHud({ hit: { at, kind: head ? "head" : "body", armor: false, amount: 0 } });
        stopHit(45);
      }
    }
    room.send(Messages.fire, { weapon: def.id, o: [muzzle.x, muzzle.y, muzzle.z], rays, hits } satisfies FireMessage);
    // Giật: dồn vào góc nhìn trong vài khung hình tới (updateRecoil), hất màn hình một cái, súng trên tay lùi lại.
    const { up, side } = recoilFor(def, recoil.shot, stance);
    recoil.shot++;
    recoil.pendPitch += up;
    recoil.pendYaw += side;
    const punch = PUNCH[def.class];
    recoil.vPitch += up * punch.pitch * 60;
    recoil.vYaw += side * 35 + (Math.random() - 0.5) * up * 12;
    recoil.vRoll += (Math.random() - 0.5) * 2 * punch.roll * 70;
    recoil.kick = Math.min(1.4, recoil.kick + punch.body);
    recoil.fired++;
    recoil.power = punch.body;
    bloom.current = Math.min(def.hipSpread, bloom.current + def.recoil * 0.25);
    localMotion.firing = (localMotion.firing + 1) % 65536;
    localAim.yaw = view.yaw;
    localAim.at = now;
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
