import { describe, expect, it } from "vitest";
import { TANK, battleMap, checkBodyPoint, rayBody, rayTank, tankFits, tankStep } from "./index.ts";

const pose = { x: 0, y: 0, z: 0, rotY: 0, crouch: false, prone: false };

describe("thân người khi dò đạn", () => {
  it("đứng: đạn ngang ngực trúng thân, ngang đầu trúng đầu", () => {
    expect(rayBody([0, 1.2, -10], [0, 0, 1], pose)?.part).toBe("body");
    expect(rayBody([0, 1.62, -10], [0, 0, 1], pose)?.part).toBe("head");
  });

  it("nằm sấp: đạn ngang ngực người đứng bay qua trên lưng, đạn sát đất mới trúng; đầu nằm phía trước", () => {
    const prone = { ...pose, prone: true };
    expect(rayBody([-10, 1.2, 0], [1, 0, 0], prone)).toBeNull();
    expect(rayBody([-10, 0.2, 0], [1, 0, 0], prone)?.part).toBe("body");
    // Đầu ở trước chỗ đứng (theo hướng mặt +z), bắn thẳng từ phía trước vào mặt.
    expect(rayBody([0, 0.32, 10], [0, 0, -1], prone)?.part).toBe("head");
    // Server kiểm tra lại: điểm ngang ngực người đứng thì không tính trúng người nằm.
    expect(checkBodyPoint([0, 1.9, 0], prone, false)).toBeNull();
    expect(checkBodyPoint([0, 0.3, 0.78], prone, true)?.head).toBe(true);
  });
});

describe("xe tăng", () => {
  const map = battleMap(1);
  it("chạy được trên đất trống, không đâm xuyên nhà", () => {
    // Tìm một chỗ trống trên đảo.
    let start = { x: 0, y: 0, z: 0, rotY: 0 };
    for (let a = 0; a < 200; a++) {
      const x = Math.cos(a) * (40 + a * 0.5);
      const z = Math.sin(a) * (40 + a * 0.5);
      if ([0, 4, 8, 12, 16, 20].every((dz) => tankFits(map, x, z + dz, 0))) {
        start = { x, y: map.world.heightAt(x, z), z, rotY: 0 };
        break;
      }
    }
    let pose = start;
    let speed = 0;
    for (let k = 0; k < 60; k++) ({ pose, speed } = tankStep(map, pose, 1, 0, speed, 0.05));
    expect(pose.z - start.z).toBeGreaterThan(2);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(TANK.forward);
  });

  it("thân xe chặn tia đạn", () => {
    const t = { x: 0, y: 0, z: 0, rotY: 0.4 };
    expect(rayTank(t, [-10, 1.2, 0], [1, 0, 0], 50)).toBeLessThan(10);
    expect(rayTank(t, [-10, 6, 0], [1, 0, 0], 50)).toBe(Infinity);
  });
});
