import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Box3, PMREMGenerator, Vector3, type Group } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Check, RotateCcw, Save, X } from "lucide-react";
import {
  EMPTY_LOADOUT,
  GUNSMITH_WEAPON_IDS,
  LOADOUT_SLOTS,
  LOADOUT_SLOT_NAME,
  RARITY,
  SKINS,
  WEAPON,
  loadoutAtts,
  loadoutItemName,
  loadoutOptions,
  rarityRank,
  skinFitsWeapon,
  withAttachments,
  type LoadoutSlot,
  type WeaponLoadout,
} from "@tentides/content";
import { ApiError, refreshProfile, saveLoadout, useAccount } from "../account/account.ts";
import { GunModel } from "../game/GunModel.tsx";
import { pulseNeon } from "../game/skinMaterials.ts";
import { SkinSwatch } from "../gacha/SkinSwatch.tsx";
import "../gacha/gacha.css";
import "./gunsmith.css";

// Gunsmith 3D ở sảnh: xoay mô hình súng 360° (kéo chuột, cuộn để phóng to), lắp phụ kiện từng ô (đầu nòng, tay cầm,
// băng đạn, báng, kính ngắm) và chọn skin đã có. Lưu bộ lắp ráp theo từng khẩu vào tài khoản; skin chọn ở đây là
// skin ưa thích của khẩu đó, tự lắp lên súng trong trận. Khách xem thử được nhưng không lưu.

const weaponName = (id: string) => WEAPON.get(id)?.name ?? id.toUpperCase();

/** Đặt tâm khung bao của súng về gốc toạ độ (để xoay quanh giữa súng), tính lại khi đổi súng hay phụ kiện. */
function Centered({ deps, children }: { deps: string; children: ReactNode }) {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    i.position.set(0, 0, 0);
    i.updateMatrixWorld(true);
    const box = new Box3().setFromObject(i);
    if (box.isEmpty()) return;
    const c = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    i.position.set(-c.x, -c.y, -c.z);
    // Súng dài ngắn khác nhau: thu phóng cho vừa khung (dài chừng 1 m).
    o.scale.setScalar(1 / Math.max(0.35, Math.max(size.x, size.y, size.z)));
  }, [deps]);
  return (
    <group ref={outer}>
      <group ref={inner}>{children}</group>
    </group>
  );
}

/** Ánh sáng phòng chụp (môi trường phản chiếu cho kim loại, vàng, chrome), không cần file HDR. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Nhịp sáng skin neon. */
function NeonPulse() {
  useFrame(({ clock }) => pulseNeon(clock.elapsedTime));
  return null;
}

function GunStage({ weaponId, loadout, skin }: { weaponId: string; loadout: WeaponLoadout; skin: string }) {
  const atts = loadoutAtts(loadout);
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [1.15, 0.35, 0.9], fov: 35, near: 0.02, far: 20 }} gl={{ antialias: true, alpha: true }}>
      <hemisphereLight args={["#dfefff", "#2a2016", 0.55]} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2, 1, -1.5]} intensity={0.6} color="#9fc6ff" />
      <StudioEnvironment />
      <NeonPulse />
      <Suspense fallback={null}>
        <Centered deps={`${weaponId}|${atts}|${loadout.sight}`}>
          <group rotation={[0, Math.PI / 2, 0]}>
            <GunModel weaponId={weaponId} sight={loadout.sight} atts={atts} skin={skin} />
          </group>
        </Centered>
      </Suspense>
      <OrbitControls makeDefault enablePan={false} minDistance={0.7} maxDistance={2.6} autoRotate autoRotateSpeed={0.9} target={[0, 0, 0]} />
    </Canvas>
  );
}

