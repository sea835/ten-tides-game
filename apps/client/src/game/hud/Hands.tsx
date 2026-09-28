import { Hand } from "lucide-react";
import { content, meleeOf } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { setHands, useHands } from "../handsStore.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

// Thanh đồ nghề: mọi món trong balo xếp thành hàng, món đang cầm sáng lên, kèm gợi ý món đó dùng được gì.
// Cùng chỗ này là lớp phủ trạng thái: choáng (đứng hình), chóng mặt (màn hình lảo đảo), mù (tối sầm).

/** Món này cầm lên làm được gì (chuột trái, chuột phải). */
function usage(itemId: string): string[] {
  const def = content.items.get(itemId);
  if (!def) return [];
  const out: string[] = [];
  if (def.eat) out.push("Chuột trái: ăn / uống");
  else if (def.plant) out.push("Chuột trái: trồng xuống đất");
  else if (def.camp) out.push("Chuột trái: đặt lửa trại ở đây (cả khu nhà dời theo)");
  else if (def.ranged) out.push(`Chuột trái: bắn (${def.ranged.damage} sát thương)`);
  else if (def.melee) out.push(`Chuột trái: đánh (${def.melee.damage} sát thương)${def.chop ? " · chặt cây" : ""}`);
  else out.push(`Chuột trái: đánh như tay không (${meleeOf("").damage})`);
  out.push(def.throw ? `Giữ chuột phải: ném (${def.throw.damage} sát thương)` : "Giữ chuột phải: ném đi");
  return out;
}

export function Hotbar({ room }: { room: IslandRoom }) {
  const view = usePrivate();
  const held = useHands();
  const alive = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.alive ?? false);
  const phase = useRoomSnapshot(room, (s) => s.phase);
  if (!view || !alive || phase === "lobby" || phase === "night") return null;
  const bag = view.bag;
  const heldItem = bag.find((b) => b.uid === held);
  const hints = heldItem ? usage(heldItem.itemId) : ["Chuột trái: đấm · chặt cây bằng tay không", "Q / lăn chuột: chọn món cầm"];
  return (
    <div className="hotbar-wrap">
      <div className="hotbar-hint">
        {heldItem && <strong>{content.items.get(heldItem.itemId)?.name}</strong>}
        {hints.map((h) => (
          <span key={h}>{h}</span>
        ))}
        {heldItem && (
          <span>
            <kbd>X</kbd> đặt xuống đất
          </span>
        )}
      </div>
      <div className="hotbar" role="toolbar" aria-label="Đồ cầm tay">
        <button className={held === "" ? "slot active" : "slot"} title="Tay không" onClick={() => setHands(room, "")}>
          <Hand size={18} aria-hidden />
        </button>
        {bag.map((b) => {
          const def = content.items.get(b.itemId);
          return (
            <button key={b.uid} className={held === b.uid ? "slot active" : "slot"} title={def?.name} onClick={() => setHands(room, b.uid)}>
              <span className="slot-name">{def?.name ?? b.itemId}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Lớp phủ trạng thái: mù thì tối sầm, chóng mặt thì mờ nhoè lảo đảo, choáng thì sao bay trước mắt. */
export function StatusOverlay({ room }: { room: IslandRoom }) {
  const st = useRoomSnapshot(room, (s) => {
    const p = s.players.get(myId(room));
    return { stun: (p?.stun ?? 0) > 0, dizzy: (p?.dizzy ?? 0) > 0, blind: Math.min(1, (p?.blind ?? 0) / 1.5) };
  });
  return (
    <>
      {st.blind > 0 && <div className="status-blind" style={{ opacity: 0.35 + st.blind * 0.6 }} />}
      {st.dizzy && <div className="status-dizzy" />}
      {st.stun && (
        <div className="status-stun">
          <span>★</span>
          <span>✦</span>
          <span>★</span>
          <em>Choáng!</em>
        </div>
      )}
    </>
  );
}
