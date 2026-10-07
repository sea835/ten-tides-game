import { useEffect, useRef, useState } from "react";
import { HELI } from "@tentides/content";
import { heliHud } from "./Heli.tsx";

// Bảng điều khiển trực thăng: máu, độ cao, tốc độ, tốc độ lên xuống, rocket, pháo sáng, danh sách ghế; tâm rocket
// (phi công) hay tâm súng cửa (xạ thủ); cảnh báo bị ngắm khoá / tên lửa bay tới nhấp nháy giữa màn hình. Đọc `heliHud`
// mỗi khung hình (không qua React), chỉ vẽ lại phần chữ khi danh sách ghế, ghế mình đổi.

const ALERT_TEXT = ["", "⚠ ĐANG BỊ NGẮM KHOÁ", "⚠ ĐÃ BỊ KHOÁ MỤC TIÊU — THẢ PHÁO SÁNG (X)", "🚀 TÊN LỬA ĐANG BAY TỚI — THẢ PHÁO SÁNG (X)!"];

export function HeliHud() {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const rocket = useRef<HTMLDivElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const hp = useRef<HTMLElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const alt = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const climb = useRef<HTMLSpanElement>(null);
  const ammo = useRef<HTMLSpanElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    let raf = 0;
    let lastAlert = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      el.style.display = heliHud.active ? "" : "none";
      if (!heliHud.active) return;
      el.classList.toggle("zoom", heliHud.zoom);
      if (cross.current) cross.current.style.display = heliHud.gunner || heliHud.seat === 0 ? "" : "none";
      if (ring.current) {
        ring.current.style.display = heliHud.gunner && heliHud.aimOn ? "" : "none";
        ring.current.style.left = `${(heliHud.aimX * 100).toFixed(2)}%`;
        ring.current.style.top = `${(heliHud.aimY * 100).toFixed(2)}%`;
      }
      if (rocket.current) {
        rocket.current.style.display = heliHud.rocketOn ? "" : "none";
        rocket.current.style.left = `${(heliHud.rocketX * 100).toFixed(2)}%`;
        rocket.current.style.top = `${(heliHud.rocketY * 100).toFixed(2)}%`;
        rocket.current.classList.toggle("empty", heliHud.rockets <= 0);
      }
      if (hp.current) hp.current.style.width = `${Math.max(0, (heliHud.hp / HELI.hp) * 100)}%`;
      if (hpText.current) hpText.current.textContent = `${Math.max(0, Math.round(heliHud.hp))}`;
      if (alt.current) alt.current.textContent = `${Math.max(0, Math.round(heliHud.alt))} m`;
      if (speed.current) speed.current.textContent = heliHud.seat === 0 ? `${Math.round(heliHud.speed * 3.6)} km/h` : "";
      if (climb.current) climb.current.textContent = heliHud.seat === 0 ? `${heliHud.climb >= 0 ? "▲" : "▼"} ${Math.abs(heliHud.climb).toFixed(1)} m/s` : "";
      if (ammo.current) ammo.current.textContent = `Rocket ${heliHud.rockets}/${HELI.rockets} · Pháo sáng ${heliHud.flares}/${HELI.flares}${heliHud.seat === 0 && !heliHud.flareReady ? " (chờ)" : ""}`;
      if (alert.current && heliHud.alert !== lastAlert) {
        lastAlert = heliHud.alert;
        alert.current.style.display = heliHud.alert ? "" : "none";
        alert.current.textContent = ALERT_TEXT[heliHud.alert] ?? "";
        alert.current.className = `b-heli-alert lvl${heliHud.alert}`;
      }
      const k = `${heliHud.seatsKey}|${heliHud.cockpit}`;
      if (k !== key) setKey(k);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  const seat = heliHud.seat;
  return (
    <div ref={root} className="b-tank b-carrier b-heli" style={{ display: "none" }}>
      <div ref={cross} className="b-tank-cross" />
      <div ref={ring} className="b-tank-ring ready" />
      <div ref={rocket} className="b-heli-rocket" />
      <div ref={alert} className="b-heli-alert" style={{ display: "none" }} />
      <div className="b-tank-panel">
        <div className="b-tank-row">
          <span>🚁 Trực thăng</span>
          <div className="b-tank-bar">
            <i ref={hp} />
          </div>
          <span ref={hpText} />
        </div>
        <div className="b-heli-gauges">
          <span>
            Độ cao <b ref={alt} />
          </span>
          <b ref={speed} />
          <b ref={climb} />
          <span ref={ammo} />
        </div>
        <div className="b-carrier-seats" data-key={key}>
          {heliHud.seats.map((s, i) => (
            <span key={i} className={s.mine ? "mine" : s.who ? "taken" : ""}>
              <kbd>{i + 1}</kbd> {s.name}
              {s.who && !s.mine ? ` · ${s.who}` : ""}
            </span>
          ))}
        </div>
        <p>
          {seat === 0 ? (
            <>
              <kbd>W</kbd>/<kbd>S</kbd> chúc / ngóc mũi · chuột / <kbd>A</kbd>/<kbd>D</kbd> quay đầu (giữ <kbd>Alt</kbd> nhìn tự do) · <kbd>Q</kbd>/<kbd>E</kbd> nghiêng trượt ngang · <kbd>Space</kbd>/<kbd>Shift</kbd> lên / xuống · chuột trái rocket (bay về tâm ngắm) · <kbd>X</kbd> pháo sáng · <kbd>C</kbd> {heliHud.cockpit ? "camera sau đuôi" : "camera buồng lái"} · đáp ở sân đỗ để nạp đạn ·{" "}
            </>
          ) : heliHud.gunner ? (
            <>chuột xoay súng cửa · chuột trái bắn · chuột phải ngắm gần · </>
          ) : (
            <>chuột nhìn quanh · </>
          )}
          <kbd>1</kbd>–<kbd>4</kbd> đổi ghế · <kbd>F</kbd> nhảy ra
        </p>
      </div>
    </div>
  );
}
