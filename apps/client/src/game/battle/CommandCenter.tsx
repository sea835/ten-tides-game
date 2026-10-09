import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  Map as MapIcon,
  Moon,
  Ship,
  Shuffle,
  Snowflake,
  Sun,
  Ticket,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { SHIP_CLASSES, WAR_MAP_LIST, shipClass } from "@tentides/content";
import { BATTLE_TIMES, MAX_BATTLE_BOTS, MIN_BATTLE_BOTS, Messages, WAR_MAX_PER_SIDE, WAR_TICKETS_MAX, WAR_TICKETS_MIN, type BattleSettingsMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { openGunsmith } from "../../gunsmith/openGunsmith.ts";
import { useAccount } from "../../account/account.ts";
import { StudioBackdrop } from "../../studio/StudioBackdrop.tsx";
import { roomLook } from "../../studio/looks.ts";
import { ClassPicker } from "./GadgetHud.tsx";
import { SIDE_NAME } from "./WarHud.tsx";
import "./command.css";

// Sảnh Battleground kiểu "Trung tâm chỉ huy": chọn chế độ (ba thẻ), bảng cài đặt phòng (quân số, thời tiết, vé quân,
// khí tài), danh sách người chơi / hai phe, ô Kho Quân Nhu. Chỉ chủ phòng chỉnh được; người khác thấy cùng bảng ở dạng
// chỉ xem. Server kẹp lại mọi giá trị (apps/server/src/battle/settings.ts).

type Mode = "war" | "squad" | "solo" | "naval";

const MODES: { id: Mode; title: string; tag: string; icon: ReactNode; facts: string[]; brief: string }[] = [
  {
    id: "war",
    title: "Đại Chiến 50v50",
    tag: "Chiếm cứ điểm A–G",
    icon: <Flag size={22} aria-hidden />,
    facts: ["100 quân", "6 bản đồ", "Hồi sinh"],
    brief:
      "Sáu chiến trường rộng gần 700 m (trận đánh nổi tiếng: Điện Biên Phủ, Normandy, Verdun, Stalingrad, El Alamein), hai căn cứ hai đầu, 7 cứ điểm A–G có công sự, chiến hào, pháo đài. Đứng trong vùng cứ điểm để chiếm; phe giữ ít cứ điểm hơn bị trừ vé dần, mỗi lần gục mất một vé; hết vé là thua. Gục thì chọn lớp lính và chỗ hồi sinh.",
  },
  {
    id: "naval",
    title: "Hải Chiến 3v3",
    tag: "Hai chiến hạm đấu nhau",
    icon: <Ship size={22} aria-hidden />,
    facts: ["5 lớp tàu", "3 người / tàu", "Lái tên lửa"],
    brief:
      "Mỗi phe một chiến hạm, ba người (thiếu thì máy lấp) đứng ba vị trí: lái tàu, pháo, phòng không, tên lửa, ngư lôi, phi công tuỳ lớp tàu. Đi lại trên boong, bấm F ở bàn điều khiển để vào vị trí. Trúng đạn thì bộ phận vỡ, hỏng, bốc cháy (giữ F để dập); ụ súng hỏng thì không bắn được nữa; lính trên boong bị bắn được. Đánh chìm tàu địch là thắng.",
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

/** Chọn bản đồ chiến trường: thẻ mỗi bản đồ (tên, nơi · năm, kiểu địa hình), mô tả bản đồ đang chọn. */
function MapPicker({ value, disabled, onPick }: { value: string; disabled: boolean; onPick: (id: string) => void }) {
  const cur = WAR_MAP_LIST.find((m) => m.id === value) ?? WAR_MAP_LIST[0]!;
  return (
    <div className="cc-maps">
      <div className="cc-map-list" role="radiogroup" aria-label="Bản đồ chiến trường">
        {WAR_MAP_LIST.map((m) => (
          <button key={m.id} role="radio" aria-checked={m.id === cur.id} className={`cc-map map-${m.id} ${m.id === cur.id ? "on" : ""}`} disabled={disabled} onClick={() => onPick(m.id)}>
            <strong>{m.name}</strong>
            <small>{m.place}</small>
            <i>{m.terrain}</i>
          </button>
        ))}
      </div>
      <p className="cc-map-brief">
        <MapIcon size={14} aria-hidden /> {cur.brief}
      </p>
    </div>
  );
}

/**
 * Sảnh hải chiến: hai phe, mỗi phe chọn lớp tàu (người trong phe chọn; phe toàn máy thì chủ phòng chọn), ba vị trí
 * trên tàu (bấm để đứng vị trí đó, người chưa chọn và chỗ trống do máy lấp).
 */
function NavalLobby({ room, me, isHost, players, ships }: { room: IslandRoom; me: string; isHost: boolean; players: { id: string; name: string; team: string; role: string }[]; ships: Record<"blue" | "red", string> }) {
  const mine = players.find((p) => p.id === me);
  return (
    <div className="w-sides cc-sides nv-lobby">
      {(["blue", "red"] as const).map((side) => {
        const humans = players.filter((p) => p.team === side);
        const cls = shipClass(ships[side]);
        const canPick = mine?.team === side || (isHost && humans.length === 0);
        return (
          <div key={side} className={`w-side ${side}`}>
            <h4>
              {SIDE_NAME[side]} <small>{cls.name}</small>
            </h4>
            <div className="nv-ships" role="radiogroup" aria-label={`Lớp tàu ${SIDE_NAME[side]}`}>
              {SHIP_CLASSES.map((id) => (
                <button key={id} role="radio" aria-checked={cls.id === id} className={cls.id === id ? "on" : ""} disabled={!canPick} onClick={() => room.send(Messages.navalPick, mine?.team === side ? { ship: id } : { ship: id, side })}>
                  {shipClass(id).name}
                </button>
              ))}
            </div>
            <p className="nv-ship-brief">
              {cls.brief} <small>Máu {cls.hp} · {Math.round(cls.speed * 1.944)} hải lý/giờ · dài {cls.length} m</small>
            </p>
            <ul className="nv-roles">
              {cls.roles.map((r, k) => {
                const who = humans.find((p) => p.role === String(k));
                return (
                  <li key={k} className={who?.id === me ? "me" : ""}>
                    <strong>{r.name}</strong>
                    <span>{who ? `${who.name}${who.id === me ? " (bạn)" : ""}` : "Máy"}</span>
                    <small>{r.brief}</small>
                    {mine?.team === side && who?.id !== me && <button onClick={() => room.send(Messages.navalPick, { station: k })}>{who ? "Đổi chỗ" : "Đứng vị trí này"}</button>}
                  </li>
                );
              })}
            </ul>
            {mine?.team !== side && humans.length < 3 && <button onClick={() => room.send(Messages.pickSide, { side })}>Vào {SIDE_NAME[side]}</button>}
          </div>
        );
      })}
    </div>
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
    warMap: st.settings.warMap,
    shipBlue: st.settings.shipBlue,
    shipRed: st.settings.shipRed,
    players: [...st.players.entries()].filter(([, p]) => !p.bot).map(([id, p]) => ({ id, name: p.name, color: p.color, team: p.team, role: p.role })),
  }));
  // Nhân vật của mình trên bục 3D phía sau bảng: theo lớp lính, trang phục, skin đã lắp.
  const mine = useRoomSnapshot(room, (st) => {
    const p = st.players.get(myId(room));
    return {
      color: p?.color ?? "#669bbc",
      cls: p?.gear.cls ?? "",
      outfit: p?.kit.outfit ?? "",
      primary: p?.kit.primary1 ?? "",
      armor: p?.kit.armor ?? 0,
      helmet: p?.kit.helmet ?? 0,
      skins: Object.fromEntries(p?.skins.entries() ?? []) as Record<string, string>,
    };
  });
  const account = useAccount();
  const profile = account.status === "user" ? account.profile : null;
  const look = useMemo(() => roomLook(mine, profile), [mine, profile]);
  const panel = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  if (s.phase !== "lobby") return null;
  const me = myId(room);
  const isHost = s.host === me;
  const war = s.mode === "war";
  const squad = s.mode === "squad";
  const naval = s.mode === "naval";
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
    <div className="cc has-studio">
      <StudioBackdrop look={look} defaultSet="command" avoid={panel} coversGame />
      <div className="cc-panel" ref={panel}>
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
            {war && <MapPicker value={s.warMap} disabled={!isHost} onPick={(id) => send({ map: id })} />}
            {naval ? (
              <NavalLobby room={room} me={me} isHost={isHost} players={s.players} ships={{ blue: s.shipBlue, red: s.shipRed }} />
            ) : war ? (
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
            {!naval && <ClassPicker room={room} />}
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
            {!naval && (
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
            )}
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
            {!naval && (
              <div className="cc-field">
                <span className="cc-field-head">
                  <Truck size={16} aria-hidden />
                  <span>Khí tài cơ giới</span>
                </span>
                <button className={`cc-toggle ${s.vehicles ? "on" : ""}`} role="switch" aria-checked={s.vehicles} disabled={!isHost} onClick={() => send({ vehicles: !s.vehicles })}>
                  <i />
                  <span>{s.vehicles ? "Bật: xe tăng, xe jeep, thuyền, xuồng, trực thăng" : "Tắt: chỉ có bộ binh"}</span>
                </button>
                {s.mode === "solo" && <small className="cc-note">Sinh Tồn Sa Trường không có xe tăng.</small>}
              </div>
            )}
          </section>
        </div>

        <footer className="cc-foot">
          {isHost ? (
            <button className="cc-start" data-ui="clack" onClick={() => room.send(Messages.start)}>
              <Crosshair size={20} aria-hidden /> Xuất kích
              <small>{naval ? `${shipClass(s.shipBlue).name} vs ${shipClass(s.shipRed).name}` : war ? `${perSide} vs ${perSide} · ${s.tickets} vé` : `${s.players.length + troops} người`}</small>
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
              WASD đi · Shift chạy · C ngồi xổm (đang chạy: trượt) · Z nằm sấp · Space nhảy · Chuột trái bắn · Chuột phải ngắm · R thay đạn · 1–3 súng · X cất súng (cầm dao) · V đâm dao · 4 lựu đạn · 5 bom khói · 6 bom choáng · 7 mìn (giữ chuột trái rút chốt, thả ra ném; giữ thêm chuột phải thì ném thấp) · 8–9 hồi máu · 0 khí tài lớp lính (bấm lần nữa đổi khí tài thứ hai) · Q/E (giữ) nghiêng trái / phải · F nhặt, lên / xuống xe (trên xe: 1–5 đổi ghế) · B cửa hàng · Tab bảng điểm · T đổi góc nhìn · L (giữ) nói · U (giữ) bộ đàm · ` (giữ) vòng khẩu lệnh · chuột giữa đánh dấu (bấm đúp: nguy hiểm) · Đồng đội: Y tới điểm / lên xe tăng đang nhìn, G giữ chốt, H theo sau · gục ở chế độ tiểu đội: 1–5 nhập vào đồng đội
            </p>
          </details>
        </footer>
      </div>
    </div>
  );
}
