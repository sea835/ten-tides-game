import { useEffect, useRef, useState } from "react";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { setBattleHud } from "./runtime.ts";

// Giao diện chiến trường 50 vs 50: vé quân hai phe và dãy cứ điểm A–G trên cùng, thanh chiếm khi đứng trong vùng
// một cứ điểm, thông báo cứ điểm đổi chủ, và màn hồi sinh (chọn lớp lính, chọn căn cứ hay cứ điểm phe mình giữ).

export const SIDE_NAME: Record<string, string> = { blue: "Phe Xanh", red: "Phe Đỏ" };
const ROLE_LIST = [
  { id: "rifle", name: "Súng trường", icon: "▲", info: "M416 / AKM / SCAR, lựu đạn" },
  { id: "support", name: "Súng máy", icon: "■", info: "M249 100 viên, bom khói" },
  { id: "sniper", name: "Bắn tỉa", icon: "◎", info: "Kar98k / SKS ống 8x, ghillie" },
  { id: "antitank", name: "Chống tăng", icon: "✹", info: "RPG-7 + 6 quả, tiểu liên" },
  { id: "tanker", name: "Lái tăng", icon: "⛟", info: "Lên xe tăng trống ở căn cứ" },
] as const;
type RoleId = (typeof ROLE_LIST)[number]["id"];

