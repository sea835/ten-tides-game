import { useState, type FormEvent } from "react";
import { ROOM_CODE_LENGTH } from "@tentides/protocol";
import { createRoom, describeJoinError, joinRoom, type IslandRoom } from "./net.ts";

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

export function Lobby({ onJoined }: { onJoined: (room: IslandRoom) => void }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("room") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h1>TEN TIDES</h1>
      <p className="tagline">Chúng ta mang theo gì — và ai trong chúng ta thật sự đáng tin?</p>

      <label className="field">
        <span>Tên của bạn</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="vd. Hải" autoFocus />
      </label>

      <button className="primary" disabled={busy} onClick={() => void run(() => createRoom(name))}>
        Tạo phòng mới
      </button>

      <div className="divider">hoặc vào phòng của bạn bè</div>

      <form className="join" onSubmit={onJoin}>
        <input
          className="code"
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="MÃ"
        />
        <button disabled={busy || code.trim().length !== ROOM_CODE_LENGTH}>Vào phòng</button>
      </form>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
