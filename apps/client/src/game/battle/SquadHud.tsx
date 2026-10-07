import { useEffect, useRef, useState } from "react";
import { ROLES, TANK, mapForMode, squadSlots, type SquadRole } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, look } from "../input.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { getBattleHud, setBattleHud, useBattleHud } from "./runtime.ts";
import { tankHud } from "./Vehicles.tsx";
import { CarrierHud } from "./CarrierHud.tsx";
import { HeliHud } from "./HeliHud.tsx";
import { AaHud } from "./AirDefense.tsx";
import { EmplacementHud } from "./EmplacementHud.tsx";
import { carrierPrompt } from "./Carriers.tsx";
import { carrierHud, nearInfo } from "./vehicleParts.tsx";
import { RADIO_KEY_LABEL, emptyTankAlong } from "./comms.ts";
import { playPing } from "../sound/radio.ts";

// Giao diện chế độ Đồng đội và xe tăng: bảng đội (máu, vai trò, ai đang lái tăng), ra lệnh cho máy (Y tiến công tới
// chỗ đang nhìn — nhìn vào xe tăng trống thì máy lái tăng lên xe, G giữ chốt phòng thủ, H tập hợp bám sau lưng), gục
// rồi thì bấm 1–5 nhập ngay vào máy theo vai (bảng chọn có vai, máu, khoảng cách), và bảng điều khiển khi lái xe tăng.

const ROLE_ICON: Record<string, string> = { leader: "★", rifle: "▲", sniper: "◎", support: "■", tanker: "⛟", antitank: "✹" };
export const ORDER_LABEL: Record<string, string> = { follow: "Tập hợp", hold: "Giữ chốt", move: "Tấn công", board: "Lên xe tăng" };
/** Bảng lệnh: phím, tên lệnh, giải thích. */
const ORDERS: readonly { key: string; kind: string; text: string }[] = [
  { key: "Y", kind: "move", text: "Di chuyển & tấn công chỗ đang nhìn (nhìn xe tăng trống: lên xe)" },
  { key: "G", kind: "hold", text: "Giữ chốt & phòng thủ quanh đây" },
  { key: "H", kind: "follow", text: "Tập hợp, bám sau lưng" },
];

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

