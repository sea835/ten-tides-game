import { useEffect, useState } from "react";
import { ADRENALINE, AMMO_BOX, CLASSES, GADGETS, SOLDIER_CLASS_IDS, SPOT, isSoldierClass, vehicleSpec, type SoldierClass } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { GADGET_KEY_LABEL, gadgetFx, gadgetSlots, heldGadget, repairTarget } from "./gadgets.ts";
import { stance } from "./runtime.ts";
import "./gadgets.css";

// Giao diện khí tài lớp lính: ô khí tài (phím 0) cạnh ô súng, thanh Adrenaline, khung ống nhòm, thanh máu xe đang
// sửa, dòng "đang nhận tiếp tế" cạnh hộp đạn; chọn lớp lính ở sảnh; biểu tượng lớp trên bảng điểm.

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => (n + 1) % 1e6), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/** Ký hiệu lớp lính (bảng điểm, danh sách đội). */
export function ClassIcon({ cls }: { cls: string }) {
  if (!isSoldierClass(cls)) return null;
  const c = CLASSES[cls];
  return (
    <i className={`g-class c-${cls}`} title={c.name}>
      {c.icon}
    </i>
  );
}

/** Ô khí tài (nằm trong cột ô súng góc phải dưới). */
export function GadgetSlots({ room }: { room: IslandRoom }) {
  useTick(250);
  const me = room.state.players.get(myId(room));
  const slots = gadgetSlots(room, me);
  if (!me || !slots.length) return null;
  const now = performance.now();
  return (
    <div className="g-slots">
      {slots.map((g) => {
        const def = GADGETS[g.id];
        const wait = Math.max(0, ((gadgetFx.readyAt[g.id] ?? 0) - now) / 1000);
        return (
          <div key={g.slot} className={`b-slot g-slot ${me.kit.active === g.slot ? "on" : ""} ${g.left === 0 ? "empty" : ""}`} title={def.info}>
            <kbd>{GADGET_KEY_LABEL}</kbd>
            <span>
              {def.icon} {def.name}
              {g.left >= 0 && <b> ×{g.left}</b>}
            </span>
            {wait > 0.05 && <em className="g-wait" style={{ width: `${Math.min(100, (wait / def.cooldown) * 100)}%` }} />}
          </div>
        );
      })}
    </div>
  );
}

/** Các lớp phủ khi dùng khí tài: ống nhòm, Adrenaline, sửa xe, nhận tiếp tế. */
export function GadgetHud({ room }: { room: IslandRoom }) {
  useTick(100);
  const me = room.state.players.get(myId(room));
  if (!me?.alive || me.vehicle) return null;
  const held = heldGadget(room, me);
  const binoc = held === "binoculars" && stance.aiming;
  const boost = me.gear.boost;
  // Xe đang sửa (giữ chuột trái) hay xe sửa được ở gần (đang cầm mỏ lết).
  const vid = held === "repair" ? gadgetFx.repairVid || repairTarget(room, me.team) : "";
  const v = vid ? room.state.vehicles.get(vid) : undefined;
  // Đứng cạnh hộp tiếp đạn phe mình.
  let supply = false;
  if (me.team)
    for (const t of room.state.traps.values())
      if (t.defId === "ammobox" && t.team === me.team && Math.hypot(t.x - localPosition.x, t.z - localPosition.z) <= AMMO_BOX.radius && Math.abs(t.y - localPosition.y) < 2) supply = true;
  return (
    <>
      {binoc && (
        <div className="g-binoc">
          <div className="g-binoc-mask" />
          <div className="g-binoc-mil" />
          <p>
            ×{SPOT.zoom} · Chuột trái: đánh dấu địch, xe địch cho cả đội ({SPOT.seconds} giây)
          </p>
        </div>
      )}
      {boost > 0 && (
        <div className="g-boost">
          <span>💉 Adrenaline</span>
          <i>
            <u style={{ width: `${(boost / ADRENALINE.seconds) * 100}%` }} />
          </i>
        </div>
      )}
      {v && (
        <div className="b-progress g-repair">
          🔧 {gadgetFx.repairVid ? "Đang sửa xe" : "Giữ chuột trái để sửa xe"} · {Math.round((v.hp / vehicleSpec(v.kind).hp) * 100)}%
          <i>
            <u style={{ width: `${(v.hp / vehicleSpec(v.kind).hp) * 100}%` }} />
          </i>
        </div>
      )}
      {held === "repair" && !v && <div className="b-progress g-repair muted">🔧 Đứng sát xe phe mình bị hư để sửa</div>}
      {supply && <div className="g-supply">▤ Đang nhận tiếp tế đạn dược</div>}
    </>
  );
}

/** Sảnh (Đồng đội, Chiến trường): chọn lớp lính cho trận tới. */
export function ClassPicker({ room }: { room: IslandRoom }) {
  const cls = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.gear.cls ?? "");
  const mode = useRoomSnapshot(room, (s) => s.battleMode);
  const aa = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.gear.aa ?? false);
  if (mode !== "war" && mode !== "squad") return null;
  const pick = (c: SoldierClass) => room.send(Messages.pickClass, { cls: c });
  const current = isSoldierClass(cls) ? cls : "assault";
  return (
    <div className="g-picker">
      <h4>Lớp lính {mode === "squad" ? "của đội trưởng" : "khi xuất kích"}</h4>
      <div className="g-picker-list">
        {SOLDIER_CLASS_IDS.map((c) => {
          const def = CLASSES[c];
          return (
            <button key={c} className={current === c ? "on" : ""} aria-pressed={current === c} onClick={() => pick(c)}>
              <b>
                <ClassIcon cls={c} /> {def.name}
              </b>
              <small>{def.info}</small>
            </button>
          );
        })}
      </div>
      {current === "engineer" && (
        <div className="g-picker-list">
          {/* Kỹ Thuật: ống phóng chống tăng hay tên lửa vác vai phòng không (diệt trực thăng). */}
          {([false, true] as const).map((on) => (
            <button key={String(on)} className={aa === on ? "on" : ""} aria-pressed={aa === on} onClick={() => room.send(Messages.pickClass, { cls: "engineer", aa: on })}>
              <b>{on ? "🚀 Tên lửa vác vai IGLA" : "⊳ RPG-7"}</b>
              <small>{on ? "Ngắm giữ tâm ~1,5 giây khoá trực thăng rồi bắn: tên lửa tự đuổi theo" : "Đạn nổ chống tăng, phá xe, phá tường"}</small>
            </button>
          ))}
        </div>
      )}
      <p className="muted">Phím {GADGET_KEY_LABEL}: rút khí tài (bấm lần nữa đổi khí tài thứ hai) · chuột trái: dùng</p>
    </div>
  );
}
