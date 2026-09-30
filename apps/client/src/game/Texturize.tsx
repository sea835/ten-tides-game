import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useProfile } from "./graphics.ts";
import { detailScene, setDetailEnabled } from "./textures.ts";

/** Quét cảnh hai lần mỗi giây để vật mới xuất hiện (thú, đồ rơi, nhà mới dựng...) cũng được phủ vân. */
export function Texturize() {
  const next = useRef(0);
  const detail = useProfile().detail;
  // Đồ hoạ thấp thì tắt vân cho nhẹ máy (vật liệu vẫn vá sẵn, bật lại là có ngay).
  useEffect(() => setDetailEnabled(detail), [detail]);
  useFrame(({ scene, clock }) => {
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.5;
    detailScene(scene);
  });
  return null;
}
