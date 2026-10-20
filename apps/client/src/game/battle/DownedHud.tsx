import { useEffect, useRef, useState } from "react";
import { DOWNED, downedMode } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { getBattleHud, setBattleHud } from "./runtime.ts";

// Trọng thương (Chiến trường, Đồng đội): người nằm gục thấy viền đỏ, đồng hồ chảy máu, thanh được cứu; giữ Space
// để bỏ cuộc (chết hẳn, hồi sinh). Đồng đội đứng sát thấy "Giữ F để cứu" và thanh tiến độ. Dấu trên đầu người nằm
// gục vẽ trong RemotePlayers (DownedMark). Số liệu: DOWNED trong content; luật ở apps/server/src/battle/downed.ts.

/** Người đồng đội nằm gục gần nhất trong tầm cứu (id, tên), hay null. */
function nearestDowned(room: IslandRoom, range: number): { id: string; name: string; revive: number } | null {
  const me = room.state.players.get(myId(room));
  if (!me?.alive || me.downed > 0 || me.vehicle || !me.team) return null;
  let best: { id: string; name: string; revive: number } | null = null;
  let bestD = range;
  for (const [id, p] of room.state.players) {
    if (id === myId(room) || !p.alive || p.downed <= 0 || p.team !== me.team || Math.abs(p.y - localPosition.y) > 1.8) continue;
    const d = Math.hypot(p.x - localPosition.x, p.z - localPosition.z);
    if (d >= bestD) continue;
    bestD = d;
    best = { id, name: p.name.replace("🤖 ", ""), revive: p.revive };
  }
  return best;
}

/** Dấu trên đầu đồng đội nằm gục: chữ thập đỏ, số giây còn chảy máu. */
export function downedLabel(seconds: number): string {
  return `✚ ${Math.ceil(seconds)}s`;
}

export function DownedHud({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => {
    const p = st.players.get(me);
    return { on: downedMode(st.battleMode) && st.phase === "battle", alive: p?.alive ?? false, left: Math.ceil(p?.downed ?? 0), revive: p?.revive ?? 0 };
  });
  const [, tick] = useState(0);
  const near = useRef<ReturnType<typeof nearestDowned>>(null);
  const holding = useRef("");
  const giveUp = useRef(0);
  const [giving, setGiving] = useState(0);
  const downed = s.on && s.alive && s.left > 0;

  // Dò đồng đội nằm gục quanh mình vài lần mỗi giây; không còn trong tầm thì buông phím cứu.
  useEffect(() => {
    if (!s.on) return;
    const t = setInterval(() => {
      near.current = nearestDowned(room, DOWNED.range + 0.4);
      setBattleHud({ nearDowned: near.current?.id ?? "" });
      if (holding.current && holding.current !== near.current?.id) {
        room.send(Messages.revive, { target: holding.current, on: false });
        holding.current = "";
      }
      if (giveUp.current) {
        const k = Math.min(1, (performance.now() - giveUp.current) / (DOWNED.giveUpHold * 1000));
        setGiving(k);
        if (k >= 1) {
          giveUp.current = 0;
          room.send(Messages.giveUp);
        }
      }
      tick((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(t);
      setBattleHud({ nearDowned: "" });
    };
  }, [room, s.on]);

  // F: giữ để cứu; Space (khi chính mình nằm gục): giữ để bỏ cuộc.
  useEffect(() => {
    if (!s.on) return;
    const stop = () => {
      if (holding.current) room.send(Messages.revive, { target: holding.current, on: false });
      holding.current = "";
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      if (e.code === "KeyF" && near.current && getBattleHud().nearDowned) {
        holding.current = near.current.id;
        room.send(Messages.revive, { target: near.current.id, on: true });
      } else if (e.code === "Space" && (room.state.players.get(me)?.downed ?? 0) > 0) {
        giveUp.current = performance.now();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyF") stop();
      else if (e.code === "Space") {
        giveUp.current = 0;
        setGiving(0);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [room, me, s.on]);

  if (downed)
    return (
      <div className="b-downed">
        <div className="b-downed-card">
          <h2>Bạn bị thương nặng</h2>
          <div className={`b-downed-time ${s.revive > 0 ? "saved" : ""}`}>{s.revive > 0 ? "Đang được cứu…" : `Mất máu: ${s.left}s`}</div>
          <div className="b-downed-bar">
            <u className="bleed" style={{ width: `${Math.min(100, (s.left / DOWNED.seconds) * 100)}%` }} />
          </div>
          {s.revive > 0 && (
            <div className="b-downed-bar rev">
              <u style={{ width: `${s.revive}%` }} />
            </div>
          )}
          <p className="muted">
            Bò tìm chỗ nấp, chờ đồng đội cứu · giữ <kbd>Space</kbd> để bỏ cuộc và hồi sinh
          </p>
          {giving > 0 && (
            <div className="b-downed-bar give">
              <u style={{ width: `${giving * 100}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  const target = s.on && s.alive ? near.current : null;
  if (!target) return null;
  return (
    <div className="b-revive-prompt">
      <b>
        Giữ <kbd>F</kbd> để cứu
      </b>{" "}
      {target.name}
      <div className="b-downed-bar rev">
        <u style={{ width: `${target.revive}%` }} />
      </div>
    </div>
  );
}
