import { useEffect, useRef, useState, type ReactNode } from "react";
import { FIRE, JET, NAVAL_WEAPONS, SUB, shipClass, type NavalWeaponId, type ShipClass } from "@tentides/content";
import type { ShipState } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { mountsReady } from "./NavalControl.tsx";
import { myUnit, navalLocal } from "./navalRuntime.ts";
import "./naval.css";

// Giao diện hải chiến: hai tàu (máu, cháy) và đồng hồ trận ở trên; bảng tình trạng tàu mình (bộ phận hỏng, đang
// cháy, ụ đang nạp); bảng vị trí đang đứng (phím, tay chuông, bánh lái, tầm ngắm, dưỡng khí, đầu đạn đang lái); dòng
// nhắc F; dấu ngắm đón đầu cho phòng không; dấu tàu địch ở mép màn hình; đếm ngược hồi sinh.

const SIDE = { blue: "Hạm đội Xanh", red: "Hạm đội Đỏ" } as Record<string, string>;
const WEAPON_LABEL: Partial<Record<NavalWeaponId, string>> = {
  bbGun: "Pháo chính",
  ddGun: "Pháo",
  aa: "Phòng không",
  torpedo: "Ngư lôi",
  gtorpedo: "Ngư lôi dẫn đường",
  missile: "Tên lửa",
  depth: "Bom chìm",
  decoy: "Mồi nhử",
};

function useTick(hz: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => (n + 1) % 1e6), 1000 / hz);
    return () => clearInterval(t);
  }, [hz]);
}

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function knots(ms: number): string {
  return `${Math.round(Math.abs(ms) * 1.944)} hl/g`;
}

export function NavalHud({ room }: { room: IslandRoom }) {
  useTick(10);
  const st = room.state;
  const me = st.players.get(myId(room));
  if (!me) return null;
  const ships = [...st.naval.ships.values()];
  const own = st.naval.ships.get(me.team);
  const fighting = st.phase === "battle" || st.phase === "prep";
  if (!fighting) return null;
  return (
    <div className="naval-hud">
      <div className="nv-top">
        {ships
          .sort((a, b) => (a.team === "blue" ? -1 : b.team === "blue" ? 1 : 0))
          .map((s, i) => (
            <ShipCard key={s.team} s={s} mine={s.team === me.team} right={i === 1} />
          ))}
        <div className="nv-clock">{st.phase === "prep" ? "Chuẩn bị" : mmss(st.naval.timeLeft)}</div>
      </div>
      {own && <OwnShip s={own} />}
      {own && me.alive && navalLocal.station >= 0 && <Station room={room} s={own} />}
      {me.alive && navalLocal.station < 0 && navalLocal.near.label && (
        <div className="nv-prompt">{navalLocal.near.label.replace(/^(F|Giữ F)/, (k) => `[${k}]`)}</div>
      )}
      {me.alive && navalLocal.station < 0 && !navalLocal.near.label && st.phase === "battle" && (
        <div className="nv-hint">Đi tới bàn điều khiển (vòng sáng trên boong) rồi bấm F để vào vị trí. Giữ F cạnh đám cháy để dập lửa.</div>
      )}
      {!me.alive && st.phase === "battle" && (
        <div className="nv-dead">
          {own?.sunk ? (
            <h2>Tàu mình đã chìm</h2>
          ) : (
            <>
              <h2>Bạn đã gục</h2>
              <p>Hồi sinh trên tàu sau {Math.max(0, Math.ceil(me.respawn))} giây</p>
            </>
          )}
        </div>
      )}
      <Overlay />
    </div>
  );
}

