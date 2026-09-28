import { useEffect, useState } from "react";
import { Backpack, Check, Coins, Heart, Minus, Plus, Smile } from "lucide-react";
import { BACKGROUND_LABELS, FLAW_LABELS, content } from "@tentides/content";
import { Messages, PLAYER_COLORS } from "@tentides/protocol";
import {
  BACKGROUNDS,
  BACKGROUND_IDS,
  BASE_BUDGET,
  BIO_MAX_LENGTH,
  FLAW_IDS,
  FLAW_POINTS,
  STAT_IDS,
  STAT_LABELS,
  STAT_MAX,
  STAT_MIN,
  STAT_POINTS,
  applyBackgroundStats,
  capacityKg,
  type BackgroundId,
  type FlawId,
  type Stats,
} from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { Avatar, clock } from "./ui.tsx";

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
    name: st.players.get(me)?.name ?? "",
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
  /** Đặt thẳng một giá trị (bấm vào chấm), miễn còn đủ điểm. */
  const setStat = (id: keyof Stats, value: number) => {
    const next = Math.max(STAT_MIN, Math.min(STAT_MAX, value));
    if (next - stats[id] > left) return;
    setStats({ ...stats, [id]: next });
  };
  const submit = () => {
    room.send(Messages.createCharacter, { stats, background, flaw, bio: bio.trim(), color: chosenColor as (typeof PLAYER_COLORS)[number] });
    if (!sent) room.send(Messages.ready);
    setSent(true);
  };
  // Chỉ số suy ra, giống hệt cách engine tính (xuất thân có thể chỉnh thuộc tính, vd. con nhà giàu kém Gan dạ).
  const final = applyBackgroundStats(stats, background);
  const derived = {
    hp: 60 + final.strength * 10,
    carry: capacityKg(final.strength),
    budget: BASE_BUDGET + (BACKGROUNDS[background].budgetBonus ?? 0),
    morale: Math.min(100, 40 + final.nerve * 10),
  };

  return (
    <div className="prep-screen">
      <div className="prep-card creator">
        <header className="prep-header">
          <div>
            <div className="kicker">Trước khi lên tàu</div>
            <h2>Tạo nhân vật</h2>
          </div>
          <span className={s.timeLeft <= 15 ? "event-timer urgent" : "event-timer"}>{clock(s.timeLeft)}</span>
        </header>

        <div className="creator-body">
          <div className="creator-left">
            <div className="creator-preview">
              <Avatar name={s.name} color={chosenColor} size="lg" />
              <div>
                <strong>{s.name}</strong>
                <div className="hint">
                  {BACKGROUND_LABELS[background].title} · {FLAW_LABELS[flaw].title}
                </div>
              </div>
            </div>

            <section>
              <div className="label split">
                <span>Thuộc tính · {TOTAL} điểm</span>
                <span className={left === 0 ? "points done" : "points"}>
                  {left === 0 ? <Check size={13} aria-hidden /> : null}
                  còn {left}
                </span>
              </div>
              <div className="stat-rows">
                {STAT_IDS.map((id) => (
                  <div key={id} className="stat-row" title={STAT_HINTS[id]}>
                    <div className="stat-name">
                      <strong>{STAT_LABELS[id]}</strong>
                      <span className="hint">{STAT_HINTS[id]}</span>
                    </div>
                    <button className="step" aria-label={`Giảm ${STAT_LABELS[id]}`} onClick={() => setStat(id, stats[id] - 1)} disabled={stats[id] <= STAT_MIN}>
                      <Minus size={14} aria-hidden />
                    </button>
                    <div className="stat-pips" role="group" aria-label={`${STAT_LABELS[id]}: ${stats[id]}`}>
                      {Array.from({ length: STAT_MAX }, (_, i) => (
                        <button
                          key={i}
                          className={i < stats[id] ? "stat-pip on" : "stat-pip"}
                          aria-label={`${STAT_LABELS[id]} ${i + 1}`}
                          onClick={() => setStat(id, i + 1)}
                        />
                      ))}
                    </div>
                    <button className="step" aria-label={`Tăng ${STAT_LABELS[id]}`} onClick={() => setStat(id, stats[id] + 1)} disabled={stats[id] >= STAT_MAX || left <= 0}>
                      <Plus size={14} aria-hidden />
                    </button>
                    <strong className="stat-value">{stats[id]}</strong>
                  </div>
                ))}
              </div>
              <div className="hint">
                {STAT_POINTS} điểm gốc + {FLAW_POINTS} nhờ tật xấu, mỗi thuộc tính {STAT_MIN}–{STAT_MAX}.
              </div>
            </section>

            <div className="derived">
              <span title="Máu tối đa">
                <Heart size={14} aria-hidden /> {derived.hp} máu
              </span>
              <span title="Tinh thần lúc đầu">
                <Smile size={14} aria-hidden /> {derived.morale} tinh thần
              </span>
              <span title="Sức mang balo">
                <Backpack size={14} aria-hidden /> {derived.carry} kg
              </span>
              <span title="Ngân sách mua đồ">
                <Coins size={14} aria-hidden /> {derived.budget} xu
              </span>
            </div>

            <label className="field">
              <span className="label">Một dòng về bạn · không bắt buộc</span>
              <input value={bio} maxLength={BIO_MAX_LENGTH} placeholder="vd. trốn nợ, đi tìm kho báu để về chuộc nhà" onChange={(e) => setBio(e.target.value)} />
            </label>
            <div className="field">
              <span className="label">Màu áo</span>
              <div className="swatches">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    className={c === chosenColor ? "swatch selected" : "swatch"}
                    style={{ background: c }}
                    disabled={s.takenColors.includes(c)}
                    title={s.takenColors.includes(c) ? "Đã có người chọn" : ""}
                    aria-label={`Màu ${c}`}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="creator-right">
            <section>
              <div className="label">Xuất thân · cho 1 món đồ và 1 kỹ năng</div>
              <div className="pick-grid">
                {BACKGROUND_IDS.map((id) => (
                  <button key={id} className={background === id ? "pick selected" : "pick"} onClick={() => setBackground(id)}>
                    <strong>{BACKGROUND_LABELS[id].title}</strong>
                    <span>{BACKGROUND_LABELS[id].skill}</span>
                    <span className="pick-item">{content.items.get(BACKGROUNDS[id].startItem)?.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="label">Tật xấu · bắt buộc</div>
              <div className="pick-grid flaws">
                {FLAW_IDS.map((id) => (
                  <button key={id} className={flaw === id ? "pick flaw selected" : "pick flaw"} onClick={() => setFlaw(id)}>
                    <strong>{FLAW_LABELS[id].title}</strong>
                    <span>{FLAW_LABELS[id].effect}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="prep-footer">
          <span className="hint">
            {s.created && sent ? "Đã lưu nhân vật. Vẫn sửa được tới khi hết giờ." : "Hết giờ mà chưa lưu thì bạn nhận một nhân vật ngẫu nhiên."}
          </span>
          <span className="ready-count">
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
