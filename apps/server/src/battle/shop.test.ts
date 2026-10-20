import { describe, expect, it } from "vitest";
import { BR_KILL_REWARD, KILL_REWARD, POSSESS_LIMIT, SUPPLY, WEAPON, difficultyOf, supplyStations, validateLoadout, type WeaponLoadout } from "@tentides/content";
import { AirdropState, KitState, Messages, PlayerState } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { applyClassLoadout, buyLoadoutParts, cleanLoadouts } from "./gunsmith.ts";
import { receive, resetKit } from "./kit.ts";
import { applyBattleSettings } from "./settings.ts";
import { shopCheck } from "./shop.ts";

type Sent = { type: unknown; msg: unknown };
function fakeClient(sent: Sent[]) {
  return { sessionId: "s1", send: (type: unknown, msg: unknown) => sent.push({ type, msg }) } as never;
}

function makeRoom(mode: "solo" | "squad") {
  const room = new BattleRoom();
  room.broadcast = (() => {}) as typeof room.broadcast;
  room.state.battleMode = mode;
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
  const p = new PlayerState();
  p.name = "P0";
  p.created = true;
  room.state.players.set("human0", p);
  room.state.bots = 10;
  (room as unknown as { startMatch: () => void }).startMatch();
  return room;
}

const buy = (room: BattleRoom, item: string, loadout = false) => {
  const sent: Sent[] = [];
  (room as unknown as { buy: (id: string, item: string, c: unknown, l?: boolean) => void }).buy("human0", item, fakeClient(sent), loadout);
  return sent;
};

describe("cửa hàng Sinh tồn / Đồng đội: chỉ mua ở trạm tiếp tế giữa trận", () => {
  it("trạm tiếp tế có Kho vũ khí, bốc theo seed, ổn định giữa các lần gọi", () => {
    const room = makeRoom("solo");
    const a = supplyStations(room.map, 7);
    expect(a.length).toBe(1 + SUPPLY.extra);
    expect(a.some((s) => s.id === "armory")).toBe(true);
    expect(supplyStations(room.map, 7)).toBe(a);
  });

  it("lúc chuẩn bị mua ở đâu cũng được; vào trận thì phải đứng trong bán kính trạm", () => {
    const room = makeRoom("solo");
    const me = room.state.players.get("human0")!;
    me.kit.money = 5000;
    const st = supplyStations(room.map, room.state.worldSeed)[0]!;
    me.x = st.x + 1000;
    me.z = st.z + 1000;
    expect(room.state.phase).toBe("prep");
    expect(shopCheck(room.state, room.map, me.x, me.z).ok).toBe(true);
    expect(buy(room, "frag")).toEqual([]);
    expect(me.kit.frag).toBe(1);

    room.state.phase = "battle";
    expect(shopCheck(room.state, room.map, me.x, me.z).ok).toBe(false);
    const sent = buy(room, "frag");
    expect(sent[0]?.type).toBe(Messages.rejected);
    expect(String((sent[0]!.msg as { reason: string }).reason)).toContain("trạm tiếp tế");
    expect(me.kit.frag).toBe(1);
    expect(me.kit.money).toBe(5000 - 300);

    // Vừa trong bán kính thì mua được, vừa ngoài thì không.
    me.x = st.x + SUPPLY.radius - 1;
    me.z = st.z;
    expect(buy(room, "frag")).toEqual([]);
    expect(me.kit.frag).toBe(2);
    me.x = st.x + SUPPLY.radius + 2;
    expect(buy(room, "frag")[0]?.type).toBe(Messages.rejected);
    expect(me.kit.frag).toBe(2);
  });

  it("thùng thính đã chạm đất là điểm mua, thùng còn đang rơi thì không", () => {
    const room = makeRoom("squad");
    room.state.phase = "battle";
    const me = room.state.players.get("human0")!;
    me.x = 900;
    me.z = 900;
    const drop = new AirdropState();
    drop.x = 900;
    drop.z = 905;
    drop.landed = false;
    room.state.airdrops.set("d1", drop);
    expect(shopCheck(room.state, room.map, me.x, me.z).ok).toBe(false);
    drop.landed = true;
    expect(shopCheck(room.state, room.map, me.x, me.z).ok).toBe(true);
  });

  it("không đụng chiến trường, hải chiến; thưởng hạ gục Sinh tồn thấp hơn", () => {
    const room = makeRoom("solo");
    room.state.phase = "battle";
    for (const mode of ["war", "naval"]) {
      room.state.battleMode = mode;
      expect(shopCheck(room.state, room.map, 9999, 9999).ok).toBe(true);
    }
    expect(BR_KILL_REWARD).toBeLessThan(KILL_REWARD);
    room.state.battleMode = "solo";
    const [botId] = [...room.state.players.entries()].find(([, p]) => p.bot)!;
    const me = room.state.players.get("human0")!;
    const money = me.kit.money;
    room.kill(botId, "human0", "m416", false);
    expect(me.kit.money).toBe(money + BR_KILL_REWARD);
  });
});

