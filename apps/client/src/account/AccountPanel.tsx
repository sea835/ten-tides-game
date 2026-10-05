import { useEffect, useState, type FormEvent } from "react";
import { Coins, Crosshair, Gem, LogIn, LogOut, Medal, UserPlus, UserRound } from "lucide-react";
import { openGunsmith } from "../gunsmith/openGunsmith.ts";
import { RankLine, ServiceRecord } from "../progress/ServiceRecord.tsx";
import { Emblem } from "../progress/Emblem.tsx";
import { ApiError, initAccount, login, logout, register, useAccount } from "./account.ts";
import "./account.css";

// Bảng tài khoản ở sảnh: tab Đăng nhập / Đăng ký, hoặc chơi khách. Đăng nhập rồi thì hiện tên, xu, nút Kho súng.
// Đăng nhập rồi thì có thêm quân hàm (thanh XP), Hồ sơ quân nhân (thẻ tên, huy hiệu) và Gunsmith.
// Server không bật tài khoản (không có database) thì bảng tự ẩn.

export function AccountPanel({ onUsername, onOpenGacha }: { onUsername: (name: string) => void; onOpenGacha: () => void }) {
  const account = useAccount();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [guest, setGuest] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState(false);

  useEffect(() => initAccount(), []);

  const loggedInName = account.status === "user" ? account.profile.user.username : null;
  useEffect(() => {
    if (loggedInName) onUsername(loggedInName);
  }, [loggedInName, onUsername]);

  if (account.status === "disabled" || account.status === "loading") return null;

  if (account.status === "user") {
    const { user, progress } = account.profile;
    return (
      <div className="account-panel signed-in">
        <div className="account-who">
          {progress?.emblem ? (
            <Emblem id={progress.emblem} size={38} />
          ) : (
            <span className="account-avatar" aria-hidden>
              {user.username.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <div className="account-name">{user.username}</div>
            <div className="account-coins">
              <Coins size={13} aria-hidden /> {user.coins.toLocaleString("vi-VN")} xu
            </div>
          </div>
          <button className="ghost account-logout" onClick={() => void logout()} title="Đăng xuất">
            <LogOut size={16} aria-hidden /> Đăng xuất
          </button>
        </div>
        {progress && <RankLine xp={progress.xp} />}
        <button className="big gacha-button" onClick={onOpenGacha}>
          <Gem size={18} aria-hidden /> Kho súng · Gacha
        </button>
        <div className="account-progress-actions">
          <button onClick={() => openGunsmith()}>
            <Crosshair size={15} aria-hidden /> Gunsmith
          </button>
          <button onClick={() => setRecord(true)}>
            <Medal size={15} aria-hidden /> Quân hàm · Thẻ tên
          </button>
        </div>
        {record && <ServiceRecord onClose={() => setRecord(false)} />}
      </div>
    );
  }

  if (guest) {
    return (
      <button className="ghost account-guest-back" onClick={() => setGuest(false)}>
        <UserRound size={15} aria-hidden /> Đang chơi khách · Đăng nhập để lưu xu và skin
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-panel">
      <div className="account-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "login"} className={tab === "login" ? "active" : ""} onClick={() => setTab("login")}>
          Đăng nhập
        </button>
        <button role="tab" aria-selected={tab === "register"} className={tab === "register" ? "active" : ""} onClick={() => setTab("register")}>
          Đăng ký
        </button>
      </div>
      <form className="account-form" onSubmit={submit}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập" autoComplete="username" maxLength={20} aria-label="Tên đăng nhập" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu"
          autoComplete={tab === "login" ? "current-password" : "new-password"}
          maxLength={128}
          aria-label="Mật khẩu"
        />
        {tab === "register" && <p className="account-hint">3–20 ký tự (chữ, số, . _ -), mật khẩu từ 6 ký tự. Tài khoản mới được 1000 xu.</p>}
        <div className="account-actions">
          <button className="primary" disabled={busy || username.trim().length < 3 || password.length < (tab === "register" ? 6 : 1)}>
            {tab === "login" ? <LogIn size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
            {tab === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
          <button type="button" className="ghost" onClick={() => setGuest(true)}>
            Chơi khách
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
