import { describe, expect, it } from "vitest";
import { CONTROLS, CONTROL_GROUPS, controlsFor, groupsFor, keyChips, keyLabel, keyText, resolveKeys, richText } from "./controlsMap.ts";

describe("bảng phím điều khiển", () => {
  it("id không trùng, mỗi mục thuộc một nhóm có thật", () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
    const groups = new Set(CONTROL_GROUPS.map((g) => g.id));
    for (const c of CONTROLS) {
      expect(groups.has(c.group), c.id).toBe(true);
      expect(c.keys.length, c.id).toBeGreaterThan(0);
    }
  });

  it("mọi nhóm có ít nhất một phím ở chế độ của nó", () => {
    for (const g of CONTROL_GROUPS)
      for (const mode of g.modes ?? [null]) expect(controlsFor(g.id, mode).length, `${g.id}/${mode}`).toBeGreaterThan(0);
  });

  it("lọc theo chế độ: hải chiến không có phím tiểu đội, tiểu đội có", () => {
    const naval = groupsFor("naval").map((g) => g.id);
    expect(naval).toContain("navalHelm");
    expect(naval).not.toContain("squad");
    expect(groupsFor("squad").map((g) => g.id)).toContain("squad");
    expect(groupsFor(null).length).toBe(CONTROL_GROUPS.length);
  });

  it("tên phím dễ đọc", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("Mouse2")).toBe("Chuột phải");
    expect(keyLabel("ShiftLeft+Mouse2")).toBe("Shift + Chuột phải");
    expect(keyLabel("Backquote")).toBe("~");
  });

  it("dải phím gom thành một ô, đổi phím thì dùng phím mới", () => {
    expect(keyChips("weapons")).toEqual(["1–3"]);
    expect(keyText("sprint")).toBe("giữ Shift");
    expect(resolveKeys("voicePtt")).toEqual(["KeyL"]);
    expect(keyChips("voicePtt", { voicePtt: ["KeyV"] })).toEqual(["V"]);
  });

  it("chèn phím vào đoạn chữ", () => {
    expect(richText("Bấm {reload} để thay đạn")).toBe("Bấm R để thay đạn");
  });
});
