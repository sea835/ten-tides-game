import { useEffect, useMemo, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { MODE_NAMES, controlsFor, groupsFor, keyChips, type BattleModeId, type KeyOverrides } from "../controlsMap.ts";
import { useVoiceSettings } from "../voice/voiceSettings.ts";
import "./menu.css";

// Màn "Phím điều khiển": toàn bộ phím chia theo nhóm, lọc theo chế độ (mở trong trận thì chọn sẵn chế độ đang chơi).
// Dựng từ bảng controlsMap.ts; phím nói chuyện lấy theo Cài đặt → Giọng nói.

const TABS: (BattleModeId | null)[] = [null, "war", "naval", "squad", "solo"];

export function ControlsScreen({ mode, onClose }: { mode: BattleModeId | null; onClose: () => void }) {
  const [tab, setTab] = useState<BattleModeId | null>(mode);
  const voice = useVoiceSettings();
  const overrides = useMemo<KeyOverrides>(() => ({ voicePtt: [voice.pttKey], voiceRadio: [voice.radioKey] }), [voice.pttKey, voice.radioKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      // Đóng màn phím trước, khỏi để Esc lọt xuống đóng cửa hàng, bản đồ...
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const groups = groupsFor(tab)
    .map((g) => ({ g, list: controlsFor(g.id, tab) }))
    .filter((x) => x.list.length > 0);
  return (
    <div className="menu-layer dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ctl-screen" role="dialog" aria-label="Phím điều khiển" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <Keyboard size={18} aria-hidden /> Phím điều khiển
          <button className="x" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>
        <nav className="ctl-tabs" aria-label="Lọc theo chế độ">
          {TABS.map((t) => (
            <button key={t ?? "all"} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t ? MODE_NAMES[t] : "Tất cả"}
            </button>
          ))}
        </nav>
        <div className="ctl-body">
          {groups.map(({ g, list }) => (
            <section key={g.id} className="ctl-group">
              <h4>{g.title}</h4>
              {list.map((c) => (
                <div key={c.id} className="ctl-row">
                  <span className="ctl-keys">
                    {c.how === "hold" && <i>giữ</i>}
                    {c.how === "double" && <i>bấm đúp</i>}
                    {keyChips(c.id, overrides).map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </span>
                  <span className="ctl-action">
                    {c.action}
                    {c.note && <small>{c.note}</small>}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer>Phím nói chuyện đổi được trong Cài đặt → Giọng nói. Esc để đóng.</footer>
      </div>
    </div>
  );
}
