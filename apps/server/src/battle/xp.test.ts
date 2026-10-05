import { describe, expect, it } from "vitest";
import { RANKS, XP_AWARD } from "@tentides/content";
import { PlayerState, type XpMessage } from "@tentides/protocol";
import { CardBody, LoadoutBody } from "../api/schemas.ts";
import { MatchRewards } from "./rewards.ts";
import { XpLedger, awardXp } from "./xp.ts";

const player = () => {
  const p = new PlayerState();
  p.alive = true;
  return p;
};

describe("sổ XP", () => {
  it("chỉ người có tài khoản, chỉ trong trận mới được XP; quân hàm cập nhật ngay", () => {
    const sent: [string, XpMessage][] = [];
    const ledger = new XpLedger((id, msg) => sent.push([id, msg]));
    const me = player();
    const guest = player();
    ledger.track("u7", me, RANKS[1]!.xp);
    ledger.track("abcdef123456", guest, 0);
    expect(me.badge.rank).toBe(2);
    expect(guest.badge.rank).toBe(0);
    // Ngoài trận (sảnh): không có XP.
    expect(ledger.award("u7", "kill")).toBe(0);
    ledger.active = true;
    expect(ledger.award("u7", "headshot")).toBe(XP_AWARD.headshot);
    expect(ledger.award("abcdef123456", "kill")).toBe(0);
    expect(ledger.award("bot1", "kill")).toBe(0);
    expect(sent).toEqual([["u7", { kind: "headshot", amount: 150, match: 150, rank: me.badge.rank }]]);
    // Đủ XP lên cấp kế.
    const need = RANKS[2]!.xp - RANKS[1]!.xp;
    ledger.award("u7", "capture", Math.ceil(need / XP_AWARD.capture));
    expect(me.badge.rank).toBeGreaterThanOrEqual(3);
    ledger.dispose();
  });

  it("drain dồn XP vào gốc, vào lại phòng giữ XP chờ ghi", () => {
    const ledger = new XpLedger();
    ledger.active = true;
    const a = player();
    ledger.track("u1", a, 0);
    ledger.award("u1", "kill", 3);
    const again = player();
    ledger.track("u1", again, 0);
    expect(ledger.pending("u1")).toBe(300);
    expect(again.badge.rank).toBe(a.badge.rank);
    expect([...ledger.drain()]).toEqual([["u1", { userId: 1, xp: 300 }]]);
    expect(ledger.pending("u1")).toBe(0);
    expect(ledger.drain().size).toBe(0);
    ledger.dispose();
  });

  it("awardXp tìm đúng phòng người chơi đang ở, phòng đóng thì thôi", () => {
    const room1 = new XpLedger();
    const room2 = new XpLedger();
    room1.active = room2.active = true;
    room1.track("u5", player(), 0);
    room2.track("u6", player(), 0);
    expect(awardXp("u5", "revive")).toBe(XP_AWARD.revive);
    expect(awardXp("u6", "resupply")).toBe(XP_AWARD.resupply);
    expect(room1.pending("u5")).toBe(150);
    expect(room2.pending("u6")).toBe(50);
    expect(awardXp("u999", "repair")).toBe(0);
    room1.dispose();
    expect(awardXp("u5", "revive")).toBe(0);
    room2.dispose();
  });

  it("hết trận: XP vào dòng kết quả, ngừng nhận XP tới trận sau", () => {
    const players = new Map<string, PlayerState>([
      ["u1", player()],
      ["u2", player()],
    ]);
    const r = new MatchRewards();
    for (const [id, p] of players) r.xp.track(id, p, 0);
    r.begin(players);
    r.xp.award("u1", "kill");
    r.xp.award("u1", "headshot");
    r.onDeath("u2", players);
    players.get("u2")!.alive = false;
    const lines = r.finish(players, "u1", "solo");
    expect(lines.find((l) => l.playerId === "u1")?.xp).toBe(250);
    expect(lines.find((l) => l.playerId === "u2")?.xp).toBe(0);
    expect(r.xp.award("u1", "kill")).toBe(0);
    r.dispose();
  });
});

describe("dữ liệu Gunsmith, thẻ tên gửi lên", () => {
  it("LoadoutBody: súng phải có thật, ô lạ bị chặn", () => {
    expect(LoadoutBody.safeParse({ weaponId: "m416", loadout: { muzzle: "comp", sight: "x4" }, skinId: "gold" }).success).toBe(true);
    expect(LoadoutBody.safeParse({ weaponId: "m416", loadout: {} }).success).toBe(true);
    expect(LoadoutBody.safeParse({ weaponId: "rocket", loadout: {} }).success).toBe(false);
    expect(LoadoutBody.safeParse({ weaponId: "m416", loadout: { laser: "x" } }).success).toBe(false);
    expect(LoadoutBody.safeParse({ weaponId: "m416", loadout: { muzzle: "x".repeat(100) } }).success).toBe(false);
  });
  it("CardBody", () => {
    expect(CardBody.safeParse({ cardId: "tide", emblemId: "" }).success).toBe(true);
    expect(CardBody.safeParse({ cardId: 3 }).success).toBe(false);
  });
});
