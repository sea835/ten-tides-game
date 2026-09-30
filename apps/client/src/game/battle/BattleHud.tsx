import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Crosshair as CrossIcon, LogOut, Settings as Gear, ShoppingCart, Skull, Trophy, Users, X } from "lucide-react";
import {
  AMMO,
  ARMOR,
  BATTLE_SITES,
  FLASH,
  HEALS,
  HELMETS,
  MAP_HALF_SIZE,
  OUTFITS,
  ATTACHMENTS,
  ATTACHMENT_IDS,
  attachmentFits,
  SIGHTS,
  SIGHT_IDS,
  THROWABLES,
  WEAPON,
  WEAPONS,
  mapForMode,
  bulletDrop,
  lootLabel,
  sightFits,
  type SightId,
  type AmmoId,
  type WeaponClass,
} from "@tentides/content";
import { BATTLE_TIMES, BATTLE_WEATHERS, MAX_BATTLE_BOTS, Messages } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { look } from "../input.ts";
import { localPosition } from "../shared.ts";
import { DEFAULT_SETTINGS, getSettings, setSettings, useSettings } from "../settings.ts";
import { DEFAULT_GRAPHICS, QUALITY_LABEL, setGraphics, toggleStats, useGraphics, useStatsOpen, type Quality } from "../graphics.ts";
import { playBuy, playCountdown, playTinnitus, playZoneTick } from "../sound/guns.ts";
import { DEFAULT_VOLUME, audio, type VolumeKey } from "../sound/engine.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun, nextSpectate } from "./Shooter.tsx";
import { closeBuyMenu, getBattleHud, setBattleHud, stance, useBattleHud } from "./runtime.ts";
import { ItemIcon } from "./ItemIcons.tsx";
import { SquadHud, TankHud, TankPrompt, lastOrder, teamName } from "./SquadHud.tsx";
import { teamColor } from "./Vehicles.tsx";
import { CaptureBar, Deploy, SIDE_NAME, WarTop, useFlagToasts } from "./WarHud.tsx";
import "./battle.css";

// Giao diện trận Battleground: thanh máu, giáp, súng và đạn, vùng an toàn, số người còn sống, bảng hạ gục,
// bản đồ nhỏ, la bàn, tâm ngắm co giãn theo độ toả, dấu trúng, hướng bị bắn, ống ngắm, cửa hàng (B),
// bảng điểm (Tab), sảnh chờ, màn gục và màn chiến thắng, bảng cài đặt độ nhạy chuột.

const CLASS_LABEL: Record<WeaponClass, string> = { pistol: "Súng lục", smg: "Tiểu liên", ar: "Súng trường", lmg: "Súng máy", dmr: "Súng bắn tỉa bán tự động", sniper: "Súng bắn tỉa", shotgun: "Shotgun", launcher: "Chống tăng" };

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

/** Tên súng kèm ống ngắm đang lắp (vd. "Kar98k · 8x"). */
/** Ký hiệu ngắn của phụ kiện trên ô súng. */
const ATT_SHORT: Record<string, string> = { comp: "Bù giật", suppressor: "Giảm thanh", flashhider: "Che lửa", choke: "Choke", vgrip: "TC dọc", agrip: "TC nghiêng", halfgrip: "TC nửa", extmag: "Băng+", quickmag: "Băng nhanh", extquick: "Băng+ nhanh", tacstock: "Báng", cheekpad: "Đệm má" };

function withSight(name: string | undefined, sight: string, atts = ""): string {
  if (!name) return "";
  const s = SIGHTS[sight as SightId];
  const parts = [name];
  if (s) parts.push(s.id === "reddot" ? "Red Dot" : s.id === "holo" ? "Holo" : s.id.slice(1) + "x");
  for (const id of atts.split(",")) if (ATT_SHORT[id]) parts.push(ATT_SHORT[id]!);
  return parts.join(" · ");
}

/**
 * Bị bom choáng: màn hình trắng xoá (nhạt dần theo thời gian còn loá), tai ù (tiếng rít cao, các tiếng khác nhỏ đi).
 */
function Flashed({ room }: { room: IslandRoom }) {
  const blind = useRoomSnapshot(room, (s) => Math.round((s.players.get(myId(room))?.blind ?? 0) * 10) / 10);
  const last = useRef(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    // Vừa bị loá (thời gian loá tăng lên): ù tai theo độ nặng.
    if (blind > last.current + 0.4) {
      stop.current?.();
      stop.current = playTinnitus(blind + 1.5, Math.min(1, blind / FLASH.seconds));
    }
    last.current = blind;
  }, [blind]);
  useEffect(() => () => stop.current?.(), []);
  if (blind <= 0) return null;
  return <div className="b-flashed" style={{ opacity: Math.min(1, blind / 1.6) }} />;
}

// ---------------------------------------------------------------------------- tâm ngắm, dấu trúng, bị bắn, ống ngắm

/**
 * Nhìn qua ống kính: khung đen tròn, tâm theo loại ống (2x chữ thập, 4x ACOG chữ V đỏ, 8x vạch mil), kèm vạch bù đạn
 * rơi (BDC) tính đúng theo sơ tốc khẩu đang cầm và cự ly đã chỉnh: đặt vạch "300" lên mục tiêu cách 300 m là trúng.
 */
