import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair as CrossIcon, LogOut, Settings as Gear, ShoppingCart, Skull, Trophy, Users, X } from "lucide-react";
import {
  AMMO,
  ARMOR,
  BATTLE_SITES,
  HEALS,
  HELMETS,
  MAP_HALF_SIZE,
  OUTFITS,
  THROWABLES,
  WEAPON,
  WEAPONS,
  battleMap,
  lootLabel,
  type AmmoId,
  type WeaponClass,
} from "@tentides/content";
import { Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { look } from "../input.ts";
import { localPosition } from "../shared.ts";
import { DEFAULT_SETTINGS, setSettings, useSettings } from "../settings.ts";
import { playBuy, playCountdown, playZoneTick } from "../sound/guns.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun, nextSpectate } from "./Shooter.tsx";
import { getBattleHud, setBattleHud, stance, useBattleHud } from "./runtime.ts";
import "./battle.css";

// Giao diện trận Battleground: thanh máu, giáp, súng và đạn, vùng an toàn, số người còn sống, bảng hạ gục,
// bản đồ nhỏ, la bàn, tâm ngắm co giãn theo độ toả, dấu trúng, hướng bị bắn, ống ngắm, cửa hàng (B),
// bảng điểm (Tab), sảnh chờ, màn gục và màn chiến thắng, bảng cài đặt độ nhạy chuột.

const CLASS_LABEL: Record<WeaponClass, string> = { pistol: "Súng lục", smg: "Tiểu liên", ar: "Súng trường", lmg: "Súng máy", dmr: "Súng bắn tỉa bán tự động", sniper: "Súng bắn tỉa", shotgun: "Shotgun" };

function useFrameTick(fps = 30) {
  const [, set] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / fps) return;
      last = t;
      set((n) => (n + 1) % 1e6);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
}

function nameOf(room: IslandRoom, id: string): string {
  return room.state.players.get(id)?.name ?? (id ? "?" : "");
}

// ---------------------------------------------------------------------------- tâm ngắm, dấu trúng, bị bắn, ống ngắm

function Reticle({ room }: { room: IslandRoom }) {
  useFrameTick(60);
  const hud = getBattleHud();
  const me = room.state.players.get(myId(room));
  if (!me?.alive) return null;
  const now = performance.now();
  const scoped = stance.aiming && stance.zoom >= 3;
  // Khoảng hở tâm ngắm theo độ toả (radian → điểm ảnh ở FOV hiện tại xấp xỉ).
  const gap = Math.max(3, Math.min(60, stance.spread * 900 / (stance.aiming ? stance.zoom : 1)));
  const hitAge = hud.hit ? now - hud.hit.at : 9999;
  return (
    <>
      {scoped ? (
        <div className="b-scope">
          <div className="b-scope-ring" />
          <div className="b-scope-line h" />
          <div className="b-scope-line v" />
        </div>
      ) : (
        <div className={`b-cross ${stance.aiming ? "ads" : ""}`} style={{ ["--gap" as string]: `${gap}px` }}>
          <i className="t" />
          <i className="b" />
          <i className="l" />
          <i className="r" />
          <b />
        </div>
      )}
      {hitAge < 260 && <div className={`b-hitmark ${hud.hit!.kind}`} style={{ opacity: 1 - hitAge / 260 }} />}
      {hud.hurts
        .filter((h) => now - h.at < 1400)
        .map((h) => {
          // Hướng bị bắn so với hướng mình đang nhìn (look.yaw là hướng camera nhìn về −sin, −cos).
          const rel = h.angle - (look.yaw + Math.PI);
          return <div key={h.at} className="b-hurt" style={{ transform: `rotate(${(-rel * 180) / Math.PI}deg)`, opacity: 1 - (now - h.at) / 1400 }} />;
        })}
      {me.hp < 30 && <div className="b-lowhp" style={{ opacity: 0.35 + 0.35 * Math.sin(now / 180) }} />}
    </>
  );
}

// ---------------------------------------------------------------------------- la bàn

