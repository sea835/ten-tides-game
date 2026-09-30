import { describe, expect, it } from "vitest";
import { KitState } from "@tentides/protocol";
import { everything, giveWeapon, magSize, priceOf, receive, reloadTime, resetKit } from "./kit.ts";
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

  it("ống ngắm lắp lên khẩu hợp, thay ống cũ (ống cũ rơi), súng lục không lắp ống 4x", () => {
    const k = kit();
    const dropped: string[] = [];
    expect(receive(k, "sight:x4", dropped)).toBe(false);
    receive(k, "p92", dropped);
    expect(receive(k, "sight:x4", dropped)).toBe(false);
    expect(receive(k, "sight:reddot", dropped)).toBe(true);
    expect(k.sightP).toBe("reddot");
    receive(k, "kar98k", dropped);
    expect(receive(k, "sight:x4", dropped)).toBe(true);
    expect(k.sight1).toBe("x4");
    k.active = "primary1";
    receive(k, "sight:x8", dropped);
    expect(k.sight1).toBe("x8");
    expect(dropped).toEqual(["sight:x4"]);
    expect(everything(k)).toContain("sight:x8");
    expect(priceOf("sight:x8")).toBeNull();
    expect(priceOf("sight:x2")).toBe(300);
  });

  it("phụ kiện: lắp đúng khẩu hợp, thay món cùng chỗ (món cũ rơi), băng mở rộng thêm đạn, tháo thì trả đạn thừa", () => {
    const k = kit();
    const dropped: string[] = [];
    expect(receive(k, "att:comp", dropped)).toBe(false);
    receive(k, "p92", dropped);
    expect(receive(k, "att:comp", dropped)).toBe(false);
    expect(receive(k, "att:suppressor", dropped)).toBe(true);
    expect(k.attP).toBe("suppressor");
    receive(k, "m416", dropped);
    k.active = "primary1";
    expect(receive(k, "att:comp", dropped)).toBe(true);
    expect(receive(k, "att:vgrip", dropped)).toBe(true);
    expect(k.att1.split(",").sort()).toEqual(["comp", "vgrip"]);
    expect(receive(k, "att:suppressor", dropped)).toBe(true);
    expect(k.att1.split(",").sort()).toEqual(["suppressor", "vgrip"]);
    expect(dropped).toContain("att:comp");
    k.mag1 = 30;
    receive(k, "att:extmag", dropped);
    expect(magSize(k, "primary1")).toBe(41);
    k.mag1 = 41;
    // Khẩu đang cầm đã có băng: băng thay nhanh sang khẩu còn trống chỗ (súng lục).
    receive(k, "att:quickmag", dropped);
    expect(k.attP.split(",")).toContain("quickmag");
    // Lần nữa thì chỉ còn khẩu chính: thay băng mở rộng, đạn thừa trả về dự trữ.
    receive(k, "att:quickmag", dropped);
    expect(k.att1.split(",")).toContain("quickmag");
    expect(k.mag1).toBe(30);
    expect(k.ammo.get("556")).toBe(11);
    expect(reloadTime(k, "primary1")).toBeCloseTo(WEAPON.get("m416")!.reload * 0.7);
    expect(everything(k)).toEqual(expect.arrayContaining(["att:quickmag", "att:vgrip", "att:suppressor"]));
  });
});
