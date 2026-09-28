import { useEffect, useState } from "react";
import { BACKGROUND_LABELS, FLAW_LABELS, content } from "@tentides/content";
import { Messages, PLAYER_COLORS } from "@tentides/protocol";
import {
  BACKGROUNDS,
  BACKGROUND_IDS,
  BIO_MAX_LENGTH,
  FLAW_IDS,
  FLAW_POINTS,
  STAT_IDS,
  STAT_LABELS,
  STAT_MAX,
  STAT_MIN,
  STAT_POINTS,
  type BackgroundId,
  type FlawId,
  type Stats,
} from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

const TOTAL = STAT_POINTS + FLAW_POINTS;
const STAT_HINTS: Record<keyof Stats, string> = {
  strength: "Máu tối đa, sức mang balo, chạy lâu",
  dexterity: "Lén lút, sửa chữa, câu cá",
  intellect: "Bản đồ, giải đố, canh gác",
  charisma: "Mặc cả, thuyết phục",
  nerve: "Tinh thần, chịu đựng",
};

/** Pha tạo nhân vật: chia điểm, chọn xuất thân, tật xấu, dòng tự mô tả và màu áo. */
export function CharacterCreator({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    timeLeft: st.timeLeft,
    readyCount: st.readyCount,
    readyNeeded: st.readyNeeded,
    created: st.players.get(me)?.created ?? false,
    myColor: st.players.get(me)?.color ?? "",
    takenColors: [...st.players.entries()].filter(([id]) => id !== me).map(([, p]) => p.color),
  }));
  const [stats, setStats] = useState<Stats>({ strength: 4, dexterity: 4, intellect: 3, charisma: 3, nerve: 3 });
  const [background, setBackground] = useState<BackgroundId>("old_sailor");
  const [flaw, setFlaw] = useState<FlawId>("fear_dark");
  const [bio, setBio] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (s.phase === "create" && document.pointerLockElement) document.exitPointerLock();
  }, [s.phase]);

  if (s.phase !== "create") return null;
  const used = STAT_IDS.reduce((sum, id) => sum + stats[id], 0);
  const left = TOTAL - used;
  const chosenColor = color ?? (s.takenColors.includes(s.myColor) ? PLAYER_COLORS.find((c) => !s.takenColors.includes(c))! : s.myColor);
  const bump = (id: keyof Stats, delta: number) => {
    const next = stats[id] + delta;
    if (next < STAT_MIN || next > STAT_MAX || (delta > 0 && left <= 0)) return;
    setStats({ ...stats, [id]: next });
  };
  const submit = () => {
    room.send(Messages.createCharacter, { stats, background, flaw, bio: bio.trim(), color: chosenColor as (typeof PLAYER_COLORS)[number] });
    if (!sent) room.send(Messages.ready);
    setSent(true);
  };

  return (
    <div className="prep-screen">
      <div className="panel prep-card creator">
        <header className="prep-header">
          <h2>Tạo nhân vật</h2>
          <span className="event-timer">{s.timeLeft}s</span>
        </header>

        <section>
          <div className="label">
            Thuộc tính · chia {TOTAL} điểm ({STAT_POINTS} + {FLAW_POINTS} nhờ tật xấu), mỗi thuộc tính {STAT_MIN}–{STAT_MAX} · còn{" "}
            <strong className={left === 0 ? "" : "warning-inline"}>{left}</strong>
          </div>
          <div className="stat-rows">
            {STAT_IDS.map((id) => (
              <div key={id} className="stat-row">
                <span className="stat-name">{STAT_LABELS[id]}</span>
                <button onClick={() => bump(id, -1)} disabled={stats[id] <= STAT_MIN}>
                  −
                </button>
                <strong className="stat-value">{stats[id]}</strong>
                <button onClick={() => bump(id, 1)} disabled={stats[id] >= STAT_MAX || left <= 0}>
                  +
                </button>
                <span className="hint">{STAT_HINTS[id]}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="label">Xuất thân · cho 1 món đồ và 1 kỹ năng</div>
          <div className="pick-grid">
            {BACKGROUND_IDS.map((id) => (
              <button key={id} className={background === id ? "pick selected" : "pick"} onClick={() => setBackground(id)}>
                <strong>{BACKGROUND_LABELS[id].title}</strong>
                <span>{BACKGROUND_LABELS[id].skill}</span>
                <span className="hint">Đồ: {content.items.get(BACKGROUNDS[id].startItem)?.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="label">Tật xấu · bắt buộc</div>
          <div className="pick-grid">
            {FLAW_IDS.map((id) => (
              <button key={id} className={flaw === id ? "pick selected" : "pick"} onClick={() => setFlaw(id)}>
                <strong>{FLAW_LABELS[id].title}</strong>
                <span>{FLAW_LABELS[id].effect}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="creator-bottom">
          <label className="field">
            <span>Một dòng về bạn (không bắt buộc)</span>
            <input value={bio} maxLength={BIO_MAX_LENGTH} placeholder="vd. trốn nợ, đi tìm kho báu để về chuộc nhà" onChange={(e) => setBio(e.target.value)} />
          </label>
          <div className="field">
            <span>Màu áo</span>
            <div className="swatches">
              {PLAYER_COLORS.map((c) => (
                <button
                  key={c}
                  className={c === chosenColor ? "swatch selected" : "swatch"}
                  style={{ background: c }}
                  disabled={s.takenColors.includes(c)}
                  title={s.takenColors.includes(c) ? "Đã có người chọn" : ""}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </section>

        <footer className="prep-footer">
          <span className="hint">
            {s.created && sent ? "Đã lưu nhân vật. Vẫn sửa được tới khi hết giờ." : "Hết giờ mà chưa lưu thì bạn nhận một nhân vật ngẫu nhiên."} ·{" "}
            {s.readyCount}/{s.readyNeeded} người đã xong
          </span>
          <button className="primary" disabled={left !== 0} onClick={submit}>
            {sent ? "Lưu lại" : "Xong"}
          </button>
        </footer>
      </div>
    </div>
  );
}
