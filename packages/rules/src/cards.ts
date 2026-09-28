import type { StatId, ZoneId } from "./stats.ts";
import type { WeatherId } from "./weather.ts";

// Kiểu dữ liệu của nội dung mà engine cần biết. Schema zod trong @tentides/content
// kiểm tra JSON rồi trả về đúng các kiểu này, nên rules không phụ thuộc vào content.

/** Thay đổi trạng thái khi một lựa chọn thành công hoặc thất bại. Không chứa lời văn. */
export interface Outcome {
  /** Áp cho mọi người tham gia sự kiện. */
  hp?: number;
  morale?: number;
  hunger?: number;
  stamina?: number;
  lostUntilDusk?: boolean;
  /** Áp cho người chọn. */
  loseRandomItem?: number;
  gainItem?: string;
  /** Áp cho cả đội. */
  food?: number;
  treasure?: number;
  hull?: number;
  setFlag?: string;
}

export interface Check {
  stat: StatId;
  dc: number;
  itemBonus?: Record<string, number>;
}

export interface CardChoice {
  id: string;
  label: string;
  check: Check;
  onSuccess: Outcome;
  onFail: Outcome;
  /** Lời văn mẫu, dùng khi AI lỗi hoặc chưa có AI. */
  successText: string;
  failText: string;
}

export interface EventCard {
  id: string;
  title: string;
  /** Lời văn mẫu mở đầu thẻ. */
  intro: string;
  acts: (1 | 2 | 3)[];
  anchorType: string;
  requires?: {
    zone?: ZoneId;
    weather?: WeatherId[];
    flags?: string[];
    notFlags?: string[];
  };
  choices: CardChoice[];
  sceneState?: { onAny: string };
  narrativeHooks: string[];
}

/** Một điểm sự kiện cố định trên map. Mỗi sáng engine đặt thẻ vào một số điểm. */
export interface AnchorDef {
  id: string;
  type: string;
  zone: ZoneId;
}

export interface ItemDef {
  id: string;
  name: string;
  /** Kích thước khối trên lưới balo (chưa xoay). */
  size: { w: number; h: number };
  weightKg: number;
  price: number;
  tags: string[];
}
