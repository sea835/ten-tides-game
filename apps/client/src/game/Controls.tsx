import { useEffect } from "react";
import { content, worldCatalog } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { getHands, setHands } from "./handsStore.ts";
import { getHud, setHud } from "./hudStore.ts";
import { isTyping, look } from "./input.ts";
import { usePrivate } from "./privateStore.ts";
import { buildGhost, localAim, localPosition } from "./shared.ts";
import { play } from "./sound/sfx.ts";

// Điều khiển tay chân (khi đã khoá chuột vào cảnh 3D):
// chuột trái đánh (hay ăn, trồng cây, đặt lửa trại, dựng nhà tuỳ món đang cầm), giữ rồi thả chuột phải để ném
// (giữ càng lâu ném càng xa), lăn chuột hoặc Q để đổi món cầm, X đặt món đang cầm xuống đất, V dựng nhà,
// F kết liễu (chỉ kẻ phản bội).

/** Sự kiện riêng mà điều khiển cảm ứng phát ra: đánh/dùng, ném (kèm lực 0–1), đổi món cầm. */
export const TOUCH_PRIMARY = "tentides:primary";
export const TOUCH_THROW = "tentides:throw";
export const TOUCH_CYCLE = "tentides:cycle";

/** Công trình chọn lần lượt khi bấm V (rỗng là thôi dựng). */
const BUILD_CYCLE = ["", ...worldCatalog.buildings.keys()];

/** Góc ngắm lên xuống suy ra từ góc camera: camera mặc định (0,35) là ngắm ngang. */
function aimPitch(): number {
  return Math.max(-0.6, Math.min(0.9, 0.35 - look.pitch));
}

export function Controls({ room }: { room: IslandRoom }) {
  const view = usePrivate();
  const bag = view?.bag ?? [];

  // Món đang cầm không còn trong balo (ăn hết, ném đi, bị lấy trộm) thì về tay không.
  useEffect(() => {
    const uid = getHands();
    if (uid && !bag.some((b) => b.uid === uid)) setHands(room, "");
  }, [bag, room]);

  useEffect(() => {
    const locked = () => !!document.pointerLockElement;
    const cycle = (step: number) => {
      const list = ["", ...(view?.bag ?? []).map((b) => b.uid)];
      const i = list.indexOf(getHands());
      setHands(room, list[(i + step + list.length) % list.length]!);
    };
    let throwStart = 0;

    const primary = () => {
      const hud = getHud();
      if (hud.build) {
        room.send(Messages.build, { kind: buildGhost.kind, x: buildGhost.x, z: buildGhost.z, rot: buildGhost.rot });
        return;
      }
      const held = (view?.bag ?? []).find((b) => b.uid === getHands());
      const def = held && content.items.get(held.itemId);
      // Quay mặt về hướng camera để đòn đánh đúng hướng mình nhìn.
      localAim.yaw = look.yaw;
      localAim.at = performance.now();
      if (def && (def.eat || def.plant || def.camp)) {
        const x = localPosition.x - Math.sin(look.yaw) * 1.8;
        const z = localPosition.z - Math.cos(look.yaw) * 1.8;
        room.send(Messages.use, { x, z });
        return;
      }
      room.send(Messages.attack, { yaw: look.yaw, pitch: aimPitch() });
    };

    // Điều khiển cảm ứng (không khoá chuột được) gửi lệnh qua sự kiện riêng.
    const onTouchPrimary = () => primary();
    const onTouchThrow = (e: Event) => {
      if (!getHands()) return;
      const power = Math.min(1, Math.max(0, (e as CustomEvent<number>).detail ?? 0.5));
      localAim.yaw = look.yaw;
      localAim.at = performance.now();
      room.send(Messages.throw, { yaw: look.yaw, pitch: aimPitch(), power: 0.35 + power * 0.65 });
      play("throw", { volume: 0.5 + power * 0.5 });
    };
    const onTouchCycle = () => cycle(1);

    const onDown = (e: MouseEvent) => {
      if (!locked()) return;
      if (e.button === 0) primary();
      if (e.button === 2) throwStart = performance.now();
    };
    const onUp = (e: MouseEvent) => {
      if (!locked() || e.button !== 2 || !throwStart) return;
      const power = Math.min(1, (performance.now() - throwStart) / 700);
      throwStart = 0;
      if (!getHands()) return;
      localAim.yaw = look.yaw;
      localAim.at = performance.now();
      room.send(Messages.throw, { yaw: look.yaw, pitch: aimPitch(), power: 0.35 + power * 0.65 });
      play("throw", { volume: 0.5 + power * 0.5 });
    };
    const onWheel = (e: WheelEvent) => {
      if (!locked()) return;
      if (getHud().build) {
        buildGhost.turn += Math.sign(e.deltaY) * 0.4;
        return;
      }
      cycle(Math.sign(e.deltaY));
    };
    const onMenu = (e: MouseEvent) => {
      if (locked()) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      switch (e.code) {
        case "KeyQ":
          cycle(1);
          break;
        case "KeyX":
          if (getHands()) room.send(Messages.drop);
          break;
        case "KeyV": {
          const i = BUILD_CYCLE.indexOf(getHud().build);
          setHud({ build: BUILD_CYCLE[(i + 1) % BUILD_CYCLE.length]! });
          break;
        }
        case "KeyG": {
          const to = getHud().giveTo;
          if (to && getHands()) room.send(Messages.give, { target: to.id });
          break;
        }
        case "KeyK":
          room.send(Messages.star);
          break;
        case "KeyF": {
          const victim = getHud().victim;
          if (victim) room.send(Messages.assassinate, { target: victim.id });
          break;
        }
        case "Escape":
          if (getHud().build) setHud({ build: "" });
          break;
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("contextmenu", onMenu);
    window.addEventListener("keydown", onKey);
    window.addEventListener(TOUCH_PRIMARY, onTouchPrimary);
    window.addEventListener(TOUCH_THROW, onTouchThrow);
    window.addEventListener(TOUCH_CYCLE, onTouchCycle);
    return () => {
      window.removeEventListener(TOUCH_PRIMARY, onTouchPrimary);
      window.removeEventListener(TOUCH_THROW, onTouchThrow);
      window.removeEventListener(TOUCH_CYCLE, onTouchCycle);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [room, view]);

  // Người đã gục thì thôi cầm đồ, thôi dựng nhà.
  useEffect(() => {
    const check = () => {
      const me = room.state.players.get(myId(room));
      if (me && !me.alive && getHud().build) setHud({ build: "" });
    };
    room.onStateChange(check);
    return () => room.onStateChange.remove(check);
  }, [room]);

  return null;
}
