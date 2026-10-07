import { describe, expect, it } from "vitest";
import { HEAT_SHOTS, heatShot, newHeat, shimmerLevel, smokeRate } from "./barrelHeat.ts";
import { landKick, newInertia, springTo, updateInertia } from "./viewInertia.ts";
import { INSPECT_DUR, cancelsInspect, inspectPose, newPose } from "./viewInspect.ts";

describe("ngắm nghía vũ khí", () => {
  it("bắt đầu và kết thúc ở tư thế gốc, nghiêng trái ~45°", () => {
    const p = newPose();
    inspectPose(0, p);
    expect(p.px).toBe(0);
    expect(p.rz).toBe(0);
    inspectPose(INSPECT_DUR, p);
    expect(p.rz).toBe(0);
    expect(p.glint).toBe(0);
    inspectPose(0.45, p);
    expect(p.rz).toBeCloseTo(0.78, 2);
    expect(p.ry).toBeLessThan(0);
  });

  it("chuyển động liền mạch (không nhảy cóc giữa hai khung)", () => {
    const a = newPose();
    const b = newPose();
    for (let t = 0; t < INSPECT_DUR; t += 1 / 240) {
      inspectPose(t, a);
      inspectPose(t + 1 / 240, b);
      expect(Math.abs(a.rz - b.rz)).toBeLessThan(0.05);
      expect(Math.abs(a.ry - b.ry)).toBeLessThan(0.05);
      expect(Math.abs(a.px - b.px)).toBeLessThan(0.01);
      expect(Math.abs(a.hand - b.hand)).toBeLessThan(0.01);
    }
  });

  it("tay trái vuốt ốp lót tay, vệt sáng bật giữa động tác", () => {
    const p = newPose();
    inspectPose(1.82, p);
    expect(p.hand).toBeGreaterThan(0.08);
    inspectPose(1, p);
    expect(p.glint).toBeGreaterThan(0.9);
  });

  it("phím việc khác huỷ, phím I không bị F chiếm", () => {
    expect(cancelsInspect("KeyR")).toBe(true);
    expect(cancelsInspect("Digit2")).toBe(true);
    expect(cancelsInspect("ShiftLeft")).toBe(true);
    expect(cancelsInspect("KeyI")).toBe(false);
    expect(cancelsInspect("KeyW")).toBe(false);
  });
});

describe("quán tính súng", () => {
  /** Lia chuột 0,4 rad trong 0,1 s rồi dừng, chạy ở `fps`; trả về độ trễ ngang lớn nhất, còn lại sau 1 s và mẫu mỗi 1/30 s. */
  function flick(fps: number, aim = 0) {
    const s = newInertia();
    const dt = 1 / fps;
    let yaw = 0;
    let peak = 0;
    const samples: number[] = [];
    const flickFrames = Math.round(0.1 * fps);
    const per = Math.round(fps / 30);
    updateInertia(s, dt, 0, 0, 0, 0, 0, aim, false);
    for (let i = 0; i < Math.round(1.1 * fps); i++) {
      if (i < flickFrames) yaw += 4 * dt;
      updateInertia(s, dt, yaw, 0, 0, 0, 0, aim, false);
      peak = Math.max(peak, s.x);
      if ((i + 1) % per === 0) samples.push(s.x);
    }
    return { peak, end: s.x, roll: s.rz, samples };
  }

  it("lia trái thì súng trễ sang phải rồi về chỗ", () => {
    const r = flick(60);
    expect(r.peak).toBeGreaterThan(0.015);
    expect(Math.abs(r.end)).toBeLessThan(0.002);
  });

  it("giống nhau ở 30 và 240 khung hình/giây", () => {
    const a = flick(30);
    const b = flick(240);
    for (let i = 0; i < a.samples.length; i++) expect(Math.abs(a.samples[i]! - b.samples[i]!)).toBeLessThan(b.peak * 0.08);
  });

  it("đang ngắm thì gần như không lắc", () => {
    expect(flick(60, 1).peak).toBeLessThan(flick(60, 0).peak * 0.15);
  });

  it("đáp đất nặng nhún sâu hơn đáp nhẹ", () => {
    const dip = (power: number) => {
      const s = newInertia();
      landKick(s, power);
      let low = 0;
      for (let i = 0; i < 60; i++) {
        updateInertia(s, 1 / 60, 0, 0, 0, 0, 0, 0, false);
        low = Math.min(low, s.y);
      }
      return low;
    };
    expect(dip(1)).toBeLessThan(dip(0.25));
    expect(dip(0.25)).toBeLessThan(0);
  });

  it("lò xo bền với bước thời gian dài", () => {
    const sp = { x: 1, v: 0 };
    springTo(sp, 0, 0.5, 20, 0.5);
    expect(Number.isFinite(sp.x)).toBe(true);
    expect(Math.abs(sp.x)).toBeLessThan(0.5);
  });
});

describe("nhiệt nòng", () => {
  it("khí nóng chỉ bốc sau hơn 10 viên liên tục", () => {
    const h = newHeat();
    for (let i = 0; i < HEAT_SHOTS; i++) heatShot(h, i * 0.1, 1, false);
    expect(shimmerLevel(h, 1)).toBe(0);
    heatShot(h, 1, 1, false);
    expect(shimmerLevel(h, 1.1)).toBeGreaterThan(0.5);
    expect(shimmerLevel(h, 4)).toBe(0);
  });

  it("loạt ngắt quãng không tính dồn", () => {
    const h = newHeat();
    for (let i = 0; i < 20; i++) heatShot(h, i * 0.6, 1, false);
    expect(shimmerLevel(h, 12)).toBe(0);
  });

  it("dứt loạt thì bốc khói rồi tan", () => {
    const h = newHeat();
    for (let i = 0; i < 6; i++) heatShot(h, i * 0.1, 1, false);
    expect(smokeRate(h, 0.55)).toBe(0);
    expect(smokeRate(h, 0.75)).toBeGreaterThan(3);
    expect(smokeRate(h, 6)).toBe(0);
    // Một phát súng bắn tỉa cũng bốc khói.
    const s = newHeat();
    heatShot(s, 0, 1, true);
    expect(smokeRate(s, 0.2)).toBeGreaterThan(0);
  });
});
