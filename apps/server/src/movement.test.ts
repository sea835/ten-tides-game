import { describe, expect, it } from "vitest";
import { CAMP, DIVE, heightAt } from "@tentides/content";
import { GAIT, MAX_RUN_SPEED, MAX_SPEED_BOOST, MoveMessage } from "@tentides/protocol";
import { isPlausibleMove, sanitizeGait } from "./movement.ts";

const ground = heightAt(CAMP.x, CAMP.z) + 1;
const from = { x: CAMP.x, y: ground, z: CAMP.z };
const move = (dx: number, dz: number, y = ground) => ({ x: CAMP.x + dx, y, z: CAMP.z + dz, rotY: 0, moving: true, sitting: false });

describe("isPlausibleMove", () => {
  it("nhận bước chạy bình thường", () => {
    expect(isPlausibleMove(from, move(MAX_RUN_SPEED * 0.066, 0), 66)).toBe(true);
  });

  it("nhận đà trượt và nhảy thỏ ở tốc độ tối đa", () => {
    expect(isPlausibleMove(from, move(MAX_RUN_SPEED * MAX_SPEED_BOOST * 0.066, 0), 66)).toBe(true);
  });

  it("từ chối dịch chuyển tức thời", () => {
    expect(isPlausibleMove(from, move(30, 0), 66)).toBe(false);
  });

  it("từ chối vị trí chui xuống đất hoặc ra ngoài map", () => {
    expect(isPlausibleMove(from, move(0, 0, ground - 10), 66)).toBe(false);
    expect(isPlausibleMove(from, { ...move(0, 0), x: 999 }, 10_000)).toBe(false);
  });
});

describe("lao người nằm sấp (dolphin dive)", () => {
  it("cả cú lao (bay theo đà chạy rồi trượt khuỷu tay) qua được kiểm tra tốc độ ở nhịp gửi 15 lần/giây", () => {
    // Chạy nước rút nhanh nhất có thể (có đà nhảy thỏ, Adrenaline) rồi lao.
    let speed = Math.min(MAX_RUN_SPEED * MAX_SPEED_BOOST, 8.6 * 1.3 * 1.25 * DIVE.boost);
    let x = 0;
    let landed = false;
    let t = 0;
    const brake = (DIVE.slideSpeed * DIVE.slideSpeed) / (2 * DIVE.slide);
    let slid = 0;
    const dt = 1 / 15;
    for (let k = 0; k < 40 && speed > 0.3; k++) {
      t += dt;
      if (!landed && t > 0.3) {
        landed = true;
        speed = Math.min(speed, DIVE.slideSpeed);
      }
      const before = speed;
      if (landed) speed = Math.max(0, speed - brake * dt);
      const step = ((before + speed) / 2) * dt;
      if (landed) slid += step;
      const from = { x: CAMP.x + x, y: ground, z: CAMP.z };
      x += step;
      expect(isPlausibleMove(from, { ...move(x, 0), prone: true, gait: GAIT.dive }, dt * 1000)).toBe(true);
    }
    // Trượt khuỷu tay chừng 1,5 m.
    expect(slid).toBeGreaterThan(DIVE.slide * 0.85);
    expect(slid).toBeLessThan(DIVE.slide * 1.1);
  });

  it("dáng nhất thời: giữ cờ hợp lệ, bỏ bit lạ, lao người phải đang nằm sấp", () => {
    expect(sanitizeGait(GAIT.slide | GAIT.air, false)).toBe(GAIT.slide | GAIT.air);
    expect(sanitizeGait(GAIT.dive, true)).toBe(GAIT.dive);
    expect(sanitizeGait(GAIT.dive | GAIT.air, false)).toBe(GAIT.air);
    expect(sanitizeGait(GAIT.kind, true)).toBe(0);
    expect(sanitizeGait(0xf8 | GAIT.slide, false)).toBe(GAIT.slide);
  });

  it("gói di chuyển nhận cờ dáng 0–7, từ chối số lạ", () => {
    const base = move(0, 0);
    expect(MoveMessage.safeParse({ ...base, gait: GAIT.dive | GAIT.air }).success).toBe(true);
    expect(MoveMessage.safeParse({ ...base, gait: 9 }).success).toBe(false);
    expect(MoveMessage.safeParse({ ...base, gait: 1.5 }).success).toBe(false);
  });
});