describe("Đồng đội: giới hạn nhập xác", () => {
  it(`mỗi trận chỉ nhập xác được ${POSSESS_LIMIT} lần`, () => {
    const room = makeRoom("squad");
    (room as unknown as { beginBattle: () => void }).beginBattle();
    const me = room.state.players.get("human0")!;
    expect(me.gear.souls).toBe(POSSESS_LIMIT);
    for (let k = 0; k < POSSESS_LIMIT; k++) {
      room.kill("human0", "", "", false);
      expect(me.alive).toBe(false);
      const mate = [...room.state.players.entries()].find(([, p]) => p.bot && p.team === "human0" && p.alive)!;
      room.possess("human0", mate[0]);
      expect(me.alive).toBe(true);
    }
    expect(me.gear.souls).toBe(0);
    // Gục lần nữa: còn đồng đội sống mà không nhập được.
    room.kill("human0", "", "", false);
    const mate = [...room.state.players.entries()].find(([, p]) => p.bot && p.team === "human0" && p.alive);
    expect(mate).toBeTruthy();
    room.possess("human0", mate![0]);
    expect(me.alive).toBe(false);
    expect(room.state.players.has(mate![0])).toBe(true);
  });

  it("số lượt được đặt lại mỗi trận", () => {
    const room = makeRoom("squad");
    const me = room.state.players.get("human0")!;
    me.gear.souls = 0;
    (room as unknown as { startMatch: () => void }).startMatch();
    expect(me.gear.souls).toBe(POSSESS_LIMIT);
  });
});

