import { useEffect, useMemo, useRef, useState } from "react";
import { ADJACENCY_LABELS, content, gameConfig } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import {
  ADJACENCY_PAIRS,
  COMPARTMENT,
  GRID_SIZE,
  activePairs,
  canPlace,
  footprint,
  lookupFrom,
  type Placement,
  type Rotation,
} from "@tentides/rules";
import type { IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";

const CELL = 24;
const lookup = lookupFrom(gameConfig.items);

/** Màu từng món theo thẻ đầu tiên, để nhìn lưới là biết món nào là gì. */
const TAG_COLORS: Record<string, string> = {
  tool: "#8d6e63",
  light: "#f3a712",
  food: "#6a994e",
  water: "#2f9bc4",
  clue: "#c9a227",
  weapon: "#6c757d",
  medical: "#d1495b",
  luxury: "#8a4fff",
  mystery: "#b565a7",
  shelter: "#4f772d",
  fire: "#e76f51",
  explosive: "#9d0208",
  observe: "#457b9d",
};

/** Hai món của một cặp hiệu ứng. */
function members(pair: (typeof ADJACENCY_PAIRS)[number]): readonly string[] {
  return [pair.a, pair.b];
}

function itemColor(itemId: string): string {
  return TAG_COLORS[lookup(itemId)?.tags[0] ?? ""] ?? "#5c677d";
}

interface Drag {
  uid: string;
  itemId: string;
  rot: Rotation;
}

function ItemTip({ itemId }: { itemId: string }) {
  const def = content.items.get(itemId);
  if (!def) return null;
  return (
    <div className="item-tip">
      <strong>{def.name}</strong>
      <span>
        {def.size.w}x{def.size.h} ô · {def.weightKg} kg · {def.price} xu
      </span>
      {def.hooks.length > 0 && <span className="hint">{def.hooks.join(" · ")}</span>}
      {ADJACENCY_PAIRS.filter((p) => members(p).includes(itemId)).map((p) => (
        <span key={p.id} className="hint">
          Đặt cạnh {content.items.get(p.a === itemId ? p.b : p.a)?.name}: {ADJACENCY_LABELS[p.id]?.effect}
        </span>
      ))}
    </div>
  );
}

/**
 * Lưới balo. Có `onDrop` thì kéo thả được: bóng xem trước bắt dính theo ô, xanh là đặt được, đỏ là không.
 * Rê chuột lên một món thì các món đang tạo hiệu ứng cạnh nhau với nó sáng lên.
 */
function Grid({
  bag,
  drag,
  onPick,
  onDrop,
  onUnplace,
  onHover,
}: {
  bag: Placement[];
  drag?: Drag | null;
  onPick?: (p: Placement) => void;
  onDrop?: (x: number, y: number) => void;
  onUnplace?: (p: Placement) => void;
  /** Món đang được trỏ chuột, để hiện mô tả ở cột bên cạnh. */
  onHover?: (itemId: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const pairs = activePairs(bag, lookup);
  const partners = useMemo(() => {
    const target = bag.find((b) => b.uid === hoverItem);
    if (!target) return new Set<string>();
    const ids = ADJACENCY_PAIRS.filter((p) => pairs.includes(p.id) && members(p).includes(target.itemId)).flatMap(members);
    return new Set(bag.filter((b) => ids.includes(b.itemId)).map((b) => b.uid));
  }, [bag, hoverItem, pairs]);

  const cellAt = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - rect.left) / CELL), y: Math.floor((e.clientY - rect.top) / CELL) };
  };
  const ghost = drag && hover ? { ...footprint(lookup(drag.itemId)!, drag.rot), ...hover } : null;
  const ghostOk = !!(drag && hover && canPlace(bag, lookup(drag.itemId)!, hover.x, hover.y, drag.rot, lookup, drag.uid));

  return (
    <div
      ref={ref}
      className="bag-grid"
      style={{ width: GRID_SIZE * CELL, height: GRID_SIZE * CELL, backgroundSize: `${CELL}px ${CELL}px` }}
      onPointerMove={(e) => drag && setHover(cellAt(e))}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        if (!drag || !onDrop) return;
        const { x, y } = cellAt(e);
        onDrop(x, y);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="compartment"
        style={{ left: COMPARTMENT.x * CELL, top: COMPARTMENT.y * CELL, width: COMPARTMENT.size * CELL, height: COMPARTMENT.size * CELL }}
      >
        Ngăn bí mật
      </div>
      {bag.map((p) => {
        const { w, h } = footprint(lookup(p.itemId)!, p.rot);
        const dragging = drag?.uid === p.uid;
        return (
          <div
            key={p.uid}
            className={`bag-item${dragging ? " dragging" : ""}${partners.has(p.uid) ? " paired" : ""}`}
            style={{ left: p.x * CELL, top: p.y * CELL, width: w * CELL, height: h * CELL, background: itemColor(p.itemId) }}
            onPointerDown={(e) => {
              if (e.button === 0 && onPick) {
                e.preventDefault();
                onPick(p);
              }
            }}
            onDoubleClick={() => onUnplace?.(p)}
            onPointerEnter={() => {
              setHoverItem(p.uid);
              onHover?.(p.itemId);
            }}
            onPointerLeave={() => {
              setHoverItem(null);
              onHover?.(null);
            }}
            title={content.items.get(p.itemId)?.name}
          >
            <span>{content.items.get(p.itemId)?.name}</span>
          </div>
        );
      })}
      {ghost && (
        <div
          className={ghostOk ? "bag-ghost ok" : "bag-ghost bad"}
          style={{ left: ghost.x * CELL, top: ghost.y * CELL, width: ghost.w * CELL, height: ghost.h * CELL }}
        />
      )}
    </div>
  );
}

