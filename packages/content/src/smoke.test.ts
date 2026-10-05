import { describe, expect, it } from "vitest";
import { SMOKE, SMOKE_CLEAR, SMOKE_SIGHT } from "./battleItems.ts";

describe("khối khói che tầm nhìn", () => {
  it("vòm khói nhô khỏi mặt đất và nằm gọn trong bán kính khói toả", () => {
    // Tâm quả cầu nhích lên khỏi đất ít hơn bán kính: phần nổi trên đất là một vòm (bán cầu cụt).
    expect(SMOKE_SIGHT.lift).toBeGreaterThan(0);
    expect(SMOKE_SIGHT.lift).toBeLessThan(SMOKE_SIGHT.radius);
    // Mép vòm trên mặt đất không vượt quá vùng khói billboard toả ra.
    const groundRadius = Math.sqrt(SMOKE_SIGHT.radius ** 2 - SMOKE_SIGHT.lift ** 2);
    expect(groundRadius).toBeLessThanOrEqual(SMOKE.radius);
    // Lựu đạn thổi thủng được một khoảng đáng kể của khối khói.
    expect(SMOKE_CLEAR.radius).toBeGreaterThan(SMOKE_SIGHT.radius * 0.5);
  });
});
