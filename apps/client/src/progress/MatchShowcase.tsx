import { useEffect, useState } from "react";
import { Crosshair, Flag, HeartHandshake } from "lucide-react";
import { Messages, type MatchSummaryMessage, type MatchSummaryRow, type MvpKind } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { useRoomSnapshot } from "../game/useRoomSnapshot.ts";
import { CallingCard } from "./CallingCard.tsx";
import { RankBadge } from "./RankBadge.tsx";
import { VictoryPodium } from "./VictoryPodium.tsx";
import "./progress.css";

// Bảng vinh danh sau trận: ba thẻ MVP (Hạ gục, Chiếm cứ điểm, Hỗ trợ) trên bục, thẻ tên và quân hàm của người được
// vinh danh, rồi bảng điểm đầy đủ (hạ gục, trợ giúp, gục, cứ điểm, hỗ trợ, điểm). Server gửi Messages.matchSummary
// lúc hết trận (cả người vào phòng lúc đang tổng kết).

const MVP_META: Record<MvpKind, { title: string; unit: string; icon: typeof Crosshair; place: number }> = {
  kills: { title: "MVP Hạ gục", unit: "hạ gục", icon: Crosshair, place: 1 },
  captures: { title: "MVP Chiếm cứ điểm", unit: "lần chiếm", icon: Flag, place: 2 },
  support: { title: "MVP Hỗ trợ", unit: "lượt hỗ trợ", icon: HeartHandshake, place: 3 },
};
/** Bục: MVP Hạ gục ở giữa (cao nhất), Chiếm cứ điểm bên trái, Hỗ trợ bên phải. */
const PODIUM: MvpKind[] = ["captures", "kills", "support"];

/** Nhận bảng tổng kết trận vừa xong; sang trận mới thì xoá. */
export function useMatchSummary(room: IslandRoom): MatchSummaryMessage | null {
  const [summary, setSummary] = useState<MatchSummaryMessage | null>(null);
  const phase = useRoomSnapshot(room, (s) => s.phase);
  useEffect(() => room.onMessage(Messages.matchSummary, (m: MatchSummaryMessage) => setSummary(m)), [room]);
  useEffect(() => {
    if (phase !== "ended") setSummary(null);
  }, [phase]);
  return phase === "ended" ? summary : null;
}

const TEAM_COLOR: Record<string, string> = { blue: "#2f6bff", red: "#e0332b" };

function MvpCard({ kind, row, value, place }: { kind: MvpKind; row: MatchSummaryRow | undefined; value: number; place: number }) {
  const meta = MVP_META[kind];
  const Icon = meta.icon;
  return (
    <div className={`mvp-card p${place} ${row ? "" : "empty"}`} style={{ animationDelay: `${0.15 * place}s` }}>
      <div className="mvp-title">
        <Icon size={16} /> {meta.title}
      </div>
      {row ? (
        <>
          <CallingCard cardId={row.card} emblemId={row.emblem} name={row.name.replace("🤖 ", "")} rank={row.rank} size="sm">
            {row.bot ? "Máy" : row.rank ? "" : "Khách"}
          </CallingCard>
          <div className="mvp-value">
            <b>{value}</b> {meta.unit}
          </div>
          <div className="mvp-line">
            {row.kills} hạ · {row.assists} trợ giúp · {row.deaths} gục
          </div>
        </>
      ) : (
        <div className="mvp-none">Chưa ai đạt</div>
      )}
      <div className="mvp-step">{place}</div>
    </div>
  );
}

/** Ba thẻ MVP trên bục và bảng điểm đầy đủ (người chơi thật trước nếu đông). */
export function MatchShowcase({ room, summary }: { room: IslandRoom; summary: MatchSummaryMessage }) {
  const me = myId(room);
  const [all, setAll] = useState(false);
  const byId = new Map(summary.rows.map((r) => [r.id, r]));
  const war = summary.mode === "war";
  const teams = summary.mode === "war" || summary.mode === "squad";
  // Chiến trường 100 người: mặc định 12 dòng đầu (cộng dòng của mình), bấm để xem hết.
  const LIMIT = 12;
  const mine = summary.rows.findIndex((r) => r.id === me);
  const rows = all ? summary.rows : summary.rows.filter((_, i) => i < LIMIT || i === mine);
  return (
    <div className="mvp-show">
      <VictoryPodium room={room} summary={summary} />
      <div className="mvp-podium">
        {PODIUM.filter((k) => war || k !== "captures").map((kind) => {
          const e = summary.mvp.find((m) => m.kind === kind);
          // Không có cứ điểm (đấu đơn, Đồng đội): MVP Hỗ trợ đứng bục hai.
          const place = war ? MVP_META[kind].place : kind === "kills" ? 1 : 2;
          return <MvpCard key={kind} kind={kind} row={e ? byId.get(e.id) : undefined} value={e?.value ?? 0} place={place} />;
        })}
      </div>
      <div className="mvp-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Người chơi</th>
              <th title="Hạ gục">Hạ</th>
              <th title="Trợ giúp hạ gục">Trợ</th>
              <th title="Số lần gục">Gục</th>
              {war && <th title="Góp phần chiếm cứ điểm">Cứ điểm</th>}
              <th title="Tiếp tế, sửa xe, hồi sinh">Hỗ trợ</th>
              <th>Điểm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const place = summary.rows.indexOf(r) + 1;
              return (
                <tr key={r.id} className={r.id === me ? "me" : ""}>
                  <td>{place}</td>
                  <td className="mvp-name">
                    {teams && r.team && <i className="b-team-dot" style={{ background: TEAM_COLOR[r.team] ?? "#9aa" }} />}
                    <RankBadge rank={r.rank} size={15} />
                    {r.name}
                    {summary.mvp.some((m) => m.id === r.id) && <em className="mvp-tag">MVP</em>}
                  </td>
                  <td>{r.kills}</td>
                  <td>{r.assists}</td>
                  <td>{r.deaths}</td>
                  {war && <td>{r.captures}</td>}
                  <td>{r.support}</td>
                  <td>
                    <b>{r.score}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {summary.rows.length > LIMIT && (
          <button className="ghost mvp-more" onClick={() => setAll((a) => !a)}>
            {all ? "Thu gọn" : `Xem cả ${summary.rows.length} người`}
          </button>
        )}
      </div>
    </div>
  );
}
