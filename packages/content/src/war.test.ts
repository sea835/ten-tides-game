import { describe, expect, it } from "vitest";
import { WATER_LEVEL } from "./island.ts";
import { boxDurability, floorBelow, insideBox, outside } from "./battle.ts";
import { tankFits, tankGround, tankStep, type TankPose } from "./squad.ts";
import { WAR_BRIDGE, WAR_FORDS, WAR_SITES, riverSide, riverX, warMap, warRoute, warSquadLeader } from "./war.ts";

/** Lái thẳng một mạch (ga hết cỡ) `seconds` giây, trả tư thế cuối. */
function drive(map: ReturnType<typeof warMap>, from: TankPose, seconds: number): TankPose {
  let pose = from;
  let speed = 0;
  for (let t = 0; t < seconds; t += 0.05) {
    const st = tankStep(map, pose, 1, 0, speed, 0.05);
    pose = st.pose;
    speed = st.speed;
  }
  return pose;
}

describe("bản đồ chiến trường", () => {
  const map = warMap(7);
  const h = map.world.heightAt;

  it("dựng giống hệt nhau với cùng seed (tất định)", () => {
    const a = warMap(11);
    const b = warMap(11);
    expect(a).toBe(b);
    // Bố cục công trình không đổi theo seed, chỉ cây cối đổi.
    expect(warMap(12).boxes.length).toBe(a.boxes.length);
    expect(warMap(12).world.trees[0]).not.toEqual(a.world.trees[0]);
  });

  it("bảy cứ điểm A–G đúng tên kế hoạch, cột cờ không kẹt trong khối, không dưới nước", () => {
    expect(map.flags!.map((f) => `${f.id} ${f.name}`)).toEqual([
      "A Làng Thông",
      "B Pháo Đài Đá Cổ",
      "C Kho Quân Nhu",
      "D Thị Trấn Trung Tâm",
      "E Đồn Biên Phòng",
      "F Làng Suối Nước Ngọt",
      "G Nhà Máy Xi Măng",
    ]);
    for (const f of map.flags!) {
      // Cột cờ trên đất hay trên mặt sàn (quảng trường bắc ngang kênh), không dưới nước.
      expect(floorBelow(map, f.x, f.y + 1, f.z), f.id).toBeGreaterThan(WATER_LEVEL + 1);
      expect(insideBox(map.index, f.x, f.y + 1.2, f.z)).toBe(false);
      // Vùng chiếm phần lớn đứng được (không bị nhà lấp kín).
      let free = 0;
      for (const k of [0.3, 0.8])
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const x = f.x + Math.cos(a) * f.r * k;
          const z = f.z + Math.sin(a) * f.r * k;
          const y = floorBelow(map, x, f.y + 1, z);
          if (y > WATER_LEVEL + 0.5 && !insideBox(map.index, x, y + 1, z, 0.3)) free++;
        }
      expect(free, f.id).toBeGreaterThan(30);
    }
  });

  it("chỗ rơi đồ, hòm đạn không kẹt trong khối, không dưới nước", () => {
    expect(map.loot.length).toBeGreaterThan(100);
    for (const l of map.loot) {
      expect(insideBox(map.index, l.x, l.y + 0.3, l.z), `đồ ở ${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`).toBe(false);
      expect(floorBelow(map, l.x, l.y + 0.5, l.z)).toBeGreaterThan(WATER_LEVEL + 0.5);
    }
    expect(map.supplies!.length).toBeGreaterThanOrEqual(5);
    for (const s of map.supplies!) expect(h(s.x, s.z)).toBeGreaterThan(WATER_LEVEL + 1);
    // Kho Quân Nhu có vũ khí hạng nặng.
    const c = WAR_SITES.find((s) => s.id === "c")!;
    expect(map.loot.filter((l) => l.kind === "heavy" && outside(c, l.x, l.z) === 0).length).toBeGreaterThanOrEqual(3);
  });

  it("Làng Thông trên đồi cao giữa rừng thông dày; thị trấn nhà 3–5 tầng phố hẹp; pháo đài tường dày không phá được", () => {
    const a = WAR_SITES.find((s) => s.id === "a")!;
    expect(a.h).toBeGreaterThan(12);
    expect(map.world.trees.filter((t) => Math.hypot(t.x - a.x, t.z - a.z) < 90).length).toBeGreaterThan(200);
    const d = WAR_SITES.find((s) => s.id === "d")!;
    const tops = new Map<number, number>();
    for (const b of map.boxes) if (b.building !== undefined && outside(d, b.x, b.z) === 0) tops.set(b.building, Math.max(tops.get(b.building) ?? 0, b.y - d.h));
    expect(tops.size).toBeGreaterThanOrEqual(16);
    for (const top of tops.values()) expect(top).toBeGreaterThan(9);
    for (const top of tops.values()) expect(top).toBeLessThan(18);
    const b = WAR_SITES.find((s) => s.id === "b")!;
    const walls = map.boxes.filter((x) => x.mat === "stone" && outside(b, x.x, x.z) === 0 && Math.min(x.w, x.d) > 2);
    expect(walls.length).toBeGreaterThan(3);
    for (const w of walls) expect(boxDurability(w)).toBe(0);
  });

  it("sông chia đôi bản đồ giữa hai phe (mỗi bên ba cứ điểm, thị trấn ở giữa): sâu phải bơi, hai khúc cạn nông", () => {
    const side = Object.fromEntries(map.flags!.map((f) => [f.id, riverSide(f.x, f.z)]));
    expect(side).toEqual({ A: -1, B: -1, C: -1, D: 0, E: 1, F: 1, G: 1 });
    for (const z of [-200, -60, 0, 120, 230]) expect(h(riverX(z), z)).toBeLessThan(WATER_LEVEL - 2.5);
    for (const f of WAR_FORDS) {
      expect(h(f.x, f.z)).toBeLessThan(WATER_LEVEL);
      expect(h(f.x, f.z)).toBeGreaterThan(WATER_LEVEL - 0.9);
    }
    expect(riverSide(-100, 0)).toBe(-1);
    expect(riverSide(150, 0)).toBe(1);
  });

  it("xe tăng chạy qua cầu và lội qua hai khúc cạn, không xuống được sông sâu", () => {
    // Cầu: mặt cầu cao hơn đáy sông, xe đi trên mặt cầu.
    expect(tankGround(map, WAR_BRIDGE.x, WAR_BRIDGE.z)).toBeGreaterThan(h(WAR_BRIDGE.x, WAR_BRIDGE.z) + 4);
    // Từ bờ tây chạy sang, qua cầu, vào tới cổng đồn biên phòng bờ đông.
    const west = { x: WAR_BRIDGE.x - 38, y: 0, z: WAR_BRIDGE.z, rotY: Math.PI / 2 };
    expect(tankFits(map, west.x, west.z, west.rotY)).toBe(true);
    let p = drive(map, west, 10);
    expect(p.x).toBeGreaterThan(WAR_BRIDGE.x + WAR_BRIDGE.len / 2);
    for (const f of WAR_FORDS) {
      p = drive(map, { x: f.x + 32, y: 0, z: f.z, rotY: -Math.PI / 2 }, 12);
      expect(p.x).toBeLessThan(f.x - 20);
    }
    // Khúc sâu: xe khựng lại ở bờ.
    const z = 130;
    p = drive(map, { x: riverX(z) + 30, y: 0, z, rotY: -Math.PI / 2 }, 12);
    expect(p.x).toBeGreaterThan(riverX(z) + 5);
  });

  it("máy tìm đường qua sông bằng cầu hay khúc cạn", () => {
    // Từ đông sang tây ngang thị trấn: qua quảng trường bắc ngang kênh.
    const w = warRoute(150, 40, -50, 40);
    expect(w.z).toBe(0);
    expect(w.x).toBeGreaterThan(riverX(0));
    // Ở phía bắc: qua cầu Đồn Biên Phòng; ở phía nam: qua khúc cạn.
    expect(warRoute(150, 175, -100, 178).z).toBe(178);
    expect(warRoute(150, -110, -100, -110).z).toBe(WAR_FORDS[1]!.z);
    // Cùng bờ: đi thẳng.
    expect(warRoute(-100, 0, -50, 20)).toEqual({ x: -50, z: 20 });
  });

  it("Nhà Máy Xi Măng sát bờ biển, có cầu tàu trên mặt nước", () => {
    const g = WAR_SITES.find((s) => s.id === "g")!;
    // Ngay ngoài kè phía nam là nước sâu.
    expect(h(g.x - 18, g.z - g.rz - 10)).toBeLessThan(WATER_LEVEL - 2);
    const deck = map.boxes.find((b) => b.deck && outside(g, b.x, b.z, 40) === 0)!;
    expect(deck).toBeTruthy();
    expect(deck.y + deck.h / 2).toBeGreaterThan(WATER_LEVEL + 1);
  });

  it("đội trưởng tổ: người chơi trước, máy sau, mỗi tổ năm người", () => {
    const players: [string, { team: string; bot: boolean }][] = [
      ["bot3", { team: "blue", bot: true }],
      ["zed", { team: "blue", bot: false }],
      ["bot1", { team: "blue", bot: true }],
      ["bot2", { team: "red", bot: true }],
      ["bot10", { team: "blue", bot: true }],
      ["bot4", { team: "blue", bot: true }],
      ["bot5", { team: "blue", bot: true }],
      ["bot6", { team: "blue", bot: true }],
    ];
    expect(warSquadLeader(players, "bot4")).toBe("zed");
    expect(warSquadLeader(players, "zed")).toBe("zed");
    expect(warSquadLeader(players, "bot10")).toBe("bot6");
    expect(warSquadLeader(players, "bot2")).toBe("bot2");
    expect(warSquadLeader(players, "nobody")).toBe("");
  });
});
