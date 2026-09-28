import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowBigUp, Backpack, BookOpen, Hand, HandHeart, Map as MapIcon, Repeat, Skull, Star, Swords, Target, TreePalm } from "lucide-react";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { TOUCH_CYCLE, TOUCH_PRIMARY, TOUCH_THROW } from "../Controls.tsx";
import { useHud } from "../hudStore.ts";
import { keys, look } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

// Điều khiển cho điện thoại, máy tính bảng: cần gạt bên trái để đi (đẩy hết cỡ là chạy), vuốt nửa phải màn hình
// để xoay camera, và các nút lớn cho những việc trên bàn phím. Chỉ hiện trên máy dùng ngón tay.

const LOOK_SENSITIVITY = 0.006;
/** Bán kính cần gạt (px); đẩy quá chừng này phần thì chạy. */
const STICK = 56;
const RUN_AT = 0.85;

function coarse(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
}

function useTouchDevice(): boolean {
  return useSyncExternalStore(
    (l) => {
      if (typeof matchMedia === "undefined") return () => {};
      const q = matchMedia("(pointer: coarse)");
      q.addEventListener("change", l);
      return () => q.removeEventListener("change", l);
    },
    coarse,
  );
}

/** Giả lập một phím được bấm (cho những chỗ đang nghe phím: E, C, B, J...). */
function tap(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.replace("Key", "").toLowerCase() }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key: code.replace("Key", "").toLowerCase() }));
}

/** Nút giữ: đè thì phím được coi là đang giữ (nhảy, lặn), thả ra thì thôi. */
function hold(code: string, down: boolean) {
  if (down) keys.add(code);
  else keys.delete(code);
}

function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);

  const release = () => {
    origin.current = null;
    setKnob(null);
    for (const k of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]) keys.delete(k);
  };
  useEffect(() => release, []);

  const onDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setKnob({ x: 0, y: 0 });
  };
  const onMove = (e: ReactPointerEvent) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    let dx = e.clientX - o.x;
    let dy = e.clientY - o.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK) {
      dx = (dx / len) * STICK;
      dy = (dy / len) * STICK;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / STICK;
    const ny = dy / STICK;
    // Bốn hướng như WASD (chéo thì bấm hai phím); ngưỡng nhỏ để khỏi trôi.
    hold("KeyW", ny < -0.3);
    hold("KeyS", ny > 0.3);
    hold("KeyA", nx < -0.3);
    hold("KeyD", nx > 0.3);
    hold("ShiftLeft", Math.hypot(nx, ny) > RUN_AT);
  };
  return (
    <div ref={base} className="touch-stick" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release}>
      <div className="touch-stick-ring" />
      {knob && <div className="touch-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />}
    </div>
  );
}

/** Vuốt nửa phải màn hình để xoay camera. */
function LookPad() {
  const last = useRef<{ x: number; y: number; id: number } | null>(null);
  return (
    <div
      className="touch-look"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const l = last.current;
        if (!l || l.id !== e.pointerId) return;
        look.yaw -= (e.clientX - l.x) * LOOK_SENSITIVITY;
        look.pitch = Math.min(1.2, Math.max(-0.2, look.pitch + (e.clientY - l.y) * LOOK_SENSITIVITY));
        last.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    />
  );
}

function Button({ label, icon: Icon, onDown, onUp, big, tone }: {
  label: string;
  icon: typeof Hand;
  onDown: () => void;
  onUp?: () => void;
  big?: boolean;
  tone?: "danger" | "accent";
}) {
  return (
    <button
      className={`touch-btn${big ? " big" : ""}${tone ? ` ${tone}` : ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon size={big ? 26 : 20} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function TouchControls({ room }: { room: IslandRoom }) {
  const touch = useTouchDevice();
  const { nearTarget, nearAnchor, atDigSite, victim, giveTo, swimming, climbing } = useHud();
  const active = useRoomSnapshot(room, (s) => ["dawn", "explore", "dusk"].includes(s.phase) && (s.players.get(myId(room))?.alive ?? false));
  const throwStart = useRef(0);
  if (!touch || !active) return null;
  const canInteract = !!(nearTarget || nearAnchor || atDigSite || climbing);
  return (
    <div className="touch-controls">
      <LookPad />
      <Stick />
      <div className="touch-top">
        <Button label="Balo" icon={Backpack} onDown={() => tap("KeyB")} />
        <Button label="Sổ" icon={BookOpen} onDown={() => tap("KeyJ")} />
        <Button label="Đổi món" icon={Repeat} onDown={() => window.dispatchEvent(new Event(TOUCH_CYCLE))} />
        <Button label="Bản đồ" icon={MapIcon} onDown={() => document.querySelector(".hud")?.classList.toggle("show-map")} />
        <Button label="⭐" icon={Star} onDown={() => room.send(Messages.star)} />
      </div>
      <div className="touch-actions">
        <Button label="Đánh" icon={Swords} big tone="accent" onDown={() => window.dispatchEvent(new Event(TOUCH_PRIMARY))} />
        <Button
          label="Ném"
          icon={Target}
          onDown={() => (throwStart.current = performance.now())}
          onUp={() => {
            if (!throwStart.current) return;
            const power = Math.min(1, (performance.now() - throwStart.current) / 700);
            throwStart.current = 0;
            window.dispatchEvent(new CustomEvent(TOUCH_THROW, { detail: power }));
          }}
        />
        <Button label={swimming ? "Ngoi" : "Nhảy"} icon={ArrowBigUp} onDown={() => hold("Space", true)} onUp={() => hold("Space", false)} />
        <Button
          label={swimming ? "Lặn" : "Ngồi"}
          icon={TreePalm}
          onDown={() => (swimming ? hold("KeyC", true) : tap("KeyC"))}
          onUp={() => hold("KeyC", false)}
        />
        {canInteract && <Button label="Dùng (E)" icon={Hand} big onDown={() => tap("KeyE")} />}
        {giveTo && <Button label={`Đưa ${giveTo.name}`} icon={HandHeart} onDown={() => tap("KeyG")} />}
        {victim && <Button label="Kết liễu" icon={Skull} tone="danger" onDown={() => tap("KeyF")} />}
      </div>
    </div>
  );
}
