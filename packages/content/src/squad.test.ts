import { describe, expect, it } from "vitest";
import { LEAN, TANK, battleMap, checkBodyPoint, leanShift, rayBody, rayTank, rightOf, tankFits, tankStep } from "./index.ts";

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

describe("nghiêng người (Q/E)", () => {
  it("vector phải: mặt quay về +z thì bên phải là −x", () => {
    const [rx, rz] = rightOf(0);
    expect(rx).toBeCloseTo(-1, 6);
    expect(rz).toBeCloseTo(0, 6);
  });

  it("đầu lệch đủ LEAN.side theo vector phải, dưới hông không lệch", () => {
    const head = leanShift(0, 1, false, 1.62);
    expect(head[0]).toBeCloseTo(-LEAN.side, 6);
    expect(head[1]).toBeCloseTo(-LEAN.drop, 6);
    expect(head[2]).toBeCloseTo(0, 6);
    expect(leanShift(0, -1, false, 1.62)[0]).toBeCloseTo(LEAN.side, 6);
    expect(Math.hypot(...leanShift(0, 1, false, 0.5))).toBe(0);
    // Mặt quay về +x thì bên phải là +z; ngồi xổm, nghiêng nửa chừng.
    expect(leanShift(Math.PI / 2, 0.5, true, 1.12)[2]).toBeCloseTo(LEAN.side * 0.5, 6);
  });

  it("đạn vào chỗ đầu cũ trượt, vào chỗ đầu đã lệch thì trúng đầu; chân vẫn ở chỗ cũ", () => {
    const right = { ...pose, lean: 1 };
    const y = 1.62 - LEAN.drop;
    // Bắn từ phía trước (+z) vào mặt, dọc trục z.
    expect(rayBody([0, 1.7, 10], [0, 0, -1], right)).toBeNull();
    expect(rayBody([-LEAN.side, y, 10], [0, 0, -1], right)?.part).toBe("head");
    expect(rayBody([LEAN.side, y, 10], [0, 0, -1], { ...pose, lean: -1 })?.part).toBe("head");
    expect(rayBody([0, 0.5, 10], [0, 0, -1], right)?.part).toBe("body");
    // Thân trên ngả sang phải: ngang ngực lệch sang phải vẫn trúng thân.
    expect(rayBody([-0.35, 1.25, 10], [0, 0, -1], right)?.part).toBe("body");
    expect(rayBody([0.4, 1.25, 10], [0, 0, -1], right)).toBeNull();
    // Không nghiêng thì như cũ.
    expect(rayBody([0, 1.62, -10], [0, 0, 1], { ...pose, lean: 0 })?.part).toBe("head");
  });

  it("server nhận điểm trúng ở đầu đã lệch", () => {
    const right = { ...pose, lean: 1 };
    expect(checkBodyPoint([-LEAN.side, 1.62 - LEAN.drop, 0.15], right, true)?.head).toBe(true);
    // Điểm ngoài xa bên trái (phía ngược với chiều nghiêng) thì từ chối.
    expect(checkBodyPoint([1.35, 1.7, 0], right, true)).toBeNull();
    expect(checkBodyPoint([1.35, 1.7, 0], pose, true)).not.toBeNull();
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

  it("không lấn vào góc tường nằm lọt giữa các điểm mẫu", () => {
    // Góc một khối tường cao: đặt tâm xe sao cho góc tường chui vào giữa hông xe (không trúng điểm mẫu nào).
    const wall = map.boxes.find((b) => b.solid && b.h > 2.5 && b.mat !== "fence" && Math.abs(b.pitch) < 0.01 && b.w > 3 && b.d > 3)!;
    expect(wall).toBeDefined();
    const [hw, , hl] = TANK.half;
    const c = Math.cos(wall.rot);
    const s = Math.sin(wall.rot);
    // Góc (+u, +v) của tường, lùi ra ngoài theo u một chút, xe quay cùng hướng tường, hông trái xe đè lên góc.
    const u = wall.w / 2 + hw - 0.4;
    const v = wall.d / 2 + hl * 0.5;
    const x = wall.x + c * u + s * v;
    const z = wall.z - s * u + c * v;
    expect(tankFits(map, x, z, wall.rot)).toBe(false);
  });

  it("D quay sang phải, A quay sang trái (theo hướng người lái nhìn)", () => {
    // Nhìn theo +z thì bên phải là −x (quy ước camera: phải = (cos yaw, −sin yaw) với hướng nhìn (−sin yaw, −cos yaw)).
    let pose = { x: 30, y: 0, z: 30, rotY: 0 };
    for (let k = 0; k < 10; k++) pose = tankStep(map, pose, 0, 1, 0, 0.05).pose;
    expect(Math.sin(pose.rotY)).toBeLessThan(0);
    pose = { x: 30, y: 0, z: 30, rotY: 0 };
    for (let k = 0; k < 10; k++) pose = tankStep(map, pose, 0, -1, 0, 0.05).pose;
    expect(Math.sin(pose.rotY)).toBeGreaterThan(0);
  });

  it("thân xe chặn tia đạn", () => {
    const t = { x: 0, y: 0, z: 0, rotY: 0.4 };
    expect(rayTank(t, [-10, 1.2, 0], [1, 0, 0], 50)).toBeLessThan(10);
    expect(rayTank(t, [-10, 6, 0], [1, 0, 0], 50)).toBe(Infinity);
  });
});
