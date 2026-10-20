import { describe, expect, it } from "vitest";
import { controlDef, richParts } from "../controlsMap.ts";
import { advance, applies, hasSeen, isDone, isFinished, isManual, loadSeen, markSeen, progressOf, scriptFor, skipStep, startRun, stepNumber, visibleCount, type SeenStore, type Signals, type TutorialCtx, type TutorialRun, type TutorialStep } from "./steps.ts";

const ctx = (over: Partial<TutorialCtx> = {}): TutorialCtx => ({ mode: "war", role: "", cls: "", gadget: true, vehicles: true, ...over });
const memory = (): SeenStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("kịch bản hướng dẫn", () => {
  it("mọi chế độ có kịch bản, id bước không trùng", () => {
    for (const mode of ["solo", "squad", "war", "naval"] as const) {
      const script = scriptFor(mode);
      expect(script.length).toBeGreaterThan(4);
      expect(new Set(script.map((s) => s.id)).size).toBe(script.length);
    }
  });

  it("mọi {phím} trong lời hướng dẫn có trong bảng phím", () => {
    for (const mode of ["solo", "squad", "war", "naval"] as const)
      for (const step of scriptFor(mode))
        for (const part of richParts(step.hint)) if ("control" in part) expect(controlDef(part.control), `${mode}/${step.id}: {${part.control}}`).toBeDefined();
    // Chỗ chèn phím không có trong bảng thì giữ nguyên chữ, không mất.
    expect(richParts("bấm {khongCo} đi").every((p) => "text" in p)).toBe(true);
    expect(richParts("bấm {khongCo} đi").map((p) => ("text" in p ? p.text : "")).join("")).toBe("bấm {khongCo} đi");
  });
});

describe("tiến trình bước", () => {
  const step: TutorialStep = { id: "t", title: "t", hint: "", need: { shots: 3, reload: 1 } };

  it("tính mức tăng so với lúc bắt đầu bước, không phải số tuyệt đối", () => {
    const start: Signals = { shots: 10, reload: 2 };
    expect(isDone(step, { shots: 12, reload: 3 }, start)).toBe(false);
    expect(isDone(step, { shots: 13, reload: 3 }, start)).toBe(true);
    expect(isDone(step, { shots: 13, reload: 2 }, start)).toBe(false);
  });

  it("any: một điều kiện đạt là xong", () => {
    const any: TutorialStep = { ...step, any: true };
    expect(isDone(any, { shots: 0, reload: 1 }, {})).toBe(true);
    expect(isDone(any, { shots: 0, reload: 0 }, {})).toBe(false);
  });

  it("tín hiệu trạng thái: dương là đang ở, 0 là không còn ở", () => {
    const man: TutorialStep = { id: "m", title: "", hint: "", state: { stationed: 1 } };
    const leave: TutorialStep = { id: "l", title: "", hint: "", state: { stationed: 0 } };
    expect(isDone(man, { stationed: 0 }, {})).toBe(false);
    expect(isDone(man, { stationed: 1 }, {})).toBe(true);
    expect(isDone(leave, { stationed: 1 }, {})).toBe(false);
    expect(isDone(leave, { stationed: 0 }, {})).toBe(true);
  });

  it("bước chỉ để đọc không tự xong", () => {
    const read: TutorialStep = { id: "r", title: "", hint: "", need: {} };
    expect(isManual(read)).toBe(true);
    expect(isDone(read, { anything: 99 }, {})).toBe(false);
  });

  it("tiến độ là trung bình các điều kiện (tối đa 1)", () => {
    expect(progressOf(step, { shots: 3, reload: 0 }, {})).toBeCloseTo(0.5);
    expect(progressOf(step, { shots: 30, reload: 5 }, {})).toBe(1);
    expect(progressOf({ ...step, any: true }, { shots: 3, reload: 0 }, {})).toBe(1);
  });
});

