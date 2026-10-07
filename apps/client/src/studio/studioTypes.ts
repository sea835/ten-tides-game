// Kiểu dữ liệu dùng chung giữa phần vỏ sảnh 3D (StudioBackdrop, nạp ngay cùng sảnh) và sân khấu 3D (StudioStage, nạp
// lười). Tách riêng để vỏ không phải nhập file sân khấu (kéo theo three, nhân vật).

/** Bối cảnh: phòng chỉ huy tác chiến hay bãi biển lúc hoàng hôn. */
export type StudioSet = "command" | "beach";

/** Ngoại hình nhân vật đứng trên bục. */
export interface StudioLook {
  color: string;
  outfit: string;
  armor: number;
  helmet: number;
  weapon: string;
  sight: string;
  atts: string;
  skin: string;
}

/** Góc xoay nhân vật do người chơi kéo chuột (ghi ở vỏ, sân khấu đọc mỗi khung hình). */
export interface StudioSpin {
  yaw: number;
  /** Vận tốc góc (rad/s) lúc thả tay, để xoay theo quán tính. */
  vel: number;
  dragging: boolean;
  /** Lần chạm cuối (performance.now()): lâu không chạm thì tự về góc nghỉ. */
  touched: number;
  /**
   * Nhân vật đứng ở đâu trên màn hình (−1 mép trái … 1 mép phải): vỏ đo chỗ trống bên trái bảng giao diện rồi ghi
   * vào đây, sân khấu dời khung camera theo.
   */
  focus: number;
}
