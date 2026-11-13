import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { freezeWorld } from "./world.ts";

/**
 * Nhánh đứng yên vĩnh viễn (vật va chạm cố định, công trình...): ma trận tính một lần lúc dựng rồi vòng cập nhật mỗi
 * khung hình không duyệt vào nữa (gpu/world.ts). Đổi `stamp` khi nội dung bên trong đổi để tính lại một lần.
 */
export function Frozen({ children, stamp }: { children: ReactNode; stamp?: unknown }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => (ref.current ? freezeWorld(ref.current) : undefined), [stamp]);
  return <group ref={ref}>{children}</group>;
}
