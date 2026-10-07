import { useEffect } from "react";
import { advance, useStore } from "@react-three/fiber";

// Vòng vẽ tiết kiệm cho các cảnh 3D trang trí (sân khấu sảnh chờ, bục vinh danh, Gunsmith). Canvas đặt
// frameloop="never", component này tự gọi vẽ tối đa `fps` khung hình mỗi giây. Để mặc định thì R3F vẽ theo tần số màn
// hình: màn 144–165 Hz (laptop chơi game Windows) là card phải vẽ nhân vật cả trăm lần mỗi giây chỉ để làm nền menu,
// cộng thêm trình duyệt làm mờ lại lớp kính phía trên mỗi lần. Có bảng phủ kín (Gacha, Gunsmith) thì dừng hẳn.

/**
 * `fps`: nhịp vẽ thường; `boost()` trả true khi người chơi đang tương tác (kéo xoay) thì vẽ `boostFps` cho mượt tay.
 * `paused`: không vẽ (vẫn giữ khung hình cuối trên màn).
 */
export function StageLoop({ fps = 30, boostFps = 60, boost, paused = false }: { fps?: number; boostFps?: number; boost?: () => boolean; paused?: boolean }) {
  const store = useStore();
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let base = -1;
    let last = -Infinity;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const interval = 1000 / (boost?.() ? boostFps : fps);
      // Dung sai nửa khung 60 Hz: màn 60 Hz vẽ đủ nhịp, màn tần số cao thì bỏ qua các khung thừa.
      if (t - last < interval - 8) return;
      last = t;
      // Nối tiếp đồng hồ cảnh sau khi tạm dừng (không để thời gian chạy lùi).
      if (base < 0) base = t - store.getState().clock.elapsedTime * 1000;
      advance((t - base) / 1000, true, store.getState());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [store, fps, boostFps, boost, paused]);
  return null;
}
