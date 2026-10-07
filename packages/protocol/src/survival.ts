// Tin nhắn riêng của chế độ sinh tồn (đảo 10 ngày): núi lửa leo thang. Thủy triều và dòng dung nham không cần tin
// nhắn (mọi máy tự suy ra từ đồng hồ pha và mức núi lửa trong state); động đất, bom nham thạch là chuyện thoáng qua
// nên server báo bằng tin nhắn.

export const SurvivalMessages = {
  /**
   * Server báo mọi người: động đất, bom nham thạch bay lên, bom rơi xuống thành hố lửa (VolcanoMessage).
   * Client gửi lên (không kèm gì) khi vừa dựng cảnh để xin lại bom đang bay, hố lửa còn cháy.
   */
  volcano: "volcano",
} as const;

export type VolcanoMessage =
  /** Một đợt động đất dài `duration` giây, mạnh `strength` (0–1). */
  | { kind: "quake"; duration: number; strength: number }
  /** Bom nham thạch vừa phóng khỏi miệng núi, sẽ rơi xuống (x, y, z) sau `flight` giây. */
  | { kind: "bomb"; id: string; x: number; y: number; z: number; flight: number }
  /** Bom đã rơi: nổ, để lại hố lửa cháy `seconds` giây. */
  | { kind: "land"; id: string; x: number; y: number; z: number; seconds: number };
