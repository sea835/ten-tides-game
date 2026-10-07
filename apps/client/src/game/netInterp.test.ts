import { describe, expect, it } from "vitest";
import { PatchClock, Track } from "./netInterp.ts";

const out = { x: 0, y: 0, z: 0, rotY: 0 };

describe("Track (nội suy Hermite)", () => {
  it("đi đều thì nội suy đúng đường thẳng, đi qua đúng từng điểm", () => {
    const tr = new Track();
    for (let i = 0; i < 6; i++) tr.push(i * 0.05, i * 0.25, 1, -i * 0.1, 0);
    for (const t of [0.05, 0.0625, 0.1, 0.137, 0.2]) {
      expect(tr.sample(t, out)).toBe(true);
      expect(out.x).toBeCloseTo(t * 5, 6);
      expect(out.z).toBeCloseTo(-t * 2, 6);
      expect(out.y).toBeCloseTo(1, 6);
    }
  });

  it("vận tốc liền mạch qua các điểm (không gãy góc như nội suy tuyến tính)", () => {
    const tr = new Track();
    // Rẽ: x tăng đều, z cong.
    for (let i = 0; i < 6; i++) tr.push(i * 0.05, i, 0, (i * i) / 4, 0);
    const e = 1e-4;
    const at = (t: number) => (tr.sample(t, out), out.z);
    const left = (at(0.1) - at(0.1 - e)) / e;
    const right = (at(0.1 + e) - at(0.1)) / e;
    expect(Math.abs(left - right)).toBeLessThan(0.05);
  });

  it("băng cạn: đi tiếp theo vận tốc cuối một chút rồi đứng lại", () => {
    const tr = new Track();
    for (let i = 0; i < 4; i++) tr.push(i * 0.05, i, 0, 0, 0);
    tr.sample(0.15 + 0.05, out);
    expect(out.x).toBeCloseTo(4, 3);
    tr.sample(5, out);
    expect(out.x).toBeLessThan(5.6);
  });

  it("nhảy xa (hồi sinh) thì bỏ băng cũ, đặt thẳng tới chỗ mới", () => {
    const tr = new Track();
    tr.push(0, 0, 0, 0, 0);
    tr.push(0.05, 0.2, 0, 0, 0);
    tr.push(0.1, 80, 0, 80, 0);
    expect(tr.size).toBe(1);
    tr.sample(0.07, out);
    expect(out.x).toBe(80);
  });

  it("hướng quay qua mốc 0/2π đi đường ngắn", () => {
    const tr = new Track();
    tr.push(0, 0, 0, 0, Math.PI * 2 - 0.1);
    tr.push(0.05, 0, 0, 0, 0.1);
    tr.sample(0.025, out);
    const r = Math.atan2(Math.sin(out.rotY), Math.cos(out.rotY));
    expect(Math.abs(r)).toBeLessThan(0.01);
  });
});

describe("PatchClock (khử rung nhịp gói)", () => {
  it("gói đến lệch nhịp ±20 ms vẫn được đặt gần đúng nhịp 50 ms", () => {
    const c = new PatchClock();
    let rand = 1;
    const jitter = () => ((rand = (rand * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    const stamps: number[] = [];
    for (let i = 0; i < 200; i++) stamps.push(c.tick(10 + i * 0.05 + jitter()));
    // Sau khi ổn định: khoảng cách giữa hai mốc liên tiếp gần 50 ms hơn nhiều so với giờ đến thô.
    let worst = 0;
    for (let i = 100; i < 199; i++) worst = Math.max(worst, Math.abs(stamps[i + 1]! - stamps[i]! - 0.05));
    expect(worst).toBeLessThan(0.01);
  });

  it("hai gói dồn cùng lúc (TCP) vẫn được tách ra một nhịp", () => {
    const c = new PatchClock();
    for (let i = 0; i < 50; i++) c.tick(i * 0.05);
    const a = c.tick(50 * 0.05 + 0.04);
    const b = c.tick(50 * 0.05 + 0.04);
    expect(b - a).toBeGreaterThan(0.03);
  });
});
