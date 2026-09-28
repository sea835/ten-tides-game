import { CAMP, CAMP_RADIUS, PHASE_LABELS, TREASURE_SITES, ZONE_LABELS } from "@tentides/content";
import { MAX_RUN_SPEED } from "@tentides/protocol";
import { HULL_TO_SAIL, TOTAL_DAYS, TREASURE_REVEAL, WEATHER_LABELS, type Phase, type WeatherId } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useHud } from "../hudStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Bar } from "./Bar.tsx";
import { Minimap } from "./Minimap.tsx";

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

export function StatusPanel({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase as Phase,
    day: st.day,
    timeLeft: st.timeLeft,
    paused: st.paused,
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
  const { zone, deepWater } = useHud();
  const treasureNote = s.safe
    ? "Rương đã cất ở trại"
    : s.dug
      ? `${s.carrier} đang vác rương`
      : s.site
        ? `Đào ở: ${TREASURE_SITES.find((t) => t.id === s.site)?.label ?? "?"} (cần xẻng)`
        : `Đủ ${TREASURE_REVEAL} thì biết chỗ đào`;
  const ret = useReturnTime(room);
  const started = s.phase !== "lobby";

  return (
    <section className="panel status">
      <div className="label">
        {started ? `Ngày ${s.day}/${TOTAL_DAYS} · ` : ""}
        {PHASE_LABELS[s.phase]}
        {s.timeLeft > 0 && ` · ${s.timeLeft}s`}
        {s.paused && " · tạm dừng"}
      </div>
      <div className="zone-name">{ZONE_LABELS[zone]}</div>
      {deepWater && <div className="warning">Nước sâu quá, chưa bơi được.</div>}
      {ret && ret.run > 0 && (
        <div className={ret.run >= ret.untilNight ? "warning" : ret.run >= ret.untilNight * 0.6 ? "caution" : "hint"}>
          {ret.run >= ret.untilNight
            ? `Không kịp về trại trước khi tối (cần ~${ret.run}s chạy)`
            : `Về trại: ~${ret.run}s chạy · còn ${ret.untilNight}s tới tối`}
        </div>
      )}
      <Minimap room={room} />
      {started && (
        <dl className="team">
          <dt>Thời tiết</dt>
          <dd>{s.weather ? WEATHER_LABELS[s.weather] : "–"}</dd>
          <dt>Núi lửa</dt>
          <dd>
            <Bar value={s.volcano} max={100} color="#ff6b35" />
          </dd>
          <dt>Lương thực</dt>
          <dd>{s.food} khẩu phần</dd>
          <dt>Kho báu</dt>
          <dd>
            <Bar value={s.treasure} max={100} color="#f3a712" />
          </dd>
          <dd className="team-note">{treasureNote}</dd>
          <dt>Thuyền</dt>
          <dd>
            <Bar value={s.hull} max={100} color={s.hull < HULL_TO_SAIL ? "#e4572e" : "#669bbc"} />
          </dd>
          <dd className="team-note">
            {s.hull < HULL_TO_SAIL ? `Cần ≥ ${HULL_TO_SAIL} mới rời đảo được!` : `Rời đảo được (≥ ${HULL_TO_SAIL})`}
          </dd>
        </dl>
      )}
    </section>
  );
}
