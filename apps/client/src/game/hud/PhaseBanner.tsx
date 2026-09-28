import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Dices, Map as MapIcon, Play, Sunrise } from "lucide-react";
import { DIFFICULTY_LABELS } from "@tentides/content";
import { Messages, NIGHT_SECONDS_OPTIONS } from "@tentides/protocol";
import { DIFFICULTY_IDS, TOTAL_DAYS, type Difficulty } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { usePrivateStory, useStory } from "./Story.tsx";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { useWorld } from "../world.ts";
import { Callout } from "./ui.tsx";

/** Bản đồ theo seed: ai cũng thấy seed để chia sẻ; chủ phòng gõ seed khác hoặc gieo ngẫu nhiên. */
function MapSeed({ room, isHost }: { room: IslandRoom; isHost: boolean }) {
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const world = useWorld(room);
  const [draft, setDraft] = useState("");
  const summary = `${world.islets.length} đảo nhỏ · ${world.structures.filter((s) => s.kind === "cave").length} hang · ${world.structures.filter((s) => s.kind === "mine").length} hầm mỏ`;
  const send = (value: number) => room.send(Messages.settings, { worldSeed: value });
  if (!isHost) {
    return (
      <span title={summary}>
        Bản đồ <strong>#{seed}</strong>
      </span>
    );
  }
  return (
    <div className="setting">
      <span className="label">
        <MapIcon size={13} aria-hidden /> Bản đồ #{seed}
      </span>
      <div className="seed-row">
        <input
          inputMode="numeric"
          placeholder="Nhập seed"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 10))}
          onKeyDown={(e) => {
            const n = Number(draft);
            if (e.key === "Enter" && n >= 1 && n <= 0xffffffff) send(n);
          }}
        />
        <button title="Gieo bản đồ ngẫu nhiên" onClick={() => send(crypto.getRandomValues(new Uint32Array(1))[0]! || 1)}>
          <Dices size={15} aria-hidden /> Gieo lại
        </button>
      </div>
      <span className="hint">{summary}. Cùng seed là cùng đảo nhỏ, hang, hầm, easter egg và sinh vật.</span>
    </div>
  );
}

function LobbySettings({ room, isHost, difficulty, nightSeconds }: { room: IslandRoom; isHost: boolean; difficulty: Difficulty; nightSeconds: number }) {
  if (!isHost) {
    return (
      <div className="settings readonly">
        <span>
          Độ khó <strong>{DIFFICULTY_LABELS[difficulty].title}</strong>
        </span>
        <span>
          Đêm dài <strong>{nightSeconds} giây</strong>
        </span>
        <MapSeed room={room} isHost={false} />
      </div>
    );
  }
  return (
    <div className="settings">
      <div className="setting">
        <span className="label">Độ khó</span>
        <div className="segmented">
          {DIFFICULTY_IDS.map((id) => (
            <button
              key={id}
              className={difficulty === id ? "selected" : ""}
              title={DIFFICULTY_LABELS[id].detail}
              onClick={() => room.send(Messages.settings, { difficulty: id })}
            >
              {DIFFICULTY_LABELS[id].title}
            </button>
          ))}
        </div>
        <span className="hint">{DIFFICULTY_LABELS[difficulty].detail}</span>
      </div>
      <div className="setting">
        <span className="label">Đêm dài</span>
        <div className="segmented">
          {NIGHT_SECONDS_OPTIONS.map((n) => (
            <button key={n} className={nightSeconds === n ? "selected" : ""} onClick={() => room.send(Messages.settings, { nightSeconds: n })}>
              {n}s
            </button>
          ))}
        </div>
        <span className="hint">{nightSeconds === 60 ? "Hợp với nhóm có voice call" : "Thêm thời gian để chat bằng chữ"}</span>
      </div>
      <MapSeed room={room} isHost />
    </div>
  );
}

