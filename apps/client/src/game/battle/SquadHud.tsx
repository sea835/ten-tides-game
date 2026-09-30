import { useEffect, useRef, useState } from "react";
import { ROLES, TANK, mapForMode, type SquadRole } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, look } from "../input.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { getBattleHud, setBattleHud, useBattleHud } from "./runtime.ts";
import { tankHud } from "./Vehicles.tsx";

// Giao diện chế độ Đồng đội và xe tăng: bảng đội (máu, vai trò, ai đang lái tăng), ra lệnh cho máy (Y tới chỗ đang
// nhìn, G giữ chỗ, H theo sau), gục rồi thì chọn máy trong đội để nhập vào, và bảng điều khiển khi lái xe tăng.

const ROLE_ICON: Record<string, string> = { leader: "★", rifle: "▲", sniper: "◎", support: "■", tanker: "⛟", antitank: "✹" };
const ORDER_LABEL: Record<string, string> = { follow: "Theo sau", hold: "Giữ chỗ", move: "Tới điểm" };

/** Tên đội thắng: đội của người chơi nào, hay đội máy số mấy. */
export function teamName(room: IslandRoom, team: string): string {
  if (!team) return "";
  if (team.startsWith("ai")) return `Đội máy ${team.slice(2)}`;
  const p = room.state.players.get(team);
  return p ? `Đội của ${p.name}` : "Một đội";
}

/** Điểm trên mặt đất ở giữa màn hình (dò theo hướng nhìn), để ra lệnh "tới điểm". */
function groundAhead(seed: number, mode: string): { x: number; z: number } | null {
  const world = mapForMode(mode, seed).world;
  const cp = Math.cos(look.pitch);
  // Góc thứ ba: camera sau lưng nhìn xuống nhân vật; tia từ ngang đầu theo hướng nhìn.
  const dx = -Math.sin(look.yaw) * cp;
  const dy = -Math.sin(look.pitch);
  const dz = -Math.cos(look.yaw) * cp;
  let x = localPosition.x;
  let y = localPosition.y + 1.7;
  let z = localPosition.z;
  for (let t = 0; t < 300; t += 1.5) {
    x += dx * 1.5;
    y += dy * 1.5;
    z += dz * 1.5;
    if (y < world.heightAt(x, z)) return { x, z };
  }
  // Nhìn lên trời: lấy điểm xa 60 m theo hướng nhìn.
  return { x: localPosition.x + dx * 60, z: localPosition.z + dz * 60 };
}

/** Lệnh vừa ra (để vẽ trên bản đồ nhỏ). */
export const lastOrder = { kind: "follow", x: 0, z: 0, at: 0 };

