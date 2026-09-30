import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, Coins, Lock, Sparkles, X } from "lucide-react";
import { GACHA, RARITY, SKIN, SKINS, SKIN_RARITIES, SKIN_WEAPON_IDS, WEAPON, rarityRank, skinFitsWeapon, type SkinDef, type SkinRarity } from "@tentides/content";
import { ApiError, equipSkin, refreshProfile, rollGacha, useAccount, type RollOutcome } from "../account/account.ts";
import { SkinSwatch } from "./SkinSwatch.tsx";
import "./gacha.css";

// Màn Kho súng · Gacha: quay skin (1 hoặc 10 lượt, có bảo hiểm), lật thẻ theo độ hiếm, kho skin theo từng khẩu và lắp skin.

const weaponName = (id: string) => WEAPON.get(id)?.name ?? id.toUpperCase();
const rarityVar = (r: SkinRarity) => ({ "--rarity": RARITY[r].color }) as CSSProperties;

export function GachaScreen({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [tab, setTab] = useState<"roll" | "inventory">("roll");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RollOutcome | null>(null);

  useEffect(() => {
    void refreshProfile();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !reveal) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, reveal]);

  if (account.status !== "user") {
    return (
      <div className="gacha-screen" role="dialog" aria-modal>
        <div className="gacha-shell">
          <p className="gacha-empty">Đăng nhập để mở Kho súng.</p>
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
    );
  }
  const { profile } = account;
  const coins = profile.user.coins;

  async function roll(count: 1 | 10) {
    setBusy(true);
    setError(null);
    try {
      setReveal(await rollGacha(count));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gacha-screen" role="dialog" aria-modal aria-label="Kho súng và Gacha">
      <div className="gacha-shell">
        <header className="gacha-top">
          <h2>Kho súng · Gacha</h2>
          <div className="gacha-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "roll"} className={tab === "roll" ? "active" : ""} onClick={() => setTab("roll")}>
              Quay skin
            </button>
            <button role="tab" aria-selected={tab === "inventory"} className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>
              Kho súng
            </button>
          </div>
          <span className="coin-pill" title="Xu">
            <Coins size={15} aria-hidden /> {coins.toLocaleString("vi-VN")}
          </span>
          <button className="ghost gacha-close" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        {tab === "roll" ? (
          <RollTab coins={coins} pity={profile.pity} busy={busy} onRoll={roll} owned={profile.skins.length} />
        ) : (
          <InventoryTab skins={profile.skins} equipped={profile.equipped} onError={setError} />
        )}
        {error && <p className="error gacha-error">{error}</p>}
      </div>
      {reveal && <Reveal outcome={reveal} onDone={() => setReveal(null)} onAgain={(n) => void roll(n)} coins={coins} />}
    </div>
  );
}

// ---------------------------------------------------------------------------- quay

function RollTab({ coins, pity, busy, onRoll, owned }: { coins: number; pity: { sinceEpic: number; sinceLegendary: number }; busy: boolean; onRoll: (n: 1 | 10) => void; owned: number }) {
  // Vài skin đẹp nhất làm ảnh bìa banner.
  const featured = useMemo(() => SKINS.filter((s) => s.rarity === "legendary").slice(0, 4), []);
  return (
    <div className="gacha-roll">
      <section className="gacha-banner">
        <div className="banner-art" aria-hidden>
          {featured.map((s, i) => (
            <div key={s.id} className="banner-gun" style={{ "--i": i } as CSSProperties}>
              <SkinSwatch skin={s} size="lg" />
            </div>
          ))}
        </div>
        <div className="banner-text">
          <div className="kicker">Banner thường trực</div>
          <h3>Thuỷ Triều Huyền Thoại</h3>
          <p>
            {SKINS.length} skin súng, bạn đã có {owned}. Mỗi {GACHA.epicPity} lượt chắc chắn có Sử thi trở lên, mỗi {GACHA.legendaryPity} lượt chắc chắn có Huyền thoại.
          </p>
          <ul className="rates">
            {SKIN_RARITIES.slice()
              .reverse()
              .map((r) => (
                <li key={r} style={rarityVar(r)}>
                  <span className="dot" /> {RARITY[r].name} <b>{RARITY[r].weight}%</b>
                </li>
              ))}
          </ul>
        </div>
      </section>

      <div className="pity">
        <PityBar label="Sử thi+" value={pity.sinceEpic} max={GACHA.epicPity} rarity="epic" />
        <PityBar label="Huyền thoại" value={pity.sinceLegendary} max={GACHA.legendaryPity} rarity="legendary" />
      </div>

      <div className="roll-buttons">
        <button className="big roll-one" disabled={busy || coins < GACHA.cost1} onClick={() => onRoll(1)}>
          <Sparkles size={18} aria-hidden /> Quay 1
          <span className="cost">
            <Coins size={13} aria-hidden /> {GACHA.cost1}
          </span>
        </button>
        <button className="big primary roll-ten" disabled={busy || coins < GACHA.cost10} onClick={() => onRoll(10)}>
          <Sparkles size={18} aria-hidden /> Quay 10
          <span className="cost">
            <Coins size={13} aria-hidden /> {GACHA.cost10}
          </span>
        </button>
      </div>
      {coins < GACHA.cost1 && <p className="gacha-hint">Hết xu rồi. Chơi Battleground để kiếm thêm: hạ gục, sống sót lâu và thắng trận đều có xu.</p>}
    </div>
  );
}

function PityBar({ label, value, max, rarity }: { label: string; value: number; max: number; rarity: SkinRarity }) {
  const left = Math.max(1, max - value);
  return (
    <div className="pity-bar" style={rarityVar(rarity)}>
      <div className="pity-label">
        <span>{label}</span>
        <span>chắc chắn trong {left} lượt</span>
      </div>
      <div className="pity-track">
        <div className="pity-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- lật thẻ

function Reveal({ outcome, onDone, onAgain, coins }: { outcome: RollOutcome; onDone: () => void; onAgain: (n: 1 | 10) => void; coins: number }) {
  const n = outcome.results.length;
  const [flipped, setFlipped] = useState(0);
  const best = outcome.results.reduce((b, r) => Math.max(b, rarityRank(r.rarity)), 0);

  // Lật lần lượt từng thẻ; bấm "Lật hết" để xem ngay.
  useEffect(() => {
    if (flipped >= n) return;
    const t = setTimeout(() => setFlipped((f) => f + 1), flipped === 0 ? 450 : 260);
    return () => clearTimeout(t);
  }, [flipped, n]);

  const done = flipped >= n;
  return (
    <div className={`reveal best-${SKIN_RARITIES[best]}`} onClick={() => !done && setFlipped(n)}>
      {best === 3 && <div className="legend-burst" aria-hidden />}
      <div className={`reveal-cards n${n}`}>
        {outcome.results.map((r, i) => {
          const def = SKIN.get(r.skinId);
          return (
            <div key={i} className={`flip-card ${r.rarity}${i < flipped ? " flipped" : ""}`} style={rarityVar(r.rarity)}>
              <div className="flip-inner">
                <div className="flip-back">
                  <span>?</span>
                </div>
                <div className="flip-front">
                  {r.rarity === "legendary" && <div className="card-rays" aria-hidden />}
                  <SkinSwatch skin={def} size="md" />
                  <div className="card-name">{def?.name ?? r.skinId}</div>
                  <div className="card-meta">
                    <span className="card-rarity">{RARITY[r.rarity].name}</span>
                    <span>{def?.weapon ? weaponName(def.weapon) : "Mọi súng"}</span>
                  </div>
                  {r.isNew ? <span className="card-new">MỚI</span> : <span className="card-dupe">x{r.count}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="reveal-actions" onClick={(e) => e.stopPropagation()}>
        {!done ? (
          <button onClick={() => setFlipped(n)}>Lật hết</button>
        ) : (
          <>
            <button onClick={onDone}>Xong</button>
            <button className="primary" disabled={coins < (n === 10 ? GACHA.cost10 : GACHA.cost1)} onClick={() => onAgain(n === 10 ? 10 : 1)}>
              <Sparkles size={16} aria-hidden /> Quay {n} lần nữa
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- kho súng

function InventoryTab({ skins, equipped, onError }: { skins: { skinId: string; count: number }[]; equipped: Record<string, string>; onError: (e: string | null) => void }) {
  const [weapon, setWeapon] = useState<string>(SKIN_WEAPON_IDS[4] ?? SKIN_WEAPON_IDS[0]!);
  const [pending, setPending] = useState(false);
  const counts = useMemo(() => new Map(skins.map((s) => [s.skinId, s.count])), [skins]);

  // Skin hợp khẩu đang chọn: có rồi lên trước, hiếm lên trước.
  const fitting = useMemo(
    () =>
      SKINS.filter((s) => skinFitsWeapon(s.id, weapon)).sort(
        (a, b) => Number(counts.has(b.id)) - Number(counts.has(a.id)) || rarityRank(b.rarity) - rarityRank(a.rarity) || Number(!!b.weapon) - Number(!!a.weapon),
      ),
    [weapon, counts],
  );

  async function equip(skinId: string) {
    setPending(true);
    onError(null);
    try {
      await equipSkin(weapon, skinId);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const current = equipped[weapon] ?? "";
  const ownedFitting = fitting.filter((s) => counts.has(s.id)).length;

  return (
    <div className="gacha-inventory">
      <nav className="weapon-list" aria-label="Chọn súng">
        {SKIN_WEAPON_IDS.map((w) => (
          <button key={w} className={w === weapon ? "active" : ""} onClick={() => setWeapon(w)}>
            <SkinSwatch skin={equipped[w]} size="sm" />
            <span>{weaponName(w)}</span>
          </button>
        ))}
      </nav>
      <section className="skin-grid-wrap">
        <div className="skin-grid-head">
          <h3>{weaponName(weapon)}</h3>
          <span>
            Có {ownedFitting}/{fitting.length} skin lắp được
          </span>
        </div>
        <div className="skin-grid">
          <button className={`skin-tile default${current === "" ? " equipped" : ""}`} disabled={pending} onClick={() => void equip("")}>
            <div className="skin-swatch md default-look" aria-hidden />
            <div className="tile-name">Mặc định</div>
            {current === "" && (
              <span className="tile-equipped">
                <Check size={12} /> Đang dùng
              </span>
            )}
          </button>
          {fitting.map((s) => (
            <SkinTile key={s.id} skin={s} count={counts.get(s.id) ?? 0} equipped={current === s.id} disabled={pending} onEquip={() => void equip(s.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SkinTile({ skin, count, equipped, disabled, onEquip }: { skin: SkinDef; count: number; equipped: boolean; disabled: boolean; onEquip: () => void }) {
  const owned = count > 0;
  return (
    <button className={`skin-tile ${skin.rarity}${owned ? "" : " locked"}${equipped ? " equipped" : ""}`} style={rarityVar(skin.rarity)} disabled={disabled || !owned || equipped} onClick={onEquip} title={owned ? "Lắp skin này" : "Chưa có"}>
      <SkinSwatch skin={skin} size="md" />
      <div className="tile-name">{skin.name}</div>
      <div className="tile-meta">
        <span className="tile-rarity">{RARITY[skin.rarity].name}</span>
        {skin.weapon && <span className="tile-exclusive">Riêng</span>}
        {count > 1 && <span className="tile-count">x{count}</span>}
      </div>
      {!owned && (
        <span className="tile-lock">
          <Lock size={14} />
        </span>
      )}
      {equipped && (
        <span className="tile-equipped">
          <Check size={12} /> Đang dùng
        </span>
      )}
    </button>
  );
}
