import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import { myId, type IslandRoom } from "../../net.ts";
import { MODE_NAMES, isBattleMode, keyChips, richParts, type BattleModeId } from "../controlsMap.ts";
import { isTyping } from "../input.ts";
import { menuOpen, setBattleHud } from "../battle/runtime.ts";
import { setMenu, useMenu } from "../menu/menuStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { SignalCollector } from "./signals.ts";
import { advance, hasSeen, isFinished, isManual, markSeen, progressOf, scriptFor, skipStep, startRun, stepNumber, visibleCount, type TutorialRun } from "./steps.ts";
import "./tutorial.css";

// Huấn luyện viên trong trận: khung nhỏ giữa trên màn hình nói bước đang cần làm và tự qua bước khi người chơi làm
// đúng (steps.ts đo qua signals.ts). Tự chạy lần đầu vào mỗi chế độ (nhớ trong localStorage), bấm Enter qua bước,
// End để tắt; chạy lại từ nút Hướng dẫn trong Cài đặt hay Trung tâm chỉ huy. Gắn một dòng trong BattleHud.

const POLL_MS = 150;

interface View {
  index: number;
  progress: number;
  /** Bước đang chờ người chơi vào lại vị trí trên tàu. */
  waitStation: boolean;
  step: number;
  total: number;
}

/** Lời hướng dẫn: `{id}` thành ô phím. */
export function Hint({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) =>
        "text" in p ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : (
          <Fragment key={i}>
            {keyChips(p.control).map((k, j) => (
              <kbd key={j}>{k}</kbd>
            ))}
          </Fragment>
        ),
      )}
    </>
  );
}

export function TutorialCoach({ room }: { room: IslandRoom }) {
  const mode = useRoomSnapshot(room, (s): BattleModeId | null => (s.mode === "battle" && isBattleMode(s.battleMode) ? s.battleMode : null));
  const fighting = useRoomSnapshot(room, (s) => s.phase === "prep" || s.phase === "battle");
  const alive = useRoomSnapshot(room, (s) => !!s.players.get(myId(room))?.alive);
  const menu = useMenu();
  const [active, setActive] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const run = useRef<TutorialRun | null>(null);
  const collector = useMemo(() => new SignalCollector(room), [room]);
  const lastRequest = useRef(menu.tutorial);

  // Cho nút Hướng dẫn, màn Phím điều khiển biết chế độ đang chơi.
  useEffect(() => {
    setMenu({ mode });
    return () => setMenu({ mode: null });
  }, [mode]);

  // Lần đầu vào chế độ: tự chạy, ghi nhớ ngay (đóng trình duyệt giữa chừng cũng không bị nhắc lại mãi).
  useEffect(() => {
    if (!mode || hasSeen(mode)) return;
    markSeen(mode);
    run.current = null;
    setActive(true);
  }, [mode]);

  // Bấm "Hướng dẫn": chạy lại từ đầu.
  useEffect(() => {
    if (menu.tutorial === lastRequest.current) return;
    lastRequest.current = menu.tutorial;
    run.current = null;
    setView(null);
    setActive(true);
  }, [menu.tutorial]);

  const running = active && !!mode && fighting && alive;

  useEffect(() => {
    if (!running || !mode) return;
    const detach = collector.attach();
    const script = scriptFor(mode);
    const tick = () => {
      const sig = collector.poll();
      const ctx = collector.context(mode);
      if (!run.current) run.current = startRun(sig);
      run.current = advance(script, run.current, sig, ctx);
      const r = run.current;
      if (isFinished(script, r)) {
        run.current = null;
        setActive(false);
        setView(null);
        setBattleHud({ toast: { at: performance.now(), text: "Xong hướng dẫn. Mở lại bằng nút Hướng dẫn trong Cài đặt (O)" } });
        return;
      }
      const step = script[r.index]!;
      const next: View = {
        index: r.index,
        progress: Math.round(progressOf(step, sig, r.start) * 20) / 20,
        waitStation: mode === "naval" && !!step.roles && !ctx.role,
        step: stepNumber(script, r, ctx),
        total: visibleCount(script, ctx),
      };
      setView((v) => (v && v.index === next.index && v.progress === next.progress && v.waitStation === next.waitStation && v.step === next.step && v.total === next.total ? v : next));
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    // Chuột đang khoá nên dùng phím: Enter qua bước, End tắt.
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || menuOpen()) return;
      if (e.code === "End") {
        setActive(false);
        setView(null);
        run.current = null;
      } else if (e.code === "Enter" && run.current) {
        run.current = skipStep(script, run.current, collector.poll(), collector.context(mode));
        tick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("keydown", onKey);
      detach();
    };
  }, [running, mode, collector]);

  if (!running || !mode || !view) return null;
  const step = scriptFor(mode)[view.index];
  if (!step) return null;
  const manual = isManual(step);
  return (
    <div className="tut-coach" role="status" aria-live="polite">
      <div className="tut-head">
        <GraduationCap size={14} aria-hidden />
        <span>
          Hướng dẫn · {MODE_NAMES[mode]} · {view.step}/{view.total}
        </span>
      </div>
      <h3>{step.title}</h3>
      <p>
        <Hint text={step.hint} />
      </p>
      {view.waitStation && <p className="tut-wait">Bạn đã rời vị trí: quay lại bàn điều khiển và bấm F để tiếp tục bước này.</p>}
      {!manual && (
        <div className="tut-bar" aria-hidden>
          <i style={{ width: `${view.progress * 100}%` }} />
        </div>
      )}
      <div className="tut-foot">
        <span>
          <kbd>Enter</kbd> {manual ? "tiếp tục" : "bỏ qua bước"}
        </span>
        <span>
          <kbd>End</kbd> tắt hướng dẫn
        </span>
      </div>
    </div>
  );
}
