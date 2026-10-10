import { useEffect, useMemo, useState } from "react";
import { Check, Lock, X } from "lucide-react";
import { CALLING_CARDS, EMBLEMS, RANKS, RANK_GROUP_NAME, XP_AWARD, XP_LABEL, isUnlocked, rankDef, rankProgress, unlockText, type XpKind } from "@tentides/content";
import { ApiError, equipCard, refreshProfile, useAccount } from "../account/account.ts";
import { CallingCard, cardStyle } from "./CallingCard.tsx";
import { Emblem } from "./Emblem.tsx";
import { RankBadge } from "./RankBadge.tsx";
import "../gacha/gacha.css";
import "./progress.css";

// Hồ sơ quân nhân: bậc thang 30 quân hàm (XP cần, đang ở đâu) và chọn thẻ tên, huy hiệu đã mở khoá.

const XP_KINDS: readonly XpKind[] = ["kill", "headshot", "capture", "resupply", "repair", "revive", "shipDamage", "sink"];

/** Thanh XP gọn: quân hàm hiện tại, tiến độ lên cấp kế. Dùng ở bảng tài khoản. */
export function RankLine({ xp }: { xp: number }) {
  const p = rankProgress(xp);
  const def = rankDef(p.rank)!;
  return (
    <div className="rank-line" title={`${xp.toLocaleString("vi-VN")} XP`}>
      <RankBadge rank={p.rank} size={26} />
      <div className="rank-line-text">
        <div className="rank-line-name">
          {def.name} <span>· {RANK_GROUP_NAME[def.group]}</span>
        </div>
        <div className="xp-track">
          <div className="xp-fill" style={{ width: `${Math.round(p.ratio * 100)}%` }} />
        </div>
        <div className="rank-line-xp">{p.next ? `${p.into.toLocaleString("vi-VN")} / ${p.span.toLocaleString("vi-VN")} XP tới ${p.next.name}` : "Quân hàm cao nhất"}</div>
      </div>
    </div>
  );
}

export function ServiceRecord({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [tab, setTab] = useState<"ranks" | "cards">("ranks");
  const [card, setCard] = useState<string | null>(null);
  const [emblem, setEmblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void refreshProfile();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const profile = account.status === "user" ? account.profile : null;
  const progress = profile?.progress ?? { xp: 0, rank: 1, card: "", emblem: "" };
  const owned = useMemo(() => (profile?.skins ?? []).map((s) => s.skinId), [profile]);
  const pickedCard = card ?? progress.card;
  const pickedEmblem = emblem ?? progress.emblem;
  const dirty = pickedCard !== progress.card || pickedEmblem !== progress.emblem;

  if (!profile) {
    return (
      <div className="gacha-screen" role="dialog" aria-modal>
        <div className="gacha-shell">
          <p className="gacha-empty">Đăng nhập để có quân hàm, thẻ tên và huy hiệu.</p>
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await equipCard(pickedCard, pickedEmblem);
      setCard(null);
      setEmblem(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gacha-screen service-record" role="dialog" aria-modal aria-label="Hồ sơ quân nhân">
      <div className="gacha-shell">
        <header className="gacha-top">
          <h2>Hồ sơ quân nhân</h2>
          <div className="gacha-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "ranks"} className={tab === "ranks" ? "active" : ""} onClick={() => setTab("ranks")}>
              Quân hàm
            </button>
            <button role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>
              Thẻ tên & Huy hiệu
            </button>
          </div>
          <button className="ghost gacha-close" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <CallingCard cardId={pickedCard} emblemId={pickedEmblem} name={profile.user.username} rank={progress.rank} kicker="Thẻ tên của bạn" size="lg">
          {progress.xp.toLocaleString("vi-VN")} XP
        </CallingCard>

        {tab === "ranks" ? (
          <div className="ranks-tab">
            <RankLine xp={progress.xp} />
            <ul className="xp-rules">
              {XP_KINDS.map((k) => (
                <li key={k}>
                  {XP_LABEL[k]} <b>+{XP_AWARD[k]} XP</b>
                </li>
              ))}
            </ul>
            <ol className="rank-ladder">
              {RANKS.map((r) => (
                <li key={r.rank} className={r.rank === progress.rank ? "current" : r.rank < progress.rank ? "done" : ""}>
                  <RankBadge rank={r.rank} size={30} />
                  <span className="rl-name">{r.name}</span>
                  <span className="rl-en">{r.en}</span>
                  <span className="rl-xp">{r.xp.toLocaleString("vi-VN")} XP</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="cards-tab">
            <h3>Thẻ tên</h3>
            <div className="card-grid">
              {CALLING_CARDS.map((c) => {
                const open = isUnlocked(c.unlock, progress.rank, owned);
                const on = pickedCard === c.id || (!pickedCard && c === CALLING_CARDS[0]);
                return (
                  <button key={c.id} className={`card-tile${on ? " on" : ""}${open ? "" : " locked"}`} disabled={!open} onClick={() => setCard(c.id)} title={unlockText(c.unlock)}>
                    <div className="card-tile-art" style={cardStyle(c)} />
                    <span className="card-tile-name">{c.name}</span>
                    <span className="card-tile-rule">{open ? (on ? "Đang chọn" : "Đã mở") : unlockText(c.unlock)}</span>
                    {!open && <Lock size={13} className="tile-lock-icon" />}
                    {on && <Check size={13} className="tile-check-icon" />}
                  </button>
                );
              })}
            </div>
            <h3>Huy hiệu</h3>
            <div className="emblem-grid">
              <button className={`emblem-tile${pickedEmblem === "" ? " on" : ""}`} onClick={() => setEmblem("")}>
                <span className="emblem-none">—</span>
                <span className="card-tile-name">Không</span>
              </button>
              {EMBLEMS.map((e) => {
                const open = isUnlocked(e.unlock, progress.rank, owned);
                return (
                  <button key={e.id} className={`emblem-tile${pickedEmblem === e.id ? " on" : ""}${open ? "" : " locked"}`} disabled={!open} onClick={() => setEmblem(e.id)} title={unlockText(e.unlock)}>
                    <Emblem id={e.id} size={44} />
                    <span className="card-tile-name">{e.name}</span>
                    {!open && <span className="card-tile-rule">{unlockText(e.unlock)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="cards-actions">
              {saved && !dirty && <span className="saved-note">Đã lưu. Thẻ hiện cho người bị bạn hạ ở trận sau.</span>}
              <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
                Lưu thẻ tên
              </button>
            </div>
          </div>
        )}
        {error && <p className="error gacha-error">{error}</p>}
      </div>
    </div>
  );
}