function ScopeView() {
  const def = WEAPON.get(gun.weapon);
  const sight = SIGHTS[stance.sight as SightId];
  if (!def || !sight) return null;
  // Điểm ảnh theo chiều dọc: nửa màn hình (50vh) ứng với tan(FOV/2) của góc nhìn đã phóng đại.
  const halfTan = Math.tan((getSettings().fov * Math.PI) / 360) / sight.zoom;
  const vh = (angle: number) => (50 * Math.tan(angle)) / halfTan;
  const lift = bulletDrop(def.velocity, stance.zero) / stance.zero;
  const ticks: { d: number; y: number }[] = [];
  // Vạch bù đạn rơi chỉ có ở ống từ 4x trở lên (2x bắn gần, chỉ cần chữ V).
  if (sight.zoom >= 4)
    for (let d = Math.ceil((stance.zero + 1) / 100) * 100; d <= 800; d += 100) {
      const y = vh(bulletDrop(def.velocity, d) / d - lift);
      if (y > 30) break;
      // Vạch quá sát vạch trước (đạn nhanh, cự ly gần) thì bỏ, khỏi chồng chữ lên nhau.
      if (y - (ticks[ticks.length - 1]?.y ?? 0) < 1.4) continue;
      ticks.push({ d, y });
    }
  const red = sight.reticle === "chevron";
  return (
    // Ống bội thấp có ô nhìn (eye box) rộng hơn: 2x gần như cả màn hình, 8x hẹp nhất.
    <div className="b-scope" style={{ "--eye": `${sight.zoom <= 2 ? 44 : sight.zoom <= 4 ? 36 : 32}vmin` } as CSSProperties}>
      <div className="b-scope-ring" />
      {sight.reticle === "cross" && (
        <>
          <div className="b-scope-line h" />
          <div className="b-scope-line v" />
          <div className="b-scope-dot" />
        </>
      )}
      {sight.reticle === "mil" && (
        <>
          <div className="b-scope-line h" />
          <div className="b-scope-line v" />
          <div className="b-scope-line h thick l" />
          <div className="b-scope-line h thick r" />
          <div className="b-scope-line v thick b" />
        </>
      )}
      {red && <div className="b-scope-chevron" />}
      {ticks.map((t) => (
        <div key={t.d} className={`b-scope-tick ${red ? "red" : ""}`} style={{ top: `calc(50% + ${t.y}vh)`, width: `${Math.max(1.2, 6 - t.d / 150)}vh` }}>
          <span>{t.d / 100}</span>
        </div>
      ))}
      <div className="b-scope-zero">
        {sight.name} · chỉnh {stance.zero} m <kbd>PgUp</kbd>/<kbd>PgDn</kbd>
      </div>
    </div>
  );
}

/**
 * Vòng lặp theo khung hình cho HUD: `live()` chỉnh thẳng DOM (khoảng hở tâm ngắm, hướng la bàn...) mỗi khung,
 * `signature()` tóm tắt phần cấu trúc; React chỉ dựng lại khi chữ ký đổi (bật ngắm, trúng đạn, bị bắn...), thay
 * vì dựng lại cả khối 60 lần mỗi giây.
 */
