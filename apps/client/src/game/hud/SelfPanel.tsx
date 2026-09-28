import { Backpack, Drumstick, Heart, Smile, Zap, type LucideIcon } from "lucide-react";
import { BACKGROUND_LABELS, FLAW_LABELS } from "@tentides/content";
import { STAT_IDS, STAT_LABELS } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { itemName } from "./format.ts";
import { RoleCard } from "./RoleCard.tsx";
import { Avatar, Callout } from "./ui.tsx";

function Vital({ icon: Icon, label, value, max, color, marker, title }: {
  icon: LucideIcon;
  label: string;
  value: number;
  max: number;
  color: string;
  marker?: number;
  title?: string;
}) {
  return (
    <div className="vital" title={title}>
      <Icon size={15} style={{ color }} aria-hidden />
      <span className="vital-label">{label}</span>
      <Bar value={value} max={max} color={color} marker={marker} />
      <span className="vital-value">{Math.round(value)}</span>
    </div>
  );
}

export function SelfPanel({ room }: { room: IslandRoom }) {
  const me = useRoomSnapshot(room, (s) => {
    const p = s.players.get(myId(room));
    // Ở sảnh chỉ là nhân vật tạm, chưa có gì đáng xem.
    if (!p || p.maxHp === 0 || s.phase === "lobby") return null;
    return {
      name: p.name,
      color: p.color,
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
    <section className={me.alive ? "panel self" : "panel self ghost"}>
      <header className="self-head">
        <Avatar name={me.name} color={me.color} size="lg" dim={!me.alive} />
        <div className="self-id">
          <strong>{me.name}</strong>
          <span className="hint">
            {BACKGROUND_LABELS[me.background as keyof typeof BACKGROUND_LABELS]?.title} · {FLAW_LABELS[me.flaw as keyof typeof FLAW_LABELS]?.title}
          </span>
        </div>
      </header>
      <RoleCard room={room} />
      {!me.alive && <Callout tone="danger">Bạn đã gục ngã. Hồn ma vẫn đi lại được và nói chuyện với nhau.</Callout>}
      {me.lost && <Callout tone="caution">Bạn đang lạc, không mở được sự kiện nào tới hoàng hôn.</Callout>}
      {me.tied && <Callout tone="danger">Bạn bị cả trại trói: không ra khỏi trại, không mở được sự kiện, tới hoàng hôn mới được thả.</Callout>}
      {me.overweight && <Callout tone="caution">Balo quá tải: đi chậm, đói nhanh hơn.</Callout>}
      <div className="vitals">
        <Vital icon={Heart} label="Máu" value={me.hp} max={me.maxHp} color="var(--hp)" />
        <Vital icon={Drumstick} label="No" value={me.hunger} max={100} color="var(--hunger)" />
        <Vital icon={Smile} label="Tinh thần" value={me.morale} max={100} color="var(--morale)" />
        <Vital
          icon={Zap}
          label="Sức bền"
          value={sprint}
          max={100}
          color="var(--stamina)"
          marker={me.stamina < 100 ? me.stamina : undefined}
          title="Chạy (Shift) tốn sức bền; đứng hoặc đi bộ thì hồi. Mệt trong ngày thì vạch giới hạn lùi lại."
        />
      </div>
      <div className="stat-chips">
        {me.stats.map(([id, v]) => (
          <span key={id} className="stat-chip">
            {STAT_LABELS[id]} <strong>{v}</strong>
          </span>
        ))}
      </div>
      <div className="items-row">
        <Backpack size={15} aria-hidden />
        <div className="items">
          {view?.bag.length ? view.bag.map((b) => <span key={b.uid}>{itemName(b.itemId)}</span>) : <span className="hint">Balo trống</span>}
        </div>
        <kbd title="Xem lưới balo">B</kbd>
      </div>
    </section>
  );
}
