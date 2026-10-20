import { GraduationCap, Keyboard, Settings as Gear } from "lucide-react";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ControlsScreen } from "./ControlsScreen.tsx";
import { openMenu, requestTutorial, setMenu, useMenu } from "./menuStore.ts";
import "./menu.css";

// Nút Cài đặt / Phím điều khiển cho chỗ ngoài trận: sảnh chính và Trung tâm chỉ huy. Bảng mở ra là cùng một
// SettingsPanel / ControlsScreen dùng trong trận; trong trận bảng do SettingsButton dựng, nên ở Trung tâm chỉ huy
// (nằm trong HUD trận) chỉ cần các nút, ở sảnh chính thêm MenuPanels để dựng bảng.

export function MenuButtons({ tutorial = false }: { tutorial?: boolean }) {
  const menu = useMenu();
  return (
    <div className="menu-buttons">
      <button className="ghost" onClick={() => openMenu("settings")} title="Cài đặt: chuột, âm thanh, đồ hoạ, dễ nhìn">
        <Gear size={15} aria-hidden /> Cài đặt
      </button>
      <button className="ghost" onClick={() => openMenu("controls")}>
        <Keyboard size={15} aria-hidden /> Phím điều khiển
      </button>
      {tutorial && menu.mode && (
        <button className="ghost" onClick={requestTutorial} title="Bài hướng dẫn chạy khi trận bắt đầu">
          <GraduationCap size={15} aria-hidden /> Hướng dẫn
        </button>
      )}
    </div>
  );
}

/** Dựng bảng cài đặt, phím điều khiển ở sảnh chính (trong trận do SettingsButton dựng). */
export function MenuPanels() {
  const menu = useMenu();
  return (
    <>
      {menu.settings && (
        <div className="menu-layer dim" onMouseDown={(e) => e.target === e.currentTarget && setMenu({ settings: false })}>
          <SettingsPanel open onClose={() => setMenu({ settings: false })} />
        </div>
      )}
      {menu.controls && <ControlsScreen mode={menu.mode} onClose={() => setMenu({ controls: false })} />}
    </>
  );
}
