import { useEffect, useSyncExternalStore } from "react";
import { GraduationCap, Keyboard, Settings as Gear, X } from "lucide-react";
import { DEFAULT_SETTINGS, setSettings, useSettings, type Settings } from "../settings.ts";
import { DEFAULT_GRAPHICS, QUALITY_LABEL, setGraphics, toggleStats, useGraphics, useStatsOpen, type Quality } from "../graphics.ts";
import { DEFAULT_VOLUME, audio, type VolumeKey } from "../sound/engine.ts";
import { VoiceSettingsSection } from "../voice/VoiceChat.tsx";
import { setBattleHud } from "../battle/runtime.ts";
import { HUD_SCALE_MAX, HUD_SCALE_MIN } from "../a11y.ts";
import { ControlsScreen } from "./ControlsScreen.tsx";
import { getMenu, openMenu, requestTutorial, setMenu, useMenu } from "./menuStore.ts";
import "./menu.css";

// Bảng cài đặt: chuột, dễ nhìn (cỡ HUD, màu phe, giảm rung), âm thanh, giọng nói, đồ hoạ. Mở trong trận bằng phím O
// hay nút bánh răng (SettingsButton), ở sảnh và Trung tâm chỉ huy bằng nút Cài đặt (MenuButtons). Có lối sang màn
// Phím điều khiển và mở lại bài hướng dẫn của chế độ đang chơi.

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

type SliderKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

function Slider({ label, k, min, max, step, fmt }: { label: string; k: SliderKey; min: number; max: number; step: number; fmt: (v: number) => string }) {
  const s = useSettings();
  return (
    <label className="b-set-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={s[k]} onChange={(e) => setSettings({ [k]: Number(e.target.value) })} />
      <em>{fmt(s[k])}</em>
    </label>
  );
}

const pct = (v: number) => (v === 0 ? "Tắt" : `${Math.round(v * 100)}%`);

/** Dễ nhìn: cỡ HUD, màu phe cho người mù màu, giảm rung camera (a11y.ts, teamColors.ts, shared.ts). */
function AccessibilitySettings() {
  const s = useSettings();
  return (
    <>
      <div className="b-set-title">Dễ nhìn</div>
      <Slider label="Cỡ giao diện trận (HUD)" k="hudScale" min={HUD_SCALE_MIN} max={HUD_SCALE_MAX} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
      <label className="b-set-check">
        <input type="checkbox" checked={s.colorblind} onChange={(e) => setSettings({ colorblind: e.target.checked })} /> Màu phe cho người mù màu (xanh dương / cam thay cho xanh / đỏ)
      </label>
      <label className="b-set-check">
        <input type="checkbox" checked={s.reduceShake} onChange={(e) => setSettings({ reduceShake: e.target.checked })} /> Giảm rung camera (nổ, trúng đòn, bắn pháo)
      </label>
    </>
  );
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const menu = useMenu();
  if (!open) return null;
  return (
    <div className="b-settings" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Cài đặt">
      <header>
        <Gear size={18} /> Cài đặt
        <button className="x" onClick={onClose} aria-label="Đóng">
          <X size={18} />
        </button>
      </header>
      <div className="b-set-links">
        <button className="ghost" onClick={() => openMenu("controls")}>
          <Keyboard size={15} aria-hidden /> Phím điều khiển
        </button>
        {menu.mode && (
          <button className="ghost" onClick={requestTutorial} title="Chạy lại bài hướng dẫn của chế độ đang chơi">
            <GraduationCap size={15} aria-hidden /> Hướng dẫn
          </button>
        )}
      </div>
      <Slider label="Độ nhạy chuột" k="sensitivity" min={0.1} max={3} step={0.05} fmt={(v) => v.toFixed(2)} />
      <Slider label="Độ nhạy khi ngắm" k="adsSensitivity" min={0.1} max={2} step={0.05} fmt={(v) => v.toFixed(2)} />
      <Slider label="Độ nhạy ống ngắm" k="scopeSensitivity" min={0.1} max={2} step={0.05} fmt={(v) => v.toFixed(2)} />
      <Slider label="Góc nhìn (FOV)" k="fov" min={55} max={100} step={1} fmt={(v) => `${v}°`} />
      <Slider label="Làm mượt camera" k="smoothing" min={0} max={1} step={0.05} fmt={pct} />
      <Slider label="Nhún camera khi đi" k="headBob" min={0} max={1} step={0.05} fmt={pct} />
      <label className="b-set-check">
        <input type="checkbox" checked={s.invertY} onChange={(e) => setSettings({ invertY: e.target.checked })} /> Đảo trục dọc chuột
      </label>
      <label className="b-set-check">
        <input type="checkbox" checked={s.toggleAim} onChange={(e) => setSettings({ toggleAim: e.target.checked })} /> Bấm chuột phải một lần để ngắm (không cần giữ)
      </label>
      <AccessibilitySettings />
      <SoundSettings />
      <VoiceSettingsSection />
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

/** Nút bánh răng trong trận (và phím O): mở / đóng bảng cài đặt; màn Phím điều khiển mở từ bảng này. */
export function SettingsButton() {
  const menu = useMenu();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyO" && !(e.target instanceof HTMLInputElement)) {
        setMenu({ settings: !getMenu().settings });
        document.exitPointerLock?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Bảng nào đang mở thì nhân vật thôi nhận phím, chuột (menuOpen trong battle/runtime.ts).
  const open = menu.settings || menu.controls;
  useEffect(() => setBattleHud({ settingsOpen: open }), [open]);
  // Rời trận: đóng bảng, khỏi mở sẵn ở sảnh.
  useEffect(() => () => setMenu({ settings: false, controls: false }), []);
  return (
    <>
      <button className="b-gear-btn" onClick={() => setMenu({ settings: !menu.settings })} title="Cài đặt (O)">
        <Gear size={18} />
      </button>
      <SettingsPanel open={menu.settings} onClose={() => setMenu({ settings: false })} />
      {menu.controls && <ControlsScreen mode={menu.mode} onClose={() => setMenu({ controls: false })} />}
    </>
  );
}
