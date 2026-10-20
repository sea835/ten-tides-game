import { shipClass } from "@tentides/content";
import type { NavalRole } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, look } from "../input.ts";
import { localMotion, localPosition } from "../shared.ts";
import { myUnit, navalLocal } from "../naval/navalRuntime.ts";
import type { BattleModeId } from "../controlsMap.ts";
import type { Signals, TutorialCtx } from "./steps.ts";

// Đo việc người chơi làm cho bài hướng dẫn (steps.ts): lắng nghe phím, chuột, rồi mỗi nhịp đọc chuyển động, trạng thái
// phòng và vị trí trên tàu để cộng dồn thành bộ đếm. Chỉ đọc, không gửi gì lên server và không đụng vào điều khiển.

/** Độ lệch có dấu của bộ đếm 16 bit (PlayerState.shots tràn vòng ở 65536). */
export function wrapDelta(next: number, prev: number): number {
  return (next - prev + 65536) % 65536;
}

export class SignalCollector {
  private sig: Record<string, number> = {};
  private last = 0;
  private prev = {
    active: "",
    reloading: false,
    vehicle: "",
    shots: -1,
    ownFlags: -1,
    insideAt: -1e9,
    throttle: NaN,
    flying: false,
    steering: false,
    yaw: NaN,
    pitch: NaN,
  };

  constructor(private room: IslandRoom) {}

  private bump(key: string, n = 1) {
    this.sig[key] = (this.sig[key] ?? 0) + n;
  }

  /** Gắn lắng nghe phím, chuột; trả về hàm gỡ. */
  attach(): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      this.bump(`key:${e.code}`);
    };
    const onDown = (e: MouseEvent) => {
      const locked = !!document.pointerLockElement;
      this.bump(`${locked ? "mouse" : "ui"}:${e.button}`);
      if (locked && navalLocal.station >= 0) this.bump(`stClick${e.button}`);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }

  /** Hoàn cảnh hiện tại (chế độ, vai trên tàu, khí tài, xe). */
  context(mode: BattleModeId): TutorialCtx {
    const st = this.room.state;
    const me = st.players.get(myId(this.room));
    let role: NavalRole | "" = "";
    let cls = "";
    if (mode === "naval" && me) {
      const own = st.naval.ships.get(me.team);
      if (own) {
        cls = own.cls;
        if (navalLocal.station >= 0) role = shipClass(own.cls).roles[navalLocal.station]?.role ?? "";
      }
    }
    return { mode, role, cls, gadget: !!me?.gear.cls && mode !== "solo", vehicles: st.settings.vehiclesEnabled && st.vehicles.size > 0 };
  }

  /** Đọc trạng thái, cộng dồn bộ đếm, trả về ảnh chụp tín hiệu. Gọi vài lần mỗi giây. */
  poll(): Signals {
    const now = performance.now();
    const dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    const st = this.room.state;
    const me = st.players.get(myId(this.room));
    const s = this.sig;
    const p = this.prev;
    if (me?.alive) {
      const onShip = me.vehicle.startsWith("ship:");
      const stationed = navalLocal.station >= 0 && onShip;
      s.stationed = stationed ? 1 : 0;
      // Đi bộ: chuyển động thật của nhân vật (vị trí đổi theo tàu chạy thì không tính).
      if (!stationed && !me.vehicle && localMotion.moving) this.bump("walk", dt * (localMotion.speed ?? 3));
      if (!me.vehicle && localMotion.running && localMotion.moving) this.bump("sprint", dt);
      if (localMotion.aiming) this.bump("ads", dt);
      // Phát bắn.
      if (p.shots >= 0) this.bump("shots", wrapDelta(me.shots, p.shots));
      p.shots = me.shots;
      const reloading = me.kit.reloading;
      if (reloading && !p.reloading) this.bump("reload");
      p.reloading = reloading;
      if (me.kit.active !== p.active) {
        if (p.active !== "" || me.kit.active !== "") this.bump("switch");
        p.active = me.kit.active;
      }
      if (me.vehicle && !p.vehicle && !onShip) this.bump("vehicle");
      p.vehicle = me.vehicle;
      this.cmdFlags(me, dt, now);
      if (stationed) this.station(dt);
      else {
        p.yaw = NaN;
        p.pitch = NaN;
        if (navalLocal.dousing) this.bump("douse", dt);
      }
      // Lái máy bay, đầu đạn.
      const unit = myUnit.id ? st.naval.units.get(myUnit.id) : undefined;
      const flying = !!unit && unit.kind === "plane";
      const steering = !!unit && !flying;
      if (flying) this.bump("flying", dt);
      if (!flying && p.flying) this.bump("flyEnd");
      if (steering) this.bump("steer", dt);
      if (!steering && p.steering) this.bump("release");
      p.flying = flying;
      p.steering = steering;
    }
    return { ...s };
  }

  /** Cứ điểm: giây đứng trong vòng, số lần phe mình vừa chiếm thêm cứ điểm lúc mình ở đó. */
  private cmdFlags(me: { team: string }, dt: number, now: number) {
    const st = this.room.state;
    if (st.battleMode !== "war" || !st.flags.size) return;
    let inside = false;
    let own = 0;
    st.flags.forEach((f) => {
      if (Math.hypot(localPosition.x - f.x, localPosition.z - f.z) <= f.r) inside = true;
      if (f.owner && f.owner === me.team) own++;
    });
    if (inside) {
      this.bump("flagTime", dt);
      this.prev.insideAt = now;
    }
    if (this.prev.ownFlags >= 0 && own > this.prev.ownFlags && now - this.prev.insideAt < 10_000) this.bump("flagsTaken");
    this.prev.ownFlags = own;
  }

  /** Đứng vị trí trên tàu: tay chuông, bánh lái, xoay ngắm. */
  private station(dt: number) {
    const p = this.prev;
    if (!Number.isNaN(p.throttle) && p.throttle !== navalLocal.throttle) this.bump("throttleChanges");
    p.throttle = navalLocal.throttle;
    if (navalLocal.rudder !== 0) this.bump("rudder", dt);
    // Tổng góc xoay hướng nhìn (rad) từ lúc vào vị trí: đủ để biết người chơi đang rê chuột ngắm.
    if (!Number.isNaN(p.yaw)) this.bump("aimMove", Math.abs(Math.atan2(Math.sin(look.yaw - p.yaw), Math.cos(look.yaw - p.yaw))) + Math.abs(look.pitch - p.pitch));
    p.yaw = look.yaw;
    p.pitch = look.pitch;
  }
}
