import { useMemo, useRef, useState, type FormEvent } from "react";
import { Crosshair, DoorOpen, Flag, Plus, RotateCcw, Users } from "lucide-react";
import { ROOM_CODE_LENGTH } from "@tentides/protocol";
import { createBattleRoom, createRoom, describeJoinError, joinRoom, lastRoom, type IslandRoom } from "./net.ts";
import { AccountPanel } from "./account/AccountPanel.tsx";
import { useAccount } from "./account/account.ts";
import { GachaScreen } from "./gacha/GachaScreen.tsx";
import { StudioBackdrop } from "./studio/StudioBackdrop.tsx";
import { lobbyLook } from "./studio/looks.ts";

const NAME_KEY = "tentides.name";

/**
 * Chế độ Sinh tồn (cốt truyện co-op 10 ngày) đã được cất vào kho lưu trữ: sảnh không mời tạo phòng sinh tồn nữa.
 * Mở lại bằng tham số ?survival=1 trên địa chỉ (mã nguồn IslandRoom, packages/story vẫn giữ nguyên).
 */
const SURVIVAL_ENABLED = new URLSearchParams(location.search).get("survival") === "1";

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Không lưu được thì thôi, lần sau nhập lại.
  }
}

export function Lobby({ onJoined, notice }: { onJoined: (room: IslandRoom) => void; notice: string | null }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("room") ?? "");
  // Tải lại trang giữa ván: mời vào lại đúng phòng cũ, server nhận ra nhân vật nhờ token của tab này.
  const [previous] = useState(lastRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tài khoản: đăng nhập rồi thì tên trong game là tên tài khoản; Kho súng · Gacha mở đè lên sảnh.
  const account = useAccount();
  const signedIn = account.status === "user";
  const [gacha, setGacha] = useState(false);
  // Nhân vật trên bục 3D: đổi tên thì đổi mặt (theo màu tên), đăng nhập thì cầm khẩu có skin hiếm nhất.
  const profile = account.status === "user" ? account.profile : null;
  const look = useMemo(() => lobbyLook(name, profile), [name, profile]);
  const inner = useRef<HTMLDivElement>(null);

  async function run(action: () => Promise<IslandRoom>) {
    if (!name.trim()) {
      setError("Nhập tên trước đã.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      saveName(name.trim());
      onJoined(await action());
    } catch (e) {
      setError(describeJoinError(e));
      setBusy(false);
    }
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    void run(() => joinRoom(code, name));
  }

  return (
    <main className="lobby frontline studio-lobby">
      <StudioBackdrop look={look} defaultSet="beach" avoid={inner} />

      <div className="lobby-inner" ref={inner}>
        <header className="lobby-hero">
          <div className="kicker">Chiến trường web 3D · không cần cài đặt</div>
          <h1>TEN TIDES</h1>
          <div className="frontline-sub">FRONTLINE</div>
          <p className="tagline">Bảy cứ điểm, hai phe, một trăm khẩu súng. Bạn dẫn quân thế nào?</p>
          <ul className="facts">
            <li>
              <Flag size={15} aria-hidden /> Đại Chiến 50v50
            </li>
            <li>
              <Users size={15} aria-hidden /> Chỉ Huy Tiểu Đội
            </li>
            <li>
              <Crosshair size={15} aria-hidden /> Sinh Tồn Sa Trường
            </li>
          </ul>
        </header>

        <div className="lobby-card">
          <AccountPanel onUsername={setName} onOpenGacha={() => setGacha(true)} />

          <label className="field">
            <span className="label">Tên của bạn</span>
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="vd. Hải" autoFocus readOnly={signedIn} title={signedIn ? "Đã đăng nhập: dùng tên tài khoản" : undefined} />
          </label>

          {notice && <p className="notice">{notice}</p>}

          {previous && (
            <button className="primary big" disabled={busy} onClick={() => void run(() => joinRoom(previous, name))}>
              <RotateCcw size={18} aria-hidden /> Vào lại phòng {previous}
            </button>
          )}

          <button className={previous ? "big battle-button" : "primary big battle-button"} disabled={busy} onClick={() => void run(() => createBattleRoom(name))}>
            <Crosshair size={18} aria-hidden /> Vào Trung tâm chỉ huy
          </button>

          {SURVIVAL_ENABLED && (
            <button className="big" disabled={busy} onClick={() => void run(() => createRoom(name))}>
              <Plus size={18} aria-hidden /> Tạo phòng Sinh tồn (lưu trữ)
            </button>
          )}

          <div className="divider">
            <span>hoặc vào phòng của bạn bè</span>
          </div>

          <form className="join" onSubmit={onJoin}>
            <input
              className="code"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MÃ"
              aria-label="Mã phòng"
            />
            <button disabled={busy || code.trim().length !== ROOM_CODE_LENGTH}>
              <DoorOpen size={18} aria-hidden /> Vào phòng
            </button>
          </form>

          {error && <p className="error">{error}</p>}
        </div>
      </div>
      {gacha && <GachaScreen onClose={() => setGacha(false)} />}
    </main>
  );
}
