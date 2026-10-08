import { describe, expect, it } from "vitest";
import {
  BOAT,
  CLASSES,
  DOOR_ARC,
  HELI,
  HYDRA,
  projectileAt,
  rocketLead,
  IGLA_LOCK,
  MISSILE,
  RHIB,
  WAR_HELIPADS,
  WEAPON,
  ROCKET_CONE,
  advanceLock,
  clampRocketAim,
  heliRocketAim,
  boatFits,
  boatStep,
  clampDoor,
  flareDecoys,
  heliCrashDamage,
  heliFits,
  heliMoveOk,
  heliProbe,
  heliStep,
  inDoorArc,
  isGunnerSeat,
  launcherExtras,
  lockReady,
  missileStep,
  vehicleSpec,
  warMap,
  type HeliInput,
  type HeliMotion,
  type HeliPose,
  type MissileState,
} from "./index.ts";

const map = warMap(3);
const IDLE: HeliInput = { pitch: 0, yaw: 0, strafe: 0, lift: 0 };

function fly(pose: HeliPose, motion: HeliMotion, input: HeliInput, seconds: number) {
  let maxImpact = 0;
  let grounded = false;
  for (let t = 0; t < seconds; t += 0.05) {
    const r = heliStep(map, pose, motion, input, 0.05);
    pose = r.pose;
    motion = r.motion;
    grounded = r.grounded;
    maxImpact = Math.max(maxImpact, r.impact);
  }
  return { pose, motion, grounded, maxImpact };
}

function padPose(side: "blue" | "red"): HeliPose {
  const p = WAR_HELIPADS[side];
  return { x: p.x, y: heliProbe(map, p.x, p.y + 0.5, p.z, p.rotY).floor, z: p.z, rotY: p.rotY, tilt: 0, roll: 0 };
}

