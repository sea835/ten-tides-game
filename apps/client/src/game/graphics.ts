import { useSyncExternalStore } from "react";

// Cài đặt đồ hoạ, nhớ theo trình duyệt. Ba mức chất lượng:
// - "high": hậu kỳ đủ (bóng tối ở khe, quầng sáng, khử răng cưa), bóng đổ nét, cỏ dày, ánh sáng lấy từ bầu trời.
// - "medium": bỏ bóng tối ở khe (AO), bóng đổ cập nhật thưa hơn, cỏ thưa hơn.
// - "low": cho máy yếu, không hậu kỳ, không vân chất liệu, không thảm cỏ, bóng đổ nhẹ.
// Kèm giới hạn khung hình (mặc định 60, đỡ nóng máy và ồn quạt), độ phân giải vẽ tối đa, và tự hạ độ phân giải khi
// máy không theo kịp. Phím P đổi mức chất lượng, F3 bật bảng số liệu hiệu năng.

export type Quality = "high" | "medium" | "low";

export interface GraphicsSettings {
  quality: Quality;
  /** Số khung hình tối đa mỗi giây (0 là không giới hạn, theo tần số màn hình). */
  fpsCap: number;
  /** Tỉ lệ điểm ảnh tối đa khi vẽ (0 là tự chọn theo mức chất lượng). Màn Retina là 2, vẽ đủ thì nặng gấp bốn lần 1. */
  maxDpr: number;
  /** Tự hạ độ phân giải khi số khung hình tụt dưới mức giới hạn, nâng lại khi máy rảnh. */
  adaptive: boolean;
}

/** Thông số dựng hình theo mức chất lượng. */
export interface Profile {
  /** Tỉ lệ điểm ảnh tối đa mặc định. */
  dpr: number;
  shadowMap: number;
  /** Nửa cạnh vùng có bóng đổ quanh người chơi (mét). */
  shadowExtent: number;
  /** Số lần vẽ lại bóng đổ mỗi giây (0 là mỗi khung hình). */
  shadowHz: number;
  shadowRadius: number;
  /** Hậu kỳ: "full" có AO, "lite" chỉ quầng sáng, tone map và khử răng cưa, "none" không có. */
  post: "full" | "lite" | "none";
  /** Số lá cỏ của thảm cỏ quanh camera (0 là không có thảm cỏ). */
  grass: number;
  /** Mật độ bụi cây, cỏ khóm rải sẵn (1 là đủ). */
  vegetation: number;
  /** Nhân tầm vẽ của cây cỏ (1 là đủ): cụm ở xa hơn thì ẩn. */
  drawDistance: number;
  /** Ánh sáng môi trường lấy từ bầu trời. */
  ibl: boolean;
  /** Vân chất liệu phủ lên mọi vật. */
  detail: boolean;
  /** Số ô lưới mỗi cạnh của mặt biển (đỉnh dồn về gần camera; 180 ô ≈ 65 nghìn tam giác, trước đây 300–360). */
  water: number;
  /**
   * Mặt nước phản chiếu người, xe, lửa nổ (vẽ lại cảnh nhìn từ dưới mặt nước): tỉ lệ độ phân giải so với màn hình,
   * 0 là tắt (chỉ phản chiếu bầu trời tính trong shader).
   */
  reflect: number;
  rain: number;
  snow: number;
}

export const PROFILES: Record<Quality, Profile> = {
  high: { dpr: 1.35, shadowMap: 2048, shadowExtent: 55, shadowHz: 0, shadowRadius: 4, post: "full", grass: 100000, vegetation: 1, drawDistance: 1, ibl: true, detail: true, water: 180, reflect: 0.5, rain: 1600, snow: 2400 },
  medium: { dpr: 1, shadowMap: 2048, shadowExtent: 45, shadowHz: 30, shadowRadius: 3, post: "lite", grass: 50000, vegetation: 0.65, drawDistance: 0.8, ibl: true, detail: true, water: 160, reflect: 0, rain: 1000, snow: 1500 },
  low: { dpr: 0.85, shadowMap: 1024, shadowExtent: 35, shadowHz: 20, shadowRadius: 1, post: "none", grass: 0, vegetation: 0.35, drawDistance: 0.65, ibl: false, detail: false, water: 120, reflect: 0, rain: 600, snow: 900 },
};

