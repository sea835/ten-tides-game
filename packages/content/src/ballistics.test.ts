import { describe, expect, it } from "vitest";
import { PEN_THICK, RICOCHET, boxNormalAt, caliberOf, penetration, ricochet, ricochetLimit } from "./ballistics.ts";
import { buildIndex, bulletThrough, type BattleBox, type BoxMat } from "./battle.ts";
import { ATTACHMENTS, DUAL_MAG_RELOAD, HELMETS, WEAPON, attachmentFits, bulletAt, flightDistance, flightTime, projectileAt, weaponDrop, withAttachments } from "./battleItems.ts";

const box = (mat: BoxMat, o: Partial<BattleBox> = {}): BattleBox => ({ x: 0, y: 0, z: 0, w: 4, h: 3, d: 0.2, rot: 0, pitch: 0, mat, solid: true, ...o });

describe("bảng thông số súng (kế hoạch 5.1)", () => {
  // id: sơ tốc, sát thương thân, sát thương đầu, băng, băng mở rộng.
  const TABLE: Record<string, [number, number, number, number, number]> = {
    m416: [880, 41, 86, 30, 40],
    akm: [715, 49, 102, 30, 40],
    vector: [350, 31, 58, 19, 33],
    awm: [945, 105, 250, 5, 7],
    kar98k: [760, 79, 197, 5, 5],
    m249: [915, 45, 94, 100, 100],
  };
  it("sơ tốc, sát thương thân / đầu, băng đạn đúng bảng", () => {
    for (const [id, [v, body, head, mag, ext]] of Object.entries(TABLE)) {
      const w = WEAPON.get(id)!;
      expect(w.velocity, id).toBe(v);
      expect(w.damage, id).toBe(body);
      expect(Math.round(w.damage * w.headshot), id).toBe(head);
      expect(w.mag, id).toBe(mag);
      expect(withAttachments(w, "extmag").mag, id).toBe(ext);
    }
    expect(WEAPON.get("vector")!.rpm).toBe(1100);
  });

  it("AWM trúng đầu gục ngay cả khi đội mũ cấp 3", () => {
    const awm = WEAPON.get("awm")!;
    const best = HELMETS[HELMETS.length - 1]!;
    expect(awm.damage * awm.headshot * (1 - best.absorb)).toBeGreaterThanOrEqual(100);
  });

  it("súng mới: S1897 bơm 5 viên nạp từng viên, DP-28 đĩa 47 viên", () => {
    const s = WEAPON.get("s1897")!;
    expect([s.class, s.mag, s.pellets, s.damage, s.velocity]).toEqual(["shotgun", 5, 9, 24, 360]);
    expect(s.shell).toBeGreaterThan(0);
    expect(s.pump).toBe(true);
    expect(s.price).toBeGreaterThan(0);
    const dp = WEAPON.get("dp28")!;
    expect([dp.class, dp.mag, dp.ammo]).toEqual(["lmg", 47, "762"]);
    expect(dp.price).toBeGreaterThan(0);
  });
});

describe("rocket RPG-7 tăng tốc", () => {
  const rpg = WEAPON.get("rpg7")!;
  it("rời ống 115 m/s, tăng tốc tới 295 m/s rồi bay đều", () => {
    expect(rpg.velocity).toBe(115);
    expect(rpg.boost?.vmax).toBe(295);
    // Tốc độ tức thời ở đầu và lúc đã hết tăng tốc.
    const v = (s: number) => 1 / ((flightTime(rpg.velocity, s + 0.01, rpg.boost) - flightTime(rpg.velocity, s, rpg.boost)) / 0.01);
    expect(v(0)).toBeCloseTo(115, 0);
    expect(v(300)).toBeCloseTo(295, 0);
    // Đi 160 m: nhanh hơn bay đều 115 m/s nhưng chậm hơn bay đều 295 m/s.
    const t = flightTime(rpg.velocity, 160, rpg.boost);
    expect(t).toBeLessThan(160 / 115);
    expect(t).toBeGreaterThan(160 / 295);
  });

  it("thời gian bay và quãng đường ngược nhau; đạn thường không đổi", () => {
    for (const s of [5, 40, 90, 200, 400]) expect(flightDistance(rpg.velocity, flightTime(rpg.velocity, s, rpg.boost), rpg.boost)).toBeCloseTo(s, 6);
    const m = WEAPON.get("m416")!;
    expect(projectileAt([0, 2, 0], [1, 0, 0], m.velocity, 300)).toEqual(bulletAt([0, 2, 0], [1, 0, 0], m.velocity, 300));
    expect(weaponDrop(rpg, 100)).toBeGreaterThan(weaponDrop({ velocity: 295 }, 100));
    expect(weaponDrop(rpg, 100)).toBeLessThan(weaponDrop({ velocity: 115 }, 100));
  });
});