describe("trực thăng: bay, đáp, va chạm", () => {
  it("sân đỗ trong căn cứ hai phe đậu được trực thăng", () => {
    for (const side of ["blue", "red"] as const) {
      const p = WAR_HELIPADS[side];
      expect(heliFits(map, p.x, p.z, p.rotY)).toBe(true);
    }
  });

  it("kéo cần lên thì bay lên, chúc mũi thì tăng tốc tới tốc độ đỉnh, nhả cần thì chậm dần", () => {
    let r = fly(padPose("blue"), { vx: 0, vy: 0, vz: 0 }, { ...IDLE, lift: 1 }, 6);
    const start = padPose("blue");
    expect(r.pose.y - start.y).toBeGreaterThan(30);
    r = fly(r.pose, r.motion, { ...IDLE, pitch: 1 }, 12);
    const speed = Math.hypot(r.motion.vx, r.motion.vz);
    expect(speed).toBeGreaterThan(HELI.maxSpeed * 0.85);
    expect(speed).toBeLessThanOrEqual(HELI.maxSpeed + 1e-6);
    // Bay theo mũi (blue quay về +x).
    expect(r.motion.vx).toBeGreaterThan(speed * 0.9);
    expect(r.pose.tilt).toBeCloseTo(HELI.tiltMax, 3);
    const slow = fly(r.pose, r.motion, IDLE, 6);
    expect(Math.hypot(slow.motion.vx, slow.motion.vz)).toBeLessThan(speed * 0.5);
  });

  it("hạ cần từ trên cao: đệm khí sát đất, đáp mềm (không mất máu) rồi đứng yên trên càng", () => {
    const start = padPose("red");
    const up = fly(start, { vx: 0, vy: 0, vz: 0 }, { ...IDLE, lift: 1 }, 3);
    const down = fly(up.pose, up.motion, { ...IDLE, lift: -1 }, 12);
    expect(down.grounded).toBe(true);
    expect(down.pose.y).toBeCloseTo(start.y, 1);
    expect(heliCrashDamage(down.maxImpact)).toBe(0);
    // Nhả cần: vẫn đậu, không trôi.
    const rest = fly(down.pose, down.motion, IDLE, 2);
    expect(Math.hypot(rest.pose.x - down.pose.x, rest.pose.z - down.pose.z)).toBeLessThan(0.05);
    expect(rest.pose.y).toBeCloseTo(down.pose.y, 3);
  });

  it("rơi thẳng xuống đất rất nhanh thì nổ tung; va nhẹ thì chỉ mất ít máu", () => {
    const start = padPose("blue");
    const r = heliStep(map, { ...start, y: start.y + 1 }, { vx: 0, vy: -30, vz: 0 }, IDLE, 0.05);
    expect(r.impact).toBeGreaterThanOrEqual(HELI.crashSpeed);
    expect(heliCrashDamage(r.impact)).toBeGreaterThanOrEqual(HELI.hp);
    expect(heliCrashDamage(HELI.safeSink + 2)).toBeGreaterThan(0);
    expect(heliCrashDamage(HELI.safeSink + 2)).toBeLessThan(HELI.hp * 0.3);
  });

  it("đâm ngang vào tường nhà: dừng lại, không xuyên qua, có tốc độ va chạm", () => {
    // Tìm một khối đặc cao (tường, nhà) và bay ngang vào nó ở độ cao giữa thân.
    const wall = map.boxes.find((b) => b.solid && b.h > 2.6 && Math.max(b.w, b.d) > 5 && Math.min(b.w, b.d) < 1.5 && Math.abs(b.pitch) < 0.01)!;
    expect(wall).toBeTruthy();
    // Pháp tuyến theo chiều mỏng của tường (trục v: (sin rot, cos rot); trục u: (cos rot, −sin rot)).
    const n = wall.d < wall.w ? { x: Math.sin(wall.rot), z: Math.cos(wall.rot) } : { x: Math.cos(wall.rot), z: -Math.sin(wall.rot) };
    const y = wall.y - wall.h / 2 + 0.6;
    const from = { x: wall.x + n.x * 12, z: wall.z + n.z * 12 };
    const rotY = Math.atan2(-n.x, -n.z);
    let pose: HeliPose = { x: from.x, y, z: from.z, rotY, tilt: 0, roll: 0 };
    let motion: HeliMotion = { vx: -n.x * 30, vy: 0, vz: -n.z * 30 };
    let impact = 0;
    for (let k = 0; k < 40; k++) {
      const r = heliStep(map, pose, motion, IDLE, 0.05);
      pose = r.pose;
      motion = r.motion;
      impact = Math.max(impact, r.impact);
    }
    expect(impact).toBeGreaterThan(10);
    // Vẫn ở phía bên này bức tường.
    expect((pose.x - wall.x) * n.x + (pose.z - wall.z) * n.z).toBeGreaterThan(0);
  });

  it("server từ chối gói vị trí bay quá nhanh, chui xuống đất, quá trần; nhận gói hợp lệ", () => {
    const s = padPose("blue");
    const air = { x: s.x, y: s.y + 20, z: s.z };
    expect(heliMoveOk(map, air, { x: air.x + 4, y: air.y + 1, z: air.z, rotY: 0 }, 0.1)).toBe(true);
    expect(heliMoveOk(map, air, { x: air.x + 30, y: air.y, z: air.z, rotY: 0 }, 0.1)).toBe(false);
    expect(heliMoveOk(map, air, { x: air.x, y: s.y - 3, z: air.z, rotY: 0 }, 3)).toBe(false);
    expect(heliMoveOk(map, { ...air, y: HELI.ceiling }, { x: air.x, y: HELI.ceiling + 5, z: air.z, rotY: 0 }, 1)).toBe(false);
  });
});

