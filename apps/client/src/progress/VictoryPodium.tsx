import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Award, Crosshair, Flag, HeartHandshake, Medal, SkipForward, Trophy } from "lucide-react";
import { CALLING_CARDS, EMBLEMS, rankDef, rankOf, rankProgress } from "@tentides/content";
import type { MatchSummaryMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { refreshProfile, useAccount } from "../account/account.ts";
import { playUi } from "../game/sound/ui.ts";
import { StageBoundary, decor3d } from "../studio/webgl.tsx";
import { matchXp } from "./matchXp.ts";
import { RankBadge } from "./RankBadge.tsx";
import type { PodiumHero } from "./PodiumStage.tsx";

// Màn vinh danh điện ảnh cuối trận: bục 3D với ba người điểm cao nhất (PodiumStage, nạp lười; máy yếu thì bục 2D),
// rồi phần "thành tích của bạn": số liệu nhảy số vàng, thanh kinh nghiệm chạy, huân chương vừa đạt bung hạt lấp lánh.
// Bấm "Bỏ qua" để xem ngay kết quả cuối.

const PodiumStage = lazy(() => import("./PodiumStage.tsx"));
/** Sân khấu không vẽ lại theo đồng hồ của màn (số nhảy mỗi khung hình), chỉ khi đổi người hay bấm Bỏ qua. */
const Stage = memo(function Stage(props: { heroes: PodiumHero[]; skip: boolean; labels: RefObject<(HTMLDivElement | null)[]> }) {
  return <PodiumStage {...props} />;
});
/** Cú lia máy mở màn của bục 3D kéo dài chừng này giây (khớp ORBIT_SECONDS trong PodiumStage). */
const ORBIT = 9;

/** Mốc thời gian (giây từ lúc hiện): số liệu nhảy, thanh XP chạy, huân chương lần lượt bung. */
const T_COUNT = 1.0;
const D_COUNT = 1.6;
const T_XP = 2.9;
const D_XP = 1.4;
const T_MEDAL = 4.5;
const MEDAL_GAP = 0.45;

interface MedalItem {
  key: string;
  title: string;
  sub: string;
  tone: "gold" | "cyan" | "crimson";
  icon: "trophy" | "kills" | "flag" | "support" | "rank" | "medal" | "award";
  rank?: number;
}

const ICONS = { trophy: Trophy, kills: Crosshair, flag: Flag, support: HeartHandshake, rank: Award, medal: Medal, award: Award };

const ease = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

/** Đồng hồ của màn: giây kể từ lúc hiện, cập nhật mỗi khung hình tới khi xong (`end` giây). Bỏ qua thì nhảy tới cuối. */
function useTimeline(end: number, skip: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (skip) {
      setT(end);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      setT(Math.min(end, s));
      if (s < end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, skip]);
  return t;
}

function Count({ value, t, gold }: { value: number; t: number; gold?: boolean }) {
  const shown = Math.round(value * ease((t - T_COUNT) / D_COUNT));
  return <b className={gold ? "vp-num gold" : "vp-num"}>{shown.toLocaleString("vi-VN")}</b>;
}

/** Huân chương bung ra: vòng sáng, 12 hạt lấp lánh văng ra quanh. */
function MedalBadge({ m, shown }: { m: MedalItem; shown: boolean }) {
  const Icon = ICONS[m.icon];
  return (
    <div className={`vp-medal ${m.tone}${shown ? " on" : ""}`}>
      <div className="vp-medal-disc">
        {m.rank ? <RankBadge rank={m.rank} size={30} /> : <Icon size={22} aria-hidden />}
        {shown && (
          <span className="vp-burst" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ "--a": `${i * 30 + (i % 2) * 12}deg`, "--d": `${38 + (i % 3) * 12}px` } as CSSProperties} />
            ))}
          </span>
        )}
      </div>
      <strong>{m.title}</strong>
      <small>{m.sub}</small>
    </div>
  );
}

