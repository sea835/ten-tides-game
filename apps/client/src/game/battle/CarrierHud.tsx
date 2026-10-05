import { useEffect, useRef, useState } from "react";
import { carrierHud } from "./vehicleParts.tsx";

// Bảng điều khiển khi ngồi xe trinh sát / thuyền tuần tra: máu xe, tốc độ, danh sách ghế (ai ngồi đâu, mình ở ghế
// nào, phím đổi ghế), tâm ngắm đại liên khi ngồi ghế xạ thủ. Đọc `carrierHud` mỗi khung hình (không qua React), chỉ
// vẽ lại phần chữ khi danh sách ghế đổi.

export function CarrierHud() {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const hp = useRef<HTMLElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const [seatsKey, setSeatsKey] = useState("");
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      el.style.display = carrierHud.active ? "" : "none";
      if (!carrierHud.active) return;
      el.classList.toggle("zoom", carrierHud.zoom);
      if (cross.current) cross.current.style.display = carrierHud.gunner ? "" : "none";
      if (ring.current) {
        ring.current.style.display = carrierHud.gunner && carrierHud.aimOn ? "" : "none";
        ring.current.style.left = `${(carrierHud.aimX * 100).toFixed(2)}%`;
        ring.current.style.top = `${(carrierHud.aimY * 100).toFixed(2)}%`;
      }
      if (hp.current) hp.current.style.width = `${Math.max(0, (carrierHud.hp / carrierHud.maxHp) * 100)}%`;
      if (hpText.current) hpText.current.textContent = `${Math.max(0, Math.round(carrierHud.hp))}`;
      if (speed.current) speed.current.textContent = `${Math.round(Math.abs(carrierHud.speed) * 3.6)} km/h`;
      if (carrierHud.seatsKey !== seatsKey) setSeatsKey(carrierHud.seatsKey);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [seatsKey]);
  const boat = carrierHud.kind === "boat";
  const seat = carrierHud.seat;
  return (
    <div ref={root} className="b-tank b-carrier" style={{ display: "none" }}>
      <div ref={cross} className="b-tank-cross" />
      <div ref={ring} className="b-tank-ring ready" />
      <div className="b-tank-panel">
        <div className="b-tank-row">
          <span>{boat ? "⛴ Thuyền" : "⛟ Xe"}</span>
          <div className="b-tank-bar">
            <i ref={hp} />
          </div>
          <span ref={hpText} />
        </div>
        <div className="b-carrier-seats" data-key={seatsKey}>
          {carrierHud.seats.map((s, i) => (
            <span key={i} className={s.mine ? "mine" : s.who ? "taken" : ""}>
              <kbd>{i + 1}</kbd> {s.name}
              {s.who && !s.mine ? ` · ${s.who}` : ""}
            </span>
          ))}
          <span ref={speed} className="b-carrier-speed" />
        </div>
        <p>
          {seat === 0 ? (
            <>
              <kbd>W</kbd>/<kbd>S</kbd> ga, phanh, lùi · <kbd>A</kbd>/<kbd>D</kbd> bẻ lái{boat ? " · ủi vào bãi nông để đổ quân" : " · lội được nước nông"} ·{" "}
            </>
          ) : carrierHud.gunner ? (
            <>chuột xoay đại liên · chuột trái bắn · chuột phải ngắm gần · </>
          ) : (
            <>chuột nhìn quanh · </>
          )}
          <kbd>1</kbd>–<kbd>{carrierHud.seats.length || 4}</kbd> đổi ghế · <kbd>F</kbd> xuống {boat ? "thuyền" : "xe"}
        </p>
      </div>
    </div>
  );
}
