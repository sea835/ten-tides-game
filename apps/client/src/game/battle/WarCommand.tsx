import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { mapForMode, warSquadLeader } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { playPing } from "../sound/radio.ts";
import { BattleMinimap } from "./BattleHud.tsx";
import { setBattleHud } from "./runtime.ts";

// Bản đồ chỉ huy (chiến trường 50 vs 50, bấm M): chọn lính phe mình kiểu game chiến thuật rồi giao vùng.
// - Kéo chuột trái: khoanh vùng chọn lính (giữ Shift để chọn thêm); bấm vào một chấm: chọn một người.
// - Chuột phải: lính đã chọn đánh chiếm chỗ đó; kéo chuột phải để tô vùng rộng hơn. Shift + chuột phải: vào nấp giữ
//   vùng đó (phục kích). X: thả tự do (máy tự chọn cứ điểm như cũ).
// - A: chọn mọi lính máy phe mình; Q: chọn tổ của mình.
// Vùng đã giao vẽ lại trên bản đồ để còn nhớ ai đang làm gì.

interface Order {
  ids: string[];
  kind: "attack" | "hold";
  x: number;
  z: number;
  r: number;
}

/** Lệnh đã giao trong trận này (giữ khi đóng bản đồ). */
const orders: Order[] = [];

type Pt = { x: number; z: number };