function useLive(live: () => void, signature: () => string) {
  const [, set] = useState("");
  const liveRef = useRef(live);
  const sigRef = useRef(signature);
  liveRef.current = live;
  sigRef.current = signature;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      liveRef.current();
      set(sigRef.current());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function Reticle({ room }: { room: IslandRoom }) {
  const cross = useRef<HTMLDivElement>(null);
  const hurtBox = useRef<HTMLDivElement>(null);
  const hud = getBattleHud();
  const me = room.state.players.get(myId(room));
  const now = performance.now();
  const scoped = stance.aiming && stance.scoped;
  const hit = hud.hit && now - hud.hit.at < 260 ? hud.hit : null;
  // Số sát thương và quầng đỏ sống lâu hơn dấu trúng nên cần cửa sổ riêng.
  const dmg = hud.hit && now - hud.hit.at < 800 && hud.hit.kind !== "kill" ? hud.hit : null;
  const flash = newestHurt(hud, now);
  const hurts = hud.hurts.filter((h) => now - h.at < 1400);
  useLive(
    () => {
      // Khoảng hở tâm ngắm theo độ toả. Ánh xạ radian → điểm ảnh bằng tan() theo chiều cao màn hình và
      // FOV đang dùng: trước đây dùng hằng số 900 nên ở FOV 100 khoảng hở báo thiếu ~30% so với
      // góc tán thật, tức tâm ngắm nói dối về độ chính xác.
      const pxPerRad = window.innerHeight / 2 / Math.tan((getSettings().fov * Math.PI) / 360 / (stance.aiming ? stance.zoom : 1));
      const gap = Math.max(3, Math.min(60, Math.tan(stance.spread) * pxPerRad));
      cross.current?.style.setProperty("--gap", `${gap.toFixed(1)}px`);
      // Hướng bị bắn so với hướng mình đang nhìn (look.yaw là hướng camera nhìn về −sin, −cos): xoay theo chuột.
      const box = hurtBox.current;
      if (box)
        for (const el of box.children as HTMLCollectionOf<HTMLElement>) {
          const rel = Number(el.dataset.angle) - (look.yaw + Math.PI);
          el.style.transform = `rotate(${((-rel * 180) / Math.PI).toFixed(1)}deg)`;
        }
    },
    () => {
      const h = getBattleHud();
      const t = performance.now();
      const p = room.state.players.get(myId(room));
      const hitAt = h.hit && t - h.hit.at < 260 ? h.hit.at : 0;
      const dmgAt = h.hit && t - h.hit.at < 800 && h.hit.kind !== "kill" ? h.hit.at : 0;
      const flashAt = newestHurt(h, t) ?? 0;
      const hurtAts = h.hurts.filter((x) => t - x.at < 1400).map((x) => x.at).join(",");
      return `${p?.alive}|${p?.vehicle}|${(p?.hp ?? 100) < 30}|${stance.aiming}|${stance.scoped}|${stance.firstPerson}|${stance.sight}|${stance.zero}|${gun.weapon}|${hitAt}|${dmgAt}|${flashAt}|${hurtAts}`;
    },
  );
  if (!me?.alive || me.vehicle) return null;
  return (
    <>
      {scoped ? (
        <ScopeView />
      ) : stance.aiming && stance.firstPerson ? null : (
        <div ref={cross} className={`b-cross ${stance.aiming ? "ads" : ""}`}>
          <i className="t" />
          <i className="b" />
          <i className="l" />
          <i className="r" />
          <b />
        </div>
      )}
      {/* Mờ dần bằng CSS animation (key đổi thì chạy lại từ đầu). */}
      {hit && <div key={hit.at} className={`b-hitmark ${hit.kind}${hit.armor ? " armor" : ""}`} style={{ animationDelay: `${-(now - hit.at)}ms` }} />}
      {dmg && (
        <div key={dmg.at} className={`b-dmg ${dmg.kind}${dmg.armor ? " armor" : ""}`} style={{ animationDelay: `${-(now - dmg.at)}ms` }}>
          {dmg.amount}
        </div>
      )}
      {flash !== null && <div key={flash} className="b-flash" style={{ animationDelay: `${-(now - flash)}ms` }} />}
      <div ref={hurtBox}>
        {hurts.map((h) => (
          <div key={h.at} className="b-hurt" data-angle={h.angle} style={{ animationDelay: `${-(now - h.at)}ms` }} />
        ))}
      </div>
      {me.hp < 30 && <div className="b-lowhp" />}
    </>
  );
}

/** Mốc thời gian của cú trúng đòn mới nhất, hoặc null nếu đã quá 160ms (để quầng đỏ tắt). */
function newestHurt(hud: ReturnType<typeof getBattleHud>, now: number): number | null {
  let best: number | null = null;
  for (const h of hud.hurts) {
    if (now - h.at < 160 && (best === null || h.at > best)) best = h.at;
  }
  return best;
}

// ---------------------------------------------------------------------------- la bàn

const COMPASS_MARKS = 13;

function Compass() {
  const marks = useRef<(HTMLSpanElement | null)[]>([]);
  const readout = useRef<HTMLElement>(null);
  const last = useRef(NaN);
  useLive(
    () => {
      // Hướng nhìn: bắc (−z) là 0°. Chỉ chỉnh DOM khi hướng đổi quá một phần mười độ.
      const heading = ((((-look.yaw + Math.PI) * 180) / Math.PI) % 360 + 360) % 360;
      if (Math.abs(heading - last.current) < 0.1) return;
      last.current = heading;
      for (let n = 0; n < COMPASS_MARKS; n++) {
        const el = marks.current[n];
        if (!el) continue;
        const d = -90 + n * 15;
        const deg = ((Math.round(((heading + d + 360) % 360) / 15) * 15) % 360);
        const off = ((deg - heading + 540) % 360) - 180;
        const label = { 0: "B", 90: "Đ", 180: "N", 270: "T" }[deg] ?? (deg % 45 === 0 ? String(deg) : "·");
        el.style.left = `${(50 + (off / 90) * 50).toFixed(2)}%`;
        if (el.textContent !== label) {
          el.textContent = label;
          el.className = label.length === 1 && label !== "·" ? "card" : "";
        }
      }
      if (readout.current) readout.current.textContent = `${Math.round(heading)}°`;
    },
    () => "",
  );
  return (
    <div className="b-compass">
      {Array.from({ length: COMPASS_MARKS }, (_, n) => (
        <span
          key={n}
          ref={(el) => {
            marks.current[n] = el;
          }}
        />
      ))}
      <em ref={readout} />
    </div>
  );
}

// ---------------------------------------------------------------------------- bản đồ nhỏ

function useShore(seed: number, mode: string) {
  return useMemo(() => {
    const map = mapForMode(mode, seed);
    const world = map.world;
    const pts: string[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      let lo = 0;
      let hi = (map.half ?? MAP_HALF_SIZE) * 0.98;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (world.heightAt(Math.cos(a) * mid, Math.sin(a) * mid) > 0) lo = mid;
        else hi = mid;
      }
      pts.push(`${(Math.cos(a) * lo).toFixed(1)},${(Math.sin(a) * lo).toFixed(1)}`);
    }
    return pts.join(" ");
  }, [seed, mode]);
}

