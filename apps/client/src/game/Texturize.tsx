import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useProfile } from "./graphics.ts";
import { installDetailHook, setDetailEnabled } from "./textures.ts";
import { scanScene } from "./shaderPrep.ts";

/**
 * Phủ vân cho cảnh: vật mới được vá ngay trước lần vẽ đầu (installDetailHook), cộng một lần quét định kỳ cho vật đổi
 * vật liệu giữa chừng. Lần quét đó cũng dịch sẵn (song song, không chặn khung hình) shader của vật vừa xuất hiện mà
 * chưa lọt vào tầm nhìn: lúc nó hiện ra không phải dừng hình chờ dịch.
 */
export function Texturize() {
  const next = useRef(0);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const detail = useProfile().detail;
  // Đồ hoạ thấp thì tắt vân cho nhẹ máy (vật liệu vẫn vá sẵn, bật lại là có ngay).
  useEffect(() => setDetailEnabled(detail), [detail]);
  useEffect(() => installDetailHook(scene), [scene]);
  useFrame(({ scene, camera, clock }) => {
    // 4 giây một lượt: vật mới đã được vá ngay trước lần vẽ đầu (installDetailHook), lượt quét này chỉ còn bắt vật đổi
    // vật liệu giữa chừng và dịch sẵn shader cho vật chưa lọt vào tầm nhìn; mỗi lượt duyệt cả cây cảnh (vài nghìn vật).
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 4;
    scanScene(gl, scene, camera);
  });
  return null;
}
