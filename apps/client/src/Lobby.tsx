import { useState, type FormEvent } from "react";
import { CalendarDays, Crosshair, DoorOpen, Drama, Plus, RotateCcw, Users } from "lucide-react";
import { ROOM_CODE_LENGTH } from "@tentides/protocol";
import { createBattleRoom, createRoom, describeJoinError, joinRoom, lastRoom, type IslandRoom } from "./net.ts";
import { AccountPanel } from "./account/AccountPanel.tsx";
import { useAccount } from "./account/account.ts";
import { GachaScreen } from "./gacha/GachaScreen.tsx";

const NAME_KEY = "tentides.name";

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
  const signedIn = useAccount().status === "user";
  const [gacha, setGacha] = useState(false);

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
    <main className="lobby">
      <div className="sea" aria-hidden>
        <div className="sun" />
        <div className="isle" />
        <div className="wave w1" />
        <div className="wave w2" />
        <div className="wave w3" />
      </div>

      <div className="lobby-inner">
        <header className="lobby-hero">
          <div className="kicker">Sinh tồn · hợp tác · phản bội</div>
          <h1>TEN TIDES</h1>
          <p className="tagline">Chúng ta mang theo gì, và ai trong chúng ta thật sự đáng tin?</p>
          <ul className="facts">
            <li>
              <Users size={15} aria-hidden /> 2–6 người
            </li>
            <li>
              <CalendarDays size={15} aria-hidden /> 10 ngày trên đảo
            </li>
            <li>
              <Drama size={15} aria-hidden /> Có thể có kẻ phản bội
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

          <button className={previous ? "big" : "primary big"} disabled={busy} onClick={() => void run(() => createRoom(name))}>
            <Plus size={18} aria-hidden /> Tạo phòng mới
          </button>

          <button className="big battle-button" disabled={busy} onClick={() => void run(() => createBattleRoom(name))}>
            <Crosshair size={18} aria-hidden /> Tạo phòng Battleground
          </button>

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
