import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { expandShadows, prepareScene } from "../shaderPrep.ts";

// Biên dịch sẵn shader của mọi vật liệu đang có trong cảnh (kể cả vật đang ẩn: hiệu ứng súng, đồ rơi, xe...) ngay khi
// vào bản đồ và lúc trận bắt đầu, bằng compileAsync (trình duyệt dịch song song, không chặn khung hình). Trước đây
// shader chỉ được dịch lần đầu vật xuất hiện trên màn hình: phát bắn, vụ nổ, người mới lọt vào tầm nhìn đầu tiên
// làm khung hình khựng lại vài chục đến vài trăm ms ("giật lag" giữa trận). Vân chi tiết được vá trước khi dịch (nếu
// không, shader dịch sẵn là bản chưa vá, lúc vá xong lại phải dịch lại). Lần đầu dịch xong thì mở vùng bóng phủ cả
// bản đồ một khung để dịch luôn shader bóng đổ (shaderPrep.ts).

export function ShaderWarmup({ room }: { room: IslandRoom }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const phase = useRoomSnapshot(room, (s) => s.phase);
  // Bóng đổ: 0 chưa làm, 1 chờ mở vùng bóng, 2 đã mở (khôi phục ở khung sau), 3 xong.
  const shadows = useRef<{ step: number; restore: (() => void) | null }>({ step: 0, restore: null });
  useEffect(() => {
    let alive = true;
    // Chờ cảnh dựng xong (cây cỏ, công trình, nhân vật) rồi mới dịch.
    const timers = [1200, 4000].map((ms) =>
      window.setTimeout(() => {
        if (!alive) return;
        void prepareScene(gl, scene, camera).then(() => {
          if (alive && shadows.current.step === 0) shadows.current.step = 1;
        });
      }, ms),
    );
    return () => {
      alive = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [gl, scene, camera, phase]);
  useFrame(() => {
    const s = shadows.current;
    if (s.step === 1) {
      s.restore = expandShadows(gl, scene);
      s.step = s.restore ? 2 : 3;
    } else if (s.step === 2) {
      s.restore?.();
      s.restore = null;
      s.step = 3;
    }
  });
  useEffect(
    () => () => {
      shadows.current.restore?.();
    },
    [],
  );
  return null;
}