describe("súng cửa, rocket, ghế trực thăng", () => {
  it("hai ghế xạ thủ cửa hông, mỗi cửa chỉ bắn được về phía mình", () => {
    expect(vehicleSpec("heli").seats).toBe(4);
    expect(isGunnerSeat("heli", 1)).toBe(true);
    expect(isGunnerSeat("heli", 2)).toBe(true);
    expect(isGunnerSeat("heli", 0)).toBe(false);
    // Trực thăng mũi theo +z (rotY 0): cửa trái nhìn về +x, cửa phải về −x.
    expect(inDoorArc(1, 0, Math.PI / 2)).toBe(true);
    expect(inDoorArc(1, 0, -Math.PI / 2)).toBe(false);
    expect(inDoorArc(2, 0, -Math.PI / 2)).toBe(true);
    expect(clampDoor(1, 0, -Math.PI / 2)).toBeCloseTo(Math.PI / 2 - DOOR_ARC, 5);
    expect(WEAPON.get("hydra")?.explosive).toBeTruthy();
  });
});

describe("tên lửa IGLA: khoá, bay đuổi, pháo sáng", () => {
  it("giữ tâm liên tục đủ IGLA_LOCK.time thì khoá chín; đứt quãng thì khoá lại từ đầu", () => {
    const T = IGLA_LOCK.time * 1000;
    let lock = advanceLock(null, "v1", 0);
    for (let t = 100; t <= T; t += 100) lock = advanceLock(lock, "v1", t);
    expect(lockReady(lock, T)).toBe(true);
    expect(lockReady(advanceLock(null, "v1", 0), 0)).toBe(false);
    // Giữ chưa đủ lâu (thiếu hơn phần nới cho trễ mạng): chưa khoá.
    let early = advanceLock(null, "v1", 0);
    for (let t = 100; t <= T - IGLA_LOCK.slack * 1000 - 200; t += 100) early = advanceLock(early, "v1", t);
    expect(lockReady(early, T - IGLA_LOCK.slack * 1000 - 200)).toBe(false);
    // Mất dấu quá lâu: bắt đầu lại.
    const lost = advanceLock(lock, "v1", T + IGLA_LOCK.gap * 1000 + 50);
    expect(lost.held).toBe(0);
    // Đổi mục tiêu: bắt đầu lại.
    expect(advanceLock(lock, "v2", T + 100).held).toBe(0);
    // Khoá chín nhưng để quá lâu không ngắm thì hết hiệu lực.
    expect(lockReady(lock, T + IGLA_LOCK.gap * 1000 + 1)).toBe(false);
  });

  it("tên lửa quay đầu có giới hạn, đuổi kịp mục tiêu đứng yên", () => {
    const m: MissileState = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, speed: MISSILE.speed, age: 0, target: "t", decoy: null };
    const aim = { x: 0, y: 40, z: 300 };
    let prev: [number, number, number] = [m.dx, m.dy, m.dz];
    let best = Infinity;
    for (let k = 0; k < 120; k++) {
      missileStep(m, aim, 0.05);
      const turn = Math.acos(Math.min(1, prev[0] * m.dx + prev[1] * m.dy + prev[2] * m.dz));
      expect(turn).toBeLessThanOrEqual(MISSILE.turn * 0.05 + 1e-6);
      prev = [m.dx, m.dy, m.dz];
      best = Math.min(best, Math.hypot(m.x - aim.x, m.y - aim.y, m.z - aim.z));
    }
    expect(best).toBeLessThan(MISSILE.fuse);
    expect(m.speed).toBe(MISSILE.vmax);
  });

  it("pháo sáng mồi được tên lửa trong tầm (theo xác suất), xa quá thì không", () => {
    expect(flareDecoys(100, 0.1)).toBe(true);
    expect(flareDecoys(100, 0.99)).toBe(false);
    expect(flareDecoys(5000, 0)).toBe(false);
  });

  it("Kỹ Thuật chọn IGLA thì mang IGLA thay RPG-7", () => {
    const extras = CLASSES.engineer.extras;
    expect(launcherExtras(extras, false)).toEqual([...extras]);
    const aa = launcherExtras(extras, true);
    expect(aa).toContain("igla");
    expect(aa).not.toContain("rpg7");
    expect(aa.some((e) => e.startsWith("ammo:missile"))).toBe(true);
    expect(WEAPON.get("igla")?.ammo).toBe("missile");
  });
});