export function WarCommandMap({ room, onClose }: { room: IslandRoom; onClose: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const me = myId(room);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [box, setBox] = useState<{ a: Pt; b: Pt } | null>(null);
  const [ring, setRing] = useState<{ a: Pt; b: Pt; hold: boolean } | null>(null);
  const [, redraw] = useState(0);
  const half = useMemo(() => mapForMode("war", room.state.worldSeed).half ?? 336, [room]);
  // Mỗi mét bản đồ là bao nhiêu điểm ảnh (để vẽ nét, chấm theo kích thước màn hình).
  const u = (half * 2) / (Math.min(window.innerHeight, window.innerWidth) * 0.8);

  // Mở bản đồ: nhả chuột ra để chỉ trỏ.
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }, []);
  // Vẽ lại vài lần mỗi giây cho chấm lính di chuyển.
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const mine = () => {
    const team = room.state.players.get(me)?.team;
    return [...room.state.players.entries()].filter(([id, p]) => p.bot && p.alive && p.team === team && id !== me);
  };

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const w = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: w.x, z: w.y };
  };

  const send = (kind: "attack" | "hold" | "free", at: Pt, r: number) => {
    const ids = [...selected].filter((id) => room.state.players.get(id)?.alive);
    if (!ids.length) {
      setBattleHud({ toast: { at: performance.now(), text: "Chọn lính trước: kéo chuột trái khoanh vùng (A: chọn tất cả)" } });
      return;
    }
    room.send(Messages.warCommand, { ids, kind, x: at.x, z: at.z, r });
    // Bỏ các lính này khỏi lệnh cũ.
    for (const o of orders) o.ids = o.ids.filter((id) => !selected.has(id));
    for (let i = orders.length - 1; i >= 0; i--) if (!orders[i]!.ids.length) orders.splice(i, 1);
    if (kind !== "free") orders.push({ ids, kind, x: at.x, z: at.z, r });
    playPing("order");
    const text = kind === "free" ? `${ids.length} lính: tự do tác chiến` : kind === "hold" ? `${ids.length} lính: vào nấp giữ vùng` : `${ids.length} lính: đánh chiếm vùng`;
    setBattleHud({ toast: { at: performance.now(), text } });
    redraw((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      if (e.code !== "KeyA" && e.code !== "KeyQ" && e.code !== "KeyX") return;
      // Phím của bản đồ: không để nhân vật đi ngang (A), nghiêng người (Q) theo.
      e.stopImmediatePropagation();
      if (e.code === "KeyA") {
        setSelected(new Set(mine().map(([id]) => id)));
      } else if (e.code === "KeyQ") {
        const lead = warSquadLeader(room.state.players.entries(), me);
        setSelected(new Set(mine().filter(([id]) => warSquadLeader(room.state.players.entries(), id) === lead).map(([id]) => id)));
      } else if (e.code === "KeyX") {
        const p = room.state.players.get(me);
        send("free", { x: p?.x ?? 0, z: p?.z ?? 0 }, 10);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const at = toWorld(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 0) setBox({ a: at, b: at });
    else if (e.button === 2) setRing({ a: at, b: at, hold: e.shiftKey });
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!box && !ring) return;
    const at = toWorld(e);
    if (box) setBox({ a: box.a, b: at });
    if (ring) setRing({ ...ring, b: at });
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (box && e.button === 0) {
      const { a, b } = box;
      const next = new Set(e.shiftKey ? selected : []);
      if (Math.hypot(b.x - a.x, b.z - a.z) < 6 * u) {
        // Bấm một chỗ: chọn chấm gần nhất (bấm lần nữa vào chấm đã chọn thì bỏ chọn).
        let best = "";
        let bestD = 10 * u;
        for (const [id, p] of mine()) {
          const d = Math.hypot(p.x - a.x, p.z - a.z);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
        if (best) {
          if (selected.has(best) && e.shiftKey) next.delete(best);
          else next.add(best);
        }
      } else {
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const z0 = Math.min(a.z, b.z);
        const z1 = Math.max(a.z, b.z);
        for (const [id, p] of mine()) if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) next.add(id);
      }
      setSelected(next);
      setBox(null);
    }
    if (ring && e.button === 2) {
      const r = Math.max(12, Math.min(60, Math.hypot(ring.b.x - ring.a.x, ring.b.z - ring.a.z)));
      send(ring.hold || e.shiftKey ? "hold" : "attack", ring.a, r);
      setRing(null);
    }
  };

  const overlay = (
    <g className="bm-cmd">
      {orders.map((o, i) => {
        const alive = o.ids.filter((id) => room.state.players.get(id)?.alive).length;
        if (!alive) return null;
        return (
          <g key={i} transform={`translate(${o.x} ${o.z})`}>
            <circle r={o.r} className={`bm-order-area ${o.kind}`} style={{ strokeWidth: 2 * u }} />
            <text y={4 * u} className="bm-order-count" style={{ fontSize: 13 * u }}>
              {o.kind === "hold" ? "⛨" : "⚔"} {alive}
            </text>
          </g>
        );
      })}
      {[...selected].map((id) => {
        const p = room.state.players.get(id);
        if (!p?.alive) return null;
        return <circle key={id} cx={p.x} cy={p.z} r={7 * u} className="bm-selected" style={{ strokeWidth: 2 * u }} />;
      })}
      {box && <rect x={Math.min(box.a.x, box.b.x)} y={Math.min(box.a.z, box.b.z)} width={Math.abs(box.b.x - box.a.x)} height={Math.abs(box.b.z - box.a.z)} className="bm-select-box" style={{ strokeWidth: 1.5 * u }} />}
      {ring && <circle cx={ring.a.x} cy={ring.a.z} r={Math.max(12, Math.min(60, Math.hypot(ring.b.x - ring.a.x, ring.b.z - ring.a.z)))} className={`bm-order-area ${ring.hold ? "hold" : "attack"} preview`} style={{ strokeWidth: 2 * u }} />}
    </g>
  );

  return (
    <div className="b-bigmap b-cmdmap" onContextMenu={(e) => e.preventDefault()}>
      <BattleMinimap room={room} big overlay={overlay} svgRef={svg} handlers={{ onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp }} />
      <div className="b-cmd-help">
        <span>
          <b>{selected.size}</b> lính đã chọn
        </span>
        <span>
          <kbd>Kéo chuột trái</kbd> chọn
        </span>
        <span>
          <kbd>Chuột phải</kbd> đánh chiếm (kéo để tô vùng)
        </span>
        <span>
          <kbd>Shift</kbd>+<kbd>Chuột phải</kbd> nấp giữ
        </span>
        <span>
          <kbd>A</kbd> tất cả · <kbd>Q</kbd> tổ mình · <kbd>X</kbd> thả tự do
        </span>
        <button onClick={onClose}>
          <kbd>M</kbd> đóng
        </button>
      </div>
    </div>
  );
}