function Compass() {
  useFrameTick(30);
  // Hướng nhìn: bắc (−z) là 0°.
  const heading = ((((-look.yaw + Math.PI) * 180) / Math.PI) % 360 + 360) % 360;
  const marks = [];
  for (let d = -90; d <= 90; d += 15) {
    const deg = Math.round((heading + d + 360) % 360 / 15) * 15 % 360;
    const off = ((deg - heading + 540) % 360) - 180;
    const label = { 0: "B", 90: "Đ", 180: "N", 270: "T" }[deg] ?? (deg % 45 === 0 ? String(deg) : "·");
    marks.push(
      <span key={d} style={{ left: `${50 + (off / 90) * 50}%` }} className={label.length === 1 && label !== "·" ? "card" : ""}>
        {label}
      </span>,
    );
  }
  return (
    <div className="b-compass">
      {marks}
      <em>{Math.round(heading)}°</em>
    </div>
  );
}

// ---------------------------------------------------------------------------- bản đồ nhỏ

function useShore(seed: number) {
  return useMemo(() => {
    const world = battleMap(seed || 1).world;
    const pts: string[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      let lo = 0;
      let hi = 230;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (world.heightAt(Math.cos(a) * mid, Math.sin(a) * mid) > 0) lo = mid;
        else hi = mid;
      }
      pts.push(`${(Math.cos(a) * lo).toFixed(1)},${(Math.sin(a) * lo).toFixed(1)}`);
    }
    return pts.join(" ");
  }, [seed]);
}