function BattleMinimap({ room, big }: { room: IslandRoom; big?: boolean }) {
  useFrameTick(8);
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const mode = useRoomSnapshot(room, (s) => (s.battleMode === "war" ? "war" : "solo"));
  const shore = useShore(seed, mode);
  const map = mapForMode(mode, seed);
  const z = room.state.zone;
  const H = map.half ?? MAP_HALF_SIZE;
  const war = mode === "war";
  const me = room.state.players.get(myId(room));
  const phase = room.state.phase;
  // Bản đồ nhỏ: cửa sổ ~380 m quanh mình (cả đảo co vào 240px thì mũi tên, đồng đội chỉ còn 2–3 điểm ảnh);
  // bản đồ lớn (M): cả đảo. `u`: số mét ứng với một điểm ảnh, để vẽ biểu tượng theo kích thước màn hình.
  const span = big ? H * 2 : Math.min(H * 2, 380);
  const cx = big ? 0 : localPosition.x;
  const cz = big ? 0 : localPosition.z;
  const u = span / (big ? Math.min(window.innerHeight, window.innerWidth) * 0.8 : 240);
  return (
    <svg className={big ? "b-map big" : "b-map"} viewBox={`${cx - span / 2} ${cz - span / 2} ${span} ${span}`}>
      <rect x={-H * 2} y={-H * 2} width={H * 4} height={H * 4} className="bm-sea" />
      <polygon points={shore} className="bm-land" />
      {map.sites.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.z}) rotate(${(-s.rot * 180) / Math.PI})`}>
          <rect x={-s.rx} y={-s.rz} width={s.rx * 2} height={s.rz * 2} className={`bm-site ${s.kind}`} />
          {big && (
            <text y={4} className="bm-label" transform={`rotate(${(s.rot * 180) / Math.PI})`}>
              {s.name}
            </text>
          )}
        </g>
      ))}
      {/* Chiến trường: cứ điểm (vòng màu phe giữ, chữ cái). */}
      {war &&
        [...room.state.flags.entries()].map(([id, f]) => (
          <g key={id} transform={`translate(${f.x} ${f.z})`}>
            <circle r={f.r} className="bm-flag" style={{ fill: teamColor(f.owner), stroke: teamColor(f.owner) }} />
            <text y={big ? 5 : 7} className="bm-flag-letter">
              {id}
            </text>
          </g>
        ))}
      {phase === "battle" && !war && (
        <>
          <circle cx={z.x} cy={z.z} r={z.r} className="bm-zone" />
          {z.nr > 0 && <circle cx={z.nx} cy={z.nz} r={z.nr} className="bm-next" />}
        </>
      )}
      {/* Xe tăng của đội mình và xe bỏ trống (xe địch thì không lộ trên bản đồ). */}
      {[...room.state.vehicles.values()]
        .filter((v) => v.hp > 0 && (!v.driver || (me?.team && v.team === me.team) || v.driver === myId(room)))
        .map((v, i) => (
          <rect key={`v${i}`} x={v.x - 6 * u} y={v.z - 6 * u} width={12 * u} height={12 * u} className="bm-tank" style={{ fill: v.driver ? teamColor(v.team) : "#bbb" }} />
        ))}
      {/* Đồng đội. */}
      {me?.team &&
        [...room.state.players.entries()]
          .filter(([id, p]) => id !== myId(room) && p.alive && p.team === me.team)
          .map(([id, p]) => <circle key={id} cx={p.x} cy={p.z} r={6 * u} className="bm-mate" />)}
      {me?.team === myId(room) && lastOrder.kind !== "follow" && lastOrder.at > 0 && (
        <g transform={`translate(${lastOrder.x} ${lastOrder.z}) scale(${u})`}>
          <path d="M-6,-6 L6,6 M6,-6 L-6,6" className="bm-order" />
        </g>
      )}
      {me && (
        <g transform={`translate(${localPosition.x} ${localPosition.z}) rotate(${(-look.yaw * 180) / Math.PI + 180}) scale(${u})`}>
          <path d="M0,-10 L7,7 L0,3.5 L-7,7 Z" className="bm-me" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------- thanh dưới: máu, giáp, súng, đạn

function Vitals({ room }: { room: IslandRoom }) {
  useFrameTick(15);
  const me = room.state.players.get(myId(room));
  if (!me || !me.alive || me.vehicle) return null;
  const k = me.kit;
  const now = performance.now();
  const reloading = k.reloading || gun.reloadUntil > now;
  const healing = k.healing || gun.healUntil > now;
  const slots: { key: string; slot: string; label: string; mag: number }[] = [
    { key: "1", slot: "primary1", label: withSight(WEAPON.get(k.primary1)?.name, k.sight1, k.att1), mag: k.mag1 },
    { key: "2", slot: "primary2", label: withSight(WEAPON.get(k.primary2)?.name, k.sight2, k.att2), mag: k.mag2 },
    { key: "3", slot: "pistol", label: withSight(WEAPON.get(k.pistol)?.name, k.sightP, k.attP), mag: k.magP },
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
          <span className={k.active === "flash" ? "on" : ""}>6 ✺{k.flash}</span>
          <span className={k.active === "mine" ? "on" : ""}>7 ⊚{k.mine}</span>
          <span>8 🩹{k.bandage}</span>
          <span>9 ✚{k.medkit}</span>
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
            <small>{active.class === "launcher" ? "PHÓNG TỪNG QUẢ" : active.auto ? "LIÊN THANH" : "BÁN TỰ ĐỘNG"} · {AMMO[active.ammo].name}</small>
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

const WEATHER_LABEL: Record<string, string> = { sunny: "☀ Nắng", cloudy: "☁ Nhiều mây", rain: "🌧 Mưa", fog: "🌫 Sương mù", storm: "⛈ Bão", snow: "❄ Tuyết" };
const TIME_LABEL: Record<string, string> = { dawn: "Bình minh", day: "Ban ngày", dusk: "Hoàng hôn", night: "Ban đêm" };

/** Giờ trong ngày (0–1) ra chữ: 0 là rạng đông (5 giờ), 0,82 là lúc mặt trời lặn (19 giờ). */
function clockLabel(clock: number): string {
  const hours = clock < 0.82 ? 5 + (clock / 0.82) * 14 : 19 + ((clock - 0.82) / 0.18) * 10;
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function TopBar({ room }: { room: IslandRoom }) {
  const s = useRoomSnapshot(room, (st) => ({
    phase: st.phase,
    alive: st.aliveCount,
    kills: st.players.get(myId(room))?.kills ?? 0,
    zone: { timeLeft: st.zone.timeLeft, shrinking: st.zone.shrinking, stage: st.zone.stage, dps: st.zone.dps },
    timeLeft: st.timeLeft,
    weather: st.weather,
    clock: Math.floor(st.clock * 288) / 288,
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
      {s.weather && (
        <div className="b-count" title="Thời tiết và giờ trong trận">
          {WEATHER_LABEL[s.weather] ?? s.weather} · {clockLabel(s.clock)}
        </div>
      )}
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
          <span className="w">{k.weapon === "zone" ? "☠ vùng độc" : k.weapon === "mine" ? "💥 mìn" : k.weapon === "frag" ? "💣" : k.weapon === "knife" ? "🔪 dao" : k.weapon === "tank" ? "⛟ pháo" : WEAPON.get(k.weapon)?.name ?? ""}{k.head ? " 🎯" : ""}</span>
          <b className="v">{nameOf(room, k.victim)}</b>
        </div>
      ))}
    </div>
  );
}

/** Thông báo ngắn giữa màn hình (lệnh cho đội, hết tiền...), tự tắt sau 1,8 giây. */
function Toast() {
  const hud = useBattleHud();
  const [, tick] = useState(0);
  const age = hud.toast ? performance.now() - hud.toast.at : Infinity;
  useEffect(() => {
    if (age > 1800) return;
    const t = setTimeout(() => tick((n) => n + 1), 1800 - age);
    return () => clearTimeout(t);
  }, [age]);
  if (!hud.toast || age > 1800) return null;
  return <div className="b-toast">{hud.toast.text}</div>;
}

function Pickup() {
  const hud = useBattleHud();
  if (!hud.nearItem) return null;
  return (
    <div className="b-pickup">
      <ItemIcon id={hud.nearItem.itemId} />
      <kbd>F</kbd> Nhặt {lootLabel(hud.nearItem.itemId)}
    </div>
  );
}

// ---------------------------------------------------------------------------- cửa hàng

type Tab = "guns" | "sights" | "atts" | "gear" | "ammo" | "outfit";

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
      <ItemIcon id={id} />
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
        <button className="x" onClick={closeBuyMenu} aria-label="Đóng">
          <X size={18} />
        </button>
      </header>
      <nav>
        {(
          [
            ["guns", "Súng"],
            ["sights", "Ống ngắm"],
            ["atts", "Phụ kiện"],
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
              {list.map((w) => item(w.id, w.name, w.price, `${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ""} sát thương · ${w.rpm} phát/phút · băng ${w.mag} · đạn bay ${w.velocity} m/s`))}
            </section>
          ))}
        {tab === "guns" && <p className="b-buy-note">M249, AWM và giáp, mũ cấp 3 chỉ có trong Kho vũ khí, trên tàu và ở bãi mìn. Mua súng được tặng 2 băng đạn.</p>}
        {tab === "atts" &&
          (["muzzle", "grip", "mag", "stock"] as const).map((slotKind) => (
            <section key={slotKind}>
              <h4>{{ muzzle: "Đầu nòng", grip: "Tay cầm", mag: "Băng đạn", stock: "Báng" }[slotKind]}</h4>
              {ATTACHMENT_IDS.filter((id) => ATTACHMENTS[id].slot === slotKind && ATTACHMENTS[id].price > 0).map((id) => {
                const fits = WEAPONS.filter((w) => w.price > 0 && attachmentFits(id, w)).map((w) => w.name);
                return item(`att:${id}`, ATTACHMENTS[id].name, ATTACHMENTS[id].price, `${ATTACHMENTS[id].desc} · lắp cho ${fits.length > 5 ? `${fits.length} khẩu` : fits.join(", ")}`);
              })}
            </section>
          ))}
        {tab === "atts" && <p className="b-buy-note">Mua hay nhặt phụ kiện thì tự lắp lên khẩu đang cầm (hoặc khẩu hợp còn trống chỗ), món cũ cùng chỗ rơi xuống đất. Băng mở rộng thay nhanh chỉ nhặt được ở kho vũ khí.</p>}
        {tab === "sights" && (
          <section>
            {SIGHT_IDS.filter((id) => SIGHTS[id].price > 0).map((id) => {
              const fits = WEAPONS.filter((w) => sightFits(id, w)).length === WEAPONS.length ? "mọi súng" : WEAPONS.filter((w) => sightFits(id, w) && w.price > 0).map((w) => w.name).join(", ");
              return item(`sight:${id}`, SIGHTS[id].name, SIGHTS[id].price, `phóng ${SIGHTS[id].zoom}x · ${SIGHTS[id].scope ? "ống kính" : "kính phản xạ"} · lắp cho ${fits}`);
            })}
            <p className="b-buy-note">Mua hay nhặt ống ngắm thì tự lắp lên khẩu đang cầm (hoặc khẩu hợp nhất), ống cũ rơi xuống đất. Ống 8x chỉ nhặt được ở kho vũ khí, trên tàu. Có ống kính thì PageUp/PageDown chỉnh cự ly ngắm (đạn rơi theo quỹ đạo, bắn xa phải ngắm cao hơn hoặc dùng vạch bù).</p>
          </section>
        )}
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
    mode: st.battleMode,
    weather: st.weatherPick,
    time: st.timePick,
    players: [...st.players.entries()].filter(([, p]) => !p.bot).map(([id, p]) => ({ id, name: p.name, color: p.color, team: p.team })),
  }));
  const war = s.mode === "war";
  const perSide = Math.max(5, s.bots || 50);
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
      <div className="b-mode-pick">
        <button className={s.mode === "solo" ? "on" : ""} disabled={!isHost} onClick={() => room.send(Messages.battleSettings, { mode: "solo" })}>
          <strong>Sinh tồn</strong>
          <span>Một mình, người cuối cùng còn sống thắng</span>
        </button>
        <button className={s.mode === "squad" ? "on" : ""} disabled={!isHost} onClick={() => room.send(Messages.battleSettings, { mode: "squad" })}>
          <strong>Đồng đội</strong>
          <span>Mỗi người dẫn 5 máy (bắn tỉa, súng trường, súng máy, chống tăng, lái tăng), đội cuối cùng còn người thắng</span>
        </button>
        <button className={s.mode === "war" ? "on" : ""} disabled={!isHost} onClick={() => room.send(Messages.battleSettings, { mode: "war", ...(s.bots < 5 ? { bots: 50 } : {}) })}>
          <strong>Chiến trường</strong>
          <span>50 vs 50: phe Xanh đấu phe Đỏ, chiếm 7 cứ điểm trên bản đồ rộng, xe tăng, hồi sinh</span>
        </button>
      </div>
      <p>
        {war
          ? "Bản đồ riêng rộng gần 700 m, hai căn cứ hai đầu, 7 cứ điểm A–G có công sự. Đứng trong vùng cứ điểm để chiếm; phe giữ ít cứ điểm hơn bị trừ vé dần, mỗi lần gục mất một vé; hết vé là thua. Gục thì chọn lớp lính và chỗ hồi sinh. Mỗi phe 3 xe tăng ở căn cứ."
          : s.mode === "squad"
          ? "Mỗi đội xuất phát cùng một chỗ, có xe tăng riêng · Y/G/H ra lệnh cho đội · gục thì nhập vào máy còn sống · Z nằm bắn · F lên xe tăng."
          : "Xuất phát ngẫu nhiên khắp đảo · bấm B mua vũ khí · vùng an toàn thu hẹp dần · người cuối cùng còn sống thắng."}
      </p>
      {war && (
        <div className="w-sides">
          {(["blue", "red"] as const).map((side) => (
            <div key={side} className={`w-side ${side}`}>
              <h4>{SIDE_NAME[side]}</h4>
              <ul>
                {s.players
                  .filter((p) => p.team === side)
                  .map((p) => (
                    <li key={p.id}>
                      {p.name}
                      {p.id === s.host && " 👑"}
                      {p.id === me && " (bạn)"}
                    </li>
                  ))}
                <li className="muted">+ {Math.max(0, perSide - s.players.filter((p) => p.team === side).length)} máy</li>
              </ul>
              {s.players.find((p) => p.id === me)?.team !== side && <button onClick={() => room.send(Messages.pickSide, { side })}>Vào {SIDE_NAME[side]}</button>}
            </div>
          ))}
        </div>
      )}
      <ul className="b-lobby-players" style={war ? { display: "none" } : undefined}>
        {s.players.map((p) => (
          <li key={p.id}>
            <i style={{ background: p.color }} /> {p.name}
            {p.id === s.host && " 👑"}
            {p.id === me && " (bạn)"}
          </li>
        ))}
      </ul>
      <label className="b-bots">
        {war ? "Số người mỗi phe (người chơi + máy)" : s.mode === "squad" ? "Tổng số máy (gồm 5 máy theo mỗi người, còn lại chia thành đội máy)" : "Máy (bot) cùng chơi"}:{" "}
        <strong>{war ? perSide : s.mode === "squad" ? Math.max(s.bots, s.players.length * 5) : s.bots}</strong>
        <input type="range" min={war ? 5 : 0} max={MAX_BATTLE_BOTS} value={war ? perSide : s.bots} disabled={!isHost} onChange={(e) => room.send(Messages.battleSettings, { bots: Number(e.target.value) })} />
      </label>
      <div className="b-sky-pick">
        <label>
          Thời tiết
          <select value={s.weather} disabled={!isHost} onChange={(e) => room.send(Messages.battleSettings, { weather: e.target.value as "random" })}>
            <option value="random">Ngẫu nhiên (đổi dần giữa trận)</option>
            {BATTLE_WEATHERS.map((w) => (
              <option key={w} value={w}>
                {WEATHER_LABEL[w]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Giờ
          <select value={s.time} disabled={!isHost} onChange={(e) => room.send(Messages.battleSettings, { time: e.target.value as "random" })}>
            <option value="random">Ngẫu nhiên</option>
            {BATTLE_TIMES.map((t) => (
              <option key={t} value={t}>
                {TIME_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isHost ? (
        <button className="primary big" onClick={() => room.send(Messages.start)}>
          <CrossIcon size={18} /> Bắt đầu trận ({war ? `${perSide} vs ${perSide}` : `${s.players.length + (s.mode === "squad" ? Math.max(s.bots, s.players.length * 5) : s.bots)} người`})
        </button>
      ) : (
        <p className="muted">Chờ chủ phòng bắt đầu…</p>
      )}
      <button className="ghost" onClick={onLeave}>
        <LogOut size={16} /> Rời phòng
      </button>
      <p className="b-keys">
        WASD đi · Shift chạy · C ngồi xổm (đang chạy: trượt) · Z nằm sấp · Space nhảy · Chuột trái bắn · Chuột phải ngắm · R thay đạn · 1–3 súng · X cất súng (cầm dao) · V đâm dao · 4 lựu đạn · 5 bom khói · 6 bom choáng · 7 mìn (giữ chuột trái rút chốt, thả ra ném; giữ thêm chuột phải thì ném thấp) · 8–9 hồi máu · Q/E (giữ) nghiêng trái / phải · F nhặt, lên / xuống xe tăng · B cửa hàng · Tab bảng điểm · T đổi góc nhìn · Đồng đội: Y tới điểm, G giữ chỗ, H theo sau
      </p>
    </div>
  );
}

function Scoreboard({ room }: { room: IslandRoom }) {
  const hud = useBattleHud();
  const rows = useRoomSnapshot(room, (s) =>
    [...s.players.entries()]
      .map(([id, p]) => ({ id, name: p.name, kills: p.kills, alive: p.alive, bot: p.bot, team: p.team }))
      .sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : 0) || Number(b.alive) - Number(a.alive) || b.kills - a.kills),
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
              <td>
                {r.team && <i className="b-team-dot" style={{ background: teamColor(r.team) }} title={teamName(room, r.team)} />}
                {r.name}
              </td>
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
      team: p?.team ?? "",
      squad: st.battleMode === "squad",
      war: st.battleMode === "war",
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
      // Đồng đội: xem người trong đội mình (để chọn máy nhập vào).
      if (s.killer && !s.squad && room.state.players.get(s.killer)?.alive) setBattleHud({ spectating: s.killer });
      else nextSpectate(room);
    }
    if (s.alive && rank) setRank(0);
  }, [s.alive, s.phase, s.killer, s.aliveCount, rank, room]);
  useEffect(() => {
    // Người mình đang xem gục thì xem người khác.
    if (!s.alive && hud.spectating && !room.state.players.get(hud.spectating)?.alive) nextSpectate(room);
  });

  if (s.phase === "ended") {
    const won = s.squad || s.war ? !!s.team && s.winner === s.team : s.winner === me;
    return (
      <div className={`b-end ${won ? "win" : ""}`}>
        {won ? (
          <>
            <Trophy size={48} />
            <h1>WINNER WINNER!</h1>
            <p>{s.war ? `${SIDE_NAME[s.team]} thắng: phe địch hết vé quân` : s.squad ? "Đội bạn là đội cuối cùng còn trụ lại" : "Bạn là người cuối cùng còn sống"} · {s.kills} hạ gục</p>
          </>
        ) : (
          <>
            <h1>{s.winner ? `${s.war ? SIDE_NAME[s.winner] : s.squad ? teamName(room, s.winner) : nameOf(room, s.winner)} chiến thắng` : "Không ai sống sót"}</h1>
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
  if ((s.phase === "battle" || s.phase === "prep") && !s.alive && !s.war) {
    return (
      <div className="b-dead">
        <Skull size={28} />
        <h2>{s.killer ? `${nameOf(room, s.killer)} đã hạ bạn` : "Bạn đã gục"}</h2>
        <p>
          {s.weapon === "zone" ? "vùng độc" : WEAPON.get(s.weapon)?.name ?? (s.weapon === "mine" ? "mìn" : s.weapon === "frag" ? "lựu đạn" : s.weapon === "tank" ? "pháo xe tăng" : "")} · Hạng #{rank} · {s.kills} hạ gục
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

const FPS_CHOICES = [30, 60, 90, 120, 0];
const DPR_CHOICES = [0, 1, 1.25, 1.5, 2];

/** Phần đồ hoạ của bảng cài đặt: mức chất lượng, giới hạn khung hình, độ phân giải, tự thích ứng, số liệu F3. */
function GraphicsSettings() {
  const g = useGraphics();
  const stats = useStatsOpen();
  const native = window.devicePixelRatio || 1;
  return (
    <>
      <div className="b-set-title">Đồ hoạ</div>
      <div className="b-set-row">
        <span>Chất lượng</span>
        <div className="b-set-seg">
          {(["high", "medium", "low"] as Quality[]).map((q) => (
            <button key={q} className={g.quality === q ? "on" : ""} onClick={() => setGraphics({ quality: q })}>
              {QUALITY_LABEL[q]}
            </button>
          ))}
        </div>
        <em>P</em>
      </div>
      <label className="b-set-row">
        <span>Giới hạn khung hình</span>
        <select value={g.fpsCap} onChange={(e) => setGraphics({ fpsCap: Number(e.target.value) })}>
          {FPS_CHOICES.map((f) => (
            <option key={f} value={f}>
              {f === 0 ? "Không giới hạn (nóng máy)" : `${f} FPS`}
            </option>
          ))}
        </select>
        <em />
      </label>
      <label className="b-set-row">
        <span>Độ phân giải vẽ</span>
        <select value={g.maxDpr} onChange={(e) => setGraphics({ maxDpr: Number(e.target.value) })}>
          {DPR_CHOICES.filter((d) => d <= Math.max(1, native)).map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Tự động theo chất lượng" : d >= native ? `${d}x (gốc của màn hình)` : `${d}x`}
            </option>
          ))}
        </select>
        <em />
      </label>
      <label className="b-set-check">
        <input type="checkbox" checked={g.adaptive} onChange={(e) => setGraphics({ adaptive: e.target.checked })} /> Tự hạ độ phân giải khi bị giật
      </label>
      <label className="b-set-check">
        <input type="checkbox" checked={stats} onChange={toggleStats} /> Hiện số liệu hiệu năng (F3)
      </label>
    </>
  );
}

/** Âm lượng tổng và từng nhóm (tiếng súng / hiệu ứng, nền và thời tiết, nhạc). */
function SoundSettings() {
  const snd = useSyncExternalStore(audio.subscribe, () => audio.settings);
  const row = (label: string, key: VolumeKey) => (
    <label className="b-set-row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={snd.volume[key]} onChange={(e) => audio.setVolume(key, Number(e.target.value))} />
      <em>{snd.volume[key] === 0 ? "Tắt" : `${Math.round(snd.volume[key] * 100)}%`}</em>
    </label>
  );
  return (
    <>
      <div className="b-set-title">Âm thanh</div>
      {row("Âm lượng tổng", "master")}
      {row("Súng, bước chân, hiệu ứng", "sfx")}
      {row("Môi trường, mưa gió", "ambience")}
      {row("Nhạc nền", "music")}
      <label className="b-set-check">
        <input type="checkbox" checked={snd.muted} onChange={(e) => audio.setMuted(e.target.checked)} /> Tắt hết âm thanh (M)
      </label>
    </>
  );
}

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
        <Gear size={18} /> Cài đặt
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
      <SoundSettings />
      <GraphicsSettings />
      <button
        className="ghost"
        onClick={() => {
          setSettings(DEFAULT_SETTINGS);
          setGraphics({ fpsCap: DEFAULT_GRAPHICS.fpsCap, maxDpr: DEFAULT_GRAPHICS.maxDpr, adaptive: DEFAULT_GRAPHICS.adaptive });
          for (const [k, v] of Object.entries(DEFAULT_VOLUME) as [VolumeKey, number][]) audio.setVolume(k, v);
        }}
      >
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
  const war = useRoomSnapshot(room, (s) => s.battleMode === "war");
  useFlagToasts(room);
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
      {fighting && <Flashed room={room} />}
      <Compass />
      {fighting && (war ? <WarTop room={room} /> : <TopBar room={room} />)}
      {fighting && war && <CaptureBar room={room} />}
      {fighting && war && <Deploy room={room} />}
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
      {fighting && <SquadHud room={room} />}
      {fighting && <TankHud />}
      <Toast />
      <TankPrompt />
      <Pickup />
      <BuyMenu room={room} />
      <Scoreboard room={room} />
      <Lobby room={room} onLeave={onLeave} />
      <DeathAndWin room={room} onLeave={onLeave} />
      <SettingsButton />
    </div>
  );
}
