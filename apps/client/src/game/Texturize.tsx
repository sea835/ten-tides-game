import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useQuality } from "./graphics.ts";
import { detailScene, setDetailEnabled } from "./textures.ts";

/** Quét cảnh định kỳ để vật mới xuất hiện (thú, đồ rơi, nhà mới dựng...) cũng được phủ vân. */
export function Texturize() {
  const next = useRef(0);
  const quality = useQuality();
  // Đồ hoạ thấp thì tắt vân cho nhẹ máy (vật liệu vẫn vá sẵn, bật lại là có ngay).
  useEffect(() => setDetailEnabled(quality !== "low"), [quality]);
  useFrame(({ scene, clock }) => {
    // 1,5 giây thay vì 0,5: `detailScene` duyệt toàn bộ cây cảnh (hàng nghìn vật thể) mỗi lần,
    // và thường không có gì mới xuất hiện giữa hai lần quét sát nhau.
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 1.5;
    detailScene(scene);
  });
  return null;
}