function ShipCard({ s, mine, right }: { s: ShipState; mine: boolean; right: boolean }) {
  const cls = shipClass(s.cls);
  const frac = Math.max(0, s.hp / Math.max(1, s.maxHp));
  return (
    <div className={`nv-card ${s.team} ${mine ? "mine" : ""} ${right ? "right" : ""} ${s.sunk ? "sunk" : ""}`}>
      <div className="nv-card-name">
        <b>{SIDE[s.team] ?? s.team}</b> · {cls.name} {mine && <em>(tàu mình)</em>}
      </div>
      <div className="nv-bar">
        <i style={{ width: `${frac * 100}%` }} />
        <span>{s.sunk ? "ĐÃ CHÌM" : `${Math.max(0, s.hp)} / ${s.maxHp}`}</span>
      </div>
      <div className="nv-card-tags">
        {s.fires.size > 0 && <span className="fire">🔥 {s.fires.size} đám cháy</span>}
        {s.cls === "submarine" && s.y < -4 && <span>đang lặn</span>}
        {s.decoy > 0 && <span>mồi nhử</span>}
      </div>
    </div>
  );
}

/** Bảng tình trạng tàu mình: bộ phận (máu, cháy, nạp), tốc độ. */
function OwnShip({ s }: { s: ShipState }) {
  const cls = shipClass(s.cls);
  const parts = cls.parts.filter((p) => p.kind !== "section");
  return (
    <div className="nv-own">
      <div className="nv-own-head">
        {cls.name} · {knots(s.speed)} · máy {Math.round(s.throttle * 100)}%
      </div>
      <div className="nv-parts">
        {parts.map((p) => {
          const hp = s.parts.get(p.id) ?? 100;
          const fire = s.fires.get(p.id) ?? 0;
          const cool = s.cool.get(p.id) ?? 0;
          const w = p.mount?.weapon;
          const reload = w ? NAVAL_WEAPONS[w].reload : 0;
          return (
            <div key={p.id} className={`nv-part ${hp <= 0 ? "dead" : hp < 50 ? "hurt" : ""} ${fire ? "burning" : ""}`} title={p.name}>
              <span className="nv-part-name">{p.name}</span>
              <span className="nv-part-bar">
                <i style={{ width: `${hp}%` }} />
                {cool > 0 && reload > 0 && <b style={{ width: `${(1 - cool / reload) * 100}%` }} />}
              </span>
              {fire > 0 && <span className="nv-flame">🔥</span>}
              {hp <= 0 && <span className="nv-broken">hỏng</span>}
            </div>
          );
        })}
        {["bow", "mid", "stern"]
          .filter((k) => s.fires.has(k))
          .map((k) => (
            <div key={k} className="nv-part burning">
              <span className="nv-part-name">{cls.parts.find((p) => p.id === k)?.name}</span>
              <span className="nv-flame">🔥 cháy</span>
            </div>
          ))}
      </div>
      {s.fires.size > 0 && (
        <div className="nv-warn">
          Tàu đang cháy: đi tới đám cháy, giữ F để dập (mỗi đám cháy lớn dần, ăn máu tàu và lan sang bộ phận khác; tối đa {FIRE.max} đám).
        </div>
      )}
    </div>
  );
}

function weaponLine(s: ShipState, cls: ShipClass, w: NavalWeaponId, yaw?: number) {
  const r = mountsReady(s, cls, w, yaw);
  if (!r.total) return null;
  const label = WEAPON_LABEL[w] ?? w;
  const state =
    r.alive === 0 ? "đã hỏng hết" : r.ready === 0 ? `nạp ${r.next.toFixed(1)}s` : yaw !== undefined && r.cover === 0 ? "không quay tới hướng này" : "sẵn sàng";
  return (
    <div className={`nv-wl ${r.alive === 0 ? "dead" : r.ready ? (yaw === undefined || r.cover ? "ok" : "warn") : "wait"}`} key={w}>
      <b>{label}</b> {r.alive}/{r.total} ụ còn dùng · {yaw !== undefined && r.ready ? `${r.cover} ụ quay tới · ` : ""}
      {state}
    </div>
  );
}

