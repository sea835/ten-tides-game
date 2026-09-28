// Mũi tên chỉ đường: bảng nhiệm vụ (DOM) chọn nhóm đích, vòng lặp 3D chọn đích gần nhất trong nhóm,
// chiếu lên màn hình rồi ghi thẳng vào phần tử mũi tên (không qua React, khỏi render lại mỗi khung hình).

export interface GuideTarget {
  x: number;
  y: number;
  z: number;
  label: string;
  /** Màu mũi tên: vàng (sự kiện), đỏ (kho báu), cam (về trại). */
  tone: "event" | "treasure" | "camp";
}

export const guide: { targets: GuideTarget[]; el: HTMLDivElement | null } = { targets: [], el: null };