/** Lệnh vừa ra (để vẽ trên bản đồ nhỏ, dấu lệnh trong thế giới). `vid`: xe tăng khi ra lệnh lên xe. */
export const lastOrder = { kind: "follow", x: 0, z: 0, at: 0, vid: "" };

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
      // Ô 1–5 (theo vai) của máy trong đội: vai, máu, còn sống, cách chỗ mình bao xa.
      slots: team
        ? squadSlots([...st.players.entries()].filter(([, q]) => q.bot && q.team === team).map(([id, q]) => ({ id, role: q.role }))).map((id) => {
            const q = id ? st.players.get(id) : undefined;
            if (!id || !q) return null;
            return { id, name: q.name.replace("🤖 ", ""), role: q.role, hp: Math.max(0, Math.round(q.hp)), alive: q.alive, tank: !!q.vehicle, d: p ? Math.round(Math.hypot(q.x - p.x, q.z - p.z) / 5) * 5 : 0 };
          })
        : [],
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
  // Hết trận (hay chưa vào trận): bỏ lệnh cũ, khỏi vẽ dấu lệnh của trận trước.
  useEffect(() => {
    if (fighting) return;
    Object.assign(lastOrder, { kind: "follow", at: 0, vid: "" });
    setOrder("follow");
  }, [fighting]);

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
          // Đang nhìn vào xe tăng trống của đội: máy lái tăng (hay máy gần nhất) chạy tới lên xe.
          const cp = Math.cos(look.pitch);
          const vid = emptyTankAlong(room, p.team, localPosition.x, localPosition.y + 1.7, localPosition.z, -Math.sin(look.yaw) * cp, -Math.sin(look.pitch), -Math.cos(look.yaw) * cp, 120);
          if (vid) {
            room.send(Messages.squadBoard, { vid });
            Object.assign(lastOrder, { kind: "board", vid, at: performance.now() });
            setOrder("board");
            playPing("order");
            setBattleHud({ toast: { at: performance.now(), text: "Đội: lên xe tăng" } });
            return;
          }
          const at = groundAhead(room.state.worldSeed, room.state.battleMode);
          if (!at) return;
          room.send(Messages.squadOrder, { kind: "move", x: at.x, z: at.z });
          Object.assign(lastOrder, { kind: "move", x: at.x, z: at.z, at: performance.now() });
          setOrder("move");
          playPing("order");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: di chuyển & tấn công chỗ đang nhìn" } });
        } else if (e.code === "KeyG") {
          room.send(Messages.squadOrder, { kind: "hold" });
          Object.assign(lastOrder, { kind: "hold", x: localPosition.x, z: localPosition.z, at: performance.now() });
          setOrder("hold");
          playPing("order");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: giữ chốt, phòng thủ quanh đây" } });
        } else if (e.code === "KeyH") {
          room.send(Messages.squadOrder, { kind: "follow" });
          Object.assign(lastOrder, { kind: "follow", at: performance.now() });
          setOrder("follow");
          playPing("order");
          setBattleHud({ toast: { at: performance.now(), text: "Đội: tập hợp, bám sau lưng tôi" } });
        }
        return;
      }
      if (!p.alive && p.team) {
        const alive = [...room.state.players.entries()].filter(([id, q]) => q.team === p.team && id !== me && q.alive && q.bot);
        const n = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
        // Phím 1–5: nhập ngay vào máy ở ô đó (ô theo vai, server tự tìm máy); ô của máy đã gục thì báo.
        if (n >= 1 && n <= 5) {
          const slots = squadSlots([...room.state.players.entries()].filter(([, q]) => q.bot && q.team === p.team).map(([id, q]) => ({ id, role: q.role })));
          const bot = slots[n - 1] ? room.state.players.get(slots[n - 1]!) : undefined;
          if (bot?.alive) room.send(Messages.possess, { slot: n });
          else setBattleHud({ toast: { at: performance.now(), text: bot ? "Đồng đội ở ô này đã gục" : "Ô này trống" } });
        } else if (e.code === "KeyF") {
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
          <div className="b-squad-orders">
            {ORDERS.map((o) => (
              <p key={o.key} className={order === o.kind || (o.kind === "move" && order === "board") ? "on" : ""}>
                <kbd>{o.key}</kbd> {o.text}
              </p>
            ))}
            <p>
              <kbd>{RADIO_KEY_LABEL}</kbd> giữ: bộ đàm · chuột giữa: đánh dấu
            </p>
          </div>
        )}
      </div>
      {!s.alive && aliveMates.length > 0 && (
        <div className="b-possess">
          <h3>Nhập xác đồng đội</h3>
          <div>
            {s.slots.map((m, i) =>
              m ? (
                <button key={m.id} disabled={!m.alive} className={`b-soul ${hud.spectating === m.id ? "on" : ""} ${m.alive ? "" : "dead"}`} onClick={() => m.alive && room.send(Messages.possess, { slot: i + 1 })}>
                  <kbd>{i + 1}</kbd>
                  <b>{ROLE_ICON[m.role] ?? "•"}</b>
                  <span>
                    {ROLES[m.role as SquadRole]?.name ?? m.name}
                    <small>{m.alive ? `${m.name} · ${m.d} m${m.tank ? " · xe tăng" : ""}` : "đã gục"}</small>
                  </span>
                  <i>
                    <u style={{ width: `${m.alive ? m.hp : 0}%` }} />
                  </i>
                </button>
              ) : null,
            )}
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
  if (!hud.nearTank || tankHud.active || carrierHud.active) return null;
  return (
    <div className="b-pickup">
      ⛟ <kbd>F</kbd> {nearInfo.kind && nearInfo.kind !== "tank" ? carrierPrompt(nearInfo.kind, Number(nearInfo.seat)) : "Lên xe tăng"}
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
  const tracks = useRef<HTMLDivElement>(null);
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
      if (tracks.current) {
        tracks.current.style.display = tankHud.tracks > 0 ? "" : "none";
        if (tankHud.tracks > 0) tracks.current.textContent = `⚠ Đứt xích — chỉ quay tại chỗ được (${tankHud.tracks}s)`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
    <CarrierHud />
    <HeliHud />
    <AaHud />
    <EmplacementHud />
    <div ref={root} className="b-tank" style={{ display: "none" }}>
      <div className="b-tank-cross" />
      <div ref={ring} className="b-tank-ring" />
      <div className="b-tank-panel">
        <div ref={tracks} className="b-tank-tracks" style={{ display: "none" }} />
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
          <kbd>W</kbd>/<kbd>S</kbd> tiến lùi · <kbd>A</kbd>/<kbd>D</kbd> bẻ lái · chuột xoay tháp pháo · chuột trái bắn · chuột phải (hay <kbd>Q</kbd>) kính ngắm · <kbd>F</kbd> xuống xe
        </p>
      </div>
    </div>
    </>
  );
}
