import { useState } from "react";
import { Backpack, ChevronDown, ChevronUp, Drumstick, Heart, History, Smile, Zap, type LucideIcon } from "lucide-react";
import { BACKGROUND_LABELS, FLAW_LABELS } from "@tentides/content";
import { STAT_IDS, STAT_LABELS } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useStamina } from "../hudStore.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { itemName, signed, statReason } from "./format.ts";
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
  // Sức bền hồi liên tục nên nằm ở kho riêng: chỉ dòng này render lại, cả bảng không.
  const sprint = useStamina();
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
      <StatLog />
    </section>
  );
}

const STAT_SHORT = { hp: ["Máu", "var(--hp)"], hunger: ["No", "var(--hunger)"], morale: ["Tinh thần", "var(--morale)"], stamina: ["Sức bền", "var(--stamina)"] } as const;

/** Nhật ký chỉ số của riêng mình: mấy lần được mất gần nhất và vì sao. Bấm để mở rộng. */
function StatLog() {
  const view = usePrivate();
  const [open, setOpen] = useState(false);
  const log = view?.statLog ?? [];
  if (log.length === 0) return null;
  const shown = [...log].reverse().slice(0, open ? 14 : 3);
  return (
    <div className={open ? "stat-log open" : "stat-log"}>
      <button className="stat-log-head" onClick={() => setOpen(!open)}>
        <History size={13} aria-hidden /> Được mất gần đây
        {(view?.failStreak ?? 0) >= 1 && <span className="hint"> · trượt {view!.failStreak} lần liền</span>}
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
      </button>
      {shown.map((c, i) => (
        <div key={log.length - i} className="stat-log-line">
          <span className="feed-day">N{c.day}</span>
          <span className="stat-log-reason">{statReason(c.reason)}</span>
          <span className="stat-log-deltas">
            {(Object.keys(STAT_SHORT) as (keyof typeof STAT_SHORT)[])
              .filter((k) => c[k])
              .map((k) => (
                <span key={k} style={{ color: STAT_SHORT[k][1] }} className={c[k]! > 0 ? "up" : "down"}>
                  {signed(c[k]!)} {STAT_SHORT[k][0]}
                </span>
              ))}
          </span>
        </div>
      ))}
    </div>
  );
}