describe("advance", () => {
  const script: TutorialStep[] = [
    { id: "a", title: "", hint: "", need: { walk: 5 } },
    { id: "b", title: "", hint: "", need: { shots: 2 } },
    { id: "c", title: "", hint: "", need: { key: 1 }, requires: "gadget" },
    { id: "d", title: "", hint: "", need: {} },
  ];

  it("qua bước khi làm đủ, mỗi lần chỉ một bước và đo lại từ đầu", () => {
    let run = startRun({ walk: 0, shots: 0 });
    run = advance(script, run, { walk: 3, shots: 5 }, ctx());
    expect(run.index).toBe(0);
    // Làm xong bước a lúc shots đã là 5: bước b vẫn phải bắn thêm 2 phát nữa.
    run = advance(script, run, { walk: 6, shots: 5 }, ctx());
    expect(run.index).toBe(1);
    expect(run.start.shots).toBe(5);
    run = advance(script, run, { walk: 6, shots: 6 }, ctx());
    expect(run.index).toBe(1);
    run = advance(script, run, { walk: 6, shots: 7 }, ctx());
    expect(run.index).toBe(2);
  });

  it("bỏ bước không áp dụng (không có khí tài)", () => {
    let run: TutorialRun = { index: 1, start: { walk: 6, shots: 0 } };
    run = advance(script, run, { walk: 6, shots: 2 }, ctx({ gadget: false }));
    expect(run.index).toBe(3);
    expect(script[run.index]!.id).toBe("d");
  });

  it("bước đọc: dừng lại tới khi bấm Enter (skipStep), rồi hết kịch bản", () => {
    let run: TutorialRun = { index: 3, start: {} };
    run = advance(script, run, { anything: 1 }, ctx());
    expect(run.index).toBe(3);
    expect(isFinished(script, run)).toBe(false);
    run = skipStep(script, run, {}, ctx());
    expect(isFinished(script, run)).toBe(true);
    // Đã xong thì không đổi nữa.
    expect(advance(script, run, { walk: 99 }, ctx())).toBe(run);
  });

  it("skipStep nhảy qua cả bước không áp dụng", () => {
    const run = skipStep(script, { index: 1, start: {} }, {}, ctx({ gadget: false }));
    expect(script[run.index]!.id).toBe("d");
  });

  it("đếm số bước hiển thị theo hoàn cảnh", () => {
    expect(visibleCount(script, ctx())).toBe(4);
    expect(visibleCount(script, ctx({ gadget: false }))).toBe(3);
    expect(stepNumber(script, { index: 3, start: {} }, ctx({ gadget: false }))).toBe(3);
  });
});

describe("hải chiến: bước theo vai", () => {
  const naval = scriptFor("naval");
  const ids = (role: TutorialCtx["role"], cls = "battleship") => naval.filter((s) => applies(s, ctx({ mode: "naval", role, cls }))).map((s) => s.id);

  it("mỗi vai chỉ thấy bước của mình", () => {
    expect(ids("captain")).toEqual(expect.arrayContaining(["throttle", "rudder", "torpedo"]));
    expect(ids("captain")).not.toContain("gunFire");
    expect(ids("captain")).not.toContain("submarine");
    expect(ids("gunner")).toEqual(expect.arrayContaining(["gunAim", "gunFire"]));
    expect(ids("gunner")).not.toContain("throttle");
    expect(ids("aa")).toEqual(expect.arrayContaining(["aaAim", "aaFire"]));
    expect(ids("navigator")).toContain("decoy");
    expect(ids("navigator")).not.toContain("torpedo");
    expect(ids("pilot", "carrier")).toEqual(expect.arrayContaining(["jetLaunch", "jetFly", "jetBomb", "jetEject"]));
    expect(ids("missile", "cruiser")).toEqual(expect.arrayContaining(["launch", "steerWarhead", "release"]));
    expect(ids("torpedo", "submarine")).toContain("launch");
  });

  it("tàu ngầm có thêm bước lặn / nổi cho thuyền trưởng", () => {
    expect(ids("captain", "submarine")).toContain("submarine");
  });

  it("chưa đứng vị trí nào thì chưa bỏ bước theo vai (chờ vào lại vị trí)", () => {
    expect(ids("")).toContain("gunFire");
  });

  it("các bước chung có ở mọi vai", () => {
    for (const role of ["captain", "gunner", "aa", "pilot"] as const) expect(ids(role)).toEqual(expect.arrayContaining(["deckWalk", "man", "leave", "damage", "done"]));
  });

  it("đi từ boong tới vị trí: đi bộ, rồi bấm F vào vị trí", () => {
    let run = startRun({ walk: 0, stationed: 0 });
    run = advance(naval, run, { walk: 5.5, stationed: 0 }, ctx({ mode: "naval" }));
    expect(naval[run.index]!.id).toBe("man");
    run = advance(naval, run, { walk: 5.5, stationed: 1 }, ctx({ mode: "naval", role: "gunner", cls: "battleship" }));
    expect(naval[run.index]!.id).toBe("gunAim");
  });
});

describe("nhớ đã xem hướng dẫn", () => {
  it("ghi nhớ từng chế độ riêng", () => {
    const store = memory();
    expect(hasSeen("war", store)).toBe(false);
    markSeen("war", store);
    markSeen("naval", store);
    markSeen("war", store);
    expect(loadSeen(store).sort()).toEqual(["naval", "war"]);
    expect(hasSeen("war", store)).toBe(true);
    expect(hasSeen("solo", store)).toBe(false);
  });

  it("dữ liệu hỏng hay trình duyệt chặn lưu thì không văng lỗi", () => {
    const bad = memory();
    bad.data["tentides.tutorial"] = "{không phải json";
    expect(loadSeen(bad)).toEqual([]);
    bad.data["tentides.tutorial"] = JSON.stringify(["war", "hack", 5]);
    expect(loadSeen(bad)).toEqual(["war"]);
    const blocked: SeenStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSeen(blocked)).toEqual([]);
    expect(() => markSeen("war", blocked)).not.toThrow();
    expect(() => markSeen("war", null)).not.toThrow();
  });
});
