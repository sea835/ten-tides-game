import { WATER_LEVEL, battleMap, boxAt, type BoxMat, type World } from "@tentides/content";

// Đạn găm vào cái gì: tra khối công trình chứa điểm trúng (lùi vào trong mặt một chút theo pháp tuyến), không có
// thì là địa hình (đất, đường nhựa, đá...), nước, hay thân cây. Dùng để chọn lỗ đạn, bụi / tia lửa và tiếng găm.

export type HitSurface = "concrete" | "metal" | "wood" | "dirt" | "water" | "flesh";

const BY_MAT: Record<BoxMat, HitSurface> = {
  concrete: "concrete",
  plaster: "concrete",
  brick: "concrete",
  stone: "concrete",
  road: "concrete",
  roof: "concrete",
  metal: "metal",
  container: "metal",
  hull: "metal",
  rust: "metal",
  fence: "metal",
  sign: "metal",
  wood: "wood",
  sandbag: "dirt",
};

export function surfaceAt(world: World, x: number, y: number, z: number, nx: number, ny: number, nz: number): HitSurface {
  if (y < WATER_LEVEL + 0.05) return "water";
  const map = battleMap(world.seed || 1);
  const box = boxAt(map.index, x - nx * 0.05, y - ny * 0.05, z - nz * 0.05, 0.02);
  if (box) return BY_MAT[box.mat];
  const ground = world.heightAt(x, z);
  // Cao hẳn trên mặt đất mà không trúng khối nào: thân cây (hay đá tảng, coi như gỗ cho nhẹ).
  if (y > ground + 0.4) return "wood";
  const g = world.surface(x, z).ground;
  return g === "asphalt" || g === "concrete" || g === "stone" ? "concrete" : "dirt";
}

/**
 * Tia vật lý cho các thành phần nằm ngoài <Physics> (hiệu ứng phát bắn của người khác, nhân vật người khác):
 * Shooter (ở trong Physics) gắn hàm vào đây. Bỏ qua thân của mình.
 */
export const physicsProbe: {
  cast: ((ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => { t: number; nx: number; ny: number; nz: number } | null) | null;
} = { cast: null };