describe("xuồng cao tốc (RHIB)", () => {
  it("nhanh hơn hẳn thuyền tuần tra, chỉ chạy trên nước", () => {
    let at: { x: number; z: number } | null = null;
    for (let x = -200; x < 200 && !at; x += 9) if ([0, 15, 30, 45, 60, 75].every((dz) => boatFits(map, x, -330 + dz, 0, RHIB))) at = { x, z: -330 };
    expect(at).not.toBeNull();
    let pose = { x: at!.x, y: 0, z: at!.z, rotY: 0 };
    let speed = 0;
    let top = 0;
    for (let k = 0; k < 100; k++) {
      ({ pose, speed } = boatStep(map, pose, 1, 0, speed, 0.05, RHIB));
      top = Math.max(top, speed);
    }
    expect(top).toBeGreaterThan(BOAT.forward + 3);
    expect(top).toBeLessThanOrEqual(RHIB.forward + 1e-6);
    expect(vehicleSpec("rhib").seats).toBe(4);
    expect(isGunnerSeat("rhib", 1)).toBe(true);
  });
});

describe("rocket trực thăng ngắm theo chuột", () => {
  it("trong nón quanh mũi thì bay đúng hướng ngắm, ngoài nón thì bám mép nón", () => {
    const pose = { x: 0, y: 40, z: 0, rotY: 1, tilt: 0.2, roll: 0 };
    const inside = heliRocketAim(pose, 0, 1.1, -0.3);
    expect(Math.atan2(inside.d[0], inside.d[2])).toBeCloseTo(1.1, 5);
    expect(Math.asin(inside.d[1])).toBeCloseTo(-0.3, 5);
    const a = clampRocketAim(1, 1 + Math.PI / 2, 1.2);
    expect(a.yaw).toBeCloseTo(1 + ROCKET_CONE.yaw, 5);
    expect(a.pitch).toBe(ROCKET_CONE.up);
    expect(clampRocketAim(Math.PI - 0.1, -Math.PI + 0.1, -2).yaw).toBeCloseTo(Math.PI + 0.1, 5);
    expect(clampRocketAim(0, 0, -2).pitch).toBe(ROCKET_CONE.down);
  });

  it("IGLA: trực thăng còn nguyên máu chịu được hai phát, ba phát thì rơi", () => {
    expect(MISSILE.armor * 2).toBeLessThan(HELI.hp);
    expect(MISSILE.armor * 3).toBeGreaterThanOrEqual(HELI.hp);
    expect(MISSILE.vmax).toBeGreaterThan(HELI.maxSpeed * 3);
  });
});

describe("rocket trực thăng: ngắm bù rơi", () => {
  it("ngắm theo rocketLead thì rocket rơi trúng mục tiêu ở 100–700 m (ngắm thẳng thì trượt)", () => {
    const o: [number, number, number] = [0, 60, 0];
    for (const dist of [100, 300, 500, 700]) {
      const t: [number, number, number] = [dist * 0.8, 2, dist * 0.6];
      const aim = (p: readonly number[]) => {
        const dx = p[0]! - o[0];
        const dy = p[1]! - o[1];
        const dz = p[2]! - o[2];
        const l = Math.hypot(dx, dy, dz);
        return [dx / l, dy / l, dz / l] as [number, number, number];
      };
      const along = (d: [number, number, number]) => {
        // Điểm của đường bay ở cùng khoảng cách ngang với mục tiêu.
        const horiz = Math.hypot(t[0], t[2]);
        const s = horiz / Math.hypot(d[0], d[2]);
        return projectileAt(o, d, HYDRA.velocity, s, HYDRA.boost);
      };
      const led = along(aim(rocketLead(o[0], o[1], o[2], ...t)));
      const straight = along(aim(t));
      expect(Math.abs(led[1] - t[1])).toBeLessThan(1.2);
      if (dist >= 300) expect(Math.abs(straight[1] - t[1])).toBeGreaterThan(1.5);
    }
    expect(HYDRA.range).toBeGreaterThanOrEqual(700);
    expect(HELI.rockets).toBeGreaterThanOrEqual(30);
  });
});

