import { useEffect, useRef, useState } from "react";
import { Pause } from "lucide-react";
import { PHASE_LABELS, TIDAL_PHASES, WATER_LEVEL, seaLevel, tideRising, volcanoStage } from "@tentides/content";
import { MAX_PLAYERS } from "@tentides/protocol";
import { TOTAL_DAYS, WEATHER_LABELS, type Phase, type WeatherId } from "@tentides/rules";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { PHASE_ICONS, WEATHER_ICONS, clock } from "./ui.tsx";

/** Pha mà đồng hồ đếm ngược là chuyện sống còn (về trại, rời đảo): còn ít giờ thì đỏ lên. */
const URGENT_PHASES = new Set<Phase>(["explore", "dusk", "night"]);
const URGENT_SECONDS = 15;

/** Đồng hồ giữa trên cùng: ngày thứ mấy, pha nào, còn bao lâu, và mười vạch cho mười ngày. */
export function PhaseClock({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase as Phase,
    day: st.day,
    timeLeft: st.timeLeft,
    paused: st.paused,
    weather: st.weather as WeatherId | "",
    players: st.players.size,
    // Thủy triều (so với mốc, làm tròn 0,1 m) và núi lửa leo thang của đảo sinh tồn.
    sea: Math.round((seaLevel(st) - WATER_LEVEL) * 10) / 10,
    rising: tideRising(st),
    tidal: st.mode === "story" && TIDAL_PHASES.includes(st.phase),
    stage: st.mode === "story" ? volcanoStage(st.volcano) : 0,
  }));
  const Icon = PHASE_ICONS[s.phase];
  const urgent = URGENT_PHASES.has(s.phase) && s.timeLeft > 0 && s.timeLeft <= URGENT_SECONDS;
  const Weather = s.weather ? WEATHER_ICONS[s.weather] : null;

  if (s.phase === "lobby") {
    return (
      <div className="clock">
        <Icon size={18} aria-hidden />
        <span className="clock-phase">{PHASE_LABELS.lobby}</span>
        <span className="clock-sep" />
        <span className="clock-time">
          {s.players}/{MAX_PLAYERS}
        </span>
      </div>
    );
  }

  return (
    <div className={`clock phase-${s.phase}${urgent ? " urgent" : ""}`}>
      <div className="clock-row">
        <Icon size={18} aria-hidden />
        <span className="clock-day">
          Ngày <strong>{s.day}</strong>
          <small>/{TOTAL_DAYS}</small>
        </span>
        <span className="clock-phase">{PHASE_LABELS[s.phase]}</span>
        {Weather && s.weather && (
          <span className="clock-weather" title={WEATHER_LABELS[s.weather]}>
            <Weather size={16} aria-hidden />
          </span>
        )}
        <span className="clock-sep" />
        {s.paused ? (
          <span className="clock-time">
            <Pause size={14} aria-hidden /> dừng
          </span>
        ) : (
          <span className="clock-time">{s.timeLeft > 0 ? clock(s.timeLeft) : "–"}</span>
        )}
      </div>
      {s.tidal && (
        <div className="clock-hazards">
          <span className={s.rising && s.sea > 0.4 ? "warn" : ""} title="Mực nước biển so với mốc">
            {s.rising ? "Triều lên ↑" : "Triều rút ↓"} {s.sea > 0 ? "+" : ""}
            {s.sea.toFixed(1).replace(".", ",")} m
          </span>
          {s.stage >= 2 && <span className="danger">{s.stage === 3 ? "Núi lửa phun trào!" : "Núi lửa rung chuyển"}</span>}
        </div>
      )}
      <div className="tides" aria-label={`Ngày ${s.day} trên ${TOTAL_DAYS}`}>
        {Array.from({ length: TOTAL_DAYS }, (_, i) => (
          <span key={i} className={i + 1 < s.day ? "tide past" : i + 1 === s.day ? "tide now" : "tide"} />
        ))}
      </div>
    </div>
  );
}

interface Splash {
  key: number;
  kicker: string;
  title: string;
  phase: Phase;
}

/** Chữ lớn hiện lên vài giây khi đổi pha, để ai cũng biết trời vừa sáng hay vừa tối. */
export function PhaseSplash({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({ phase: st.phase as Phase, day: st.day, weather: st.weather as WeatherId | "" }));
  const [splash, setSplash] = useState<Splash | null>(null);
  const last = useRef<Phase | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Chỉ chạy khi đổi pha; ngày và thời tiết đọc từ lần render đó (đổi cùng lúc với pha bình minh).
  useEffect(() => {
    const prev = last.current;
    last.current = s.phase;
    // Lần đầu vào phòng (kể cả vào lại giữa ván) thì không bật chữ.
    if (prev === null) return;
    const weather = s.weather ? WEATHER_LABELS[s.weather] : "";
    const text: Partial<Record<Phase, [string, string]>> = {
      dawn: [s.day === TOTAL_DAYS ? "Ngày cuối cùng" : weather, `Ngày ${s.day}`],
      explore: ["Trời sáng hẳn", "Lên đường"],
      dusk: [s.day === TOTAL_DAYS ? "Thuyền sắp rời bến" : "Mau về trại", "Hoàng hôn"],
      night: ["Quây quần bên đống lửa", "Đêm xuống"],
    };
    const t = text[s.phase];
    if (!t) return;
    setSplash({ key: Date.now(), kicker: t[0], title: t[1], phase: s.phase });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSplash(null), 2800);
  }, [s.phase]);

  if (!splash) return null;
  return (
    <div key={splash.key} className={`splash phase-${splash.phase}`} aria-live="polite">
      <div className="splash-kicker">{splash.kicker}</div>
      <div className="splash-title">{splash.title}</div>
    </div>
  );
}
