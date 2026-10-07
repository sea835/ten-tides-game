import { describe, expect, it } from "vitest";
import { Messages, PlayerState, type MatchSummaryMessage } from "@tentides/protocol";
import { BattleRoom } from "./BattleRoom.ts";
import { Bots } from "./bots.ts";
import { ASSIST_WINDOW_MS, MatchStats, SCORE, noteSupport, pickMvp } from "./mvp.ts";
import { Vehicles } from "./vehicles.ts";
import { War } from "./war.ts";
import { awardXp } from "./xp.ts";

// Bảng vinh danh sau trận: đếm hạ gục, trợ giúp, chiếm cứ điểm, hỗ trợ; bảng tổng kết gửi lúc hết trận.

function players(list: [string, string][]) {
  const m = new Map<string, PlayerState>();
  for (const [id, team] of list) {
    const p = new PlayerState();
    p.name = id;
    p.team = team;
    m.set(id, p);
  }
  return m;
}

describe("MatchStats", () => {
  it("hạ gục, lần gục, trợ giúp trong 10 giây (không tính kẻ hạ, đồng đội người gục, quá hạn)", () => {
    let now = 0;
    const st = new MatchStats(() => now);
    const ps = players([
      ["a", "blue"],
      ["b", "blue"],
      ["c", "blue"],
      ["d", "red"],
      ["e", "red"],
    ]);
    st.begin(ps.keys());
    st.onDamage("d", "b"); // trợ giúp
    st.onDamage("d", "e"); // đồng đội của d: không tính
    st.onDamage("d", "c"); // quá 10 giây: không tính
    now = 2000;
    st.onDamage("d", "b");
    now = 1000 + ASSIST_WINDOW_MS + 1;
    st.onDamage("d", "a"); // kẻ hạ: tính mạng, không tính trợ giúp
    st.onKill("d", "a", true, ps);
    expect(st.get("a")).toMatchObject({ kills: 1, assists: 0 });
    expect(st.get("b").assists).toBe(1);
    expect(st.get("c").assists).toBe(0);
    expect(st.get("e").assists).toBe(0);
    expect(st.get("d").deaths).toBe(1);
    // Hạ nhầm đồng đội: không tính mạng.
    st.onKill("b", "c", false, ps);
    expect(st.get("c").kills).toBe(0);
    expect(st.get("b").deaths).toBe(1);
    // Đã gục thì xoá dấu sát thương: lần gục sau không tính lại trợ giúp cũ.
    st.onKill("d", "a", true, ps);
    expect(st.get("b").assists).toBe(1);
  });

  it("ngoài trận không đếm; noteSupport tìm đúng phòng theo id người chơi", () => {
    const st = new MatchStats();
    const ps = players([
      ["s1", "blue"],
      ["s2", "red"],
    ]);
    st.noteCapture("s1");
    expect(st.get("s1").captures).toBe(0);
    st.begin(ps.keys());
    noteSupport("s1");
    noteSupport("s1", 2);
    // awardXp tiếp tế, sửa xe, hồi sinh tự tính hỗ trợ (cả người không có tài khoản).
    awardXp("s2", "repair");
    awardXp("s2", "kill");
    expect(st.get("s1").support).toBe(3);
    expect(st.get("s2").support).toBe(1);
    st.dispose();
    noteSupport("s1");
    expect(st.get("s1").support).toBe(3);
  });

  it("bảng tổng kết: xếp theo điểm, MVP từng hạng mục, không ai đạt thì bỏ trống", () => {
    const st = new MatchStats();
    const ps = players([
      ["k", "blue"],
      ["c", "blue"],
      ["s", "red"],
    ]);
    st.begin(ps.keys());
    st.onKill("s", "k", true, ps);
    st.onKill("c", "k", false, ps);
    st.noteCapture("c");
    st.noteCapture("c");
    st.noteSupport("s", 4);
    const sum = st.summary(ps, "blue", "war");
    expect(sum.mode).toBe("war");
    expect(sum.winner).toBe("blue");
    expect(sum.rows.map((r) => r.id)).toEqual(["c", "s", "k"]);
    expect(sum.rows[0]).toMatchObject({ id: "c", captures: 2, score: 2 * SCORE.capture, name: "c", team: "blue" });
    expect(sum.mvp).toEqual([
      { kind: "kills", id: "k", value: 1 },
      { kind: "captures", id: "c", value: 2 },
      { kind: "support", id: "s", value: 4 },
    ]);
    // Hết trận thì thôi đếm.
    st.noteCapture("c");
    expect(st.get("c").captures).toBe(2);
    expect(pickMvp([])).toEqual([]);
  });
});

