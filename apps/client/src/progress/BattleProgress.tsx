import { useEffect, useRef, useState } from "react";
import { WEAPON, XP_LABEL, isXpKind, rankDef } from "@tentides/content";
import { Messages, type XpMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "../game/useRoomSnapshot.ts";
import { CallingCard } from "./CallingCard.tsx";
import { RankBadge } from "./RankBadge.tsx";
import { noteXp, resetMatchXp } from "./matchXp.ts";
import "./progress.css";

// Phần quân hàm trong trận: băng rôn thẻ tên của kẻ vừa hạ mình ("Bạn bị hạ bởi ..."), dòng "+100 XP" khi được
// cộng XP, thông báo lên quân hàm.

const KILLER_MS = 6000;

function weaponLabel(w: string): string {
  if (w === "zone") return "vùng độc";
  if (w === "mine") return "mìn";
  if (w === "frag") return "lựu đạn";
  if (w === "knife") return "dao";
  if (w === "tank") return "pháo xe tăng";
  return WEAPON.get(w)?.name ?? "";
}

/** Băng rôn "Bạn bị hạ bởi ...": thẻ tên, huy hiệu, quân hàm của kẻ hạ mình, hiện vài giây sau khi gục. */
export function KillerBanner({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const last = useRoomSnapshot(room, (s) => {
    let k: { n: number; killer: string; weapon: string; head: boolean } | null = null;
    for (const e of s.feed) if (e.victim === me && e.killer && e.killer !== me) k = { n: e.n, killer: e.killer, weapon: e.weapon, head: e.headshot };
    const p = k ? s.players.get(k.killer) : undefined;
    return k ? { ...k, name: p?.name ?? "?", rank: p?.badge.rank ?? 0, card: p?.badge.card ?? "", emblem: p?.badge.emblem ?? "" } : null;
  });
  const alive = useRoomSnapshot(room, (s) => s.players.get(me)?.alive ?? true);
  const war = useRoomSnapshot(room, (s) => s.battleMode === "war");
  const [shown, setShown] = useState(0);
  const seen = useRef(last?.n ?? 0);
  const lastN = last?.n ?? 0;
  useEffect(() => {
    // Chỉ lần gục mới (bộ đếm n đổi) mới hiện; vào phòng giữa chừng thì không hiện lần gục cũ.
    if (!lastN || lastN === seen.current) return;
    seen.current = lastN;
    setShown(lastN);
    const t = setTimeout(() => setShown((s) => (s === lastN ? 0 : s)), KILLER_MS);
    return () => clearTimeout(t);
  }, [lastN]);
  if (!last || shown !== last.n || alive) return null;
  return (
    // Chiến trường: bảng chọn chỗ hồi sinh nằm dưới nên băng rôn lên trên.
    <div className={war ? "b-killer war" : "b-killer"}>
      <CallingCard cardId={last.card} emblemId={last.emblem} name={last.name} rank={last.rank} kicker="Bạn bị hạ bởi" size="lg">
        {weaponLabel(last.weapon)}
        {last.head ? " · phát vào đầu" : ""}
        {last.rank > 0 ? ` · ${rankDef(last.rank)?.name}` : ""}
      </CallingCard>
    </div>
  );
}

interface XpLine {
  id: number;
  text: string;
  amount: number;
  rankUp?: number;
}

/** Dòng "+100 XP · Hạ gục" giữa màn hình, và "Lên quân hàm ..." khi qua mốc. */
export function XpFeed({ room }: { room: IslandRoom }) {
  const [lines, setLines] = useState<XpLine[]>([]);
  const seq = useRef(0);
  const lastRank = useRef(0);
  // XP trận này cho màn vinh danh cuối trận: xoá khi về sảnh / chuẩn bị trận mới.
  const phase = useRoomSnapshot(room, (s) => s.phase);
  useEffect(() => {
    if (phase === "lobby" || phase === "prep") resetMatchXp();
  }, [phase]);
  useEffect(() => {
    lastRank.current = room.state.players.get(myId(room))?.badge.rank ?? 0;
    return room.onMessage(Messages.xp, (m: XpMessage) => {
      noteXp(m);
      const add: XpLine[] = [{ id: ++seq.current, text: isXpKind(m.kind) ? XP_LABEL[m.kind] : m.kind, amount: m.amount }];
      if (lastRank.current > 0 && m.rank > lastRank.current) add.push({ id: ++seq.current, text: "", amount: 0, rankUp: m.rank });
      lastRank.current = m.rank;
      setLines((l) => [...l.slice(-3), ...add]);
      for (const a of add) setTimeout(() => setLines((l) => l.filter((x) => x.id !== a.id)), a.rankUp ? 3200 : 1800);
    });
  }, [room]);
  if (!lines.length) return null;
  return (
    <div className="b-xp" aria-live="polite">
      {lines.map((l) =>
        l.rankUp ? (
          <div key={l.id} className="rankup">
            <RankBadge rank={l.rankUp} size={30} /> Lên quân hàm {rankDef(l.rankUp)?.name}!
          </div>
        ) : (
          <div key={l.id}>
            <b>+{l.amount} XP</b> · {l.text}
          </div>
        ),
      )}
    </div>
  );
}
