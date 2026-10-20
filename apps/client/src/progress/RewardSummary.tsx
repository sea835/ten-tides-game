import { Coins, Target } from "lucide-react";
import { useMatchReward } from "./matchReward.ts";

// Xu và thử thách của trận vừa xong, trong màn vinh danh: xu thực nhận (giảm khi chơi một mình với máy), báo khi đã
// đạt giới hạn xu hôm nay, thử thách vừa hoàn thành (tự nhận thưởng).

const fmt = (n: number) => n.toLocaleString("vi-VN");

export function RewardSummary() {
  const r = useMatchReward();
  if (!r) return null;
  const reduced = r.factor < 1;
  return (
    <div className="vp-reward" aria-live="polite">
      <div className="vp-reward-coins">
        <Coins size={16} aria-hidden /> <b>+{fmt(r.coins)} xu</b>
        {reduced && <small>Chơi một mình với máy chỉ nhận {Math.round(r.factor * 100)}% xu, rủ bạn vào cùng để nhận đủ.</small>}
        {r.capped && r.coins < r.earned && <small>Trận này đáng được {fmt(r.earned)} xu.</small>}
      </div>
      {r.capped && (
        <p className="vp-reward-cap">
          Đã đạt giới hạn xu hôm nay ({fmt(r.cap)} xu từ trận đấu). XP và thử thách vẫn tính, mai xu lại tiếp tục.
        </p>
      )}
      {r.challenges.map((c) => (
        <div key={c.id} className="vp-reward-challenge">
          <Target size={15} aria-hidden /> Hoàn thành thử thách “{c.title}”: <b>+{fmt(c.coins)} xu</b>, <b>+{fmt(c.xp)} XP</b>
        </div>
      ))}
    </div>
  );
}
