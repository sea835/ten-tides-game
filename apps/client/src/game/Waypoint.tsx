import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { guide, type GuideTarget } from "./guide.ts";
import { localPosition } from "./shared.ts";

/** Lề màn hình cho mũi tên khi đích ở ngoài khung nhìn (px). */
const EDGE = 56;
/** Tới gần chừng này mét thì ẩn mũi tên (cột sáng đã ngay trước mặt). */
const ARRIVED = 5;
const TONES: Record<GuideTarget["tone"], string> = { event: "#ffd166", treasure: "#ff5a5f", camp: "#ff9f43" };

const v = new Vector3();

/**
 * Chọn đích gần nhất trong nhóm bảng nhiệm vụ đưa sang, chiếu lên màn hình rồi đặt mũi tên: đích trong khung nhìn thì
 * mũi tên chúc xuống ngay trên đích, ngoài khung nhìn (hay sau lưng) thì nằm ở mép màn hình và chỉ về phía đó.
 */
export function WaypointTracker() {
  const last = useRef({ label: "", dist: -1, tone: "" });
  useFrame(({ camera, size }) => {
    const el = guide.el;
    if (!el) return;
    let best: GuideTarget | null = null;
    let bestD = Infinity;
    for (const t of guide.targets) {
      const d = Math.hypot(t.x - localPosition.x, t.z - localPosition.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best || bestD < ARRIVED) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    v.set(best.x, best.y, best.z).project(camera);
    const behind = v.z > 1;
    let dx = v.x * (size.width / 2);
    let dy = -v.y * (size.height / 2);
    if (behind) {
      dx = -dx;
      dy = -dy;
    }
    const halfW = size.width / 2 - EDGE;
    const halfH = size.height / 2 - EDGE;
    const off = behind || Math.abs(dx) > halfW || Math.abs(dy) > halfH;
    if (off) {
      // Đẩy ra mép theo đúng hướng; ở sau lưng thì luôn dạt xuống mép dưới cho dễ hiểu là "quay lại".
      if (behind && Math.abs(dy) < 1) dy = 1;
      const k = Math.min(halfW / Math.max(1e-3, Math.abs(dx)), halfH / Math.max(1e-3, Math.abs(dy)));
      dx *= k;
      dy *= k;
    }
    const angle = off ? Math.atan2(dy, dx) + Math.PI / 2 : Math.PI;
    el.style.display = "";
    el.style.transform = `translate(${size.width / 2 + dx}px, ${size.height / 2 + dy}px)`;
    el.classList.toggle("off", off);
    el.classList.toggle("low", off && dy > 0);
    const arrow = el.firstElementChild as HTMLElement;
    arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    const dist = Math.round(bestD);
    const l = last.current;
    if (l.label !== best.label || l.dist !== dist || l.tone !== best.tone) {
      (el.querySelector(".wp-label") as HTMLElement).textContent = best.label;
      (el.querySelector(".wp-dist") as HTMLElement).textContent = `${dist} m`;
      el.style.setProperty("--wp", TONES[best.tone]);
      last.current = { label: best.label, dist, tone: best.tone };
    }
  });
  return null;
}
