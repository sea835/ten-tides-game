import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { JET, shipClass } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { localPosition } from "../shared.ts";
import { audio } from "../sound/engine.ts";
import { planeEngineSound, shipEngineSound, type LoopSound } from "../sound/naval.ts";
import { myUnit, shipPose } from "./navalRuntime.ts";

// Tiếng máy hải chiến: máy từng tàu (to dần theo tốc độ; đứng trên tàu mình thì nghe như ở trong tàu), động cơ từng
// máy bay (máy bay mình lái nghe từ buồng lái). Dựng khi âm thanh đã bật, tắt khi tàu chìm, máy bay rơi.

function audioOn(): boolean {
  return !!audio.ctx && audio.ctx.state === "running" && !audio.settings.muted;
}

export function NavalSounds({ room }: { room: IslandRoom }) {
  const ships = useRef(new Map<string, LoopSound>());
  const planes = useRef(new Map<string, LoopSound>());
  useEffect(() => {
    const s = ships.current;
    const p = planes.current;
    return () => {
      for (const h of s.values()) h.stop();
      for (const h of p.values()) h.stop();
      s.clear();
      p.clear();
    };
  }, []);

  useFrame(() => {
    const ns = room.state.naval;
    if (!ns) return;
    const on = audioOn();
    // Máy tàu.
    const seenShips = new Set<string>();
    ns.ships.forEach((s, id) => {
      if (s.sunk || !on) return;
      const pose = shipPose(id);
      if (!pose) return;
      seenShips.add(id);
      const cls = shipClass(s.cls);
      let h = ships.current.get(id);
      if (!h) {
        h = shipEngineSound(cls.length / 140);
        ships.current.set(id, h);
      }
      const aboard = Math.hypot(localPosition.x - pose.x, localPosition.z - pose.z) < cls.length * 0.55 && Math.abs(localPosition.y - pose.y) < 40;
      h.update({ x: pose.x, y: pose.y + 2, z: pose.z }, Math.max(Math.abs(s.speed) / cls.speed, Math.abs(s.throttle) * 0.4), aboard && myUnit.id === "");
    });
    for (const [id, h] of ships.current) {
      if (seenShips.has(id)) continue;
      h.stop();
      ships.current.delete(id);
    }
    // Máy bay.
    const seenPlanes = new Set<string>();
    ns.units.forEach((u, id) => {
      if (u.kind !== "plane" || !on) return;
      seenPlanes.add(id);
      let h = planes.current.get(id);
      if (!h) {
        h = planeEngineSound();
        planes.current.set(id, h);
      }
      const own = myUnit.id === id;
      const at = own ? myUnit : u;
      h.update({ x: at.x, y: at.y, z: at.z }, (own ? myUnit.speed : u.speed) / JET.max, own);
    });
    for (const [id, h] of planes.current) {
      if (seenPlanes.has(id)) continue;
      h.stop();
      planes.current.delete(id);
    }
  });
  return null;
}