export function SquadHud({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => {
    const p = st.players.get(me);
    const team = p?.team ?? "";
    return {
      squad: st.battleMode === "squad",
      phase: st.phase,
      team,
      alive: p?.alive ?? false,
      leader: team === me,
      mates: team
        ? [...st.players.entries()]
            .filter(([id, q]) => q.team === team && id !== me)
            .map(([id, q]) => ({ id, name: q.name.replace("🤖 ", ""), role: q.role, hp: Math.max(0, Math.round(q.hp)), alive: q.alive, tank: !!q.vehicle }))
        : [],
    };
  });
  const hud = useBattleHud();
  const [order, setOrder] = useState("follow");
  const fighting = s.phase === "prep" || s.phase === "battle";

  // Phím ra lệnh (người dẫn đội còn sống) và phím nhập vào máy (đã gục).
  useEffect(() => {
    if (!s.squad || !fighting) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || getBattleHud().buyOpen) return;
      const p = room.state.players.get(me);
      if (!p) return;
      if (p.alive && p.team === me) {
        // Y (không phải F: F là nhặt đồ, lên xuống xe; Q/E là nghiêng người).
        if (e.code === "KeyY") {
          const at = groundAhead(room.state.worldSeed, room.state.battleMode);
          if (!at) return;
          room.send(Messages.squadOrder, { kind: "move", x: at.x, z: at.z });
          Object.assign(lastOrder, { kind: "move", x: at.x, z: at.z, at: performance.now() });
          setOrder("move");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: tới điểm đang nhìn" } });
        } else if (e.code === "KeyG") {
          room.send(Messages.squadOrder, { kind: "hold" });
          Object.assign(lastOrder, { kind: "hold", x: localPosition.x, z: localPosition.z, at: performance.now() });
          setOrder("hold");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: giữ chỗ quanh đây" } });
        } else if (e.code === "KeyH") {
          room.send(Messages.squadOrder, { kind: "follow" });
          Object.assign(lastOrder, { kind: "follow", at: performance.now() });
          setOrder("follow");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: theo sau tôi" } });
        }
        return;
      }
      if (!p.alive && p.team) {
        const alive = [...room.state.players.entries()].filter(([id, q]) => q.team === p.team && id !== me && q.alive && q.bot);
        const n = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
        if (n >= 1 && n <= alive.length) room.send(Messages.possess, { id: alive[n - 1]![0] });
        else if (e.code === "KeyF") {
          const watched = getBattleHud().spectating;
          const target = alive.find(([id]) => id === watched) ?? alive[0];
          if (target) room.send(Messages.possess, { id: target[0] });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.squad, fighting, room, me]);

  if (!s.squad || !fighting || !s.team) return null;
  const aliveMates = s.mates.filter((m) => m.alive);
  return (
    <>
      <div className="b-squad">
        <div className="b-squad-title">
          Đội của bạn{s.leader && s.alive ? <em> · {ORDER_LABEL[order]}</em> : null}
        </div>
        {s.mates.map((m) => (
          <div key={m.id} className={`b-mate-row ${m.alive ? "" : "dead"} ${hud.spectating === m.id ? "watch" : ""}`}>
            <b>{ROLE_ICON[m.role] ?? "•"}</b>
            <span>{m.name}</span>
            <small>{m.tank ? "xe tăng" : (ROLES[m.role as SquadRole]?.name ?? "")}</small>
            <i>
              <u style={{ width: `${m.hp}%` }} />
            </i>
          </div>
        ))}
        {s.alive && s.leader && (
          <p className="b-squad-keys">
            <kbd>Y</kbd> tới chỗ đang nhìn · <kbd>G</kbd> giữ chỗ · <kbd>H</kbd> theo sau
          </p>
        )}
      </div>
      {!s.alive && aliveMates.length > 0 && (
        <div className="b-possess">
          <h3>Nhập vào đồng đội</h3>
          <div>
            {aliveMates.map((m, i) => (
              <button key={m.id} className={hud.spectating === m.id ? "on" : ""} onClick={() => room.send(Messages.possess, { id: m.id })}>
                <kbd>{i + 1}</kbd> {ROLE_ICON[m.role]} {m.name} · {m.hp}♥{m.tank ? " · xe tăng" : ""}
              </button>
            ))}
          </div>
          <p className="muted">
            <kbd>F</kbd> nhập vào người đang xem · bấm chuột để xem người khác
          </p>
        </div>
      )}
    </>
  );
}

/** Nhắc lên xe tăng khi đứng cạnh. */
export function TankPrompt() {
  const hud = useBattleHud();
  if (!hud.nearTank || tankHud.active) return null;
  return (
    <div className="b-pickup">
      ⛟ <kbd>F</kbd> Lên xe tăng
    </div>
  );
}

/** Bảng điều khiển xe tăng: máu xe, nạp đạn, tốc độ, vòng tròn chỗ nòng pháo đang chĩa, tâm ngắm. */
export function TankHud() {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const hp = useRef<HTMLElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const reload = useRef<HTMLElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      el.style.display = tankHud.active ? "" : "none";
      if (!tankHud.active) return;
      el.classList.toggle("zoom", tankHud.zoom);
      if (ring.current) {
        ring.current.style.display = tankHud.aimOn ? "" : "none";
        ring.current.style.left = `${(tankHud.aimX * 100).toFixed(2)}%`;
        ring.current.style.top = `${(tankHud.aimY * 100).toFixed(2)}%`;
        ring.current.classList.toggle("ready", tankHud.reload >= 1);
      }
      if (hp.current) hp.current.style.width = `${(tankHud.hp / TANK.hp) * 100}%`;
      if (hpText.current) hpText.current.textContent = `${Math.max(0, Math.round(tankHud.hp))}`;
      if (reload.current) reload.current.style.width = `${Math.max(0, tankHud.reload) * 100}%`;
      if (speed.current) speed.current.textContent = `${Math.round(Math.abs(tankHud.speed) * 3.6)} km/h`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={root} className="b-tank" style={{ display: "none" }}>
      <div className="b-tank-cross" />
      <div ref={ring} className="b-tank-ring" />
      <div className="b-tank-panel">
        <div className="b-tank-row">
          <span>⛟ Giáp</span>
          <div className="b-tank-bar">
            <i ref={hp} />
          </div>
          <span ref={hpText} />
        </div>
        <div className="b-tank-row">
          <span>Nạp đạn</span>
          <div className="b-tank-bar reload">
            <i ref={reload} />
          </div>
          <span ref={speed} />
        </div>
        <p>
          <kbd>W</kbd>/<kbd>S</kbd> tiến lùi · <kbd>A</kbd>/<kbd>D</kbd> bẻ lái · chuột xoay tháp pháo · chuột trái bắn · chuột phải (hay <kbd>Q</kbd>) kính ngắm · <kbd>E</kbd> xuống xe
        </p>
      </div>
    </div>
  );
}
