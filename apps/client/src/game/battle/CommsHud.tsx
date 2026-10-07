import { useEffect, useRef, useState } from "react";
import { Messages, PING_WHEEL, type PingBroadcast, type RadioBroadcast } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, lookLock } from "../input.ts";
import { playPing, playRadio } from "../sound/radio.ts";
import { playSpotted } from "../sound/gadgets.ts";
import { MARKER_POOL, PING_ICON, PING_LABEL, RADIO_ICON, RADIO_KEY, RADIO_KEY_LABEL, RADIO_TEXT, RADIO_WHEEL, addPing, markerPool, pings, pruneRadio, pushRadio, usePingWheel, useRadioFeed } from "./comms.ts";
import { getBattleHud } from "./runtime.ts";
import "./comms.css";

// Giao diện liên lạc trong đội: nhận dấu, câu bộ đàm từ server (kèm tiếng bíp, tiếng xè bộ đàm), các ô dấu nổi trên
// màn hình (CommsWorld đặt vị trí), vòng khẩu lệnh bộ đàm (giữ phím ` (~): chuột chọn ô, thả phím để nói) và bảng tin
// bộ đàm của đội, vòng chọn dấu (giữ chuột giữa: CommsWorld mở và chọn ô).

/** Dòng bộ đàm hiện bao lâu (ms). */
const FEED_MS = 9000;
/** Chuột phải đi chừng này điểm ảnh khỏi tâm vòng mới tính là chọn ô. */
const WHEEL_DEAD = 24;

export function CommsHud({ room }: { room: IslandRoom }) {
  const feed = useRadioFeed();
  const pingWheel = usePingWheel();
  const [wheel, setWheel] = useState<{ open: boolean; pick: number }>({ open: false, pick: -1 });

  // Gói từ server.
  useEffect(() => {
    const offPing = room.onMessage(Messages.ping, (m: PingBroadcast) => {
      addPing(m, myId(room));
      if (m.kind === "spotted") playSpotted();
      else playPing(m.kind === "enemy" || m.kind === "seen" ? "enemy" : m.kind === "danger" || m.kind === "careful" ? "danger" : m.kind === "spot" || m.kind === "loot" ? "spot" : "order");
    });
    const offRadio = room.onMessage(Messages.radio, (m: RadioBroadcast) => {
      pushRadio(m, myId(room));
      playRadio();
    });
    const prune = window.setInterval(() => pruneRadio(performance.now(), FEED_MS), 500);
    return () => {
      offPing();
      offRadio();
      window.clearInterval(prune);
      pings.length = 0;
    };
  }, [room]);

  // Vòng khẩu lệnh: giữ phím để mở (camera thôi xoay, chuột chọn ô), thả phím để gửi câu đang chọn.
  useEffect(() => {
    let open = false;
    let pick = -1;
    let raf = 0;
    const close = (send: boolean) => {
      if (!open) return;
      open = false;
      lookLock.active = false;
      cancelAnimationFrame(raf);
      if (send && pick >= 0) room.send(Messages.radio, { line: RADIO_WHEEL[pick]! });
      pick = -1;
      setWheel({ open: false, pick: -1 });
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = Math.hypot(lookLock.dx, lookLock.dy);
      // Giữ chuột trong vòng (không trôi mãi ra xa), để đổi ô cho nhanh.
      if (r > 120) {
        lookLock.dx *= 120 / r;
        lookLock.dy *= 120 / r;
      }
      let next = pick;
      if (r > WHEEL_DEAD) {
        // Ô 0 ở trên cùng, theo chiều kim đồng hồ.
        const a = Math.atan2(lookLock.dx, -lookLock.dy);
        const n = RADIO_WHEEL.length;
        next = ((Math.round(a / ((Math.PI * 2) / n)) % n) + n) % n;
      }
      if (next !== pick) {
        pick = next;
        setWheel({ open: true, pick });
      }
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== RADIO_KEY || e.repeat || isTyping(e) || open || lookLock.active) return;
      const hud = getBattleHud();
      const phase = room.state.phase;
      if (hud.buyOpen || hud.settingsOpen || (phase !== "prep" && phase !== "battle")) return;
      if (!room.state.players.get(myId(room))?.alive) return;
      e.preventDefault();
      open = true;
      pick = -1;
      lookLock.active = true;
      lookLock.dx = 0;
      lookLock.dy = 0;
      setWheel({ open: true, pick: -1 });
      raf = requestAnimationFrame(loop);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === RADIO_KEY) close(true);
    };
    const onBlur = () => close(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      close(false);
    };
  }, [room]);

  return (
    <>
      <MarkerLayer />
      {feed.length > 0 && (
        <div className="cm-feed">
          {feed.map((e) => (
            <p key={e.key} className={e.mine ? "mine" : ""}>
              <b>📻 {e.name}:</b> {e.text}
            </p>
          ))}
        </div>
      )}
      {wheel.open && <RadioWheel pick={wheel.pick} />}
      {pingWheel.open && <PingWheel pick={pingWheel.pick} />}
    </>
  );
}