/** Số liệu của khẩu súng sau khi lắp phụ kiện, so với súng trơn. */
function StatsPanel({ weaponId, loadout }: { weaponId: string; loadout: WeaponLoadout }) {
  const def = WEAPON.get(weaponId);
  if (!def) return null;
  const w = withAttachments(def, loadoutAtts(loadout));
  const pct = (x: number) => `${x < 1 ? "−" : "+"}${Math.round(Math.abs(1 - x) * 100)}%`;
  const rows: [string, string, boolean][] = [
    ["Băng đạn", `${w.mag} viên`, w.mag > def.mag],
    ["Thay đạn", `${w.reload.toFixed(2)} s`, w.reload < def.reload],
    ["Giật dọc", w.recoilV === 1 ? "—" : pct(w.recoilV), w.recoilV < 1],
    ["Giật ngang", w.recoilH === 1 ? "—" : pct(w.recoilH), w.recoilH < 1],
    ["Giảm thanh", w.suppressed ? "Có" : "Không", w.suppressed],
  ];
  return (
    <dl className="gs-stats">
      {rows.map(([k, v, good]) => (
        <div key={k} className={good ? "good" : ""}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GunsmithScreen({ initialWeapon, onClose }: { initialWeapon?: string; onClose: () => void }) {
  const account = useAccount();
  const profile = account.status === "user" ? account.profile : null;
  const [weapon, setWeapon] = useState(() => (initialWeapon && GUNSMITH_WEAPON_IDS.includes(initialWeapon) ? initialWeapon : (GUNSMITH_WEAPON_IDS[4] ?? GUNSMITH_WEAPON_IDS[0]!)));
  /** Bản nháp theo khẩu (chưa lưu). */
  const [drafts, setDrafts] = useState<Record<string, { loadout: WeaponLoadout; skin: string }>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (account.status === "user") void refreshProfile();
    // Chỉ nạp lại một lần lúc mở.
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const savedLoadout: WeaponLoadout = { ...EMPTY_LOADOUT, ...(profile?.loadouts?.[weapon] ?? {}) };
  const savedSkin = profile?.equipped[weapon] ?? "";
  const draft = drafts[weapon] ?? { loadout: savedLoadout, skin: savedSkin };
  const dirty = LOADOUT_SLOTS.some((s) => draft.loadout[s] !== savedLoadout[s]) || draft.skin !== savedSkin;

  const counts = useMemo(() => new Map((profile?.skins ?? []).map((s) => [s.skinId, s.count])), [profile]);
  const skins = useMemo(
    () => SKINS.filter((s) => counts.has(s.id) && skinFitsWeapon(s.id, weapon)).sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || Number(!!b.weapon) - Number(!!a.weapon)),
    [counts, weapon],
  );

  const update = (next: Partial<{ loadout: WeaponLoadout; skin: string }>) => {
    setNote(null);
    setDrafts((d) => ({ ...d, [weapon]: { ...draft, ...next } }));
  };
  const setSlot = (slot: LoadoutSlot, id: string) => update({ loadout: { ...draft.loadout, [slot]: id } });

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await saveLoadout(weapon, draft.loadout, draft.skin);
      setDrafts((d) => {
        const { [weapon]: _, ...rest } = d;
        return rest;
      });
      setNote({ ok: true, text: `Đã lưu bộ lắp ráp ${weaponName(weapon)}. Skin tự lắp lên súng ở trận sau.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gacha-screen gunsmith-screen" role="dialog" aria-modal aria-label="Gunsmith">
      <div className="gacha-shell gunsmith-shell">
        <header className="gacha-top">
          <h2>Gunsmith</h2>
          <span className="gs-sub">Kéo để xoay 360°, cuộn để phóng to</span>
          <button className="ghost gacha-close" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>
        <div className="gs-body">
          <nav className="weapon-list gs-weapons" aria-label="Chọn súng">
            {GUNSMITH_WEAPON_IDS.map((w) => (
              <button key={w} className={w === weapon ? "active" : ""} onClick={() => setWeapon(w)}>
                <SkinSwatch skin={drafts[w]?.skin ?? profile?.equipped[w]} size="sm" />
                <span>{weaponName(w)}</span>
                {drafts[w] && <i className="gs-dot" title="Chưa lưu" />}
              </button>
            ))}
          </nav>
          <section className="gs-stage">
            <GunStage weaponId={weapon} loadout={draft.loadout} skin={draft.skin} />
            <div className="gs-stage-title">
              <b>{weaponName(weapon)}</b>
              <span>{WEAPON.get(weapon)?.class.toUpperCase()}</span>
            </div>
            <StatsPanel weaponId={weapon} loadout={draft.loadout} />
          </section>
          <aside className="gs-parts">
            {LOADOUT_SLOTS.map((slot) => {
              const opts = loadoutOptions(weapon, slot);
              return (
                <div key={slot} className="gs-slot">
                  <div className="gs-slot-name">
                    {LOADOUT_SLOT_NAME[slot]}
                    <span>{loadoutItemName(slot, draft.loadout[slot])}</span>
                  </div>
                  {opts.length === 0 ? (
                    <p className="gs-none">Khẩu này không lắp được</p>
                  ) : (
                    <div className="gs-options">
                      <button className={draft.loadout[slot] === "" ? "on" : ""} onClick={() => setSlot(slot, "")}>
                        Trống
                      </button>
                      {opts.map((id) => (
                        <button key={id} className={draft.loadout[slot] === id ? "on" : ""} onClick={() => setSlot(slot, id)}>
                          {loadoutItemName(slot, id)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="gs-slot">
              <div className="gs-slot-name">
                Skin <span>{SKINS.find((s) => s.id === draft.skin)?.name ?? "Mặc định"}</span>
              </div>
              <div className="gs-skins">
                <button className={`gs-skin${draft.skin === "" ? " on" : ""}`} onClick={() => update({ skin: "" })} title="Mặc định">
                  <div className="skin-swatch sm default-look" aria-hidden />
                </button>
                {skins.map((s) => (
                  <button key={s.id} className={`gs-skin${draft.skin === s.id ? " on" : ""}`} style={{ "--rarity": RARITY[s.rarity].color } as CSSProperties} onClick={() => update({ skin: s.id })} title={`${s.name} · ${RARITY[s.rarity].name}`}>
                    <SkinSwatch skin={s} size="sm" />
                  </button>
                ))}
              </div>
              {!profile ? <p className="gs-none">Đăng nhập để dùng skin từ Gacha.</p> : skins.length === 0 && <p className="gs-none">Chưa có skin nào hợp khẩu này. Quay Gacha để có.</p>}
            </div>
            <div className="gs-actions">
              <button className="ghost" disabled={!dirty || busy} onClick={() => update({ loadout: savedLoadout, skin: savedSkin })} title="Bỏ thay đổi">
                <RotateCcw size={15} /> Hoàn tác
              </button>
              <button className="primary" disabled={!profile || !dirty || busy} onClick={() => void save()}>
                {dirty ? <Save size={15} /> : <Check size={15} />} {profile ? (dirty ? "Lưu bộ lắp ráp" : "Đã lưu") : "Đăng nhập để lưu"}
              </button>
            </div>
            {note && <p className={note.ok ? "gs-note ok" : "error"}>{note.text}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