function makeWar() {
  const room = new BattleRoom();
  const sent: { type: string; msg: unknown }[] = [];
  room.broadcast = ((type: string, msg: unknown) => void sent.push({ type, msg })) as typeof room.broadcast;
  room.state.battleMode = "war";
  room.bots = new Bots(room);
  room.vehicles = new Vehicles(room);
  room.war = new War(room);
  (room as unknown as { setupMap: (seed: number) => void }).setupMap(7);
  for (const id of ["h1", "h2", "h3", "h4"]) {
    const p = new PlayerState();
    p.name = id;
    p.created = true;
    room.state.players.set(id, p);
    room.stats.track(id);
  }
  room.war.pickSide("h1", "blue");
  room.war.pickSide("h2", "blue");
  room.war.pickSide("h3", "red");
  room.war.pickSide("h4", "red");
  room.state.bots = 4;
  (room as unknown as { startMatch: () => void }).startMatch();
  (room as unknown as { beginBattle: () => void }).beginBattle();
  return { room, sent };
}

describe("vinh danh MVP trong phòng chiến trường", () => {
  it("đếm hạ gục, trợ giúp, chiếm cứ điểm rồi gửi bảng tổng kết lúc hết trận", () => {
    const { room, sent } = makeWar();
    const ps = room.state.players;
    for (const id of ["h1", "h2", "h3", "h4"]) {
      const p = ps.get(id)!;
      p.alive = true;
      p.hp = 100;
      p.vehicle = "";
    }
    // h2 bắn h3 trước, h1 kết liễu: h1 một mạng, h2 một trợ giúp.
    room.damage("h3", 30, "body", "h2", "m416");
    room.damage("h3", 500, "head", "h1", "m416");
    expect(ps.get("h3")!.alive).toBe(false);
    expect(room.stats.get("h1").kills).toBe(1);
    expect(room.stats.get("h2").assists).toBe(1);
    expect(room.stats.get("h3").deaths).toBe(1);
    // Vùng độc (không có người gây): chỉ tính lần gục.
    room.damage("h4", 500, "zone", "", "zone");
    expect(room.stats.get("h4").deaths).toBe(1);

    // h1 đứng một mình trong cứ điểm sắp chiếm xong.
    for (const [id, q] of ps) if (id !== "h1") q.alive = false;
    const p = ps.get("h1")!;
    const flag = [...room.state.flags.values()][0]!;
    p.x = flag.x;
    p.z = flag.z;
    p.y = flag.y;
    flag.owner = "";
    flag.progress = 0.999;
    (room as unknown as { tick: (dt: number) => void }).tick(0.5);
    expect(flag.owner).toBe("blue");
    expect(room.stats.get("h1").captures).toBe(1);

    room.endWar("blue");
    const msg = sent.find((s) => s.type === Messages.matchSummary)?.msg as MatchSummaryMessage | undefined;
    expect(msg).toBeTruthy();
    expect(msg!.mode).toBe("war");
    expect(msg!.winner).toBe("blue");
    expect(msg!.rows.length).toBe(ps.size);
    expect(msg!.rows[0]).toMatchObject({ id: "h1", kills: 1, captures: 1, team: "blue", bot: false });
    expect(msg!.rows.find((r) => r.id === "h2")).toMatchObject({ assists: 1 });
    expect(msg!.mvp.find((m) => m.kind === "kills")).toEqual({ kind: "kills", id: "h1", value: 1 });
    expect(msg!.mvp.find((m) => m.kind === "captures")).toEqual({ kind: "captures", id: "h1", value: 1 });
    expect(msg!.mvp.find((m) => m.kind === "support")).toEqual({ kind: "support", id: "h2", value: 1 });
    room.onDispose();
  });
});
