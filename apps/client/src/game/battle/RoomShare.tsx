import { useState } from "react";
import { Globe, Link2, Lock } from "lucide-react";
import { Messages } from "@tentides/protocol";
import { inviteLink, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import "../../lobby/lobby.css";

// Chia sẻ phòng ở Trung tâm chỉ huy: công tắc "Phòng công khai" (chủ phòng bật thì phòng hiện trong "Phòng đang mở" và
// Chơi nhanh vào được; phòng tạo bằng mã mặc định riêng tư) và nút "Sao chép link mời" (`/?join=MÃ`).

export function RoomShare({ room, isHost }: { room: IslandRoom; isHost: boolean }) {
  const open = useRoomSnapshot(room, (s) => s.settings.publicRoom);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(inviteLink(room.roomId)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="cc-share">
      <button className={`cc-public${open ? " on" : ""}`} disabled={!isHost} aria-pressed={open} onClick={() => room.send(Messages.battleSettings, { public: !open })} title={isHost ? undefined : "Chủ phòng chỉnh"}>
        {open ? <Globe size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
        <span>
          <strong>Phòng công khai</strong>
          <small>{open ? "Ai cũng thấy và vào được từ sảnh" : "Riêng tư: chỉ vào bằng mã hay link mời"}</small>
        </span>
      </button>
      <button className="cc-invite" onClick={copy}>
        <Link2 size={16} aria-hidden /> {copied ? "Đã chép link" : "Sao chép link mời"}
      </button>
    </div>
  );
}