/** Các ô dấu dựng sẵn (ẩn); cảnh 3D đặt chỗ, chữ, khoảng cách mỗi khung hình, khỏi dựng lại React. */
function MarkerLayer() {
  const els = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    markerPool.els = els.current;
    return () => {
      markerPool.els = [];
    };
  }, []);
  return (
    <div className="cm-marks">
      {Array.from({ length: MARKER_POOL }, (_, i) => (
        <div key={i} ref={(el) => void (els.current[i] = el)} className="cm-mark" style={{ display: "none" }}>
          <i className="cm-arrow" />
          <b className="cm-icon" />
          <span className="cm-label" />
          <em className="cm-dist" />
        </div>
      ))}
    </div>
  );
}

function RadioWheel({ pick }: { pick: number }) {
  const n = RADIO_WHEEL.length;
  return (
    <div className="cm-wheel">
      {RADIO_WHEEL.map((line, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <div key={line} className={`cm-slice ${pick === i ? "on" : ""}`} style={{ left: `${50 + Math.sin(a) * 38}%`, top: `${50 - Math.cos(a) * 38}%` }}>
            <b>{RADIO_ICON[line]}</b>
            <span>{RADIO_TEXT[line]}</span>
          </div>
        );
      })}
      <div className="cm-wheel-hub">{pick >= 0 ? RADIO_TEXT[RADIO_WHEEL[pick]!] : `Bộ đàm · thả ${RADIO_KEY_LABEL} để nói`}</div>
    </div>
  );
}

/** Vòng chọn dấu (giữ chuột giữa): sáu ô quanh tâm, thả chuột để đánh dấu ô đang chọn. */
function PingWheel({ pick }: { pick: number }) {
  const n = PING_WHEEL.length;
  return (
    <div className="cm-wheel ping">
      {PING_WHEEL.map((kind, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <div key={kind} className={`cm-slice ${kind} ${pick === i ? "on" : ""}`} style={{ left: `${50 + Math.sin(a) * 36}%`, top: `${50 - Math.cos(a) * 36}%` }}>
            <b>{PING_ICON[kind]}</b>
            <span>{PING_LABEL[kind]}</span>
          </div>
        );
      })}
      <div className="cm-wheel-hub">{pick >= 0 ? PING_LABEL[PING_WHEEL[pick]!] : "Đánh dấu · thả chuột giữa để chọn"}</div>
    </div>
  );
}

/** Dấu trên bản đồ nhỏ (`u`: số mét mỗi điểm ảnh của bản đồ). */
export function PingMarks({ u }: { u: number }) {
  return (
    <>
      {pings.map((p) => (
        <g key={p.key} transform={`translate(${p.x} ${p.z}) scale(${u})`} className={`bm-ping ${p.kind}`}>
          {p.kind === "danger" ? <path d="M0,-8 L7,6 L-7,6 Z" /> : p.kind === "enemy" || p.kind === "spotted" ? <path d="M0,-7 L7,0 L0,7 L-7,0 Z" /> : <circle r={5} />}
        </g>
      ))}
    </>
  );
}
