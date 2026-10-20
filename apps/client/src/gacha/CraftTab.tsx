import { useMemo, useState, type CSSProperties } from "react";
import { Check, Hexagon } from "lucide-react";
import { RARITY, SHARDS, SKINS, SKIN_RARITIES, WEAPON, craftCost, rarityRank, type SkinDef, type SkinRarity } from "@tentides/content";
import { ApiError, craftSkin } from "../account/account.ts";
import { SkinSwatch } from "./SkinSwatch.tsx";

// Đổi mảnh: skin trùng ra mảnh (Thường 5, Hiếm 15, Sử thi 50, Huyền thoại 150), dùng mảnh đổi thẳng một skin chưa có
// (Thường 40, Hiếm 120, Sử thi 400, Huyền thoại 1.200). Server trừ mảnh và thêm skin trong một transaction.

const weaponName = (id: string) => WEAPON.get(id)?.name ?? id.toUpperCase();
const rarityVar = (r: SkinRarity) => ({ "--rarity": RARITY[r].color }) as CSSProperties;

export function CraftTab({ skins, shards, onError }: { skins: { skinId: string; count: number }[]; shards: number; onError: (e: string | null) => void }) {
  const [filter, setFilter] = useState<SkinRarity | "all">("all");
  const [pick, setPick] = useState<SkinDef | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const owned = useMemo(() => new Set(skins.filter((s) => s.count > 0).map((s) => s.skinId)), [skins]);
  const list = useMemo(
    () =>
      SKINS.filter((s) => filter === "all" || s.rarity === filter).sort(
        (a, b) => Number(owned.has(a.id)) - Number(owned.has(b.id)) || rarityRank(b.rarity) - rarityRank(a.rarity) || (a.name < b.name ? -1 : 1),
      ),
    [filter, owned],
  );

  async function craft(skin: SkinDef) {
    setBusy(true);
    onError(null);
    try {
      await craftSkin(skin.id);
      setDone(skin.name);
      setPick(null);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const cost = pick ? (craftCost(pick.id) ?? 0) : 0;
  return (
    <div className="gacha-craft">
      <div className="craft-head">
        <p>
          Skin trùng ra mảnh: {SKIN_RARITIES.map((r) => `${RARITY[r].name} ${SHARDS.dupe[r]}`).join(" · ")}. Đổi một skin chưa có: {SKIN_RARITIES.map((r) => `${RARITY[r].name} ${SHARDS.craft[r].toLocaleString("vi-VN")}`).join(" · ")} mảnh.
        </p>
        <div className="craft-filter" role="tablist" aria-label="Lọc độ hiếm">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Tất cả
          </button>
          {SKIN_RARITIES.slice()
            .reverse()
            .map((r) => (
              <button key={r} className={filter === r ? "active" : ""} style={rarityVar(r)} onClick={() => setFilter(r)}>
                {RARITY[r].name}
              </button>
            ))}
        </div>
      </div>
      {done && <p className="saved-note">Đã đổi được {done}.</p>}
      <div className="skin-grid">
        {list.map((s) => {
          const have = owned.has(s.id);
          const c = SHARDS.craft[s.rarity];
          const can = !have && shards >= c;
          return (
            <button
              key={s.id}
              className={`skin-tile ${s.rarity}${have ? " equipped" : ""}${pick?.id === s.id ? " picked" : ""}`}
              data-ui="clack"
              style={rarityVar(s.rarity)}
              disabled={have || busy}
              onClick={() => setPick(s)}
              title={have ? "Đã có" : can ? "Đổi bằng mảnh" : `Cần ${c} mảnh`}
            >
              <SkinSwatch skin={s} size="md" />
              <div className="tile-name">{s.name}</div>
              <div className="tile-meta">
                <span className="tile-rarity">{RARITY[s.rarity].name}</span>
                {s.weapon && <span className="tile-exclusive">{weaponName(s.weapon)}</span>}
              </div>
              {have ? (
                <span className="tile-equipped">
                  <Check size={12} /> Đã có
                </span>
              ) : (
                <span className={`tile-cost${can ? "" : " short"}`}>
                  <Hexagon size={12} aria-hidden /> {c.toLocaleString("vi-VN")}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {pick && (
        <div className="craft-confirm" role="dialog" aria-label="Xác nhận đổi mảnh">
          <SkinSwatch skin={pick} size="md" />
          <div className="craft-confirm-text">
            <strong>{pick.name}</strong>
            <span>
              Tốn {cost.toLocaleString("vi-VN")} mảnh, bạn có {shards.toLocaleString("vi-VN")}.
              {shards < cost && ` Còn thiếu ${(cost - shards).toLocaleString("vi-VN")}.`}
            </span>
          </div>
          <button onClick={() => setPick(null)}>Huỷ</button>
          <button className="primary" disabled={busy || shards < cost} onClick={() => void craft(pick)}>
            <Hexagon size={15} aria-hidden /> Đổi
          </button>
        </div>
      )}
    </div>
  );
}