export function VictoryPodium({ room, summary }: { room: IslandRoom; summary: MatchSummaryMessage }) {
  const me = myId(room);
  const [skip, setSkip] = useState(false);
  const live = useMemo(() => decor3d(), []);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const account = useAccount();

  // Ba người điểm cao nhất (bảng đã xếp theo điểm), lấy ngoại hình trong phòng (màu, rằn ri, súng, skin).
  const heroes = useMemo<PodiumHero[]>(
    () =>
      summary.rows.slice(0, 3).map((r, i) => {
        const p = room.state.players.get(r.id);
        const k = p?.kit;
        const weapon = k?.primary1 || k?.primary2 || "m416";
        return {
          id: r.id,
          name: r.name.replace("🤖 ", ""),
          place: (i + 1) as 1 | 2 | 3,
          color: p?.color ?? "#669bbc",
          outfit: k?.outfit || "woodland",
          weapon,
          sight: weapon === k?.primary1 ? k.sight1 : weapon === k?.primary2 ? (k?.sight2 ?? "") : "reddot",
          skin: p?.skins.get(weapon) ?? "",
        };
      }),
    [summary, room],
  );

  // XP: số XP trận này (server báo dần trong trận); tổng XP tài khoản sau trận để chạy thanh quân hàm.
  const earned = useMemo(() => matchXp.total, [summary]);
  const known = useRef(account.status === "user" ? (account.profile.progress?.xp ?? 0) : 0);
  const fresh = account.status === "user" ? (account.profile.progress?.xp ?? 0) : 0;
  const signedIn = account.status === "user";
  useEffect(() => {
    // Server ghi XP vào tài khoản lúc hết trận: nạp lại hồ sơ một chút sau đó.
    const t = setTimeout(() => void refreshProfile(), 1200);
    return () => clearTimeout(t);
  }, []);
  const after = Math.max(known.current + earned, fresh);
  const before = Math.max(0, after - earned);

  const row = summary.rows.find((r) => r.id === me);
  const place = row ? summary.rows.indexOf(row) + 1 : 0;
  const war = summary.mode === "war";
  const teams = summary.mode === "war" || summary.mode === "squad";
  const won = row ? (teams ? !!row.team && summary.winner === row.team : summary.winner === me) : false;

  const medals = useMemo<MedalItem[]>(() => {
    const out: MedalItem[] = [];
    if (won) out.push({ key: "win", title: "Chiến thắng", sub: teams ? "Phe / đội thắng trận" : "Người cuối cùng trụ lại", tone: "gold", icon: "trophy" });
    for (const m of summary.mvp) {
      if (m.id !== me) continue;
      if (m.kind === "kills") out.push({ key: "mvp-k", title: "MVP Hạ gục", sub: `${m.value} hạ gục`, tone: "crimson", icon: "kills" });
      if (m.kind === "captures") out.push({ key: "mvp-c", title: "MVP Cứ điểm", sub: `${m.value} lần chiếm`, tone: "cyan", icon: "flag" });
      if (m.kind === "support") out.push({ key: "mvp-s", title: "MVP Hỗ trợ", sub: `${m.value} lượt hỗ trợ`, tone: "cyan", icon: "support" });
    }
    if (place > 0 && place <= 3) out.push({ key: "top", title: `Top ${place} trận đấu`, sub: "Đứng trên bục vinh danh", tone: "gold", icon: "medal" });
    const r0 = signedIn ? rankOf(before) : 0;
    const r1 = signedIn ? rankOf(after) : 0;
    if (signedIn && r1 > r0) {
      out.push({ key: "rank", title: "Lên quân hàm", sub: rankDef(r1)?.name ?? "", tone: "gold", icon: "rank", rank: r1 });
      for (const c of CALLING_CARDS) if (c.unlock.kind === "rank" && c.unlock.rank > r0 && c.unlock.rank <= r1) out.push({ key: `card-${c.id}`, title: "Thẻ tên mới", sub: c.name, tone: "cyan", icon: "award" });
      for (const e of EMBLEMS) if (e.unlock.kind === "rank" && e.unlock.rank > r0 && e.unlock.rank <= r1) out.push({ key: `emb-${e.id}`, title: "Huy hiệu mới", sub: e.name, tone: "cyan", icon: "award" });
    }
    return out;
  }, [summary, me, won, teams, place, signedIn, before, after]);

  const end = Math.max(live ? ORBIT : 0, T_MEDAL + medals.length * MEDAL_GAP + 0.5);
  const t = useTimeline(end, skip);

  // Tiếng: tích tích lúc số nhảy, ngân kim loại khi từng huân chương bung.
  const sfx = useRef({ count: 0, medals: 0 });
  useEffect(() => {
    const s = sfx.current;
    if (skip) {
      if (s.medals < medals.length) playUi("medal");
      s.medals = medals.length;
      return;
    }
    if (t > T_COUNT && t < T_COUNT + D_COUNT && t - s.count > 0.07) {
      s.count = t;
      playUi("count");
    }
    const due = medals.filter((_, i) => t >= T_MEDAL + i * MEDAL_GAP).length;
    if (due > s.medals) {
      s.medals = due;
      playUi("medal");
    }
  }, [t, skip, medals.length]);

  // Thanh XP: chạy từ tiến độ trước trận tới sau trận; lên quân hàm thì chạy từ đầu thanh của quân hàm mới.
  const p0 = rankProgress(before);
  const p1 = rankProgress(after);
  const from = p1.rank > p0.rank ? 0 : p0.ratio;
  const xpU = ease((t - T_XP) / D_XP);
  const ratio = from + (p1.ratio - from) * xpU;

  return (
    <section className={`vp ${live ? "live" : "still"}`} aria-label="Vinh danh cuối trận">
      <div className="vp-stage">
        {live ? (
          <StageBoundary fallback={<div className="vp-still-bg" />}>
            <Suspense fallback={<div className="vp-still-bg" />}>
              <Stage heroes={heroes} skip={skip} labels={labels} />
            </Suspense>
          </StageBoundary>
        ) : (
          <div className="vp-still-bg" />
        )}
        {live ? (
          heroes.map((h, i) => (
            <div
              key={h.id}
              className={`vp-tag p${h.place}${h.id === me ? " me" : ""}`}
              ref={(el) => {
                labels.current[i] = el;
              }}
            >
              <span>#{h.place}</span> {h.name}
            </div>
          ))
        ) : (
          <div className="vp-blocks">
            {[2, 1, 3].map((p) => {
              const h = heroes.find((x) => x.place === p);
              return (
                <div key={p} className={`vp-block p${p}`}>
                  <div className={`vp-tag static p${p}${h?.id === me ? " me" : ""}`}>{h ? h.name : "—"}</div>
                  <div className="vp-step">{p}</div>
                </div>
              );
            })}
          </div>
        )}
        <span className="vp-corner tl" aria-hidden>
          AAR · {summary.mode.toUpperCase()}
        </span>
        <span className="vp-corner br" aria-hidden>
          REC ● {Math.floor(t).toString().padStart(2, "0")}s
        </span>
        {t < end && !skip && (
          <button className="vp-skip" onClick={() => setSkip(true)}>
            Bỏ qua <SkipForward size={14} aria-hidden />
          </button>
        )}
      </div>

      {row && (
        <div className="vp-aar">
          <div className="vp-stats">
            <div>
              <Count value={row.kills} t={t} gold />
              <span>Hạ gục</span>
            </div>
            <div>
              <Count value={row.assists} t={t} />
              <span>Trợ giúp</span>
            </div>
            {war && (
              <div>
                <Count value={row.captures} t={t} />
                <span>Cứ điểm</span>
              </div>
            )}
            <div>
              <Count value={row.support} t={t} />
              <span>Hỗ trợ</span>
            </div>
            <div>
              <Count value={row.score} t={t} gold />
              <span>Điểm</span>
            </div>
            <div>
              <Count value={earned} t={t} gold />
              <span>XP trận này</span>
            </div>
          </div>
          {signedIn ? (
            <div className="vp-xp">
              <RankBadge rank={p1.rank} size={26} />
              <div className="vp-xp-bar">
                <div className="vp-xp-head">
                  <span>{rankDef(p1.rank)?.name}</span>
                  <span className="vp-num">{p1.next ? `${Math.round(p1.span * ratio).toLocaleString("vi-VN")} / ${p1.span.toLocaleString("vi-VN")} XP` : "Quân hàm cao nhất"}</span>
                </div>
                <div className="vp-xp-track">
                  <i style={{ width: `${(ratio * 100).toFixed(2)}%` }} />
                  {xpU > 0 && xpU < 1 && <em style={{ left: `${(ratio * 100).toFixed(2)}%` }} />}
                </div>
              </div>
            </div>
          ) : (
            <p className="vp-guest">Đăng nhập để tích XP, lên quân hàm và mở khoá thẻ tên, huy hiệu.</p>
          )}
          {medals.length > 0 && t >= T_MEDAL && (
            <div className="vp-medals">
              {medals.map((m, i) => (
                <MedalBadge key={m.key} m={m} shown={t >= T_MEDAL + i * MEDAL_GAP} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