export const QUALITY_LABEL: Record<Quality, string> = { high: "Cao", medium: "Trung bình", low: "Thấp" };
const ORDER: Quality[] = ["high", "medium", "low"];

const KEY = "tentides.graphics";
const OLD_KEY = "tentides.quality";

function guessQuality(): Quality {
  // Máy ít nhân hoặc màn hình cảm ứng (thường là điện thoại) thì chạy nhẹ. Còn lại mặc định Trung bình: đo trên
  // M5 Pro, mức Cao giữ 60 khung hình vẫn bắt GPU làm gần hết sức (nóng, quạt kêu), Trung bình chỉ còn khoảng nửa.
  const cores = navigator.hardwareConcurrency ?? 8;
  if (cores <= 4 || matchMedia("(pointer: coarse)").matches) return "low";
  return "medium";
}

export const DEFAULT_GRAPHICS: GraphicsSettings = { quality: "medium", fpsCap: 60, maxDpr: 0, adaptive: true };

function load(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...DEFAULT_GRAPHICS, ...JSON.parse(raw) } as GraphicsSettings;
      if (ORDER.includes(saved.quality)) return saved;
    }
    // Bản cũ chỉ lưu mức chất lượng.
    const old = localStorage.getItem(OLD_KEY);
    if (old === "high" || old === "low") return { ...DEFAULT_GRAPHICS, quality: old };
  } catch {
    // Không đọc được thì đoán theo máy.
  }
  return { ...DEFAULT_GRAPHICS, quality: guessQuality() };
}

let current: GraphicsSettings = load();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getGraphics(): GraphicsSettings {
  return current;
}

export function setGraphics(patch: Partial<GraphicsSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Không lưu được thì chỉ đổi trong lần chơi này.
  }
  emit();
}

export function setQuality(next: Quality) {
  if (next !== current.quality) setGraphics({ quality: next });
}

/** Phím P: Cao → Trung bình → Thấp → Cao. */
export function cycleQuality() {
  setQuality(ORDER[(ORDER.indexOf(current.quality) + 1) % ORDER.length]!);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useGraphics(): GraphicsSettings {
  return useSyncExternalStore(subscribe, () => current);
}

export function useQuality(): Quality {
  return useSyncExternalStore(subscribe, () => current.quality);
}

export function useProfile(): Profile {
  return PROFILES[useQuality()];
}

/** Tỉ lệ điểm ảnh tối đa đang dùng (theo cài đặt hoặc theo mức chất lượng), không vượt quá màn hình thật. */
export function targetDpr(g: GraphicsSettings): number {
  const cap = g.maxDpr > 0 ? g.maxDpr : PROFILES[g.quality].dpr;
  return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap));
}

/**
 * Gợi ý cho vòng lặp vẽ: `idle` (phòng đang tạm dừng, cảnh gần như đứng yên) hay `covered` (cảnh bị nền sảnh 3D che
 * kín, vd. Trung tâm chỉ huy) thì vẽ thưa lại.
 */
export const renderHints = { idle: false, covered: false };

// ---------------------------------------------------------------------------- số liệu hiệu năng (F3)

/** Số liệu đo mỗi nửa giây, bảng F3 đọc. */
export const perfStats = {
  fps: 0,
  /** Thời gian trung bình giữa hai khung hình (ms). */
  frameMs: 0,
  /** Khung hình chậm nhất trong nửa giây vừa qua (ms). */
  worstMs: 0,
  /** Thời gian chạy logic và gửi lệnh vẽ của một khung hình trên CPU (ms). */
  cpuMs: 0,
  calls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  dpr: 1,
  /** Hệ số độ phân giải của chế độ tự thích ứng (1 là đủ). */
  scale: 1,
};

let statsOpen = false;
const statsListeners = new Set<() => void>();

export function toggleStats() {
  statsOpen = !statsOpen;
  statsListeners.forEach((l) => l());
}

export function useStatsOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      statsListeners.add(l);
      return () => {
        statsListeners.delete(l);
      };
    },
    () => statsOpen,
  );
}
