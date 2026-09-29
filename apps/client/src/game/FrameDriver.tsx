import { useEffect, useRef, useState } from "react";
import { advance, useStore, useThree } from "@react-three/fiber";
import { getGraphics, perfStats, renderHints, targetDpr, useGraphics, useStatsOpen } from "./graphics.ts";

// Vòng lặp vẽ tự quản (Canvas đặt frameloop="never"): vẽ tối đa `fpsCap` khung hình mỗi giây thay vì theo tần số
// màn hình (màn 120 Hz thì GPU làm gấp đôi mà mắt khó thấy khác, máy nóng, quạt rú). Cửa sổ không được chọn (đang
// xem cửa sổ khác) hay phòng đang tạm dừng thì hạ còn 20 khung hình. Chế độ tự thích ứng hạ độ phân giải vẽ khi không theo kịp giới hạn và
// nâng lại khi máy rảnh. Đo số liệu cho bảng F3.

/** Không bao giờ vẽ mờ hơn mức này (điểm ảnh vẽ trên mỗi điểm ảnh CSS). */
const MIN_DPR = 0.75;
/** Số khung hình khi cửa sổ không được chọn. */
const BACKGROUND_FPS = 20;

export function FrameDriver() {
  const store = useStore();
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const g = useGraphics();

  // Độ phân giải: theo cài đặt, nhân hệ số tự thích ứng.
  const [scale, setScaleState] = useState(1);
  const scaleRef = useRef(1);
  const setScale = (v: number) => {
    scaleRef.current = v;
    setScaleState(v);
  };
  useEffect(() => {
    const apply = () => {
      const dpr = Math.max(MIN_DPR, targetDpr(getGraphics()) * scale);
      perfStats.dpr = dpr;
      perfStats.scale = scale;
      setDpr(dpr);
    };
    apply();
    // Kéo cửa sổ sang màn hình khác thì tỉ lệ điểm ảnh của màn hình đổi.
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [g.quality, g.maxDpr, scale, setDpr]);
  // Đổi cài đặt đồ hoạ thì bắt đầu lại từ độ phân giải đủ.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setScale(1), [g.quality, g.maxDpr, g.adaptive]);

  useEffect(() => {
    // Tự đếm lệnh vẽ của cả khung hình (hậu kỳ vẽ nhiều lượt, để tự reset thì chỉ còn số của lượt cuối).
    gl.info.autoReset = false;
    let focused = document.hasFocus();
    const onFocus = () => (focused = true);
    const onBlur = () => (focused = false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    let raf = 0;
    let base = -1;
    let last = -Infinity;
    // Số liệu gom trong từng nửa giây.
    let windowStart = 0;
    let frames = 0;
    let worst = 0;
    let cpu = 0;
    let prevFrame = 0;
    // Tự thích ứng: đếm số lần đo liên tiếp chậm / dư sức.
    let slow = 0;
    let spare = 0;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const settings = getGraphics();
      const cap = focused && !renderHints.idle ? settings.fpsCap : Math.min(settings.fpsCap || BACKGROUND_FPS, BACKGROUND_FPS);
      if (cap > 0) {
        const interval = 1000 / cap;
        const elapsed = t - last;
        // Dung sai 10%: màn 60 Hz lệch nhịp vài phần mười ms vẫn vẽ đủ 60, màn 120 Hz thì vẽ cách một khung.
        if (elapsed < interval * 0.9) return;
        last = elapsed > interval * 2 ? t : last + interval;
      }
      if (base < 0) {
        base = t;
        windowStart = t;
        prevFrame = t;
      }
      gl.info.reset();
      const c0 = performance.now();
      advance((t - base) / 1000, true, store.getState());
      cpu += performance.now() - c0;
      frames++;
      worst = Math.max(worst, t - prevFrame);
      prevFrame = t;

      const span = t - windowStart;
      if (span < 500) return;
      const fps = (frames * 1000) / span;
      perfStats.fps = fps;
      perfStats.frameMs = span / frames;
      perfStats.worstMs = worst;
      perfStats.cpuMs = cpu / frames;
      perfStats.calls = gl.info.render.calls;
      perfStats.triangles = gl.info.render.triangles;
      perfStats.geometries = gl.info.memory.geometries;
      perfStats.textures = gl.info.memory.textures;
      perfStats.programs = gl.info.programs?.length ?? 0;

      if (settings.adaptive && focused && !renderHints.idle && document.visibilityState === "visible") {
        const goal = cap > 0 ? cap : 60;
        // Chậm vì CPU (logic, React) thì hạ độ phân giải cũng vô ích.
        const gpuBound = perfStats.cpuMs < (1000 / goal) * 0.6;
        if (fps < goal * 0.8 && gpuBound) {
          spare = 0;
          if (++slow >= 3 && scaleRef.current > 0.6) {
            slow = 0;
            setScale(Math.round((scaleRef.current - 0.1) * 100) / 100);
          }
        } else if (fps >= goal * 0.95) {
          slow = 0;
          if (++spare >= 10 && scaleRef.current < 1) {
            spare = 0;
            setScale(Math.min(1, Math.round((scaleRef.current + 0.1) * 100) / 100));
          }
        } else {
          slow = 0;
          spare = 0;
        }
      }
      windowStart = t;
      frames = 0;
      worst = 0;
      cpu = 0;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      gl.info.autoReset = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, store]);

  return null;
}

/** Bảng số liệu hiệu năng góc màn hình (F3). */
export function PerfOverlay() {
  const open = useStatsOpen();
  const g = useGraphics();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [open]);
  if (!open) return null;
  const s = perfStats;
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  return (
    <div className="perf-overlay">
      <b>{s.fps.toFixed(0)} FPS</b> <span>/ {g.fpsCap || "∞"}</span>
      <div>khung {s.frameMs.toFixed(1)} ms · chậm nhất {s.worstMs.toFixed(0)} ms</div>
      <div>CPU {s.cpuMs.toFixed(1)} ms/khung</div>
      <div>
        {fmt(s.calls)} lệnh vẽ · {fmt(s.triangles)} tam giác
      </div>
      <div>
        độ phân giải {s.dpr.toFixed(2)}x{s.scale < 1 ? ` (tự hạ ${Math.round(s.scale * 100)}%)` : ""}
      </div>
      <div>
        {s.geometries} hình · {s.textures} ảnh · {s.programs} shader
      </div>
    </div>
  );
}
