import { useEffect, useRef, useState } from "react";
import { Flame, Hammer, X } from "lucide-react";
import { content, type Item } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { missingMaterials } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { usePrivate } from "../privateStore.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { ItemIcon, itemColor } from "./Backpack.tsx";

// Bảng chế tạo (phím R, hay nút "Chế tạo" trên điện thoại): làm đồ từ gỗ, đá, da, xương... nhặt trên đảo.
// Món nào đủ nguyên liệu thì lên đầu; công thức cần lửa thì phải đứng cạnh lửa trại.

export const TOUCH_CRAFT = "tentides:craft";
/** Đứng cách lửa trại trong chừng này mét là "cạnh lửa" (server cho rộng hơn chút). */
const FIRE_REACH = 4;

const RECIPES: Item[] = [...content.items.values()].filter((i) => i.craft);

function name(itemId: string): string {
  return content.items.get(itemId)?.name ?? itemId;
}

/** Một dòng ngắn: món này dùng để làm gì. */
function purpose(item: Item): string {
  const out: string[] = [];
  if (item.hull) out.push(`vá thuyền +${item.hull}`);
  if (item.chop) out.push(`chặt cây ${item.chop}`);
  if (item.melee && item.melee.damage >= 8) out.push(`đánh ${item.melee.damage}`);
  if (item.ranged) out.push(`bắn xa ${item.ranged.damage}`);
  if (item.eat?.hp) out.push(`hồi ${item.eat.hp} Máu`);
  if (item.eat?.hunger) out.push(`no +${item.eat.hunger}`);
  if (item.ration) out.push(`${item.ration} khẩu phần`);
  if (item.camp) out.push("dời lửa trại");
  if (item.tags.includes("light")) out.push("soi sáng hang");
  if (item.tags.includes("climb")) out.push("leo vách");
  if (item.tags.includes("fish")) out.push("bắt cá");
  return out.slice(0, 3).join(" · ");
}

export function Crafting({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const view = usePrivate();
  const s = useRoomSnapshot(room, (st) => ({
    playing: ["dawn", "explore", "dusk", "night"].includes(st.phase),
    alive: st.players.get(me)?.alive ?? false,
    night: st.phase === "night" && [...st.campers].includes(me),
    camp: st.campPacked ? null : { x: st.campX, z: st.campZ },
  }));
  const [open, setOpen] = useState(false);
  const [nearFire, setNearFire] = useState(false);
  // Phím R lúc xếp balo là để xoay đồ: chỉ mở bảng khi đang ở trên đảo.
  const playing = useRef(false);
  playing.current = s.playing && s.alive;

  useEffect(() => {
    const toggle = () => setOpen((o) => (playing.current ? !o : false));
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "KeyR" && !e.repeat) toggle();
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(TOUCH_CRAFT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(TOUCH_CRAFT, toggle);
    };
  }, []);

  const visible = open && s.playing && s.alive && !!view;
  useEffect(() => {
    if (!visible) return;
    if (document.pointerLockElement) document.exitPointerLock();
    // Vị trí mình đổi liên tục mà không qua React: hỏi lại vài lần mỗi giây.
    const check = () => setNearFire(s.night || (!!s.camp && Math.hypot(localPosition.x - s.camp.x, localPosition.z - s.camp.z) <= FIRE_REACH));
    check();
    const timer = setInterval(check, 400);
    return () => clearInterval(timer);
  }, [visible, s.night, s.camp?.x, s.camp?.z]);

  if (!visible) return null;
  const have = view.bag.map((b) => b.itemId);
  const rows = RECIPES.map((item) => {
    const missing = missingMaterials(have, item.craft!.needs);
    const needFire = !!item.craft!.fire && !nearFire;
    return { item, missing, needFire, ready: Object.keys(missing).length === 0 && !needFire };
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || Object.keys(a.missing).length - Object.keys(b.missing).length);
  const readyCount = rows.filter((r) => r.ready).length;

  return (
    <div className="prep-screen" onClick={() => setOpen(false)}>
      <div className="prep-card crafting" onClick={(e) => e.stopPropagation()}>
        <header className="prep-header">
          <div>
            <div className="kicker">Tự làm lấy</div>
            <h2>Chế tạo</h2>
          </div>
          <span className="hint">
            {readyCount ? `Làm được ${readyCount} món ngay` : "Chặt cây lấy gỗ, nhặt đá, săn thú lấy da, xương"} · <kbd>R</kbd> hoặc <kbd>Esc</kbd> để đóng
          </span>
          <button className="ghost" title="Đóng" onClick={() => setOpen(false)}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="craft-list">
          {rows.map(({ item, missing, needFire, ready }) => (
            <div key={item.id} className={ready ? "craft-row ready" : "craft-row"}>
              <span className="craft-icon" style={{ borderColor: itemColor(item.id) }}>
                <ItemIcon itemId={item.id} size={18} />
              </span>
              <div className="craft-info">
                <strong>{item.name}</strong>
                <span className="hint">{purpose(item)}</span>
                <div className="craft-needs">
                  {Object.entries(item.craft!.needs).map(([need, n]) => (
                    <span key={need} className={missing[need] ? "chip missing" : "chip ok"}>
                      {name(need)} {n - (missing[need] ?? 0)}/{n}
                    </span>
                  ))}
                  {item.craft!.fire && (
                    <span className={needFire ? "chip missing" : "chip ok"}>
                      <Flame size={11} aria-hidden /> cạnh lửa trại
                    </span>
                  )}
                </div>
              </div>
              <button className={ready ? "primary" : ""} disabled={!ready} onClick={() => room.send(Messages.craft, { itemId: item.id })}>
                <Hammer size={14} aria-hidden /> Làm
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
