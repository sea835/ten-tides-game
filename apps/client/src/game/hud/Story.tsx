import { useEffect, useState } from "react";
import { BookOpen, EyeOff, Sunrise, Sunset } from "lucide-react";
import type { IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

/** Lời kể công khai của một ngày (bình minh hoặc hoàng hôn). */
export function useStory(room: IslandRoom, day: number, kind: "dawn" | "dusk"): string {
  return useRoomSnapshot(room, (s) => [...s.story].find((l) => l.day === day && l.kind === kind)?.text ?? "");
}

/** Lời kể riêng của mình trong một ngày. */
export function usePrivateStory(day: number): string {
  const view = usePrivate();
  return view?.story.find((l) => l.day === day)?.text ?? "";
}

/** Sổ truyện (phím J): đọc lại mọi lời kể từ đầu ván, kể cả những dòng chỉ mình bạn thấy. */
export function Journal({ room }: { room: IslandRoom }) {
  const [open, setOpen] = useState(false);
  const lines = useRoomSnapshot(room, (s) => [...s.story].map((l) => ({ day: l.day, kind: l.kind, text: l.text })));
  const mine = usePrivate()?.story ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "KeyJ") setOpen((o) => !o);
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  const days = [...new Set(lines.map((l) => l.day))];
  return (
    <div className="prep-screen" onClick={() => setOpen(false)}>
      <div className="prep-card journal" onClick={(e) => e.stopPropagation()}>
        <header className="prep-header">
          <BookOpen size={22} aria-hidden />
          <h2>Sổ truyện</h2>
          <span className="hint">
            <kbd>J</kbd> hoặc <kbd>Esc</kbd> để đóng
          </span>
        </header>
        <div className="journal-pages">
          {days.length === 0 && <p className="hint">Câu chuyện chưa bắt đầu.</p>}
          {days.map((day) => (
            <section key={day} className="journal-day">
              <h3>Ngày {day}</h3>
              {lines
                .filter((l) => l.day === day)
                .map((l, i) => (
                  <p key={i}>
                    <span className="journal-tag">
                      {l.kind === "dawn" ? <Sunrise size={13} aria-hidden /> : <Sunset size={13} aria-hidden />}
                      {l.kind === "dawn" ? "Bình minh" : "Hoàng hôn"}
                    </span>
                    {l.text}
                  </p>
                ))}
              {mine
                .filter((l) => l.day === day)
                .map((l, i) => (
                  <p key={`p${i}`} className="private-line">
                    <span className="journal-tag">
                      <EyeOff size={13} aria-hidden />
                      Chỉ mình bạn
                    </span>
                    {l.text}
                  </p>
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