/** Trên cùng: vé quân hai phe (thanh co dần), dãy cứ điểm theo màu phe giữ. */
export function WarTop({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    blue: st.ticketsBlue,
    red: st.ticketsRed,
    side: st.players.get(myId(room))?.team ?? "",
    flags: [...st.flags.entries()].map(([id, f]) => ({ id, owner: f.owner, p: Math.round(f.progress * 20) / 20 })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
  const max = Math.max(250, s.blue, s.red);
  return (
    <div className="w-top">
      <div className={`w-tickets blue ${s.side === "blue" ? "mine" : ""}`}>
        <span>{SIDE_NAME.blue}</span>
        <i>
          <u style={{ width: `${(s.blue / max) * 100}%` }} />
        </i>
        <b>{s.blue}</b>
      </div>
      <div className="w-flags">
        {s.flags.map((f) => (
          <span key={f.id} className={`w-flag ${f.owner || "neutral"} ${f.owner && f.owner === s.side ? "ours" : ""}`} title={`Cứ điểm ${f.id}`}>
            {f.id}
            {!f.owner && f.p !== 0 && <em style={{ width: `${Math.abs(f.p) * 100}%`, background: f.p > 0 ? "#2f6bff" : "#e0332b" }} />}
          </span>
        ))}
      </div>
      <div className={`w-tickets red ${s.side === "red" ? "mine" : ""}`}>
        <b>{s.red}</b>
        <i>
          <u style={{ width: `${(s.red / max) * 100}%` }} />
        </i>
        <span>{SIDE_NAME.red}</span>
      </div>
    </div>
  );
}

/** Đứng trong vùng một cứ điểm: tên, tiến độ chiếm, bên nào đông hơn; có địch thì báo giằng co. */
export function CaptureBar({ room }: { room: IslandRoom }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  const me = room.state.players.get(myId(room));
  if (!me?.alive) return null;
  let inside: { id: string; name: string; owner: string; progress: number; blue: number; red: number } | null = null;
  for (const [id, f] of room.state.flags) {
    if (Math.hypot(localPosition.x - f.x, localPosition.z - f.z) <= f.r) inside = { id, name: f.name, owner: f.owner, progress: f.progress, blue: f.blue, red: f.red };
  }
  if (!inside) return null;
  const contested = inside.blue > 0 && inside.red > 0;
  const mine = me.team;
  const ours = inside.owner === mine;
  const status = contested ? "Đang giằng co!" : ours && Math.abs(inside.progress) >= 1 ? "Phe mình đang giữ" : inside.owner && !ours ? "Đang hạ cờ địch…" : "Đang chiếm…";
  return (
    <div className={`w-capture ${contested ? "contested" : ""}`}>
      <div className="w-capture-title">
        <b>{inside.id}</b> {inside.name} · {status}
      </div>
      <div className="w-capture-bar">
        <u className="red" style={{ width: `${Math.max(0, -inside.progress) * 50}%` }} />
        <u className="blue" style={{ width: `${Math.max(0, inside.progress) * 50}%` }} />
      </div>
      <div className="w-capture-count">
        <span className="blue">{inside.blue} xanh</span> · <span className="red">{inside.red} đỏ</span>
      </div>
    </div>
  );
}

/** Cứ điểm đổi chủ: thông báo giữa màn hình. */
export function useFlagToasts(room: IslandRoom) {
  useEffect(
    () =>
      room.onMessage(Messages.flag, (m: { name: string; side: string }) => {
        const mine = room.state.players.get(myId(room))?.team === m.side;
        setBattleHud({ toast: { at: performance.now(), text: `${mine ? "✔ Phe mình" : "✖ " + SIDE_NAME[m.side]} chiếm ${m.name}` } });
      }),
    [room],
  );
}

/** Gục trên chiến trường: đếm ngược, chọn lớp lính và chỗ hồi sinh. */
export function Deploy({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => {
    const p = st.players.get(me);
    return {
      phase: st.phase,
      alive: p?.alive ?? true,
      side: p?.team ?? "",
      wait: Math.ceil(p?.respawn ?? 0),
      flags: [...st.flags.entries()].filter(([, f]) => f.owner && f.owner === p?.team).map(([id, f]) => ({ id, name: f.name, enemy: p?.team === "blue" ? f.red : f.blue })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  });
  const [role, setRole] = useState<RoleId>("rifle");
  const [at, setAt] = useState("hq");
  const was = useRef(true);
  // Vừa gục: thả chuột để bấm chọn được.
  useEffect(() => {
    if (was.current && !s.alive && document.pointerLockElement) document.exitPointerLock?.();
    was.current = s.alive;
  }, [s.alive]);
  // Phím đọc lựa chọn mới nhất qua ref: bộ nghe chỉ gắn một lần mỗi lần gục, không hụt phím giữa hai lần vẽ.
  const pick = useRef({ role, at, wait: s.wait });
  pick.current = { role, at, wait: s.wait };
  const go = (where = at) => room.send(Messages.respawn, { at: where, role: pick.current.role });
  useEffect(() => {
    if (s.alive) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      const n = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
      if (n >= 1 && n <= ROLE_LIST.length) {
        pick.current.role = ROLE_LIST[n - 1]!.id;
        setRole(pick.current.role);
      }
      if ((e.code === "Enter" || e.code === "Space") && pick.current.wait <= 0) room.send(Messages.respawn, { at: pick.current.at, role: pick.current.role });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.alive, room]);
  if (s.alive || (s.phase !== "battle" && s.phase !== "prep")) return null;
  const ready = s.wait <= 0;
  return (
    <div className="w-deploy">
      <h2>{ready ? "Chọn chỗ hồi sinh" : `Hồi sinh sau ${s.wait}s`}</h2>
      <div className="w-roles">
        {ROLE_LIST.map((r, i) => (
          <button key={r.id} className={role === r.id ? "on" : ""} onClick={() => setRole(r.id)}>
            <kbd>{i + 1}</kbd>
            <b>
              {r.icon} {r.name}
            </b>
            <small>{r.info}</small>
          </button>
        ))}
      </div>
      <div className="w-spawns">
        <button className={at === "hq" ? "on" : ""} onClick={() => setAt("hq")}>
          🏠 Căn cứ
        </button>
        {s.flags.map((f) => (
          <button key={f.id} className={at === f.id ? "on" : ""} onClick={() => setAt(f.id)} title={f.enemy ? "Đang bị địch tấn công" : ""}>
            <b>{f.id}</b> {f.name}
            {f.enemy ? " ⚠" : ""}
          </button>
        ))}
      </div>
      <button className="primary big" disabled={!ready} onClick={() => go()}>
        {ready ? "Xuất kích" : `Chờ ${s.wait}s…`} <kbd>Enter</kbd>
      </button>
      <p className="muted">Không chọn thì tự hồi sinh ở căn cứ sau ít giây.</p>
    </div>
  );
}
