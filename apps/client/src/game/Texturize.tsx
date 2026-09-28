import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useQuality } from "./graphics.ts";
import { detailScene, setDetailEnabled } from "./textures.ts";

/** Quét cảnh hai lần mỗi giây để vật mới xuất hiện (thú, đồ rơi, nhà mới dựng...) cũng được phủ vân. */
export function Texturize() {
  const next = useRef(0);
  const quality = useQuality();
  // Đồ hoạ thấp thì tắt vân cho nhẹ máy (vật liệu vẫn vá sẵn, bật lại là có ngay).
  useEffect(() => setDetailEnabled(quality === "high"), [quality]);
  useFrame(({ scene, clock }) => {
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.5;
    detailScene(scene);
  });
  return null;
}
