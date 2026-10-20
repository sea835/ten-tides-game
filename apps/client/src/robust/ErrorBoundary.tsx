import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError, dismissErrorToast, useErrorToast } from "./errorHooks.ts";
import "./robust.css";

// Màn hình phục hồi khi một lỗi React làm sập cả cây giao diện: thay vì trang trắng, hiện "Có lỗi xảy ra" kèm nút tải
// lại trang / về sảnh; chi tiết lỗi gập sẵn để gửi cho người làm game. Bọc quanh game (Game.tsx, App) và sảnh.

interface Props {
  /** Tên vùng, hiện trong chi tiết lỗi. */
  scope: "game" | "lobby";
  children: ReactNode;
  /** Nút "Về sảnh" (trong trận: rời phòng). Không có thì chỉ có nút tải lại. */
  onBack?: () => void;
  /** Đổi giá trị này thì thử dựng lại (vd. vào phòng khác). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(`ErrorBoundary:${this.props.scope}`, error);
    this.setState({ info: info.componentStack ?? "" });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, info: "" });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const detail = `${this.props.scope}: ${error.name}: ${error.message}\n${error.stack ?? ""}${info ? `\nComponent stack:${info}` : ""}`;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>Có lỗi xảy ra</h1>
          <p>Game gặp sự cố ngoài ý muốn. Bạn có thể tải lại trang{this.props.onBack ? " hoặc về sảnh" : ""}; nếu đang chơi cùng bạn bè, bấm vào lại bằng mã phòng để chơi tiếp đúng nhân vật cũ.</p>
          <div className="crash-actions">
            <button className="primary big" onClick={() => location.reload()}>
              Tải lại trang
            </button>
            {this.props.onBack && (
              <button
                className="big"
                onClick={() => {
                  this.setState({ error: null, info: "" });
                  this.props.onBack?.();
                }}
              >
                Về sảnh
              </button>
            )}
          </div>
          <details>
            <summary>Chi tiết lỗi</summary>
            <pre>{detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}

/** Thông báo nhỏ khi lỗi lặp lại (errorHooks.ts); không chặn thao tác. */
export function ErrorToast() {
  const toast = useErrorToast();
  if (!toast) return null;
  return (
    <div className="err-toast" role="status">
      <span>{toast.text}</span>
      <button onClick={() => location.reload()}>Tải lại</button>
      <button className="ghost" onClick={dismissErrorToast} aria-label="Đóng">
        ×
      </button>
    </div>
  );
}
