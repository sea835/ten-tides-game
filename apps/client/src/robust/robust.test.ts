import { describe, expect, it } from "vitest";
import { controlDef, richParts } from "../game/controlsMap.ts";
import { isBenign, isRepeated, pushError, REPEAT_COUNT, REPEAT_WINDOW_MS } from "./errorHooks.ts";
import { loadProgress, tipAt, tipsFor } from "./loading.ts";

describe("lỗi lặp lại", () => {
  it("chỉ báo khi đủ số lỗi trong cửa sổ thời gian", () => {
    let times: number[] = [];
    times = pushError(times, 1000);
    times = pushError(times, 2000);
    expect(isRepeated(times)).toBe(false);
    times = pushError(times, 3000);
    expect(times).toHaveLength(REPEAT_COUNT);
    expect(isRepeated(times)).toBe(true);
  });

  it("lỗi cũ rơi khỏi cửa sổ", () => {
    let times: number[] = [];
    times = pushError(times, 0);
    times = pushError(times, 1000);
    times = pushError(times, 1000 + REPEAT_WINDOW_MS + 5);
    expect(isRepeated(times)).toBe(false);
    expect(times).toHaveLength(1);
  });

  it("bỏ qua lỗi vô hại của trình duyệt", () => {
    expect(isBenign("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isBenign("Cannot read properties of undefined")).toBe(false);
  });
});

describe("màn tải", () => {
  it("tiến độ tăng dần, không vượt 85% khi chưa tải xong, đầy khi xong", () => {
    let prev = -1;
    for (const ms of [0, 500, 2000, 5000, 20000, 120000]) {
      const p = loadProgress(ms, false);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(0.85);
      prev = p;
    }
    expect(loadProgress(100, true)).toBe(1);
  });

  it("mẹo theo chế độ và xoay vòng", () => {
    expect(tipsFor("naval").some((t) => t.includes("Hải Chiến"))).toBe(true);
    expect(tipsFor("solo").some((t) => t.includes("Hải Chiến"))).toBe(false);
    expect(tipsFor(null).length).toBeGreaterThan(tipsFor("war").length - 1);
    const n = tipsFor("war").length;
    expect(tipAt("war", 0)).toBe(tipAt("war", n));
    expect(tipAt("war", -1)).toBe(tipAt("war", n - 1));
  });

  it("mọi mẹo hiện đủ phím (không còn chỗ chèn {…} chưa thay)", () => {
    for (const mode of [null, "solo", "squad", "war", "naval"] as const)
      for (const tip of tipsFor(mode)) {
        expect(tip, tip).not.toMatch(/\{[A-Za-z0-9]+\}/);
        expect(tip.length).toBeGreaterThan(20);
      }
    // Bảng phím có đủ mọi id mà mẹo dùng (richText bỏ nguyên chữ nếu không có id, test trên bắt được).
    expect(richParts("{reload}").every((p) => "control" in p && !!controlDef(p.control))).toBe(true);
  });
});
