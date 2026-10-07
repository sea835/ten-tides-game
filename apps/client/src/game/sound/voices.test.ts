import { describe, expect, it } from "vitest";
import { DISTANT_GUNFIRE, VoiceLimiter, defaultPriority, type VoicePriority, type VoiceSlot } from "./voices.ts";

function slot(prio: VoicePriority, level: number, end = 2): VoiceSlot & { killed: boolean } {
  const s = {
    prio,
    level,
    end,
    killed: false,
    score: (now: number) => level * Math.max(0, (end - now) / end),
    kill: () => {
      s.killed = true;
    },
  };
  return s;
}

function fill(lim: VoiceLimiter, prio: VoicePriority, level: number, n: number) {
  const out: ReturnType<typeof slot>[] = [];
  for (let i = 0; i < n; i++) {
    const a = lim.admit(prio, level, 0);
    expect(a.ok).toBe(true);
    const s = slot(prio, level);
    lim.add(s, a.ok ? a.victim : null);
    out.push(s);
  }
  return out;
}

describe("VoiceLimiter", () => {
  it("không vượt trần, tiếng của mình cướp chỗ tiếng súng xa", () => {
    const lim = new VoiceLimiter(4);
    const far = fill(lim, 3, 0.5, 4);
    const a = lim.admit(0, 0.2, 0);
    expect(a.ok && a.victim).toBeTruthy();
    lim.add(slot(0, 0.2), a.ok ? a.victim : null);
    expect(lim.count).toBe(4);
    expect(far.filter((s) => s.killed)).toHaveLength(1);
  });

  it("tiếng kém ưu tiên hơn mọi tiếng đang phát thì bị bỏ, không cướp", () => {
    const lim = new VoiceLimiter(3);
    fill(lim, 1, 0.3, 3);
    expect(lim.admit(3, 1, 0).ok).toBe(false);
    expect(lim.admit(2, 1, 0).ok).toBe(false);
    expect(lim.dropped).toBe(2);
  });

  it("cùng mức thì cướp tiếng nhỏ nhất / sắp hết nhất, chỉ khi tiếng mới to hơn rõ", () => {
    const lim = new VoiceLimiter(2);
    const [loud] = fill(lim, 2, 0.8, 1);
    const [quiet] = fill(lim, 2, 0.1, 1);
    const a = lim.admit(2, 0.5, 0);
    expect(a.ok && a.victim).toBe(quiet);
    expect(lim.admit(2, 0.05, 0).ok).toBe(false);
    expect(loud!.killed).toBe(false);
  });

  it("chọn nạn nhân ở mức kém nhất trước, rồi mới xét độ to", () => {
    const lim = new VoiceLimiter(2);
    const [p2] = fill(lim, 2, 0.01, 1);
    const [p3] = fill(lim, 3, 0.9, 1);
    const a = lim.admit(1, 0.2, 0);
    expect(a.ok && a.victim).toBe(p3);
    expect(p2!.killed).toBe(false);
  });

  it("bỏ tiếng không nghe được trước khi dựng nút, tiếng đã hết tự trả chỗ", () => {
    const lim = new VoiceLimiter(1);
    expect(lim.admit(0, 0.001, 0).ok).toBe(false);
    fill(lim, 0, 0.5, 1);
    // Sau khi tiếng cũ hết (end = 2 s), chỗ trống lại.
    const a = lim.admit(3, 0.1, 5);
    expect(a.ok && a.victim).toBe(null);
  });

  it("mức mặc định theo bus và khoảng cách", () => {
    expect(defaultPriority("sfx", null)).toBe(1);
    expect(defaultPriority("sfx", 20)).toBe(2);
    expect(defaultPriority("sfx", DISTANT_GUNFIRE + 1)).toBe(3);
    expect(defaultPriority("ambience", 1)).toBe(3);
  });
});
