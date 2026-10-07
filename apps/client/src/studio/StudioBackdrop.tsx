import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { RadioTower, TreePalm } from "lucide-react";
import { renderHints, useQuality } from "../game/graphics.ts";
import { StageBoundary, decor3d } from "./webgl.tsx";
import type { StudioLook, StudioSet, StudioSpin } from "./studioTypes.ts";
import "./studio.css";

// Nền sảnh chờ 3D: vỏ nhẹ nạp cùng sảnh (kéo xoay, nút đổi bối cảnh, chi tiết HUD), sân khấu 3D (StudioStage: three,
// nhân vật) nạp lười thành chunk riêng. Máy yếu (đồ hoạ Thấp) hay trình duyệt không có WebGL: nền tĩnh dải màu.

const StudioStage = lazy(() => import("./StudioStage.tsx"));

const SET_KEY = "tentides.studioSet";

function loadSet(fallback: StudioSet): StudioSet {
  try {
    const v = localStorage.getItem(SET_KEY);
    if (v === "command" || v === "beach") return v;
  } catch {
    // Không đọc được thì dùng mặc định của màn.
  }
  return fallback;
}

/** Chỗ trống bên trái bảng giao diện hẹp hơn chừng này (px) thì nhân vật đứng giữa, sau lớp kính mờ. */
const MIN_FREE = 260;

/**
 * `avoid`: bảng giao diện chính; màn hình rộng thì nhân vật đứng giữa khoảng trống bên trái bảng.
 * `coversGame`: nền che kín cảnh trận phía sau (Trung tâm chỉ huy), báo vòng vẽ của trận vẽ thưa lại cho đỡ nặng.
 */
export function StudioBackdrop({ look, defaultSet, avoid, coversGame = false, label }: { look: StudioLook; defaultSet: StudioSet; avoid?: RefObject<HTMLElement | null>; coversGame?: boolean; label?: string }) {
  const quality = useQuality();
  const [set, setSet] = useState<StudioSet>(() => loadSet(defaultSet));
  const live = decor3d(quality);
  const spin = useRef<StudioSpin>({ yaw: 0.55, vel: 0, dragging: false, touched: 0, focus: 0 }).current;
  const drag = useRef({ id: -1, x: 0, t: 0 });

  // Đo chỗ trống bên trái bảng giao diện mỗi khi cửa sổ hay bảng đổi cỡ.
  useEffect(() => {
    const el = avoid?.current;
    if (!el || !live) return;
    const measure = () => {
      const w = window.innerWidth;
      const left = el.getBoundingClientRect().left;
      spin.focus = left >= MIN_FREE ? left / w - 1 : 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [avoid, live, spin]);

  useEffect(() => {
    if (!coversGame || !live) return;
    renderHints.covered = true;
    return () => {
      renderHints.covered = false;
    };
  }, [coversGame, live]);

  const pick = (s: StudioSet) => {
    setSet(s);
    try {
      localStorage.setItem(SET_KEY, s);
    } catch {
      // Không lưu được thì chỉ đổi lần này.
    }
  };

  // Kéo ngang để xoay nhân vật; thả ra thì xoay tiếp theo quán tính.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag.current = { id: e.pointerId, x: e.clientX, t: performance.now() };
    spin.dragging = true;
    spin.vel = 0;
    spin.touched = performance.now();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!spin.dragging || e.pointerId !== d.id) return;
    const now = performance.now();
    const dx = e.clientX - d.x;
    const a = dx * 0.012;
    spin.yaw += a;
    spin.vel = (a / Math.max(8, now - d.t)) * 1000 * 0.6;
    spin.touched = now;
    d.x = e.clientX;
    d.t = now;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== drag.current.id) return;
    spin.dragging = false;
    spin.touched = performance.now();
    drag.current.id = -1;
    // Giữ yên một lúc rồi mới thả: không văng.
    if (performance.now() - drag.current.t > 120) spin.vel = 0;
  };

  const still = <div className={`studio-still set-${set}`} aria-hidden />;
  return (
    <div className={`studio set-${set} ${live ? "live" : "still"}`} onPointerDown={live ? onDown : undefined} onPointerMove={live ? onMove : undefined} onPointerUp={onUp} onPointerCancel={onUp}>
      {still}
      {live && (
        <StageBoundary fallback={null}>
          <Suspense fallback={null}>
            <div className="studio-canvas">
              <StudioStage look={look} set={set} spin={spin} />
            </div>
          </Suspense>
        </StageBoundary>
      )}
      <div className="studio-hud" aria-hidden>
        <span className="hud-corner tl">
          {set === "command" ? "CMD-07 · 10°47′N 106°42′E" : "BEACH-03 · 10°20′N 107°05′E"}
        </span>
        <span className="hud-corner br">{live ? "LIVE · 3D" : "STILL"}</span>
      </div>
      {live && (
        <div className="studio-tools">
          <span className="studio-hint">{label ?? "Kéo để xoay 360°"}</span>
          <button className={set === "command" ? "on" : ""} onClick={() => pick("command")} title="Phòng chỉ huy" aria-pressed={set === "command"}>
            <RadioTower size={15} aria-hidden />
          </button>
          <button className={set === "beach" ? "on" : ""} onClick={() => pick("beach")} title="Bãi biển hoàng hôn" aria-pressed={set === "beach"}>
            <TreePalm size={15} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
