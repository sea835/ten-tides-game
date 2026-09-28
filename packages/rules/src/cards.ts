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
  /** Chỉ nhặt được trên đảo, cửa hàng không bán. */
  loot?: boolean;
  /** Ăn, uống hoặc dùng ngay thì được gì (món đồ mất đi). `dizzy` là hiệu ứng thời gian thực, engine bỏ qua. */
  eat?: { hunger?: number; hp?: number; morale?: number; stamina?: number; dizzy?: number };
  /** Góp vào kho lương thực chung thì được chừng này khẩu phần. */
  ration?: number;
  /** Nướng trên lửa trại thì thành món này. */
  cook?: string;
}

/** Chuyện xảy ra trong đêm với người ngủ ngoài trại: một phép kiểm tra, hệ quả áp cho người đó (và cả đội với lương thực, kho báu). */
export interface OutsideEvent {
  id: string;
  title: string;
  /** Chỉ xảy ra khi thời tiết đêm đó là một trong số này. */
  weather?: WeatherId[];
  check: Check;
  onSuccess: Outcome;
  onFail: Outcome;
  successText: string;
  failText: string;
}
