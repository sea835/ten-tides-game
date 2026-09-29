import { describe, expect, it } from "vitest";
import { KitState } from "@tentides/protocol";
import { everything, giveWeapon, priceOf, receive, resetKit } from "./kit.ts";
import { WEAPON } from "@tentides/content";

function kit() {
  const k = new KitState();
  resetKit(k, 4000);
  return k;
}

describe("hành trang Battleground", () => {
  it("súng vào ô trống trước, hết ô thì thay khẩu đang cầm và rơi khẩu cũ", () => {
    const k = kit();
    const dropped: string[] = [];
    receive(k, "m416", dropped);
    receive(k, "akm", dropped);
    receive(k, "p92", dropped);
    expect([k.primary1, k.primary2, k.pistol]).toEqual(["m416", "akm", "p92"]);
    expect(dropped).toEqual([]);
    k.active = "primary1";
    receive(k, "scar", dropped);
    expect(k.primary1).toBe("scar");
    expect(dropped).toEqual(["m416"]);
    expect(k.mag1).toBe(WEAPON.get("scar")!.mag);
  });

  it("đạn còn trong băng của khẩu bị thay được cất lại vào đạn dự trữ", () => {
    const k = kit();
    receive(k, "m416", []);
    receive(k, "akm", []);
    k.active = "primary1";
    const dropped = giveWeapon(k, WEAPON.get("scar")!);
    expect(dropped).toEqual(["m416"]);
    expect(k.ammo.get("556")).toBe(30);
  });

  it("giáp, mũ mới thay giáp cũ (giáp cũ rơi xuống), đồ ném có giới hạn", () => {
    const k = kit();
    const dropped: string[] = [];
    receive(k, "armor:1", dropped);
    receive(k, "armor:2", dropped);
    expect(k.armor).toBe(2);
    expect(dropped).toEqual(["armor:1"]);
    for (let i = 0; i < 6; i++) receive(k, "frag", dropped);
    expect(k.frag).toBe(4);
    expect(receive(k, "frag", dropped)).toBe(false);
  });

  it("hàng hiếm không bán, trang phục miễn phí", () => {
    expect(priceOf("awm")).toBeNull();
    expect(priceOf("m249")).toBeNull();
    expect(priceOf("armor:3")).toBeNull();
    expect(priceOf("m416")).toBe(2700);
    expect(priceOf("outfit:ghillie")).toBe(0);
    expect(priceOf("rocket")).toBeNull();
  });

  it("gục thì rơi hết đồ, kể cả đạn trong băng và nửa số tiền", () => {
    const k = kit();
    receive(k, "m416", []);
    receive(k, "helmet:2", []);
    const items = everything(k);
    expect(items).toContain("m416");
    expect(items).toContain("helmet:2");
    expect(items).toContain("ammo:556:30");
    expect(items).toContain("money:2000");
  });
});
