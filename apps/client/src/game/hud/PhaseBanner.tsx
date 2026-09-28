import { useState, type ReactNode } from "react";
import { DIFFICULTY_LABELS } from "@tentides/content";
import { Messages, NIGHT_SECONDS_OPTIONS } from "@tentides/protocol";
import { DIFFICULTY_IDS, TOTAL_DAYS, WEATHER_LABELS, type Difficulty, type WeatherId } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { usePrivateStory, useStory } from "./Story.tsx";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

function LobbySettings({ room, isHost, difficulty, nightSeconds }: { room: IslandRoom; isHost: boolean; difficulty: Difficulty; nightSeconds: number }) {
  if (!isHost) {
    return (
      <div className="hint">
        Độ khó {DIFFICULTY_LABELS[difficulty].title} · đêm dài {nightSeconds} giây
      </div>
    );
  }
  return (
    <div className="settings">
      <label>
        Độ khó
        <select value={difficulty} onChange={(e) => room.send(Messages.settings, { difficulty: e.target.value as Difficulty })}>
          {DIFFICULTY_IDS.map((id) => (
            <option key={id} value={id}>
              {DIFFICULTY_LABELS[id].title} · {DIFFICULTY_LABELS[id].detail}
            </option>
          ))}
        </select>
      </label>
      <label>
        Đêm dài
        <select value={nightSeconds} onChange={(e) => room.send(Messages.settings, { nightSeconds: Number(e.target.value) as 60 })}>
          {NIGHT_SECONDS_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} giây{n === 60 ? " (có voice call)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function PhaseBanner({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    day: st.day,
    timeLeft: st.timeLeft,
    weather: st.weather as WeatherId | "",
    volcano: st.volcano,
    isHost: st.hostId === me,
    hostName: st.players.get(st.hostId)?.name ?? "",
    players: st.players.size,
    difficulty: st.difficulty as Difficulty,
    nightSeconds: st.nightSeconds,
    readyCount: st.readyCount,
    readyNeeded: st.readyNeeded,
    alive: st.players.get(me)?.alive ?? false,
  }));
  const [readyDay, setReadyDay] = useState(0);
  const dawnStory = useStory(room, s.day, "dawn");
  const duskStory = useStory(room, s.day, "dusk");
  const myStory = usePrivateStory(s.day);
  const lastDay = s.day === TOTAL_DAYS;

  let body: ReactNode = null;
  if (s.phase === "lobby") {
    body = (
      <>
        {s.isHost ? <div>Đợi đủ bạn rồi bắt đầu. Một ngày kéo dài khoảng 5 phút.</div> : <div>Đang chờ {s.hostName} bắt đầu ván…</div>}
        <LobbySettings room={room} isHost={s.isHost} difficulty={s.difficulty} nightSeconds={s.nightSeconds} />
        {s.isHost && (
          <button className="primary" onClick={() => room.send(Messages.start)}>
            Bắt đầu ván ({s.players} người)
          </button>
        )}
      </>
    );
  } else if (s.phase === "dawn") {
    const imReady = readyDay === s.day;
    body = (
      <>
        <strong>
          Ngày {s.day} · {s.weather ? WEATHER_LABELS[s.weather] : ""} · Núi lửa {s.volcano}%
        </strong>
        {dawnStory && <p className="story">{dawnStory}</p>}
        {myStory && <p className="story private-line">{myStory}</p>}
        <div className="hint">Cột sáng là nơi có chuyện đang chờ. Bàn nhau chia ra đi đâu, còn {s.timeLeft}s là trời sáng hẳn.</div>
        {lastDay && <div className="warning">Ngày cuối: tối nay thuyền rời bến, núi lửa phun. Ai không ở trại sẽ bị bỏ lại.</div>}
        {s.alive && (
          <button
            className={imReady ? "primary" : ""}
            onClick={() => {
              setReadyDay(imReady ? 0 : s.day);
              room.send(Messages.ready);
            }}
          >
            {imReady ? "Đã sẵn sàng" : "Sẵn sàng lên đường"} ({s.readyCount}/{s.readyNeeded})
          </button>
        )}
      </>
    );
  } else if (s.phase === "dusk") {
    body = (
      <>
        <strong>{lastDay ? `Thuyền rời bến trong ${s.timeLeft}s!` : `Hoàng hôn · về trại trong ${s.timeLeft}s`}</strong>
        <div>
          {lastDay
            ? "Ai không có mặt ở trại lúc thuyền đi sẽ bị bỏ lại cùng núi lửa."
            : "Ai ở ngoài lúc trời tối phải ngủ ngoài: mất sức, không được ăn, không được ngồi bàn với cả trại."}
        </div>
      </>
    );
  } else if (s.phase === "night") {
    body = (
      <>
        <strong>Đêm · còn {s.timeLeft}s</strong>
        {duskStory ? <p className="story">{duskStory}</p> : <div>Quây quần bên đống lửa: bàn chuyện, chia khẩu phần, và quyết định có trói ai không.</div>}
      </>
    );
  }
  // Hai pha chuẩn bị có màn riêng che cả màn hình.
  if (!body || s.phase === "create" || s.phase === "pack") return null;
  return <section className="panel banner">{body}</section>;
}
