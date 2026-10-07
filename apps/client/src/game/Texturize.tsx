import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useProfile } from "./graphics.ts";
import { detailScene, installDetailHook, setDetailEnabled } from "./textures.ts";
import { compileNew } from "./shaderPrep.ts";

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
    // 1,5 giây thay vì 0,5: `detailScene` duyệt toàn bộ cây cảnh (hàng nghìn vật thể) mỗi lần,
    // và thường không có gì mới xuất hiện giữa hai lần quét sát nhau.
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 1.5;
    detailScene(scene);
    compileNew(gl, scene, camera);
  });
  return null;
}
