import { useEffect, useRef, useState } from "react";
import { MORTAR, mortarRange } from "@tentides/content";
import { emplacementHud } from "./vehicleParts.tsx";

// Bảng điều khiển khi ngồi vũ khí cố định. Ổ đại liên: tâm ngắm, vòng chỗ nòng đang chĩa, báo chạm mép cung xoay.
// Cối 82 ly: góc ngẩng, phương vị (la bàn), tầm tới điểm rơi dự đoán, thời gian bay, nạp đạn, bản đồ nhỏ quanh cối
// (vòng tầm gần nhất / xa nhất, cứ điểm, hướng bắn, điểm rơi). Đọc `emplacementHud` mỗi khung hình (không qua React),
// chỉ vẽ lại phần chữ khi đổi loại vũ khí hay danh sách cứ điểm.

/** Phương vị (độ) cùng cách tính với la bàn trên đầu màn hình (BattleHud: hướng camera), từ hướng bắn thế giới `az`. */
export function bearing(az: number): number {
  return Math.round(((((-az * 180) / Math.PI) % 360) + 360) % 360) % 360;
}

const R_MAX = mortarRange(MORTAR.elevMin);
const R_MIN = mortarRange(MORTAR.elevMax);
/** Bản đồ nhỏ của cối: nửa cạnh (m) quanh cối. */
const SPAN = Math.ceil(R_MAX + 30);

export function EmplacementHud() {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const hp = useRef<HTMLElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const reload = useRef<HTMLElement>(null);
  const info = useRef<HTMLSpanElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const map = useRef<SVGGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const hit = useRef<SVGGElement>(null);
  const [view, setView] = useState({ kind: "", flags: "" });
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = root.current;
      if (!el) return;
      const h = emplacementHud;
      el.style.display = h.active ? "" : "none";
      if (!h.active) return;
      if (h.kind !== view.kind || h.flagsKey !== view.flags) setView({ kind: h.kind, flags: h.flagsKey });
      el.classList.toggle("zoom", h.zoom);
      if (hp.current) hp.current.style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
      if (hpText.current) hpText.current.textContent = `${Math.max(0, Math.round(h.hp))}`;
      if (h.kind === "hmg_nest") {
        if (ring.current) {
          ring.current.style.display = h.aimOn ? "" : "none";
          ring.current.style.left = `${(h.aimX * 100).toFixed(2)}%`;
          ring.current.style.top = `${(h.aimY * 100).toFixed(2)}%`;
        }
        if (edge.current) edge.current.style.display = h.clamped ? "" : "none";
        return;
      }
      if (reload.current) reload.current.style.width = `${h.reload * 100}%`;
      if (info.current) info.current.textContent = `Góc ngẩng ${((h.elev * 180) / Math.PI).toFixed(1)}° · Hướng ${bearing(h.az)}° · Tầm ${Math.round(h.range)} m · Bay ${h.flight.toFixed(1)} s`;
      // Bản đồ nhỏ: gốc ở cối; hướng bắn, điểm rơi.
      if (map.current) map.current.setAttribute("transform", `translate(${-h.x} ${-h.z})`);
      if (line.current) {
        line.current.setAttribute("x1", `${h.x}`);
        line.current.setAttribute("y1", `${h.z}`);
        line.current.setAttribute("x2", `${h.impactX}`);
        line.current.setAttribute("y2", `${h.impactZ}`);
      }
      if (hit.current) hit.current.setAttribute("transform", `translate(${h.impactX} ${h.impactZ})`);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view]);
  const mortar = view.kind === "mortar";
  return (
    <div ref={root} className="b-tank b-emplace" style={{ display: "none" }}>
      {!mortar && <div className="b-tank-cross" />}
      {!mortar && <div ref={ring} className="b-tank-ring ready" />}
      {!mortar && (
        <div ref={edge} className="b-emplace-edge" style={{ display: "none" }}>
          Giá súng đã xoay hết cỡ
        </div>
      )}
      {mortar && (
        <svg className="b-emplace-map" viewBox={`${-SPAN} ${-SPAN} ${SPAN * 2} ${SPAN * 2}`} data-flags={view.flags}>
          <circle r={R_MAX} className="rng" />
          <circle r={R_MIN} className="rng min" />
          <g ref={map}>
            {emplacementHud.flags.map((f) => (
              <g key={f.id} transform={`translate(${f.x} ${f.z})`}>
                <circle r={14} style={{ fill: f.color, stroke: f.color }} className="flag" />
                <text y={6}>{f.id}</text>
              </g>
            ))}
            <line ref={line} className="dir" />
            <g ref={hit}>
              <circle r={MORTAR.radius * 1.6} className="hit" />
              <path d="M-12,0 L12,0 M0,-12 L0,12" className="hit" />
            </g>
          </g>
          <circle r={5} className="me" />
        </svg>
      )}
      <div className="b-tank-panel">
        <div className="b-tank-row">
          <span>{mortar ? "Cối 82mm" : "Đại liên"}</span>
          <div className="b-tank-bar">
            <i ref={hp} />
          </div>
          <span ref={hpText} />
        </div>
        {mortar && (
          <div className="b-tank-row">
            <span>Nạp đạn</span>
            <div className="b-tank-bar reload">
              <i ref={reload} />
            </div>
            <span />
          </div>
        )}
        {mortar && <span ref={info} className="b-emplace-info" />}
        <p>
          {mortar ? (
            <>
              chuột xoay hướng · <kbd>W</kbd>/<kbd>S</kbd> hay lăn chuột chỉnh góc ngẩng (ngẩng cao là bắn gần) · chuột trái bắn · giữ chuột phải nhìn chỗ rơi ·{" "}
            </>
          ) : (
            <>chuột xoay đại liên (cung 120° trước mặt) · chuột trái bắn · chuột phải ngắm gần · </>
          )}
          <kbd>F</kbd> rời vị trí
        </p>
      </div>
    </div>
  );
}
