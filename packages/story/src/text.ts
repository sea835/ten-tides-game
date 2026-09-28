// Ghép câu: chọn biến thể theo seed rồi điền chỗ trống {tên}. Mỗi lời kể dùng một luồng random riêng,
// suy ra từ seed của ván + loại lời kể + ngày + người, nên kể lại bao nhiêu lần cũng ra cùng một câu.

import { nextFloat, seedFromString, type RngState } from "@tentides/rules";

export class Voice {
  private rng: RngState;

  constructor(seed: number, ...scope: (string | number)[]) {
    this.rng = seedFromString(`${seed}:${scope.join(":")}`);
  }

  float(): number {
    const r = nextFloat(this.rng);
    this.rng = r.rng;
    return r.value;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Voice.pick() cần danh sách không rỗng");
    return items[Math.floor(this.float() * items.length)]!;
  }

  chance(p: number): boolean {
    return this.float() < p;
  }
}

/** Điền {tên} bằng giá trị; chỗ nào thiếu giá trị thì báo lỗi, để không bao giờ lọt "{name}" ra màn hình. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Mẫu câu thiếu giá trị cho {${key}}: "${template}"`);
    return String(vars[key]);
  });
}

/** Viết hoa chữ cái đầu mỗi câu, kể cả câu bắt đầu bằng một chỗ trống vừa được điền (tên riêng giữ nguyên). */
export function capitalize(text: string): string {
  const first = text.charAt(0).toLocaleUpperCase("vi") + text.slice(1);
  return first.replace(/([.!?]\s+)(\p{Ll})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase("vi"));
}

/** Nối tên kiểu tiếng Việt: "An", "An và Bình", "An, Bình và Chi". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} và ${names.at(-1)}`;
}

/** Viết thường chữ cái đầu, để chèn một câu hoàn chỉnh vào giữa câu khác. */
export function uncapitalize(text: string): string {
  return text.charAt(0).toLocaleLowerCase("vi") + text.slice(1);
}
