import { useEffect, useState } from "react";
import { ROLE_LABELS } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { itemName } from "./format.ts";

/**
 * Vai của mình, che mặc định ("giữ để xem") vì nhóm bạn hay chia sẻ màn hình khi gọi điện.
 * Ghi chú riêng hiện ở khung màu khác, ghi rõ là chỉ mình thấy.
 */
export function RoleCard({ room }: { room: IslandRoom }) {
  const view = usePrivate();
  const started = useRoomSnapshot(room, (s) => s.phase !== "lobby");
  const [peek, setPeek] = useState(false);

  // Thả chuột ở đâu cũng che lại: khung giãn ra khi hiện vai, con trỏ có thể không còn nằm trên nút.
  useEffect(() => {
    if (!peek) return;
    const hide = () => setPeek(false);
    window.addEventListener("pointerup", hide);
    window.addEventListener("keyup", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointerup", hide);
      window.removeEventListener("keyup", hide);
      window.removeEventListener("blur", hide);
    };
  }, [peek]);

  if (!view || !started) return null;
  const role = ROLE_LABELS[view.role];

  return (
    <div className={`role-card ${peek && role.side === "traitor" ? "traitor" : ""}`}>
      {peek && (
        <div className="role-body">
          <strong className="role-title">{role.title}</strong>
          <div>{role.goal}</div>
          <div className="hint">{role.power}</div>
          {view.goal && (
            <div className="role-goal">
              Tiến độ bí mật: {view.goal.current}/{view.goal.needed}
            </div>
          )}
          {view.loot.length > 0 && <div className="hint">Đồ đã bỏ túi: {view.loot.map(itemName).join(", ")}</div>}
        </div>
      )}
      {/* Nút nằm dưới cùng: khung neo ở cạnh dưới nên nội dung hiện ra phía trên, nút không bị đẩy đi. */}
      <button className="peek" onPointerDown={() => setPeek(true)} onKeyDown={(e) => e.key === " " && setPeek(true)}>
        {peek ? "Thả ra để che" : "Giữ để xem vai của bạn"}
      </button>
      {view.clues.length > 0 && (
        <div className="clues">
          <div className="label">Chỉ mình bạn thấy</div>
          {view.clues.slice(-4).map((c, i) => (
            <div key={i}>
              <span className="feed-day">Đêm {c.day}</span> {c.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