export function PhaseBanner({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    day: st.day,
    timeLeft: st.timeLeft,
    isHost: st.hostId === me,
    hostName: st.players.get(st.hostId)?.name ?? "",
    players: st.players.size,
    difficulty: st.difficulty as Difficulty,
    nightSeconds: st.nightSeconds,
    readyCount: st.readyCount,
    readyNeeded: st.readyNeeded,
    alive: st.players.get(me)?.alive ?? false,
    atCampfire: [...st.campers].includes(me),
  }));
  const [readyDay, setReadyDay] = useState(0);
  const [folded, setFolded] = useState(false);
  const dawnStory = useStory(room, s.day, "dawn");
  const duskStory = useStory(room, s.day, "dusk");
  const myStory = usePrivateStory(s.day);
  const lastDay = s.day === TOTAL_DAYS;

  let body: ReactNode = null;
  let story: ReactNode = null;
  if (s.phase === "lobby") {
    body = (
      <>
        <h2 className="banner-title">{s.isHost ? "Chuẩn bị ra khơi" : `Đang chờ ${s.hostName} nhổ neo…`}</h2>
        <div className="hint">2–6 người · 10 ngày trên đảo · một ngày chừng 5 phút · có thể có kẻ phản bội</div>
        <LobbySettings room={room} isHost={s.isHost} difficulty={s.difficulty} nightSeconds={s.nightSeconds} />
        {s.isHost && (
          <button className="primary big" onClick={() => room.send(Messages.start)}>
            <Play size={18} aria-hidden /> Bắt đầu ván ({s.players} người)
          </button>
        )}
      </>
    );
  } else if (s.phase === "dawn") {
    const imReady = readyDay === s.day;
    story = (
      <>
        {dawnStory && <p className="story">{dawnStory}</p>}
        {myStory && <p className="story private-line">{myStory}</p>}
      </>
    );
    body = (
      <>
        <div className="hint">Cột sáng là nơi có chuyện đang chờ. Bàn nhau chia ra đi đâu trước khi trời sáng hẳn.</div>
        {lastDay && <Callout tone="danger">Ngày cuối: tối nay thuyền rời bến, núi lửa phun. Ai không ở trại sẽ bị bỏ lại.</Callout>}
        {s.alive && (
          <button
            className={imReady ? "ready done" : "primary"}
            onClick={() => {
              setReadyDay(imReady ? 0 : s.day);
              room.send(Messages.ready);
            }}
          >
            {imReady ? <Check size={16} aria-hidden /> : <Sunrise size={16} aria-hidden />}
            {imReady ? "Đã sẵn sàng" : "Sẵn sàng lên đường"}
            <span className="count">
              {s.readyCount}/{s.readyNeeded}
            </span>
          </button>
        )}
      </>
    );
  } else if (s.phase === "dusk") {
    body = (
      <Callout tone={lastDay ? "danger" : "caution"}>
        <strong>{lastDay ? `Thuyền rời bến trong ${s.timeLeft}s!` : `Về trại trong ${s.timeLeft}s`}</strong>
        <br />
        {lastDay
          ? "Ai không có mặt ở trại lúc thuyền đi sẽ bị bỏ lại cùng núi lửa."
          : "Ai ở ngoài lúc trời tối phải ngủ ngoài: mất sức, không được ăn, không được ngồi bàn với cả trại."}
      </Callout>
    );
  } else if (s.phase === "night" && !(s.alive && s.atCampfire)) {
    // Người ngồi quanh đống lửa đọc truyện ngay trong khung lửa trại.
    story = duskStory ? <p className="story">{duskStory}</p> : null;
  }

  if (!body && !story) return null;
  return (
    <section className={`panel banner phase-${s.phase}${folded ? " folded" : ""}`}>
      {story && (
        <div className="banner-story">
          <button className="fold" title={folded ? "Mở lời kể" : "Thu gọn lời kể"} onClick={() => setFolded(!folded)}>
            {folded ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
            {folded ? "Lời kể hôm nay" : null}
          </button>
          {!folded && story}
        </div>
      )}
      {body}
    </section>
  );
}
