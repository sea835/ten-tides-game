import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Bot,
  CloudFog,
  CloudLightning,
  Copy,
  Crosshair,
  Flag,
  Keyboard,
  Lock,
  LogOut,
  Moon,
  Shuffle,
  Snowflake,
  Sun,
  Ticket,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { BATTLE_TIMES, MAX_BATTLE_BOTS, MIN_BATTLE_BOTS, Messages, WAR_MAX_PER_SIDE, WAR_TICKETS_MAX, WAR_TICKETS_MIN, type BattleSettingsMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { openGunsmith } from "../../gunsmith/openGunsmith.ts";
import { SIDE_NAME } from "./WarHud.tsx";
import "./command.css";

// Sảnh Battleground kiểu "Trung tâm chỉ huy": chọn chế độ (ba thẻ), bảng cài đặt phòng (quân số, thời tiết, vé quân,
// khí tài), danh sách người chơi / hai phe, ô Kho Quân Nhu. Chỉ chủ phòng chỉnh được; người khác thấy cùng bảng ở dạng
// chỉ xem. Server kẹp lại mọi giá trị (apps/server/src/battle/settings.ts).

type Mode = "war" | "squad" | "solo";

const MODES: { id: Mode; title: string; tag: string; icon: ReactNode; facts: string[]; brief: string }[] = [
  {
    id: "war",
    title: "Đại Chiến 50v50",
    tag: "Chiếm cứ điểm A–G",
    icon: <Flag size={22} aria-hidden />,
    facts: ["100 quân", "7 cứ điểm", "Hồi sinh"],
    brief:
      "Bản đồ riêng rộng gần 700 m, hai căn cứ hai đầu, 7 cứ điểm A–G có công sự. Đứng trong vùng cứ điểm để chiếm; phe giữ ít cứ điểm hơn bị trừ vé dần, mỗi lần gục mất một vé; hết vé là thua. Gục thì chọn lớp lính và chỗ hồi sinh.",
  },
  {
    id: "squad",
    title: "Chỉ Huy Tiểu Đội",
    tag: "Dẫn 5 lính AI",
    icon: <Users size={22} aria-hidden />,
    facts: ["Y/G/H ra lệnh", "Nhập xác", "Xe tăng đội"],
    brief: "Mỗi người dẫn 5 lính AI (súng trường, bắn tỉa, súng máy, chống tăng, lái tăng). Y tới điểm, G giữ chỗ, H theo sau; gục thì nhập vào lính còn sống. Đội cuối cùng còn người thắng.",
  },
  {
    id: "solo",
    title: "Sinh Tồn Sa Trường",
    tag: "Battle royale solo",
    icon: <Crosshair size={22} aria-hidden />,
    facts: ["Bo thu 7 vòng", "Thính rơi", "Mua súng (B)"],
    brief: "Xuất phát ngẫu nhiên khắp đảo, bấm B mua vũ khí, nhặt đồ trong nhà và thùng thính. Vùng an toàn thu hẹp dần; người cuối cùng còn sống thắng.",
  },
];

/** Thời tiết đặt sẵn: gộp thời tiết và giờ trong ngày của server thành năm kiểu dễ chọn. */
const SKY_PRESETS: { id: string; label: string; icon: ReactNode; weather: string; time: string }[] = [
  { id: "sunny", label: "Nắng", icon: <Sun size={18} aria-hidden />, weather: "sunny", time: "day" },
  { id: "storm", label: "Mưa bão", icon: <CloudLightning size={18} aria-hidden />, weather: "storm", time: "day" },
  { id: "fog", label: "Sương mù", icon: <CloudFog size={18} aria-hidden />, weather: "fog", time: "dawn" },
  { id: "snow", label: "Tuyết phủ", icon: <Snowflake size={18} aria-hidden />, weather: "snow", time: "day" },
  { id: "night", label: "Ban đêm", icon: <Moon size={18} aria-hidden />, weather: "sunny", time: "night" },
  { id: "random", label: "Ngẫu nhiên", icon: <Shuffle size={18} aria-hidden />, weather: "random", time: "random" },
];

const TIME_LABEL: Record<string, string> = { random: "Ngẫu nhiên", dawn: "Bình minh", day: "Ban ngày", dusk: "Hoàng hôn", night: "Ban đêm" };
const WEATHER_NAME: Record<string, string> = { random: "đổi dần giữa trận", sunny: "nắng", cloudy: "nhiều mây", rain: "mưa", fog: "sương mù", storm: "bão", snow: "tuyết" };

/** Kiểu đặt sẵn đang khớp với lựa chọn của phòng (không khớp kiểu nào thì là tuỳ chỉnh). */
function presetOf(weather: string, time: string): string {
  return SKY_PRESETS.find((p) => p.weather === weather && p.time === time)?.id ?? "";
}

function Slider({
  label,
  icon,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  // Kéo thì hiện ngay số đang kéo, không chờ server gửi lại.
  const [draft, setDraft] = useState<number | null>(null);
  const v = draft ?? value;
  const pct = ((v - min) / (max - min)) * 100;
  return (
    <label className="cc-slider">
      <span className="cc-field-head">
        {icon}
        <span>{label}</span>
        <b>
          {v} <small>{unit}</small>
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(e) => {
          const n = Number(e.target.value);
          setDraft(n);
          onChange(n);
        }}
        onPointerUp={() => setDraft(null)}
        onBlur={() => setDraft(null)}
      />
      <span className="cc-range">
        <span>{min}</span>
        <span>{max}</span>
      </span>
    </label>
  );
}

export function CommandCenter({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    host: st.hostId,
    bots: st.bots,
    mode: st.battleMode as Mode,
    weather: st.settings.weatherPick,
    time: st.settings.timePick,
    tickets: st.settings.warTickets,
    vehicles: st.settings.vehiclesEnabled,
    players: [...st.players.entries()].filter(([, p]) => !p.bot).map(([id, p]) => ({ id, name: p.name, color: p.color, team: p.team })),
  }));
  const [copied, setCopied] = useState(false);
  if (s.phase !== "lobby") return null;
  const me = myId(room);
  const isHost = s.host === me;
  const war = s.mode === "war";
  const squad = s.mode === "squad";
  const perSide = Math.max(MIN_BATTLE_BOTS / 2, Math.min(WAR_MAX_PER_SIDE, s.bots || WAR_MAX_PER_SIDE));
  const squadBots = Math.max(s.bots, s.players.length * 5);
  /** Quân số hiển thị: chiến trường là tổng hai phe, đồng đội gồm cả 5 lính theo mỗi người. */
  const troops = war ? perSide * 2 : squad ? squadBots : s.bots;
  const mode = MODES.find((m) => m.id === s.mode) ?? MODES[0]!;
  const preset = presetOf(s.weather, s.time);
  const send = (msg: BattleSettingsMessage) => {
    if (isHost) room.send(Messages.battleSettings, msg);
  };
  const copyCode = () => {
    void navigator.clipboard?.writeText(room.roomId).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div className="cc">
      <div className="cc-panel">
        <header className="cc-head">
          <div className="cc-brand">
            <span className="cc-kicker">Ten Tides · Frontline</span>
            <h2>Trung tâm chỉ huy</h2>
          </div>
          <button className="cc-code" onClick={copyCode} title="Chép mã phòng để mời bạn bè">
            <span>{copied ? "Đã chép" : "Mã phòng"}</span>
            <strong>{room.roomId}</strong>
            <Copy size={14} aria-hidden />
          </button>
          <button className="cc-leave" onClick={onLeave}>
            <LogOut size={16} aria-hidden /> Rời phòng
          </button>
        </header>

        <section className="cc-modes" aria-label="Chọn chế độ">
          {MODES.map((m) => (
            <button key={m.id} className={`cc-mode m-${m.id} ${s.mode === m.id ? "on" : ""}`} disabled={!isHost} aria-pressed={s.mode === m.id} onClick={() => send({ mode: m.id })}>
              <span className="cc-mode-icon">{m.icon}</span>
              <strong>{m.title}</strong>
              <em>{m.tag}</em>
              <span className="cc-mode-facts">
                {m.facts.map((f) => (
                  <i key={f}>{f}</i>
                ))}
              </span>
            </button>
          ))}
        </section>

        <div className="cc-grid">
          <section className="cc-brief">
            <h3>Lệnh tác chiến · {mode.title}</h3>
            <p>{mode.brief}</p>
            {war ? (
              <div className="w-sides cc-sides">
                {(["blue", "red"] as const).map((side) => {
                  const humans = s.players.filter((p) => p.team === side);
                  return (
                    <div key={side} className={`w-side ${side}`}>
                      <h4>
                        {SIDE_NAME[side]} <small>{perSide} quân</small>
                      </h4>
                      <ul>
                        {humans.map((p) => (
                          <li key={p.id}>
                            {p.name}
                            {p.id === s.host && " 👑"}
                            {p.id === me && " (bạn)"}
                          </li>
                        ))}
                        <li className="muted">+ {Math.max(0, perSide - humans.length)} lính AI</li>
                      </ul>
                      {s.players.find((p) => p.id === me)?.team !== side && <button onClick={() => room.send(Messages.pickSide, { side })}>Vào {SIDE_NAME[side]}</button>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="b-lobby-players cc-roster">
                {s.players.map((p) => (
                  <li key={p.id}>
                    <i style={{ background: p.color }} /> {p.name}
                    {p.id === s.host && " 👑"}
                    {p.id === me && " (bạn)"}
                  </li>
                ))}
                <li className="muted">
                  <Bot size={13} aria-hidden /> + {troops} lính AI
                </li>
              </ul>
            )}
            <button className="cc-armory" onClick={() => openGunsmith()}>
              <Wrench size={18} aria-hidden />
              <span>
                <strong>Kho Quân Nhu (Gunsmith)</strong>
                <small>Tháo lắp ống ngắm, nòng, băng đạn, sơn skin</small>
              </span>
            </button>
          </section>

          <section className={`cc-settings ${isHost ? "" : "readonly"}`} aria-label="Cài đặt phòng">
            <h3>
              Cài đặt phòng
              {!isHost && (
                <span className="cc-lock">
                  <Lock size={12} aria-hidden /> Chủ phòng chỉnh
                </span>
              )}
            </h3>
            <Slider
              label={war ? "Quân số (hai phe)" : squad ? "Lính AI (gồm 5 lính mỗi người)" : "Lính AI cùng chơi"}
              icon={<Bot size={16} aria-hidden />}
              value={troops}
              min={MIN_BATTLE_BOTS}
              max={MAX_BATTLE_BOTS}
              step={war ? 2 : 1}
              unit={war ? `(${perSide} vs ${perSide})` : "lính"}
              disabled={!isHost}
              onChange={(v) => send({ bots: war ? Math.round(v / 2) : v })}
            />
            {war && (
              <Slider
                label="Vé quân mỗi phe"
                icon={<Ticket size={16} aria-hidden />}
                value={s.tickets}
                min={WAR_TICKETS_MIN}
                max={WAR_TICKETS_MAX}
                step={10}
                unit="vé"
                disabled={!isHost}
                onChange={(v) => send({ tickets: v })}
              />
            )}
            <div className="cc-field">
              <span className="cc-field-head">
                <Sun size={16} aria-hidden />
                <span>Thời tiết</span>
              </span>
              <div className="cc-sky">
                {SKY_PRESETS.map((p) => (
                  <button key={p.id} className={preset === p.id ? "on" : ""} disabled={!isHost} aria-pressed={preset === p.id} onClick={() => send({ weather: p.weather as "random", time: p.time as "random" })}>
                    {p.icon}
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              <label className="cc-time">
                Giờ trong ngày
                <select value={s.time} disabled={!isHost} onChange={(e) => send({ time: e.target.value as "random" })}>
                  <option value="random">{TIME_LABEL.random}</option>
                  {BATTLE_TIMES.map((t) => (
                    <option key={t} value={t}>
                      {TIME_LABEL[t]}
                    </option>
                  ))}
                </select>
                <small>Thời tiết: {WEATHER_NAME[s.weather] ?? s.weather}</small>
              </label>
            </div>
            <div className="cc-field">
              <span className="cc-field-head">
                <Truck size={16} aria-hidden />
                <span>Khí tài cơ giới</span>
              </span>
              <button className={`cc-toggle ${s.vehicles ? "on" : ""}`} role="switch" aria-checked={s.vehicles} disabled={!isHost} onClick={() => send({ vehicles: !s.vehicles })}>
                <i />
                <span>{s.vehicles ? "Bật: xe tăng, xe jeep, thuyền" : "Tắt: chỉ có bộ binh"}</span>
              </button>
              {s.mode === "solo" && <small className="cc-note">Sinh Tồn Sa Trường không có xe tăng.</small>}
            </div>
          </section>
        </div>

        <footer className="cc-foot">
          {isHost ? (
            <button className="cc-start" onClick={() => room.send(Messages.start)}>
              <Crosshair size={20} aria-hidden /> Xuất kích
              <small>{war ? `${perSide} vs ${perSide} · ${s.tickets} vé` : `${s.players.length + troops} người`}</small>
            </button>
          ) : (
            <p className="cc-wait">
              <span className="cc-pulse" /> Chờ chủ phòng ra lệnh xuất kích…
            </p>
          )}
          <details className="cc-keys">
            <summary>
              <Keyboard size={15} aria-hidden /> Phím điều khiển
            </summary>
            <p className="b-keys">
              WASD đi · Shift chạy · C ngồi xổm (đang chạy: trượt) · Z nằm sấp · Space nhảy · Chuột trái bắn · Chuột phải ngắm · R thay đạn · 1–3 súng · X cất súng (cầm dao) · V đâm dao · 4 lựu đạn · 5 bom khói · 6 bom choáng · 7 mìn (giữ chuột trái rút chốt, thả ra ném; giữ thêm chuột phải thì ném thấp) · 8–9 hồi máu · Q/E (giữ) nghiêng trái / phải · F nhặt, lên / xuống xe (trên xe: 1–5 đổi ghế) · B cửa hàng · Tab bảng điểm · T đổi góc nhìn · L (giữ) nói · U (giữ) bộ đàm · ` (giữ) vòng khẩu lệnh · chuột giữa đánh dấu (bấm đúp: nguy hiểm) · Đồng đội: Y tới điểm / lên xe tăng đang nhìn, G giữ chốt, H theo sau · gục ở chế độ tiểu đội: 1–5 nhập vào đồng đội
            </p>
          </details>
        </footer>
      </div>
    </div>
  );
}