function PairsList({ bag }: { bag: Placement[] }) {
  const pairs = activePairs(bag, lookup);
  if (pairs.length === 0) return <div className="hint">Chưa có cặp đồ nào tạo hiệu ứng.</div>;
  return (
    <>
      {pairs.map((id) => (
        <div key={id} className="pair">
          <strong>{ADJACENCY_LABELS[id]?.title}</strong> · {ADJACENCY_LABELS[id]?.effect}
        </div>
      ))}
    </>
  );
}

/** Pha xếp balo: mua đồ, kéo vào lưới, xoay bằng R hoặc chuột phải. */
export function PackingScreen({ room }: { room: IslandRoom }) {
  const view = usePrivate();
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    timeLeft: st.timeLeft,
    shop: [...st.shop],
    readyCount: st.readyCount,
    readyNeeded: st.readyNeeded,
  }));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [done, setDone] = useState(false);
  const [pointing, setPointing] = useState<string | null>(null);

  useEffect(() => {
    if (s.phase === "pack" && document.pointerLockElement) document.exitPointerLock();
  }, [s.phase]);

  useEffect(() => {
    if (!drag) return;
    const rotate = () => setDrag((d) => (d ? { ...d, rot: d.rot === 0 ? 1 : 0 } : d));
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "r" || e.key === "R") rotate();
      if (e.key === "Escape") setDrag(null);
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      rotate();
    };
    // Thả chuột ngoài lưới thì huỷ kéo (món vẫn ở chỗ cũ).
    const onUp = () => setTimeout(() => setDrag(null), 0);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag !== null]);

  if (s.phase !== "pack" || !view) return null;
  const overweight = view.weightKg > view.capacityKg;

  return (
    <div className="prep-screen">
      <div className="panel prep-card packing">
        <header className="prep-header">
          <h2>Xếp balo</h2>
          <span className="hint">Kéo đồ vào lưới · R hoặc chuột phải để xoay · nhấp đúp để nhấc ra khay</span>
          <span className="event-timer">{s.timeLeft}s</span>
        </header>
        <div className="packing-body">
          <section className="shop">
            <div className="label">Cửa hàng ván này</div>
            {s.shop.map((itemId) => {
              const def = content.items.get(itemId)!;
              return (
                <div key={itemId} className="shop-item" onPointerEnter={() => setPointing(itemId)} onPointerLeave={() => setPointing(null)}>
                  <span className="swatch-mini" style={{ background: itemColor(itemId) }} />
                  <div className="shop-info">
                    <strong>{def.name}</strong>
                    <span className="hint">
                      {def.size.w}x{def.size.h} · {def.weightKg} kg
                    </span>
                  </div>
                  <button disabled={view.budget < def.price} onClick={() => room.send(Messages.buy, { itemId })}>
                    {def.price} xu
                  </button>
                </div>
              );
            })}
          </section>

          <section>
            <Grid
              bag={view.bag}
              drag={drag}
              onPick={(p) => setDrag({ uid: p.uid, itemId: p.itemId, rot: p.rot })}
              onDrop={(x, y) => {
                if (!drag) return;
                room.send(Messages.place, { uid: drag.uid, x, y, rot: drag.rot });
                setDrag(null);
              }}
              onUnplace={(p) => room.send(Messages.unplace, { uid: p.uid })}
              onHover={setPointing}
            />
          </section>

          <section className="bag-side">
            {pointing && (
              <>
                <div className="label">Món đang trỏ</div>
                <ItemTip itemId={pointing} />
              </>
            )}
            <div className="label">Ngân sách</div>
            <div className="big-number">{view.budget} xu</div>
            <div className="label">
              Trọng lượng {view.weightKg}/{view.capacityKg} kg
            </div>
            <Bar value={view.weightKg} max={view.capacityKg} color={overweight ? "#e4572e" : "#2a9d8f"} />
            {overweight && <div className="warning">Quá tải: đi chậm, Thể lực/Khéo léo −2, đói nhanh hơn.</div>}
            <div className="label">Khay tạm · chưa xếp</div>
            <div className="tray">
              {view.tray.length === 0 && <div className="hint">Trống</div>}
              {view.tray.map((t) => (
                <div key={t.uid} className="tray-item">
                  <button
                    className="tray-pick"
                    style={{ borderColor: itemColor(t.itemId) }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDrag({ uid: t.uid, itemId: t.itemId, rot: 0 });
                    }}
                  >
                    {content.items.get(t.itemId)?.name}
                  </button>
                  <button className="ghost" title="Bán lại" onClick={() => room.send(Messages.sell, { uid: t.uid })}>
                    bán
                  </button>
                </div>
              ))}
            </div>
            {view.tray.length > 0 && <div className="warning">Hết giờ mà còn trong khay thì bị bỏ lại trên tàu.</div>}
            <div className="label">Hiệu ứng đặt cạnh nhau</div>
            <PairsList bag={view.bag} />
            <div className="hint">Đồ ăn trong balo được góp vào kho chung khi lên đảo.</div>
          </section>
        </div>
        <footer className="prep-footer">
          <span className="hint">{s.readyCount}/{s.readyNeeded} người đã xếp xong</span>
          <button
            className={done ? "" : "primary"}
            onClick={() => {
              setDone(!done);
              room.send(Messages.ready);
            }}
          >
            {done ? "Xếp tiếp" : "Xong, lên đảo"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Xem balo của mình trong lúc chơi (phím B). */
export function BackpackViewer({ room }: { room: IslandRoom }) {
  const view = usePrivate();
  const playing = useRoomSnapshot(room, (s) => !["lobby", "create", "pack"].includes(s.phase));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "KeyB") setOpen((o) => !o);
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open || !playing || !view) return null;
  return (
    <div className="prep-screen" onClick={() => setOpen(false)}>
      <div className="panel prep-card viewer" onClick={(e) => e.stopPropagation()}>
        <header className="prep-header">
          <h2>Balo của bạn</h2>
          <span className="hint">
            {view.weightKg}/{view.capacityKg} kg · B hoặc Esc để đóng
          </span>
        </header>
        <div className="packing-body">
          <Grid bag={view.bag} />
          <section className="bag-side">
            <div className="label">Hiệu ứng đặt cạnh nhau</div>
            <PairsList bag={view.bag} />
            <div className="hint">Đồ trong ngăn bí mật không ai khác thấy.</div>
          </section>
        </div>
      </div>
    </div>
  );
}
