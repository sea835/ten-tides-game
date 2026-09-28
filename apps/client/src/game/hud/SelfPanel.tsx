import { STAT_IDS, STAT_LABELS } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { usePrivate } from "../privateStore.ts";
import { BACKGROUND_LABELS, FLAW_LABELS } from "@tentides/content";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { itemName } from "./format.ts";
import { RoleCard } from "./RoleCard.tsx";

export function SelfPanel({ room }: { room: IslandRoom }) {
  const me = useRoomSnapshot(room, (s) => {
    const p = s.players.get(myId(room));
    if (!p || p.maxHp === 0) return null;
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      hunger: p.hunger,
      morale: p.morale,
      stamina: p.stamina,
      alive: p.alive,
      lost: p.lost,
      tied: p.tied,
      stats: STAT_IDS.map((id) => [id, p.stats.get(id) ?? 0] as const),
      background: p.background,
      flaw: p.flaw,
      overweight: p.overweight,
    };
  });
  const view = usePrivate();
  const { sprint } = useHud();
  if (!me) return null;

  return (
    <section className="panel self">
      <RoleCard room={room} />
      {!me.alive && <div className="warning">Bạn đã gục ngã. Hồn ma vẫn đi lại được và nói chuyện với nhau.</div>}
      {me.lost && <div className="warning">Bạn đang lạc, không mở được sự kiện nào tới hoàng hôn.</div>}
      {me.tied && <div className="warning">Bạn bị cả trại trói: không ra khỏi trại, không mở được sự kiện, tới hoàng hôn mới được thả.</div>}
      <div className="vitals">
        <span>Máu</span>
        <Bar value={me.hp} max={me.maxHp} color="#e4572e" />
        <span>No</span>
        <Bar value={me.hunger} max={100} color="#f3a712" />
        <span>Tinh thần</span>
        <Bar value={me.morale} max={100} color="#8a4fff" />
        <span title="Chạy (Shift) tốn sức bền; đứng hoặc đi bộ thì hồi. Mệt trong ngày thì thanh ngắn lại.">Sức bền</span>
        <div className="stamina">
          <Bar value={sprint} max={100} color="#2a9d8f" />
          {me.stamina < 100 && <div className="stamina-cap" style={{ left: `${me.stamina}%` }} title="Giới hạn hôm nay" />}
        </div>
      </div>
      <div className="stats">
        {me.stats.map(([id, v]) => (
          <span key={id}>
            {STAT_LABELS[id]} <strong>{v}</strong>
          </span>
        ))}
      </div>
      <div className="hint">
        {BACKGROUND_LABELS[me.background as keyof typeof BACKGROUND_LABELS]?.title} · {FLAW_LABELS[me.flaw as keyof typeof FLAW_LABELS]?.title}
        {me.overweight && <span className="warning-inline"> · quá tải</span>}
      </div>
      <div className="label">Balo · B để xem lưới</div>
      <div className="items">{view?.bag.length ? view.bag.map((b) => <span key={b.uid}>{itemName(b.itemId)}</span>) : "Trống"}</div>
    </section>
  );
}
