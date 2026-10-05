import { describe, expect, it } from "vitest";
import { BOAT, HULL_ARMOR, JEEP, TANK, WEAPON, armorFactor, boatFits, boatStep, jeepFits, jeepStep, rayVehicle, seatPos, trackHit, vehicleSpec, vehicleStep, warMap } from "./index.ts";

const map = warMap(3);

/** Chỗ đất bằng trống đủ cho xe trinh sát chạy thẳng theo +z chừng 60 m. */
function openLand(): { x: number; z: number } {
  for (let x = -240; x < 240; x += 7)
    for (let z = -200; z < 140; z += 7) {
      if ([0, 10, 20, 30, 40, 50, 60].every((dz) => jeepFits(map, x, z + dz, 0) && map.world.heightAt(x, z + dz) > 1)) return { x, z };
    }
  throw new Error("không có chỗ đất trống");
}

/** Chỗ biển sâu thuyền nằm được, mũi theo +z mà phía trước chừng 40 m vẫn là biển. */
function openSea(): { x: number; z: number } {
  for (let x = -200; x < 200; x += 9) {
    const z = -320;
    if ([0, 10, 20, 30, 40].every((dz) => boatFits(map, x, z + dz, 0))) return { x, z };
  }
  throw new Error("không có chỗ biển");
}

describe("xe trinh sát (jeep)", () => {
  it("chạy nhanh (tối đa ~75 km/h), đứng yên thì bẻ lái không quay tại chỗ", () => {
    const at = openLand();
    let pose = { x: at.x, y: 0, z: at.z, rotY: 0 };
    let speed = 0;
    let top = 0;
    for (let k = 0; k < 120; k++) {
      ({ pose, speed } = jeepStep(map, pose, 1, 0, speed, 0.05));
      top = Math.max(top, speed);
    }
    expect(top).toBeGreaterThan(15);
    expect(top).toBeLessThanOrEqual(JEEP.forward + 1e-6);
    expect(top * 3.6).toBeLessThan(80);
    // Nhanh hơn hẳn xe tăng.
    expect(top).toBeGreaterThan(TANK.forward * 2);
    const still = jeepStep(map, { x: at.x, y: 0, z: at.z, rotY: 0 }, 0, 1, 0, 0.05).pose;
    expect(still.rotY).toBe(0);
  });

  it("lội được nước nông, không xuống nước sâu", () => {
    // Dò từ bờ ra biển: chỗ đáy −0,5 m xe đứng được, chỗ −3 m thì không.
    let shallow: { x: number; z: number } | null = null;
    let deep: { x: number; z: number } | null = null;
    for (let z = -200; z > -330 && (!shallow || !deep); z -= 0.5) {
      const h = map.world.heightAt(0, z);
      if (!shallow && h < -0.35 && h > -0.6 && jeepFits(map, 0, z, Math.PI / 2)) shallow = { x: 0, z };
      if (!deep && h < -3) deep = { x: 0, z };
    }
    expect(shallow).not.toBeNull();
    expect(deep).not.toBeNull();
    expect(jeepFits(map, deep!.x, deep!.z, 0)).toBe(false);
  });

  it("4 ghế, ghế đầu là tài xế; ghế đặt theo hướng xe", () => {
    expect(vehicleSpec("jeep").seats).toBe(4);
    const a = seatPos("jeep", { x: 0, y: 0, z: 0, rotY: 0 }, 2);
    const b = seatPos("jeep", { x: 0, y: 0, z: 0, rotY: Math.PI }, 2);
    // Xạ thủ trên thùng sau: xe quay đầu thì ghế sang phía kia.
    expect(a[2]).toBeLessThan(0);
    expect(b[2]).toBeGreaterThan(0);
  });
});

describe("thuyền tuần tra (boat)", () => {
  it("chỉ chạy trên nước: không lên cạn, mặt thuyền ở mực nước", () => {
    const sea = openSea();
    let pose = { x: sea.x, y: 0, z: sea.z, rotY: 0 };
    let speed = 0;
    for (let k = 0; k < 60; k++) ({ pose, speed } = boatStep(map, pose, 1, 0, speed, 0.05));
    expect(pose.z).toBeGreaterThan(sea.z + 5);
    expect(pose.y).toBe(0);
    expect(speed).toBeLessThanOrEqual(BOAT.forward);
    // Trên đất liền không đặt được thuyền.
    expect(boatFits(map, 0, 0, 0)).toBe(false);
    // Chạy thẳng vào bờ thì mắc lại, không lên cạn.
    let p = { x: 0, y: 0, z: -300, rotY: 0 };
    let v = 0;
    for (let k = 0; k < 20 * 40; k++) ({ pose: p, speed: v } = boatStep(map, p, 1, 0, v, 0.05));
    expect(map.world.heightAt(p.x, p.z)).toBeLessThan(0);
  });

  it("5 ghế, có súng máy mũi", () => {
    expect(vehicleSpec("boat").seats).toBe(5);
    expect(WEAPON.get("hmg")?.name).toBe("Đại liên");
  });
});