/** Bảng vị trí mình đang đứng. */
function Station({ room, s }: { room: IslandRoom; s: ShipState }) {
  const cls = shipClass(s.cls);
  const role = cls.roles[navalLocal.station];
  if (!role) return null;
  const unit = myUnit.id ? room.state.naval.units.get(myUnit.id) : undefined;
  const lines: ReactNode[] = [];
  let keys: string[] = [];
  if (unit) {
    if (unit.kind === "plane") {
      keys = ["Chuột: hướng bay", "W/S: ga", "Chuột trái: pháo 20 ly", "Chuột phải: thả bom", "F: bỏ máy bay"];
      lines.push(
        <div key="p" className="nv-wl ok">
          <b>Máy bay</b> {Math.round(myUnit.speed * 3.6)} km/h · cao {Math.round(myUnit.y)} m · bom {unit.bombs}/{JET.bombs} · thân {Math.max(0, unit.hp)}
        </div>,
      );
      if (unit.bombs < JET.bombs)
        lines.push(
          <div key="r" className="nv-wl">
            Bay thấp (dưới 70 m) sát tàu mẹ để nạp bom
          </div>,
        );
      if (navalLocal.bombT > 0)
        lines.push(
          <div key="b" className="nv-wl">
            Bom chạm nước sau {navalLocal.bombT.toFixed(1)}s (vòng cam trên mặt biển)
          </div>,
        );
    } else {
      keys = ["Chuột: lái đầu đạn vào tàu địch", "Bấm chuột: thả cho tự dẫn, về vị trí"];
      lines.push(
        <div key="u" className="nv-wl ok">
          <b>{unit.kind === "missile" ? "Tên lửa" : "Ngư lôi dẫn đường"}</b> {Math.round(myUnit.speed * 3.6)} km/h
          {unit.kind === "missile" ? ` · cao ${Math.round(myUnit.y)} m · bay thấp để tránh phòng không` : ""}
        </div>,
      );
    }
  } else {
    if (role.helm) {
      keys = ["W/S: tay chuông máy", "A/D: bánh lái", "X: dừng máy"];
      if (cls.id === "submarine") keys.push("C: lặn / nổi", "Q/E: nông / sâu hơn", "Chuột phải: kính tiềm vọng (lặn nông)");
    }
    if (role.weapons.includes("torpedo")) keys.push("Chuột trái: phóng ngư lôi theo hướng nhìn");
    if (role.weapons.includes("depth")) keys.push("Chuột phải: thả bom chìm");
    if (role.weapons.includes("decoy")) keys.push("Chuột phải: phóng mồi nhử");
    if (role.weapons.includes("bbGun") || role.weapons.includes("ddGun")) keys.push("Chuột: ngắm mặt biển", "Chuột trái: bắn loạt", "Chuột phải: ống nhòm");
    if (role.weapons.includes("aa")) keys.push("Giữ chuột trái: bắn", "Chuột phải: phóng to", "Ngắm vào vòng đón đầu");
    if (role.weapons.includes("missile")) keys.push("Chuột trái: phóng tên lửa rồi lái");
    if (role.weapons.includes("gtorpedo")) keys.push("Chuột trái: phóng ngư lôi rồi lái");
    if (role.role === "pilot") keys.push("Chuột trái: cất cánh");
    keys.push("F: rời vị trí");
    for (const w of role.weapons) {
      if (w === "jetGun" || w === "bomb") continue;
      const yaw = w === "bbGun" || w === "ddGun" ? navalLocal.aimYaw : undefined;
      lines.push(weaponLine(s, cls, w, yaw));
    }
    if (role.weapons.includes("bbGun") || role.weapons.includes("ddGun"))
      lines.push(
        <div key="rng" className="nv-wl">
          Tầm {Math.round(navalLocal.aimRange)} m · đạn bay {navalLocal.flight.toFixed(1)}s
        </div>,
      );
    if (role.role === "pilot") {
      const cat = (s.parts.get("cat") ?? 100) > 0;
      let wing = 0;
      room.state.naval.units.forEach((u) => {
        if (u.kind === "plane" && u.auto && u.ship === s.team) wing++;
      });
      lines.push(
        <div key="j" className={`nv-wl ${cat && !s.jet && s.jetWait <= 0 ? "ok" : "wait"}`}>
          {!cat
            ? "Máy phóng hỏng: không cất cánh được"
            : s.jet
              ? `Phi đội đang bay: máy bay của bạn + ${wing} máy bay yểm trợ tự đánh`
              : s.jetWait > 0
                ? `Máy bay mới sau ${Math.ceil(s.jetWait)}s`
                : `Phi đội sẵn sàng cất cánh (1 + ${JET.wingmen} máy bay)`}
        </div>,
      );
    }
  }
  return (
    <div className="nv-station">
      <div className="nv-role">
        {role.name}
        <small>{role.brief}</small>
      </div>
      {role.helm && !unit && <Helm s={s} cls={cls} />}
      {lines}
      <div className="nv-keys">
        {keys.map((k) => (
          <span key={k}>{k}</span>
        ))}
      </div>
    </div>
  );
}

