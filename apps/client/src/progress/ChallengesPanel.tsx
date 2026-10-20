import { useEffect, useState } from "react";
import { Check, Coins, Target, X } from "lucide-react";
import { ApiError, fetchChallenges, refreshProfile, type ChallengeSet, type ChallengeStatus } from "../account/account.ts";
import "../gacha/gacha.css";
import "./progress.css";

// Thử thách ngày (3) và tuần (3): thanh tiến độ, thưởng xu + XP. Tiến độ cộng lúc hết trận; xong là server tự nhận thưởng
// (không cần bấm nhận, không sợ qua ngày mất thưởng). Mở bảng này cũng cho biết xu trận đã nhận hôm nay so với giới hạn.

const fmt = (n: number) => n.toLocaleString("vi-VN");

/** "còn 5 giờ 12 phút", "còn 3 ngày 4 giờ". */
export function timeLeft(endsAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.ceil((endsAt - now) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `còn ${d} ngày ${h} giờ`;
  if (h > 0) return `còn ${h} giờ ${m} phút`;
  return `còn ${m} phút`;
}

function Section({ title, set }: { title: string; set: ChallengeSet }) {
  const doneAll = set.items.length > 0 && set.items.every((c) => c.claimed);
  return (
    <section className="ch-section">
      <h3>
        {title} <small>{doneAll ? "Đã xong cả bộ" : timeLeft(set.endsAt)}</small>
      </h3>
      <ul className="ch-list">
        {set.items.map((c) => (
          <li key={c.id} className={`ch-item${c.claimed ? " done" : ""}`}>
            <div className="ch-main">
              <b>{c.title}</b>
              <div className="ch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={c.progress}>
                <i style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }} />
              </div>
            </div>
            <span className="ch-count">
              {c.progress}/{c.target}
            </span>
            <span className="ch-reward">
              {c.claimed ? (
                <span className="ch-claimed">
                  <Check size={13} aria-hidden /> Đã nhận
                </span>
              ) : (
                <>
                  <Coins size={12} aria-hidden /> {fmt(c.coins)} <small>+{fmt(c.xp)} XP</small>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChallengesPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ChallengeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchChallenges().then(
      (s) => {
        if (live) setStatus(s);
        // Thưởng thử thách xong ở trận trước đã vào tài khoản: nạp lại xu.
        void refreshProfile();
      },
      (e) => live && setError(e instanceof ApiError ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cap = status?.coins;
  return (
    <div className="gacha-screen challenges-screen" role="dialog" aria-modal aria-label="Thử thách">
      <div className="gacha-shell">
        <header className="gacha-top">
          <h2>
            <Target size={18} aria-hidden /> Thử thách
          </h2>
          <button className="ghost gacha-close" onClick={onClose} aria-label="Đóng" style={{ marginLeft: "auto" }}>
            <X size={18} />
          </button>
        </header>
        {!status && !error && <p className="gacha-empty">Đang tải…</p>}
        {error && <p className="error gacha-error">{error}</p>}
        {status && (
          <>
            <Section title="Hằng ngày" set={status.daily} />
            <Section title="Hằng tuần" set={status.weekly} />
            {cap && (
              <div className="ch-cap">
                <div className="ch-cap-head">
                  <span>Xu từ trận đấu hôm nay</span>
                  <span>
                    {fmt(cap.today)} / {fmt(cap.cap)}
                  </span>
                </div>
                <div className="ch-bar">
                  <i style={{ width: `${Math.min(100, (cap.today / cap.cap) * 100)}%` }} />
                </div>
                <p>{cap.today >= cap.cap ? "Đã đạt giới hạn xu hôm nay. Thưởng thử thách không tính vào giới hạn." : "Thưởng thử thách không tính vào giới hạn này. Chơi một mình với máy nhận 60% xu trận."}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
