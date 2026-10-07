import { describe, expect, it } from "vitest";
import { CLASSES, GUNSMITH_WEAPON_IDS, SKINS, skinFitsWeapon } from "@tentides/content";
import { PLAYER_COLORS } from "@tentides/protocol";
import type { Profile } from "../account/account.ts";
import { colorForName, lobbyLook, roomLook } from "./looks.ts";

const profile = (equipped: Record<string, string>, loadouts: Profile["loadouts"] = {}): Profile => ({
  user: { id: 1, username: "a", coins: 0 },
  skins: [],
  equipped,
  pity: { sinceEpic: 0, sinceLegendary: 0 },
  loadouts,
});

describe("colorForName", () => {
  it("cùng tên thì cùng màu, màu nằm trong bảng màu người chơi", () => {
    expect(colorForName("Hải")).toBe(colorForName(" hải "));
    expect(PLAYER_COLORS).toContain(colorForName("Tester"));
  });
});

describe("lobbyLook", () => {
  it("khách: M416 trơn, ống chấm đỏ", () => {
    const l = lobbyLook("Tester", null);
    expect(l.weapon).toBe("m416");
    expect(l.sight).toBe("reddot");
    expect(l.skin).toBe("");
  });

  it("trưng khẩu có skin hiếm nhất đang lắp, kèm phụ kiện Gunsmith", () => {
    const [a, b] = GUNSMITH_WEAPON_IDS;
    const common = SKINS.find((s) => s.rarity === "common" && skinFitsWeapon(s.id, a!))!;
    const legend = SKINS.find((s) => s.rarity === "legendary" && skinFitsWeapon(s.id, b!))!;
    const l = lobbyLook("x", profile({ [a!]: common.id, [b!]: legend.id }, { [b!]: { muzzle: "", grip: "", mag: "", stock: "", sight: "x4" } }));
    expect(l.weapon).toBe(b);
    expect(l.skin).toBe(legend.id);
    expect(l.sight).toBe("x4");
  });
});

describe("roomLook", () => {
  const base = { color: "#e4572e", cls: "", outfit: "desert", primary: "", armor: 0, helmet: 0, skins: {} };

  it("theo lớp lính: súng chính đầu tiên, Bắn Tỉa mặc ghillie", () => {
    const l = roomLook({ ...base, cls: "recon" }, null);
    expect(l.weapon).toBe(CLASSES.recon.guns[0]);
    expect(l.outfit).toBe("ghillie");
    expect(l.sight).toBe(CLASSES.recon.sight);
  });

  it("chưa chọn lớp: súng đang có, trang phục trong phòng, skin trong phòng ưu tiên", () => {
    const l = roomLook({ ...base, primary: "akm", skins: { akm: "gunmetal" } }, profile({ akm: "olive-drab" }));
    expect(l.weapon).toBe("akm");
    expect(l.outfit).toBe("desert");
    expect(l.skin).toBe("gunmetal");
    expect(l.armor).toBeGreaterThan(0);
  });
});
