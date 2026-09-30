import { Color } from "three";
import { mulberry32 } from "../nature.ts";
import { BEARDS, HAIR_STYLES, type Beard, type HairStyle } from "./head.ts";
import type { Top } from "./shapes.ts";

// Diện mạo mỗi người: chọn cố định theo màu người chơi (máy nào cũng thấy giống nhau), đủ khác nhau để nhận ra.

/** Tông da từ sáng tới sẫm. */
const SKIN = ["#f2d1b3", "#e6b791", "#d29f76", "#b98158", "#95603e", "#6b4129"];
/** Màu tóc: đen, nâu các độ, vàng, hung đỏ, muối tiêu. */
const HAIR = ["#16110d", "#2b1e15", "#47301f", "#6b4529", "#a37a4c", "#c7a36c", "#86401f", "#77716b"];
/** Màu mắt: nâu sẫm, nâu, nâu lục, xanh xám. */
const EYES = ["#2a1a10", "#4a2f19", "#56603a", "#4d6a82"];

export interface Look {
  skin: string;
  hair: string;
  eyes: string;
  hairStyle: HairStyle;
  beard: Beard;
  /** Kiểu lông mày (chỉ số trong face().brows). */
  brow: number;
  /** Quần dân thường: màu áo pha nâu kaki cho giống vải thật. */
  pants: string;
  /** Áo lính: áo chiến đấu xắn tay hoặc áo khoác cổ đứng. */
  top: Top;
  /** Đồ đeo lưng của lính: 0 không có, 1 túi đeo lưng, 2 bộ đàm, 3 túi nước. */
  pack: 0 | 1 | 2 | 3;
}

/**
 * Tám màu người chơi có sẵn diện mạo chọn tay cho thật khác nhau (tông da trải đều từ sáng tới sẫm, đủ kiểu tóc râu):
 * [da, tóc, mắt, kiểu tóc, râu, lông mày, áo lính, đồ đeo lưng]. Màu khác thì chọn theo băm màu.
 */
const PRESET: Record<string, [number, number, number, HairStyle, Beard, number, Top, 0 | 1 | 2 | 3]> = {
  "#e4572e": [1, 0, 1, "crew", "mustache", 0, "combat", 1],
  "#29335c": [4, 0, 0, "buzz", "full", 2, "jacket", 2],
  "#f3a712": [2, 3, 2, "quiff", "goatee", 1, "combat", 0],
  "#669bbc": [0, 6, 3, "tied", "none", 1, "jacket", 3],
  "#8a4fff": [3, 1, 1, "curly", "stubble", 0, "combat", 2],
  "#2a9d8f": [1, 5, 3, "crew", "stubble", 2, "jacket", 1],
  "#d1495b": [5, 0, 0, "shaved", "full", 0, "combat", 3],
  "#6a994e": [2, 7, 2, "quiff", "full", 1, "jacket", 0],
};

const cache = new Map<string, Look>();

export function looks(color: string): Look {
  let l = cache.get(color);
  if (l) return l;
  const preset = PRESET[color.toLowerCase()];
  const pantsOf = (c: string) => new Color(c).multiplyScalar(0.4).lerp(new Color("#5c5040"), 0.45).getStyle();
  if (preset) {
    const [sk, h, e, hairStyle, beard, brow, top, pack] = preset;
    l = { skin: SKIN[sk]!, hair: HAIR[h]!, eyes: EYES[e]!, hairStyle, beard, brow, pants: pantsOf(color), top, pack };
    cache.set(color, l);
    return l;
  }
  const n = [...color].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rand = mulberry32(n);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length) % list.length]!;
  const skinIdx = Math.floor(rand() * SKIN.length);
  // Da sẫm thì tóc sẫm, mắt nâu; da sáng thì màu nào cũng được.
  const hair = skinIdx >= 3 ? HAIR[Math.floor(rand() * 3)]! : pick(HAIR);
  const eyes = skinIdx >= 3 ? EYES[Math.floor(rand() * 2)]! : pick(EYES);
  const hairStyle = pick(HAIR_STYLES);
  // Tóc buộc thì ít khi để râu.
  const beard = hairStyle === "tied" ? "none" : pick([...BEARDS, "none", "stubble"] as const);
  const pants = pantsOf(color);
  l = {
    skin: SKIN[skinIdx]!,
    hair,
    eyes,
    hairStyle,
    beard,
    brow: Math.floor(rand() * 3),
    pants,
    top: rand() < 0.55 ? "combat" : "jacket",
    pack: Math.floor(rand() * 4) as 0 | 1 | 2 | 3,
  };
  cache.set(color, l);
  return l;
}
