import type { ReactNode } from "react";
import { Flame, Gem, MapPin, Sailboat, Waves, Wheat, Wind, type LucideIcon } from "lucide-react";
import { CAMP, CAMP_RADIUS, TREASURE_SITES, ZONE_LABELS } from "@tentides/content";
import { MAX_RUN_SPEED } from "@tentides/protocol";
import { HULL_TO_SAIL, TREASURE_REVEAL, WEATHER_LABELS, type WeatherId } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { Minimap } from "./Minimap.tsx";
import { Callout, WEATHER_ICONS } from "./ui.tsx";

/** Đường chạy thực tế vòng vèo hơn đường chim bay chừng này lần. */
const PATH_FACTOR = 1.3;

/** Mất bao lâu để chạy về trại, và còn bao lâu nữa thì tối (chỉ tính trong giờ khám phá và hoàng hôn). */
function useReturnTime(room: IslandRoom) {
  return useRoomSnapshot(room, (s) => {
    if (s.phase !== "explore" && s.phase !== "dusk") return null;
    const me = s.players.get(myId(room));
    if (!me?.alive) return null;
    const distance = Math.max(0, Math.hypot(me.x - CAMP.x, me.z - CAMP.z) - CAMP_RADIUS);
    return {
      run: Math.ceil((distance / MAX_RUN_SPEED) * PATH_FACTOR),
      untilNight: s.phase === "explore" ? s.timeLeft + s.duskSeconds : s.timeLeft,
    };
  });
}

function Resource({ icon: Icon, label, color, children, note }: { icon: LucideIcon; label: string; color: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="resource">
      <Icon size={16} style={{ color }} aria-hidden />
      <span className="resource-label">{label}</span>
      <div className="resource-value">{children}</div>
      {note && <div className="resource-note">{note}</div>}
    </div>
  );
}

export function StatusPanel({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    started: st.phase !== "lobby",
    weather: st.weather as WeatherId | "",
    volcano: st.volcano,
    food: st.food,
    treasure: st.treasure,
    hull: st.hull,
    site: st.treasureSite,
    dug: st.treasureDug,
    safe: st.treasureSafe,
    carrier: st.players.get(st.treasureCarrier)?.name ?? "",
  }));
  const { zone, region, swimming, underwater } = useHud();
  const breath = useRoomSnapshot(room, (st) => st.players.get(myId(room))?.breath ?? 100);
  const treasureNote = s.safe
    ? "Rương đã cất ở trại"
    : s.dug
      ? `${s.carrier} đang vác rương`
      : s.site
        ? `Đào ở ${TREASURE_SITES.find((t) => t.id === s.site)?.label ?? "?"} (cần xẻng)`
        : `Đủ ${TREASURE_REVEAL} thì biết chỗ đào`;
  const ret = useReturnTime(room);
  const Weather = s.weather ? WEATHER_ICONS[s.weather] : Waves;
  const hullOk = s.hull >= HULL_TO_SAIL;

  return (
    <section className="panel status">
      <div className="zone">
        <MapPin size={16} aria-hidden />
        <span className="zone-name">{region || ZONE_LABELS[zone]}</span>
      </div>
      {(underwater || breath < 100) && (
        <div className={breath < 30 ? "breath low" : "breath"} title="Nín thở khi lặn. Hết hơi thì đuối nước, mất Máu. Thể lực càng cao nín càng lâu.">
          <Wind size={15} aria-hidden />
          <span>Hơi thở</span>
          <Bar value={breath} max={100} color={breath < 30 ? "var(--danger)" : "#7fd3ff"} />
        </div>
      )}
      {swimming && !underwater && breath >= 100 && <div className="hint">Đang bơi · giữ C để lặn, Space để ngoi lên</div>}
      {ret && ret.run > 0 && (
        <Callout tone={ret.run >= ret.untilNight ? "danger" : ret.run >= ret.untilNight * 0.6 ? "caution" : "info"}>
          {ret.run >= ret.untilNight ? `Không kịp về trại trước khi tối (cần ~${ret.run}s chạy)` : `Về trại ~${ret.run}s chạy · còn ${ret.untilNight}s tới tối`}
        </Callout>
      )}
      <div className="minimap-frame">
        <Minimap room={room} />
        <span className="compass-n" aria-hidden>
          B
        </span>
      </div>
      {s.started && (
        <div className="resources">
          <div className="resource-pair">
            <Resource icon={Weather} label="Thời tiết" color="var(--sky)">
              {s.weather ? WEATHER_LABELS[s.weather] : "–"}
            </Resource>
            <Resource icon={Wheat} label="Lương thực" color="var(--hunger)">
              <strong className={s.food === 0 ? "danger-text" : ""}>{s.food}</strong> phần
            </Resource>
          </div>
          <Resource icon={Flame} label="Núi lửa" color="var(--volcano)">
            <Bar value={s.volcano} max={100} color="var(--volcano)" />
          </Resource>
          <Resource icon={Gem} label="Kho báu" color="var(--treasure)" note={treasureNote}>
            <Bar value={s.treasure} max={100} color="var(--treasure)" />
          </Resource>
          <Resource
            icon={Sailboat}
            label="Thuyền"
            color="var(--hull)"
            note={hullOk ? `Rời đảo được (≥ ${HULL_TO_SAIL})` : <span className="danger-text">Cần ≥ {HULL_TO_SAIL} mới rời đảo được</span>}
          >
            <Bar value={s.hull} max={100} color={hullOk ? "var(--hull)" : "var(--danger)"} marker={HULL_TO_SAIL} />
          </Resource>
        </div>
      )}
    </section>
  );
}