const STEPS = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1];
const STEP_NAME: Record<string, string> = { "-1": "Lùi hết", "-0.5": "Lùi", "0": "Dừng", "0.25": "Chậm", "0.5": "Nửa", "0.75": "Mạnh", "1": "Hết máy" };

function Helm({ s, cls }: { s: ShipState; cls: ShipClass }) {
  return (
    <div className="nv-helm">
      <div className="nv-telegraph">
        {STEPS.map((k) => (
          <span key={k} className={Math.abs(navalLocal.throttle - k) < 1e-3 ? "on" : ""}>
            {STEP_NAME[String(k)]}
          </span>
        ))}
      </div>
      <div className="nv-rudder">
        <i style={{ left: `${50 + navalLocal.rudder * 45}%` }} />
      </div>
      <div className="nv-wl">
        {knots(s.speed)} / tối đa {knots(cls.speed)}
        {(s.parts.get("engine") ?? 100) <= 0 && " · máy hỏng (40% sức)"}
        {(s.parts.get("bridge") ?? 100) <= 0 && " · cầu chỉ huy hỏng (bẻ lái yếu)"}
      </div>
      {cls.id === "submarine" && (
        <div className="nv-air">
          Dưỡng khí{" "}
          <span className="nv-bar small">
            <i style={{ width: `${s.air}%` }} />
          </span>{" "}
          {s.dive
            ? `đang lặn · sâu ${Math.round(-s.y)}/${Math.round(-s.depth)} m${s.y < SUB.deep ? " · ra-đa không thấy" : ""} (dưỡng khí tối đa ${SUB.air}s)`
            : `đang nổi · lặn tới ${Math.round(-s.depth)} m`}
        </div>
      )}
    </div>
  );
}

/** Lớp vẽ mỗi khung: tâm ngắm, dấu đón đầu, dấu tàu địch (đặt thẳng style, không qua React). */
function Overlay() {
  const root = useRef<HTMLDivElement>(null);
  const enemy = useRef<HTMLDivElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const pool = useRef<HTMLDivElement[]>([]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      const e = enemy.current;
      if (e) {
        const en = navalLocal.enemy;
        e.style.display = en.on ? "block" : "none";
        if (en.on) {
          const x = Math.max(0.03, Math.min(0.97, en.x));
          const y = Math.max(0.08, Math.min(0.92, en.y));
          e.style.left = `${x * 100}%`;
          e.style.top = `${y * 100}%`;
          e.className = `nv-enemy ${en.front ? "" : "edge"}`;
          e.textContent = `▼ ${Math.round(en.dist)} m`;
        }
      }
      if (cross.current) cross.current.style.display = navalLocal.station >= 0 ? "block" : "none";
      const leads = navalLocal.leads;
      while (pool.current.length < leads.length) {
        const d = document.createElement("div");
        d.className = "nv-lead";
        el.appendChild(d);
        pool.current.push(d);
      }
      pool.current.forEach((d, i) => {
        const l = leads[i];
        d.style.display = l ? "block" : "none";
        if (l) {
          d.style.left = `${l.x * 100}%`;
          d.style.top = `${l.y * 100}%`;
          d.dataset.kind = l.kind;
        }
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="nv-overlay" ref={root}>
      <div className="nv-enemy" ref={enemy} />
      <div className="nv-cross" ref={cross} />
    </div>
  );
}
