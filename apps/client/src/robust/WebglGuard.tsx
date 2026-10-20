import { useEffect, useState, useSyncExternalStore } from "react";
import { useThree } from "@react-three/fiber";
import { renderHints } from "../game/graphics.ts";
import "./robust.css";

// Mất ngữ cảnh WebGL (driver card đồ hoạ reset, tab nền bị trình duyệt thu hồi GPU, quá nhiều tab 3D): canvas đen và
// game đứng. WebglGuard (gắn trong <Canvas>) bắt `webglcontextlost` / `webglcontextrestored`: chặn mặc định để trình
// duyệt được phép khôi phục, ngưng vẽ, báo cho WebglOverlay (ngoài canvas) hiện lớp phủ. three.js và R3F tự dựng
// lại tài nguyên GPU khi được khôi phục; quá lâu không khôi phục được thì lớp phủ mời tải lại trang.

let lost: { since: number } | null = null;
const listeners = new Set<() => void>();

function setLost(v: { since: number } | null) {
  lost = v;
  listeners.forEach((l) => l());
}

function useLost() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lost,
  );
}

/** Gắn trong <Canvas>: theo dõi mất / lấy lại ngữ cảnh WebGL của canvas. */
export function WebglGuard() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event) => {
      // Không chặn thì trình duyệt không bao giờ khôi phục.
      e.preventDefault();
      console.warn("[webgl] mất ngữ cảnh WebGL, chờ khôi phục");
      renderHints.covered = true;
      setLost({ since: Date.now() });
    };
    const onRestored = () => {
      console.warn("[webgl] đã khôi phục ngữ cảnh WebGL");
      renderHints.covered = false;
      // Bản đồ bóng đổ vẽ lại từ đầu sau khi dựng lại tài nguyên.
      gl.shadowMap.needsUpdate = true;
      setLost(null);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (lost) renderHints.covered = false;
      setLost(null);
    };
  }, [gl]);
  return null;
}

/** Sau chừng này giây chưa khôi phục thì nhấn mạnh nút tải lại. */
const GIVE_UP_S = 8;

/** Lớp phủ khi mất ngữ cảnh WebGL. Gắn cạnh <Game>, ngoài canvas. */
export function WebglOverlay({ onLeave }: { onLeave?: () => void }) {
  const state = useLost();
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!state) {
      setWaited(0);
      return;
    }
    const t = window.setInterval(() => setWaited(Math.floor((Date.now() - state.since) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [state]);
  if (!state) return null;
  const stuck = waited >= GIVE_UP_S;
  return (
    <div className="crash overlay" role="alert">
      <div className="crash-card">
        <div className="spinner" aria-hidden />
        <h1>Mất kết nối với card đồ hoạ</h1>
        <p>
          {stuck
            ? "Trình duyệt chưa khôi phục được đồ hoạ 3D. Hãy tải lại trang; vào lại bằng mã phòng sẽ chơi tiếp đúng nhân vật cũ."
            : "Hình ảnh tạm dừng. Đang thử khôi phục đồ hoạ… (đóng bớt tab 3D khác hoặc cập nhật driver nếu hay gặp)"}
        </p>
        <div className="crash-actions">
          <button className={stuck ? "primary big" : "big"} onClick={() => location.reload()}>
            Tải lại trang
          </button>
          {onLeave && (
            <button className="big" onClick={onLeave}>
              Về sảnh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