describe("giáp xe tăng theo góc", () => {
  const t = { x: 0, y: 0, z: 0, rotY: 0, kind: "tank" };

  it("dò mặt trúng: trước, đuôi, hông", () => {
    expect(rayVehicle(t, [0, 1.2, 20], [0, 0, -1], 50)?.face).toBe("front");
    expect(rayVehicle(t, [0, 1.2, -20], [0, 0, 1], 50)?.face).toBe("rear");
    expect(rayVehicle(t, [20, 1.2, 0], [-1, 0, 0], 50)?.face).toBe("side");
    // Xe quay sang hướng +x: bắn từ +x là trúng mặt trước.
    expect(rayVehicle({ ...t, rotY: Math.PI / 2 }, [20, 1.2, 0], [-1, 0, 0], 50)?.face).toBe("front");
    expect(rayVehicle(t, [20, 8, 0], [-1, 0, 0], 50)).toBeNull();
  });

  it("giáp trước giảm 60%, đuôi chịu nặng: 2 RPG vào đuôi là xe đầy máu nổ", () => {
    const rpg = WEAPON.get("rpg7")!.explosive!.armor;
    expect(armorFactor("tank", "front", 1, 0.99).mult).toBeCloseTo(0.4);
    expect(armorFactor("tank", "side", 1).mult).toBe(1);
    expect(rpg * armorFactor("tank", "rear", 1).mult * 2).toBeGreaterThanOrEqual(TANK.hp);
    expect(rpg * armorFactor("tank", "side", 1).mult * 2).toBeLessThan(TANK.hp);
    // Xe trinh sát, thuyền không có giáp nghiêng.
    expect(armorFactor("jeep", "front", 1).mult).toBe(1);
  });

  it("giáp trước góc sượt thì có thể nảy đạn, đâm thẳng thì không", () => {
    expect(armorFactor("tank", "front", 0.1, 0.1).ricochet).toBe(true);
    expect(armorFactor("tank", "front", 0.1, 0.9).ricochet).toBe(false);
    expect(armorFactor("tank", "front", 0.9, 0).ricochet).toBe(false);
    expect(armorFactor("tank", "rear", 0.05, 0).ricochet).toBe(false);
    // Tia đi gần như song song mặt trước (sượt) có cos nhỏ.
    const graze = rayVehicle(t, [-30, 1.2, 3.1 + 30 * 0.2], [Math.cos(-0.2), 0, Math.sin(-0.2)], 80);
    expect(graze?.face).toBe("front");
    expect(graze!.cos).toBeLessThan(HULL_ARMOR.ricochetCos);
  });
});

describe("đứt xích", () => {
  const t = { x: 0, y: 0, z: 0, rotY: 0, kind: "tank" };

  it("lựu đạn, mìn nổ sát dải xích thì đứt; nổ xa, nổ trên nóc, súng khác thì không", () => {
    expect(trackHit(t, TANK.half[0] + 0.8, 0.2, 1, "frag")).toBe(true);
    expect(trackHit(t, 0, 0.1, 0, "mine")).toBe(true);
    expect(trackHit(t, TANK.half[0] + 2.6, 0.2, 0, "mine")).toBe(true);
    expect(trackHit(t, TANK.half[0] + 4, 0.2, 0, "frag")).toBe(false);
    expect(trackHit(t, 0, 2.6, 0, "frag")).toBe(false);
    expect(trackHit(t, TANK.half[0] + 0.5, 0.2, 0, "rpg7")).toBe(false);
    expect(trackHit({ ...t, kind: "jeep" }, 0, 0.2, 0, "mine")).toBe(false);
  });

  it("xích đứt: xe không tiến được, chỉ quay tại chỗ", () => {
    const at = openLand();
    const start = { x: at.x, y: 0, z: at.z, rotY: 0 };
    let pose = start;
    let speed = 0;
    for (let k = 0; k < 40; k++) ({ pose, speed } = vehicleStep("tank", map, pose, 1, 1, speed, 0.05, false));
    expect(Math.hypot(pose.x - start.x, pose.z - start.z)).toBeLessThan(0.01);
    expect(Math.abs(pose.rotY)).toBeGreaterThan(0.5);
  });
});
