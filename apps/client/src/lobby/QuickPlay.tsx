import { useEffect, useState } from "react";
import { Bot, Crosshair, Flag, RefreshCw, Ship, Users, Zap } from "lucide-react";
import { WAR_MAP_LIST, shipClass } from "@tentides/content";
import { MAX_PLAYERS, type PublicRoomInfo, type QuickMode } from "@tentides/protocol";
import { fetchPublicRooms } from "../account/account.ts";
import { joinRoom, quickPlay, type IslandRoom } from "../net.ts";
import "./lobby.css";

// Chơi nhanh: chọn chế độ rồi vào phòng công khai còn chỗ (không có thì tạo phòng mới). Bên dưới là "Phòng đang mở":
// danh sách phòng công khai làm mới vài giây một lần, bấm để vào. Lobby chỉ gắn component này vào (xem Lobby.tsx).

const MODES: { id: QuickMode; label: string; icon: typeof Flag }[] = [
  { id: "war", label: "Đại Chiến 50v50", icon: Flag },
  { id: "naval", label: "Hải Chiến 3v3", icon: Ship },
  { id: "squad", label: "Tiểu Đội", icon: Users },
  { id: "solo", label: "Sinh Tồn", icon: Crosshair },
];

const MODE_NAME: Record<string, string> = { war: "Đại Chiến 50v50", naval: "Hải Chiến 3v3", squad: "Chỉ Huy Tiểu Đội", solo: "Sinh Tồn Sa Trường" };
const PHASE_NAME: Record<string, string> = { lobby: "Sảnh chờ", prep: "Chuẩn bị", battle: "Đang đánh", ended: "Tổng kết" };
/** Làm mới danh sách mỗi chừng này mili giây (khi tab đang hiện). */
const REFRESH_MS = 4000;

/** Tên bản đồ hiển thị: chiến trường theo mã bản đồ, hải chiến là hai lớp tàu, còn lại là đảo. */
export function mapLabel(r: Pick<PublicRoomInfo, "mode" | "map">): string {
  if (r.mode === "war") return WAR_MAP_LIST.find((m) => m.id === r.map)?.name ?? "Tiền Tuyến Sông Xanh";
  if (r.mode === "naval") {
    const [a = "", b = ""] = r.map.split(":");
    return `${shipClass(a).name} đấu ${shipClass(b).name}`;
  }
  return "Đảo Battleground";
}

interface Props {
  busy: boolean;
  /** Chạy một hành động vào phòng (kiểm tra tên, báo lỗi, chuyển màn): hàm run của Lobby. */
  run: (action: () => Promise<IslandRoom>) => Promise<void>;
  name: string;
}

export function QuickPlay({ busy, run, name }: Props) {
  const [rooms, setRooms] = useState<PublicRoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const list = await fetchPublicRooms();
        if (live) {
          setRooms(list);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="quick" aria-label="Chơi nhanh">
      <div className="quick-title">
        <Zap size={15} aria-hidden /> Chơi nhanh
      </div>
      <div className="quick-modes">
        {MODES.map((m) => (
          <button key={m.id} className="quick-mode" disabled={busy} onClick={() => void run(() => quickPlay(m.id, name))}>
            <m.icon size={16} aria-hidden />
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <div className="quick-title list">
        <span>Phòng đang mở</span>
        <RefreshCw size={12} aria-hidden className="quick-refresh" />
      </div>
      {failed && !rooms && <p className="quick-empty">Chưa lấy được danh sách phòng.</p>}
      {rooms && rooms.length === 0 && <p className="quick-empty">Chưa có phòng công khai nào. Bấm một chế độ ở trên để mở phòng đầu tiên.</p>}
      {rooms && rooms.length > 0 && (
        <ul className="quick-rooms">
          {rooms.map((r) => {
            const full = r.humans >= r.max;
            return (
              <li key={r.code}>
                <button className="quick-room" disabled={busy || full} onClick={() => void run(() => joinRoom(r.code, name))} title={full ? "Phòng đã đủ người" : `Vào phòng ${r.code}`}>
                  <span className="qr-main">
                    <b>{MODE_NAME[r.mode] ?? r.mode}</b>
                    <small>
                      {mapLabel(r)}
                      {r.host && ` · ${r.host}`}
                    </small>
                  </span>
                  <span className="qr-meta">
                    <span className={`qr-phase ${r.phase}`}>{PHASE_NAME[r.phase] ?? r.phase}</span>
                    <span className="qr-count">
                      <Users size={12} aria-hidden /> {Math.min(r.humans, MAX_PLAYERS)}/{r.max}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="quick-hint">
        <Bot size={12} aria-hidden /> Chỗ trống do lính AI lấp. Phòng tạo bằng mã là phòng riêng; chủ phòng bật “Phòng công khai” để hiện ở đây.
      </p>
    </section>
  );
}