function BattleMinimap({ room, big }: { room: IslandRoom; big?: boolean }) {
  useFrameTick(8);
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const shore = useShore(seed);
  const z = room.state.zone;
  const H = MAP_HALF_SIZE;
  const me = room.state.players.get(myId(room));
  const phase = room.state.phase;
  return (
    <svg className={big ? "b-map big" : "b-map"} viewBox={`${-H} ${-H} ${H * 2} ${H * 2}`}>
      <rect x={-H} y={-H} width={H * 2} height={H * 2} className="bm-sea" />
      <polygon points={shore} className="bm-land" />
      {BATTLE_SITES.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.z}) rotate(${(-s.rot * 180) / Math.PI})`}>
          <rect x={-s.rx} y={-s.rz} width={s.rx * 2} height={s.rz * 2} className={`bm-site ${s.kind}`} />
          {big && (
            <text y={4} className="bm-label" transform={`rotate(${(s.rot * 180) / Math.PI})`}>
              {s.name}
            </text>
          )}
        </g>
      ))}
      {phase === "battle" && (
        <>
          <circle cx={z.x} cy={z.z} r={z.r} className="bm-zone" />
          {z.nr > 0 && <circle cx={z.nx} cy={z.nz} r={z.nr} className="bm-next" />}
        </>
      )}
      {me && (
        <g transform={`translate(${localPosition.x} ${localPosition.z}) rotate(${(-look.yaw * 180) / Math.PI + 180})`}>
          <path d="M0,-9 L6,6 L0,3 L-6,6 Z" className="bm-me" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------- thanh dưới: máu, giáp, súng, đạn

function Vitals({ room }: { room: IslandRoom }) {
  useFrameTick(15);
  const me = room.state.players.get(myId(room));
  if (!me || !me.alive) return null;
  const k = me.kit;
  const now = performance.now();
  const reloading = k.reloading || gun.reloadUntil > now;
  const healing = k.healing || gun.healUntil > now;
  const slots: { key: string; slot: string; label: string; mag: number }[] = [
    { key: "1", slot: "primary1", label: WEAPON.get(k.primary1)?.name ?? "", mag: k.mag1 },
    { key: "2", slot: "primary2", label: WEAPON.get(k.primary2)?.name ?? "", mag: k.mag2 },
    { key: "3", slot: "pistol", label: WEAPON.get(k.pistol)?.name ?? "", mag: k.magP },
  ];
  const active = WEAPON.get((k as unknown as Record<string, string>)[k.active] ?? "");
  const mag = active ? (gun.weapon === active.id ? gun.mag : slots.find((s) => s.slot === k.active)?.mag ?? 0) : 0;
  const reserve = active ? (k.ammo.get(active.ammo) ?? 0) : 0;
  return (
    <>
      <div className="b-vitals">
        <div className="b-gear">
          <span className={`b-armor lv${k.armor}`} title={k.armor ? ARMOR[k.armor - 1]!.name : "Không có giáp"}>
            🦺{k.armor || "–"}
            {k.armor > 0 && <i style={{ width: `${(k.armorHp / ARMOR[k.armor - 1]!.durability) * 100}%` }} />}
          </span>
          <span className={`b-armor lv${k.helmet}`} title={k.helmet ? HELMETS[k.helmet - 1]!.name : "Không có mũ"}>
            ⛑{k.helmet || "–"}
            {k.helmet > 0 && <i style={{ width: `${(k.helmetHp / HELMETS[k.helmet - 1]!.durability) * 100}%` }} />}
          </span>
        </div>
        <div className="b-hp">
          <div className={`b-hp-fill ${me.hp < 30 ? "low" : ""}`} style={{ width: `${Math.max(0, me.hp)}%` }} />
          <span>{Math.ceil(me.hp)}</span>
        </div>
        <div className="b-items">
          <span className={k.active === "frag" ? "on" : ""}>4 💣{k.frag}</span>
          <span className={k.active === "smoke" ? "on" : ""}>5 🌫{k.smoke}</span>
          <span className={k.active === "mine" ? "on" : ""}>6 ⊚{k.mine}</span>
          <span>7 🩹{k.bandage}</span>
          <span>8 ✚{k.medkit}</span>
        </div>
      </div>
      <div className="b-weapons">
        {slots.map((s) => (
          <div key={s.slot} className={`b-slot ${k.active === s.slot ? "on" : ""} ${s.label ? "" : "empty"}`}>
            <kbd>{s.key}</kbd>
            <span>{s.label || "—"}</span>
          </div>
        ))}
        {active && (
          <div className="b-ammo">
            <strong className={mag === 0 ? "empty" : ""}>{mag}</strong>
            <span>/ {reserve}</span>
            <small>{active.auto ? "LIÊN THANH" : "BÁN TỰ ĐỘNG"} · {AMMO[active.ammo].name}</small>
          </div>
        )}
      </div>
      {(reloading || healing) && (
        <div className="b-progress">
          {reloading ? "Đang thay đạn…" : "Đang băng bó…"}
        </div>
      )}
      <div className="b-money">
        <strong>{k.money.toLocaleString("vi-VN")}$</strong>
        <span>
          <kbd>B</kbd> cửa hàng
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- trên cùng: còn sống, hạ gục, vùng

function TopBar({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    alive: st.aliveCount,
    kills: st.players.get(myId(room))?.kills ?? 0,
    zone: { timeLeft: st.zone.timeLeft, shrinking: st.zone.shrinking, stage: st.zone.stage, dps: st.zone.dps },
    timeLeft: st.timeLeft,
  }));
  const last = useRef(0);
  // Đếm ngược mấy giây cuối pha chuẩn bị.
  useEffect(() => {
    if (s.phase !== "prep") return;
    if (s.timeLeft <= 5 && s.timeLeft !== last.current) {
      last.current = s.timeLeft;
      playCountdown(s.timeLeft === 0);
    }
  }, [s.phase, s.timeLeft]);
  return (
    <div className="b-top">
      <div className="b-count">
        <Users size={15} /> <strong>{s.alive}</strong> còn sống
      </div>
      <div className="b-count">
        <CrossIcon size={15} /> <strong>{s.kills}</strong> hạ gục
      </div>
      {s.phase === "battle" && (
        <div className={`b-zone ${s.zone.shrinking ? "shrinking" : ""}`}>
          {s.zone.shrinking ? "Vùng an toàn đang thu hẹp" : `Vùng thu hẹp sau ${s.zone.timeLeft}s`}
          {s.zone.shrinking && ` · ${s.zone.timeLeft}s`}
        </div>
      )}
      {s.phase === "prep" && (
        <div className="b-zone prep">
          Chuẩn bị · <strong>{s.timeLeft}s</strong> · bấm <kbd>B</kbd> mua vũ khí
        </div>
      )}
    </div>
  );
}

function OutsideZone({ room }: { room: IslandRoom }) {
  useFrameTick(4);
  const z = room.state.zone;
  const me = room.state.players.get(myId(room));
  const out = room.state.phase === "battle" && me?.alive && Math.hypot(localPosition.x - z.x, localPosition.z - z.z) > z.r;
  const was = useRef(false);
  useEffect(() => {
    if (out && z.dps > 0) playZoneTick();
    was.current = !!out;
  });
  if (!out) return null;
  const dist = Math.round(Math.hypot(localPosition.x - z.x, localPosition.z - z.z) - z.r);
  return (
    <>
      <div className="b-outside-tint" />
      <div className="b-outside">Bạn đang ở ngoài vùng an toàn · cách {dist} m · chạy vào trong vòng!</div>
    </>
  );
}

function KillFeed({ room }: { room: IslandRoom }) {
  const feed = useRoomSnapshot(room, (s) => [...s.feed].map((k) => ({ n: k.n, killer: k.killer, victim: k.victim, weapon: k.weapon, head: k.headshot })));
  const me = myId(room);
  return (
    <div className="b-feed">
      {feed.map((k) => (
        <div key={k.n} className={k.killer === me || k.victim === me ? "me" : ""}>
          {k.killer ? <b>{nameOf(room, k.killer)}</b> : null}
          <span className="w">{k.weapon === "zone" ? "☠ vùng độc" : k.weapon === "mine" ? "💥 mìn" : k.weapon === "frag" ? "💣" : WEAPON.get(k.weapon)?.name ?? ""}{k.head ? " 🎯" : ""}</span>
          <b className="v">{nameOf(room, k.victim)}</b>
        </div>
      ))}
    </div>
  );
}

function Pickup() {
  const hud = useBattleHud();
  if (!hud.nearItem) return null;
  return (
    <div className="b-pickup">
      <kbd>E</kbd> Nhặt {lootLabel(hud.nearItem.itemId)}
    </div>
  );
}

// ---------------------------------------------------------------------------- cửa hàng

type Tab = "guns" | "gear" | "ammo" | "outfit";

function BuyMenu({ room }: { room: IslandRoom }) {
  const hud = useBattleHud();
  const [tab, setTab] = useState<Tab>("guns");
  const kit = useRoomSnapshot(room, (s) => {
    const p = s.players.get(myId(room));
    const k = p?.kit;
    // Gục rồi hay trận đã xong thì không mua được.
    return k && p.alive && s.phase !== "ended" ? { money: k.money, outfit: k.outfit, armor: k.armor, helmet: k.helmet } : null;
  });
  const [msg, setMsg] = useState("");
  useEffect(() => room.onMessage(Messages.rejected, (r: { reason: string }) => setMsg(r.reason)), [room]);
  if (!hud.buyOpen || !kit) return null;
  const buy = (item: string) => {
    setMsg("");
    room.send(Messages.battleBuy, { item });
    playBuy();
  };
  const item = (id: string, label: string, price: number, sub?: string) => (
    <button key={id} className="b-buy-item" disabled={price > kit.money} onClick={() => buy(id)}>
      <span className="n">{label}</span>
      {sub && <span className="s">{sub}</span>}
      <span className="p">{price ? `${price}$` : "Miễn phí"}</span>
    </button>
  );
  const byClass = new Map<WeaponClass, typeof WEAPONS[number][]>();
  for (const w of WEAPONS) if (w.price > 0) byClass.set(w.class, [...(byClass.get(w.class) ?? []), w]);
  return (
    <div className="b-buy" onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <ShoppingCart size={18} /> Cửa hàng <strong>{kit.money.toLocaleString("vi-VN")}$</strong>
        <button className="x" onClick={() => setBattleHud({ buyOpen: false })} aria-label="Đóng">
          <X size={18} />
        </button>
      </header>
      <nav>
        {(
          [
            ["guns", "Súng"],
            ["ammo", "Đạn"],
            ["gear", "Giáp · ném · hồi máu"],
            ["outfit", "Trang phục"],
          ] as const
        ).map(([t, l]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </nav>
      <div className="b-buy-body">
        {tab === "guns" &&
          [...byClass.entries()].map(([cls, list]) => (
            <section key={cls}>
              <h4>{CLASS_LABEL[cls]}</h4>
              {list.map((w) => item(w.id, w.name, w.price, `${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ""} sát thương · ${w.rpm} phát/phút · băng ${w.mag}${w.zoom >= 3 ? ` · ống ${w.zoom}x` : ""}`))}
            </section>
          ))}
        {tab === "guns" && <p className="b-buy-note">M249, AWM và giáp, mũ cấp 3 chỉ có trong Kho vũ khí, trên tàu và ở bãi mìn. Mua súng được tặng 2 băng đạn.</p>}
        {tab === "ammo" && (
          <section>
            {(Object.keys(AMMO) as AmmoId[]).map((a) => item(`ammo:${a}`, AMMO[a].name, AMMO[a].price, `${AMMO[a].pack} viên · dùng cho ${WEAPONS.filter((w) => w.ammo === a).map((w) => w.name).join(", ")}`))}
          </section>
        )}
        {tab === "gear" && (
          <>
            <section>
              <h4>Giáp và mũ</h4>
              {ARMOR.filter((a) => a.price).map((a) => item(`armor:${a.level}`, a.name, a.price, `chặn ${Math.round(a.absorb * 100)}% sát thương thân${kit.armor === a.level ? " · đang mặc" : ""}`))}
              {HELMETS.filter((a) => a.price).map((a) => item(`helmet:${a.level}`, a.name, a.price, `chặn ${Math.round(a.absorb * 100)}% sát thương đầu${kit.helmet === a.level ? " · đang đội" : ""}`))}
            </section>
            <section>
              <h4>Ném, gài</h4>
              {(Object.keys(THROWABLES) as (keyof typeof THROWABLES)[]).map((t) => item(t, THROWABLES[t].name, THROWABLES[t].price, `mang tối đa ${THROWABLES[t].max}`))}
            </section>
            <section>
              <h4>Hồi máu</h4>
              {(Object.keys(HEALS) as (keyof typeof HEALS)[]).map((h) => item(h, HEALS[h].name, HEALS[h].price, `+${HEALS[h].amount} máu (tối đa ${HEALS[h].cap}) · ${HEALS[h].seconds}s`))}
            </section>
          </>
        )}
        {tab === "outfit" && (
          <section className="b-outfits">
            {OUTFITS.map((o) => (
              <button key={o.id} className={`b-outfit ${kit.outfit === o.id ? "on" : ""}`} onClick={() => buy(`outfit:${o.id}`)}>
                <i className={`sw ${o.id}`} />
                {o.name}
              </button>
            ))}
          </section>
        )}
      </div>
      {msg && <p className="b-buy-msg">{msg}</p>}
      <footer>
        <kbd>B</kbd> hoặc <kbd>Esc</kbd> để đóng · bấm vào cảnh để điều khiển tiếp
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------- sảnh, bảng điểm, gục, thắng

function Lobby({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    host: st.hostId,
    bots: st.bots,
    players: [...st.players.entries()].filter(([, p]) => !p.bot).map(([id, p]) => ({ id, name: p.name, color: p.color })),
  }));
  const me = myId(room);
  const isHost = s.host === me;
  if (s.phase !== "lobby") return null;
  return (
    <div className="b-lobby">
      <div className="b-lobby-code">
        <span>MÃ PHÒNG</span>
        <strong>{room.roomId}</strong>
      </div>
      <h2>Battleground</h2>
      <p>Xuất phát ngẫu nhiên khắp đảo · bấm B mua vũ khí · vùng an toàn thu hẹp dần · người cuối cùng còn sống thắng.</p>
      <ul className="b-lobby-players">
        {s.players.map((p) => (
          <li key={p.id}>
            <i style={{ background: p.color }} /> {p.name}
            {p.id === s.host && " 👑"}
            {p.id === me && " (bạn)"}
          </li>
        ))}
      </ul>
      <label className="b-bots">
        Máy (bot) cùng chơi: <strong>{s.bots}</strong>
        <input type="range" min={0} max={12} value={s.bots} disabled={!isHost} onChange={(e) => room.send(Messages.battleSettings, { bots: Number(e.target.value) })} />
      </label>
      {isHost ? (
        <button className="primary big" onClick={() => room.send(Messages.start)}>
          <CrossIcon size={18} /> Bắt đầu trận ({s.players.length + s.bots} người)
        </button>
      ) : (
        <p className="muted">Chờ chủ phòng bắt đầu…</p>
      )}
      <button className="ghost" onClick={onLeave}>
        <LogOut size={16} /> Rời phòng
      </button>
      <p className="b-keys">
        WASD đi · Shift chạy · C ngồi xổm (đang chạy: trượt) · Space nhảy · Chuột trái bắn · Chuột phải ngắm · R thay đạn · 1–3 súng · 4 lựu đạn · 5 bom khói · 6 mìn · 7–8 hồi máu · E nhặt · B cửa hàng · Tab bảng điểm · T đổi góc nhìn
      </p>
    </div>
  );
}

function Scoreboard({ room }: { room: IslandRoom }) {
  const hud = useBattleHud();
  const rows = useRoomSnapshot(room, (s) =>
    [...s.players.entries()].map(([id, p]) => ({ id, name: p.name, kills: p.kills, alive: p.alive, bot: p.bot })).sort((a, b) => Number(b.alive) - Number(a.alive) || b.kills - a.kills),
  );
  const phase = useRoomSnapshot(room, (s) => s.phase);
  if (!hud.scoreboard && phase !== "ended") return null;
  return (
    <div className="b-score">
      <h3>Bảng điểm</h3>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`${r.alive ? "" : "dead"} ${r.id === myId(room) ? "me" : ""}`}>
              <td>{r.name}</td>
              <td>{r.kills} hạ gục</td>
              <td>{r.alive ? "còn sống" : "đã gục"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeathAndWin({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const me = myId(room);
  const s = useRoomSnapshot(room, (st) => {
    const p = st.players.get(me);
    const killedBy = [...st.feed].reverse().find((k) => k.victim === me);
    return {
      phase: st.phase,
      alive: p?.alive ?? false,
      winner: st.winner,
      kills: p?.kills ?? 0,
      aliveCount: st.aliveCount,
      host: st.hostId,
      killer: killedBy?.killer ?? "",
      weapon: killedBy?.weapon ?? "",
      timeLeft: st.timeLeft,
    };
  });
  const hud = useBattleHud();
  const [rank, setRank] = useState(0);
  useEffect(() => {
    if ((s.phase === "battle" || s.phase === "prep") && !s.alive && !rank) {
      setRank(s.aliveCount + 1);
      // Xem kẻ đã hạ mình, không thì người còn sống đầu tiên.
      if (s.killer && room.state.players.get(s.killer)?.alive) setBattleHud({ spectating: s.killer });
      else nextSpectate(room);
    }
    if (s.alive && rank) setRank(0);
  }, [s.alive, s.phase, s.killer, s.aliveCount, rank, room]);
  useEffect(() => {
    // Người mình đang xem gục thì xem người khác.
    if (!s.alive && hud.spectating && !room.state.players.get(hud.spectating)?.alive) nextSpectate(room);
  });

  if (s.phase === "ended") {
    const won = s.winner === me;
    return (
      <div className={`b-end ${won ? "win" : ""}`}>
        {won ? (
          <>
            <Trophy size={48} />
            <h1>WINNER WINNER!</h1>
            <p>Bạn là người cuối cùng còn sống · {s.kills} hạ gục</p>
          </>
        ) : (
          <>
            <h1>{s.winner ? `${nameOf(room, s.winner)} chiến thắng` : "Không ai sống sót"}</h1>
            <p>
              Hạng #{rank || 1} · {s.kills} hạ gục
            </p>
          </>
        )}
        <p className="muted">Về sảnh sau {s.timeLeft}s</p>
        {s.host === me && (
          <button className="primary big" onClick={() => room.send(Messages.start)}>
            Chơi trận mới
          </button>
        )}
        <button className="ghost" onClick={onLeave}>
          <LogOut size={16} /> Rời phòng
        </button>
      </div>
    );
  }
  if ((s.phase === "battle" || s.phase === "prep") && !s.alive) {
    return (
      <div className="b-dead">
        <Skull size={28} />
        <h2>{s.killer ? `${nameOf(room, s.killer)} đã hạ bạn` : "Bạn đã gục"}</h2>
        <p>
          {s.weapon === "zone" ? "vùng độc" : WEAPON.get(s.weapon)?.name ?? (s.weapon === "mine" ? "mìn" : s.weapon === "frag" ? "lựu đạn" : "")} · Hạng #{rank} · {s.kills} hạ gục
        </p>
        {hud.spectating && <p className="muted">Đang xem {nameOf(room, hud.spectating)} · bấm chuột để đổi người</p>}
        <button className="ghost" onClick={onLeave}>
          <LogOut size={16} /> Rời phòng
        </button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------- cài đặt

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  if (!open) return null;
  const slider = (label: string, key: "sensitivity" | "adsSensitivity" | "scopeSensitivity" | "fov" | "smoothing" | "headBob", min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="b-set-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={s[key]} onChange={(e) => setSettings({ [key]: Number(e.target.value) })} />
      <em>{fmt(s[key])}</em>
    </label>
  );
  return (
    <div className="b-settings" onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <Gear size={18} /> Cài đặt điều khiển
        <button className="x" onClick={onClose} aria-label="Đóng">
          <X size={18} />
        </button>
      </header>
      {slider("Độ nhạy chuột", "sensitivity", 0.1, 3, 0.05, (v) => v.toFixed(2))}
      {slider("Độ nhạy khi ngắm", "adsSensitivity", 0.1, 2, 0.05, (v) => v.toFixed(2))}
      {slider("Độ nhạy ống ngắm", "scopeSensitivity", 0.1, 2, 0.05, (v) => v.toFixed(2))}
      {slider("Góc nhìn (FOV)", "fov", 55, 100, 1, (v) => `${v}°`)}
      {slider("Làm mượt camera", "smoothing", 0, 1, 0.05, (v) => (v === 0 ? "Tắt" : `${Math.round(v * 100)}%`))}
      {slider("Nhún camera khi đi", "headBob", 0, 1, 0.05, (v) => (v === 0 ? "Tắt" : `${Math.round(v * 100)}%`))}
      <label className="b-set-check">
        <input type="checkbox" checked={s.invertY} onChange={(e) => setSettings({ invertY: e.target.checked })} /> Đảo trục dọc chuột
      </label>
      <label className="b-set-check">
        <input type="checkbox" checked={s.toggleAim} onChange={(e) => setSettings({ toggleAim: e.target.checked })} /> Bấm chuột phải một lần để ngắm (không cần giữ)
      </label>
      <button className="ghost" onClick={() => setSettings(DEFAULT_SETTINGS)}>
        Về mặc định
      </button>
    </div>
  );
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyO" && !(e.target instanceof HTMLInputElement)) {
        setOpen((o) => !o);
        document.exitPointerLock?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setBattleHud({ settingsOpen: open }), [open]);
  return (
    <>
      <button className="b-gear-btn" onClick={() => setOpen((o) => !o)} title="Cài đặt (O)">
        <Gear size={18} />
      </button>
      <SettingsPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function BattleHud({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const phase = useRoomSnapshot(room, (s) => s.phase);
  const [bigMap, setBigMap] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) setBigMap((b) => !b);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const fighting = phase === "prep" || phase === "battle";
  return (
    <div className="hud battle-hud">
      {fighting && <Reticle room={room} />}
      <Compass />
      {fighting && <TopBar room={room} />}
      <div className="b-right">
        <BattleMinimap room={room} />
        <KillFeed room={room} />
      </div>
      {bigMap && (
        <div className="b-bigmap" onClick={() => setBigMap(false)}>
          <BattleMinimap room={room} big />
          <p>
            <kbd>M</kbd> đóng bản đồ
          </p>
        </div>
      )}
      {fighting && <Vitals room={room} />}
      {fighting && <OutsideZone room={room} />}
      <Pickup />
      <BuyMenu room={room} />
      <Scoreboard room={room} />
      <Lobby room={room} onLeave={onLeave} />
      <DeathAndWin room={room} onLeave={onLeave} />
      <SettingsButton />
    </div>
  );
}