describe("Gunsmith trong trận: kiểm tra bộ lắp ráp", () => {
  const m416: WeaponLoadout = { muzzle: "comp", grip: "vgrip", mag: "extmag", stock: "tacstock", sight: "x4" };

  it("bộ hỏng bị loại khi nạp: ô sai chỗ, không lắp vừa khẩu, khẩu không chỉnh được", () => {
    const out = cleanLoadouts({
      m416,
      s686: { muzzle: "comp" },
      rpg7: { sight: "x2" },
      nope: { sight: "x2" },
      akm: { grip: "comp" },
    });
    expect(Object.keys(out)).toEqual(["m416"]);
    expect(validateLoadout("m416", m416).ok).toBe(true);
  });

  it("mua theo cấu hình: lắp đủ món đủ tiền, bỏ qua món thiếu tiền hay hàng hiếm", () => {
    const kit = new KitState();
    resetKit(kit, 0);
    receive(kit, "m416", []);
    kit.active = "primary1";
    kit.money = 450 + 500 + 700;
    const { bought, skipped } = buyLoadoutParts(kit, "primary1", m416, []);
    expect(bought).toEqual(["sight:x4", "att:comp", "att:vgrip"]);
    expect(skipped).toEqual(["att:extmag", "att:tacstock"]);
    expect(kit.money).toBe(0);
    expect(kit.sight1).toBe("x4");
    expect(kit.att1.split(",").sort()).toEqual(["comp", "vgrip"]);

    const rare = new KitState();
    resetKit(rare, 9999);
    receive(rare, "m416", []);
    const r = buyLoadoutParts(rare, "primary1", { muzzle: "", grip: "", stock: "", sight: "", mag: "extquick" }, []);
    expect(r.bought).toEqual([]);
    expect(r.skipped).toEqual(["att:extquick"]);
    expect(rare.money).toBe(9999);
  });

  it("server không tin bộ không hợp khẩu: bộ M416 không lắp được lên shotgun", () => {
    const kit = new KitState();
    resetKit(kit, 9999);
    receive(kit, "s1897", []);
    const r = buyLoadoutParts(kit, "primary1", m416, []);
    expect(r.bought).toEqual([]);
    expect(kit.money).toBe(9999);
    expect(kit.att1).toBe("");
  });

  it("nút mua theo cấu hình qua BattleRoom.buy: cần bộ đã lưu, trừ đúng tiền", () => {
    const room = makeRoom("solo");
    const me = room.state.players.get("human0")!;
    me.kit.money = 10000;
    expect(buy(room, "m416", true)[0]?.type).toBe(Messages.rejected);
    expect(me.kit.money).toBe(10000);
    (room as unknown as { loadouts: Map<string, Record<string, WeaponLoadout>> }).loadouts.set("human0", { m416 });
    expect(buy(room, "m416", true)).toEqual([]);
    const price = WEAPON.get("m416")!.price + 700 + 500 + 450 + 500 + 400;
    expect(me.kit.money).toBe(10000 - price);
    expect(me.kit.primary1).toBe("m416");
    expect(me.kit.sight1).toBe("x4");
    expect(me.kit.att1.split(",").sort()).toEqual(["comp", "extmag", "tacstock", "vgrip"]);
    expect(me.kit.mag1).toBe(40);
  });

  it("chiến trường: lắp bộ đã lưu lên súng chính của lớp, theo luật lớp lính", () => {
    const kit = new KitState();
    resetKit(kit, 0);
    receive(kit, "m416", []);
    receive(kit, "sight:x2", []);
    const applied = applyClassLoadout(kit, { ...m416, sight: "x8", mag: "extquick" });
    expect(applied).toEqual(["att:comp", "att:vgrip", "att:tacstock"]);
    expect(kit.sight1).toBe("x2");

    const k2 = new KitState();
    resetKit(k2, 0);
    receive(k2, "m416", []);
    receive(k2, "sight:x8", []);
    expect(applyClassLoadout(k2, { muzzle: "", grip: "", mag: "", stock: "", sight: "x8" })).toEqual(["sight:x8"]);

    const k3 = new KitState();
    resetKit(k3, 0);
    receive(k3, "s1897", []);
    expect(applyClassLoadout(k3, m416)).toEqual([]);
    expect(k3.att1).toBe("");
    expect(applyClassLoadout(k3, undefined)).toEqual([]);
  });
});

describe("độ khó của máy: áp vào phòng", () => {
  it("đặt qua cài đặt phòng, mặc định Thường, bots.tune theo đó; máy đánh máy giữ mốc Khó", () => {
    const room = makeRoom("solo");
    expect(room.state.settings.botDifficulty).toBe("normal");
    expect(room.bots.tune).toBe(difficultyOf("normal"));
    applyBattleSettings(room.state, { difficulty: "veteran" });
    expect(room.state.settings.botDifficulty).toBe("veteran");
    expect(room.bots.tune).toBe(difficultyOf("veteran"));
    const human = room.state.players.get("human0")!;
    const bot = [...room.state.players.values()].find((p) => p.bot)!;
    expect(room.bots.tuneFor(human)).toBe(difficultyOf("veteran"));
    expect(room.bots.tuneFor(bot)).toBe(difficultyOf("hard"));
  });

  it("thời gian phản ứng khi bị bắn co giãn theo độ khó", () => {
    const room = makeRoom("solo");
    (room as unknown as { beginBattle: () => void }).beginBattle();
    const [botId] = [...room.state.players.entries()].find(([, p]) => p.bot)!;
    const brains = (room.bots as unknown as { brains: Map<string, { react: number; target: string }> }).brains;
    const sample = (level: "easy" | "veteran") => {
      room.state.settings.botDifficulty = level;
      let sum = 0;
      for (let k = 0; k < 200; k++) {
        brains.get(botId)!.target = "";
        room.bots.onHurt(botId, "human0");
        sum += brains.get(botId)!.react;
      }
      return sum / 200;
    };
    const easy = sample("easy");
    const vet = sample("veteran");
    expect(easy).toBeGreaterThan(vet * 2);
  });
});