describe("xuyên vật liệu theo cỡ đạn", () => {
  it("cỡ đạn theo loại đạn", () => {
    expect(caliberOf(WEAPON.get("akm")!)).toBe("heavy");
    expect(caliberOf(WEAPON.get("m416")!)).toBe("rifle");
    expect(caliberOf(WEAPON.get("vector")!)).toBe("light");
    expect(caliberOf(WEAPON.get("s1897")!)).toBe("pellet");
  });

  it("súng trường qua vách gỗ, tôn gần như nguyên vẹn; tiểu liên yếu hơn; bao cát, bê tông chặn hẳn", () => {
    expect(penetration(box("wood"), "rifle", 0.2)).toBe(1);
    expect(penetration(box("sign", { d: 0.06 }), "heavy", 0.06)).toBe(1);
    expect(penetration(box("metal", { d: 0.08 }), "rifle", 0.08)).toBeGreaterThan(0.7);
    expect(penetration(box("metal", { d: 0.3 }), "heavy", 0.3)).toBe(0);
    expect(penetration(box("wood"), "light", 0.2)).toBeLessThan(1);
    expect(penetration(box("wood"), "light", 0.2)).toBeGreaterThan(0);
    expect(penetration(box("plaster"), "pellet", 0.1)).toBe(0);
    for (const mat of ["sandbag", "concrete", "brick", "stone"] as const) for (const cal of ["heavy", "rifle", "light", "pellet"] as const) expect(penetration(box(mat), cal, 0.1)).toBe(0);
    // Quá dày thì găm lại.
    expect(penetration(box("wood"), "rifle", PEN_THICK.rifle + 0.01)).toBe(0);
    expect(penetration(box("wood"), "heavy", PEN_THICK.rifle + 0.01)).toBe(1);
  });

  it("bulletThrough: vách gỗ để đạn súng trường đi qua đủ sát thương, đạn chì thì găm lại", () => {
    const index = buildIndex([box("wood", { x: 5, w: 0.2, d: 4, h: 3, y: 1.5 })]);
    const rifle = bulletThrough(index, [0, 1.5, 0], [1, 0, 0], 20, 1, "rifle");
    expect(rifle.i).toBe(-1);
    expect(rifle.pens).toHaveLength(1);
    expect(rifle.mult).toBe(1);
    // Vách gỗ mỏng: đạn chì xuyên được nhưng yếu đi nhiều.
    const thin = buildIndex([box("wood", { x: 5, w: 0.15, d: 4, h: 3, y: 1.5 })]);
    const pellet = bulletThrough(thin, [0, 1.5, 0], [1, 0, 0], 20, 1, "pellet");
    expect(pellet.pens).toHaveLength(1);
    expect(pellet.mult).toBeLessThan(0.6);
    const thick = buildIndex([box("wood", { x: 5, w: 0.3, d: 4, h: 3, y: 1.5 })]);
    expect(bulletThrough(thick, [0, 1.5, 0], [1, 0, 0], 20, 1, "pellet").i).toBe(0);
  });
});

describe("đạn nảy", () => {
  // Tấm thép nằm ngang (mặt trên ở y = 0), bắn chúc xuống với góc sượt `deg` độ.
  const plate = (mat: BoxMat) => buildIndex([box(mat, { w: 20, h: 0.2, d: 20, y: -0.1 })]);
  const shot = (deg: number): [number, number, number] => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180), 0];

  it("pháp tuyến mặt bị chạm", () => {
    const index = plate("metal");
    const n = boxNormalAt(index, 0, [1, 0, 2]);
    expect(n[1]).toBeCloseTo(1, 6);
    const side = boxNormalAt(index, 0, [10, -0.05, 0]);
    expect(side[0]).toBeCloseTo(1, 6);
  });

  it("sượt dưới 15° vào kim loại thì nảy, phản xạ gương, sát thương giảm", () => {
    const index = plate("metal");
    const d = shot(10);
    const r = ricochet(index, 0, [0, 0, 0], d)!;
    expect(r).not.toBeNull();
    expect(r.d[0]).toBeCloseTo(d[0], 6);
    expect(r.d[1]).toBeCloseTo(-d[1], 6);
    expect(r.mult).toBe(RICOCHET.damage);
    expect(ricochet(index, 0, [0, 0, 0], shot(20))).toBeNull();
    // Bắn từ dưới lên mặt trên (đi ra khỏi mặt) không tính.
    expect(ricochet(index, 0, [0, 0, 0], [d[0], -d[1], 0])).toBeNull();
  });

  it("bê tông phải sượt hơn; gỗ, bao cát không nảy", () => {
    expect(ricochet(plate("concrete"), 0, [0, 0, 0], shot(10))).toBeNull();
    expect(ricochet(plate("concrete"), 0, [0, 0, 0], shot(5))).not.toBeNull();
    expect(ricochet(plate("wood"), 0, [0, 0, 0], shot(3))).toBeNull();
    expect(ricochetLimit("sandbag")).toBe(0);
  });
});

describe("phụ kiện mới", () => {
  it("chân chống chỉ giảm giật khi nằm, lắp cho súng nòng dài; hộp đạn kép không cho súng lục", () => {
    const m = WEAPON.get("m416")!;
    expect(withAttachments(m, "bipod").proneRecoil).toBeLessThan(0.6);
    expect(withAttachments(m, "bipod").recoilV).toBe(1);
    expect(attachmentFits("bipod", WEAPON.get("dp28")!)).toBe(true);
    expect(attachmentFits("bipod", WEAPON.get("kar98k")!)).toBe(true);
    expect(attachmentFits("bipod", WEAPON.get("vector")!)).toBe(false);
    expect(withAttachments(m, "dualmag").dualMag).toBe(true);
    expect(attachmentFits("dualmag", WEAPON.get("p92")!)).toBe(false);
    expect(attachmentFits("dualmag", WEAPON.get("s1897")!)).toBe(false);
    expect(ATTACHMENTS.dualmag.slot).toBe("mag");
    expect(DUAL_MAG_RELOAD).toBeLessThan(1);
  });
});
