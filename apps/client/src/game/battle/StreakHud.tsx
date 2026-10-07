import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ARTILLERY, POINT_LABEL, SPECIAL_DROP, STREAKS, STREAK_IDS, UAV, isPointKind, type SpecialPick, type StreakId } from "@tentides/content";
import { Messages, type PointsMessage, type StreakFxMessage, type StreakMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { localPosition } from "../shared.ts";
import { playMortarWhistle } from "../sound/mortar.ts";
import { playSiren, playStreakCall, playStreakReady } from "../sound/streaks.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { closeBuyMenu, getBattleHud, setBattleHud } from "./runtime.ts";
import { STREAK_KEY, STREAK_KEY_LABEL, sideOf, uavLeft } from "./streaks.ts";
import "./streaks.css";

// Giao diện chi viện chiến thuật (Chiến trường, Đồng đội): điểm chiến thuật đang có và dòng "+100 Hạ gục", bảng chọn
// chi viện (phím K, rồi 1–3), máy tính bảng bản đồ để chấm toạ độ mưa pháo / chỗ thả thùng chi viện (chọn giáp
// Juggernaut hay TOW), thông báo khi có chi viện (còi báo động khi pháo sắp rơi gần mình, tiếng rít từng loạt), và lớp
// UAV trên bản đồ nhỏ (StreakMarks: địch hiện chấm đỏ, vòng quét radar).

const ICON: Record<StreakId, string> = { uav: "🛩", artillery: "💥", airdrop: "🪂" };
const PICK_LABEL: Record<SpecialPick, string> = { jugg: "Giáp Juggernaut + Minigun", tow: "Tên lửa TOW dẫn đường" };

interface Tablet {
  kind: "artillery" | "airdrop";
  pick: SpecialPick;
  /** Chỗ chấm: toạ độ thế giới và vị trí trên khung bản đồ (phần trăm). */
  target: { x: number; z: number; left: number; top: number } | null;
}

interface Line {
  key: number;
  at: number;
  text: string;
  amount: number;
}

/** Khoá chuột lại vào cảnh 3D (sau khi đóng máy tính bảng). */
function relock() {
  closeBuyMenu();
}

function toast(text: string) {
  setBattleHud({ toast: { at: performance.now(), text } });
}

export function StreakHud({ room, bigMap }: { room: IslandRoom; bigMap: ReactNode }) {
  const enabled = useRoomSnapshot(room, (s) => s.battleMode === "war" || s.battleMode === "squad");
  const tp = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.gear.tp ?? 0);
  const uav = useRoomSnapshot(room, (s) => uavLeft(s, myId(room)));
  const [menu, setMenu] = useState(false);
  const [tablet, setTablet] = useState<Tablet | null>(null);
  const [feed, setFeed] = useState<Line[]>([]);
  const [alert, setAlert] = useState<{ at: number; text: string; bad: boolean } | null>(null);
  /** Lần gọi gần nhất từng loại (performance.now): hiện thời gian chờ. */
  const used = useRef<Record<StreakId, number>>({ uav: -Infinity, artillery: -Infinity, airdrop: -Infinity });
  const sentAt = useRef(-Infinity);
  const [, tick] = useState(0);
  const state = useRef({ menu, tablet, tp, enabled });
  state.current = { menu, tablet, tp, enabled };

  // Gói từ server: điểm, hiệu ứng chi viện, lời từ chối (chỉ hiện nếu mình vừa gọi chi viện).
  useEffect(() => {
    let seq = 0;
    const offPoints = room.onMessage(Messages.points, (m: PointsMessage) => {
      const now = performance.now();
      if (m.amount < 0) {
        if ((STREAK_IDS as readonly string[]).includes(m.kind)) used.current[m.kind as StreakId] = now;
        return;
      }
      const before = m.total - m.amount;
      const label = isPointKind(m.kind) ? POINT_LABEL[m.kind] : m.kind;
      setFeed((f) => [...f.slice(-3), { key: ++seq, at: now, text: label, amount: m.amount }]);
      const ready = STREAK_IDS.find((id) => before < STREAKS[id].cost && m.total >= STREAKS[id].cost);
      if (ready) {
        playStreakReady();
        toast(`${ICON[ready]} ${STREAKS[ready].name} sẵn sàng · bấm ${STREAK_KEY_LABEL}`);
      }
    });
    const offFx = room.onMessage(Messages.streakFx, (m: StreakFxMessage) => {
      const now = performance.now();
      const mine = m.team === sideOf(room.state, myId(room));
      if (m.kind === "salvo") {
        for (const [x, y, z] of m.pts ?? []) playMortarWhistle({ x, y, z }, m.t);
        return;
      }
      const d = Math.round(Math.hypot(m.x - localPosition.x, m.z - localPosition.z));
      if (m.kind === "uav") {
        playStreakCall(!mine);
        setAlert({ at: now, bad: !mine, text: mine ? `🛩 UAV của ${m.name}: thấy mọi kẻ địch trên bản đồ ${UAV.seconds} giây` : "🛩 Địch đã phóng UAV — vị trí của bạn bị lộ!" });
      } else if (m.kind === "artillery") {
        const near = d <= ARTILLERY.spread + ARTILLERY.radius + 25;
        if (d <= ARTILLERY.siren) playSiren({ x: m.x, y: m.y, z: m.z }, ARTILLERY.warn + ARTILLERY.every * (ARTILLERY.salvos - 1), ARTILLERY.siren + 60);
        if (near) setAlert({ at: now, bad: true, text: "⚠ PHÁO KÍCH! Chạy khỏi khói đỏ ngay!" });
        else if (mine) {
          playStreakCall();
          setAlert({ at: now, bad: false, text: `💥 Mưa pháo của ${m.name} sắp rơi (cách ${d} m)` });
        }
      } else if (m.kind === "airdrop") {
        playStreakCall(!mine);
        setAlert({ at: now, bad: !mine, text: mine ? `🪂 Hòm tiếp tế siêu cấp của ${m.name} đang rơi (cách ${d} m)` : `🪂 Địch thả hòm tiếp tế siêu cấp (cách ${d} m)!` });
      }
    });
    const offReject = room.onMessage(Messages.rejected, (r: { reason: string }) => {
      if (performance.now() - sentAt.current < 2500) toast(r.reason);
    });
    const prune = window.setInterval(() => {
      const now = performance.now();
      setFeed((f) => (f.length && now - f[0]!.at > 3500 ? f.filter((l) => now - l.at <= 3500) : f));
      setAlert((a) => (a && now - a.at > 4500 ? null : a));
      tick((n) => (n + 1) % 1000);
    }, 500);
    return () => {
      offPoints();
      offFx();
      offReject();
      window.clearInterval(prune);
    };
  }, [room]);

  const send = (m: StreakMessage) => {
    sentAt.current = performance.now();
    room.send(Messages.streak, m);
  };

  /** Chọn một chi viện trong bảng: UAV gọi luôn; mưa pháo, thùng chi viện mở máy tính bảng chấm toạ độ. */
  const choose = (id: StreakId) => {
    const def = STREAKS[id];
    setMenu(false);
    // Đọc thẳng từ state (React có thể chưa kịp vẽ lại sau gói điểm mới nhất).
    const tp = room.state.players.get(myId(room))?.gear.tp ?? 0;
    if (tp < def.cost) return toast(`Chưa đủ điểm chiến thuật (cần ${def.cost}).`);
    const wait = def.cooldown * 1000 - (performance.now() - used.current[id]);
    if (wait > 0) return toast(`${def.name}: chờ thêm ${Math.ceil(wait / 1000)} giây.`);
    if (!def.target) return send({ kind: id as "uav" });
    setTablet({ kind: id as Tablet["kind"], pick: "jugg", target: null });
    document.exitPointerLock?.();
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  // Phím: K mở / đóng bảng chi viện; đang mở thì 1–3 chọn, Esc đóng (chặn trước khi tới phím đổi súng).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const st = state.current;
      if (e.code === STREAK_KEY && !e.repeat) {
        const phase = room.state.phase;
        const hud = getBattleHud();
        if (!st.enabled || phase !== "battle" || hud.buyOpen || hud.settingsOpen) return;
        if (st.tablet) {
          setTablet(null);
          relock();
          return;
        }
        if (!room.state.players.get(myId(room))?.alive) return;
        setMenu((o) => !o);
        return;
      }
      if (st.menu) {
        const n = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : 0;
        if (n >= 1 && n <= STREAK_IDS.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          chooseRef.current(STREAK_IDS[n - 1]!);
        } else if (e.code === "Escape") {
          e.stopImmediatePropagation();
          setMenu(false);
        }
      } else if (st.tablet && e.code === "Escape") {
        e.stopImmediatePropagation();
        setTablet(null);
        relock();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [room]);

  // Gục, hết trận: đóng hết.
  const alive = useRoomSnapshot(room, (s) => s.phase === "battle" && !!s.players.get(myId(room))?.alive);
  useEffect(() => {
    if (alive) return;
    setMenu(false);
    setTablet(null);
  }, [alive]);

  if (!enabled) return null;
  const now = performance.now();
  return (
    <>
      <div className="st-points">
        <strong>⚡ {tp}</strong>
        <span>
          <kbd>{STREAK_KEY_LABEL}</kbd> chi viện
        </span>
        <div className="st-pips">
          {STREAK_IDS.map((id) => (
            <i key={id} className={tp >= STREAKS[id].cost ? "on" : ""} title={`${STREAKS[id].name} · ${STREAKS[id].cost}`}>
              {ICON[id]}
            </i>
          ))}
        </div>
        {uav > 0 && <em className="st-uav">🛩 UAV {uav}s</em>}
        {feed.map((l) => (
          <p key={l.key} className="st-gain">
            +{l.amount} <small>{l.text}</small>
          </p>
        ))}
      </div>
      {alert && <div className={`st-alert ${alert.bad ? "bad" : ""}`}>{alert.text}</div>}
      {menu && (
        <div className="st-menu">
          <h3>Chi viện chiến thuật · ⚡ {tp}</h3>
          {STREAK_IDS.map((id, i) => {
            const def = STREAKS[id];
            const wait = Math.ceil((def.cooldown * 1000 - (now - used.current[id])) / 1000);
            const ok = tp >= def.cost && wait <= 0;
            return (
              <button key={id} className={`st-item ${ok ? "" : "off"}`} onClick={() => choose(id)}>
                <kbd>{i + 1}</kbd>
                <b>{ICON[id]}</b>
                <span>
                  <strong>{def.name}</strong>
                  <small>{def.desc}</small>
                </span>
                <em>{wait > 0 ? `${wait}s` : `${def.cost}`}</em>
              </button>
            );
          })}
          <p>
            <kbd>1</kbd>–<kbd>3</kbd> chọn · <kbd>{STREAK_KEY_LABEL}</kbd>/<kbd>Esc</kbd> đóng
          </p>
        </div>
      )}
      {tablet && (
        <TargetTablet
          room={room}
          tablet={tablet}
          bigMap={bigMap}
          onChange={setTablet}
          onClose={() => {
            setTablet(null);
            relock();
          }}
          onConfirm={(t) => {
            if (!t.target) return;
            send({ kind: t.kind, x: t.target.x, z: t.target.z, ...(t.kind === "airdrop" ? { pick: t.pick } : {}) });
            setTablet(null);
            relock();
          }}
        />
      )}
    </>
  );
}

/** Máy tính bảng: bản đồ lớn, bấm để chấm toạ độ; kiểm tra sơ bộ khoảng cách (server kiểm tra lại). */
function TargetTablet({ room, tablet, bigMap, onChange, onClose, onConfirm }: { room: IslandRoom; tablet: Tablet; bigMap: ReactNode; onChange: (t: Tablet) => void; onClose: () => void; onConfirm: (t: Tablet) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const def = STREAKS[tablet.kind];
  const me = room.state.players.get(myId(room));
  const onClick = (e: ReactMouseEvent) => {
    const wrap = box.current;
    const svg = wrap?.querySelector("svg");
    if (!wrap || !svg) return;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    // Khung svg giữ tỉ lệ (xMidYMid meet): bù phần lề.
    const scale = Math.min(r.width / vb.width, r.height / vb.height);
    const ox = r.left + (r.width - vb.width * scale) / 2;
    const oy = r.top + (r.height - vb.height * scale) / 2;
    const x = vb.x + (e.clientX - ox) / scale;
    const z = vb.y + (e.clientY - oy) / scale;
    if (x < vb.x || x > vb.x + vb.width || z < vb.y || z > vb.y + vb.height) return;
    const wr = wrap.getBoundingClientRect();
    onChange({ ...tablet, target: { x, z, left: ((e.clientX - wr.left) / wr.width) * 100, top: ((e.clientY - wr.top) / wr.height) * 100 } });
  };
  const t = tablet.target;
  const d = t && me ? Math.hypot(t.x - me.x, t.z - me.z) : 0;
  const problem = !t ? "Bấm lên bản đồ để chấm toạ độ." : tablet.kind === "artillery" && d < ARTILLERY.minRange ? `Quá gần mình (tối thiểu ${ARTILLERY.minRange} m).` : tablet.kind === "airdrop" && d > SPECIAL_DROP.range ? `Quá xa (tối đa ${SPECIAL_DROP.range} m).` : "";
  return (
    <div className="st-tablet">
      <div className="st-frame">
        <header>
          <b>{def.name}</b>
          <span>{def.desc}</span>
          <button onClick={onClose}>✕</button>
        </header>
        <div className="st-map" ref={box} onClick={onClick}>
          {bigMap}
          {t && <i className={`st-target ${tablet.kind}`} style={{ left: `${t.left}%`, top: `${t.top}%` }} />}
        </div>
        <footer>
          {tablet.kind === "airdrop" && (
            <div className="st-picks">
              {(["jugg", "tow"] as const).map((p) => (
                <button key={p} className={tablet.pick === p ? "on" : ""} onClick={() => onChange({ ...tablet, pick: p })}>
                  {p === "jugg" ? "🛡" : "🚀"} {PICK_LABEL[p]}
                </button>
              ))}
            </div>
          )}
          <span className={problem ? "warn" : ""}>{problem || `Cách mình ${Math.round(d)} m`}</span>
          <button className="go" disabled={!!problem} onClick={() => onConfirm(tablet)}>
            {tablet.kind === "artillery" ? "Gọi pháo" : "Thả dù"} · {def.cost}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Lớp chi viện trên bản đồ nhỏ (`u`: số mét mỗi điểm ảnh): UAV phe mình đang bay thì mọi kẻ địch còn sống hiện chấm
 * đỏ, vòng quét radar lan ra từ chỗ mình; khói đỏ mưa pháo (của bất kỳ ai) hiện vòng đỏ vùng nguy hiểm.
 */
export function StreakMarks({ room, u }: { room: IslandRoom; u: number }) {
  const s = room.state;
  const me = myId(room);
  const side = sideOf(s, me);
  const uav = uavLeft(s, me) > 0;
  const now = performance.now();
  const out: ReactNode[] = [];
  for (const [key, t] of s.traps) {
    if (t.defId !== "artillery") continue;
    out.push(<circle key={key} cx={t.x} cy={t.z} r={ARTILLERY.spread + ARTILLERY.radius} className="st-bm-arty" />);
  }
  if (uav) {
    const sweep = ((now / 1600) % 1) * 260;
    out.push(<circle key="sweep" cx={localPosition.x} cy={localPosition.z} r={sweep} className="st-bm-sweep" style={{ opacity: 1 - sweep / 260 }} />);
    for (const [id, p] of s.players) {
      if (id === me || !p.alive || (p.team || id) === side) continue;
      out.push(<circle key={`e${id}`} cx={p.x} cy={p.z} r={5 * u} className="st-bm-enemy" />);
    }
  }
  return <>{out}</>;
}
