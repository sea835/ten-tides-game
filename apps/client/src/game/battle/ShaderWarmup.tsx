import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

// Biên dịch sẵn shader của mọi vật liệu đang có trong cảnh (kể cả vật đang ẩn: hiệu ứng súng, đồ rơi, xe...) ngay khi
// vào bản đồ và lúc trận bắt đầu, bằng compileAsync (trình duyệt dịch song song, không chặn khung hình). Trước đây
// shader chỉ được dịch lần đầu vật xuất hiện trên màn hình: phát bắn, vụ nổ, người mới lọt vào tầm nhìn đầu tiên
// làm khung hình khựng lại vài chục đến vài trăm ms ("giật lag" giữa trận).

export function ShaderWarmup({ room }: { room: IslandRoom }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const phase = useRoomSnapshot(room, (s) => s.phase);
  useEffect(() => {
    let alive = true;
    // Chờ cảnh dựng xong (cây cỏ, công trình, nhân vật) rồi mới dịch.
    const timers = [1200, 4000].map((ms) =>
      window.setTimeout(() => {
        if (!alive) return;
        gl.compileAsync(scene, camera).catch(() => {});
      }, ms),
    );
    return () => {
      alive = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [gl, scene, camera, phase]);
  return null;
}
